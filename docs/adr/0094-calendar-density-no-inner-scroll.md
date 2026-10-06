# ADR-0094 · Calendar density: no scroll boxes inside month cells or week columns

**Status:** Accepted · **Wireframe:** `backoffice/events.html` (draws at most three events a day, so it is unaffected on those days) · **§3.1**

## Context

§3.1 says a day holds 10–15 events and that month "cells scroll" and week "columns scroll independently". In use a day carries up to 30 events: a month cell is a 96px window with a scrollbar inside it, a week column a 480px one, and a manager scrolls inside and across the page to read one week. The product owner asked for something better.

## Decision

1. **Month.** A cell draws at most **three chips** and then **"+N more · M open"**, which opens that day's Day view. A day that is one chip over the limit shows the chip instead. Events that read the same (same title, same window start, both live or both cancelled) collapse into one chip, "Morning Waiting Staff ×4", with their open positions summed; a group opens the Day view, a single event opens its board. The "N ev · M open" counter is unchanged and still counts events, not chips. On a phone each chip stays a dot and the cell opens its day, as before.
2. **Week.** The column's own scroll is removed; the page scrolls. A column is folded into **Overnight (before 05:00) / Morning (before 12:00) / Afternoon (before 17:00) / Evening** bands by the UK hour of the event window start (RULE-18, §1.8). Each band is a `<details>` with its own "N ev · M open"; a column of eight events or fewer opens everything, a longer one opens only the bands that still need staff. This is a fold, not a time grid: events keep §3.1's window-start order inside a band, so the objection to a time-gridded diary does not apply.
3. The change lives in `apps/office` (`events.css` lifts the design system's 96px window for `.cal .day .scroll`); `packages/ui` is untouched.

## Consequences

- §3.1's "cells scroll" / "columns scroll independently" are superseded for the Back Office calendar; the List and Day views are as before.
- `apps/office/app/events/view-model.ts` (`groupSimilarEvents`, `monthCell`, `bandDay`), `EventViews.tsx`, `events.css`; tests in `view-model.test.ts` and `calendar-views.test.tsx`.
