# ADR-0033 · The show-rate is computed from attendance

Status: accepted · 29.09.2026 · audit 25.09 D7 · THC may change how resolved and
non-No-show violations count (docs/15)

## Context

`staff.reliability` — the show-rate, 30 % of the auto-assign score (§6) and
the "show-rate penalty" of BG-03 and §9.5 — was seeded and never written again.
A worker who missed every shift kept the number they were created with, and
the heaviest scoring factor did nothing.

The scope names the show-rate in several places without a formula: §6 scores
`(reliability − 90) / 10 × 100`; §3.3 and §5.1 apply "the show-rate penalty"
at the automatic No-show; §9.5 says a violation "affects the show-rate" and
Resolve "removes or reduces the effect"; RULE-14 says a resolved No check-out
"stops counting against the worker's show-rate"; §3.6 and RULE-04 say declining
and an allowed cancellation have no show-rate effect.

## Decision

**Show-rate = attended ÷ due**, over the worker's bookings whose outcome is
decided:

- **attended**: status `worked` (checked in, or registered by Get back /
  Resolve on the No-show, §3.3) or `turned_away` (they came; the strict buffer
  sent them home, RULE-15), with no unresolved No-show on the booking;
- **missed**: any booking with an **unresolved** `no_show` violation — the
  automatic one at start + 30 (BG-03) or the manager's;
- everything else is not counted: a booking still waiting on its start or
  inside the grace, a declined invitation, an allowed cancellation, a
  withdrawal.

**90 until three bookings are decided.** 90 is the score's zero point, so a
newcomer is neither boosted nor penalised on one shift.

Stored on `staff.reliability` (numeric(5,2)) by `recompute_reliability()`,
kept current by two triggers — `bookings` (a status moving into or out of
worked / turned_away, a change of worker, an attended booking deleted) and
`violations` (any change touching a `no_show`, including the reclassification
to Late on Resolve) — and backfilled for every worker by the migration
(`20260929120100`). The rule itself is one function, `staff_show_rate()`.

## Open with THC

- **Other violation types.** Late, Left early, Left the geofence and an
  unresolved No check-out do not move the show-rate today. §9.5 says every
  violation "affects the show-rate"; how much each weighs is THC's decision.
  A weighted miss (e.g. an unresolved No check-out as half a miss) is a change
  to `staff_show_rate()` only.
- **Resolved violations.** A resolved No-show counts as attended when Get back
  registered an arrival, and drops out of the count when it was marked
  resolved without one. THC may prefer "resolved = no penalty at all" or a
  reduced penalty ("removes or reduces the effect").
- **Window.** All history counts. A rolling window (e.g. the last 20 decided
  shifts or 12 months) would let a worker recover; the scope does not say.
- The seed's demo reliabilities stand until a demo worker's attendance changes.
