# ADR-0013 · "Additional info" is a kanban column, not a staff status

**Status:** Accepted, 23.09.2026. Implemented in
`supabase/migrations/20260923110000_onboarding_pipeline.sql` (the row guard) and
`apps/office/app/onboarding/view-model.ts` (`columnFor`). Recorded because the board and
the state machine have different shapes, and a reader who notices that the database enum
carries an `additional_info` value nobody uses deserves to know it is deliberate.

## Context

Two statements in the scope, both explicit:

- §2.2 and §2.7: the onboarding kanban has **six** columns — Interview requested →
  Interview completed → Documents → Quiz → Additional info → Contract — "confirmed
  against the approved 'Onboarding / Kanban / Active' design".
- §2.12: the state machine is `interview_requested → interview_completed → documents →
  quiz → contract → compliant`. **Five** onboarding states. Quiz goes straight to
  contract.

`0001_init.sql` reserved `additional_info` in the `staff_status` enum.
`packages/domain/src/state.ts` (the TypeScript machine) and the `staff_transitions` table
(20260921180312) both follow §2.12 and have no edge into or out of it.

The wizard order (§2.8) explains the column: after the quiz (step 6) the candidate does
the HMRC checklist (7), two references (8) and bank details (9), and only then the
contract (10). The board's fifth column is where people doing steps 7–9 are.

## Decision

Keep §2.12's machine exactly as written. A candidate who has passed the quiz is in
status `contract`. The board places them:

- under **Additional info** while any of the HMRC checklist, two references or bank
  details is missing (NI is optional, §2.8, and does not hold a card back);
- under **Contract** once all three are in.

The `additional_info` enum value stays unused. Postgres cannot drop an enum value cheaply
and nothing reads it; the row guard (`staff_status_guard`) refuses any move into or out
of it, because it is not an edge of `staff_transitions`, so it cannot start being used by
accident.

## Consequences

- One machine, one set of transitions, and the §2.12 wording holds: "a candidate can never
  skip the quiz or the contract" needs no special case for a sixth state.
- The column is derived from data the office already reads (`hmrc_checklists`,
  `staff_references`, `bank_details`), so it moves the moment the worker saves step 9 —
  no status write is needed from the wizard.
- If THC ever wants a hard gate between steps 9 and 10 (the contract refused until the
  additional info is complete), it belongs in the wizard's contract RPC or as an evidence
  check on `contract → compliant` in the row guard — not as a new status.
- Whoever builds the wizard (S2) must not set `status = 'additional_info'`; the database
  will refuse it.
