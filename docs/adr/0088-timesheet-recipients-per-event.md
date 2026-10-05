# ADR-0088 · Who receives the timesheet is chosen per event

**Status:** Accepted (THC, 05.10.2026). Agreed deviation from scope v1.6 §9.7 and §11.4, which send both documents to every contact email on the client card. The manual Send and Download buttons work as before. **§9.7, §11.3, §11.4**

## Context

§9.7 gives each client 1–5 contact emails, and §11.4 sends the Allocation Timesheet and the Completed Allocation Timesheet to all of them. THC: events on the same day for the same client sometimes need the sheet to go to different people (for example, two functions in one hotel with different banqueting contacts). With one list per client, every event's sheet went to everyone.

## Decision

1. **A recipient list per event.** `events.document_recipients text[]`:
   - **null** (every existing event, and the default for a new one) means every contact email on the client card, exactly as before;
   - otherwise **1–5 addresses for this event only**. They can be any of the client's contacts, other addresses, or both. They need not be on the client card, because the point is that different people are involved. A check constraint holds the 1–5 bound.
2. **One place answers "who gets it":** `event_document_recipients(event)` returns the event's own list, else the client's contacts. The manual Send (`queue_event_document_email`), the automatic Allocation Timesheet and Completed Allocation Timesheet (`queue_event_document_autosend`) and the job's "no contact email" check (`event_documents_due.contacts`) all read it. The choice therefore applies to both documents, sent by hand or automatically. The recipients are recorded on each `event_documents` row and outbox row, as before.
3. **One write path:** `set_event_document_recipients(event, addresses)`.
   - Admin only (`assert_reports_caller`, the same as the Send itself).
   - It trims, lower-cases and de-duplicates the addresses, refuses an invalid address (22023 `invalid_recipient_email`), more than five (`too_many_recipients`) and a cancelled event (`event_cancelled`).
   - Null or an empty list puts the event back on the client card.
   - Audited as `event.document_recipients_set`, with the new list and the previous one.
4. **The event page.** A **Timesheet recipients** button next to the Send and Download buttons opens a form:
   - a tick box per client contact;
   - an "Also send to" box for other addresses;
   - Save.

   Everyone ticked with nothing added is saved as null, so a contact added to the client card later still reaches that event. The Send confirmation names the recipients it will use, and a line under the buttons reads "Timesheets go to … (set for this event / the client card)".
5. **Saving does not send anything.** The next send, automatic or the manager's Send button, uses the new list. In particular, changing the recipients **after** the automatic Allocation Timesheet has gone does not resend it, and the recipients are not part of the line-up fingerprint (ADR-0087). A new person who needs the sheet now gets it from Send Allocation Timesheet.

## Known limit

An event's own list is a snapshot of addresses, not a pointer to the client card. A contact **removed from the client card afterwards still receives the timesheets of events that already hold an explicit list** that includes them, until the office edits that event's recipients. Events left on the client card (null) always follow it. The line under the buttons and the Send confirmation name the exact addresses, so the office can see this. Pruning an event's list when the card changes is a possible follow-up.

## Not done

- **No choice on the new-event or edit-event forms.** It is set on the event page, which works before and after the event. Adding the same picker to the builder is a small follow-up.
- **No per-send choice.** The list belongs to the event, so the automatic send, which nobody presses, follows it too. Pressing Send uses the same list.
- **No per-role or per-document list.** Both documents for an event share one list.
- **Addresses are not checked against the client's domain.** An admin can send a worker roster to any address, as they could already email the downloaded PDF. The change is audited.

## Consequences

- `20261005140200_event_document_recipients.sql` (the column, `event_document_recipients()`, `set_event_document_recipients()`, and `queue_event_document_email`, `queue_event_document_autosend` and `event_documents_due` restated). pgTAP `773_event_document_recipients.sql`.
- `apps/office/app/events/[id]/`: `document-recipients.ts` (the form's half of the rules), `_components/DocumentRecipients.tsx`, `actions.ts` (`setDocumentRecipients`), `board-data.ts`, `page.tsx`, `_components/DocumentActions.tsx`. `packages/db` types gain the column and the two functions.
- The client role holds no policy on `events` (ADR-0026), so the list is never visible to a client.
