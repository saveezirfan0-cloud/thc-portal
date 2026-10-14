# ADR-0138 · The invite list filters by group and status, and exports what it shows

**Status:** Accepted · **Refines:** ADR-0107 (the invite list), ADR-0123 (its report) · **Owner request:** 14.10.2026

## Context
The owner asked for "the list of staff of SpudBros who still haven't applied", then for that to be an option on `/staff/roster`, "to filter and export". The page listed every row still on the invite list, both groups mixed, with no way to narrow it or take it away. Getting the SpudBros people who had not applied meant writing SQL by hand.

## Decision
- **Filter**, above the list, kept in the address bar with `useListQuery` (release audit L1), so a filtered list can be reloaded, shared and exported:
  - **Group:** all, SpudBros Express, THC (`?grp=`);
  - **Status** (`?status=`), from `invite_roster_report()`. Each row has exactly one, and the first that fits wins:
    - **Applied · no Payroll ID:** somebody applied with the listed email (`applied`);
    - **Possible match:** somebody of the same name applied under another email (`matches`), so they probably have applied;
    - **Not applied:** neither of those.

    Each option shows its count within the chosen group. "Not applied" is therefore stricter than the "Not applied" tiles, which still count possible matches;
  - **Search** by name, email or Payroll ID (`?q=`).
- **Export CSV** links to `GET /staff/roster/export` with the same query. The route reads through `loadRosterPage()` with the caller's session, the screen's own read (`admin_read`, `assert_office_caller()`), filters with the same `list.ts`, and sorts by surname. Columns:
  - First name, Last name, Email, Payroll ID, Group, Status;
  - Applied as, Applied with email (for a possible match);
  - Reminders sent, Last reminder (UK), Reminder not delivered;
  - Invited on (UK).

  The file has a BOM and CRLF line ends, and every cell is defused against formula injection (`textCell`), as `/activity/export` is. It is named after the filter, e.g. `invite-list-spudbros-not-applied-2026-10-14.csv`. If the report cannot be read, the route returns 503 instead of a file, so nobody gets a Status column that wrongly calls everyone "Not applied".
- "Clear all" still clears the whole list, not just the filtered rows: it is the existing action and is not changed here.
- There is still no wireframe. This extends the deviation recorded in ADR-0107 and ADR-0123.

## Consequences
- No database change: the filter and the export read only what the page already reads.
- vitest `app/staff/roster/__tests__/list.test.ts`.
