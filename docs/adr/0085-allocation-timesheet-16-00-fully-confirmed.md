# ADR-0085 · The Allocation Timesheet goes at 16:00, and only once the event is fully confirmed

**Status:** Accepted (THC, 04.10.2026). Amends ADR-0074 §2 (D1 only). The manual Send and Download buttons are unchanged. **§11.3, §11.4**

## Context

ADR-0074 sent the Allocation Timesheet (D1) the day before at 14:00, and then on any later run until the first shift started. That catch-up meant an event booked or changed after the cut-off was sent as soon as one worker was confirmed, even when most of its places were still open. The client received a half-filled sheet.

On 04.10.2026 THC asked for two changes:

1. the cut-off is **16:00**, not 14:00;
2. after the cut-off, the sheet is sent **only once every worker is 100% confirmed**. A headcount, role or time change made after 16:00 holds it back until the line-up is whole again.

## Decision

1. **16:00 UK** is the new default for `settings.document_autosend.allocation.time`. The migration (`20261004100000`) moves a row still on the shipped `14:00` and leaves a value the office has edited alone. The SQL and TypeScript defaults move with it. UK wall-clock time still holds through the clock changes.
2. **"100% confirmed"** means every role section holds at least its **headcount** of firmly confirmed workers. A firmly confirmed worker has a booking in `confirmed` or `worked` with `reconfirm_required = false`. `event_document_unfilled(event)` returns the places still short, summed across the sections. It is 0 when the event is whole.
   - Headcount raised, or a role section added, after the cut-off: the new places are open, so `unfilled > 0`.
   - Time, venue or dress change: the bookings go to `reconfirm_required` (§3.5 "Awaiting"). They do not count until the worker re-confirms in the Staff App.
   - The buffer is insurance on top of the headcount (RULE-07: fill counts only confirmed, against the headcount), so it is **not** needed for the sheet to go.
   - Invited, applied and Awaiting workers do not count.
3. **A new verdict, `not_fully_confirmed`.** It sits after `manual_sent` and before `gave_up` in `document_autosend_verdict()` and its twin `autosendVerdict()`, and applies to D1 only. The cheaper reasons (`too_late`, `no_confirmed_staff`, `no_contact_emails`, `manual_sent`) are still reported first. A wait is never counted as a failed attempt. The job logs it as noteworthy, like `held_no_checkout`.
4. **The wait ends** when the last place is confirmed, which sends the sheet on the next 15-minute run, or when the first shift starts (`too_late`, as before). The office can Send by hand at any time.
5. **Still one automatic send per event.** A change made **after** the sheet has gone does not send a second one. The office presses Send Allocation Timesheet to send the updated line-up. This is a conservative reading of "only once all the staff are 100% confirmed": the hold applies to the first automatic send. **Open question for THC:** should a headcount, role or time change made after the automatic send trigger an updated copy once the line-up is whole again? That needs a new key such as `D1:auto:<event>:<n>` and a "supersedes" line in the email, and is not built.
6. The event page's hint reads "Sent automatically the day before at 16:00 (UK time), once every role is fully confirmed".

## Consequences

- `20261004100000_allocation_timesheet_1600_fully_confirmed.sql`. `document_autosend_verdict()` gains a last argument, `p_unfilled`. `event_documents_due()` gains a last column, `unfilled`. Both are restated and kept service-role-only.
- `apps/office/app/api/jobs/event-documents/_lib/{schedule,run}.ts` and their tests. `supabase/tests/760_document_autosend.sql` holds the same cases.
- D2 (the Completed Allocation Timesheet) is unchanged.
