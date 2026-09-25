/**
 * "Keep me signed in on this device" (§1.4; wireframes/backoffice/login.html
 * and wireframes/client/login.html, ticked by default). ADR-0035.
 *
 * Ticked: the Supabase auth cookies are persistent, as @supabase/ssr writes
 * them (Max-Age 400 days; the refresh token decides how long the session
 * really lasts). Unticked: they are SESSION cookies — no Max-Age, no
 * Expires — so closing the browser ends the sign-in on this device.
 *
 * @supabase/ssr forces its own Max-Age onto every auth cookie it writes
 * (`cookieOptions` cannot override it), and it rewrites the cookies on every
 * token refresh — in middleware, in server actions and in the browser
 * client. So the choice is remembered in a small marker cookie, itself a
 * session cookie, and every `setAll` in the workspace passes its options
 * through `sessionCookieOptions()` below. A deletion (Max-Age 0) is never
 * touched: stripping it would turn "sign out" into "keep this cookie".
 *
 * The marker is not httpOnly on purpose: the browser client has to read it
 * too, and it carries nothing but "1".
 */

/** Present (value "1") when the user unticked "Keep me signed in". */
export const SESSION_ONLY_COOKIE = 'thc-session-only';

/** How the marker is written: a session cookie on the whole app. */
export const SESSION_ONLY_COOKIE_OPTIONS = {
  path: '/',
  sameSite: 'lax' as const,
  httpOnly: false,
};

/** The subset of cookie options this reads and writes. */
export interface CookieOptionsLike {
  maxAge?: number;
  expires?: Date | number | string;
  [key: string]: unknown;
}

/** True when the request carries the "not on this device" marker. */
export function isSessionOnly(cookies: readonly { name: string; value: string }[]): boolean {
  return cookies.some((c) => c.name === SESSION_ONLY_COOKIE && c.value === '1');
}

/**
 * The options to write an auth cookie with. Session-only: drop Max-Age and
 * Expires, unless this write is a deletion (Max-Age 0, or an Expires in the
 * past), which must stay a deletion.
 */
export function sessionCookieOptions<T extends CookieOptionsLike | undefined>(
  options: T,
  sessionOnly: boolean,
): T {
  if (!sessionOnly || !options) return options;
  if (typeof options.maxAge === 'number' && options.maxAge <= 0) return options;
  if (options.expires !== undefined) {
    const at = new Date(options.expires).getTime();
    if (Number.isFinite(at) && at <= Date.now()) return options;
  }
  const rest: CookieOptionsLike = { ...options };
  delete rest.maxAge;
  delete rest.expires;
  return rest as T;
}

/** `document.cookie` → name/value pairs (values URI-decoded). */
export function parseCookieHeader(header: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const raw = part.slice(eq + 1).trim();
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      // A value that is not URI-encoded is used as it is.
    }
    out.push({ name, value });
  }
  return out;
}

/** One `document.cookie` assignment for a name, value and options. */
export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptionsLike = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (typeof options.maxAge === 'number') parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.expires !== undefined) {
    parts.push(`Expires=${new Date(options.expires).toUTCString()}`);
  }
  if (typeof options['domain'] === 'string') parts.push(`Domain=${options['domain']}`);
  parts.push(`Path=${typeof options['path'] === 'string' ? options['path'] : '/'}`);
  const sameSite = options['sameSite'];
  if (typeof sameSite === 'string') {
    parts.push(`SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1).toLowerCase()}`);
  } else if (sameSite === true) {
    parts.push('SameSite=Strict');
  }
  if (options['secure']) parts.push('Secure');
  return parts.join('; ');
}
