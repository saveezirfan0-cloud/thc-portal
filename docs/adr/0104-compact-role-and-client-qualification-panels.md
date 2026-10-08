# ADR-0104 · Compact role and client qualification panels

**Status:** Accepted · **Refines:** Scope §2.4, §9.6

## Context
The candidate profile's Documents step shows "Qualified role type(s)" beside "Client qualification". Both are used on every candidate, so the amount of explanatory text and the size of the pick lists were a cost paid every time: ~30 role tiles in a four-column grid, three lines of instruction, a select-all/clear/count row, clients already cleared still listed greyed with "already cleared", and a "Cleared at" list that spelled out every role against every client (49 chips for 7 clients).

## Decision
- Roles are compact toggle chips that flow and wrap (check mark when chosen), not 140 px tiles with a tick circle. The group counts go. The long instruction line and the standing note go; "Pick the role(s)…" shows only while none is picked, and the un-tick consequence shows only once there are client entries.
- The client picker lists only clients still to add (a client cleared for every held role is in "Cleared at", not offered again). Search, "Select all" and "Clear" share one row; the Add button appears only once something is ticked and reads "Add N clients". The explanatory copy (each client is cleared for every ticked role; auto-assign's first wave; clean shifts add entries) moves into tooltips.
- "Cleared at" shows a client cleared for every role held as one "All N roles" chip (× removes the lot); a partial set, or a Do not return, is still shown role by role. The duplicate "N clients · M entries" count is dropped (the panel header carries the client count).

## Consequences
- No data, rule or action changes: one entry per client + role (RULE-17) is still written and removed exactly as before.
- Departs from `wireframes/backoffice/candidate.html` (five-column `.rolepick` tiles); this ADR is the deviation record.
- The same chips are used by the role picker in the Accept step (shared `RoleGroups`). The staff-profile Client qualification tab is a table and is unchanged.
