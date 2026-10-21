# ADR-0185 · A client can be archived, so it stops showing as active

**Status:** Accepted · 22.10.2026 · **Changes:** §9.7 ("there is no Delete action; a client record
cannot be removed from the system, only edited") — **extends** it, does not break it: archiving
removes nothing and Restore undoes it · **Builds on:** ADR-0060 (a viewer changes nothing),
ADR-0055 (History), ADR-0026 (the client role reads only through views) · **Asked by:** the office,
21.10.2026

`supabase/migrations/20261022210000_archive_clients.sql` · pgTAP `922` (and `892`) ·
`apps/office/app/clients/` (`ClientsScreen.tsx`, `[id]/ArchiveClient.tsx`, `[id]/actions.ts`) ·
`apps/office/app/events/` (`data.ts`, `_components/ShiftBuilder.tsx`, `new/page.tsx`, `actions.ts`)

## Context

The Clients list showed every client ever added as if it were live. §9.7 forbids removing a client,
so a client THC no longer works with stayed on the list for good, in the search results and in the
Shift Builder's picker.

## Decision

An **archive flag**, not a delete. `clients.archived_at` (and `archived_by`) is null while the
client is live.

- **Who:** the office, through `archive_client()` and `restore_client()` (`current_app_role()`
  admin; a viewer is refused by `office_read_only`). Both are audited on the client's History as
  `client.archived` / `client.restored`, and a repeat is a no-op.
- **When it is refused:** while the client has an event **today or later that is not cancelled**
  (`client_has_upcoming_events`). Past and cancelled events do not block. The card says so up front
  rather than offering a button the database would refuse.
- **What it hides:** `/clients` shows **active** clients by default; *Show: archived* and *all* are
  one select away, and an archived row carries an *Archived* chip. The Shift Builder's client
  picker omits an archived client (one already chosen on an event being edited or duplicated
  stays, marked "(archived)"), and `/events/new?client=` ignores one.
- **What it stops:** a **new event** for an archived client, and moving an event to one — a
  `before insert or update of client_id` trigger on `events` raises `client_archived`, the same line
  for any caller. An edit that leaves the client alone is not checked, so events the client already
  has stay editable.
- **What it leaves alone:** everything else. The rate card, qualified staff, events, invoices,
  History, the `/events` client filter and the Client Portal login are untouched — an archived
  client's customer can still sign in and see their events. `clients_directory_v` gains
  `archived_at` and keeps returning archived rows; hiding them is the screen's default.

There is still no `delete_client` (asserted by `280`).

## Consequences

- **Provisional:** whether an archived client's Client Portal login should stop working was not
  decided; it keeps working. Say if archiving should also lock the portal.
- Archiving is per client, not per venue or per rate-card role.
- `packages/db/src/types.generated.ts` carries the new columns, the two functions and the view
  column, added by hand on 22.10.2026 because the file was already behind the schema (it has no
  invoice columns, for one). `pnpm --filter @thc/db gen:types` brings the rest up to date.
- Applied to the live project (`THC Portal`) on 22.10.2026 as `20261022210000_archive_clients`,
  in four steps with the `events` trigger last; checked there with a rolled-back run of the same
  cases `922` asserts. No client was archived by the check.
