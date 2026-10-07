# ADR-0099 · Cancelled events never appear on the Scheduling diary

**Status:** Accepted · **Supersedes:** ADR-0094 · **Refines:** Scope §3.1, §3.3

## Context
ADR-0094 added an opt-in "Hide cancelled" checkbox, off by default, so §3.3's "stays visible in the list/calendar, greyed out" still held. In use the diary stayed cluttered: the office wants cancelled events gone from the Schedule, past and future.

## Decision
- `/events` (List, Month, Week, Day) never lists a cancelled event. `filterEventRows` drops them whatever the other filters say, so every view, the period totals and the day counters agree.
- The "Hide cancelled" checkbox, the `hide=cancelled` parameter and the "N cancelled events hidden" line are removed, and **Cancelled** leaves the status filter. A link or saved view that asks for `status=cancelled` opens on any status instead of an empty list.
- The rows are **not deleted**. A cancelled event is still the record behind its withdrawn bookings, its Cancelled-on-the-day pay (§3.3 edge case) and the finance reports; `event_documents`, reports and bookings reference it. It stays reachable from its own link (`/events/<id>`) and through those reports.

## Consequences
- Departs from §3.3 point 1 ("stays visible in the list/calendar"); this ADR is the deviation record. `wireframes/backoffice/events.html` still draws the greyed cancelled rows and chips and a Cancelled status option; it is intentionally not followed here.
- The greyed-out cancelled rendering in `EventViews.tsx`, `MonthCellEvents.tsx` and `events.css` is now unreachable from `/events`. It is left in place (harmless; removing it can follow separately).
- A saved view that holds `status=cancelled` stays in the chip bar and opens on any status, but never shows as the active chip. Normalising it is a possible follow-up.
- The dashboard's ten-day list and the Client Portal still show cancelled events greyed; change them only if asked.
- If the office also wants the rows purged, that is a separate decision: it needs the finance and payroll impact of same-day cancellations settled first.
