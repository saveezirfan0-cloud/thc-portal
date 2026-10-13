# ADR-0127 · The events list shows the PO under the status, and long tables scroll inside their card

**Status:** Accepted · **Departs from:** `wireframes/backoffice/events.html` (List: separate Status and PO columns) · **Owner request:** 13.10.2026

## Context
On a laptop the `/events` list ran past the right edge of its card. The card clips its corners, so it clipped the table too: Fill, Status and PO were cut off and there was no scrollbar to reach them. With real data — long role names ("Day Waiting Staff M&E (Minus 2)"), long venue names and a "your time" line under every window for an office user outside the UK (§1.8) — the eight columns need more room than a 1440px screen gives the card. The browser squeezed every text column to its narrowest word instead ("Mon / 12 / Oct", an event title five lines tall). `/clients` had the same fault: "Added by" was cut off and "Breaks: unpaid · Buffer: strict" stood one word a line.

## Decision
- **Every table scrolls sideways inside its card, at every width** (`packages/ui`). Before this it scrolled only at 1024px and below, and was cut off above that. Text cells keep a readable minimum width (6.5rem; numbers and the avatar cell are exempt), so a table too wide for its card scrolls rather than squeezing its text.
- **Events list: the PO moves under the status** in one "Status · PO" column (`PO 4471-A`, or `No PO`), as the venue sits under the client. The search still covers the PO.
- **Events list column widths:** the date, window, fill and status never wrap. The event title gets a readable width. Client, venue and role names end in an ellipsis past a cap, with the full name on hover (`title`). The role windows use the compact `07:00–15:30` form the wireframe already draws. Cells use 12px side padding instead of 20.
- **Clients list:** each policy ("Breaks: unpaid", "Buffer: strict") and the date added are kept on one line. The client name gets a readable width. Cells use 12px side padding.
- **Phone (card) layout of the events list:** the role lines now use the card's full width instead of shrinking and centring each line.

## Consequences
- At 1440px both lists fit their card with real data. On a narrower screen they scroll inside the card; nothing is cut off.
- The wireframe still draws Status and PO as two columns. This ADR records the deviation.
