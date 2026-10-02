# ADR-0080 · The Alcohol Policy column comes off the Allocation Timesheet

**Status:** Accepted, 02.10.2026 (THC) · **Supersedes:** [ADR-0074](0074-allocation-timesheet-autosend.md) §3 · **§11.3** · **Code:** `packages/pdf/src/sheet.ts` (`SHEET_COLUMNS`, `SheetRow`), `packages/pdf/src/SheetDocument.tsx` (`WIDTHS`), goldens in `packages/pdf/src/__tests__/__golden__/`, `wireframes/client/timesheet.html`

## Context

ADR-0074 §3 added THC's paper-form column **Alcohol Policy Understood and Agreed** as an eighth column after Hours Worked, always blank, for the worker to initial by hand on site. On 02.10.2026 THC said it can be removed from the timesheet.

## Decision

The column is gone from both states, the Allocation Timesheet and the Completed Allocation Timesheet. The sheet is back to §11.3's seven columns:

Photo · Staff Name · Start Time · Finish Time · Signature · Comments · Hours Worked

- `SHEET_COLUMNS` ends with Hours Worked, and `SheetRow` no longer has an `alcoholPolicy` field.
- The column widths go back to the wireframe's colgroup (52/196/74/70/118/130/74) scaled to 539 pt: **39/148/56/53/89/98/56**. That was the layout before ADR-0074.
- The rest of ADR-0074 §3 stays. That means the 8 pt body, the 7 pt headings, no hyphenation, and the two-line clamp on a long name. All of them still help on a printed form, and keeping them leaves the pagination proof untouched: twelve rows, the worst-case headings and the footer fit on one A4 page. `render.test.ts` still checks the page count and every page's MediaBox.
- The rest of ADR-0074 is unchanged: the names, the automatic D1/D2 sends, and every page being A4.

## Consequences

- Copies already issued keep the column as they were sent; they are never reissued (§1.7, ADR-0074). Any copy generated or downloaded from now on has seven columns.
- If THC wants an alcohol-policy acknowledgement back, it belongs with the worker's own records (for example a step in onboarding), not on a client document that only collects initials by hand.
