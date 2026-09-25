import type { CookieStore } from '@thc/db/server';

/**
 * "Keep me signed in on this device" (wireframes/backoffice/login.html:39,
 * ticked by default). The box "only lengthens the token lifetime on this
 * device" (login.html:95): ticked, the session cookies keep the lifetime
 * `@supabase/ssr` gives them; unticked, they become session cookies, so
 * closing the browser ends the sign-in.
 *
 * It has to be done here, in the cookie adapter, because `@supabase/ssr`
 * re-applies its 400-day `maxAge` AFTER merging `cookieOptions`
 * (cookies.js: `{ ...DEFAULT_COOKIE_OPTIONS, ...cookieOptions, maxAge:
 * DEFAULT_COOKIE_OPTIONS.maxAge }`), so no client option can produce a
 * session cookie — only the store that finally writes it can.
 *
 * The marker cookie is what lets the middleware keep the choice: its token
 * refresh writes fresh `sb-*` cookies with the default lifetime, and it has
 * to strip them the same way when it sees the marker. Until it does, an
 * unticked box holds for the life of one access token.
 */
export const SESSION_ONLY_COOKIE = 'thc-session-only';

export function rememberedCookies(store: CookieStore, remember: boolean): CookieStore {
  if (remember) {
    // A previous unticked sign-in on this device may have left the marker.
    store.set(SESSION_ONLY_COOKIE, '', { path: '/', maxAge: 0 });
    return store;
  }
  store.set(SESSION_ONLY_COOKIE, '1', { path: '/', sameSite: 'lax', httpOnly: true });
  return {
    getAll: () => store.getAll(),
    set: (name, value, options) => {
      const { maxAge, expires, ...rest } = options ?? {};
      // Deletions (`maxAge: 0`) must still delete.
      if (maxAge === 0) {
        store.set(name, value, { ...rest, maxAge: 0 });
        return;
      }
      void expires;
      store.set(name, value, rest);
    },
  };
}
