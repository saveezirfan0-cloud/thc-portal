# ADR-0088 · The Allocation Timesheet goes at 16:00, only once the event is fully confirmed, and again when it changes

**Status:** Accepted (THC, 04.10.2026). Amends ADR-0074 §2 (D1 only). The manual Send and Download buttons are unchanged. **§11.3, §11.4**

## Context

ADR-0074 sent the Allocation Timesheet (D1) the day before at 14:00, and then on any later run until the first shift started. That catch-up meant an event booked or changed after the cut-off was sent as soon as one worker was confirmed, even when most of its places were still open. The client received a half-filled sheet.

On 04.10.2026 THC asked for two changes:

1. the cut-off is **16:00**, not 14:00;
2. after the cut-off, the sheet is sent **only once every worker is 100% confirmed**. A headcount, role or time change made after 16:00 holds it back until the line-up is whole again;
3. if the event changes **after** the sheet has gone, an updated sheet is sent automatically, once the staff concerned have confirmed the change.

## Decision

1. **16:00 UK** is the new default for `settings.document_autosend.allocation.time`. The migration (`20261005140000`) moves a row still on the shipped `14:00` and leaves a value the office has edited alone. The SQL and TypeScript defaults move with it. UK wall-clock time still holds through the clock changes.
2. **"100% confirmed"** means every role section holds at least its **headcount** of firmly confirmed workers. A firmly confirmed worker has a booking in `confirmed` or `worked` with `reconfirm_required = false`. `event_document_unfilled(event)` returns the places still short, summed across the sections. It is 0 when the event is whole.
   - Headcount raised, or a role section added, after the cut-off: the new places are open, so `unfilled > 0`.
   - Time, venue or dress change: the bookings go to `reconfirm_required` (§3.5 "Awaiting"). They do not count until the worker re-confirms in the Staff App.
   - The buffer is insurance on top of the headcount (RULE-07: fill counts only confirmed, against the headcount), so it is **not** needed for the sheet to go.
   - Invited, applied and Awaiting workers do not count.
3. **A new verdict, `not_fully_confirmed`.** It sits after `manual_sent` and before `gave_up` in `document_autosend_verdict()` and its twin `autosendVerdict()`, and applies to D1 only. The cheaper reasons (`too_late`, `no_confirmed_staff`, `no_contact_emails`, `manual_sent`) are still reported first. A wait is never counted as a failed attempt. The job logs it as noteworthy, like `held_no_checkout`.
4. **The wait ends** when the last place is confirmed, which sends the sheet on the next 15-minute run, or when the first shift starts (`too_late`, as before). The office can Send by hand at any time.
5. **A change after the sheet has gone sends an updated one** (THC, 04.10.2026, the same day). Once an automatic D1 has been sent, a change to the event reopens it, and the updated sheet goes on the first run where the event is whole again, by the same rules as the first send (an updated sheet is never half-confirmed).
   - **What does not count.** A venue or dress-code change sends workers to re-confirm (§3.5), which holds a first send, but it does not by itself resend: the sheet does not print the venue or the dress code, so the fingerprint ignores them and an updated sheet would be identical. If the change also moves a time or swaps a worker, that resends.
   - **How a change is recognised.** `event_document_line_up_fp()` is an md5 of what the sheet prints: the event's title, date and PO number, and for every confirmed or worked booking the worker, the role and the section's own start and end (RULE-18). It is stamped on every `event_documents` row as it is recorded (a `BEFORE INSERT` trigger, so a manager's Download or Send is covered too). `changed` means the latest D1 actually queued, by anyone, was drawn from a different line-up from today's. A copy drawn before this migration has no fingerprint and is never "changed", so nothing is resent for events sent before it.
   - **What counts.** A time or role change moves a section's window, and its workers go to `reconfirm_required` (§3.5 Awaiting), so the line-up is not whole until they re-confirm in the Staff App. A headcount raise that gets filled, or a worker swapped, changes the roster. A headcount raise that is never filled changes nothing the sheet prints, so nothing is resent.
   - **"All concerned staff"** is read as the whole event, the same rule as the first send: every role section at its headcount and nobody awaiting re-confirmation. It is stricter than "the staff affected by the change", and it can never send a sheet the client could read as half-confirmed. If THC wants it narrowed to the changed sections, that is a further change.
   - **The 15-minute check.** The job already runs every 15 minutes (`job_schedules` `event-documents`, `*/15 * * * *`) and re-judges every event dated from hold_days + 2 days ago to tomorrow on each run, so a re-confirmation is picked up within 15 minutes. It keeps checking until the first shift starts. After that nothing is sent automatically (`too_late`) and the office sends by hand.
   - **Keys and the email.** The first automatic send keeps `D1:auto:<event>`; the n-th (n ≥ 2) is `D1:auto:<event>:<n>`, so every automatic send has a unique outbox key. `event_document_autosends.sends` counts them, and a successful queue resets `attempts`, so each send has its own eight tries. The email's subject ends "(updated)" and its text says it replaces the earlier sheet.
   - **A manager's copy.** The "a manager already sent a fresh one" skip now applies only while that copy still matches the line-up. A manager's copy that a later change has outdated no longer suppresses the automatic one.
   - **D2 still goes once.**
   - **Known limit.** The fingerprint is taken as the copy is recorded, a moment after the PDF is drawn. A change inside that window would be missed by one send. Because the next fingerprint then differs from the recorded one, the following run corrects it.
6. The event page's hint reads "Sent automatically the day before at 16:00 (UK time), once every role is fully confirmed".

## Consequences

- `20261005140000_allocation_timesheet_1600_fully_confirmed.sql` (16:00 and the `unfilled` rule) and `20261005140100_allocation_timesheet_resend_on_change.sql` (the fingerprint, `changed`, `sends`, and the claim, record, queue and release functions restated so a sent row can be claimed again). `document_autosend_verdict()` gains `p_unfilled` and `p_changed`. `event_documents_due()` gains the columns `unfilled` and `changed`. All stay service-role-only.
- `packages/notifications/src/documents.ts`: the D1 subject and text carry `{updateTag}` and `{updateLine}`.
- `apps/office/app/api/jobs/event-documents/_lib/{schedule,run}.ts` and their tests. `supabase/tests/760_document_autosend.sql` holds the same cases.
- D2 (the Completed Allocation Timesheet) is unchanged.
