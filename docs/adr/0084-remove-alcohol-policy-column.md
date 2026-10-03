# ADR-0084 · Alcohol Policy column removed from the Allocation Timesheets

**Status:** Accepted (owner request, 03.10.2026: "can the alcohol policy be removed from the allocation timesheets - this is not required"). Reverses §3 of ADR-0074. Scope v1.6 §11.3 is unchanged: its seven columns are the format.

## Decision

The **Alcohol Policy Understood and Agreed** column is gone from both the Allocation Timesheet and the Completed Allocation Timesheet. The PDF is back to §11.3's seven columns: Photo · Staff Name · Start Time · Finish Time · Signature · Comments · Hours Worked.

- `SHEET_COLUMNS` has seven entries, and `SheetRow.alcoholPolicy` no longer exists.
- The freed 75 pt went back to the other columns, scaled from the wireframe's widths: 40/148/56/52/90/98/55 pt (539 pt in all, inside the 28 pt A4 margins).
- Body text stays 8 pt, headings 7 pt, no hyphenation and the two-line name clamp. These were ADR-0074 changes made to fit eight columns and are harmless at seven.
- `wireframes/client/timesheet.html` and the golden files in `packages/pdf/src/__tests__/__golden__/` are updated to match.

Pagination (12 rows a page), the footer, the names and the automatic sending from ADR-0074 §1, §2 and §4 are untouched. Nothing is stored for this column, so there is no migration.

## Not changed

PDFs already sent or downloaded keep the column exactly as issued; they are historical records and are never reissued (§1.7).
