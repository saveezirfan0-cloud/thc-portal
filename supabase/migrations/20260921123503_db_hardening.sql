-- =====================================================================
-- Migration 20260921123503 · database hardening pass
--
-- Why this exists
-- ---------------
-- Supabase's database linter was run against the live project once 0001-0008
-- were applied. Its findings were triaged; this migration closes the five
-- that are real, and deliberately closes nothing else.
--
--   1. function_search_path_mutable on final_rate, event_status and
--      weekly_cap_hours — an injection surface, because a caller who can
--      set search_path decides which `round`, which `staff` and which
--      `cap_assessment` those bodies resolve to.
--   2. rls_enabled_no_policy on notification_outbox — the right behaviour
--      (the outbox belongs to the jobs on the service key) arrived by
--      accident rather than on purpose, and reads nobody intended to deny
--      are denied with it.
--   3. unindexed_foreign_keys — 24 of them, every one a sequential scan on
--      the child table whenever the parent row is deleted or joined.
--   4. auth_rls_initplan on 15 policies — auth.uid() called once per row
--      instead of once per statement.
--   5. rls_disabled_in_public on spatial_ref_sys — PostGIS's own SRID table,
--      which the Supabase default grants handed anon full DML on.
--
-- What this migration deliberately does NOT do, because the triage said so:
--   · current_app_role() / current_client_id() keep EXECUTE for anon and
--     authenticated. They are called inside the policy expressions, so
--     revoking it breaks every policy in the schema, and they return only
--     the caller's own role and client id.
--   · rls_auto_enable() is left alone. No migration or seed in this repo
--     creates it; it is not ours to drop.
--   · st_estimatedextent overloads are PostGIS's.
--   · postgis and pg_net stay in `public`.
--   · The 100 multiple_permissive_policies warnings stay. Every one is
--     admin_all overlapping a staff_self* / client_* policy, which is the
--     shape §1.4 asks for and is readable as it stands.
--   · Leaked-password protection is a dashboard toggle, not schema.
--
-- Nothing here changes what any role may read or write, with one exception
-- that is the point of the change: admin gains SELECT on
-- notification_outbox, and anon/authenticated lose the INSERT / UPDATE /
-- DELETE on spatial_ref_sys that the default grants gave them. No function
-- body is edited and no policy predicate changes meaning.
--
-- Forward-only: 0001-0008 are left untouched.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · Pin the search_path of the three flagged functions
--
-- A function without `set search_path` resolves its body against whatever
-- the caller's search_path happens to be. A caller who can prepend a
-- schema of their own therefore chooses the `staff` table that
-- weekly_cap_hours reads and the `round` that final_rate applies. Every
-- security definer function in 0004-0007 already pins its path; these
-- three are the ones 0001 and 0008 left open.
--
-- Bodies are NOT touched — `alter function ... set` changes only the
-- execution environment.
--
-- Which schemas each actually needs:
--   · final_rate(numeric)          round(numeric,int) is pg_catalog, which
--                                  is always searched. `public` is listed
--                                  for consistency, not necessity.
--   · event_status(events, …, …)   resolves the `events` row type and casts
--                                  to the `event_status` enum, both in
--                                  public.
--   · weekly_cap_hours(uuid,date)  resolves weekly_cap_for() and the
--                                  cap_assessment composite in public, and
--                                  the callees it reaches (weekly_cap_for,
--                                  cap_term_state, cap_week_start,
--                                  weekly_cap) inherit this path rather
--                                  than the caller's.
-- `extensions` is included because Supabase installs extension objects
-- there and a path that omits it is a trap for the next body that needs
-- one. None of the three needs PostGIS: no geography, geometry or
-- ST_* call appears in any of them.
-- ---------------------------------------------------------------------
alter function public.final_rate(numeric)
  set search_path = public, extensions;
alter function public.event_status(public.events, timestamptz, timestamptz)
  set search_path = public, extensions;
