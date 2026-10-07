# ADR-0102 · Cancelled events never appear on the Dashboard

**Status:** Accepted · **Refines:** Scope §9.1, §3.3 · **Follows:** ADR-0099

## Context
ADR-0099 took cancelled events off the Scheduling diary. The Dashboard's "Upcoming events — next 10 days" list still drew them struck through and greyed (§3.3), and ADR-0099 left that "until asked". The office has asked: cancelled events were still showing.

## Decision
- `loadDashboard` reads `dashboard_upcoming_v` with `cancelled_at is null`, so the ten-day list never contains a cancelled event.
- `UpcomingTable` loses its greyed, struck-through, non-clickable cancelled rendering; every row is upcoming or ongoing.
- The view, its pgTAP test (`350_dashboard.sql`) and the money rules are untouched: cancelled events were already excluded from the KPIs, the weekly snapshot and the short-staffed panel (§3.3, ADR-0059).
- Nothing is deleted. The event stays reachable from its own link and through finance reports.

## Consequences
- Departs from §3.3 point 1 for this screen; this ADR is the deviation record. `wireframes/backoffice/dashboard.html` still draws a cancelled row and its behaviour note; it is intentionally not followed here.
- The Client Portal still shows cancelled events; change it only if asked.
