-- =====================================================================
-- Migration 0006 · close the event_windows privilege gap; make the
-- location trail append-only for everybody (§11.1, §5.2b, RULE-01)
--
-- Two findings from the review of 0004/0005, neither of them created by
-- those migrations, but both of which they now lean on.
--
-- 1. `event_windows` has run with owner rights since 0001, and nothing
--    ever took its default grants back. Supabase grants anon and
--    authenticated select on every new object in `public`, so
--    `GET /rest/v1/event_windows` returned the start and end of every
--    event of every client to any caller, signed in or not. §11.1 gives
--    the client role "only their own events"; a logged-out caller is not
--    in §11.1 at all.
--
--    No rate column ever left through it — the view projects event_id,
--    starts_at and max(ends_at) and nothing else — so this closes a
--    tenancy hole, not a money one. It matters because 0005 cites
--    `event_windows` as the precedent for owner-rights views, and
--    docs/03-data-model.md reserves 0003 for `payable_shifts_v`, which is
--    pay by definition. A view built to this shape with those grants left
--    on would put charge_rate and pay_rate on the open internet, and
--    001_rls_guard.sql would not notice: it inspects relkind = 'r'.
--
--    The fix keeps `event_windows` exactly as it is — a generic, internal
--    derivation (§1.5) — and takes back the PostgREST grants, so it is
--    reachable only by its owner and by service_role. Its one caller,
--    client_events_v, therefore has to stop being a `security_invoker`
--    view, which brings it into line with the two views ADR-0004 already
--    reshaped. The tenancy rule moves from RLS on `events` into
--    client_portal_visible() in the view body, which is where 0005 put it
--    for client_lineup_v and client_role_sections_v.
--
--    The `client_events` policy on `events` stays. It is not money, a
--    client may legitimately read its own event rows directly, and
--    001_rls_guard.sql assertion 5 counts it.
--
-- 2. `location_pings` carried `admin_all ... for all`, two lines under a
--    comment promising "the rows are append-only in any case: no update
--    or delete policy". `inside_geofence` is what "the last on-site fix"
--    resolves to for an off-site check-out (§5.2b), and that feeds
--    payable = [check-in, check-out] ∩ [start, end] (RULE-01/02). An
--    admin could rewrite a worker's pay evidence, silently, from the
--    REST API. audit_log and report_sends were already admin_read for
--    exactly this reason (§1.7, §9.9); the trail joins them.
--
-- Forward-only: 0001, 0002, 0004 and 0005 are left untouched. 0003 stays
-- reserved for the cron schedules (docs/01 §4).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1a · client_events_v carries its own tenancy rule (§11.1, ADR-0004)
--
-- Dropped and recreated rather than replaced: it is losing the
-- security_invoker reloption, and dropping says so unambiguously — the
-- same reasoning 0005 gives for client_lineup_v.
--
-- The body is unchanged apart from the predicate. security_barrier keeps
-- a user-supplied function in a WHERE clause from being evaluated ahead
-- of client_portal_visible(), which after this change is the whole of
-- the access control rather than a filter on top of RLS.
-- ---------------------------------------------------------------------
drop view if exists client_events_v;

create view client_events_v with (security_barrier = true) as
  select e.id,
         e.client_id,
         e.title,
         e.venue_name,
         e.venue_address,
         e.event_date,
         e.po_number,
         w.starts_at,
         w.ends_at,
         event_status(e, w.starts_at, w.ends_at) as status
    from events e
    join event_windows w on w.event_id = e.id
   where client_portal_visible(e.client_id);

comment on view client_events_v is
  'The customer''s own events (§11.1). Owner rights + client_portal_visible() per ADR-0004, so it can read the event window without a policy on the money-bearing shift_requirements table. Event window = min role start -> max role end (§1.5); per-role timings come from client_role_sections_v (RULE-18).';

revoke all on client_events_v from public, anon, authenticated;
grant select on client_events_v to authenticated;

-- ---------------------------------------------------------------------
-- 1b · event_windows becomes internal
--
-- service_role keeps its default grant: the report and PDF jobs run on
-- the service key. Office screens that need a window read
-- shift_requirements directly, where the admin holds a full policy.
-- ---------------------------------------------------------------------
revoke all on event_windows from public, anon, authenticated;

comment on view event_windows is
  'Derived event window, min role start -> max role end (§1.5). Runs with owner rights over the money-bearing shift_requirements table, so it is NOT granted to anon or authenticated: reach it through client_events_v, which carries the tenancy predicate, or read shift_requirements as the admin.';

-- ---------------------------------------------------------------------
-- 2 · the location trail is evidence, not editable state (§5.2b, §1.7)
--
-- Writes still belong to the `record_location_ping` definer RPC owed by
-- the check-in session, which derives inside_geofence server-side from
-- the event's own venue_location + geofence_radius_m. Nobody asserts it
-- over the API — not the device, and now not the office either.
-- ---------------------------------------------------------------------
drop policy if exists admin_all on location_pings;

create policy admin_read on location_pings for select
  using (current_app_role() = 'admin');

comment on table location_pings is
  'During-shift tracking (§5.2b). The worker may read their own trail and the admin may read all of it; nobody writes through the API. inside_geofence decides the last on-site fix behind RULE-01 pay, so the rows are append-only evidence like audit_log (§1.7) and report_sends (§9.9): a security definer RPC writes them, and no role holds an update or delete policy.';
