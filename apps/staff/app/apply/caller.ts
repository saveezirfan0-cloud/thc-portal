import { createHash, createHmac } from 'node:crypto';

/**
 * The per-caller key for the /apply throttle (§2.1, ADR-0024).
 *
 * The caller is their network address, read the way Vercel hands it over:
 * the first hop of `x-forwarded-for` (Vercel sets the header itself and
 * does not pass a client's own value through), else `x-real-ip`. What
 * leaves this file is never the address: it is an HMAC-SHA256 of it under
 * a server-side salt, so the database holds a digest that cannot be turned
 * back into an IP without the salt (§1.7), and `submit_application_as_caller`
 * refuses anything that is not a 64-hex digest.
 *
 * IPv6 is keyed by its /64. One subscriber is routinely handed a whole
 * /64, so a per-address key there is a per-request key to anyone who
 * cares to rotate.
 */

export interface HeaderGetter {
  get(name: string): string | null;
}

export const DEFAULT_SALT = 'thc-apply-throttle-unsalted';

/** The caller's address from the request headers, or null. */
export function callerAddress(headers: HeaderGetter): string | null {
  const forwarded = headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first) return first;
  const real = headers.get('x-real-ip')?.trim();
  return real ? real : null;
}

function expandIpv6(address: string): string[] | null {
  const [head = '', tail, extra] = address.split('::');
  if (extra !== undefined) return null;
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  if (tail === undefined) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...Array<string>(missing).fill('0'), ...right];
}

/**
 * The part of an address that identifies one caller: an IPv4 address as
 * is; an IPv6 address by its first four groups (the /64), lower-cased and
 * without leading zeros; an IPv4-mapped IPv6 address as its IPv4 address.
 * Anything unrecognisable is used verbatim — still hashed, still bounded.
 */
export function callerBucket(address: string): string {
  const text = address
    .trim()
    .replace(/^\[|\]$/g, '')
    .split('%')[0]!;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(text);
  if (mapped) return mapped[1]!;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(text)) return text;
  if (text.includes(':')) {
    const groups = expandIpv6(text.toLowerCase());
    if (groups && groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) {
      return `${groups
        .slice(0, 4)
        .map((g) => g.replace(/^0+(?=.)/, ''))
        .join(':')}::/64`;
    }
  }
  return text;
}

export function hashCaller(address: string, salt: string): string {
  return createHmac('sha256', salt).update(callerBucket(address)).digest('hex');
}

let warned = false;
let derived = false;

/**
 * A deployed build: `next build`/`next start` set NODE_ENV=production, and
 * Vercel says so itself. Preview deployments count — they take real
 * applications from anyone who has the URL.
 */
export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['NODE_ENV'] === 'production' || env['VERCEL_ENV'] === 'production';
}

/**
 * The salt to use when `APPLY_THROTTLE_SALT` is missing in production:
 * SHA-256 of a fixed label and the service-role key — a secret every
 * deployment of this app already holds (docs/12), and never in the repo.
 * The label keeps the digest from being the key's hash for any other use.
 * The key itself is never logged, returned or stored; only this digest is
 * used, as an HMAC key, inside this process.
 */
export function derivedSalt(secret: string): string {
  return createHash('sha256').update('thc-apply-throttle-salt/v1\0').update(secret).digest('hex');
}

/**
 * The digest to send, or null when there is none to send.
 *
 * Null when the request carries no address (local development — on Vercel
 * there always is one).
 *
 * With `APPLY_THROTTLE_SALT` unset in production the throttle stays ON
 * (security round 12.10, item 9). It used to send no key at all — which
 * `submit_application_as_caller` reads as "no per-caller limit" — so a
 * forgotten env var silently switched the throttle off. Hashing under the
 * constant in this file is no answer either: that constant is public, and
 * an unsalted-in-effect digest of an IPv4 address is reversed by trying
 * all four billion (§1.7). So the salt is derived from the service-role
 * key (`derivedSalt`), which is secret and always present, and the missing
 * variable is logged once as an error so it still gets set. Only with no
 * service key either — a deployment that cannot write anyway — is there
 * nothing to hash with, and null goes.
 *
 * Development keeps the constant, with a one-time warning.
 */
export function callerKey(
  headers: HeaderGetter,
  salt: string | undefined = process.env['APPLY_THROTTLE_SALT'],
  production: boolean = isProductionRuntime(),
  fallbackSecret: string | undefined = process.env['SUPABASE_SERVICE_ROLE_KEY'],
): string | null {
  const address = callerAddress(headers);
  if (!address) return null;
  let key = salt?.trim();
  if (!key) {
    if (production) {
      const secret = fallbackSecret?.trim();
      if (!derived) {
        derived = true;
        console.error(
          secret
            ? '[apply] APPLY_THROTTLE_SALT is not set on this production deployment — the per-caller throttle is hashing with a salt derived from the service key. Set APPLY_THROTTLE_SALT (any long random string) in the Vercel env vars.'
            : '[apply] APPLY_THROTTLE_SALT and SUPABASE_SERVICE_ROLE_KEY are both missing on this production deployment — the per-caller throttle is OFF (no caller hash is sent). Set APPLY_THROTTLE_SALT in the Vercel env vars.',
        );
      }
      if (!secret) return null;
      return hashCaller(address, derivedSalt(secret));
    }
    if (!warned) {
      warned = true;
      console.warn(
        '[apply] APPLY_THROTTLE_SALT is not set — the per-caller throttle is hashing with a built-in constant. Fine for local development only; set it (any long random string) on every deployment.',
      );
    }
    key = DEFAULT_SALT;
  }
  return hashCaller(address, key);
}
