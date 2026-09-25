# ADR-0029 · Timing decisions the 26.09 audit round made in SQL

Status: accepted · 26.09.2026 · 20260927140000, 20260927140300, 20260927160500, 20260927160600, 20260927161200 · §1 and §3 amended 29.09.2026 by 20260929100000 (ADR-0034)

Where §7 / §8 name a day but not an hour, or a bound the scope does not give,
this records the choice so the next reader does not re-derive it.

## 1 · N6 and N7 send times (§3.5, §8) — decided in 20260927140000

Both rounds of 26.09 queued the two reminders from `booking_tick()`, per
booking, off the role section's own clock (RULE-18). The version that merged
first (#56, `20260927140000`, `n6_due_at()` / `n7_due_at()`) is the one the
tree runs, and this round's restatement is withdrawn (its file is now
`20260927160500`, N5 payload only — see its header):

- **N6** from **08:00 Europe/London the day before** (`n6_due_at()`) until
  the 12:00 deadline (`ready_deadline()`), exclusive, to a confirmed booking
  with no "I'm ready" that the cutoff can still touch (§2 below).
- **N7** from **09:00 Europe/London on the day, or two hours before the start
  if that is earlier**, never before 00:00 UK that day (`n7_due_at()`), until
  `n7_closes_at()`: 30 minutes before the start, where N9 takes over — but
  never less than 30 minutes after it opened and never past the start, so a
  section starting 00:01–00:59 UK is still reached. A section starting at
  exactly 00:00 UK gets no N7 (ADR-0034 §2). Not to a booking already checked
  in or already confirmed on the day.
- Both are keyed `<code>:booking:<id>:<start epoch seconds>`
  (`booking_reminder_key()`, 20260929100000): once per booking per start,
  and again if the office moves the start.

This round had N7 at 08:00 and open until the start; neither is in effect —
09:00 is what the N7 gallery shows (`wireframes/staff/shifts.html`) and is
what shipped. Both hours are listed for THC to confirm in
`packages/notifications/REGISTER-NOTES.md`.

## 2 · The 12:05 cutoff exempts a late confirmation (§3.5) — decided in 20260927140300

`ready_cutoff_applies(confirmed_at, starts_at)` is the rule, in one place: the
booking was confirmed strictly before `ready_deadline(starts_at)`, a NULL
`confirmed_at` is not subject, and `release_unready_bookings()` releases only
when the section also starts on a later UK day than the run. Without it the
replacements the 12:05 re-fill itself produced were released at 12:05 on the
shift day with N6b "…removed from your shift tomorrow…". This round's
`confirmed_at < ready_deadline()` clause said the same thing in the same
function and is withdrawn in favour of the shared predicate; `@thc/domain`'s
`readyDeadlinePassed()` / `shiftCard` mirror it. Since 20260929100000 the
release also requires that N6 was queued for the booking's current start, and
`mark_ready()` refuses a press at the deadline (ADR-0034 §3–4).

## 3 · BG-10 / N13 runs until the check-out lock (§5.2b) — decided in 20260929100000

N13 goes to a worker on an unpaid-break client who has been checked in six
hours with no break logged and has not checked out, **until end + 4 h** (the
check-out lock, RULE-02), and never to a booking carrying a `no_checkout`
violation. Once per booking (`N13:booking:<id>`).

History, because the tree said two things. `20260927140300` bounded it by the
section's end (`< ends_at`), and this ADR recorded that as the decision. That
contradicts §5.2b — the Breaks block "is not tied to the shift's scheduled end
time and does not disable or disappear if the shift runs longer than planned"
— so a worker still on site in an overrun was never prompted (audit D1c,
D27). The case the old bound was protecting against, a worker who went home
without checking out, is the one the check-out lock already names: at end + 4 h
BG-09 raises No check-out in the same run, and that violation also stops N13
earlier when it is raised on the press. The withdrawn `20260926130400` had this
bound; it never took effect, and `20260929100000` restates it.

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
