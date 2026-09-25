import { createHmac } from 'node:crypto';

/**
 * The per-caller key for the /apply throttle — ADR-0024, §1.7, docs/14 D2.
 *
 * `submit_application()` limits per email and per mobile (20260922183012),
 * which bounds nothing for a caller who brings a fresh pair every time. The
 * only thing every request from one source has in common is where it came
 * from, so the limit that closes D2 is keyed on the client address — and
 * §1.7 says the address itself is personal data, so what reaches the
 * database is a keyed hash of it, never the address.
 *
 * What the key is made of:
 *
 *   · the client address as the platform reports it: the first hop of
 *     `x-forwarded-for`, else `x-real-ip`. On Vercel both are written by
 *     Vercel's own proxy and cannot be supplied by the caller;
 *   · bucketed — an IPv6 client is handed a whole /64, so hashing the full
 *     address would give one attacker 2^64 distinct keys and the limit would
 *     mean nothing. IPv4 is used as-is;
 *   · HMAC-SHA256 under a server-side salt (`APPLY_CALLER_SALT`), so a row
 *     in `apply_caller_attempts` cannot be walked back to an address by
 *     anyone who can read the table but not the salt.
 *
 * Pure, apart from the one warning `callerKey()` logs when the salt is
 * missing, so the test in app/__tests__/callerKey.test.ts needs no Next.
 */

/** The smallest header surface the key needs; `next/headers` satisfies it. */
export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Used when `APPLY_CALLER_SALT` is unset, so a fresh environment throttles
 * rather than failing. It is in the repository, so a hash made with it
 * protects the address only from being READ, not from a brute-force over
 * the IPv4 space by someone who holds both the table and this file. Set the
 * real salt before go-live (docs/12); the warning below says so on every
 * cold start until then.
 */
export const FALLBACK_SALT = 'thc-apply-caller-fallback-salt-not-for-production';

/** `process.env`'s shape, without Next's required NODE_ENV, so a test can hand in a literal. */
export type Env = Record<string, string | undefined>;

/** The salt in force. Pure: the environment is a parameter for the test. */
export function callerSalt(env: Env = process.env): string {
  // Either name: the Staff Vercel project was given the salt as
  // APPLY_THROTTLE_SALT on 23.09, before this module named it; reading both
  // spares the owner a rename and a redeploy (docs/16 §3.1).
  const salt = env['APPLY_CALLER_SALT'] || env['APPLY_THROTTLE_SALT'];
  return salt && salt.length > 0 ? salt : FALLBACK_SALT;
}

/**
 * The client address as the platform reports it, or null when nothing does.
 * First hop of `x-forwarded-for` (the client; later hops are proxies), else
 * `x-real-ip`. Not the socket address: a server action never sees one.
 */
export function clientIp(headers: HeaderReader): string | null {
  const forwarded = headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first) return first;
  const real = headers.get('x-real-ip')?.trim();
  return real ? real : null;
}

const IPV4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const IPV4_MAPPED = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;
const HEXTET = /^[0-9a-f]{1,4}$/;

/** Eight zero-padded hextets, or null when the text is not an IPv6 address. */
function expandIpv6(ip: string): string[] | null {
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  if (halves.length === 2 && missing === 0) return null;
  const parts = [...head, ...Array<string>(missing).fill('0'), ...tail];
  if (!parts.every((p) => HEXTET.test(p))) return null;
  return parts.map((p) => p.padStart(4, '0'));
}

/**
 * The bucket an address counts in. IPv4 is the address; IPv6 is its /64
 * (the prefix a subscriber is normally given, so rotating inside it does
 * not mint a new key); an IPv4-mapped IPv6 address is the IPv4 inside it.
 * Anything else is kept as typed — it still hashes, it just buckets alone.
 */
export function callerBucket(raw: string): string {
  let ip = raw.trim().toLowerCase();
  const mapped = IPV4_MAPPED.exec(ip);
  if (mapped) ip = mapped[1] as string;
  if (IPV4.test(ip)) return ip;
  if (ip.includes(':')) {
    const zone = ip.indexOf('%');
    if (zone >= 0) ip = ip.slice(0, zone);
    const hextets = expandIpv6(ip);
    if (hextets) return `${hextets.slice(0, 4).join(':')}::/64`;
  }
  return ip;
}

/**
 * HMAC-SHA256 of the bucket under the salt, as 64 hex characters — the
 * shape `apply_caller_check()` insists on, so the table can never hold an
 * address by mistake (§1.7).
 */
export function callerHash(ip: string, salt: string): string {
  return createHmac('sha256', salt).update(callerBucket(ip)).digest('hex');
}

let warnedAboutSalt = false;

/**
 * The key for this request, or null when the request carries no client
 * address at all — which only happens off the platform (a bare `next dev`
 * with nothing in front of it). The action then skips the limit rather
 * than putting every such caller in one shared bucket: if the platform ever
 * stopped sending the header, that bucket would refuse the whole world at
 * five applications per ten minutes.
 */
export function callerKey(headers: HeaderReader, env: Env = process.env): string | null {
  const ip = clientIp(headers);
  if (!ip) return null;
  const salt = callerSalt(env);
  if (salt === FALLBACK_SALT && !warnedAboutSalt) {
    warnedAboutSalt = true;
    console.warn(
      '[apply] APPLY_CALLER_SALT is not set — the caller limit is using the built-in fallback salt (docs/12)',
    );
  }
  return callerHash(ip, salt);
}
