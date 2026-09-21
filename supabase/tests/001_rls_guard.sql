-- =====================================================================
-- 001 · RLS guard
--
-- A structural snapshot of where row level security stands. It fails the
-- moment a table is added without RLS, a policy is dropped, or one of the
-- known gaps below is closed (at which point the expected list here must be
-- updated in the same PR).
-- Scope refs: §1.5 data model, §1.4 roles, §11.1 client sees no money.
-- =====================================================================
begin;
select plan(6);

-- ---------------------------------------------------------------------
-- 1. Tables with RLS enabled (0001_init.sql)
-- ---------------------------------------------------------------------
select bag_eq(
  $$ select c.relname::text
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity $$,
  $$ values ('bookings'::text),('breaks'),('check_logs'),('client_rate_cards'),('clients'),
            ('compliance_docs'),('criminal_declarations'),('events'),('feedback'),
            ('notification_outbox'),('profiles'),('roles'),('settings'),
            ('shift_requirements'),('staff'),('venues'),('violations') $$,
  'RLS is enabled on exactly the 17 tables 0001_init.sql enables it for'
);

-- ---------------------------------------------------------------------
-- 2. KNOWN GAP · tables that carry no RLS at all.
--    Supabase grants anon/authenticated full DML on public tables, so every
--    name below is world-readable through PostgREST today. bank_details and
--    hmrc_checklists in particular are payroll data (§11.1 / §1.7).
--    Remove a name from this list in the same PR that enables RLS on it.
-- ---------------------------------------------------------------------
select bag_eq(
  $$ select c.relname::text
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
        and c.relname <> 'spatial_ref_sys' $$,
  $$ values ('audit_log'::text),('bank_details'),('client_qualifications'),('hmrc_checklists'),
            ('location_pings'),('push_subscriptions'),('quiz_attempts'),('report_sends'),
            ('staff_references'),('staff_roles'),('venue_types') $$,
  'KNOWN GAP: these tables have no RLS yet (see 001 header)'
);

-- ---------------------------------------------------------------------
-- 3. Which tables an admin has a policy on
-- ---------------------------------------------------------------------
select bag_eq(
  $$ select c.relname::text from pg_policy p join pg_class c on c.oid = p.polrelid
      where p.polname = 'admin_all' $$,
  $$ values ('bookings'::text),('breaks'),('check_logs'),('client_rate_cards'),('clients'),
            ('compliance_docs'),('criminal_declarations'),('events'),('feedback'),
            ('roles'),('settings'),('shift_requirements'),('staff'),('venues'),('violations') $$,
  'admin_all exists on every RLS table except profiles and notification_outbox (known gaps)'
);

-- ---------------------------------------------------------------------
-- 4. Which tables a worker has a self policy on
-- ---------------------------------------------------------------------
select bag_eq(
  $$ select c.relname::text from pg_policy p join pg_class c on c.oid = p.polrelid
      where p.polname in ('staff_self','staff_self_docs','staff_self_bookings','staff_self_decl','profiles_self') $$,
  $$ values ('staff'::text),('compliance_docs'),('bookings'),('criminal_declarations'),('profiles') $$,
  'workers have a self policy on staff, compliance_docs, bookings, criminal_declarations, profiles only'
);

-- ---------------------------------------------------------------------
-- 5. Which tables a client has any policy on
-- ---------------------------------------------------------------------
select bag_eq(
  $$ select c.relname::text from pg_policy p join pg_class c on c.oid = p.polrelid
      where p.polname like 'client\_%' $$,
  $$ values ('events'::text),('feedback') $$,
  'clients reach only events (read) and feedback (insert) directly; no money-bearing table'
);

-- ---------------------------------------------------------------------
-- 6. notification_outbox is deny-all
-- ---------------------------------------------------------------------
select is(
  (select count(*)::int from pg_policy where polrelid = 'notification_outbox'::regclass),
  0,
  'KNOWN GAP: notification_outbox has RLS on and no policy, so it is deny-all for every role'
);

select * from finish();
rollback;
