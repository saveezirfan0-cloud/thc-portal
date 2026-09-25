# ADR-0032 · "Keep me signed in on this device"

**Status:** Accepted · **Wireframes:** `wireframes/backoffice/login.html:39`, `wireframes/client/login.html:65,85,126` · **§1.3, §1.4, §10.2**

## Context

Both email + password sign-in screens draw a checkbox, "Keep me signed in on this device", ticked. The Back Office note says it "only lengthens the token lifetime on this device", and the Client Portal note lists its duration as an assumption to confirm. The Staff App's sign-in (`wireframes/staff/auth.html`) has no such box. Its install sheet says "Sign in once — you'll stay signed in".

Supabase keeps a session alive with its refresh token. What decides whether a session outlives the browser is the lifetime of the `sb-*-auth-token` cookies, and `@supabase/ssr` gives them a 400-day `Max-Age` on every write. They are written in four places: the login server action, route handlers (`/auth/callback` code exchange), each app's middleware (token refresh on almost every request), and the browser client (a page left open, such as the check-in monitor, refreshes its token from JavaScript). If any one of these writers ignored the choice, it would restore the 400 days on the next refresh.

## Decision

1. **Ticked (the default):** the auth cookies are persistent with `Max-Age` = `KEEP_SIGNED_IN_MAX_AGE` = **30 days**. Every refresh rewrites them, so the window slides: a device that uses the app at least once a month stays signed in. 30 days rather than the library's 400 because the Back Office holds pay and personal data.
2. **Unticked:** the auth cookies are session cookies (no `Max-Age`, no `Expires`), so closing the browser ends the session.
3. **Remembered** in one first-party cookie, `thc-keep-signed-in` (`1` / `0`, `SameSite=Lax`, `Path=/`, `Secure` in production only so plain-http `next dev` keeps it). The login action writes it after a successful sign-in, and sign-out deletes it. When the box is ticked the cookie lasts 400 days, so it outlives the sliding auth cookies it governs. When the box is unticked it is itself a session cookie.
4. **One helper, every writer.** `withSessionPersistence` in `packages/db/src/session.ts` wraps the cookie methods of `createClient` in `@thc/db/server`, `createClient` in `@thc/db/browser`, and the `createServerClient` call in all three middlewares. Deletions (`maxAge: 0`, empty value) pass through untouched. The login action passes the box's value explicitly, because its own sign-in writes happen before the preference cookie exists.
5. **No preference on the device** — an invite or reset link opened on a fresh device (`/auth/callback`), a session from before this change, a preference cookie that was cleared — takes the app's **fallback**:
   - **Back Office and Client Portal: 30 days**, as if ticked. Never the library's 400 days: the cap in 1 is the point of this ADR.
   - **Staff App: the library's options pass through**, so a worker stays signed in as before.

   The fallback fails safe. Each middleware passes it explicitly (`fallback: 'persistent'` / `fallback: null`). The server and browser client factories have ~60 call sites, so they read a build-time setting instead, `THC_AUTH_COOKIE_FALLBACK`, inlined by `next.config.ts` `env`; unset means 30 days, and only `apps/staff/next.config.ts` sets it (`library`). A lost setting therefore costs a worker a sign-in after a month away, never an admin a 400-day cookie. A caller can still pass `fallback` to either factory.
6. **Apps:** Back Office and Client Portal get the box. The **Staff App** does not, because its wireframe has none, and never sets the preference. Staff's middleware and clients still go through the helper, so adding the box there later would take only the form.
7. **Legacy marker, one release only.** #65 shipped the Client Portal's box with its own marker, `thc-session-only` (present = unticked; a session cookie, `httpOnly`, `Path=/`). Browsers that signed in unticked before this change still carry it until they close. While it is present and `thc-keep-signed-in` is not, it reads as **session only**, so the first refresh after the deploy does not turn those sessions into 30-day ones. The Client Portal's login action and sign-out delete it. **Remove** `LEGACY_SESSION_ONLY_COOKIE`, its reader in `readSessionPersistence`, `clearLegacySessionOnlyCookie` and those two calls in the release after this one: by then every browser that had it has closed. Being `httpOnly` it is invisible to the browser client, which the Client Portal does not use.

## Deviation from the brief

The brief asked for an `httpOnly` preference cookie. That setting is **not** used. The browser client is one of the writers that must read the preference, and an `httpOnly` cookie is invisible to it. With `httpOnly`, the check-in monitor's in-page refresh would make a "session only" sign-in persistent again. What a script that can write the cookie gains is bounded: flipping it moves the auth cookies' lifetime between browser-session and 30 days — `0 → 1` does lengthen a session-only sign-in to 30 days — and both are at or below the library's 400-day default. It carries no identity and no privilege. Anything that can write it (XSS) can already read the `sb-*` tokens themselves, which `@supabase/ssr` makes readable from JavaScript, so hiding the preference from scripts would protect nothing.

## Known limits

- Browsers that restore the previous session ("Continue where you left off" in Chrome and Edge, and Firefox session restore) also restore session cookies. On those browsers, unticked means "until the browser's session is really cleared". This is how browsers behave and nothing in the app can change it.
- Unticking the box ends the session only on this device. It does not revoke the refresh token on the server. Sign-out still does that.
- Sessions from before this change have no preference cookie. In the Back Office and Client Portal the first refresh after the deploy gives them the 30-day fallback (or, on the Client Portal, session-only if they carry #65's marker); they meet the checkbox at their next sign-in.
