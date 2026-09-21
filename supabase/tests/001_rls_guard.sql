-- =====================================================================
-- 001 · RLS guard
--
-- A structural snapshot of where row level security stands. It fails the
-- moment a table is added without RLS, a policy is dropped, or a policy is
-- added to a table that had none (at which point the expected list here
-- must be updated in the same PR).
-- 0004_rls_gaps closed the eleven tables 0001_init.sql left with no RLS at
-- all, so assertion 2 is now an emptiness check rather than a gap list.
-- 0009 added assertions 6 and 7: RLS is not the only way into `public`,
-- and "RLS is on" is not the same claim as "a policy exists".
-- 20260921123503_db_hardening turned assertion 8 inside out (the outbox is
-- admin-read on purpose now, not deny-all by omission) and added 9 for
-- spatial_ref_sys, the last table in public that had no RLS at all.
-- 20260921130927_jobs_and_outbox_drain added job_runs and job_schedules to
-- assertions 1 and 3; both are admin-read, written by the service role.
-- ADR-0008 re-exempted spatial_ref_sys in assertions 2 and 9: the hardening
-- pass asserted an outcome that needs supabase_admin, which no migration in
-- this repo has, so main was red on it for over an hour. The gap is real and
-- is recorded rather than hidden.
-- Scope refs: §1.5 data model, §1.4 roles, §11.1 client sees no money.
-- =====================================================================
begin;
select plan(9);

-- ---------------------------------------------------------------------
-- 1. Tables with RLS enabled (0001_init.sql)
--    spatial_ref_sys is filtered out: it is PostGIS's table, not part of
--    the data model this list inventories. 20260921123503_db_hardening
--    gave it RLS too, and assertion 9 is where that is asserted.
-- ---------------------------------------------------------------------
select bag_eq(
  $$ select c.relname::text
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
        and c.relname <> 'spatial_ref_sys' $$,
  $$ values ('applications'::text),('audit_log'),('bank_details'),('bookings'),('breaks'),('check_logs'),
            ('client_qualifications'),('client_rate_cards'),('clients'),
            ('compliance_docs'),('criminal_declarations'),('events'),('feedback'),
            ('hmrc_checklists'),('job_runs'),('job_schedules'),('location_pings'),
            ('notification_outbox'),('profiles'),
            ('push_subscriptions'),('quiz_attempts'),('report_sends'),('roles'),('settings'),
            ('shift_requirements'),('staff'),('staff_references'),('staff_roles'),
            ('venue_types'),('venues'),('violations') $$,
  'RLS is enabled on all 31 tables: the 17 from 0001_init.sql, the 11 closed by 0004_rls_gaps, job_runs + job_schedules from the jobs layer, and applications from the public form'
);

-- ---------------------------------------------------------------------
-- 2. No table in public may carry RLS-off.
--    Supabase grants anon/authenticated full DML on every public table, so
--    a table without RLS is world-readable and world-writable through
--    PostgREST. 0001_init.sql left eleven like that (audit_log,
--    bank_details, client_qualifications, hmrc_checklists, location_pings,
--    push_subscriptions, quiz_attempts, report_sends, staff_references,
--    staff_roles, venue_types); 0004_rls_gaps closed all eleven. This
--    assertion is what stops the next table from arriving without RLS.
--    It used to exempt spatial_ref_sys as "PostGIS's, not ours to alter".
--    20260921123503_db_hardening removed the exemption on the premise that
--    the table is owned by the migration role. On Supabase it is not: the
--    extension is created by supabase_admin, so the `alter table ... enable
--    row level security` in that migration takes the degradation branch it
--    wrapped itself in, emits a notice, and changes nothing. The assertion
--    went in asserting an outcome no migration in this repo can produce,
--    and main went red on it for over an hour.
--
--    20260921130156_pin_remaining_search_paths reached the same conclusion
--    in prose and is worth quoting, because it is the reason this exemption
--    is back rather than a second attempt at the migration:
--
--      "PostGIS's table is owned by supabase_admin and its privileges were
--       granted by supabase_admin, so only that role can revoke them or
--       enable row-level security on it. Neither `postgres` nor the SQL
--       editor can, and Supabase does not expose supabase_admin."
--
--    KNOWN GAP, and a real one: anon retains write privileges on the SRID
--    lookup table on every Supabase project using PostGIS. It is survivable
--    here only because our geography columns are all 4326 and nothing in
--    the schema calls ST_Transform, so the geofence maths never reads this
--    table at query time. Closing it needs supabase_admin and therefore
--    belongs in project setup (docs/04), not in a migration.
--
--    The exemption is spelled as an explicit name rather than a wider
--    filter so that the next table arriving without RLS still fails here.
-- ---------------------------------------------------------------------
select is_empty(
  $$ select c.relname::text
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
        and c.relname <> 'spatial_ref_sys' $$,
  'every table in public has row level security enabled, except PostGIS''s spatial_ref_sys (KNOWN GAP, see above)'
);

