# ADR-0196 · A worker who confirms after the noon deadline has one hour to press "I'm ready"

**Status:** Accepted (instruction of the product owner, 22.10.2026) · amends ADR-0034 §3–4 and 20260927140300 · a deliberate change to §3.5, **raise with THC**: the scope gives stage 2 one deadline, 12:00 the day before, and says nothing about a worker who confirms after it. The reminders every 15 minutes and the reworded messages are ADR-0200.

## Context

§3.5: "Not pressed by 12:00 → the system automatically releases the slot, sends the worker a push confirming they've been removed (N6b), and starts auto-assigning a replacement."

20260927140300 exempted anyone who confirmed **after** that noon (`ready_cutoff_applies`: they never faced the deadline, so the 12:05 run did not touch them), and 20260929100000 made `mark_ready()` refuse from noon on, with the Staff App showing no "I'm ready" card. Together a worker who accepted at 18:09 for a shift the next day:

- could not press "I'm ready" (no card; the database answered `deadline_passed`), and
- could never be released for not pressing it.

They stayed on the shift with stage 2 permanently outstanding. On 22.10.2026 Almas Hussain M. confirmed Lifting and Shifting at The Conduit Club (23.10, 17:00) at 18:09 and was still on it, "I'm ready — not yet", an hour later; the board's Confirmed list had no way to take him off except Withdraw by hand.

## Decision

1. **A late confirmer's deadline is one hour after they confirmed.** A booking is *late* when it was confirmed at or after `ready_deadline(start)` **and** on a UK day before the shift's (`late_ready_applies()`; TS `lateReadyApplies()`). Its deadline is `confirmed_at + 1 hour`, never past the start (`late_ready_due_at()`; `readyDueAt()`). `ready_due_at()` is the one function `mark_ready()` reads: noon the day before for everyone else, the hour for a late confirmer. `reconfirm_booking()` restamps `confirmed_at`, so a worker who accepts a moved time after noon is on the same clock.
2. **Warned first.** `late_ready_tick()` (every minute, from the `booking-tick` Edge Function, beside `client_kit_reminder_tick()`; `booking_tick()` itself is not restated) queues an **N6, variant `late`** (reworded by ADR-0200): *"Press I'm ready by {dueBy} — or you'll be removed from your shift tomorrow"*, keyed on booking + start + confirmation (`late_ready_key()`) so a re-confirmation is warned again and an earlier on-time N6 never stands in for it. ADR-0034 §4 stands: nobody is released who was not sent this warning.
3. **Released at the hour.** `release_late_unready_bookings()` cancels a confirmed, not-ready, warned late booking once the hour is up and the shift has not started: `cancel_cause = 'ready_cutoff'` (the same transition as the 12:05 release, so the board, the state machine and the re-fill need nothing new) and **N6b, variant `late`** (reworded by ADR-0200) (*"…as we did not receive your 'I'm ready' within an hour of your confirmation"*, because the standard N6b names the 12:00 deadline). Idempotent.
4. **Re-fill straight after.** The `auto-staffing` cutoff run (every five minutes, around the clock) calls the late release **before** its 12:05 clock check, and a tick that released somebody falls through to the same re-fill the 12:05 release uses. The 12:05 release itself still runs only in its own window, as before. A late booking is therefore released within five minutes of the hour ending, not on the dot.
5. **The Staff App** asks a late confirmer from the moment they confirm: the card says *"Press 'I'm ready' by 19:09 (UK time) — an hour after you confirmed"*, the button disables when the hour is up (`readyDeadlinePassed(start, now, confirmedAt)`), and the refusal copy names both deadlines.

## What does not change

- **A booking confirmed on the day of the shift** (RULE-08 same-day auto-assign, or the office) is on no clock: stage 3 never releases (§3.5), and `late_ready_applies()` is false for it.
- **The on-time path** (confirmed before noon): `ready_cutoff_applies()`, `release_unready_bookings()`, the 12:05 window and N6/N6b's own copy are untouched.
- **A shift that starts before the hour is up** releases nobody: the hour is capped at the start, and the release needs `now < start`.
- **A worker who was already on the shift before this shipped** and never got the late N6 is not released automatically (rule 2); the office can Withdraw them from the board, which frees the slot for the next round.

## Consequences

- Tests: vitest `staff.test.ts` (the rule, the due time, the card), `n4-home-office.test.ts` (the two variants); pgTAP `929` (30 assertions: the rule, the warning, the release at exactly the hour, every case that must not release, the cap at the start, `mark_ready` inside the hour, grants). `593` and `610` still hold: the 12:05 release and the noon refusal for an on-time booking are unchanged.
- Awaiting THC: the hour (a constant in `late_ready_due_at()` / `LATE_READY_GRACE_MIN`, not a setting), and the choice that a late confirmation is released rather than only flagged. The notification register (`docs/scope`, §8) gains no new code: N6 and N6b gain a variant each.
