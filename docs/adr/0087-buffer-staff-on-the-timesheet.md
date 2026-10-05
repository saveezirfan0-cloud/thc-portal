# ADR-0087 · The timesheet says when buffer staff are on it

**Status:** Accepted (THC, 05.10.2026). Agreed addition to scope v1.6 §11.3. The columns, the pagination and the order of the sheet are unchanged. **§3.2, §11.3**

## Context

THC deliberately overbooks a role by its buffer (§3.2, RULE-07): the buffer is the insurance against people who turn up late or drop out on the day. The Allocation Timesheet lists everyone confirmed, so for a role booked at 6 (+1) the client sees 7 names and, with nothing to explain it, concludes that too many staff have been booked.

## Decision

1. **The role heading says so.** Where a role section lists more people than the client asked for, its heading on the sheet reads `Waiting Staff · 17:00 – 23:30 · 7 staff (6 required + 1 buffer)`. Where it lists exactly the headcount, the heading is as before: `6 staff`. Where the data does not say what was asked for (a copy drawn before this), nothing is claimed.
2. **One note on the last page, above the company line:** "Buffer staff are booked in addition to the number required, to cover late arrivals and drop-outs on the day." It is printed once, and only when at least one role has buffer staff on it. The "(continued)" headings that cross a page break keep their wording.
3. **The email says it too.** The Allocation Timesheet and Completed Allocation Timesheet emails add one sentence, "It includes 2 buffer people, booked in addition to the number required to cover late arrivals and drop-outs on the day.", and the facts box reads `19 (incl. 2 buffer)` beside the staff count. Nothing is said when there is no buffer on the sheet.
4. **Nobody is singled out.** No row is marked as buffer. Who works is decided by check-in order (§3.2, RULE-15), not before, and for a client who pays for the buffer everyone works. The sheet shows how many are buffer, not who.
5. **How "buffer" is counted.** Per role section, the confirmed or worked bookings above the section's headcount, `max(listed − headcount, 0)`. This is how many the sheet lists beyond what was asked for, whatever the section's configured buffer, so it stays true when the office has overfilled or edited a section. The headcount comes through `event_document_data()` on each row; the count in the email payload comes from `event_document_buffer_count()`.
6. **The Completed Allocation Timesheet is covered too**, so the same client reading the sign-out sheet sees the same explanation.

## Consequences

- `20261005110000_timesheet_buffer_indication.sql` (`event_document_buffer_count`, `event_document_data` and `event_document_email_payload` restated). pgTAP `773_timesheet_buffer_indication.sql`.
- `packages/pdf/src/sheet.ts` (`SheetPerson.headcount`, `SheetLayout.bufferStaff` / `bufferNote`, `BUFFER_NOTE`), `SheetDocument.tsx`, and tests, including a render test that the worst case still fits on one A4 page.
- `packages/notifications/src/documents.ts`: `{bufferLine}` in both emails and "(incl. N buffer)" in the facts box.
- The wireframe `wireframes/client/timesheet.html` is the visual contract for the sheet; this ADR is the deviation record for the heading and note.
- No change to the Client Portal's own line-up screen, which does not list buffer staff as such.
