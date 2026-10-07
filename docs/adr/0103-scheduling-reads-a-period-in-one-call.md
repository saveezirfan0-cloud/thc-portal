# ADR-0103 · Scheduling reads a period in one database call

**Status:** Accepted · **Requested:** by the repository owner (7 Oct 2026): "please make page speed better" (on Scheduling) · **§3.1**

## Context

`/events` loaded in two waves of avoidable work, and `AutoRefresh` repeats the whole page every 30 seconds.

1. **The events read was four steps, each waiting on the last**: events in the range → their sections (`event_id IN (…)`) with *every* client and *every* role fetched to look names up → the confirmed bookings of every section (`shift_id IN (…)`, one row per booking, counted in the app).
2. **It would have broken with volume, not just slowed.** The ids travel in the URL: at 10–15 events a day and 2–3 sections each, a month is a request line in the tens of kilobytes. And the API returns at most `max_rows` (1000, `supabase/config.toml`) booking rows, so past that the fill chips under-count with no error.
3. **The page ran the Shift Builder's reference read for a dropdown of names.** `loadReferenceData()` is seven queries (rate cards, charge and pay rates, venues, venue types, roles…), and its result, rate cards included, was passed as props to a client component, so it was also serialised to the browser.

## Decision

1. **`office_events_in_range(p_from, p_to)`** (migration `20261007143000`) returns the period as one JSON array: event, client name, and role sections (role name, window, headcount, buffer, **confirmed count**). The count is done in the database, on the existing `bookings (shift_id, status)` index. One array rather than a set of rows, so the API's row cap cannot cut a long period short.
2. **It is `SECURITY INVOKER`.** The caller's own row security and column grants apply to every table it reads, exactly as for the separate reads; it selects no rate column (ADR-0061) and no worker data. `anon` and `PUBLIC` cannot execute it.
3. **The app falls back to the old multi-step read only when PostgREST says the function does not exist** (`PGRST202` / `42883`): the app and the database are deployed by different jobs, and `deploy-database` skips itself when its secrets are absent. Any other error is reported as a problem, never hidden by the fallback. Delete the fallback once the migration is live everywhere.
4. **The page reads clients with `loadClientFilterOptions()`**: one query, `id, name`.

## Consequences

- A period's events cost one database round trip instead of three in sequence plus a four-way reference fan-out; the booking rows no longer cross the wire at all. The 1000-row and URL-length ceilings no longer apply to the list.
- `AutoRefresh` gets cheaper for the same reason.
- Not measured against production: there is no project in the development sandbox. What is established is the work removed (round trips, rows, bytes) and, by pgTAP, that the result is the same data.
- `apps/office/app/events/data.ts` (`loadEventsInRange`, `loadClientFilterOptions`, `isMissingFunction`), `page.tsx`, the filter components' prop type; `supabase/tests/783_office_events_in_range.sql`; `__tests__/data-events-in-range.test.ts`.
