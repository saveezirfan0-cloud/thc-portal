# ADR-0170 · The events list shades alternate days

**Status:** Accepted (owner request, 20.10.2026). A deviation from `wireframes/backoffice/events.html`, which draws the List view as a plain `.tbl`. Scope v1.6 §3.1 says nothing about list row styling.

## Context

On the Back Office `/events` List view, a busy period runs to dozens of rows, and where one day ends and the next begins was only readable from the Date column. The owner sent a screenshot of a week's list and asked: "Days were separated by different shades of colour before on the List view, so it was easier to distinguish each day. Can each separate day be distinguished by different shading".

## Decision

1. **Shade by day, not by row.** Every event on one date shares a shade, and the next date flips it. `ListView` gives the rows of every other date the class `day-alt`. The first date in the list is unshaded. The rows are always in date order (`toEventRows`), so a change of date in the list is a change of day.
2. **The table-stripe token.** A shaded row takes `--panel-2`, the token that already exists for table stripes, so it follows both modes. It does not need a new colour.
3. **Pinned cells and hover.** The pinned date and title cells (ADR-0136) take the shade through `--pin-bg`. Hover still lays `--row-hover` over it, so a hovered row shows on either shade.
4. **Phone.** Below 760px each event is a card (`card-rows`). The whole card takes the shade, not each of its cells as separate strips (as `tr.barred` on the staff profile does).

## Consequences

- In warm style the header band is also `--panel-2`. When the sticky header scrolls over a shaded day, the two read as one colour. That was accepted rather than adding a token for it.
- The Today flash (`landed`) animates back to the cell's own colour, so it settles on the shade. The short-staffed flash (ADR-0132) is on the fill pill and is not affected.
- Vitest: `apps/office/app/events/__tests__/list-day-shading.test.tsx`.

## Not done

- The Month, Week and Day views are unchanged. They already separate days by cell, column and page.
- The wireframe is not redrawn; this ADR records the deviation.
