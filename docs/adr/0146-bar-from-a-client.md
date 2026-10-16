# ADR-0146 · Bar a worker from a client in one step, entry or not

**Status:** Accepted · **Refines:** §9.6 (Do not return), §9.7 (qualified staff) · **Owner request:** 15.10.2026

## Context
§9.6 puts the **Do not return** switch on a worker's client qualification entry, and the table keeps the flag on that row (`client_qualifications.do_not_return`). A worker who has never been cleared at a client has no row there, so the screen had no switch. The office asked how to keep a worker off a client and could not find the switch. The only route was **+ Add client** first, then the switch on the new row. That reads as clearing someone for the very client they are being kept away from, and lifting the bar later left that clearance behind.

## Decision
- **Bar from a client** on the profile's Client qualification tab: pick any client and give a reason (required, as for the switch). It is there even when the worker is cleared nowhere.
- `bar_from_client(staff, client, reason)`, SECURITY DEFINER, Back Office only, audited as `do_not_return_on`:
  - worker has entries at the client → all of them are barred, exactly as the switch on any one of them does;
  - no entry → **one bar-only row** (`client_qualifications.bar_only`, always `do_not_return`, a CHECK holds it). Its `role_id` is only a key (one of the worker's roles, or any role if they hold none).
- Every gate already reads "any `do_not_return` row at this client", and Wave 1 reads "a row for this role without `do_not_return`", so a bar-only row bars and never qualifies. No gate changed.
- A bar-only row never turns into a clearance nobody gave:
  - switching Do not return **off** deletes the client's bar-only rows (`set_do_not_return`), so the worker goes back to uncleared;
  - **+ Add** (`grant_client_qualification`) over a bar-only row turns that row into the manager's entry: role, grantor, date. It stays barred, with the reason kept. "+ Add" has never lifted a bar;
  - the automatic grant after a clean shift never runs at a barred client, and Remove refuses any barred row.
- The screens show a bar-only row as **All roles** · "barred by … — not cleared here". On the client card these rows sit in their own group, "Do not return · not cleared here", outside every role counter.

## Consequences
- One column, one function, two function bodies and two views (columns appended) in `20261015150000_bar_from_client.sql`. pgTAP `845_bar_from_client.sql`; vitest `barFromClient.test.tsx`, `actions.test.ts`, `card.test.ts`, `qualifiedStaff.test.tsx`.
- Barring does not cancel a booking the worker already holds at that client. The dialog says so. Cancel it from the event board.
- The client card has no "bar a worker" button yet; a bar is set from the worker's profile. The wireframe `backoffice/staff-profile.html` shows the button.