alter function public.weekly_cap_hours(uuid, date)
  set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 2 · notification_outbox — admin-read, service-role-write (§8)
--
-- 0001 enabled RLS here and wrote no policy, so the table has been
-- deny-all for every signed-in role. For writes that is exactly right and
-- stays right: every row is enqueued by a scheduled job or an RPC running
-- on the service key, which bypasses RLS, and the unique `key` is what
-- makes a re-run idempotent (§7). A worker or a client able to insert here
-- could send themselves — or somebody else — an N-series notification, and
-- one able to update could mark a pending send as sent and silently drop
-- it. So there is still no insert, update or delete policy for anybody.
--
-- What was accidental is the read side. The Back Office needs to see the
-- send queue (pending / sent / failed per worker) and had no route to it
-- because nobody had written the policy, not because anybody decided
-- admin should be blind to it. This is the same admin-read,
-- service-role-write shape 0004 gave audit_log and report_sends, and it is
-- spelled the same way, so the intent is legible from the schema rather
-- than from the absence of a line.
--
-- The client and the worker get nothing: recipient_emails and payload
-- carry worker personal data (§1.7) and the queue names who was contacted
-- about which booking.
-- ---------------------------------------------------------------------
create policy admin_read on notification_outbox for select using (current_app_role() = 'admin');

comment on table notification_outbox is
  'Notification outbox (§8), idempotent by `key`. Admin-read; written only by the scheduled jobs and RPCs on the service role. Never give any role an insert/update/delete policy here: a forged row is a forged notification and an updated sent_at is a dropped one.';

-- ---------------------------------------------------------------------
-- 3 · Covering indexes for every unindexed foreign key
--
-- A foreign key with no index on the referencing column costs twice. Every
-- delete or key update on the parent takes a sequential scan of the child
-- to prove the constraint, and every join or filter from the parent side
-- does the same. Postgres indexes the *referenced* side automatically (it
-- must be unique) and the referencing side never.
--
-- The 24 below are all of them: derived from pg_constraint against
-- pg_index, counting an index as covering only when the FK columns are its
-- leading columns. The composites and unique constraints in 0001 already
-- cover fifteen more (bookings(shift_id,status), bookings(staff_id,status),
-- compliance_docs(staff_id,review_status), the client_qualifications and
-- client_rate_cards unique keys, location_pings(booking_id,at), the
-- staff_id primary keys, and events_venue_id_idx from 0007), so those are
-- absent here on purpose rather than by oversight.
--
-- Named <table>_<column>_idx, which is what `create index on t (c)` in
-- 0001 generated and what 0007 spelled out by hand.
--
-- Not CONCURRENTLY: a migration runs inside a transaction, and these are
-- small tables today. If one of them has grown by the time this lands,
-- build that index concurrently by hand first — `if not exists` then makes
-- this statement a no-op.
-- ---------------------------------------------------------------------
create index if not exists breaks_booking_id_idx                    on breaks (booking_id);
create index if not exists client_qualifications_granted_by_idx     on client_qualifications (granted_by);
create index if not exists client_qualifications_role_id_idx        on client_qualifications (role_id);
create index if not exists client_qualifications_staff_id_idx       on client_qualifications (staff_id);
create index if not exists client_rate_cards_role_id_idx            on client_rate_cards (role_id);
create index if not exists compliance_docs_reviewed_by_idx          on compliance_docs (reviewed_by);
create index if not exists criminal_declarations_reviewed_by_idx    on criminal_declarations (reviewed_by);
create index if not exists criminal_declarations_staff_id_idx       on criminal_declarations (staff_id);
create index if not exists events_cancelled_by_idx                  on events (cancelled_by);
create index if not exists events_client_id_idx                     on events (client_id);
create index if not exists events_created_by_idx                    on events (created_by);
create index if not exists feedback_author_id_idx                   on feedback (author_id);
create index if not exists feedback_event_id_idx                    on feedback (event_id);
create index if not exists feedback_staff_id_idx                    on feedback (staff_id);
create index if not exists notification_outbox_recipient_staff_id_idx on notification_outbox (recipient_staff_id);
create index if not exists push_subscriptions_staff_id_idx          on push_subscriptions (staff_id);
create index if not exists shift_requirements_event_id_idx          on shift_requirements (event_id);
create index if not exists shift_requirements_role_id_idx           on shift_requirements (role_id);
create index if not exists staff_references_staff_id_idx            on staff_references (staff_id);
create index if not exists staff_roles_role_id_idx                  on staff_roles (role_id);
create index if not exists venues_venue_type_idx                    on venues (venue_type);
create index if not exists violations_booking_id_idx                on violations (booking_id);
create index if not exists violations_resolved_by_idx               on violations (resolved_by);
create index if not exists violations_staff_id_idx                  on violations (staff_id);

