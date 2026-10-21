# ADR-0178 · The office confirms a term letter's holiday periods wherever it verifies it

**Status:** Accepted · 21.10.2026 · **Builds on:** ADR-0103 (a term letter expires on the
last day printed on it), ADR-0040 (course level beside the Verify), ADR-0140 (dd/mm/yyyy date
fields) · **Asked by:** THC, 21.10.2026 — "when the AI misses a student's term dates, can we
enter them when we verify the letter?"

`apps/office/app/compliance/TermDatesEditor.tsx`, `termDates.ts`, `TermLetterVerifyModal.tsx`,
`termDatesData.ts`, `term-dates.css` · `ReviewDialogs.tsx` (routes a term letter's Verify),
`queue.ts` (`verifyStep` → `term_dates`), `actions.ts` (`p_term_dates`) ·
`apps/office/app/onboarding/CandidateScreen.tsx` (uses the same editor), `actions.ts` ·
`VerifiedLetterActions.tsx`, `letterActions.ts` · `packages/domain/src/state.ts`
(`DOCUMENT_REVIEW_TRANSITIONS`) · `supabase/migrations/20261022150000_term_letter_periods_checked_on_verify.sql`,
`20261022150100_correct_term_dates_and_withdraw_completion.sql`,
`20261022150200_one_current_completion_letter.sql` · pgTAP `913`, `918` (and `892`
follows)

## Context

The holiday periods on a University Term Dates Letter decide two things: the student's weekly
limit, week by week (RULE-20 — 48 h in a holiday week, 20 h in term, 10 h below degree level,
the lower cap in a week that runs across both), and the letter's expiry, its last printed day
(ADR-0103). The AI reads them; a person confirms them.

Only the candidate screen let that person change them. Needs review and the `/staff/:id`
Documents tab opened a dialog with nothing but "Course is below degree level", and
`verifyDocument` sent no ranges, so whatever the AI read was verified as it stood. A current
worker's new letter could not be corrected at all, and a letter the AI could not read was
verified with **no** periods — which reads as term time every week of the year (20 h, all
year), takes the 31 December fallback expiry, and overwrote the holiday dates from the
worker's previous letter with nothing. Nothing on screen said any of that.

The office's example: the course finished on 15/08/2026 and restarts on 18/01/2027. The
holiday is 16/08/2026–17/01/2027, so the worker should have 48 h a week until then and 20 h
from Monday 18/01/2027 — not 20 h all autumn.

## Decision

1. **One editor, three screens.** `TermDatesEditor` is the candidate screen's period list
   moved into `compliance/`: rows "Holiday N" From → To (dd/mm/yyyy fields), a Source badge
   (the AI's confidence; **edited by hand** once a date is changed; **added by hand** for a new
   row), "remove", "+ Add period". The candidate screen, the Needs review dialog and the Documents
   tab all render it, pre-filled with the letter's ranges.
2. **Verify sends what is on screen.** The term letter's Verify dialog (`TermLetterVerifyModal`,
   with the course-level tick beside it as before) sends the periods as `p_term_dates` to
   `compliance_verify_document()` — the path the candidate screen already used through
   `verify_document()`. Verify is disabled while a row is half-typed, backwards, longer than a
   year, or the dates have already run out; the reason is shown under the rows.
3. **No holidays is a ticked decision.** With zero periods, Verify needs: "This letter shows no
   holidays. The worker will be limited to 20 hours a week (10 below degree level) all year."
   Both server actions refuse an empty list without it. When the worker has holiday dates on
   file from a previous letter, the dialog says verifying replaces (or removes) them, listing
   them.
4. **The expiry, live.** Under the rows: "Letter expires 17.01.2027 (last date on the letter)",
   or "(no dates on the letter — calendar-year fallback)" — the candidate screen's wording.
5. **The database checks the periods.** Unchanged and now tested together: a backwards period
   or a date not on the calendar cannot be cast to `daterange` (22000 / 22008); an empty or
   open-ended one is `term_dates_invalid`; all-past is `term_letter_expired`. Added: a trigger
   on the flip to verified refuses a term letter with a period longer than a year (366 days,
   both ends counted) as `term_dates_implausible` (22023) — a typed year (17/01/2072 for
   17/01/2027) would otherwise give 48 h and a letter that never expires. A trigger, not a
   restated `compliance_verify_document_as()`: that function is every document's Verify path.

