/**
 * "Keep me signed in on this device" (§1.4, wireframes/client/login.html:65).
 *
 * Supabase's cookie session is persistent by default: `@supabase/ssr`
 * writes every `sb-*-auth-token` chunk with a 400-day `maxAge`, and the
 * middleware rewrites them with the same lifetime each time it refreshes
 * the token. There is no per-sign-in switch for that in the library, so
 * the box is honoured one layer down, at the cookie store:
 *
 *   ticked (the default)  — nothing changes; the session outlives the browser.
 *   unticked              — a session-scoped marker is set, and while it is
 *                           present every auth cookie is written WITHOUT a
 *                           lifetime, so the browser drops the lot when it
 *                           closes. The marker has no lifetime either, so it
 *                           goes at the same moment and a later sign-in
 *                           starts clean.
 *
 * Deletions (`maxAge: 0`) pass through untouched: sign-out must still clear
 * the cookies whichever way the box was set. The duration of a ticked
 * session is Supabase's refresh-token life, which the wireframe lists as an
 * assumption to confirm with THC.
 *
 * A plain module: `login/actions.ts` is `'use server'` and may export only
 * async functions, and the middleware needs the same two helpers.
 */
import type { CookieStore } from '@thc/db/server';

/** The form field the checkbox posts; absent when unticked. */
export const REMEMBER_FIELD = 'remember';

/** Marker cookie: present while this browser session must not persist. */
export const SESSION_ONLY_COOKIE = 'thc-session-only';

export type CookieOptions = Record<string, unknown>;

/** The same options minus any lifetime — a session cookie in the browser's terms. */
export function withoutLifetime<T extends { maxAge?: number; expires?: unknown }>(
  options: T | undefined,
): T | undefined {
  if (!options) return options;
  if (options.maxAge === 0) return options; // a deletion stays a deletion
  const { maxAge: _maxAge, expires: _expires, ...rest } = options;
  return rest as T;
}

/** A store whose every write is session-scoped. */
export function sessionScopedStore(store: CookieStore): CookieStore {
  return {
    getAll: () => store.getAll(),
    set: (name, value, options) => store.set(name, value, withoutLifetime(options)),
  };
}

/** The marker's own options: session-scoped, and not readable by scripts. */
export function markerOptions(): CookieOptions {
  return {
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  };
}
