# ADR-0037 · Two-step sign-in (TOTP) for Back Office logins

**Status:** Accepted · **Wireframes:** none (the code step reuses the sign-in card, `AuthCard`; the `/account` panel reuses the Back Office's Panel, form and pill language) · **§1.4, §10.2** · builds on ADR-0032 (Keep me signed in) and ADR-0035 (My profile)

## Context

A Back Office login reaches pay, bank details, right-to-work documents and every worker's personal data. §1.4 asks for email and password, and nothing more, so a leaked or reused password is the whole of the defence. The scope does not mention a second factor. This ADR adds one as an opt-in on top of §1.4, and changes nothing §1.4 describes.

Supabase Auth has TOTP multi-factor built in. `enroll` returns a QR code (an SVG data URI) and the secret, and `challenge` + `verify` checks a 6-digit code and raises the session from `aal1` (password) to `aal2` (password and code). No table or migration of ours is involved.

## Decision

1. **Opt-in per login, from `/account`.** A "Two-step sign-in" panel has three states. When it is **off**, it says what two-step does and which app to install, and asks what the phone is called. **Setting up** shows the QR code and the key for typing by hand (in groups of four), then asks for the first code. Only that first correct code turns it on. Cancel removes the unfinished factor. When it is **on**, the panel shows the phone's name and the set-up date (UK time, §1.8), and Remove. Remove asks for a fresh code from the phone, then unenrolls the factor. GoTrue also refuses to unenroll a verified factor below aal2. A set-up that was abandoned is cleared the next time Set up is pressed, and Cancel only ever removes an unverified factor, so it is not a way round the fresh code. One authenticator per login. The issuer shown in the app is "THC Back Office".
2. **The code step, `/login/verify`.** After email + password, `signIn` sends a login with a verified factor to `/login/verify`. It does this after the role check and after writing the "Keep me signed in" preference, so the upgraded session's cookies keep this device's choice (ADR-0032). The safe `next` is carried through. The step verifies with `challengeAndVerify` and then lands on `next`. Every rule that existed before is unchanged: the generic refusal for a wrong password or a non-admin, and the `next` guard. A `next` pointing at `/login/**` or `/auth/**` falls back to `/dashboard`, so the step can never be told to redirect to itself. "Not you? Sign out" stays on the card.
3. **Enforcement in `apps/office/middleware.ts`.** After the role gate, an admin session at `aal1` whose login has a verified factor is redirected to `/login/verify?next=<page>` for every non-public path, including pages, server actions posted to them and `/api` routes other than the job routes. The public paths (`/login/**`, `/forgot`, `/reset`, `/auth/**`, `/design-system`) and `POST /auth/signout` stay reachable, so neither the code step nor the way out can loop. The redirect carries any refreshed auth cookies.
   - **Which user record is trusted.** The factor list comes from `getUser()`, which is GoTrue's answer. auth-js's `mfa.getAuthenticatorAssuranceLevel()` without an argument reads `session.user.factors` from the cookie, which the browser can edit. It would let someone delete their factor from the cookie and pass, so it is not used. The `aal` claim is read from the access token that `getUser()` has just had GoTrue accept. An unreadable or missing claim counts as "not aal2", so the gate fails closed. A login with no verified factor never pays for the extra session read.
   - **One rule, used everywhere.** The middleware, the code step's page and its action all call `twoStepDecision()` (`apps/office/app/login/two-step.ts`), so they cannot disagree and bounce a request between them.
4. **Other devices.** A device that was signed in before two-step was switched on still holds an aal1 session. On its next request it is sent to the code step like everyone else.
5. **Configuration.** `supabase/config.toml` now has `[auth.mfa.totp] enroll_enabled = true, verify_enabled = true` for local dev. On the hosted project, TOTP is set under Dashboard → Authentication → Multi-Factor. If it is off there, the panel says "switched off for this project" instead of failing silently.

## Recovery (lost or replaced phone)

Nobody can reset another person's factor from the app today. There is no button on `/users` for it, and the owner cannot do it from `/account` either. On the Supabase project, someone with dashboard access does it:

1. **Confirm who is asking** by a route other than email, such as a call to a number already on file. Someone who holds the password but not the phone is exactly who this feature keeps out.
2. **Remove the factor.** Go to Dashboard → Authentication → Users, open the user, and remove the factor under multi-factor authentication. Where the dashboard version offers no such control, run this in the SQL editor, using the user's id from the same Users page:
   ```sql
   delete from auth.mfa_factors where user_id = '<user id>';
   ```
   The `auth.admin.mfa.deleteFactor({ userId, id })` call with the service key does the same thing.
3. The manager signs in with their password alone and sets two-step up again from `/account`.

A dashboard reset writes no `audit_log` row. Note it by hand until the follow-up below exists.

## Known limits

- **The database does not check aal yet.** RLS asks `current_app_role() = 'admin'`, and `current_app_role()` reads `profiles` only. Someone holding a stolen password can still sign in against GoTrue directly with the public anon key, skipping the Back Office pages, and read through PostgREST at aal1. The middleware keeps a password alone out of the **app**. It does not keep it out of the **data**. Closing that gap takes a migration. `current_app_role()` (or a restrictive policy per table) would refuse `admin` when `auth.jwt()->>'aal' <> 'aal2'` and the user has a verified row in `auth.mfa_factors`. That needs pgTAP for all three roles and a performance check, because every policy calls the helper. It is the same helper change as ADR-0035's "Known limit" (`banned_until`), and the two should land together.
- **Password reset for a login with two-step.** The emailed reset link gives an aal1 session on `/reset` (a public path). After the new password is saved, `/reset` sends the manager to `/dashboard`, and the middleware stops them at the code step, so a reset alone does not get past the code. Depending on the GoTrue version, the password update itself may be refused below aal2 when a factor is verified. If it is, `/reset` shows its generic "could not set that password" message. `/reset` was not in this slice and this was not tested against a live project. The fix, if needed, is for `/reset` to send an aal1-with-factor session through `/login/verify?next=/reset` first.
- **No recovery codes.** GoTrue has a recovery-code API, but it is not enabled or used here. A lost phone means the dashboard reset above.

## Follow-ups

1. **Make it mandatory for every Back Office login.** Add a `settings` key (e.g. `office_two_step_required`, with a start date so managers get notice). While it is on, the middleware sends an admin whose `nextLevel` is `aal1` (no factor yet) to a set-up-only page before anything else, and the database enforcement above changes to "admin requires aal2", with no exception for logins without a factor. Enforcement in the database has to come first. Making the app strict while the data stays reachable at aal1 would only look like protection.
2. **Reset from `/users`.** The owner or another admin removes a manager's factor with the service key (`auth.admin.mfa.deleteFactor`), after an `admin_*` function checks the caller and writes the audit row, following ADR-0035's "the service key mints, the database decides".
3. Recovery codes, once THC decides whether managers should be trusted to keep them.

## Consequences

- New: `apps/office/app/login/two-step.ts` (pure rules), `two-step-session.ts`, `two-step.css`, `login/verify/**`, `account/TwoStepPanel.tsx`, `account/two-step-actions.ts`. Changed: `apps/office/middleware.ts`, `login/actions.ts`, `account/data.ts`, `account/AccountScreen.tsx`, `supabase/config.toml`.
- One new public route, `/login/verify`, under the existing public `/login` prefix. No migration and no new environment variable.
- The Client Portal and Staff App are unchanged. Neither app offers a set-up panel, and neither checks a factor if one was enrolled through the API directly.


## Update — the database half (20260930160000)

Decision 1's gap is closed: `current_app_role()` now answers NULL for a Back Office login that has a verified factor while its session is below `aal2`, so a stolen password plus the public anon key reads nothing through the API either. Client Portal and Staff App logins are unaffected. pgTAP 656 pins it.
