# ADR-0115 · The reset link opens a Continue page, and /reset takes only a fresh recovery

**Status:** Accepted · Adds a screen between A2 and A3 in all three apps (`backoffice/login.html`, `staff/auth.html`, `client/login.html` → `public/activate.html`) · §1.4, §1.7, §2.3, §2.7, §10.2 · Security round 12.10.2026 · Amends ADR-0039 ("Known limit")

## Context

The security round found four things about the sign-in surface that the wireframes do not draw:

1. **The reset link was spent on GET.** `/auth/confirm?token_hash=…` verified the token as soon as it was opened. Mail scanners and link previews open every link first, so a real reset could arrive already burned. A link carrying someone else's token also signed the victim's browser into the sender's account. ADR-0039 named the scanner case and left an interstitial "for THC to ask for".
2. **`/reset` accepted any signed-in session.** Someone at a laptop left signed in could open `/reset` and set a new password without the current one. That skips the current-password check on Change password, and its throttle (ADR-0051).
3. **`activation_preview` answered for a recovery token** as well as an activation token, with no expiry.
4. **Onboarding step 2 saved a home pin the browser chose**, and the proximity score (§3.4, 25 %) trusted it.

## Decision

- **`GET /auth/confirm` spends nothing.** A `token_hash` link answers 303 to `/auth/confirm/continue`: one card, heading "Reset your password", one Continue button. The button posts to a server action that runs `verifyOtp`, then goes on to `/reset`. Next checks the Origin of every server-action post, which closes the login-CSRF case. The page sends no Referer. The PKCE `code` path, `/activate` and the invite links are unchanged.
- **`/reset` takes only a recovery that is under 15 minutes old.** The verified token's `amr` must hold an `otp` or `recovery` entry from the last 15 minutes (`packages/db/src/recovery.ts`). A session signed in with a password gets the link-expired card plus one line naming the app's own change-password screen; `setPassword` refuses the same way and never calls `updateUser`. The form names the account it is changing: "Setting a new password for <email>."
- **`activation_preview` matches activation tokens only**, and treats one sent more than 24 hours ago as unknown (`20261012120500`). A returning applicant's magic-link activation therefore loses the "Welcome, {name}" greeting and the "You're already activated" screen. The form itself still works.
- **The step 2 home pin is checked against the postcode on the server.** The pin is saved only through `onboarding_save_address_geocoded` (service role, `20261012121400`), and only when it is within 5 km of the postcode's centroid. If postcodes.io cannot place the postcode, or is down, the step says to try again rather than save an unchecked point.

## Consequences

- One more tap on every reset: email → Continue → set the password. `docs/08` lists the screen in all three apps.
- A reset link has to be finished within 15 minutes of pressing Continue. After that the person requests a new one, as they would for an expired link.
- A candidate whose postcode postcodes.io does not know cannot finish step 2 until it does. Such a postcode is rare; the office can enter the address on the staff profile instead.
