# ADR-0104 · `.tbl-frame`: a wide or long table scrolls inside its card

**Status:** Accepted · **Wireframes:** `wireframes/assets/thc.css`, `wireframes/design-system.html` §7b, `backoffice/events.html` and `reports.html` use it · **§1.2, §1.6**

## Context

ADR-0030 let a table wider than its card scroll from 1024px down. Above that width the card clipped it: on `/events` Status and PO were cut off and a title wrapped to four lines, and the same fault showed on Reports, the client card and other Back Office tables. An overlay scrollbar (macOS) also hides until you scroll, so a clipped column looked like a bug.

## Decision

1. A new class, `.tbl-frame`, wraps a `<table class="tbl">`. It scrolls in both directions inside the card, keeps the header row sticky, always draws its scrollbars, fades the edge where more is hidden, and is focusable (arrow keys scroll it; cyan focus ring). Height is `--frame-max` (default: viewport less page chrome).
2. Modifiers: `.floor` gives each text column a 5rem minimum and snug cell padding (the table is never squeezed below `44rem`); `.flow` keeps the sideways scroll but lets the frame be as tall as its rows, for a short table in a page that already scrolls.
3. In React, `<TableScroll label="...">` renders `.tbl-frame.floor` as a `role="region"` with that `aria-label`, and `flow` adds `.flow`. Without a `label` it is the old phone-only `.table-scroll`. A `.card-rows` table inside a frame still becomes a stack of cards below 760px and the frame stands down there.
4. The wireframes carry the same class (tokens only), `design-system.html` §7b shows every variant, and the Back Office gallery has a "Table frame" panel.

## Consequences

- New wide tables use `TableScroll label`; nothing is clipped by a card's rounded corners at any width.
- Colours, radii and spacing come from tokens; `styles.test.ts` covers the stylesheet.
