# ADR-0017 · E2b: the rejection email after the interview

**Status:** Accepted, 23.09.2026, **pending THC's sign-off on the wording**.
Implemented in `supabase/migrations/20260923170000_rejection_email_by_stage.sql` and
`packages/notifications/src/templates.ts` (`E2b`, `EXTENSION_CODES`).

## Context

§8 has one rejection email, E2, with THC's wording:

> Thank you for taking the time to complete your interview with The Hospitality
> Company. On this occasion we will not be taking your application further. We wish
> you the very best.

§2.7 calls it "interview rejection" and says it is "the same for every rejection route"
— the routes being the office's Reject button and a rejection in Willo, both at the
interview.

The onboarding board (§2.3) also lets the office reject a candidate **after** the
interview — at Documents, Quiz or Additional info — and §2.12 lets it decline a
returning applicant, who has not been interviewed this time round. B5 sent E2 to both.
For them its first sentence is untrue, and it is the only thing the candidate is told.

## Decision

- E2 is unchanged and still goes for every interview-stage rejection, whichever route.
- A candidate rejected from Documents, Quiz or Additional info, and a returning applicant
  declined, get **E2b**: E2 without the interview —

  > Thank you for the time you have given to your application with The Hospitality
  > Company. On this occasion we will not be taking your application further. We wish
  > you the very best.

- E4 (quiz failed three times) is its own email and is not affected.
- E2b is mandatory, like E2, and never carries the office's reason.
- The register keeps `SCOPE_CODES` equal to §8 exactly; E2b sits in `EXTENSION_CODES`,
  and the test requires every extension to say on its own entry why it exists.

## Consequences

- If THC prefers one email for every stage, E2b's body can be set to E2's and nothing
  else changes; if THC words it differently, only `templates.ts` changes.
- The office's rejection reason is kept on `staff.rejection_reason`. Like
  `block_reason`, a worker can read their own row through `staff_self`, so the reason is
  reachable through the API even though no screen shows it and no email carries it.
  §2.3 keeps it with the office; closing that needs the same narrowed self-view
  `block_reason` does (docs/14 §4).
