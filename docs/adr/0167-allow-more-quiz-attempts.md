# ADR-0167 · Allow 3 more attempts at the Health & Safety quiz

**Status:** Accepted (office request, 19.10.2026). A deliberate change to scope v1.6 §2.9 / RULE-09 ("3 attempts in total, and failing the third → automatic rejection").

## Context

§2.9 rejects a candidate automatically after the third failed H&S quiz, and §2.3 makes that rejection final on the record: the only way back was **Reset to candidate**, which starts a new onboarding period, a new Willo interview, every document, the declaration and the induction again.

A candidate scored 70% three times on 19.10.2026 (pass mark 80%) and the office asked to let him try again without redoing everything else, and for an option the office can use for this from now on.

## Decision

**Allow 3 more attempts**, a button at the top of `/onboarding/:id` on a candidate the quiz rejected.

- **Who:** any Back Office login that may write (owner, manager, scheduler: `officeCan(role, 'write')`). A viewer does not see it, and the database refuses one (`office_read_only`, ADR-0060). Clients and workers are refused by `assert_office_caller()`.
- **Which candidates:** only `status = rejected` with `rejection_cause = 'quiz_failed'`. A candidate the office or Willo rejected still has only Reset to candidate (`not_quiz_rejected`).
- **What it does** (`grant_quiz_attempts()`, 20261021100000): the attempts so far are marked `superseded` — kept, read-only, as Reset to candidate keeps them — `staff.quiz_attempts` goes back to 0, the rejection columns are cleared and the candidate is back in **Quiz** with three attempts. The onboarding period does not move, so documents, declaration and induction stand. The pass mark is unchanged; a third failure rejects again and sends E4 again (its key is the attempt). The office can allow more again after that.
- **The state machine** gains one edge, `rejected → quiz` (`staff_transitions` and `STAFF_TRANSITIONS`). Only this function takes it; `staff.status` is written by definer RPCs alone (20261012120100).
- **Reason:** mandatory, kept in `audit_log` (action `quiz_attempts_granted`) with who and the scores set aside. The quiz panel says "3 more attempts allowed {when} by {name}: “{reason}”. Earlier attempts, set aside: 70% · 70% · 70%."
- **Nothing is sent to the candidate.** There is no notification for this in the §8 register; the office tells them, and the Staff App shows the quiz instead of the terminal screen the next time it reads their status.
- **The board** counts attempts used against the current three (`onboarding_candidates_v.quiz_attempts_used` ignores superseded attempts); best score and the scores line still read the whole period.

## Consequences

- One more `security definer` RPC callable by `authenticated` (`onboarding_grant_quiz_attempts`), guarded internally, closed to anon and PUBLIC, pinned by `892` and tested by `899`. The work itself (`grant_quiz_attempts(staff, reason, actor)`) is service role only, so a support fix from the SQL editor runs the same code and leaves the same audit row.
- `staffMachine.sql.test.ts` now reads every migration's `staff_transitions` inserts, not only the first one.
- The wireframe's rejected card (`wireframes/backoffice/onboarding.html`, `candidate.html`) has no such button; this ADR is the deviation.
