# ADR-0076 · Add a client or venue from the Shift Builder

**Status:** Accepted (owner request, 29.09.2026). A deviation from `wireframes/backoffice/shift-builder.html`; §3.2 and §9.7 / §9.11 are unchanged.

## Context

§3.2 begins an event with "client → venue", both picked from a list. A new customer or a new site is exactly when a manager is building their first event, and the only way to add either was to leave the builder for `/clients` or `/venues`, then come back to a form whose title, roles and times were gone.

## Decision

Two buttons in the builder's first panel, **+ New client** and **+ New venue**, each under its field's hint. They open the **same modals** as `/clients` (§9.7) and `/venues` (§9.11), unchanged, over the form:

- No second implementation of either form, and none of their rules is copied: every client field stays mandatory, the pin is reverse-geocoded, the radius is a slider pre-filled from the venue type.
- `create_client` and `create_venue` already returned the new `uuid`; the two server actions now pass it on (`{ ok: true, id }`). Nothing in the database changes, so RLS stays the gate: a role that cannot write clients or venues is refused as it is on the directory screens.
- On save the builder refreshes its reference lists and, once they carry the new row, selects it. Picking a new client runs the ordinary `pickClient`, so its on-site contact pre-fills the event.
- The rest of the form is untouched by the modal opening or closing.
- A client created this way has no rate card yet (§9.7 adds it on the client card). The builder already allows a charge rate typed per role, so nothing blocks the event.
- The buttons are absent when the builder is read-only (event started or cancelled, §3.2), and the venue button is absent if the venue types could not be read.
- The venue modal, which carries the map, is loaded only when it is asked for.
