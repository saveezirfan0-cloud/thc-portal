# ADR-0205 · A default morning reminder on every shift — uniform standards

**Status:** Accepted (instruction of the product owner, 23.10.2026) · extends ADR-0110 (the kit message, CR2) · not in §8

## Context

ADR-0110 lets a (client, role) carry a kit message, pushed on the morning of each shift (CR2) until the worker confirms it. The product owner now wants one message on **every** shift for **every** worker, whoever the client:

> Look sharp. Every shift. Uniform clean and pressed. Shoes polished. Hair neatly combed. Personal hygiene and grooming at the highest standard — always. You represent us the moment you walk in. Thank you.

## Decision

- **One setting, `settings.default_shift_message`** (a JSON string; seeded with the owner's wording; `""` switches it off). Not a row per (client, role): that would miss every role added later and would have to overwrite a client's own message.
- **`shift_kit_message(client, role)`** is the one place that says what a worker is told: the client's kit message for the role (if any), a blank line, then the default (if any). `staff_shift_requirements()`, `acknowledge_shift_kit()` and `client_kit_reminder_tick()` all read it, so what the worker sees, what the push says and what "nothing to acknowledge" means can never disagree.
- **One push, one acknowledgement.** A booking where both exist (UGLE's bottle opener, ADR-0110) still gets a single CR2 and a single "I've read this and I'll bring them"; the key is unchanged (`CR2:booking:<id>:<start>`), so a moved shift is reminded again and a re-run never doubles.
- **Timing and gating are ADR-0110's:** 07:00 UK on the day, or start − 3 h if earlier, never before that UK day begins; confirmed bookings only; never gates check-in.
- **With ADR-0204 (bring your name badge):** the same CR2 push. `client_kit_reminder_tick()` is restated in `20261026150000` on top of `20261026130000`: the client's message and the default (until acknowledged), then the badge line for a client with name badges on, in one push. The badge line still has nothing to acknowledge. `934_name_badge_reminder.sql` blanks the default so its badge-only counts hold.
- A booking confirmed before this shipped, with its morning already past, is reminded at the first tick after deploy (the tick fires from the due time until the start).

## Consequences

- Every live booking now has a row in `staff_shift_requirements()`, so the Shifts card shows the note on the nearest shifts for everyone. Quiz-only logic is unchanged.
- There is no screen for the setting yet — it is edited in the `settings` table; a field on `/settings` is a follow-up.
- The wording is the owner's, and the office copy of CR2 is unchanged (`{message}`).
- pgTAP `936_default_shift_message.sql`; `783` blanks the default so its client-only counts hold.
