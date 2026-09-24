import { createHmac } from 'node:crypto';

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
let refused = false;

/**
 * A deployed build: `next build`/`next start` set NODE_ENV=production, and
 * Vercel says so itself. Preview deployments count — they take real
 * applications from anyone who has the URL.
 */
export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['NODE_ENV'] === 'production' || env['VERCEL_ENV'] === 'production';
}

/**
 * The digest to send, or null when there is none to send.
 *
 * Null when the request carries no address (local development — on Vercel
 * there always is one), and null in production when `APPLY_THROTTLE_SALT`
 * is unset. That second case used to hash under a constant that is in this
 * file, i.e. in the public repository: an unsalted-in-effect digest of an
 * IPv4 address is reversed by trying all four billion (§1.7). Refusing is
 * the honest outcome — `submit_application_as_caller` treats a null key as
 * "no per-caller limit" and the per-email and per-mobile limits still apply
 * — and it is logged as an error so the missing secret gets noticed.
 * Development keeps the constant, with a one-time warning.
 */
export function callerKey(
  headers: HeaderGetter,
  salt: string | undefined = process.env['APPLY_THROTTLE_SALT'],
  production: boolean = isProductionRuntime(),
): string | null {
  const address = callerAddress(headers);
  if (!address) return null;
  let key = salt?.trim();
  if (!key) {
    if (production) {
      if (!refused) {
        refused = true;
        console.error(
          '[apply] APPLY_THROTTLE_SALT is not set on this production deployment — the per-caller throttle is OFF (no caller hash is sent). Set it (any long random string) in the Vercel env vars.',
        );
      }
      return null;
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