-- ---------------------------------------------------------------------
-- 3. Which tables an admin has a policy on.
--    admin_all everywhere except audit_log, report_sends, location_pings,
--    notification_outbox, job_runs and job_schedules, which are admin_read:
--    all six are written only by definer functions and the service role
--    (§1.7, §9.9, §5.2b, §8, §7).
-- ---------------------------------------------------------------------
select bag_eq(
  $$ select distinct c.relname::text from pg_policy p join pg_class c on c.oid = p.polrelid
      where p.polname like 'admin\_%' $$,
  $$ values ('applications'::text),('audit_log'),('bank_details'),('bookings'),('breaks'),('check_logs'),
            ('client_qualifications'),('client_rate_cards'),('clients'),
            ('compliance_docs'),('criminal_declarations'),('events'),('feedback'),
            ('hmrc_checklists'),('job_runs'),('job_schedules'),('location_pings'),
            ('notification_outbox'),
            ('push_subscriptions'),('quiz_attempts'),
            ('report_sends'),('roles'),('settings'),('shift_requirements'),('staff'),
            ('staff_references'),('staff_roles'),('venue_types'),('venues'),('violations') $$,
  'admin holds a policy on every RLS table except profiles (the one remaining known gap)'
);

-- ---------------------------------------------------------------------
-- 4. Which tables a worker has a self policy on.
--    0001 gave four; 0004 adds bank_details, staff_references,
--    push_subscriptions (read + write, all self-owned) and staff_roles,
--    quiz_attempts, location_pings (read only — the write side of each is
--    owed to a security definer RPC, see 0004's comments).
-- ---------------------------------------------------------------------
select bag_eq(
  $$ select distinct c.relname::text from pg_policy p join pg_class c on c.oid = p.polrelid
      where p.polname like 'staff\_self%' or p.polname = 'profiles_self' $$,
  $$ values ('staff'::text),('compliance_docs'),('bookings'),('criminal_declarations'),('profiles'),
            ('bank_details'),('staff_references'),('push_subscriptions'),('staff_roles'),
            ('quiz_attempts'),('location_pings') $$,
  'workers hold a self policy on their own staff, docs, bookings, declarations, profile, bank details, references, push subscriptions, roles, quiz attempts and location pings'
);

-- ---------------------------------------------------------------------
-- 5. Which tables a client has any policy on.
--    0004 added none: none of the eleven tables it policed is client-facing
--    and several carry money or worker personal data (§11.1, §1.7). The one
--    row a client can now reach that it could not before is venue_types,
--    through venue_types_read (any signed-in role, reference data only) —
--    deliberately not named client_*, because it is not a client policy.
--    0005 added none either: ADR-0004 gives the Client Portal owner-rights
--    views that scope themselves instead of policies on the tables under
--    them, so this list staying at two IS the money isolation. A new name
--    here means somebody re-opened what 0002 closed.
--    The public application migration added none either: `applications` is admin-only, and a customer
--    has no business in the onboarding pipeline at all.
-- ---------------------------------------------------------------------
select bag_eq(
  $$ select c.relname::text from pg_policy p join pg_class c on c.oid = p.polrelid
      where p.polname like 'client\_%' $$,
  $$ values ('events'::text),('feedback') $$,
  'clients reach only events (read) and feedback (insert) directly; no money-bearing table'
);

-- ---------------------------------------------------------------------
-- 6. Nothing in public escapes RLS by not being an ordinary table.
--    Assertion 2 inspects relkind = 'r'. A MATERIALISED view (relkind 'm')
--    cannot carry row level security at all, and a foreign table ('f')
--    does not carry ours — and both get Supabase's default world grants
--    when they are created. So the cheapest way to leak pay_rate is to
--    add one and watch assertion 2 stay green. docs/03-data-model.md
--    reserves 0003 for payable_shifts_v, which is pay by definition:
--    this is the assertion that makes somebody think about the grants.
--    Existence is fine; being reachable by a PostgREST role is not.
-- ---------------------------------------------------------------------
select is_empty(
  $$ select c.relname::text
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('m', 'f')
        and (has_table_privilege('anon', c.oid, 'select')
          or has_table_privilege('authenticated', c.oid, 'select')) $$,
  'no materialised view or foreign table in public is granted to anon or authenticated: neither can be policed by RLS'
);

-- ---------------------------------------------------------------------
-- 7. RLS on with no policy at all is deny-all, which is safe — but it is
--    only ever deliberate once. Assertions 3 to 5 list tables, so
--    dropping one of a table's several policies leaves every list intact
--    and passes. This catches the case where the last one goes.
--    There is no longer any intended deny-all table to exempt:
--    20260921123503_db_hardening gave notification_outbox its admin_read,
--    so "RLS on, no policy" now always means somebody dropped the last one.
--
--    NOT asserted here, and it should be: relforcerowsecurity. No table
--    forces RLS, so any connection as the table owner reads bank_details
--    and hmrc_checklists in full. That is currently load-bearing — the
--    pgTAP fixtures rely on the owner bypass (_shared/fixtures.psql) and
--    so would the definer RPCs 0004 names — so flipping it is an ADR,
--    not a line in a test. Recorded here so it is not forgotten.
-- ---------------------------------------------------------------------
select is_empty(
  $$ select c.relname::text
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
        and not exists (select 1 from pg_policy p where p.polrelid = c.oid) $$,
  'every RLS table in public carries at least one policy; no table is deny-all by omission'
);

-- ---------------------------------------------------------------------
-- 8. notification_outbox is admin-read and service-role-write (§8).
--    It was deny-all by omission until 20260921123503_db_hardening: RLS on
--    since 0001 and not one policy, so the correct behaviour was an
--    accident and the Back Office could not read its own send queue. The
--    write side is unchanged and must stay that way — a row anybody can
--    insert is a notification anybody can send, and an updatable sent_at
--    is a send anybody can suppress — so this asserts the exact policy
--    set, not merely that one exists. polcmd 'r' = SELECT.
-- ---------------------------------------------------------------------
select bag_eq(
  $$ select p.polname::text || ':' || p.polcmd::text
       from pg_policy p where p.polrelid = 'notification_outbox'::regclass $$,
  $$ values ('admin_read:r'::text) $$,
  'notification_outbox carries exactly one policy: admin_read, select only, matching audit_log and report_sends'
);

-- ---------------------------------------------------------------------
-- 9. spatial_ref_sys carries no policy that can write it.
--
--    This used to assert the exact policy set `spatial_ref_sys_read:r:true`,
--    which only exists where the migration role owns the PostGIS extension.
--    On Supabase it does not (see assertion 2), so that assertion could
--    never pass in CI or on the live project.
--
--    What is asserted instead holds in both worlds: whatever policies this
--    table ends up with, none of them may permit a write. It passes on
--    Supabase, where the degradation leaves no policy at all, and it still
--    passes — and still means something — on a Postgres where the migration
--    succeeds and the read-only policy exists. What it refuses is somebody
--    "fixing" the gap by adding a policy that lets anon write.
--
--    Note this is about policies, not privileges. The grants are the actual
--    hole and they are not reachable from here; see assertion 2.
-- ---------------------------------------------------------------------
select is_empty(
  $$ select p.polname::text || ':' || p.polcmd::text
       from pg_policy p
      where p.polrelid = 'public.spatial_ref_sys'::regclass
        and p.polcmd <> 'r' $$,
  'no policy on spatial_ref_sys permits anything but SELECT'
);

select * from finish();
rollback;
