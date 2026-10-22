# ADR-0196 · A worker who accepts after the 12:00 deadline gets an hour to press "I'm ready"

**Status:** Accepted (product owner, 22.10.2026). A deliberate change to scope v1.6 §3.5 stage 2, which says nothing about a worker who accepts after the deadline; amends ADR-0034 and migration `20260927140300`. Migration `20261024120000`, pgTAP `929`. THC to confirm (docs/15).

## Context

§3.5 stage 2: the worker presses "I'm ready" by 12:00 the day before, or the system releases the slot (N6b). `20260927140300` made that rule fair by exempting a worker who **accepted after** that noon — they never faced the deadline, and `mark_ready()` refuses a press at or after it, so removing them would punish them for something they could not do.

The exemption left them on the shift with no stage 2 at all. On 22.10.2026 a worker booked at 10:17 accepted at 12:47 for a 17:00 shift the next day and was never asked to confirm; the board showed "confirmed 12:47" with no date, so it looked like a missed deadline. The product owner wants the same assurance for them as for everyone else, on a shorter clock.

## Decision

For a booking confirmed **at or after** `ready_deadline(start)`, on a UK day **before** the shift's day (`late_ready_applies()`, `lateReadyApplies()`):

| Time after accepting | What happens |
| --- | --- |
| +15 min | push **LR1** "Press "I'm ready" … within 45 minutes" |
| +30 min | LR1, 30 minutes |
| +45 min | LR1, 15 minutes |
| +60 min | not pressed → released (`cancel_cause = 'ready_cutoff'`, as the noon rule), pushed **LR2**, and re-filled by the same auto-staffing run |

- **One hour runs from accepting**, not from the first push. (The request read "within 1 hour"; the hour from accepting is the reading that makes the +15 first ask and the removal 45 minutes apart. Raise with THC if they meant 1 hour from the first ask.)
- **The press is allowed from the moment of accepting** — the Staff App card shows at once — but the pushes start at +15. A worker who presses it early is never reminded.
- **`mark_ready()` is hard at the hour**, as it is at noon: `deadline_passed`, nothing recorded. The Staff App's button and alert say "an hour after you accepted" for these workers (`readyWindowClosed()`).
- **No release without the warning** (ADR-0034 §4): a booking is released only if the first LR1 for *this* confirmation is in the outbox. A worker whose hour ended before this shipped, or while booking-tick was down, stays; the board shows "I'm ready — not yet" for the office to act on.
- **Not changed:** a booking confirmed before the deadline keeps the noon rule (N6, N6b, 12:05). A booking made **on the day of the shift** (RULE-08) is still exempt, as is one made so late that the hour would run into the start (`confirmed + 1 h > start`).
- **The hour can cross midnight.** The release is not tied to the 12:05–midnight window or to "the day before": it runs wherever the hour ends, up to the start. The Staff App tests the late window before "today".
- **Where it runs.** Reminders: `late_ready_tick()`, called by the booking-tick Edge Function every minute (booking_tick() itself is not restated). Release: `release_unready_bookings()`, extended; the auto-staffing **cutoff** mode now calls it on every every-5-minute run, all day (it used to skip before 12:05 UK), and re-fills if it released anyone. So the removal lands between 60 and 65 minutes after accepting.
- **Notifications.** LR1 and LR2 are extension codes (`LATE_READY_CODES`, "Not in §8"), both urgent, both opening `/shifts`. LR2 names the shift rather than "tomorrow", because the hour can end after midnight. Keys `LR1:booking:<id>:<confirmed epoch>:<step>` and `LR2:booking:<id>:<confirmed epoch>`, so a shift the office moves and the worker re-accepts is reminded afresh.
- **The board** now shows the date on both stamps: "confirmed 22 Oct, 12:47 · I'm ready ✓ 21 Oct, 10:19" (`formatDateTimeIn`).

## Consequences

- Closes the gap `20260927140300` left: no accepted booking is left without a stage 2 unless it is made on the day.
- A worker who accepts after noon and ignores the pushes now loses the shift an hour later, including late in the evening; the replacement round runs at once, but a section short at 22:00 for a morning start has less time to refill than the noon rule gave. That is the price of the rule as asked.
- pgTAP `929`; `190` and `856` list the new functions and codes; Vitest in `packages/domain` (`staff.test.ts`) and `packages/notifications` (`templates.test.ts`).
- `mark_ready()` inside the late window is not pgTAP-testable at every hour of the day (it reads `now()`); its twin `readyWindowClosed()` is pinned in Vitest.
