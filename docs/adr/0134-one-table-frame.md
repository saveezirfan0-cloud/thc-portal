# ADR-0134 · One table frame: the page scrolls, the header sticks, actions stay in reach

**Status:** Accepted · **Supersedes:** the `.tbl-frame` of open PR #184 (its ADR-0104 number collides with main's and it made the card a second vertical scroller) · **Release audit:** `docs/20-release-audit-2026-10-14.md` L2, L6, L7, L15, L16, E-M1, D-M3 · **§1.2, §1.6**

## Context

A Back Office table wider than its card scrolled inside the card with its only scrollbar under the last row (7,216 px down on Venues), the right-hand columns — row actions, Fill and Status — cut with no cue, no sticky header and no pinned first column. A blanket `min-width: 6.5rem` on every cell made tables overflow even at 1440 px (/users, Financial, New Starter), long unbroken strings widened the page (wrapping was only turned on in the phone queries), and column widths jumped while a search narrowed the rows. ADR-0096 settled that the page, not a box inside it, is the scroller.

## Decision

1. **`<TableScroll>`** in `packages/ui` (`components/Table.tsx`) wraps every list table: `.tbl-frame > .tbl-scroll > table.tbl` plus `.tbl-hbar`. The frame **never scrolls vertically**.
2. **Header**: the header row is `position: sticky` under the top bar (offset measured from `.topbar`, 0 below the phone break where the bar is static). While the table also scrolls sideways the scroller is a scroll container in both axes, so the component moves the header by `--thead-shift` instead — same result, no second scroller.
3. **Wide tables**: wrap first (cells `overflow-wrap: anywhere`, no blanket floor, per-column hints `.col-xs … .col-xl`, a whole-table `--tbl-min`, default 36rem). When the table is still wider than its card it scrolls sideways with the **first column pinned left**, the **actions cell (`.cell-actions`, last) pinned right**, a fade on the side that has more, and a **scrollbar twin stuck to the bottom of the window**. The scroller is a focusable region named by `label`, so the arrow keys scroll it. Below 760 px a `.card-rows` table is still a stack of cards.
4. **Stable widths**: `fixed` sets `table-layout: fixed`, so column widths come from the hints, not from whichever rows a search left.
5. **Warm header band**: in warm the header row is a `--panel-2` band with rounded ends (`--r-band`, 0 in scope), inset from the card's edges, as the wireframe draws it.
6. **Filter height**: `.filters` on a filter row sets every input in it to `--filter-h` (the button height) instead of inline 28/32/42 px.
7. The wireframes carry the same classes (`wireframes/assets/thc.css`).

## Consequences

- Screens use `TableScroll` rather than `.table-scroll` or a bare table in a panel; a bare table in a panel still scrolls sideways as before (the Client Portal's are untouched).
- The pinned cells and the header are opaque (`--panel` / `--tbl-head-bg`), so a screen must not give `.tbl` cells a translucent ground of its own.
- `styles.test.ts`, `table-scroll.test.tsx` and `components.test.tsx` pin the frame; nothing here adds a colour or a radius outside `tokens.css` (one new radius token, `--r-band`, and one metric, `--filter-h`).
- Two states the wireframes do not draw come with the same package and are recorded here: the dashboard's "Upcoming events" lists the first 8 events of the ten days and then "Showing the first 8 of N events · See all in Events" (release audit m13), and /venues and /staff/requests get the Clients pager (10 / 25 / 50 / 100, ADR-0124), /staff/requests also a search by name or Employee ID (L4).
