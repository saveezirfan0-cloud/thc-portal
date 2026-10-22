# ADR-0185 · "Completed early" — a client-released early finish keeps the four-hour minimum

**Status:** Accepted · 22.10.2026 · **Changes:** §5.2 RULE-14 and §9.5 as written ("a logged
'Left early' Violation always blocks the floor, resolved or not") — a deliberate change from the
scope, listed as item 5 in `CLAUDE.md` · **Builds on:** ADR-0035 (D5 Left early), ADR-0184 ·
**Asked by:** THC's owner, 22.10.2026

`supabase/migrations/20261024110000_completed_early.sql` · pgTAP `928` ·
`packages/domain/src/pay.ts` (`leftEarlyState`), `pay.vectors.json` ·
`apps/office/app/checkin/` (`ResolveModal.tsx`, `actions.ts`, `data.ts`, `status.ts`)

## Context

Any check-out more than 15 minutes before the section's end raised `left_early`, and a
`left_early` blocked the four-hour floor for good. The system records when and where someone
checked out, not whether the job was done, so it could not tell a worker who walked off from one
the client sent home — and the minimum, which exists to protect the worker and THC when the client
sends someone home early, did nothing.

## Decision

1. **Two outcomes for an early finish.**
   - *Left early* (walked off, not released): paid and charged to the check-out — or, with no
     check-out, to the GPS exit (below). No minimum either side. Shows on the record.
   - *Completed early* (the client or site manager confirmed the job complete and the worker
     released): the **four-hour minimum applies in full**, pay and charge. It does not count
     against the worker.
2. **How it is told apart.** Any early check-out still raises `left_early`. The office records the
   client's / site manager's word with `release_early_finish(violation, source, contact, note)`:
   `source` is `client` or `site_manager` (a contact name is required, and it must fall inside the
   **release window**) or `office_override` (any time). That sets `violations.released_*`, closes
   the entry, and `payable_shifts_v` / `check_out()` / `staff_shift_detail()` stop treating that
   `left_early` as a floor blocker. No sign-off in the window (`left_early_release_window_h`,
   default **24**) means it stands as Left early. The state is derived (`left_early_state()`:
   `pending` → `left_early` after the window, or `completed_early`); no job flips it.
3. **Capture is the office's.** The Client Portal stays read-only (CLAUDE.md, ADR-0004): the
   office or site manager records the sign-off in the violation window. A one-tap client button is
   a later, separate decision.
4. **While pending, pay is today's.** A pending or defaulted Left early is priced exactly as
   before (no floor). A release later adds the minimum; if the shift is already in a payroll
   export the existing RULE-06 warning ("notify Finance") shows — exports are never corrected.
   *Default — raise with THC:* the alternative is holding such shifts Pending for 24 h.
5. **GPS exit without a check-out is a walk-off.** When BG-09 (or a locked press) would raise
   *No check-out* for a booking with a mid-shift `left_geofence` and a recorded last on-site fix,
   `settle_geofence_exit()` (BEFORE INSERT on `violations`) closes the shift at that fix and
   raises a Left early instead — no No check-out row, no manager-typed finish, no floor. The
   office overrides it with the same release action. This relaxes RULE-02's "no silent default"
   for this one case; a missing check-out with **no** geofence exit is unchanged (unresolved No
   check-out; resolving it restores the floor).
6. **No history is re-priced.** Only a *new* release changes a figure; nothing existing is released.

## Consequences

- `payable_minutes()` / `payableMinutes()` are unchanged: their left-early input now means
  "an UNRELEASED Left early". `pay.vectors.json` gained the released case.
- The Check-in monitor and the staff Shifts tab label a released entry "Completed early" and a
  pending one "Left early · awaiting sign-off".
- The invoice's sign-in log still shows the clock-based "left early" flag for a released shift
  (it is a time fact); only the money changed.
- *Not done:* a notification to the office when a window closes, and the Staff App wording.
