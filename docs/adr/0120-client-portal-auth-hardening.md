# ADR-0120 · Client Portal sign-in: what the Client Portal adds on top of the 12.10 security round

**Status:** Accepted (12.10.2026, renumbered and cut down 13.10.2026 when merged after PR #209) · Builds on ADR-0032, ADR-0051, ADR-0115 · **§1.4, §1.7, §3.3, §10.2, §11.1, §11.2, §11.5**
**Code:** `supabase/migrations/20261013100000_client_feedback_cancelled_event_and_removed_worker.sql`, `20261013100100_client_token_needs_its_session.sql`, `20261013100200_password_check_claimed_atomically.sql`; `apps/client/app/client/account/actions.ts`, `apps/client/app/client/events/[id]/actions.ts`, `apps/client/app/{login,reset}/actions.ts`, `apps/client/app/reset/page.tsx`, `apps/client/middleware.ts`, `apps/client/next.config.ts`, `packages/db/src/server.ts`, `supabase/config.toml` · **Tests:** pgTAP `810_client_feedback_cancelled_and_removed.sql`, `807_client_token_needs_its_session.sql`, `808_password_check_claimed_atomically.sql`, `756` (updated); Vitest `apps/client/app/client/__tests__/{account-password,feedback-action,password-form}.test.*`, `apps/client/app/reset/__tests__/reset-extras.test.tsx`, `apps/client/app/__tests__/{middleware-gate,http-only-cookies}.test.ts`, `packages/db/src/__tests__/server-http-only.test.ts`

## Context

The Client Portal's own review of 12.10 and the five-way security audit merged the same day as PR #209 found many of the same things. PR #209 landed first, so its answers stand and are not repeated here:

- `/reset` takes only a reset link opened in the last 15 minutes, behind a Continue page (ADR-0115);
- sign-in, two-step code and "forgot password" are limited per account and per address (`20261012121000`, `packages/db/src/auth-throttle.ts`, ADR-0051 §25);
- the security headers come from `packages/db/src/security-headers.ts`, and auth cookies are `Secure` on Vercel;
- `booking_payroll_exported()` answers the office only (`20261012120300`);
- a client's feedback comment is at most 2,000 characters (`20261012120600`);
- `/forgot/sent` prints `?to=` only when it reads as one email address (`shownEmail`).

This ADR records the rest: what the Client Portal round found that #209 did not do.

## Decision

**1. Change password runs on a session that is minutes old.** With `secure_password_change = true`, Supabase refuses a password change from a session over 24 hours old, so Change password failed for everybody who ticked "Keep me signed in" (ADR-0032). The current password is still checked on a cookie-less client against the SESSION's email. The device then adopts that brand-new session (`setSession` on the cookie-bound client, so ADR-0032's lifetime holds), the change runs on it, and `signOut({ scope: 'others' })` is sent from it. The device stays signed in and every other session ends. If the device cannot adopt the session, nothing changes. A success whose sign-out of the other devices failed returns `ok: true, tone: 'warning'`.

**2. The Change password limit is claimed and counted in one call.** `password_check_begin()` (`20261013100200`) takes a per-account advisory lock, counts the account's rows in `private.password_check_failures` (5 per 15 minutes, as before), and writes one for this attempt before the password is checked. Parallel POSTs therefore cannot all read "allowed". Only Supabase's "invalid credentials" answer leaves the attempt counted. A right password, Supabase's own rate limit or any other failure releases it (`password_check_release`). It is the existing limit made atomic, not a second throttle. The sign-in counters of `20261012121000` keep their own check-then-record residual, which that migration names.

**3. A client token dies with its sign-in session.** `20261001204000` and `20261012120400` hold a Back Office and a Staff App token to `auth.sessions`. `20261013100100` does the same for a client: after "sign out every other device", a password reset or an office switch-off, a stolen client cookie stops reading the customer's line-ups at once, not at the token's `exp`. The body is `20261012120400`'s, still plpgsql (the plan cache of `20261012120000`). The session clause now applies to every role.

**4. No feedback on a cancelled event or a removed worker.** `submit_client_feedback()` (`20261013100000`, from `20261012120600`'s body) adds `e.cancelled_at is null` to the lookup. A cancelled event therefore gets the same single refusal as an unknown or foreign booking. The function also refuses a GDPR-removed worker (§1.7) with the office's own sentence, which the portal maps to "This person is no longer on our books, so feedback can no longer be left for them."

**5. The sign-in surface.**
- The middleware keeps the query string in `next`. A lapse on `/client/events/:id/document?kind=signout` therefore comes back to the sign-out copy, not the default. It also sends a signed-in customer on `/login` to `/client`.
- The auth cookies are written `httpOnly`. The Client Portal has no browser Supabase client, so no script needs the tokens. The middleware does this on its token refresh, and the server client does it through `THC_AUTH_COOKIE_HTTP_ONLY=1`, set in `next.config.ts` and read by `packages/db/src/server.ts`. The Back Office and the Staff App keep readable cookies, because both have browser clients.
- Supabase Auth's own 429 on `/login` reads "Too many attempts. Wait a few minutes and try again." That limit is per address and shared by every customer on Vercel, so the message says nothing about the account. The per-account limit (#209) still answers with the wrong-password sentence.
- `/reset` refuses another app's login before anything changes. A Back Office password reset from the customer app would sit outside its own two-step flow. A link cut short (`?error=missing`) says "This link is incomplete", not "expired". The same password again reads as such.
- `[auth.email] max_frequency` is 60 s, so a "Send it again" pressed twice does not mail twice. The hosted project needs the same value set by hand (OWNER-TODO §10).

## Consequences

- One more database round trip on Change password: begin, then release on a right password.
- A Client Portal tab whose session another device ended shows the signed-out state on its next request rather than up to an hour later.
- `packages/db/src/types.generated.ts` carries `password_check_begin` / `password_check_release` and the view columns by hand until `gen:types` runs against the live project (OWNER-TODO §10).
