# ADR-0144 · The invite list links many "Applied · no Payroll ID" rows at once

**Status:** Accepted · **Refines:** ADR-0143 (why no Payroll ID, and Link), ADR-0123 (Link) · **Owner request:** 15.10.2026

## Context
ADR-0143 put the reason and a Link on each "Applied · no Payroll ID" row. On 15.10 there were 18 such rows, almost all "Name differs from the sheet". Settling them meant 18 clicks on Link and 18 browser confirmations, each in a long, paged list. The owner asked to "add options here and make it easier".

## Decision
- **An "Applied, no Payroll ID" panel**, under "Applied under another email", shown only while there are such rows. Each row shows:
  - the sheet's name, email and group;
  - the name they applied with (linked to their profile) and their stage;
  - the Payroll ID on the sheet;
  - why, as a pill. Rows Link cannot settle (ADR-0143) are coral and say what to put right, with the holder's profile for a taken ID.
- **Tick boxes, for owners and managers.** A row Link cannot settle has none. Three helpers sit above the table:
  - **Tick all safe:** every row Link settles with no question (already has it, no Payroll ID on the sheet, not given yet);
  - **Tick all with a different name;**
  - **Clear ticks.**
- **Link ticked (N)** opens one confirmation. It says what Link does, and lists every ticked pair whose names differ ("Andrea Gaviria → Andreu Gaviria · 7053") so the office reads them all before saying yes.
- **One link at a time.** The server action `linkRosterEntries()` calls `link_invite_roster_entry()` for each ticked row, in turn. A differing name carries `p_confirm_name => true`, exactly as a single confirmed Link does. A refusal on one row does not stop the others.
  - Rows that are refused stay ticked and show why under their pill.
  - If the login itself may not link, the action stops at the first refusal and says so.
  - At most 1,000 rows at a time.
- The "Applied, no Payroll ID" tile now reads "Tick and Link them below".
- The single Link in the list (ADR-0143) stays.

## Consequences
- No database change: every row goes through the same function, checks and audit row (`roster.linked`, with `nameConfirmed`) as a single Link.
- 18 rows are 18 RPC calls in one server action, well inside the request time.
- vitest `bulk.test.tsx`, and `linkRosterEntries` in `actions.test.ts`.
- There is still no wireframe. This extends the deviation recorded in ADR-0107, ADR-0123, ADR-0138 and ADR-0143.
