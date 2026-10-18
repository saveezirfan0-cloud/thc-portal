# ADR-0157 · Forgot password tells you when the hour's three links are used

**Status:** Accepted · Scope §1.7, §10.2 · **Owner request:** 18.10.2026 · Amends the forgot-password rule in ADR-0051 §25

## Context

A worker may ask for three reset links an hour per address (`private.auth_attempts`, kind `recover`, ADR-0051 §25). The fourth request was answered exactly like the first: the "Check your inbox" screen, with no email behind it. That was deliberate (§1.7: nothing the form says may reveal whether an address has an account).

It cost us on 18.10.2026. A worker who had been sent the wrong app's link, and then reset a few times, used the three. He pressed Forgot password again, saw "Check your inbox", and waited for an email that was never coming. The office was told "nothing has come through" and could not tell why.

## Decision

- **Over the limit, the form says so**, in all three apps (Staff App, Back Office, Client Portal): _"You've asked for a reset link too many times. Please wait an hour before trying again. If you asked earlier, check your inbox and your spam folder."_ It is shown where an error already goes: under the heading on A1, and under Resend on the Staff App's A2.
- **Nothing is sent and nothing redirects.** The worker stays on the form.
- **No account is revealed.** `recoveryRequestAllowed` counts every address typed into the form _before_ any account is looked up, so an address with no account reaches the same limit after the same three requests and gets the same words. The message does not say a link "was sent" or "we have sent you", because for an address with no account none was; "if you asked earlier" is true of both.
- **The wait is stated as an hour**, the window's length. The real wait is until the oldest of the three requests is an hour old, so it can be shorter; "an hour" is the safe upper bound and avoids showing a countdown that would tell an observer when an address was last used.

## Not changed

- The limit (3 an hour), what counts, and fail-open on a database error.
- The first three requests still redirect to "Check your inbox", unchanged and wireframe-conformant.
- Sign-in and the Back Office code step keep answering a lockout like a wrong password / wrong code (§1.7): those would say whether the account exists. Only the reset form changes, because its count is not tied to an account.

## Consequences

- A person can learn that a given address has been requested three times in the hour. That is not a fact about an account and the same is true of any address.
- The wireframes (`wireframes/staff/auth.html`, `backoffice/login.html`, `client/login.html`) draw no over-limit state; this is the one added, in the shape the forms already use for an error.
