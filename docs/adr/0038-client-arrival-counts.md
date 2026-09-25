# ADR-0038 · The customer sees on-the-day arrival counts, and only counts

Status: accepted · 25.09.2026 · a client-approved addition to §11.1/§11.2; follows ADR-0004 and ADR-0026

## Context

- §11 gives the customer a read-only, money-free view of their events: "N of M
  confirmed", the confirmed line-up by role, and the documents. It says nothing
  about attendance on the day.
- The client asked for one extra number during the event: how many of the
  confirmed line-up have arrived. This was agreed as a deliberate addition to
  §11 on one condition: **counts only**. No names, no check-in times, no Late
  or No-show label per person, no locations. Who was late and who did not come
  is the office's business (§9.5 Check In, violations), and so is the location
  trail (§5.2b).
- Check-ins live in `check_logs`. Like `bookings` and `shift_requirements`, it
  is `admin_all` and closed to the client role, and ADR-0026 pins the client's
  table policies at none (`001_rls_guard` assertion 5).

## Decision

1. **One more ADR-0004 view, `client_arrivals_v`** (20260929100100), with the
   same shape as `client_role_sections_v`: owner rights (no
   `security_invoker`), `security_barrier`, `client_portal_visible(e.client_id)`
   in its own body, SELECT to `authenticated` and nothing else to anybody. No
   policy is added to any table.
2. **Four columns: `shift_id`, `event_id`, `confirmed`, `arrived`**, one row per
   role section. The screen can sum a role or an event. It cannot name a person,
   because the view has no person in it.
3. **What an arrival is.** A booking on the confirmed line-up (`confirmed` or
   `worked`, the same set `client_lineup_v` returns) with a `check_logs` row
   whose outcome is `checked_in` and which has a `check_in_at`. That row is
   written by an accepted check-in, on time or Late (§9.5), and by the office's
   "Get back", which "registers the worker as arrived" (§9.5). So:
   - `confirmed` is the confirmed line-up, the same number as
     `client_role_sections_v.confirmed`. The denominator is never the headcount
     and never the buffer.
   - A worker turned away under the strict buffer policy (RULE-15) is
     `turned_away`. They are off the line-up and in neither number, which is
     also why the customer never learns that a buffer existed.
   - A No-show is in `confirmed` and not in `arrived`. The customer can infer
     "2 of 13 have not arrived", which is exactly the figure they asked for and
     no more.
   - An out-of-radius press is not an arrival, and repeated attempts count once.
4. **The start gate is in the view, not the screen.** There is no row until the
   event's earliest role start (`event_windows.starts_at <= now()`), and never a
   row for a cancelled event. A later role section of a started event does have
   a row (reading 0 of N). The per-role pill additionally hides itself before
   that role's own start (RULE-18), which is a presentation choice on top of the
   database rule and not a replacement for it.
5. **The portal reads it like everything else.** `apps/client/app/client/arrivals.ts`
   uses the caller's own session with no tenancy filter in code, and returns an
   empty map when there is no project, on error, or on a throw, so the addition
   can never break the page. `ArrivalsPill.tsx` (named apart from `arrivals.ts` so the two cannot collide on a case-insensitive disk) is a green-dot Pill
   ("11 of 13 arrived") that renders nothing when there is nothing to count.

## Consequences

- Rows remain after the event ends, so a completed event still reads, for
  example, "12 of 13 arrived". That is the same fact the day showed. Whether to
  display it after the event is a wiring choice on each screen.
- The admin passes `client_portal_visible()`, so the office can read the same
  figures through the same definition, as it can for the other `client_*`
  views.
- `supabase/tests/607_client_arrivals_view.sql` pins the shape, the counts
  (arrived, not yet, out-of-radius, turned away, cancelled, invited, "Get
  back"), the start gate at its boundary, the cancelled filter, tenancy for
  both clients, a worker, a client with no company and anon, and the empty
  client policy set.
- A future request for "who is still missing" is a different decision. It
  would put named attendance in front of the customer and needs its own ADR,
  not a column added to this view.
