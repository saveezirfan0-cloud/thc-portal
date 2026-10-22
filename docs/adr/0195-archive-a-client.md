# ADR-0195 · Archive a client

**Status:** Accepted (owner request, 22.10.2026). An addition to scope v1.6 §9.7; not in the wireframes (this ADR is the deviation record). The database half shipped first as `20261022210000_archive_clients.sql`, whose header calls it "ADR-0185" by mistake: ADR-0185 is security-cleared events. This is the decision record for that migration and for the screens that use it.

## Context

§9.7 says a client record cannot be removed, only edited. The directory had no way to retire a client THC no longer works with, so every client ever added stayed on `/clients` and in the Shift Builder's picker as if it were live.

## Decision

1. **Archive, not delete.** `archive_client()` and `restore_client()` (office only, audited as `client.archived` / `client.restored`) set and clear `clients.archived_at` / `archived_by`. Nothing is removed: the rate card, qualified staff, events, invoices and History stay, and Restore undoes it. §9.7's "no delete" still holds (`280` still asserts the absence of `delete_client`).
2. **A client with an event today or later (not cancelled) cannot be archived** (`client_has_upcoming_events`): the office finishes or cancels those first. Archiving an archived client, or restoring a live one, is a no-op and audits nothing.
3. **The client card** (`/clients/:id`) has **Archive** (behind a confirm that says what stays) or **Restore** beside Edit, for any office login that can write; a viewer sees neither. An archived card says so, and its "+ New event for this client" is not drawn.
4. **`/clients`** hides archived clients by default. A **Status** filter (active / archived / all, in the URL) shows them, marked "Archived"; the top bar counts the live ones and says how many are archived.
5. **The Shift Builder** does not offer an archived client for a new event (`/events/new`). The edit page (`/events/:id/edit`) keeps the event's own client in the picker. The database says the same (`events_client_not_archived`): a new event, or an event moved to another client, is refused with `client_archived`; an event the client already has stays editable, and every events list and filter still names it.
6. **Nothing reaches the client role.** It holds no table policy (ADR-0026) and its views name their columns. A Client Portal login for an archived client keeps working and still sees its past events.

## Consequences

- Archiving is the office's call alone; the client is not told.
- A client who comes back is restored, not re-created, so its rate card and qualified pool are still there.
- Tests: vitest `clients/__tests__/archive.test.tsx`; pgTAP `928` (26 assertions); `892` already pins both functions.
