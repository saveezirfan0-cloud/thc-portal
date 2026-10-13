# ADR-0124 · Qualified staff: a worker's roles open in a pop-up

**Status:** Accepted · **Departs from:** `wireframes/backoffice/client-card.html` block 3 · Scope §9.7 · **Owner request:** 13.10.2026

## Context
Block 3 of the client card lists every worker cleared at the client, grouped by role, and the wireframe puts every role the worker holds at this client in the "Role(s) at this client" column as chips. The wireframe's workers hold one or two roles. Real workers hold up to eighteen, so each row ran to four lines of chips and the same wall repeated in every group the worker appears in. The owner asked for the roles to be hidden behind a click.

## Decision
- The column shows one chip-styled button, **N roles** (`1 role` for one). Hovering it shows the list as a tooltip.
- Clicking it opens a modal, **Roles at this client · {worker}**, with every role as a chip. The group the row sits in is highlighted (cyan), because that is the role the row's Remove and Do not return act on.
- Nothing else changes: the data, the counts, Remove (still per group row) and Do not return.

## Consequences
- Rows are one line high again; the roles are one click away.
- The column header is unchanged.