-- ---------------------------------------------------------------------
-- 4 · Evaluate auth.uid() once per statement, not once per row
--
-- `auth.uid()` reads a GUC. It is STABLE, so Postgres is entitled to call
-- it once per statement, but written bare in a policy predicate it ends up
-- in the per-row qual and is called for every row the scan touches. Wrapped
-- as `(select auth.uid())` it becomes an uncorrelated subquery, which the
-- planner hoists into an InitPlan and evaluates exactly once. On a worker
-- reading their own bookings out of a table holding every worker's, that is
-- the difference between one GUC read and one per booking in the system.
--
-- This is a performance fix and nothing else. Each policy below is
-- recreated with the same command, the same roles and a predicate that
-- differs only by the wrapper, so the 030_rls_staff suite proves the
-- behaviour is unchanged. `create policy ... to public` is the default and
-- is what all fifteen already carry; it is left implicit here as it is in
-- 0001 and 0004, because the role gate is current_app_role() / the staff
-- lookup, not the grantee list.
--
-- Postgres has no `alter policy ... rename`-free way to edit a predicate
-- without a drop, and drop+create inside one transaction leaves no window
-- in which the table is unpoliced.
-- ---------------------------------------------------------------------

-- staff — 0001
drop policy staff_self on staff;
create policy staff_self on staff for select
  using (user_id = (select auth.uid()));

-- compliance_docs — 0001
drop policy staff_self_docs on compliance_docs;
create policy staff_self_docs on compliance_docs for select
  using (staff_id = (select id from staff where user_id = (select auth.uid())));

-- bookings — 0001
drop policy staff_self_bookings on bookings;
create policy staff_self_bookings on bookings for select
  using (staff_id = (select id from staff where user_id = (select auth.uid())));

-- criminal_declarations — 0001
drop policy staff_self_decl on criminal_declarations;
create policy staff_self_decl on criminal_declarations for select
  using (staff_id = (select id from staff where user_id = (select auth.uid())));

-- profiles — 0001
drop policy profiles_self on profiles;
create policy profiles_self on profiles for select
  using (id = (select auth.uid()));

-- bank_details — 0004
drop policy staff_self_bank on bank_details;
create policy staff_self_bank on bank_details for select
  using (staff_id = (select id from staff where user_id = (select auth.uid())));

drop policy staff_self_bank_insert on bank_details;
create policy staff_self_bank_insert on bank_details for insert
  with check (staff_id = (select id from staff where user_id = (select auth.uid())));

drop policy staff_self_bank_update on bank_details;
create policy staff_self_bank_update on bank_details for update
  using (staff_id = (select id from staff where user_id = (select auth.uid())))
  with check (staff_id = (select id from staff where user_id = (select auth.uid())));

-- staff_roles — 0004
drop policy staff_self_roles on staff_roles;
create policy staff_self_roles on staff_roles for select
  using (staff_id = (select id from staff where user_id = (select auth.uid())));

