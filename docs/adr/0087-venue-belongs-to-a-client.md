# ADR-0087 · A venue can belong to a client, and its address follows the client into the Shift Builder

Status: accepted · 05.10.2026 · refines §3.2 and §9.11; raise with THC (docs/15)

## Context

- §3.2 builds an event "client → venue": the manager picks a client, then a venue from the
  whole Venues directory. The agency's own client list pairs each client with its address
  (Leonardo Hotel St Pauls → 10 Godliman Street; Hackney Town Council → five sites), but the
  schema had no client↔venue link, so every event meant choosing the address again — and a
  wrong choice sends every worker to the wrong place.

## Decision

- `venues.client_id` — nullable, `on delete set null`. A venue belongs to at most one client;
  a client may have many venues. A site two clients both use is entered once per client.
- The Venue modal (§9.11) gains an optional **Client** select; `create_venue` /
  `update_venue` take it as a trailing optional argument; `venue_directory_v` returns
  `client_id` and `client_name`.
- Shift Builder (§3.2), including `/events/new?client=<id>`: choosing a client whose venue
  list is exactly one applies that venue — address, type and geofence appear without a
  choice. A client with several venues still picks, with its own venues listed first. A venue
  that belongs to another client is cleared when the client changes. Editing a saved event
  never swaps its venue as a side effect (changing the venue re-confirms everyone booked,
  §3.5); the picker is only pre-filled when the event has none.
- Events still copy the venue's name, address, pin and radius at build time, so nothing
  already scheduled moves when a venue's client is changed.

## Consequences

- No new table and no new policy: `venues` stays admin-only (`001_rls_guard` is unchanged).
- Existing venues are untied until the office sets their client in the Venue modal.
- The addresses in the agency's client sheet are not loaded by this change: a venue needs a
  map pin for its geofence (§9.11), which the sheet does not carry.
