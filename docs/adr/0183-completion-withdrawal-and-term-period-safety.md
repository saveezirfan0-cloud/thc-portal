# ADR-0183 · Withdrawing a completion letter's approval, one current completion letter, and the safety rails on a term letter's periods

**Status:** Accepted · 21.10.2026 · **Builds on:** ADR-0178 (a term letter's holiday periods are
added by hand at Verify and after — the one editor and the one "edit after verification" path,
`set_term_letter_periods`), ADR-0103 (the letter expires on its last printed date), ADR-0112 (a
graduate's pending term letter is superseded), ADR-0060 (the viewer writes nothing) · **Asked
by:** THC, 21.10.2026 — the student in ADR-0178's example is already Staff, with *both* his term
letter and his completion letter verified, and the course restarts on 18/01/2027

`supabase/migrations/20261022155000_term_letter_periods_checked_on_verify.sql`,
`20261022155100_withdraw_completion_approval.sql`,
`20261022155200_one_current_completion_letter.sql`,
`20261022155300_term_letter_periods_ladder_and_cap_notice.sql` · pgTAP `913`, `918` (and `892`
follows) · `apps/office/app/compliance/VerifiedLetterActions.tsx`, `letterActions.ts`,
`TermLetterOutcome.tsx`, `termDates.ts`, `termDatesData.ts` · ADR-0178's `ReviewDialogs.tsx`
(Verify dialog), `_components/TermPeriods.tsx` (`EditTermPeriods`) and
`onboarding/CandidateScreen.tsx`, each with the extras below · `packages/domain/src/state.ts`
(`DOCUMENT_REVIEW_TRANSITIONS`)

## Context

ADR-0178 lets the office type a term letter's holiday periods at Verify and correct them after.
For the case that started it, that is half the fix. The completion letter was approved with a
completion date of 15/08/2026, so `graduated_at` holds the worker at 48 h for good and stops
the term letter's reminders (`term_letter_applies()` is false) — whatever the term letter says.
Nothing could undo an approval. And a few things ADR-0178's path leaves open matter more once
the periods are typed by hand: a letter with no periods caps the worker at 20 h all year
without anyone deciding it; a typed year (17/01/2072 for 17/01/2027) gives 48 h and a letter
that never expires; and moving a letter's last date leaves its reminder receipts pointing at
the old one.

## Decision

1. **Withdraw approval** on a verified Official University Completion Letter — the staff
   profile's Documents tab and the candidate screen, for a login that may write; the database
   decides with `assert_reviewer()` (the check `approve_completion_letter` and
   `set_term_letter_periods` use — no second permission model), and a viewer meets
   `office_read_only`. A required reason. `compliance_withdraw_completion_approval()`:
   - moves **every** verified completion letter of the worker to **superseded** — the state a
     reset already gives a verified letter (held, never current), chosen over *rejected*,
     which means "re-upload" (N8) everywhere a worker or the office reads it. The reason is
     kept on the row; the evidence trail records `completion_letter.superseded` and
     `completion_letter.approval_withdrawn` (what it undid, the letters, and that the right to
     work was kept);
   - clears `graduated_at` and `course_completion_date`; **does not touch
     `right_to_work_until`**;
   - so `term_letter_applies()` is true again, and the latest verified term letter drives the
     cap and its ladder: approval only ever superseded *pending or rejected* term letters
     (ADR-0112), so that letter is current again by construction;
   - drops an unsent CL2 ("48 hours from…") — not one the outbox drain has already claimed,
     which is in flight; sends **no N8**;
   - queues **N14** at once if this week's band changed (below).
2. **One current completion letter.** `approve_completion_letter()` (restated from
   20261012110000) supersedes an earlier verified completion letter of the same worker, as for
   any evidence. Withdraw takes them all anyway, so a worker approved twice before this is
   withdrawn in one go.
3. **The review states are a machine.** `DOCUMENT_REVIEW_TRANSITIONS` in `state.ts` and
   `document_review_transition_allowed()` in SQL: pending → verified / rejected / superseded;
   verified → superseded; verified → rejected for NI evidence only (the D43 check); rejected →
   superseded. `completion_letter_state_guard` refuses any other move of a verified
   completion letter, whoever writes it.
4. **Safety rails on ADR-0178's periods**, wherever they are edited — the Verify dialog, "Edit
   holiday periods" and the candidate screen (`TermLetterOutcome`, under ADR-0178's rows):
   - **No holidays is a ticked decision**: with zero periods, Verify / Save need "This letter
     shows no holidays. The worker will be limited to 20 hours a week (10 below degree level)
     all year." Both server actions refuse an empty list without it. (Not in the database: the
     RPCs keep their signatures, which ADR-0178's tests and the extractor's callers pin.)
   - **A period over a year is refused** (366 days, both ends counted): on screen, in the
     actions, on the flip to verified (trigger, 20261022155000) and in
     `set_term_letter_periods()` (20261022155300) — `term_dates_implausible`.
   - **The expiry, live**: "Letter expires 17.01.2027 (last date on the letter)" or "(no dates
     on the letter — calendar-year fallback)", then "The worker will need to upload their next
     letter by then." Dates that have already run out keep Verify / Save shut.
   - **Replacing a previous letter's dates is said plainly** on Verify ("Verifying replaces /
     removes the holiday dates from their previous letter (…)").
