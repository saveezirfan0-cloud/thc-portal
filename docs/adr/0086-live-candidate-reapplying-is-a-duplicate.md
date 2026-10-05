# ADR-0086 · A live candidate who applies again is a duplicate, not a Returning applicant

Status: accepted · 05.10.2026 · refines §2.12 / ADR-0027; raise with THC (docs/15)

## Context

- §2.12: a match on an existing record "does not create a second candidate" and is
  routed to the office as a **Returning applicant** card, where the manager presses
  **Reset to candidate** (blocked, rejected or inactive) or rejects the application.
- Candidates and workers share the `staff` table. `submit_application()` matched any
  non-removed row, so a person who submitted `/apply` twice while still in the pipeline
  matched their own candidate row (seen live: a Simon Luciano card sitting above his own
  stalled candidate card). Reset has nothing to act on there, so the card's only action
  was Reject — against the application they had just made — and `/staff`, which lists
  workers only, showed nobody.

## Decision

- A match on a record whose status is `interview_requested`, `interview_completed`,
  `documents`, `quiz`, `additional_info` or `contract` is filed as the new
  `application_outcome` **`duplicate_candidate`**: no second record, the applicant still
  sees the ordinary confirmation, the `applications` row still counts toward the throttle
  and the audit trail, and no card reaches the board.
- Matches on `compliant`, `blocked`, `inactive` and `rejected` stay `returning_applicant`.
- No referral is recorded for a duplicate (`record_application_referral` only counts
  `candidate_created`).
- Cards already on the board for a live candidate are re-filed as `duplicate_candidate`
  by the migration.

## Consequences

- Nothing nudges the office about the second submission; the first candidate's own card
  already carries its Willo / stalled state.
- `120_apply` pins both halves: a live candidate → `duplicate_candidate`, a blocked or
  rejected worker → `returning_applicant`.
