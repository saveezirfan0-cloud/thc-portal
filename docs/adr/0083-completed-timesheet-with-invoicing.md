# ADR-0083 · The Completed Allocation Timesheet goes to the client with the invoice

**Status:** Accepted (THC, 02.10.2026). Supersedes part of ADR-0074 §2: the automatic D2 is switched off. It also changes the Completed Timesheet's send on the event page (§11.4) and the Client Portal's copy (§11.2).

## Context

THC asked on 02.10.2026:

> Signed timesheets after the event with completed worked timings should not be emailed out to the client yet. This needs to be linked into the invoicing part.

The filled-in sheet is the Completed Allocation Timesheet (code `signout`, email D2). It shows each worker's finish time and hours worked. Until now it could reach the client three ways, all before THC had invoiced:

1. **Automatic D2 (ADR-0074).** The event-documents job emailed it the morning after the event at 10:00 UK.
2. **The event-page button.** Anyone in the office could press "Send Completed Timesheet" on the event page, a scheduler included.
3. **The Client Portal.** `client_event_documents_v` (20260923193100) served any sign-out copy drawn after the event's last role ended. A manager who pressed Download just to check the hours published the sheet to the client.

THC invoices the previous week by Tuesday evening (§9.9, confirmed 28.07.2026). The hours the client is billed for and the hours on the timesheet they receive should arrive together.

## Decision

The Completed Allocation Timesheet goes to the client **with the invoice**, sent from **Reports › Financial**. It no longer goes automatically or from the event page.

### 1 · The automatic D2 is off

Migration `20261002113000` sets `settings.document_autosend.completed.enabled = false`. The automatic Allocation Timesheet (D1, the day before at 16:00 since 20261002114000) is unchanged.

The D2 machinery is kept: the verdict and its TypeScript twin, the claim, record, queue and release functions. pgTAP 760 still runs it end to end with the switch turned back on. If THC later wants the sheet sent on its own again (for example "the Wednesday after invoicing"), it is one settings edit plus a rule change, not a rebuild.

### 2 · No Send on the event page

The event page keeps **Download Completed Timesheet**. The Send button is gone. The line under the buttons now says:

- "Completed Timesheet goes to the client with the invoice (Reports › Financial)", or
- "Completed Timesheet queued for the client 06/10 09:12" while its email waits for the mail sender, then "Completed Timesheet sent to the client 06/10 09:13" once it has gone, or
- "Completed Timesheet sent automatically …" for an event the job sent before this change.

"Send Allocation Timesheet" stays exactly as §11.4 describes it.

### 3 · Reports › Financial: "Completed Timesheets · for invoicing"

A new panel sits under the Financial report's breakdown. It covers the same period as the report and reads from `invoicing_timesheets(from, to)`. There is one row per event that:

- is dated in the period;
- is not cancelled (§3.3: no document at all);
- has finished (its last role section has ended, RULE-18);
- had somebody confirmed.

Rows are ordered client by client, then by date, which is the order invoices are written in.

| Column | From |
| --- | --- |
| Client · Event · Date · PO Number | the event (§3.2: the PO carries into the sheet) |
| Staff | the sheet's rows (confirmed + worked) |
| Total hours | the sheet's own Total Hours (`event_document_tally`); "—" while any row is blank |
| Completed Timesheet | Not sent yet · Queued … waiting for the mail sender · Sent … · Sent automatically … · Send failed … (UK stamps, §1.8) |
| Actions | **Download** · **Send to client** (**Send again** once one went) |

The panel title carries a count, "3 to send" or "All sent".

**Send is held** while a row would print a blank Finish Time and Hours Worked. That happens when a No check-out is unresolved (RULE-02, §11.3). A sheet that goes with an invoice must carry every hour, and the manager can always resolve the violation first. The database holds this too: `queue_event_document_email()` refuses such a copy with `timesheet_has_blank_hours`. Send is also held while the client card has no contact email. Download always works.

A failed send counts as still to send in the panel's count.

The send itself is the existing one: `POST /api/documents/:eventId/send { kind: 'signout' }` draws, stores and queues D2 from timesheets@ to every contact email on the client card. The email copy is unchanged.

### 4 · Only finance sends it

`queue_event_document_email()` now calls `assert_finance_caller()` for a sign-out copy. That allows an owner or a manager (ADR-0056). A scheduler gets `not_permitted`, and the route says the sheet goes with the invoice from Reports › Financial. The route asks the same question before it draws the PDF, so a refused send leaves no stored copy behind. A viewer can read the list, because they have finance, but `office_read_only` refuses the send (ADR-0060), and the panel shows them no Send button. A scheduler keeps both Downloads and the Allocation Timesheet's Send.

### 5 · The Client Portal gets it once it was sent

`client_event_documents_v` now serves a sign-out copy only when its email has been **sent** (`sent_at`). The branch "drawn after the event's last role ended" is removed, so a Download publishes nothing. Until the sheet is sent, a completed event shows "Timesheet not issued yet" and a disabled "↓ Download Completed Timesheet", which are the portal's existing pending state (ADR-0049). Copies already sent, by hand or automatically, stay exactly as they were.

**One-off effect on deploy:** a past event whose sheet was downloaded after it ended but never sent stops offering that copy on the portal until THC sends it from the invoicing list.

## Consequences

- **Database:** migration `20261002113000_completed_timesheet_with_invoicing.sql` and pgTAP `771` (26 assertions). pgTAP 760's settings assertion now expects D2 off, and its D2 section switches the setting back on first.
- **Screens:** the event page's document buttons and hint line (`DocumentActions`, `document-autosend.ts`, `autosendHint`) and the Financial tab (`InvoicingTimesheets`, `SendTimesheet`, `timesheetState` in `reports/view-model.ts`).
- **Wireframe deviation:** `wireframes/backoffice/reports.html` has no invoicing list. The panel uses the same Panel and table (`.tbl`) as the breakdown above it.
- **§8 / documents register:** D2's trigger and timing in `packages/notifications/src/documents.ts` now name Reports › Financial. The subject and body are unchanged.

## Not done

- **No invoice in the system.** §9.9 says THC has its own invoicing process, and the Financial figure is a forecast. The list only links the timesheet to that step; it does not raise or store the invoice.
- **No bulk "Send all for this client".** Each event is sent on its own, as each has its own PO number. A bulk send can be added once THC says how they batch invoices.
- **No /settings control** for `document_autosend`, as in ADR-0074.
