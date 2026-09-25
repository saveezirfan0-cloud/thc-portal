# ADR-0032 · "Keep me signed in on this device"

**Status:** Accepted · **Wireframes:** `wireframes/backoffice/login.html:39`, `wireframes/client/login.html:65,85,126` · **§1.3, §1.4, §10.2**

## Context

Both email + password sign-in screens draw a checkbox, "Keep me signed in on this device", ticked. The Back Office note says it "only lengthens the token lifetime on this device", and the Client Portal note lists its duration as an assumption to confirm. The Staff App's sign-in (`wireframes/staff/auth.html`) has no such box. Its install sheet says "Sign in once — you'll stay signed in".

Supabase keeps a session alive with its refresh token. What decides whether a session outlives the browser is the lifetime of the `sb-*-auth-token` cookies, and `@supabase/ssr` gives them a 400-day `Max-Age` on every write. They are written in four places: the login server action, route handlers (`/auth/callback` code exchange), each app's middleware (token refresh on almost every request), and the browser client (a page left open, such as the check-in monitor, refreshes its token from JavaScript). If any one of these writers ignored the choice, it would restore the 400 days on the next refresh.

## Decision

1. **Ticked (the default):** the auth cookies are persistent with `Max-Age` = `KEEP_SIGNED_IN_MAX_AGE` = **30 days**. Every refresh rewrites them, so the window slides: a device that uses the app at least once a month stays signed in. 30 days rather than the library's 400 because the Back Office holds pay and personal data.
2. **Unticked:** the auth cookies are session cookies (no `Max-Age`, no `Expires`), so closing the browser ends the session.
3. **Remembered** in one first-party cookie, `thc-keep-signed-in` (`1` / `0`, `Secure`, `SameSite=Lax`, `Path=/`). The login action writes it after a successful sign-in, and sign-out deletes it. When the box is ticked the cookie lasts 400 days, so it outlives the sliding auth cookies it governs. When the box is unticked it is itself a session cookie.
4. **One helper, every writer.** `withSessionPersistence` in `packages/db/src/session.ts` wraps the cookie methods of `createClient` in `@thc/db/server`, `createClient` in `@thc/db/browser`, and the `createServerClient` call in all three middlewares. Deletions (`maxAge: 0`, empty value) pass through untouched. The login action passes the box's value explicitly, because its own sign-in writes happen before the preference cookie exists.
5. **Apps:** Back Office and Client Portal get the box. The **Staff App** does not, because its wireframe has none. Staff never sets the preference, so with no preference cookie the library's options pass through unchanged and a worker stays signed in as before. Staff's middleware and clients still go through the helper, so adding the box there later would take only the form.

## Deviation from the brief

The brief asked for an `httpOnly` preference cookie. That setting is **not** used. The browser client is one of the writers that must read the preference, and an `httpOnly` cookie is invisible to it. With `httpOnly`, the check-in monitor's in-page refresh would make a "session only" sign-in persistent again. The cookie holds one bit that can only shorten a session. It sits beside auth cookies that `@supabase/ssr` already makes readable from JavaScript, so hiding it from scripts would protect nothing.

## Known limits

- Browsers that restore the previous session ("Continue where you left off" in Chrome and Edge, and Firefox session restore) also restore session cookies. On those browsers, unticked means "until the browser's session is really cleared". This is how browsers behave and nothing in the app can change it.
- Unticking the box ends the session only on this device. It does not revoke the refresh token on the server. Sign-out still does that.
- Sessions from before this change have no preference cookie. They keep the library default until their next sign-in.
