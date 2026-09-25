# ADR-0030 · The Back Office on a phone

**Status:** Accepted · **Wireframes:** `wireframes/backoffice/*.html` (sidebar, tables) · **§1.2**

## Context

§1.2 asks for both web apps to work on a phone and a tablet. Measured at 390px on the deployed Back Office (and reproduced locally for every route):

- **The page was wider than the phone.** Scheduling laid out at 570px, Staff at 596px, the Event board at 745px, a staff profile at 591px, Reports at 409px. The causes were a handful of controls that never wrap: the toolbar filters' fixed inline widths, the event board's row of top-bar actions, a tab strip, the Reports date range. A phone then zooms out, so the top bar and every panel stop short of the right edge, and the table inside the panel is clipped.
- **Tables squashed.** Eight-column tables in a 350px card wrapped a name over three lines and a role chip off the edge, with most columns simply cut off.
- **The menu was a sideways-scrolling row of all twelve items**, half of them off screen with nothing to say they were there. Sign-out and the appearance switch had to be crammed into every screen's top bar, which wrapped to three lines.
- **Tablet (761–1024px)** clipped the appearance switch off the top bar and cut off the right-hand columns of every table.

`docs/07-design-system.md` planned a hamburger in the top bar under 820px, and the wireframes carry a `data-toggle-sidebar` drawer for it (`wireframes/backoffice/dashboard.html:44`). Nothing was built. This ADR records the deviation from both: a bottom tab bar with a More sheet instead of a hamburger drawer.

## Decision

1. **A phone tab bar, `PhoneNav` in `packages/ui`.** Below 760px the sidebar hides and a frosted bottom bar shows the four items marked `primary` in `OfficeShell`'s `NAV` (Dashboard, Scheduling, Compliance, Check-in: what a manager opens from a phone on the day) plus **More**. More opens a sheet with the whole menu grouped by the sidebar's dividers, who is signed in, sign out and the Light/Dark switch. More carries the total of any counter it hides, so a queue is never out of sight. A tab bar rather than a hamburger because the four most-used screens are then one tap away instead of two, and a bottom bar is where a thumb is.
2. **Icons on the menu.** Every backoffice wireframe draws a glyph per item (`▣ ◫ ▦ ◈ ◉ ☷ …`). The app had none, and a tab bar needs them. They are inline SVGs in `apps/office/app/_components/navIcons.tsx` with `currentColor` strokes, not the wireframes' characters, because iOS renders several of those as colour emoji. The desktop sidebar shows them too, as the wireframes do.
3. **`.tbl.card-rows`.** A list whose every row is a thing you open (events, staff, the review queue and radar, the live monitor and violations, clients, venues, roles, the student-visa view, the dashboard's upcoming list) becomes a stack of cards on a phone: `td.cell-title` heads the card, `td.cell-lead` (an avatar) sits beside it, and every other cell prints its column name, exactly as the header reads, from `data-label` in a reserved left gutter (a float, not a grid column, so a cell mixing text and tags cannot scramble). Everything else (reports, rate cards, qualifications, shift history) scrolls sideways inside its card, and from 1024px down so does every table in a panel.
4. **One-row top bar.** Title and the screen's own actions share the first line and wrap under it when they must. Crumbs and the zone note (§1.8) sit on full-width lines below. The bar is not sticky on a phone.
5. **Filters wrap.** In a `.toolbar` the search takes a line and the other controls share the next. The inline `style={{ width }}` the screens give their desktop controls is overridden with `!important` inside the phone breakpoint only. That is the one place it is used, and removing the inline widths from a dozen screens would have been a wider change for the same result.
6. **Month calendar.** Seven columns at 390px leave about 46px a day, so each event becomes a dot in its fill colour and the whole cell links to that day's Day view (`MonthView`'s `dayHref`).
7. **Safety net.** `.main` gets `overflow-x: clip` below 760px, so one element that fails to wrap in the future can no longer widen and zoom out the whole page. It is a net, not the fix: the sweep that found the causes was run with it switched off, and every route came back at 390px.

## Consequences

- ADR-0012's open deviation (a phone-only sign-out copy in the top bar) is closed: sign-out lives in the More sheet, as the foot does on desktop.
- On desktop: the sidebar gains its icons; the top bar may wrap onto a second line when a screen's actions do not fit beside the title (the event board's did not, even at 1280px); a month calendar's day number links to that day's Day view. From 1024px down, a table wider than its card scrolls inside it. Nothing else changes above 760px.
- A new list table opts into cards with `card-rows` plus `data-label` on its cells. A new wide table needs nothing: it scrolls.
- `chrome.test.tsx` pins the tab set and the counter on More.
