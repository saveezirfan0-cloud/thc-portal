# ADR-0112 · A graduate uploads a Completion Letter instead of a Term Dates Letter

**Status:** Accepted · Amends §2.5 pt 4 · Builds on ADR-0103, ADR-0019 · **Owner request:** 12.10.2026

## Context

§2.5 pt 4 asks every International student for a University Term Dates Letter at onboarding, and §4.5 makes the Official University Completion Letter an optional extra for someone who has graduated. A candidate who had graduated therefore had two bad choices: upload an out-of-date term letter (which the office rightly rejects) or nothing.

On 10.10.2026 a candidate did both things the system invited. Her completion letter was verified (course completed 18.09.2026); her out-of-date term letter was rejected. She stayed in Documents at "3 of 4 verified" for good, because:

- `compliance_blockers()` counted every current document that is not verified, so the rejected term letter held the §2.3 quiz gate shut even though §4.5 says a verified completion letter stops the term letter driving anything (`term_letter_applies()` was already false for her);
- the wizard, `onboarding_documents_missing()` and `onboarding_submit_documents()` all required a term letter, so a graduate could not even press Submit without a letter that no longer exists.

## Decision

For the International student branch:

- **The term-letter requirement is met by a term letter or by a completion letter that has not been rejected** (Submit, `onboarding_documents_missing`). A term letter that is not rejected still wins in the wizard — it is the literal requirement. Upload paths are unchanged: `onboarding_required_docs()` still accepts the term letter only, and the completion letter still goes through `submit_completion_letter()` with its claimed date.
- **An unverified term letter is no blocker once `term_letter_applies()` is false** — the existing rule (a verified completion letter AND a course completion date that has passed, or a worker no longer on the Student branch, §7). A future-dated completion letter keeps the term letter in force, exactly as ADR-0019 and the cap rule have it.
- **A candidate with a completion letter and no term letter stays out of Quiz until that letter is verified and the course has completed**: until then there is no term evidence at all, so the gate says `document_unverified:university_completion_letter`.
- **`approve_completion_letter()` supersedes a pending or rejected term letter** the moment the term letter stops applying, before the flip to verified, so the review queue, the "N of M verified" count and the gate agree, and the §2.3 advance fires in the same step. Superseded, never deleted; a term letter the office had verified is left alone as the evidence it was.
- **One-off:** International-student candidates already in Documents in that state are superseded and run through the gate (`20261012110000` §5). It queues E12 as the gate always does.
- **The candidate is told.** Step 4 says "Already graduated? Then you only need to upload your Official University Completion Letter — you don't need a University Term Dates Letter." The term-letter row's hint and the footer hint say the same; once a completion letter is uploaded the term-letter row reads "Not needed — your Completion Letter below covers it", and the completion-letter row and its page say "instead of", not "optional".

## Consequences

- No cap, N14/CL2 or right-to-work-expiry rule moves: the completion letter still changes the study limit and nothing else, and the visa still wins.
- A graduate with a **future-dated** letter who uploads no term letter can Submit, but waits in Documents until the course has completed or they upload a current term letter. Nothing time-driven re-runs the §2.3 gate when that date passes, so the office moves them on by hand (or a current term letter does). A daily `onboarding_advance_if_ready` sweep is the follow-up if that turns out to happen. The blocker text reads "under review or rejected" for that case; the date is on the letter.
- The step 4 row reads "Covered by your Completion Letter below once the office approves it" while the letter is pending, and "Not needed" once it is verified.
- The Back Office wording of the blocker is unchanged. If the office wants a dedicated "waiting for the completion date" line, it is a `blockerLabel` addition and a token here.
- The wireframe (`staff/onboarding-1.html`) has no notice above the list and no "Not needed" state; this ADR is the deviation record.
