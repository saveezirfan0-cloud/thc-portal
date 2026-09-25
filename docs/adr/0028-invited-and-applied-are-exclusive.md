# ADR-0028 · A worker is Invited or Applied on a section, never both

Status: accepted · 26.09.2026 · records what 20260922140000 built; raise with THC (docs/15)

## Context

- §3.3: "A worker already in Invited who also self-applies is not duplicated
  into Potential pool — the marker shows on their existing Invited entry
  instead (confirmed 04.09.2026)."
- §8 N10 fires "whether the manager picks the applicant manually from the
  Potential pool, or auto-assign/first-to-confirm fills the role while the
  application is still pending".
- As built, `(shift_id, staff_id)` is unique on `bookings`, `apply_to_shift()`
  answers `already_has_booking` for any live row (an invitation included), and
  `invite_worker()` refuses a worker who already holds a row. The state §3.3
  describes — an Invited entry carrying an Applied marker — cannot exist, and
  N10's second route has nothing to fire on: an invited worker who wants the
  shift presses Accept, which is not an application.

## Decision

- **Invited and Applied stay mutually exclusive.** A worker holding an
  invitation who opens the shift on Radar is told they already hold it, and
  accepts or declines the invitation; the board shows the row once, in Invited.
  The §3.3 marker is not implemented and N10's first-to-confirm route is moot.
- **Why**: one row per (section, worker) is what keeps every count on the board
  (fill, invited, applied) and every idempotency key honest; a marker on an
  invited row would be a second application state carried on a different
  status, and `accept_invite()` would then have to decide whether an Accept is
  "an application accepted" (N10) or "an invitation accepted" (no push) from a
  flag rather than from the row's status.
- **What THC is asked** (docs/15): whether the marker matters to the office
  beyond knowing the worker is keen. If it does, the cheap form is
  `bookings.applied_at` stamped on an invited row by `apply_to_shift()`
  (status unchanged) and rendered as a chip — no N10 change.

## Consequences

- `510_accept_application` keeps pinning "no N10 on an accepted invitation".
- The Staff App's `already_has_booking` copy stays as it is: the shift is
  already theirs to accept.
