# ADR-0084 · The Allocation Timesheet is re-sent automatically when the line-up or times change

**Status:** Accepted (THC, 02.10.2026). It extends ADR-0074's automatic sending, and the D1 time is 16:00 since `20261002114000`.

## Context

ADR-0074 sends each event **one** automatic Allocation Timesheet (D1), the day before at 16:00 UK. If the line-up or times change after that, the client keeps a stale sheet unless someone in the office presses **Send Allocation Timesheet** again.

We offered THC two options: a warning on the event page, or an automatic re-send. THC chose:

> (b) the system to re-send automatically after changes, at most once an hour so the client isn't flooded with emails.

## Decision

### What counts as a change

A change is anything the sheet **prints**: who is on it, their Employee ID and name, their role, the role's start and finish (RULE-18), and the header (event title, client, date and PO number).

`event_document_signature(event)` turns that into one md5 value. Every Allocation Timesheet copy carries the value as `event_documents.content_signature`. The job compares the latest copy's value with the line-up now.

These are not printed, so they send nothing:

- a headcount or buffer change with nobody added or removed;
- a new selfie;
- a change to the client card's contact emails;
- a cancel-and-rebook of the same person.

**The race.** The copy is recorded after its PDF is drawn. A signature taken when the copy is recorded would include a change made during drawing that the PDF does not show, and that change would never be re-sent. So `generateDocument()` reads the signature (`event_document_content_signature`) before it reads the rows, and puts it on the copy once recorded (`set_event_document_signature`). A race can therefore only cause one email too many, never a missed change. An insert trigger stamps the copy too, as the fallback.

### The rule

The job (every 15 minutes) has a third kind, `allocation_update`. It checks these in order:

| Verdict | When |
| --- | --- |
| `disabled` | `settings.document_autosend.update.enabled` is false |
| `cancelled` | the event is cancelled (§3.3) |
| `too_late` | its first shift has started: the sheet is in use on site |
| `not_sent_yet` | no Allocation Timesheet queued since 00:00 UK the day before |
| `no_baseline` | the last copy predates this change (no signature to compare) |
| `unchanged` | the sheet would print the same as the last copy |
| `no_confirmed_staff` | everyone has dropped off; an empty sheet is not sent |
| `no_contact_emails` | the client card has nobody to send to |
| `too_soon` | the last copy went less than `gap_minutes` (60) ago |
| `gave_up` | eight failed claims on this change |
| `due` | otherwise |

**What sets the hour.** It runs from the **latest copy of any kind**: the 16:00 send, an earlier update, or a manager's own Send. Changes inside the hour go together in the next email. A manager who re-sends by hand resets the hour, and if nothing changes after their send, nothing more goes.

**`not_sent_yet` keeps D1 and the update apart.** The update only follows a fresh copy, using the same freshness rule as ADR-0074's `manual_sent`. When no fresh copy exists, the 16:00 D1 is still due, so the two never go in the same run.

**Rule twins.** As with ADR-0074 there are two implementations: `document_update_verdict()` in SQL and `autosendVerdict()` (kind `allocation_update`) in `schedule.ts`. The route sends only where both say `due`. pgTAP 772 and `schedule.test.ts` hold the same cases.

### The machinery

It is ADR-0074's, under the same advisory lock as the 16:00 send and the manager's Send:

1. `event_documents_due()` returns a third row per event. It also returns two new facts, `allocation_sent_at` and `changed`, so its result shape changed and it was recreated.
2. `event_document_update_claim()` checks the verdict again under the lock and takes a 10-minute lease on the event's single `allocation_update` row in `event_document_autosends`. Attempts count against `baseline_document_id`, the copy the change is measured from. A newer copy starts again at one.
3. `generateDocument(…, { automatic: true, update: true })` draws the sheet, with the name badges when the client has them on (ADR-0081). `record_event_document_update()` records it as an automatic Allocation Timesheet.
4. `queue_event_document_update()` checks the verdict again under the lock and queues **D1U** under `D1U:update:<document>`. If a manager sent it by hand while the PDF was being drawn, the verdict is now `unchanged`. The job then stands down, gives its claim back with the reason, and queues nothing.
5. `event_document_autosend_release()` gives the claim back after a failure, as for D1 and D2.

All of these are callable by the service role only. `event_document_content_signature` and `set_event_document_signature` check their caller (`assert_reports_caller`), because the manager's Download and Send call them too.

### The email: D1U, "Updated Allocation Timesheet"

It comes from timesheets@ and goes to every contact email on the client card, like D1. It has the same facts box, steps and files as D1, with the name badges when the client has them on. Its words:

- **Subject:** "Updated Allocation Timesheet — {event}, {date} (PO …)".
- **Body:** "The staffing for the {event} on {date} has changed since we last sent you the Allocation Timesheet, so please find the updated one attached. … Please use it on the day instead of the earlier sheet."

It lives in `packages/notifications/src/documents.ts` beside D1.

### Settings

```json
"update": {"enabled": true, "gap_minutes": 60}
```

This sits in `settings.document_autosend`. `gap_minutes` is a JSON number from 15 to 1440; anything else means 60. A missing settings row is still "everything off". There is no /settings control yet, so a change is an SQL edit, as in ADR-0074.

### The event page

The line under the document buttons now says:

- before or after the 16:00 send: "Sent automatically the day before at 16:00 (UK time) · and again if the line-up or times change (at most hourly)" / "Allocation Timesheet sent automatically 28/09 16:00 · …";
- once an update has gone: "… · updated automatically 28/09 18:15".

## Consequences

- **Database:** migration `20261002115000_allocation_timesheet_update.sql`, pgTAP `772` (45 assertions), pgTAP 190's lists of job functions.
- **Office app:** `schedule.ts`, `run.ts`, the job route, `generate.ts` and the event-page hint.
- **Notifications:** D1U in `documents.ts`.
- **What the client gets:** one email per hour at most, while the line-up keeps changing, until the first shift starts. Nothing is sent after the first shift starts. On-the-day changes after that are the office's call (manual Send).

## Not done

- **No quiet period.** A change made 61 minutes after the last copy goes on the next run (within 15 minutes). An edit spread over several minutes can therefore arrive as two emails an hour apart. The hourly gap bounds this; a settle delay ("no change for 10 minutes") can be added if THC sees it.
- **No /settings control** for `update`.
- **No change list in the email.** The email says the sheet changed, not who or what. The attached sheet is the record.
