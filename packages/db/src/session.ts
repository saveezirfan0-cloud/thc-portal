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
 * No preference cookie at all — a session from before this existed, an
 * invite or reset link opened on a fresh device (/auth/callback), a device
 * whose preference cookie was cleared — takes the app's FALLBACK:
 *
 *   Back Office, Client Portal → 'persistent' (30 days). Never the library's
 *              400 days: those two apps hold pay, personal data and client
 *              documents, and the ceiling is the point of ADR-0032.
 *   Staff App  → null, i.e. `@supabase/ssr`'s own options pass through. Its
 *              wireframe has no box and a worker stays signed in as before.
 *
 * The fallback fails SAFE: unless an app says otherwise it is 'persistent'.
 * Middleware passes it explicitly; the server and browser client factories,
 * which have ~60 call sites, read the app's build-time setting
 * (`defaultSessionFallback`), and only the Staff App sets that
 * (`apps/staff/next.config.ts`). A missing setting therefore costs a worker a
 * sign-in after a month away, never an admin a 400-day cookie.
 *
 * Pure: no `server-only`, no Next import. Middleware (edge), the server
 * client and the browser client all load it.
 */
import type { CookieOptions } from '@supabase/ssr';

/** The preference cookie. First-party, per app host. */
export const KEEP_SIGNED_IN_COOKIE = 'thc-keep-signed-in';

/**
 * LEGACY — remove in the release after ADR-0032 ships (with its reader in
 * `readSessionPersistence`, `clearLegacySessionOnlyCookie` and the two calls
 * in `apps/client`'s login action and sign-out route).
 *
 * #65's Client Portal marker for an unticked box: a session cookie, present
 * (any value) = "session only", `httpOnly`, `Path=/`. Nothing wrote it after
 * ADR-0032 replaced it, but browsers that signed in unticked before the
 * deploy still carry it until they close. Honoured as 'session' for one
 * release so the first refresh after the deploy does not turn those sessions
 * into 30-day ones; the login action and sign-out delete it. It is
 * `httpOnly`, so the browser client cannot see it — the Client Portal has no
 * browser Supabase client, and the middleware and server client can.
 */