5. **`set_term_letter_periods()` moves the ladder and tells the worker once** (restated from
   ADR-0178's 20261022145000, same signature and permission):
   - the ladder's *receipts* are outbox keys (`N1..N4:doc:<id>`), so when the expiry moves the
     unsent rungs for the old date are deleted and the sent ones re-keyed
     (`…:until:<old expiry>:<id>`) — kept as history, no longer blocking the rungs for the new
     date. A rung the drain has claimed (`outbox_row_leased`: attempts bumped, lease running)
     is re-keyed, never deleted from under it. The same last day touches no receipt;
   - an expiry block the old ranges caused comes off through `unblock_if_compliant` — never a
     manual block;
   - **N14** goes at once if this week's band changed: `cap_band_notify_now()` uses the same
     key, payload and `cap_band_notices` receipt as `compliance_daily()`, so the 05:00 run
     never repeats it.
6. **Correct first, so the worker is told once.** Withdrawing and then correcting can change
   the band twice, and each change sends N14. When the current term letter has no periods, or
   this week is not wholly a holiday on it, the Withdraw dialog says "…correct the term dates
   first, so the worker is only told once about their new limit" with **Correct term dates
   first**, which opens ADR-0178's "Edit holiday periods" for that letter. Correcting first
   sends one N14.
7. **The expiry stands (ADR-0103, confirmed by the product owner).** A corrected letter expires
   on its last printed day like any other — in the example 17/01/2027. The worker gets N1–N3
   before it and is blocked by the daily job on that day unless a new letter has been
   verified, which lifts the block through the re-check. That is intended. pgTAP 918 holds the
   whole sequence: withdraw → `set_term_letter_periods` with 16/08/2026–17/01/2027 → 48 h the
   week of Monday 11/01/2027, 20 h from Monday 18/01/2027 → blocked on 17/01/2027 → rosterable
   at 20 h for the week of 18/01/2027 once the next letter (Easter 2027) is verified.

## Consequences

- **The Radar after a correction:** when the expiry moves, its N1–N4 columns show no reminders
  for that letter until the rungs for the new date go out — the Radar reads the receipts by
  their plain keys. The reminders already sent are still in the outbox (the Notifications
  inbox) under their re-keyed names.
- A pending term letter superseded at approval (ADR-0112) stays superseded. If the worker has no
  verified term letter, withdrawing leaves none current: the dialog and the result say so ("ask
  the worker to upload one") and the usual missing / expired rules apply.
- No live per-week cap preview in the dialogs; the cap line on the profile and the candidate
  screen is the calculated one.
- The Radar offers no correction; it links to the profile.

## Wireframes

`backoffice/staff-profile.html` and `candidate.html` have no "Withdraw approval"; the tick and
the expiry line sit under ADR-0178's rows in its look. This ADR is the deviation record.