6. **Correcting a letter already decided** (added 21.10.2026, from THC's reply: the worker in
   the example is already Staff, both his letters verified, and the completion letter should
   never have been approved — the course restarts on 18/01/2027). On `/staff/:id` Documents and
   `/onboarding/:id`, for an owner or a manager only (`assert_letter_editor`, the roles that
   correct a date of birth; a scheduler, a viewer, a worker or a client is refused):
   - **Correct term dates** on the worker's *current* verified term letter (the latest verified,
     as `current_verified_docs()` picks it; an older one is history): the same editor,
     pre-filled with the dates on file ("as verified"), a required note, Verify's checks
     (`no_holidays_not_confirmed` for an empty list without the tick, `term_dates_unchanged`).
     `compliance_correct_term_dates()` writes `compliance_docs.term_dates` and
     `staff.term_dates` and audits `term_letter.dates_corrected` (who, when, note, from, to,
     expiry before and after). The expiry, the ladder and the expiry block are calculated from
     the ranges, so they follow; the ladder's *receipts* are outbox keys
     (`N1..N4:doc:<id>`), so when the expiry moves the unsent rungs for the old date are
     deleted and the sent ones re-keyed (`…:until:<old expiry>:<id>`) — kept as history, no
     longer blocking the rungs for the new date. A rung the outbox drain has already claimed
     (attempts bumped, its lease still running) is in flight: it is re-keyed with the sent
     ones, never deleted from under the runner (20261022150200). A correction that leaves the
     last day where it was touches no receipt. An expiry block comes off through
     `unblock_if_compliant` (never a manual one).
     **After a correction that moves the expiry, the Radar's N1–N4 columns show no reminders
     for that letter** until the rungs for the new date go out: the Radar reads the receipts by
     their plain keys. The reminders already sent are still in the outbox (Notifications
     inbox) under their re-keyed names.
   - **Withdraw approval** on a verified completion letter, with a required reason:
     `compliance_withdraw_completion_approval()` moves **every** verified completion letter of
     the worker to **superseded** (a worker approved twice before 20261022150200 is withdrawn
     in one go, and the audit lists them), and approving a completion letter now supersedes an
     earlier verified one, so there is one current completion letter, as for any evidence.
     Superseded is the state a reset already gives a verified letter (held, never current),
     chosen over *rejected*, which
     means "re-upload" (N8) everywhere a worker or the office reads it. The reason is kept on
     the row; the evidence trail records `completion_letter.superseded` and
     `completion_letter.approval_withdrawn` (what it undid, and that the right to work was
     kept). `graduated_at` and `course_completion_date` are cleared; `right_to_work_until` is
     not touched. `term_letter_applies()` is then true again, and because the approval only
     ever superseded *pending or rejected* term letters (ADR-0112), the latest verified term
     letter is the current one again by construction. An unsent CL2 is dropped (not one the
     drain has already claimed — that one is in flight). No N8.
   - Both queue **N14** at once when the worker's band for this week changes — the same key,
     payload and `cap_band_notices` receipt as `compliance_daily()`, so 05:00 never repeats it.
     Withdrawing and then correcting can change the band twice, so twice the worker is told;
     **correcting the term dates first sends one N14.** The Withdraw dialog says so when the
     current term letter has no holiday periods or this week is not a holiday on it, with a
     "Correct term dates first" button that opens that dialog.
   - **The expiry stands (ADR-0103, confirmed by the product owner on THC's reply).** A
     corrected letter expires on its last printed day like any other: in the example,
     17/01/2027. The worker gets N1–N3 before it and is blocked by the daily job on that day
     unless a new letter has been verified, which lifts the block through the re-check. That
     is intended, not a side effect of the correction. Wherever the expiry line is shown —
     Verify, Correct term dates, the candidate screen — it is followed by "The worker will need
     to upload their next letter by then." pgTAP 918 holds the whole sequence: blocked on
     17/01/2027, rosterable at 20 h for the week of 18/01/2027 once the next letter (Easter
     2027) is verified.
   - The review states are now a machine: `DOCUMENT_REVIEW_TRANSITIONS` in `state.ts` and
     `document_review_transition_allowed()` in SQL (pending → verified / rejected /
     superseded; verified → superseded; verified → rejected for NI evidence only, the D43
     check; rejected → superseded). `completion_letter_state_guard` refuses any other move of
     a verified completion letter, whoever writes it.

## Not done, on purpose

- **Where the edit came from is not stored per period.** The Source badge is the screen's
  comparison of each row with what the AI read (on Verify) or what was on file (on Correct);
  `compliance_docs.term_dates` holds only the confirmed ranges, the AI's own read stays in
  `ai_extracted`, and a correction's audit row holds the before and after. Recording "edited
  by" per period would need a new column.
- **No live cap preview per week** in the dialog: the cap line on the profile and candidate
  screen is the calculated one, and the dialog says what the periods mean in words.
- **A pending term letter superseded at approval stays superseded.** If the worker had no
  verified term letter, withdrawing the approval leaves none current: the screen says so ("ask
  the worker to upload one") and the usual missing/expired rules apply.
- **The Radar** lists the letters but offers no correction; it links to the profile.

## Wireframes

`backoffice/compliance.html` has no Verify dialog for a term letter; the editor is
`backoffice/candidate.html`'s, unchanged in look. The dialog is the deviation, recorded here.
