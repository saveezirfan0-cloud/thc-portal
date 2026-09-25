# ADR-0032 · The 12:00 "I'm ready" deadline is hard, retried and warned; the reminders follow the start

Status: accepted · 29.09.2026 · 20260929100000; amends ADR-0029 §1–3 · raise §3 with THC (docs/15)

## Context

The 25.09 audit found the day-before stage of §3.5 soft at both ends, and the
three reminders around it (N6, N7, N13) wrong at the edges:

- `mark_ready()` accepted a press any time before the start, so 12:00–12:05
  was open and the deadline was really whenever the 12:05 run reached the row
  (D25).
- The 12:05 cutoff ran only inside the five-minute `is_uk_time('12:05')`
  window, so a failed run was never retried (D25).
- The TypeScript `readyDeadline()` subtracted 24 h, so on a DST changeover
  the Staff App hid "I'm ready" a day early or late while SQL still released
  (D24).
- N6/N7 were keyed on the booking only, so a moved shift was never reminded
  of its new time; sections starting 00:00–00:30 UK had an empty N7 window;
  and a booking accepted after the last tick before noon was released without
  ever being sent N6 (D26).
- N13 stopped at the scheduled end, against §5.2b (D1c, D27).
- A booking confirmed after its section started was exempt from No-show for
  ever (D48).

## Decision

1. **`readyDeadline()` is calendar arithmetic.** UK civil date of the start,
   minus one calendar day, 12:00 Europe/London. The TS and SQL halves are held
   to one vector file, `packages/domain/src/readyDeadline.vectors.json`
   (Vitest, and pgTAP 610 through the generated `ready_deadline_vectors.psql`).
   The "I'm ready" card opens at 00:00 UK on that day, not noon minus 12 h.
2. **N7 closes at `n7_closes_at()`**: start − 30 min, but never less than
   30 minutes after `n7_due_at()` and never after the start. A section
   starting at **exactly 00:00 UK gets no N7**: no moment of its UK day comes
   before it, and `confirm_on_day()` refuses before that day begins, so a push
   at 23:30 saying "Confirm today's shift" could not be acted on. Such a worker
   still gets N6 (noon the day before) and N9 (23:30).
3. **The deadline is hard at 12:00.** `mark_ready()` answers
   `{ok:false, reason:'deadline_passed'}` at or after `ready_deadline()`; the
   Staff App maps it to its own copy. The auto-staffing cutoff mode releases in
   the 12:05 UK window and **retries on every run until UK midnight**:
   `release_unready_bookings()` is idempotent (row lock, re-checked status,
   N6b keyed on the booking) and never reaches a shift starting today, so a
   retry releases only what a failed 12:05 run left behind, then re-fills.
4. **No release without the warning.** `release_unready_bookings()` releases
   a booking only if N6 for its current start is in `notification_outbox`.
   N6 goes out from `booking_tick()` every minute from 08:00 UK the day before
   until 12:00; a booking accepted in the last minute before noon, or a morning
   with booking-tick down, would otherwise be released by a push saying
   "removed … as we have not received your re-confirmation" about a
   re-confirmation it was never asked for. This is the same rule
   20260927140300 applied to a NULL `confirmed_at`: the system does not release
   a worker it cannot show was warned. The consequence to accept: if
   booking-tick is down for the whole morning, nobody is released that day and
   the Check-in monitor shows them as not ready for the office to act on.
5. **N6/N7 keys carry the start**: `<code>:booking:<id>:<start epoch>`
   (`booking_reminder_key()`). One row per booking per start; a moved shift is
   reminded again.
6. **N13 runs until the check-out lock** (end + 4 h) and never for a booking
   carrying No check-out (ADR-0029 §3).
7. **The late-confirmed No-show is raised at the end.** §5.1's exemption keeps
   the check-in open until the section ends; if the worker never arrives,
   BG-03 raises No-show at `ends_at`.

## Consequences

- pgTAP 610 (deadline vectors, `mark_ready`, the gate window), 611 (N13
  overrun, late-confirmed No-show, the accepted check-in) and 612 (keys, the
  midnight N7, warned release, the afternoon retry). 170 pinned N13 stopping
  at the end and now pins the overrun being prompted; 590/593 read the new
  keys; 130 queues the N6 its release now needs.
- On a retry pass that released somebody, the auto-staffing run's own
  `released` count reads 0 (the release after the gate finds nothing); the
  released rows and their N6b are the record.
- THC to confirm (docs/15): §4's reading — no release for a worker never sent
  N6 — and the 00:00 N7 gap.
