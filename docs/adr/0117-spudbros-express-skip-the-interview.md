# ADR-0117 · SpudBros Express staff skip the Willo interview

**Status:** Accepted · **Refines:** Scope §2.4, ADR-0106, ADR-0107 · **Owner request:** 12.10.2026

## Context
SpudBros Express staff already work for SpudBros, and THC onboards them only for their Right to Work check, documents and contract; THC never books them (ADR-0106). The Willo video interview is THC's hiring screen. Until now they were sent it like any applicant: on 12.10.2026 nine SpudBros Express people sat in **Interview requested** with a Willo invitation they had not started, and one had done the interview. Most had applied through the ordinary `/apply` link and were marked SpudBros by the invite list (ADR-0107), so the link they used made no difference.

## Decision
- **No Willo invitation for SpudBros Express staff.** `willo_invite_due()` never leases a candidate with `spudbros_express`, so nobody is created in Willo for them, E1 is not sent, and OC1 (which needs `willo_invited_at`) does not chase them.
- **They go straight to Documents.** The every-minute `willo-invite` sweep (`/willo-webhook/invite`, also nudged on submit) first leases every SpudBros candidate in `interview_requested` or `interview_completed` (`spudbros_skip_due()`, with the same 5 min-doubling-to-6 h backoff as the Willo lease). It mints their login and personal link with the office Accept's code (`issueActivationLink`), then `spudbros_skip_interview()` links the login, walks `interview_requested → interview_completed → documents`, and queues E3 under the Accept's own key (`E3:staff:<id>:<period>`) in one transaction. `willo_decided_via = 'spudbros'`; `willo_completed_at` is left empty because nobody was interviewed. Audited as `spudbros_interview_skipped`; a failure is `spudbros_skip_failed` and is retried after the backoff.
- **It covers everyone, now and later:** new SpudBros applicants (via either link, or matched by the list), the people already waiting when this shipped, anyone the office marks SpudBros while they await the interview, and a SpudBros worker reset to candidate (§2.12).
- **A SpudBros sweep failure never holds up THC's own Willo invitations:** the Edge Function logs and counts it, then runs the Willo sweep.
- **Back Office:** the board card reads "No interview — SpudBros Express; moving to Documents", and the profile's interview steps show "Interview · not needed" (then "Moved to Documents …") instead of the Willo panel and the "Mark interview complete" override. Someone SpudBros who did a Willo interview before this keeps that record.

## Consequences
- `/apply/spudbros` is public, so anyone using it reaches Documents without an interview. What they reach is an onboarding-only profile: never in the pool, no booking possible (the `bookings` trigger), and still every document, the quiz and the contract. Switching THC shifts on for someone is an office decision about a person it knows.
- The Willo invitations already sent to the nine stay in Willo. If one of them is still accepted or rejected in Willo later, that decision is applied as before (`willo_record_event`): an Accept does nothing to someone already at Documents, and a Reject rejects them.
- pgTAP `805_spudbros_skip_interview.sql`; vitest `packages/db/src/__tests__/spudbros-skip.test.ts`.
