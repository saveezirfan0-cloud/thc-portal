# ADR-0053 · The dashboard's short-staffed panel, and saved views on Scheduling

**Status:** Accepted · **Wireframes:** `backoffice/dashboard.html` and `backoffice/events.html` draw neither · **§9.1, §3.1, RULE-18**

## Context

The product owner asked for two additions the wireframes do not draw: a warning on the dashboard when a shift in the next two days is not filled, and a way to keep the filter sets a manager uses every day on Scheduling.

## Decision

1. **"Short-staffed — next 48 hours"** sits on `/dashboard` between the KPI row and the financial snapshot, the first thing a manager should act on. One line per **role section**, never per event, selected by the role section's **own start** (RULE-18), not the event date, so a role starting after midnight on yesterday's event is not missed. Short means **confirmed** (confirmed and worked) bookings below headcount; the buffer never makes a role short (CLAUDE.md: fill counts only confirmed; buffer is absolute). Cancelled events are left out. It reads `dashboard_short_staffed_v` (`20260930210400`), admin-only, with no money columns, so a scheduler sees it too (ADR-0050). No fifth KPI tile: §9.1 and the dashboard e2e pin four.
2. **Saved views on `/events`.** The list and calendar filters (view, search, client, status) live in the URL, so a filtered view can be bookmarked and shared. "Save view" names the current filters and view and shows them as chips; a saved view opens on the period currently on screen, not the date it was saved on. They are stored **per browser** in `localStorage`, every read and write guarded, and the page works when storage is unavailable. Views that follow a manager across devices would need a table (owner, name, filter JSON) with an own-row policy; not built.

## Consequences

- `docs/08-screen-inventory.md` describes both on the `/dashboard` and `/events` rows.
- `apps/office/app/dashboard/_components/ShortStaffedPanel.tsx`, `apps/office/app/events/_lib/{filters,saved-views}.ts`, pgTAP 744.
