# ADR-0029 · Timing decisions the 26.09 audit round made in SQL

Status: accepted · 26.09.2026 · 20260926110400, 20260926110500, 20260926111100

Where §7 / §8 name a day but not an hour, or a bound the scope does not give,
this records the choice so the next reader does not re-derive it.

## 1 · N6 and N7 send times (§3.5, §8)

- §8 gives N6 "the day before (cutoff 12:00)" and N7 "on the day of the shift";
  neither was ever queued. `booking_tick()` now queues both, per booking, off
  the role section's own clock (RULE-18):
  - **N6** from **08:00 Europe/London the day before** until the 12:00 deadline,
    to a confirmed booking with no "I'm ready". Only where the booking was
    confirmed before the deadline: a later confirmation is exempt from the
    cutoff (§2 below), so there is no deadline to warn about.
  - **N7** from **08:00 Europe/London on the day, or two hours before the
    start, whichever is earlier**, until the start, to a confirmed booking with
    no on-the-day press and no check-in. A reminder only — nothing releases.
- 08:00 is the wireframe's morning (shifts.html) and a defensible hour to buzz
  a phone; a 06:00 shift is warned at 04:00, which the worker booked for.

## 2 · The 12:05 cutoff exempts a late confirmation (§3.5)

`release_unready_bookings()` skips a booking whose `confirmed_at` is at or after
`ready_deadline(starts_at)`. Without it the replacements the 12:05 re-fill
itself produced were released at 12:05 on the shift day with N6b "…removed
from your shift tomorrow…". `@thc/domain`'s `readyDeadlinePassed()` /
`shiftCard` should mirror it (listed for its owner).

## 3 · BG-10's bound is the check-out lock, not the scheduled end (§5.2b)

N13 fires up to **end + 4 h** and never once a No check-out violation exists.
§5.2b: the breaks block "does not disable or disappear if the shift runs
longer than planned"; the old `< ends_at` bound protected against prompting a
worker who had gone home without checking out, which is exactly the end + 4 h
lock.

## 4 · "Left the geofence" only during the section (BG-07, RULE-18)

`record_ping()` raises `left_geofence` on an inside→outside transition only
while `now() < sr.ends_at`. The ping is still stored (RULE-01's trail). A fix
after the end is going home; the app pings on mount, so the old rule flagged
every worker who opened the app on the bus to check out.

## 5 · The monitor reads the violation, not the stamp (§9.5, RULE-02)

`checkin_monitor_v` resolves `no_check_out` from an unresolved `no_checkout`
violation ahead of `checked_out`, whichever RULE-02 trigger raised it; the
end + 4 h clause stays as the fallback. "Today" is Europe/London on both sides
(§1.8).

## 6 · §3.2's edit lock is a trigger held against the manager's session

`event_edit_lock_guard()` refuses a change to the columns that are the event
as built (a section's window, headcount, buffer, role, rates; the event's
date, venue, fence, title, PO, client, break/buffer terms) once the derived
window has started — for `current_app_role() = 'admin'` under the
`authenticated` database role, which is the only human write path. Jobs
(service role) and the table owner (migrations, seed, tests) are not managers
editing an event. Cancellation, `payroll_exported_at`, the Auto-Assign switch,
notes and reconfirm flags stay editable.
