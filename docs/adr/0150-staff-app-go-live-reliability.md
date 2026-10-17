# ADR-0150 · Staff App go-live: live check-in location, presses that never hang

Status: accepted · 17.10.2026

Scope v1.6 §5.1, §10.4, §10.5 · `wireframes/staff/shift-detail.html` ·
`apps/staff/app/shifts/[id]/{ShiftScreen,actions,messages}.ts(x)` · `apps/staff/lib/geo.ts` ·
`apps/staff/app/_lib/stale-deploy.ts` · `apps/staff/app/_components/ActionButton.tsx`

## Context

The go-live performance audit of the Staff App found three ways the shift screen fails a worker
at the door:

- It took **one** location reading when it opened. A worker who opened the shift on the bus, or
  whose reading timed out in a basement, stood inside the geofence with a greyed-out
  "Check in — verify GPS" until they reloaded (audit B4) — and that turns into Late and
  No-show records.
- A press whose answer was lost (venue signal, a gateway timeout) left the button reading
  "Checking in…" for good (audit B5).
- Next gives every server action a new id on each build. A phone kept awake on the shift screen
  since before a deploy had every press and every location ping refused, so an off-site
  check-out found no ping trail and fell to RULE-02 (audit B5).

## Decision

- **The location follows the worker during the check-in window.** In the `check_in` phase the
  screen runs `watchPosition` (high accuracy, readings up to 5 s old, no timeout) and stops it
  once checked in, where the 2-minute pings take over. Before the window it keeps the single
  reading it always took. Nothing about the rule changes: the press still takes its own reading
  and `attempt_check_in()` re-checks the geofence, the window, the 30-minute grace and the
  No-show lock with it; off-site check-out still uses the last on-site fix.
- **"Refresh location"** — a small outline button under the GPS line, before and during the
  check-in window only — takes a new reading on demand. The wireframe draws no such control;
  this is the one visible addition. While it reads it says "Finding you…".
- **A press that gets no answer** frees the button and says, in the coral alert the screen
  already uses: "We couldn’t reach THC — check your signal and press again. It’s safe to press
  twice." It is safe: `attempt_check_in` answers `already_checked_in`, `check_out`
  `already_checked_out`, `start_break` `already_on_break` and `finish_break` `not_on_break`,
  so a repeat records nothing twice. The list buttons (`ActionButton`) show a "That didn’t go
  through" dialog instead of throwing to the error screen; they make no "twice is safe" claim.
- **A press or ping refused as an unknown server action reloads the page** onto the new build,
  at most once a minute (a `sessionStorage` guard), so a broken deploy cannot loop.

## Consequences

- A worker who arrives with the screen already open sees the button turn on, and the today
  card's auto check-in goes, without touching anything.
- The watch costs battery only while the screen is open in the 30-minute window before the
  start (or until the lock for a late booking).
- Vercel Skew Protection would let an old page keep talking to its own deployment instead of
  reloading; it is a project setting, not code, and is left to the operator.