-- staff_references — 0004
drop policy staff_self_refs on staff_references;
create policy staff_self_refs on staff_references for select
  using (staff_id = (select id from staff where user_id = (select auth.uid())));

drop policy staff_self_refs_insert on staff_references;
create policy staff_self_refs_insert on staff_references for insert
  with check (staff_id = (select id from staff where user_id = (select auth.uid())));

drop policy staff_self_refs_update on staff_references;
create policy staff_self_refs_update on staff_references for update
  using (staff_id = (select id from staff where user_id = (select auth.uid())))
  with check (staff_id = (select id from staff where user_id = (select auth.uid())));

-- quiz_attempts — 0004
drop policy staff_self_quiz on quiz_attempts;
create policy staff_self_quiz on quiz_attempts for select
  using (staff_id = (select id from staff where user_id = (select auth.uid())));

-- location_pings — 0004
drop policy staff_self_pings on location_pings;
create policy staff_self_pings on location_pings for select
  using (booking_id in (
    select b.id from bookings b join staff s on s.id = b.staff_id
     where s.user_id = (select auth.uid())));

-- push_subscriptions — 0004 (the one full self policy; read and write)
drop policy staff_self_push on push_subscriptions;
create policy staff_self_push on push_subscriptions for all
  using (staff_id = (select id from staff where user_id = (select auth.uid())))
  with check (staff_id = (select id from staff where user_id = (select auth.uid())));

-- ---------------------------------------------------------------------
-- 5 · spatial_ref_sys — RLS on, reads unchanged, writes closed
--
-- PostGIS's own EPSG lookup table, created in `public` because that is
-- where `create extension postgis` put it (0001). It is the one table in
-- public without RLS, and Supabase's default grants gave anon,
-- authenticated and service_role full DML on it, so any holder of the anon
-- key could delete SRID 4326 and take every geography column in the schema
-- down with it.
--
-- The trap here is that RLS with no policy is deny-all, and a deny-all
-- spatial_ref_sys breaks PostGIS itself: ST_Transform and any SRID
-- validation read this table, and they read it as whoever is connected.
-- So the policy goes in FIRST and the switch second, and the policy is a
-- plain `using (true)` SELECT.
--
-- `to public` rather than `to authenticated`: PostGIS grants SELECT on this
-- table to PUBLIC itself, and a coordinate lookup can happen in an anon
-- session as easily as a signed-in one. Matching PostGIS's own grant keeps
-- reads exactly as they are today and leaves the change to what it is
-- meant to be — the loss of the write privilege. The contents are the
-- public EPSG registry: 8,500 rows of well-known projection definitions,
-- identical in every PostGIS install on earth, and secret from nobody.
--
-- Ownership: this works only while `postgres` owns the table, which it does
-- when postgis was installed by a migration as it was here. If a future
-- environment has the extension owned by supabase_admin instead, ALTER
-- TABLE raises insufficient_privilege; the block below catches exactly
-- that, leaves the table as it found it and says so, rather than aborting
-- the rest of this migration or half-applying the change.
-- ---------------------------------------------------------------------
-- The COMMENT is inside the block for the same reason: it needs ownership
-- too, so on a project where the ALTER is refused it must be skipped with
-- it rather than aborting the migration on its own.
do $$
begin
  drop policy if exists spatial_ref_sys_read on public.spatial_ref_sys;
  create policy spatial_ref_sys_read on public.spatial_ref_sys for select to public using (true);
  alter table public.spatial_ref_sys enable row level security;
  comment on table public.spatial_ref_sys is
    'PostGIS EPSG lookup. RLS on with a read-only policy for everybody: the rows are public reference data that PostGIS reads during coordinate work, but nothing in this system ever writes them, and the Supabase default grants would otherwise let the anon key delete SRID 4326.';
exception
  when insufficient_privilege then
    raise notice 'spatial_ref_sys is not owned by the migration role, so RLS was left disabled and the anon/authenticated DML grants on it remain. Re-run these three statements as the extension owner.';
end $$;
