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
   role section. The screen can sum a role or an event. The view has no person
   in it, but that does not make it anonymous, and this ADR does not claim it
   does. While the event is live, a caller who reads it next to
   `client_lineup_v` can identify individuals in some sections: in a one-person
   section, or one reading 0 of N or N of N, the count says who has arrived, and
   polling it roughly dates a check-in. That is accepted as a residual risk,
   because it is what the customer's host at the door can see for themselves on
   the day. It is bounded to the live window by the end gate (4), so it never
   becomes a record (security review, 29.09).
3. **What an arrival is.** A booking on the confirmed line-up (`confirmed` or
   `worked`, the same set `client_lineup_v` returns) with a `check_logs` row
   whose outcome is `checked_in` and which has a `check_in_at`. That row is
   written by an accepted check-in, on time or Late (§9.5), and by the office's
   "Get back", which "registers the worker as arrived" (§9.5). So:
   - `confirmed` is the confirmed line-up, the same number as
     `client_role_sections_v.confirmed`. The denominator is never the headcount
     and never the buffer.
   - A worker turned away under the strict buffer policy (RULE-15) is
     `turned_away`. They are off the line-up and in neither number. This view
     adds nothing about the buffer. The customer can already see one in
     `client_role_sections_v` when confirmed exceeds headcount (e.g. "7 of 6
     confirmed"), and both counts drop by one when a buffer worker is turned
     away. That was true before this ADR.
   - A No-show is in `confirmed` and not in `arrived`. The customer can infer
     "2 of 13 have not arrived", which is exactly the figure they asked for and
     no more.
   - An out-of-radius press is not an arrival, and repeated attempts count once.
4. **Both gates are in the view, not the screen.** There are rows only while the
   event is ongoing: from its earliest role start to its latest role end,
   inclusive (`now() between event_windows.starts_at and ends_at`, the same
   test `event_status()` uses for 'ongoing'). There is never a row for a
   cancelled event. After the end, the rows go. Kept, they would join to the
   line-up's names and become a permanent per-worker attendance history. The
   signed timesheet (§11.3) is the record of the day. A later role section of a started event does have
   a row (reading 0 of N). The per-role pill additionally hides itself before
   that role's own start (RULE-18), which is a presentation choice on top of the
   database rule and not a replacement for it.
5. **The portal reads it like everything else.** `apps/client/app/client/arrivals.ts`
   uses the caller's own session with no tenancy filter in code, and returns an
   empty map when there is no project, on error, or on a throw, so the addition
   can never break the page. `ArrivalsPill.tsx` (named apart from `arrivals.ts` so the two cannot collide on a case-insensitive disk) is a green-dot Pill
   ("11 of 13 arrived") that renders nothing when there is nothing to count.

## Consequences

- Nothing is shown after the event ends. The screens also render the pill only
  for an ongoing event, but that is presentation on top of the rule. The
  database does not rely on it, because the list page's props reach the browser
  whether or not a pill is drawn.
- The admin passes `client_portal_visible()`, so the office can read the same
  figures through the same definition, as it can for the other `client_*`
  views.
- `supabase/tests/607_client_arrivals_view.sql` pins the shape, the counts
  (arrived, not yet, out-of-radius, turned away, cancelled, invited, "Get
  back"), the start and end gates at their boundaries (for the admin too), the cancelled filter, tenancy for
  both clients, a worker, a client with no company and anon, and the empty
  client policy set.
- A future request for "who is still missing" is a different decision. It
  would put named attendance in front of the customer and needs its own ADR,
  not a column added to this view.
