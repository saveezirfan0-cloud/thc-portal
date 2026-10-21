# ADR-0178 · A term letter's holiday periods are added by hand, before and after verification

**Status:** Accepted · 21.10.2026 · **Asked by:** THC, 21.10.2026 ("if the AI does not
recognise vacation periods in the University Term Date Letter, this needs to be manually added
both at the Onboarding stage and also once verified") · **Builds on:** ADR-0103 (the letter
expires on its last printed date), RULE-20 (the weekly cap is calculated from the verified
holiday ranges), §2.3 ("+ Add period")

`supabase/migrations/20261022145000_term_letter_periods_after_verification.sql`
(`set_term_letter_periods`) · pgTAP `911`, `892` · `apps/office/app/_components/TermPeriods.tsx`
(`HolidayPeriodsEditor`, `EditTermPeriods`) · `compliance/actions.ts` (`setTermLetterPeriods`,
`VerifyDates.termPeriods`) · `compliance/ReviewDialogs.tsx`, `compliance/queue.ts`
(`verifyStep`) · `onboarding/CandidateScreen.tsx` · `staff/[id]/Overview.tsx`

## Context

The holiday ranges on a University Term Dates Letter decide a student's weekly cap (48 h in a
holiday, 20 h / 10 h in term) and, since ADR-0103, when the letter expires. The extractor reads
them; the reviewer confirms them. Two gaps:

1. **Before verification**, "+ Add period" existed only on the candidate screen. A worker's
   renewed letter verified from Compliance → Needs review (or the staff profile's Documents tab)
   was verified with whatever the AI read — a missed vacation could not be added there.
2. **After verification**, the ranges were frozen everywhere. A vacation nobody noticed was
   missing left the worker on the term-time cap for the whole of it, and moved the letter's
   expiry, with no way back short of a new upload.

## Decision

- **Every Verify of a term letter shows the periods.** `verifyStep()` opens the confirm dialog
  for any term letter (it already did for a student's, for the course level); the dialog lists
  the AI's ranges and has "+ Add period". What the reviewer confirms is sent as `p_term_dates`,
  exactly as the candidate screen's Verify already did.
- **A verified letter's periods can be corrected.** "Edit holiday periods" on the candidate
  screen (on the verified letter) and on the staff profile (Overview → Term dates & calculated
  weekly limit) opens the same rows in a dialog. `set_term_letter_periods()` replaces the
  ranges on the letter and on the worker (`staff.term_dates`), under Verify's own checks:
  every range bounded and non-empty; the letter not left expired by the new ranges
  (`term_letter_expired()` and its ADR-0103 expiry after today). Admin only
  (`assert_reviewer()`), a viewer refused by `office_read_only`, audited as
  `term_letter.periods_changed` with the ranges before and after.
- The cap and the expiry are read from the ranges, never stored (RULE-20, ADR-0103), so both
  follow from the moment of saving. The reminder ladder follows the new expiry.

## Consequences

- Shifts already booked are not re-judged or removed when the periods change: a removed
  holiday can put an existing booking over the new term-time cap, and the office sees that on
  the worker's week as it does after any cap change.
- Only the worker's current verified letter is editable; a superseded letter stays as it was.
