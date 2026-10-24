# ADR-0207 · Send password reset from the Back Office

**Status:** Accepted (ticket TK-4, reported by Sam Barrington-Wells, 24.10.2026). An addition to §2.7; nothing in the scope changes.

## Context

"Resend activation link" (§2.7, ADR-0021) is offered only until the person sets a password: after that the database refuses it (`already_activated`) and the button is not drawn. That is right — a fresh activation token for a live account would be pointless — but it left the office with nothing to offer once a worker had activated.

TK-4: a candidate said his activation link had expired, and the office could find no way to send another. He had in fact activated that morning (password set at 09:02 UK) — the "expired" page came from an older activation email, or from opening the used link a second time. His way back in was the Staff App's own **Forgot password?**, but nothing on his profile said so, and the office could not send it for him.

## Decision

- **Send password reset** on the onboarding card (`/onboarding/:id`) and the staff profile (`/staff/:id`), for someone accepted who **has** activated — exactly the people Resend activation link is not offered to (`canSendPasswordReset`; never both buttons at once).
- It sends the Staff App's own password-reset email — Supabase Auth's recovery mail, the one `/forgot` sends — landing on the Staff App's `/auth/confirm`, so the worker chooses a new password there.
- `onboarding_password_reset_request(p_staff)` decides first: office logins that may write (`assert_office_caller()`, a viewer refused `read_only`, ADR-0060); refuses `unknown_staff`, `not_accepted`, `not_resendable` (rejected, inactive), `not_activated` (use Resend activation link) and `reset_too_soon` (once per 10 minutes per person); audited as `onboarding_password_reset` against the manager; answers with the **login** address from `auth.users`, never one taken from the screen.
- The send itself is GoTrue's `/recover` from the server action, under the same `'recover'` counter as `/forgot` (3 an hour per address). The service-role client is used only because it keeps no session.

## Consequences

- One more `SECURITY DEFINER` reachable by `authenticated` (239), pinned by `892` and tested by `938`.
- The worker can still reset it themselves from the Staff App sign-in page; this is for when they cannot or the office is on the phone with them.
