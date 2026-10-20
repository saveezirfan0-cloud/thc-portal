# ADR-0167 · The events List starts at today

**Status:** Accepted · **Requested:** by the repository owner (19 Oct 2026): "This view should start from today when the List view is clicked — it seems to be starting from events on 12.10" · **Wireframe:** `backoffice/events.html` List state (still drawn as a calendar month; this ADR is the deviation record) · **§3.1**

## Context

List read the calendar month of its date (`periodRange('list')` = the 1st to the last day). Opened on 19 October it listed every October event from the 1st, so a manager scrolled past a page of completed events to reach today. §3.1 only asks that List has the same back and forward arrows as the calendar, so past events are browsable there too; it does not say where the list starts.

## Decision

1. List reads **four weeks from its date**: `date` to `date + 27`. The label is the span, "Mon 19 Oct – Sun 15 Nov 2026".
2. The arrows step the same four weeks, so one step back ends the day before the period left and nothing is skipped or repeated. A month from the date was tried and rejected: back from 31 March lands on 28 February, whose month ends on 27 March, and 28–30 March would be unreachable.
3. /events with no date, **Today**, and **List** from a calendar period that holds today all start at today. List from any other calendar period starts at that period's date (Month of December → from the date the month was opened on).
4. Month, Week and Day are unchanged.

## Consequences

- `calendar.ts` (`periodRange`, `shiftPeriod`, `periodLabel`), `EventToolbar.tsx` (the List link's date); tests `calendar.test.ts`, `today-link.test.tsx`, `e2e/tests/office.events.spec.ts`; `docs/08-screen-inventory.md`.
- Saved views keep no date (ADR-0059), so they open on the four weeks from wherever the manager is.
- A shared List link still opens on the same four weeks whatever day it is opened: `date` is always in the URL.
