# ADR-0151 · Void a violation

**Status:** Accepted · Scope §9.5, §3.6, RULE-02 · **Owner request:** 19.10.2026 (Leonardo Hotel St Paul's, 17–18 Oct)

## Context

On 19.10.2026 the office asked for nine violations to be removed from the Check-in list: three No check-outs, four Left the geofence and two Left early, on four bookings (Kumar Ayush, Manas Kumar, Vishal Kothakonda, Sarah Page). The four were booked onto the event by mistake.

There was no way to do it:

- **Resolve** (`resolve_violation`, §9.5) keeps the row, demands a note and, for a No check-out, a finish time that then makes the shift payable. It answers "what happened", not "this should never have existed".
- **Withdraw** is refused: the bookings are `worked`, and `worked → cancelled` is not an edge of the §3.6 machine (`bookings_state_guard`). `withdraw_booking` answers `checked_in`.
- **A plain DELETE** is undone within a minute. `booking_tick()` BG-09 raises No check-out for any booking with a check-in, no check-out and `end + 4 h` past, that has no No check-out row; BG-03 does the same for a No-show. The tick runs every minute.

Cancelling the bookings by disabling the state guard was rejected: the guard exists so nobody can rewrite what happened on a shift.

## Decision

- **`void_violation(violation, reason)`** — admin only, the reason mandatory (as for resolve, §9.5). It removes the violation and keeps it.
- **The row moves to `audit_log`** (`entity = 'booking'`, `action = 'violation.voided'`, the whole row in `data.violation`, with `type`, `staffId` and `reason`), through the internal `_void_violation()`. Nothing that reads `violations` changes — the Check-in list, `staff_show_rate`, the RULE-14 pay floor, the staff profile and directory, the payroll lines, the client views — because a voided violation is simply not there. No new table, so no new RLS surface; the viewer role is stopped by the existing audit and table triggers (ADR-0060).
- **`violation_was_voided(booking, type)`** is the tick's memory. `booking_tick()` is restated from 20260929100000 with one line added to BG-03 and one to BG-09; a type that was voided for a booking is not raised again. Nothing else in the tick changed.
- **The bookings are not touched.** They stay `worked`, with their check-in records. Pay is unchanged by this ADR: a voided No check-out no longer holds the shift as "unresolved", so what is payable for these four is Finance's call, not a side effect of voiding.
- **The nine violations are voided by the migration itself**, matched by id, so a database without them is unchanged. Reason: "Booked in by mistake (office request, 19.10.2026)". Applied through the normal deploy, not by hand, so `supabase db push` and production do not drift (the lesson of #263).

## Not done, on purpose

- **No Back Office button yet.** The function exists; a "Void" action beside Resolve on the Check-in list and the staff profile needs a wireframe decision (the confirm dialog, who sees it) and is its own PR.
- **No restore.** `audit_log` holds the whole row, so a mistaken void can be put back by hand; a Restore action was not asked for.
- **`attempt_check_in`, `check_out`, `office_mark_no_show` and `get_back` keep their own not-exists guards.** They run on a live press or an office action, not on a schedule, so they cannot re-raise a violation behind the office's back. If one ever must respect a void, it reads `violation_was_voided()`.
- **BG-10's N13 guard** (skip the break alert once a No check-out exists) is not extended: N13 only runs before `end + 4 h`, and a void happens after.

## Tests

`supabase/tests/850_void_violation.sql`: admin voids with a note; the row leaves `violations` and is whole in `audit_log`; a worker, a client and anon are refused; a note is mandatory; an unknown id is refused; the internal mover and the tick's memory are not callable by a signed-in role; and the tick raises No check-out and No-show for a control booking but not again for a voided one.