export const LEGACY_SESSION_ONLY_COOKIE = 'thc-session-only';

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
 * sliding auth cookies it governs (or a busy user's "ticked" would silently
 * become the app's fallback after 30 days), so it takes the browser's cap —
 * the same 400 days `@supabase/ssr` uses. Sign-out deletes it.
 */
const PREFERENCE_MAX_AGE = 400 * 24 * 60 * 60;

export type SessionPersistence = 'persistent' | 'session';

/**
 * What a writer does when the device has no preference. `null` passes the
 * library's options through (the Staff App); otherwise the given lifetime.
 */
export type SessionFallback = SessionPersistence | null;

/**
 * The build-time setting read by the server and browser client factories:
 * `THC_AUTH_COOKIE_FALLBACK`, inlined by the app's `next.config.ts` `env`.
 *
 *   'library'  → null (pass the library options through). Staff App only.
 *   'session'  → 'session'.
 *   anything else, including unset → 'persistent' (30 days).
 *
 * Read as the literal `process.env.THC_AUTH_COOKIE_FALLBACK` so Next can
 * inline it into the edge and browser bundles too.
 */
export function defaultSessionFallback(): SessionFallback {
  const value = typeof process === 'undefined' ? undefined : process.env.THC_AUTH_COOKIE_FALLBACK;
  if (value === 'library') return null;
  if (value === 'session') return 'session';
  return 'persistent';
}

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

/**
 * The remembered choice, or null when this device has never made one.
 * `thc-keep-signed-in` wins; failing that, #65's legacy marker (present)
 * means 'session' (LEGACY_SESSION_ONLY_COOKIE, one release only).
 */
export function readSessionPersistence(
  cookies: readonly NamedValue[] | null | undefined,
): SessionPersistence | null {
  const found = cookies?.find((c) => c.name === KEEP_SIGNED_IN_COOKIE);
  if (found?.value === '0') return 'session';
  if (found?.value === '1') return 'persistent';
  if (cookies?.some((c) => c.name === LEGACY_SESSION_ONLY_COOKIE)) return 'session';
  return null;
}

/**
 * The preference cookie the login action writes.
 *
 * Not `httpOnly`: the browser Supabase client is one of the writers that has
 * to read it (see the header), and hidden from scripts it would let the
 * check-in monitor's in-page refresh re-persist a "session only" sign-in.
 * What a script that can write it gains: flipping it moves the auth
 * cookies' lifetime between browser-session and 30 days, both at or below
 * the library's 400-day default. It carries no identity and no privilege,
 * and anything that can write it (XSS) can already read the `sb-*` tokens
 * themselves, which `@supabase/ssr` makes readable from JavaScript.
 *
 * `Secure` in production, as #65 had it, so plain-http `next dev` keeps it
 * (a `Secure` cookie set over http is dropped by the browser). `SameSite=Lax`
 * as the auth cookies.
 *
 * Unticked, the preference is itself a session cookie: it ends with the
 * browser, together with the auth cookies it describes.
 */
export function keepSignedInCookie(persistence: SessionPersistence): CookieToSet {
  const options = preferenceOptions();
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
  return { name: KEEP_SIGNED_IN_COOKIE, value: '', options: { ...preferenceOptions(), maxAge: 0 } };
}

/**
 * LEGACY (see LEGACY_SESSION_ONLY_COOKIE; remove with it): delete #65's
 * marker. Written by the Client Portal's login action, which replaces it
 * with `thc-keep-signed-in`, and by its sign-out.
 */
export function clearLegacySessionOnlyCookie(): CookieToSet {
  return {
    name: LEGACY_SESSION_ONLY_COOKIE,
    value: '',
    options: { path: '/', sameSite: 'lax', httpOnly: true, secure: isProduction(), maxAge: 0 },
  };
}

function isProduction(): boolean {
  return typeof process !== 'undefined' && process.env.NODE_ENV === 'production';
}

function preferenceOptions(): CookieOptions {
  return { path: '/', sameSite: 'lax', secure: isProduction(), httpOnly: false };
}

/** A write that deletes a cookie (sign-out, a stale chunk) is never touched. */
function isDeletion({ value, options }: CookieToSet): boolean {
  return value === '' || (typeof options.maxAge === 'number' && options.maxAge <= 0);
}

/**
 * One auth cookie's options under the given choice. `null` (no choice, and a
 * pass-through fallback) leaves the library's options untouched.
 */
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

export interface SessionPersistenceOptions {
  /**
   * Overrides what the cookies say. The login action passes the box's value:
   * the preference cookie it is about to write is not in this request's
   * cookies yet, and the sign-in's own writes must already obey it.
   */
  persistence?: SessionPersistence;
  /**
   * When the device has no preference (see the header). Left out, the app's
   * build-time default (`defaultSessionFallback`), which is 'persistent'
   * unless the app opted out.
   */
  fallback?: SessionFallback;
}

/**
 * Wrap the cookie methods handed to `createServerClient` / `createBrowserClient`
 * so every auth-cookie write honours the device's choice: the explicit
 * `persistence`, else the preference read from `getAll()` at write time,
 * else the fallback.
 */
export function withSessionPersistence(
  methods: SessionCookieMethods,
  options: SessionPersistenceOptions = {},
): SessionCookieMethods {
  const fallback = options.fallback === undefined ? defaultSessionFallback() : options.fallback;
  return {
    getAll: methods.getAll,
    setAll: (toSet) =>
      methods.setAll(
        applySessionPersistence(
          toSet,
          options.persistence ?? readSessionPersistence(methods.getAll()) ?? fallback,
        ),
      ),
  };
}
