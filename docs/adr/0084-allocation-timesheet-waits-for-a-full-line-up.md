# ADR-0084 · The automatic Allocation Timesheet waits for a full line-up, and an updated copy follows a confirmed change

**Status:** Accepted (owner request, 03.10.2026: "Timesheet should not send at 16:00 if the event is not 100% filled", then "If there are changes to the headcount, roles, timings, etc after 16:00, the timesheet should not be re-sent until all of the changes are 100% confirmed by the staff members affected"; option 1, an automatic updated copy). Amends ADR-0074 §2 (D1), which sent at most one automatic copy. Scope v1.6 §11.4 is unchanged: the manager's Send and Download buttons still work at any time.

## Context

ADR-0074 sends the Allocation Timesheet (D1) automatically the day before the event, at `settings.document_autosend.allocation.time`, for any event with at least one confirmed worker. An event that is still short of staff therefore reached the client as a line-up with gaps in it. The client reads the sheet as THC's commitment.

## Decision

D1 goes only when **every role section has reached its headcount**. The rule is the new verdict `not_filled`:

- `unfilled` = the sum, over the event's role sections, of `max(0, headcount − confirmed-or-worked bookings)`.
- It is counted **per section** (RULE-18). A section over its headcount cannot cover for one under it.
- **Confirmed only.** Invitations and applications never count. A `worked` booking still holds its slot (ADR-0037), as in `shift_fill()`.
- **Changes the worker has not accepted do not count.** When the office moves a section's time, the venue, the dress code or the role, the booking stays `confirmed` but is Awaiting (`reconfirm_required`, §3.5) until the worker presses Confirm new time. An Awaiting booking is an unfilled slot here, so a change made before the send holds D1 until every affected worker has confirmed. Headcount, buffer, rate and PO edits are silent in the scope (no re-confirmation) and count as they stand; raising the headcount opens empty slots, which hold D1 until they are confirmed.
- **Buffer is excluded.** It is a confirmation target, not the working headcount (§3.2, RULE-15), so "100% filled" is headcount, not headcount + buffer.
- `unfilled > 0` gives `not_filled`. It is **not final**: the job runs every 15 minutes, so D1 goes on the first run after the last gap fills, up to the first shift's start (then `too_late`, as before). The send time is still the settings time; an event filled after it goes on the next run.
- Order: after `manual_sent`, before `gave_up`. Every earlier skip keeps its place, so an event with nobody confirmed still reads `no_confirmed_staff`.
- `queue_event_document_autosend()` re-takes the verdict under the lock, so a worker dropping out while the PDF is drawn stands the send down (`stoodDown`) instead of emailing a gap.
- **D2 is unchanged.** It is generated after the work is done, so a shortfall no longer matters.
- `not_filled` is counted in `job_runs.counts.verdicts` but not logged per run: an unfilled event would write a line every 15 minutes.

The event page's hint reads "Sent automatically the day before at 14:00 (UK time), once every role is fully confirmed".

## Updated copy after a change

Once a D1 has gone (ours, or a manager's Send since 00:00 UK the day before), a change to what the sheet shows sends an **updated copy**, and only when the change is firm:

- **Changed** means the sheet's fingerprint differs from the fingerprint of the latest copy that was emailed. `event_allocation_fingerprint()` hashes exactly what the Allocation Timesheet prints: the event title, date and PO and, per confirmed or worked booking, the employee number, the role and the role section's start and end (epoch seconds, so the session zone cannot move it). Each Allocation Timesheet copy stores its fingerprint when recorded (`event_documents.fingerprint`, set by a trigger). A change the sheet does not show (a headcount or buffer edit that adds or removes nobody, rates, venue, dress code) sends nothing: the client's sheet is not out of date.
- **Firm** is the `unfilled = 0` test above. A moved time, role or dress code leaves its workers Awaiting (§3.5), so the updated copy waits until each of them has pressed Confirm new time. A raised headcount waits until the new slots are confirmed, and a dropout until a replacement is, or until the headcount is lowered.
- **Same gates as the first copy:** not cancelled, someone confirmed, a contact email, and never once the first shift has started (`too_late`). There is **no send time** to wait for: the client already holds a sheet.
- **One per round.** Each round is a revision of `event_document_autosends` (primary key `event_id, kind, revision`): outbox key `D1:auto:<event>:<n>`, its own claim and its own eight attempts. A fingerprint that has been sent is never sent again, because the new copy becomes the baseline.
- **Baseline.** The latest copy that was emailed, by anyone. A copy emailed before this change has no fingerprint and is read as unchanged, so switching this on never mails every client who already holds a sheet.
- **The email** is the D1 template with "Updated " first in the subject and, first in the body, "This replaces the Allocation Timesheet we sent earlier: the line-up has changed, and everyone affected has confirmed. Please use this one and discard the earlier sheet." (`payload.updated`; `packages/notifications`). The wording was not specified: change `UPDATED_LINE` in `documents.ts` if THC wants other words.
- **Only D1.** D2 is generated after the work and is untouched.
- The event page's hint adds "· updated copy sent 29/09 09:15".
- Worth knowing: the 15-minute job can send several updated copies on a busy evening if the line-up keeps changing and re-firming. Each one is a separate email to the client's contacts.

## Implementation

`20261003100000_allocation_timesheet_waits_for_full_line_up.sql` (the full-line-up hold) and `20261003100100_allocation_timesheet_updated_copy.sql` (the updated copy: fingerprint, revision, claim and queue) restate `document_autosend_verdict()` (a trailing `p_unfilled int default 0`) and `event_documents_due()` (an `unfilled` column), and their service-role-only grants. `autosendVerdict()` in `apps/office/app/api/jobs/event-documents/_lib/schedule.ts` is the twin. `schedule.test.ts`, `run.test.ts` and pgTAP 760 hold the same cases.

## Not done

- **No "changes pending" line on the event page.** An updated copy waiting for a worker's confirmation is visible only as the worker's Awaiting card and the job run's `not_filled` count.
- **A client shortfall is not escalated.** If an event never fills, D1 never goes automatically and nothing tells the office. The existing event-board fill pill and the §3.4 escalation are where a shortfall is chased. Surfacing "Allocation Timesheet held: 2 slots unfilled" on the event page would be a separate change.
- **The time.** The shipped default is 14:00 (ADR-0074). A 16:00 send is the settings row: `update settings set value = jsonb_set(value, '{allocation,time}', '"16:00"') where key = 'document_autosend'`. This ADR does not change it.
