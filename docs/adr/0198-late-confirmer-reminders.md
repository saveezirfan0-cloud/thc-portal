# ADR-0198 · A late confirmer is reminded every 15 minutes, told when the hour runs out, and told when they are withdrawn

**Status:** Accepted (instruction of the product owner, 23.10.2026) · amends ADR-0196 and `20261024110000` · a deliberate change to §3.5, **raise with THC** (it rides on ADR-0196's).

## Context

ADR-0196 gave a worker who confirms after the noon deadline one hour to press "I'm ready": one warning when they confirm, release and refill at the hour. That is one push in an hour, and the removal message said "tomorrow" although the hour can run past midnight. The product owner asked for more: a reminder every 15 minutes, a clear statement that they have an hour and exactly when it runs out, a withdrawal message when it does, and the place re-assigned.

## Decision

1. **Every 15 minutes.** `late_ready_tick()` (every minute, `booking-tick`) sends the first warning when the booking is first seen on the hour's clock, then one **N6 variant `late-reminder`** at +15, +30 and +45 minutes: *"Press I'm ready for {event} by {dueBy} (UK time) — {minutes} left — or you'll be removed from it"*, with 45, 30 and 15 minutes. Nothing at +60: that is the release.
2. **Told they have an hour, and when it ends.** The first warning (variant `late`) now reads *"Press I'm ready by {dueBy} (UK time), 1 hour after you confirmed — or you'll be removed from {event}"*. Every message carries the clock time the hour runs out, in UK time. An hour cut short by the shift's start (confirmed in the last hour before it) never says "1 hour": it says the minutes left.
3. **One push per booking per tick, one per quarter-hour.** Keys are `late_ready_key()` for the first quarter-hour and `late_ready_step_key()` (`…:1`, `:2`, `:3`) after it, so a missed tick sends the current quarter-hour's message, never a burst, and a first warning that comes late (say at +50) takes that quarter-hour's key and says the minutes left from then instead of being followed by the same quarter-hour's reminder. A worker who presses "I'm ready" is not reminded again; nothing is sent after the hour.
4. **Withdrawn at the hour, told, re-assigned.** Unchanged in mechanism — `release_late_unready_bookings()` from the auto-staffing cutoff run (every five minutes, so 60–65 minutes after confirming), cause `ready_cutoff`, N6b variant `late`, then the same re-fill as the 12:05 release (invitations to the next candidates; the seat is not assigned to a named person until they accept). The N6b copy is reworded: *"You have been removed from {event} · {dateTime} as we did not receive your 'I'm ready' within 1 hour of your confirmation. Your place is being offered to someone else"*, with its own heading "Removed from your shift" (no "tomorrow").
5. **"Was told" means any push of the hour.** The release requires the first warning **or a reminder** for this confirmation (`late_ready_told()`, an exact four-key lookup on the outbox's unique key), so a worker reached only by a reminder is still released and one reached by nothing is not (ADR-0034 §4 stands).

## What does not change

The rule (`late_ready_applies`), the hour (`late_ready_due_at`, capped at the start), `mark_ready()`, the same-day exemption, the on-time path, the Staff App card ("Press 'I'm ready' by 19:09 (UK time) — an hour after you confirmed"). No new notification code: N6 gains a variant, N6b's late copy is reworded.

## Consequences

- A worker confirmed at 15:00 gets five pushes if they never press it: 15:00 (an hour, until 16:00), 15:15, 15:30, 15:45, then the removal at about 16:00–16:05.
- pgTAP `930` (the timeline, the late first warning, pressing stops it, the release by a reminder alone, nothing after the hour); `929` still holds unchanged (`lateN6` counts workers warned for the first time, even where the first warning is worded as a reminder). Vitest `n4-home-office.test.ts` pins the three messages.
- Awaiting THC: the 15-minute interval and the hour are constants in `late_ready_tick()` / `late_ready_due_at()`, not settings.
