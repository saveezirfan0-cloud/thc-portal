# ADR-0035 · Client Portal: an "Add to calendar" file and an overnight marker

**Status:** Accepted · agreed with the client 25.09.2026
**Scope:** §11.2 (event page), §1.8 (time display), §11.1 (no money) · **Builds on:** ADR-0004 / ADR-0026 (the client reads only through `client_*` views)
**Code:** `apps/client/app/client/format.ts` (`daysLaterIn`, `dayMarker`), `apps/client/app/client/EventWindow.tsx`, `apps/client/app/client/ics.ts`, `apps/client/app/client/events/[id]/CalendarButton.tsx`, tests `apps/client/app/client/__tests__/format.test.ts`, `event-window.test.tsx`, `ics.test.ts`, `calendar-button.test.tsx`

## Context

Two requests from the client, neither in the scope's text, both presentation only.

1. **Overnight windows read as backwards.** A role running 17:00 – 01:30 shows as "17:00 – 01:30 UK time", and nothing says the end is the next morning. The "your time" line (§1.8) makes it worse: 07:00 – 23:30 in London is 10:00 – 02:30 for a reader in Dubai, so the UK line is one day and the reader's line is not. A marker has to be judged per line, in that line's own zone.
2. **Customers copy events into their calendars by hand.** They asked for a file their calendar can import from the event page.

## Decision

1. **Overnight marker.** Each line of a scheduled window gets " (+1 day)" (" (+2 days)" and so on) when its end falls on a later calendar day than its start in that line's own zone. The UK line is judged in Europe/London and the "your time" line in the reader's zone, independently. The day count compares the zone's calendar dates, not elapsed hours ÷ 24, so the 23- and 25-hour days at the BST↔GMT changes are counted correctly. The marker goes at the end of the line: "17:00 – 01:30 UK time (+1 day)".
   - `EventWindow` renders its lines itself rather than through `ScheduledWindow` (packages/ui), which has no place for a marker on its "your time" line. It keeps that component's hydration approach: the zone comes from `useViewerZone`, so the server render and first client paint are the UK line alone, and the UK marker is computed in Europe/London on both sides.
   - The rule stays in the portal. If the office or staff app wants the same marker, `ScheduledWindow` should grow a per-line marker option and `EventWindow` should go back to it.
2. **"Add to calendar"** in the event page's header, beside the document download. The browser builds an RFC 5545 file from the event the page already holds. No request is made and no view or policy is added, so ADR-0004 is untouched.
   - `UID:{eventId}@thehospitalitycompany.co.uk`, so a re-download updates the same calendar entry rather than adding a second one.
   - `DTSTART`/`DTEND` are the event window (RULE-18: earliest role start to latest role end) in UTC (`Z`). No `VTIMEZONE` is needed, and the calendar shows the reader's own zone.
   - `SUMMARY` is the event title. `LOCATION` is the venue name and address. `DESCRIPTION` is the PO number, if there is one, and "Line-up: {origin}/client/events/{id}".
   - TEXT escaping (`\\ \; \, \n`), 75-octet folding that never splits a UTF-8 character, CRLF line endings, and a `DTSTAMP` of when the file was made.
   - Downloaded as `{title}.ics` through a Blob. Characters a file system refuses are replaced.
   - **No worker names and no money.** The file leaves the portal for whatever calendar the client syncs and shares, and the line-up changes after it is saved. The link is the way to see who is coming. The builder reads only the fields it names, and a test pins the file's property list.
   - Not offered for a cancelled event.

## Consequences

- A saved calendar entry does not follow later changes to the event's times. Downloading again replaces it (same UID) in calendars that honour UIDs on import.
- The calendar entry covers the whole event window, not each role. A customer with an early-start role sees the event from that start.
- The header has one more button. On a phone the header's action buttons need to wrap onto their own lines. That is a `client-portal.css` rule (`flex-wrap: wrap` on `.ehead .actions` in the phone breakpoint).
