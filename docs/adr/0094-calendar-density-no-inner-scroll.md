# ADR-0094 · Calendar density: no scroll boxes inside month cells or week columns

**Status:** Accepted · **Requested:** by the repository owner, in the session that made this change (6 Oct 2026) · **Wireframe:** `backoffice/events.html` still draws the scrolling cell and columns (Fri 19 with 11 chips, "the cell scrolls", "each column scrolls on its own") and is **not yet updated**; this ADR is the deviation record until it is · **§3.1**

## Context

§3.1 says a day holds 10–15 events and that month "cells scroll" and week "columns scroll independently". In use a day carries up to 30 events: a month cell is a 96px window with a scrollbar inside it, a week column a 480px one, and a manager scrolls inside and across the page to read one week. They asked for something better, and then for a popup so a busy day can be read enlarged.

## Decision

1. **Month.** A cell draws at most **three chips** and then **"+N more · M open"**. A day that is exactly one chip over the limit shows that chip instead of "+1 more" (so a cell holds three chips, or four when that avoids a "+1 more"). Events that read the same (same title, **same client**, same window start, all live or all cancelled) collapse into one chip, "Morning Waiting Staff ×4 · Client", with their open positions summed; two clients never merge, so every chip still names its client (§3.1: start · event · client). The "N ev · M open" counter is unchanged and still counts events, not chips.
2. **Day popup.** "+N more" and a collapsed group open a **popup** (the design system's wide `Modal`: Escape, backdrop and × close it) titled with the date and the day's counter. It lists **every event of the day, enlarged**: window (UK), status pill, fill "N of M", title, client · venue, each a link to its event board, with an "Open day view" link and Close in the footer. A single event's chip is still a link straight to its board. The day number is still a link to the Day view. On a phone the chips stay dots and the whole cell opens the Day view, as before.
3. **Week.** The column's own scroll is removed; the page scrolls. A column is folded into bands by the UK hour of the event window start (RULE-18, §1.8): **Overnight** (before 05:00), **Morning** (before 12:00), **Afternoon** (before 17:00), **Evening**, and **No roles yet** for an event with no role sections. Each band is a `<details>` with its own counter ("N ev · M open", or "N ev · cancelled" when every event in it is cancelled; the column header reads the same way). A column of eight events or fewer opens everything; a longer one opens only the bands that still need staff. This is a fold, not a time grid: events keep §3.1's window-start order inside a band.
4. The change lives in `apps/office` (`events.css` lifts the design system's 96px window for `.cal .day .scroll`); `packages/ui` is untouched.

## Consequences

- §3.1's "cells scroll" / "columns scroll independently" are superseded for the Back Office calendar; the List and Day views are as before.
- **Follow-up for the owner:** redraw the Fri 19 cell ("+8 more"), the week annotation and the behaviour note in `wireframes/backoffice/events.html`, and add a pointer to this ADR in `docs/14-handover.md`; neither was changed here.
- `apps/office/app/events/view-model.ts` (`groupSimilarEvents`, `monthCellModel`, `bandDay`), `_components/{EventViews,MonthCellEvents,ChipStatus}.tsx`, `events.css`; tests in `view-model.test.ts` and `calendar-views.test.tsx`.
