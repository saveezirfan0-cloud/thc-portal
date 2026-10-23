# ADR-0205 · Check in and out today — the morning reminder

**Status:** Accepted (request of THC, 23.10.2026) · beside N9 (§8, BG-01/02) · shares CR2's time (ADR-0110) · scope §8 (not in it)

## Context

Staff are still getting used to checking in and out on the new Staff App, and a missing check-in or check-out holds up their pay (a No check-out has no 4-hour floor and needs the office to resolve it, RULE-01/02). THC asked for a reminder to every worker at 07:00 on the morning of a shift, or earlier if the shift starts earlier, to check in and check out. N9 already pushes "Time to check in" 30 minutes before the start and "Don't forget to check out" 30 minutes before the end; those stay.

## Decision

1. A new push, **CK1** "Check in and out today": *You're working {event} today ({window}). Remember to check in on the app when you arrive and check out when you finish — it's how your hours are recorded, and missing either can delay your pay.*
2. **When:** `kit_reminder_due_at()` — 07:00 UK on the day, or three hours before the start if that is earlier, never before the UK day begins. The same time as CR2 ("For your shift today"), so the morning's messages arrive together. A shift starting before 10:00 is therefore reminded before 07:00 (a 09:00 start at 06:00, a 05:00 start at 02:00).
3. **Who:** every confirmed booking not yet checked in, from the due time until the start, for a live event. A booking confirmed later in the day is reminded at the next minute's tick.
4. **How often:** one per worker per UK day (key `CK1:staff:<id>:<UK date>`), naming the earliest shift due; a second shift the same day sends nothing more.
5. **Its own code, not a line on CR2.** CR2 stops once the kit message is acknowledged; this must not. It has its own switch on `/settings` → Notifications ("Check in and out today"), and its own collapse tag so neither push replaces the other on the phone.
6. `check_in_out_morning_tick()`, run every minute by the `booking-tick` Edge Function beside `client_kit_reminder_tick()`. Urgent send class, as CR2. Finished rows are purged after 180 days (ADR-0164) like CR2's.

## Consequences

- On a typical day every worker with a shift gets one more push in the morning. The office can switch it off on `/settings` once staff are used to the app; N9 keeps running either way.
- A shift already confirmed when this ships, whose start is still ahead, is reminded at the first tick after deploy.
- The wording is ours, written from THC's request; change it in `packages/notifications/src/templates.ts` (CK1).
