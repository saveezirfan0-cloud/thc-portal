# ADR-0115 · Client Portal sign-in hardening: recovery-only /reset, atomic password-check limit, sign-in and reset-email throttles

**Status:** Accepted (12.10.2026) · Builds on ADR-0024, ADR-0032, ADR-0051 · **§1.4, §1.7, §10.2, §11.1**
**Code:** `supabase/migrations/20261012120000_client_feedback_limits.sql`, `20261012120100_office_only_payroll_flag_and_client_session.sql`, `20261012120200_client_auth_throttles.sql`; `apps/client/app/auth/throttle.ts`, `apps/client/app/{login,forgot,reset}/actions.ts`, `apps/client/app/reset/recovery.ts`, `apps/client/app/client/account/actions.ts`, `apps/client/middleware.ts`, `apps/client/next.config.ts`; the same /reset rule in `apps/office/app/reset/` (`recovery.ts`, read by both `page.tsx` and `actions.ts`) and `apps/staff/app/reset/` · **Tests:** pgTAP `786_client_auth_throttle.sql`, `787_password_check_begin.sql`, `788_client_session_and_payroll_flag.sql`, additions to `020`, `160`, `756`; Vitest under `apps/client/app/**/__tests__/`, `apps/{office,staff}/app/reset/__tests__/`

## Context

The 12.10 security review of the Client Portal found that:

1. `/reset` changed the password for **any** signed-in session, with no current password and no limit, which bypassed Change password (ADR-0051) entirely. The office and staff `/reset` had the same hole.
2. Change password ran `updateUser` on the device's own session. With `secure_password_change = true`, Supabase refuses that from a session over 24 hours old, so it failed for everybody who ticked "Keep me signed in". Its per-account limit was check-then-record, and it counted any 400 as a wrong password.
3. `/login` and `/forgot` had no per-account or per-caller limit. All of the portal's Auth traffic leaves from Vercel's addresses, so Supabase's per-IP limits bind every customer at once.

## Decision

**1. `/reset` accepts only a reset-link session.** The access token's `amr` claim (read through `getClaims()`, which verifies the token) must contain `recovery` or `otp` from within the last hour. Any other signed-in session gets a sentence pointing to Change password, on the page and from the action, and `updateUser` is never called. In the Client Portal the old "sign out a non-client after the reset" branch could never run (the middleware gives a non-client the wrong-app page on every path), so it is removed and the role is checked **before** anything changes. The role gate is unchanged: letting a non-client's recovery session through would let a Back Office login's password be reset from the customer app, outside its own two-step flow.

**2. Change password runs on the freshly verified session.** The current password is checked on a cookie-less client, as before. The device then adopts that new session (`setSession` on the cookie-bound client, so ADR-0032's lifetime holds), the change runs on it, and `signOut({ scope: 'others' })` is sent from it, so the device stays signed in and every other session ends. If the device cannot adopt the session, nothing changes. A success whose sign-out of the other devices failed returns `ok: true, tone: 'warning'`.

The attempt is claimed and counted in one call, `password_check_begin()`, under a per-account advisory lock. Only Supabase's "invalid credentials" answer leaves the attempt counted. A correct password, Supabase's own rate limit or any other failure releases it (`password_check_release`). The older two functions stay for one release.

**3. `/login` and `/forgot` take a slot before Supabase is asked.** The limits are `settings.auth_throttle`: sign-in allows 10 per email and 30 per caller in 15 minutes, and reset emails allow 3 per email and 10 per caller per hour. The keys are HMAC-SHA256 digests of the lower-cased email and of the first-hop address (IPv6 by /64), made in the app under `SUPABASE_SERVICE_ROLE_KEY`. Only digests are stored, in `private.auth_attempt_hits`, for a day. A throttled attempt reads "Too many attempts. Wait a few minutes and try again." and says nothing about the account. `[auth.email] max_frequency` is 60 s.

`auth_attempt_take()` is **service role only**, like `/apply`'s limit (ADR-0024), not callable by anon. If anybody could send a digest, anybody could fill the limit for somebody else, for example to lock a venue's office address out. It would also add a third anon-reachable definer, which 190 2e refuses. The Client Portal already holds the service key (docs/16).

**When the throttle cannot run** (no service key, or the call fails), sign-in and reset **carry on**, and the reason is logged with `console.error`. This is deliberate, and matches `/apply` with a missing salt. The throttle is defence in depth in front of Supabase Auth, which still checks the password and still applies its own limits. Failing closed would turn one missing environment variable into every customer locked out of both sign-in and password reset. Change password's own limit does fail closed, because it needs no extra configuration.

## Also in this round

- `submit_client_feedback` caps a comment at 2000 characters and refuses a removed worker or a cancelled event. A `feedback_text_len` check holds the cap on client rows only, because office notes have never been capped.
- `booking_payroll_exported()` answers only an office login, the service role or a connection with no JWT.
- `current_app_role()` makes a client token useless once its session is gone, as for the admin.
- The middleware keeps the query string in `next`, sends a signed-in customer on `/login` to `/client`, and writes refreshed auth cookies `httpOnly`. The Client Portal has no browser Supabase client, so the server client does the same through `THC_AUTH_COOKIE_HTTP_ONLY`.
- The address on `/forgot/sent` comes from an httpOnly flash cookie scoped to that path, not `?to=`, and it is shown only if it reads as an email.
- Every response sends `X-Frame-Options: DENY`, a CSP of `frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'`, `Referrer-Policy: same-origin`, a `Permissions-Policy` that denies camera, microphone and geolocation, and `nosniff`. A script/style CSP needs a per-request nonce and is not attempted here.

## Consequences

- A customer who is signed in and has forgotten their password signs out and uses "Forgot password". `/reset` no longer serves them.
- On every app, a signed-in session that a reset link did not make sees "You’re already signed in" on `/reset`, with a button to its own password screen (Client Portal `/client/account`, Back Office `/account`, Staff App `/profile/security`), instead of the form.
- **Accepted trade-off: the per-email sign-in limit can be used to keep somebody out.** Anyone who knows a contact's email can post 10 wrong passwords for it every 15 minutes and so keep that contact out of `/login` for as long as they keep it up. The limit is keyed on the email on purpose: credential stuffing and password guessing spread across many addresses (a botnet) get past any per-caller limit, Supabase's per-IP limits cannot tell one Vercel caller from another, and only a per-email limit bounds the guesses any one account can receive. It is accepted because the harm is bounded: nothing is learned about the password, the account and its data are untouched, "Forgot password" still works (it has its own, separate `reset` counter) and so does a session that is already signed in, the lock lifts by itself within 15 minutes once the attempts stop (a refused attempt is not counted), and THC can lift it at once. To lift it, run in the SQL editor (it releases every email's sign-in counter, which costs nothing):

  ```sql
  delete from private.auth_attempt_hits where action = 'login' and key_kind = 'email';
  ```

  To release one contact only, the key is the digest the app makes, `encode(extensions.hmac('thc-client-auth-throttle|email|' || lower('<email>'), '<SUPABASE_SERVICE_ROLE_KEY>', 'sha256'), 'hex')`. That puts the service key into a query, so the blanket line above is preferred. If the lock is being used against somebody, raise `settings.auth_throttle.login.per_email` for a while.
- The hosted Auth settings need `max_frequency` raised to 60 s by hand, as for every other `config.toml` Auth value.
- `packages/db/src/types.generated.ts` does not yet know the three new RPCs. The callers use narrow local types until `gen:types` runs against a live project.
