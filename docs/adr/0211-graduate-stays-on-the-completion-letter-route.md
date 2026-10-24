# ADR-0211 · A rejected Completion Letter keeps a graduate on the Completion Letter route

**Status:** Accepted (ticket TK-17, reported by Sam Barrington-Wells, 24.10.2026). Amends ADR-0112's Staff App rows; no database change.

## Context

ADR-0112 lets a graduate upload an Official University Completion Letter instead of a University Term Dates Letter: while the Completion Letter is pending or approved, the Term Dates Letter row reads "Covered by your Completion Letter" / "Not needed".

`requirementRows()` dropped that stand-in as soon as the Completion Letter was **rejected**. On 24.10.2026 the office rejected a candidate's completion "letter" because it was a degree certificate. His review hub then showed the Term Dates Letter as **Missing** with a primary **Re-upload** button, above the rejected Completion Letter's own Re-upload. He did both: an old term letter (every date on it already passed) and a new completion letter. The office asked why a graduate was being asked for a term letter at all.

## Decision

- A rejected Completion Letter with **no term letter beside it** keeps the row on the graduate's route (`viaCompletionLetter`, the rejected letter as its `doc`).
- That row, in step 4 and in the review hub, reads: "Not needed if you've graduated — upload a new Completion Letter below. Haven't graduated yet? Upload your Term Dates Letter instead." Its only control is a quiet **Upload instead** link, for the student who is in fact still in term. The Completion Letter's own row keeps the rejection reason and its **Re-upload** button.
- Submit still waits: the row's doc is rejected, so `allUploaded()` is false, matching `onboarding_documents_missing()` / `onboarding_submit_documents()` (a rejected Completion Letter answers nothing in the database).
- A rejected term letter beside a rejected Completion Letter is unchanged: the row is the term letter, as before.

## Consequences

- No database, notification or Back Office change. When the office approves a graduate's Completion Letter (course already completed), `approve_completion_letter()` already supersedes a pending or rejected term letter (ADR-0112), so a term letter uploaded by mistake leaves the review queue on its own.
- The wireframe (`staff/onboarding-1.html`) has no such row state; this ADR is the deviation record, as ADR-0112 is for the others.
