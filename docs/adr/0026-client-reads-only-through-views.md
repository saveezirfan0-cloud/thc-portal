# ADR-0026 · The client role holds no table policy at all

Status: accepted · 26.09.2026 · amends ADR-0004's "today `events` and `feedback`" sentence

## Context

- ADR-0004 gave the Client Portal owner-rights `client_*` views that filter by
  `client_portal_visible()` and name their columns, and said a client policy may
  exist only on a table carrying no money and no worker personal data —
  "today `events` and `feedback`".
- Both of those policies outlived the design. `client_events` on `events` was
  row-wide and `authenticated` holds every column of the table, so a customer
  session could read `auto_assign` (§11.2: the selection process, including the
  Auto Invite toggle, "stays internal to THC and is not shown in the portal"),
  `pays_buffer` (§9.7: whether the client is charged for buffer staff),
  `pays_breaks`, `notes`, `cancel_reason` and `payroll_exported_at`. The portal
  had read `client_events_v` (eleven named columns) since 0009.
- `client_feedback_insert` on `feedback` checked role, author and tenancy and
  nothing else, so a direct `POST /rest/v1/feedback` could rate a worker before
  the event started or a worker not on the confirmed line-up, with a staff id
  read off `client_lineup_v.photo_path`. `submit_client_feedback()` already
  enforced both gates (§11.2).

## Decision

1. **No table carries a client policy.** 20260926110000 drops `client_events`
   and `client_feedback_insert`. Every client read is a `client_*` view; the one
   client write is `submit_client_feedback()`. `001_rls_guard` assertion 5 now
   pins the empty set, and `020_rls_client` asserts the events row is
   unreadable and the direct feedback insert is refused.
2. **The RPC checks the caller first.** `submit_client_feedback()` refuses a
   non-client before it reads a row, and its two row refusals (unknown or not
   confirmed; another customer's) are one sentence, so a probe learns nothing
   about a booking id.
3. **Rule (d) is restated on the one view that missed it.**
   `client_event_documents_v` is revoked from `authenticated` and re-granted
   SELECT only.
4. **`client_lineup_v.photo_path` carries `staff.id` as its first segment**
   (the photos bucket keys objects by owner). This is accepted, not hidden: the
   id reaches nothing — `staff_caller()` refuses it, `staff_writer()` refuses it
   for every write, feedback is keyed on `booking_id`, and no client policy
   exists on `staff`. The view's comment now says so instead of claiming the id
   is absent. Resolving the path server-side would add a service-role RPC for
   no reduction in reach.

## Consequences

- Office views that were readable to a client only through the `events` policy
  (`venue_upcoming_events_v`) now return nothing to a client, which is the
  ADR-0004 shape anyway (`080_venues_directory`).
- A future table that a customer must read gets a `client_*` view, never a
  policy — there is no longer an "except these two" to extend.
