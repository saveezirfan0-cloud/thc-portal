# ADR-0048 · My shifts keeps only live shifts; the rest fold into "Past shifts"

Status: accepted · 25.09.2026 · Staff App `/shifts`; amends `wireframes/staff/shifts.html`

## Context

A phone screenshot showed a shift from 11 Sep still on My shifts as "Confirmed", above
today's shift, and the Shifts badge counting it. No-show is a violation, not a booking
status (§5), so a booking nobody checked into stays `confirmed` for ever; `staff_bookings()`
returns every booking (a stale push must still find its row); the screen drew a green
"Confirmed" pill for any card, past ones included; and `shiftsBadge()` counted every
confirmed or worked booking ever made.

## Decision

1. A shift stays on My shifts until its check-out window closes (end + 4 h). A No
   check-out never leaves until a manager resolves it (§10.4).
2. Live shifts are grouped Today · Tomorrow · This week (rest of the Mon–Sun week the
   hours meter measures) · Later, by UK calendar day, with "Earlier" for an overnight or
   No check-out still inside its window.
3. Everything after the cut-off folds into a collapsed **Past shifts · N**, newest first,
   one line each. A past booking with no check-in reads "Not checked in", never
   "Confirmed". Pay for completed shifts stays under Profile → Payment information.
4. `shiftsBadge()` counts exactly the live list.

The wireframe draws only live cards; the collapsed section is the addition.
