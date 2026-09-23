/**
 * Web Push over VAPID — Scope §8, §10.5. No library, WebCrypto only.
 *
 * Why not `npm:web-push`: it is built on Node's `crypto` (createECDH,
 * createCipheriv) and `https`, which Deno reaches only through its Node
 * compatibility layer, on a runtime (Supabase's Edge Runtime) that pins its
 * own Deno version. The protocol is small, fully specified, and needs nothing
 * WebCrypto lacks, so it lives here where vitest can prove it — including
 * against the worked example in RFC 8291 Appendix A — and the same file runs
 * unchanged in Node, in Deno and in the Edge Runtime.
 *
 *   RFC 8291  Message Encryption for Web Push (aes128gcm, ECDH P-256 + HKDF)
 *   RFC 8188  Encrypted Content-Encoding for HTTP (the aes128gcm header)
 *   RFC 8292  VAPID (an ES256 JWT in `Authorization: vapid t=…, k=…`)
 *   RFC 8030  Generic Event Delivery Using HTTP Push (TTL, Urgency, 404/410)
 *
 * This module builds requests and classifies responses. It never calls
 * `fetch` itself: the drain does, so a test can mock the network while
 * exercising the real crypto.
 */

export interface PushSubscriptionKeys {
  endpoint: string;
  /** The browser's ECDH public key: base64url, 65-byte uncompressed P-256 point. */
  p256dh: string;
  /** The browser's auth secret: base64url, 16 bytes. */
  auth: string;
}

export interface VapidKeys {
  /** base64url, 65-byte uncompressed P-256 point — `npx web-push generate-vapid-keys`. */
  publicKey: string;
  /** base64url, 32-byte private scalar. */
  privateKey: string;
  /** `mailto:` or `https:` contact the push service can reach (RFC 8292 §2.1). */
  subject: string;
}

export interface PushRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: Uint8Array;
}

/** RFC 8188 record size. One record: the payload must fit in it. */
const RECORD_SIZE = 4096;
/**
 * Push services must accept 4096 bytes of body (RFC 8030 §7.2). The header is
 * 86 bytes and the tag 16, and one byte is the padding delimiter.
 */
export const MAX_PUSH_PLAINTEXT = RECORD_SIZE - 86 - 16 - 1;

const enc = new TextEncoder();

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text: string): Uint8Array {
  const clean = text.trim().replace(/-/g, '+').replace(/_/g, '/');
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** WebCrypto's parameter types want an ArrayBuffer-backed view. */
function buf(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes) as Uint8Array<ArrayBuffer>;
}

// ---------------------------------------------------------------------------
// keys
// ---------------------------------------------------------------------------

function assertPoint(bytes: Uint8Array, what: string): void {
  if (bytes.length !== 65 || bytes[0] !== 0x04) {
    throw new Error(`${what} is not an uncompressed P-256 public key`);
  }
}

/** The EC subset of a JWK. Declared here: the package's lib has no DOM types. */
interface EcJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  d?: string;
  ext: boolean;
}

function jwkFor(publicKey: Uint8Array, privateKey?: Uint8Array): EcJwk {
  assertPoint(publicKey, 'the public key');
  return {
    kty: 'EC',
    crv: 'P-256',
    x: b64urlEncode(publicKey.slice(1, 33)),
    y: b64urlEncode(publicKey.slice(33, 65)),
    ...(privateKey ? { d: b64urlEncode(privateKey) } : {}),
    ext: true,
  };
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    'raw',
    buf(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, buf(data)));
}

/** HKDF (RFC 5869) with a single expand block — every length here is ≤ 32. */
async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm);
  const okm = await hmac(prk, concat(info, new Uint8Array([1])));
  return okm.slice(0, length);
}

export interface EncryptOptions {
  /** Test seam: RFC 8291 Appendix A fixes both. Random in production. */
  salt?: Uint8Array;
  senderKeys?: { publicKey: Uint8Array; privateKey: Uint8Array };
}

/**
 * Encrypt `plaintext` for one subscription (RFC 8291 §3, RFC 8188 §2), as a
 * single aes128gcm record with the minimum padding.
 */
