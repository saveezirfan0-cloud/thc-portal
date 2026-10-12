# ADR-0113 · The current password before bank details, Request my P45 and a new email

**Status:** Accepted · Deviates from `wireframes/staff/profile.html` and `onboarding-3.html` (one field) · §2.10, §10.1, §10.6 · Security round 12.10.2026, item 1 · DB side: `20261012120900`

## Context

A phone that is still signed in to the Staff App — left unlocked, or stolen — could, with nothing else:

- point the worker's next pay at another account (Profile → Payment information → Bank & payroll; E5 tells payroll a change happened, not that it was wrong);
- request their P45, which ends their work with THC, releases every future booking and withdraws their invitations (§10.6);
- move the account's email to an address someone else reads, after which "Forgot password" hands over the rest.

Security settings → Change password already asked for the current password (§10.1, audit D52); these three did not. The wireframes show no password on any of them.

## Decision

- **Each of the three asks for the current password, and the server re-checks it immediately before the write**: `signInWithPassword` with the SESSION's address (never one the browser sent) and the typed password — the step `changePassword` has always made — then the write on the same client. Shared helper: `apps/staff/app/_lib/reauth.ts`. A wrong password writes nothing and reads "That current password isn't right." (Security settings' line).
- **The database enforces it too** (`20261012120900`): `staff_save_bank()` and `request_my_p45()` raise `reauth_required` unless the token's `amr` holds a `password`, `otp` or `recovery` sign-in from the last ten minutes. The fresh sign-in satisfies it; the app maps `reauth_required` to "For your security, please enter your current password again." Email change is Supabase Auth's (`updateUser({ email })`), so its re-check is the app's alone.
- **One field, the same everywhere**: `CurrentPasswordField` ("Current password", `autocomplete="current-password"`) — the Security screen's own field, now shared. It sits above Save changes on Bank & payroll, under the new address on the email change, and in the second "Are you sure? This can't be undone from the app" step of Request my P45. Each button stays disabled until a password is typed.
- **The wizard's step 9 asks too.** `onboarding_save_bank()` saves through `staff_save_bank()`, so the candidate types the password they set at activation before Continue. The hint says why ("to keep your pay safe").
- **No enumeration on email change.** An address already on another account gets the same "We sent a 6-digit code…" answer as a free one; the code simply never arrives. Any other Auth refusal is the generic "That didn't go through. Please try again." (logged on the server), and a rate limit says to wait.

## Consequences

- One more field on three screens and one wizard step than the wireframes draw. Everything else on those screens — labels, order, the P45 two-step with Cancel as the primary action — is unchanged.
- A worker who has forgotten their password uses "Forgot password" first; the `recovery` sign-in that leaves them with also satisfies the ten-minute rule.
- `e2e/tests/staff.profile-requests.spec.ts` must type the password in the second P45 step before pressing "Request my P45".
