# ADR-0004 · How the Client Portal reaches the confirmed line-up

**Status:** Accepted, 21.09.2026. Supersedes the wording "client access goes only through
`security_invoker` views" in `docs/01-architecture.md`, `docs/03-data-model.md` and
`.claude/agents/platform.md`. **Amended** by `20260927160100` / ADR-0026 (26.09.2026): the
client role now holds no table policy at all — the "today `events` and `feedback`" sentence
below is history, and the view pattern is the whole of the client data path.

## Context

§11.2 promises the customer a read-only line-up of the confirmed workers on their own
event: photo · name · role, grouped by role section, with "N of M confirmed" on the list
and in the event header (§11.1). `client_lineup_v` was written for exactly that and
returned nothing.

The view body was never the problem. It is a `security_invoker` view, so it runs with the
caller's privileges, and it joins `bookings`, `shift_requirements`, `roles` and `staff`.
After `0002_client_money_isolation` the client role holds a policy on precisely two
tables — `events` (select) and `feedback` (insert). Every other join in the line-up hits a
table the client cannot read, so row-level security filtered the result to zero rows for
the one role the view exists to serve.

Two fixes are available and they pull against each other.

**A · Give the client policies on the tables underneath.** This is what an invoker view
needs to work. It also undoes `0002`. `roles` carries `pay_rate` and `shift_requirements`
carries `charge_rate` *and* `pay_rate`, i.e. both sides of the margin; Supabase grants the
`authenticated` PostgREST role DML on every table in `public`, so a policy on those tables
is a policy on the money — `GET /rest/v1/roles?select=pay_rate` comes straight back. §11.1
is absolute: "No money anywhere: no pay rates, no charge rates, no margin." It would also
put `staff` — every worker's date of birth, address, NI number and right-to-work state —
inside a customer's reach, policed only by a `where` clause we would have to get right on
every future column.

Column-level grants (`grant select (id, name) on roles`) narrow that but do not close it.
Supabase's default privileges re-grant whole tables to `authenticated`, so one later
`grant select on all tables in schema public` silently restores the leak; and a policy on
`bookings` would have to reach `events` through `shift_requirements` to find out whose
event it is, which the client cannot read — so the policy itself would need a
`security definer` helper. The approach does not avoid definer code, it only scatters it.

**B · Let the view run with its owner's rights and carry the tenancy rule in its own
body.** The base tables stay exactly as `0002` and `0004` left them. The client keeps one
route to worker data, and that route can only ever return the columns §11.2 names.

## Decision

**B.** The Client Portal reads through owner-rights views that filter by
`current_client_id()` themselves. No client policy is added to any base table.

- `client_lineup_v` is recreated without `security_invoker`, with the tenancy predicate
  inside it. Its column list is unchanged.
- `client_role_sections_v` is added for "N of M confirmed": role name, role-section window
  (RULE-18, never the event window), `headcount` and the confirmed count. It exists
  because §11.1 and the §11.2 header count *M*, and *M* lives on the money-bearing
  `shift_requirements` row that the client must not read.
- `client_portal_visible(client_id)` is the single predicate both views use. Admin passes
  it too, so the Back Office and the pgTAP suite keep one definition of "may see this".
- `client_events_v` stays `security_invoker`: it reads `events`, where the client *does*
  hold a policy, so nothing is gained by changing it.

This is not a new pattern in this schema. `event_windows` has run with owner rights since
`0001`, and `0002` depends on it: it is how the client gets the min-start/max-end window
without a policy on `shift_requirements`.

### The rule that replaces the old one

> The client role holds policies only on tables that carry no money and no worker personal
> data — today `events` and `feedback`. Everything else the Client Portal shows comes from
> a `client_*` view that (a) runs with owner rights, (b) filters by
> `client_portal_visible()` in its own body, (c) selects no rate, charge or margin column,
> and (d) is granted to `authenticated` only.

## Consequences

- **The tenancy check is now load-bearing SQL, not RLS.** RLS on the tables underneath is
  bypassed for the view owner, so `client_portal_visible(e.client_id)` is the whole of
  §11.1's "they see only their own events". A future session that adds a `client_*` view
  and forgets the predicate leaks every client's data to every client. `050_client_views`
  asserts owner rights, the barrier, the grants and the exact column list of each view for
  that reason, and `020_rls_client` asserts client A cannot see client B's line-up.
- **`security_barrier = true`** on both views, so a user-supplied function in a `where`
  clause cannot be evaluated ahead of the tenancy predicate and log rows the caller may
  not see.
- **`anon` is revoked outright**, rather than left to return an empty set because
  `auth.uid()` is null. Two defences, not one. The anon suite asserts the permission
  error, not a zero count.
- **The blast radius of a new column is bounded.** Adding a column to `staff` or
  `shift_requirements` cannot reach the customer, because these views name their columns.
  The alternative — a policy plus `select *` — would have shipped it.
- **Admin is inside the predicate**, so `client_lineup_v` stays readable in the Back
  Office and the "is the view body sound" test keeps working. A worker sees nothing
  through either view; they are not a Client Portal user.
- **The `security_invoker` shorthand in the docs was wrong, not just incomplete.** The
  property that matters is "the client cannot reach money or personal data", and after
  `0002` an invoker view is often the one thing that *cannot* deliver a client screen. The
  three places that stated it are corrected to the rule above.

## Alternatives rejected

- **A `security definer` RPC per event** (`client_lineup(event_id)`). Equivalent security,
  worse ergonomics: the event list needs the line-up for every event on the page, so it
  becomes one round trip per event, and PostgREST filtering, ordering and embedding are
  lost. A view keeps the screen contract the docs and tests already name.
- **A materialised or service-role Edge Function feed.** Adds a second copy of the data
  and a job to keep it fresh, for a read that is three joins deep.
