# ADR-0053 · The dashboard's short-staffed panel, and saved views on Scheduling

**Status:** Accepted · **Wireframes:** `backoffice/dashboard.html` and `backoffice/events.html` draw neither · **§9.1, §3.1, RULE-18**

## Context

The product owner asked for two additions the wireframes do not draw: a warning on the dashboard when a shift in the next two days is not filled, and a way to keep the filter sets a manager uses every day on Scheduling.

## Decision

1. **"Short-staffed — next 48 hours"** sits on `/dashboard` between the KPI row and the financial snapshot, the first thing a manager should act on. One line per **role section**, never per event, selected by the role section's **own start** (RULE-18), not the event date, so a role starting after midnight on yesterday's event is not missed. Short means **confirmed** (confirmed and worked) bookings below headcount; the buffer never makes a role short (CLAUDE.md: fill counts only confirmed; buffer is absolute). Cancelled events are left out. It reads `dashboard_short_staffed_v` (`20260930210400`), admin-only, with no money columns, so a scheduler sees it too (ADR-0050). No fifth KPI tile: §9.1 and the dashboard e2e pin four.
2. **Saved views on `/events`.** The list and calendar filters (view, search, client, status) live in the URL, so a filtered view can be bookmarked and shared. "Save view" names the current filters and view and shows them as chips; a saved view opens on the period currently on screen, not the date it was saved on. Re-using a name (case-insensitively) updates that view.
3. **Saved views follow the manager across devices** (updated 26.09.2026, `20260930222000`). They were first kept per browser in `localStorage`; they now live in `office_saved_views` (id, owner = `auth.uid()` by default, scope `'events'`, name 1–60 characters, query jsonb, created_at, updated_at; unique on owner + scope + `lower(name)`).
   - **Own rows only, Back Office logins only.** Four policies (`admin_own_select/insert/update/delete`), each `(select current_app_role()) = 'admin' and owner = (select auth.uid())`. Another admin's views are invisible and untouchable; a worker or client session gets nothing; anon holds no grant. It is a per-user preference, not operational data, so every office role — including a read-only one — may save its own views. **Any office-wide write guard for a read-only role must exempt this table.**
   - **At most 30 per owner**, enforced by the `office_saved_views_guard` trigger under a per-owner advisory lock (also inside one multi-row INSERT); owner and scope are fixed once saved.
   - **`query` is validated in the database** (`office_saved_view_query_ok`): an object holding only `view`, `q`, `clientId`, `status`, every value a string of at most 100 characters with no control characters, `view` one of list/month/week/day, `status` empty or an event status, `clientId` empty or a UUID. The chips turn it back into a `/events` URL on every device, so nothing else can ride along. The app applies the same rules first (`savedViewQuery`) to answer in a sentence.
   - **Reads and writes are server actions on the manager's own session** (`_lib/saved-views-actions.ts`), never the service key; each write returns the fresh list. The page reads the list on the server, so chips are in the first paint and recomputed on every open.
   - **The old browser copy moves once.** If this browser still has `localStorage` views and the account has none, the bar offers "Move my saved views to my account": one INSERT of the valid, non-duplicate views up to the cap, and the browser's copy is cleared only after the database has them.
   - **When the database refuses** (no project in the environment, or a login that may not write) the bar stays with a read-only notice: the chips still open — they are only links — and Save and × are withheld.

## Consequences

- `docs/08-screen-inventory.md` describes both on the `/dashboard` and `/events` rows.
- `apps/office/app/dashboard/_components/ShortStaffedPanel.tsx`, `apps/office/app/events/_lib/{filters,saved-views,saved-views-actions}.ts`, `SavedViewsBar.tsx`, pgTAP 744 and 755; `001_rls_guard` lists `office_saved_views` in assertions 1 and 3.
