# ADR-0213 · "Not needed — graduated" on a Term Dates Letter

**Status:** Accepted (ticket TK-19, Sam Barrington-Wells, 24.10.2026: "What do we do with Rajavardhan's Term Date Letter in compliance? He has graduated"). Builds on ADR-0112 and ADR-0211.

## Context

A graduate needs no University Term Dates Letter (ADR-0112). When the office approves their Completion Letter, `approve_completion_letter()` supersedes a pending or rejected term letter on its own.

Some graduates upload a term letter anyway. One did on 24.10.2026, after his first completion "letter" (a certificate) was rejected. Until a Completion Letter is approved, the office had two bad choices for that term letter:

- **Verify it.** It is evidence of nothing for a graduate, and was last year's letter.
- **Reject it.** N8 then asks the worker to upload a Term Dates Letter again, which is the wrong document.

So the letter sat on Needs review.

## Decision

- A term letter row on Needs review carries **Not needed — graduated** when the worker has told us of a course completion date that has passed. That date is read off any of their Completion Letters, as the office confirmed it or as the worker claimed it, and must be today or earlier, UK.
- The button opens a confirm: "They have told us their course was completed on …".
- `compliance_set_aside_term_letter(doc)` (`20261027130000`):
  - Callers: office logins that may write. A viewer is refused.
  - Takes a pending or rejected term letter only.
  - Refuses `no_graduation` without such a date.
  - The letter becomes `superseded`. **No message is sent to the worker.** Audited as `term_letter.set_aside`.
- What the worker sees: a superseded letter is no longer current, so the Staff App's term letter row falls back to the Completion Letter.
  - "Covered by your Completion Letter" while it is pending.
  - "Not needed if you've graduated — upload a new Completion Letter" while it is rejected (ADR-0211).

## Consequences

- Nothing about the weekly cap moves. RULE-20 reads verified documents and the completion date on a verified Completion Letter, never a claim.
- Until a Completion Letter is approved, the worker's onboarding gate still has no term evidence. They stay in Documents, as ADR-0112 already says of a graduate whose letter is not yet approved.
- A worker who claimed a date, but whose course is in fact not over, can still upload a term letter from the app ("Upload instead").
