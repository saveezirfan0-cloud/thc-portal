# ADR-0204 · Bring your name badge — the morning reminder

**Status:** Accepted (request of THC, 23.10.2026) · extends ADR-0081 (name badges) and ADR-0110 (CR2) · scope §8 (not in it)

## Context

THC asked that, for all Leonardo Hotel St Paul's M&E shifts, staff be reminded in the morning not to forget their name badge if they have been given one. That client already has the name-badges switch on (ADR-0081).

## Decision

1. No new switch and no new notification code. `client_kit_reminder_tick()` (CR2, ADR-0110) also covers every confirmed shift of a client with `name_badges` on: at `kit_reminder_due_at()` (07:00 UK on the day, or start − 3 h if earlier) the worker gets CR2 "For your shift today": *Don't forget to bring your name badge today, if you have been given one.*
2. A role that also has a kit message gets **one** push with the kit message first and the badge line after it. CR2's key (booking + start) keeps it to one per shift; a moved start is reminded again.
3. The kit message still stops once acknowledged; the badge line has nothing to acknowledge, so a booking whose kit is acknowledged still gets the badge line.
4. Turning name badges off for a client stops the reminder with it.

## Consequences

- Any client switched to name badges later gets the same reminder; THC's wording is a constant in the function (`c_badge`) if it should change.
- "If they have been given one" is the message's wording: the system does not track who was handed a badge.