export async function encryptPayload(
  plaintext: Uint8Array,
  subscription: Pick<PushSubscriptionKeys, 'p256dh' | 'auth'>,
  options: EncryptOptions = {},
): Promise<Uint8Array> {
  if (plaintext.length > MAX_PUSH_PLAINTEXT) {
    throw new Error(
      `push payload is ${plaintext.length} bytes; the limit is ${MAX_PUSH_PLAINTEXT}`,
    );
  }
  const uaPublic = b64urlDecode(subscription.p256dh);
  assertPoint(uaPublic, 'the subscription p256dh');
  const authSecret = b64urlDecode(subscription.auth);
  if (authSecret.length !== 16) throw new Error('the subscription auth secret is not 16 bytes');

  // The application server's one-off ECDH pair.
  let asPublic: Uint8Array;
  let asPrivateKey: CryptoKey;
  if (options.senderKeys) {
    asPublic = options.senderKeys.publicKey;
    asPrivateKey = await crypto.subtle.importKey(
      'jwk',
      jwkFor(asPublic, options.senderKeys.privateKey),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    );
  } else {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as { publicKey: CryptoKey; privateKey: CryptoKey };
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    asPrivateKey = pair.privateKey;
  }

  const uaKey = await crypto.subtle.importKey(
    'jwk',
    jwkFor(uaPublic),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivateKey, 256),
  );

  // RFC 8291 §3.3–3.4.
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  // One record, the last: plaintext, then the 0x02 delimiter (RFC 8188 §2).
  const padded = concat(plaintext, new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', buf(cek), 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(nonce) }, aesKey, buf(padded)),
  );

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

// ---------------------------------------------------------------------------
// VAPID
// ---------------------------------------------------------------------------

/** The origin of a push endpoint — the JWT's `aud` (RFC 8292 §2). */
export function audienceOf(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:') throw new Error('a push endpoint must be https');
  return url.origin;
}

/**
 * `Authorization: vapid t=<jwt>, k=<public key>` for one push service origin.
 * `nowSeconds` is a seam for the test; the token lives 12 hours, well inside
 * RFC 8292's 24-hour ceiling.
 */
export async function vapidAuthorization(
  endpoint: string,
  vapid: VapidKeys,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const publicKey = b64urlDecode(vapid.publicKey);
  const privateKey = b64urlDecode(vapid.privateKey);
  if (privateKey.length !== 32) throw new Error('VAPID_PRIVATE_KEY is not a 32-byte key');
  if (!/^(mailto:|https:)/.test(vapid.subject)) {
    throw new Error('VAPID_SUBJECT must be a mailto: or https: URL');
  }

  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(
    enc.encode(
      JSON.stringify({
        aud: audienceOf(endpoint),
        exp: nowSeconds + 12 * 3600,
        sub: vapid.subject,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    'jwk',
    jwkFor(publicKey, privateKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  // WebCrypto's ECDSA signature is already r||s (IEEE P1363), which is what
  // JWS ES256 wants — no DER unwrapping.
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      buf(enc.encode(signingInput)),
    ),
  );
  return `vapid t=${signingInput}.${b64urlEncode(signature)}, k=${vapid.publicKey}`;
}

export interface PushOptions {
  /** Seconds the push service may hold an undelivered message. */
  ttl?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  /** Collapses a not-yet-delivered push with the same topic (RFC 8030 §5.4). */
  topic?: string;
}

/** The whole HTTP request for one subscription. */
export async function buildPushRequest(
  subscription: PushSubscriptionKeys,
  payload: unknown,
  vapid: VapidKeys,
  options: PushOptions = {},
  encryptOptions: EncryptOptions = {},
): Promise<PushRequest> {
  const body = await encryptPayload(
    enc.encode(JSON.stringify(payload)),
    subscription,
    encryptOptions,
  );
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(subscription.endpoint, vapid),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(options.ttl ?? 12 * 3600),
    Urgency: options.urgency ?? 'high',
  };
  // A Topic is at most 32 base64url characters (RFC 8030 §5.4).
  if (options.topic && /^[A-Za-z0-9_-]{1,32}$/.test(options.topic)) headers.Topic = options.topic;
  return { url: subscription.endpoint, method: 'POST', headers, body };
}

/**
 * What a push service's answer means for this subscription and this row.
 *
 *   delivered  2xx — accepted for delivery.
 *   gone       404/410 — the subscription is dead (RFC 8030 §7.3, and what
 *              FCM/Mozilla/Apple send for an unsubscribed or expired one).
 *              Delete the row; the message is not retried to it.
 *   rejected   400/403/413 — the REQUEST is wrong (bad VAPID, payload too
 *              big). Retrying the same bytes fails the same way.
 *   retry      429, 5xx, anything else — the service's problem, try later.
 */
export type PushVerdict = 'delivered' | 'gone' | 'rejected' | 'retry';

export function classifyPushStatus(status: number): PushVerdict {
  if (status >= 200 && status < 300) return 'delivered';
  if (status === 404 || status === 410) return 'gone';
  if (status === 400 || status === 401 || status === 403 || status === 413) return 'rejected';
  return 'retry';
}
