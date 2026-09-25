/**
 * "Keep me signed in on this device" (ADR-0032; `wireframes/backoffice/login.html`,
 * `wireframes/client/login.html`).
 *
 * The wireframe note: it "only lengthens the token lifetime on this device".
 * Supabase keeps a session alive with its refresh token, so what the box
 * actually decides is whether the `sb-*-auth-token` cookies outlive the
 * browser:
 *
 *   ticked   → persistent cookies, `Max-Age` = KEEP_SIGNED_IN_MAX_AGE. Every
 *              token refresh rewrites them, so it is 30 days since the device
 *              last used the app, not 30 days since sign-in.
 *   unticked → session cookies (no `Max-Age`, no `Expires`): closing the
 *              browser ends the session.
 *
 * The choice is remembered in one first-party cookie, KEEP_SIGNED_IN_COOKIE,
 * written by the login server action and cleared by sign-out. Every writer
 * of the auth cookies has to honour it — the server client (server actions,
 * route handlers such as /auth/callback), each app's middleware (token
 * refresh) and the browser client (a long-open page such as the check-in
 * monitor refreshes its token from JavaScript). One writer that ignored it
 * would put the library's 400-day default back on the next refresh. So they
 * all go through `withSessionPersistence` below.
 *
 * No preference cookie at all (the Staff App, whose wireframe has no box;
 * a session from before this existed; a reset link opened on a fresh
 * device) leaves `@supabase/ssr`'s own options untouched.
 *
 * Pure: no `server-only`, no Next import. Middleware (edge), the server
 * client and the browser client all load it.
 */
import type { CookieOptions } from '@supabase/ssr';

/** The preference cookie. First-party, per app host. */
export const KEEP_SIGNED_IN_COOKIE = 'thc-keep-signed-in';

/** The login form's checkbox name. Unticked checkboxes are not submitted at all. */
export const KEEP_SIGNED_IN_FIELD = 'keep_signed_in';

/**
 * Auth-cookie lifetime when "Keep me signed in" is ticked: 30 days.
 *
 * Sliding, because every refresh (roughly hourly while the app is in use)
 * rewrites the cookies with a fresh Max-Age. An admin or a venue manager who
 * uses the portal at least once a month never sees the login screen; a device
 * left in a drawer for longer asks again. Shorter than `@supabase/ssr`'s
 * 400-day default on purpose: the Back Office is where pay and personal data
 * live.
 */
export const KEEP_SIGNED_IN_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * How long the preference itself is kept when ticked. It must outlive the
 * sliding auth cookies it governs (or a busy user's refresh would fall back
 * to the library default after 30 days), so it takes the browser's cap —
 * the same 400 days `@supabase/ssr` uses. Sign-out deletes it.
 */
const PREFERENCE_MAX_AGE = 400 * 24 * 60 * 60;

export type SessionPersistence = 'persistent' | 'session';

interface NamedValue {
  name: string;
  value: string;
}

export interface CookieToSet extends NamedValue {
  options: CookieOptions;
}

/** The login form's checkbox → the choice. Present (any value) means ticked. */
export function persistenceFromForm(value: FormDataEntryValue | null): SessionPersistence {
  return value === null ? 'session' : 'persistent';
}

/** The remembered choice, or null when this device has never made one. */
export function readSessionPersistence(
  cookies: readonly NamedValue[] | null | undefined,
): SessionPersistence | null {
  const found = cookies?.find((c) => c.name === KEEP_SIGNED_IN_COOKIE);
  if (!found) return null;
  if (found.value === '0') return 'session';
  if (found.value === '1') return 'persistent';
  return null;
}

/**
 * The preference cookie the login action writes.
 *
 * Not `httpOnly`: the browser Supabase client is one of the writers that has
 * to read it (see the header). It holds one bit that can only shorten a
 * session, next to auth cookies that `@supabase/ssr` already makes readable
 * from JavaScript, so hiding it from scripts would protect nothing and would
 * let the check-in monitor's in-page refresh re-persist a "session only"
 * sign-in. `Secure` and `SameSite=Lax` as the auth cookies.
 *
 * Unticked, the preference is itself a session cookie: it ends with the
 * browser, together with the auth cookies it describes.
 */
export function keepSignedInCookie(persistence: SessionPersistence): CookieToSet {
  const options: CookieOptions = { path: '/', sameSite: 'lax', secure: true, httpOnly: false };
  return persistence === 'persistent'
    ? {
        name: KEEP_SIGNED_IN_COOKIE,
        value: '1',
        options: { ...options, maxAge: PREFERENCE_MAX_AGE },
      }
    : { name: KEEP_SIGNED_IN_COOKIE, value: '0', options };
}

/** Sign-out: delete the preference with the auth cookies. */
export function clearKeepSignedInCookie(): CookieToSet {
  return {
    name: KEEP_SIGNED_IN_COOKIE,
    value: '',
    options: { path: '/', sameSite: 'lax', secure: true, httpOnly: false, maxAge: 0 },
  };
}

/** A write that deletes a cookie (sign-out, a stale chunk) is never touched. */
function isDeletion({ value, options }: CookieToSet): boolean {
  return value === '' || (typeof options.maxAge === 'number' && options.maxAge <= 0);
}

/** One auth cookie's options under the given choice. */
export function authCookieOptions(
  options: CookieOptions,
  persistence: SessionPersistence | null,
): CookieOptions {
  if (persistence === null) return options;
  const { maxAge: _maxAge, expires: _expires, ...rest } = options;
  return persistence === 'persistent' ? { ...rest, maxAge: KEEP_SIGNED_IN_MAX_AGE } : rest;
}

/** Apply the choice to a batch of auth-cookie writes, leaving deletions alone. */
export function applySessionPersistence(
  toSet: readonly CookieToSet[],
  persistence: SessionPersistence | null,
): CookieToSet[] {
  return toSet.map((cookie) =>
    isDeletion(cookie)
      ? cookie
      : { ...cookie, options: authCookieOptions(cookie.options, persistence) },
  );
}

export interface SessionCookieMethods {
  getAll: () => NamedValue[];
  setAll: (toSet: CookieToSet[]) => void;
}

/**
 * Wrap the cookie methods handed to `createServerClient` / `createBrowserClient`
 * so every auth-cookie write honours the device's choice.
 *
 * `persistence` overrides what the cookies say. The login action passes the
 * box's value: the preference cookie it is about to write is not in this
 * request's cookies yet, and the sign-in's own writes must already obey it.
 * Otherwise the choice is read from `getAll()` at write time.
 */
export function withSessionPersistence(
  methods: SessionCookieMethods,
  persistence?: SessionPersistence,
): SessionCookieMethods {
  return {
    getAll: methods.getAll,
    setAll: (toSet) =>
      methods.setAll(
        applySessionPersistence(toSet, persistence ?? readSessionPersistence(methods.getAll())),
      ),
  };
}
