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
-- Scope refs: §1.5 data model, §1.4 roles, §11.1 client sees no money.
-- =====================================================================
begin;
select plan(8);

-- ---------------------------------------------------------------------
-- 1. Tables with RLS enabled (0001_init.sql)
-- ---------------------------------------------------------------------
select bag_eq(
  $$ select c.relname::text
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity $$,
  $$ values ('applications'::text),('audit_log'),('bank_details'),('bookings'),('breaks'),('check_logs'),
            ('client_qualifications'),('client_rate_cards'),('clients'),
            ('compliance_docs'),('criminal_declarations'),('events'),('feedback'),
            ('hmrc_checklists'),('location_pings'),('notification_outbox'),('profiles'),
            ('push_subscriptions'),('quiz_attempts'),('report_sends'),('roles'),('settings'),
            ('shift_requirements'),('staff'),('staff_references'),('staff_roles'),
            ('venue_types'),('venues'),('violations') $$,
  'RLS is enabled on all 29 tables: the 17 from 0001_init.sql, the 11 closed by 0004_rls_gaps and applications from 0010'
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
--    spatial_ref_sys belongs to PostGIS and is not ours to alter.
-- ---------------------------------------------------------------------
select is_empty(
  $$ select c.relname::text
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
        and c.relname <> 'spatial_ref_sys' $$,
  'every table in public has row level security enabled'
);

-- ---------------------------------------------------------------------
-- 3. Which tables an admin has a policy on.
--    admin_all everywhere except audit_log and report_sends, which are
--    admin_read: both are evidence, written only by definer functions and
--    the service role (§1.7, §9.9).
-- ---------------------------------------------------------------------
select bag_eq(
  $$ select distinct c.relname::text from pg_policy p join pg_class c on c.oid = p.polrelid
      where p.polname like 'admin\_%' $$,
  $$ values ('applications'::text),('audit_log'),('bank_details'),('bookings'),('breaks'),('check_logs'),
            ('client_qualifications'),('client_rate_cards'),('clients'),
            ('compliance_docs'),('criminal_declarations'),('events'),('feedback'),
            ('hmrc_checklists'),('location_pings'),('push_subscriptions'),('quiz_attempts'),
            ('report_sends'),('roles'),('settings'),('shift_requirements'),('staff'),
            ('staff_references'),('staff_roles'),('venue_types'),('venues'),('violations') $$,
  'admin holds a policy on every RLS table except profiles and notification_outbox (known gaps)'
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
--    notification_outbox is the one intended deny-all (assertion 8).
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
        and c.relname <> 'notification_outbox'
        and not exists (select 1 from pg_policy p where p.polrelid = c.oid) $$,
  'every RLS table in public carries at least one policy; only notification_outbox is deliberately deny-all'
);

-- ---------------------------------------------------------------------
-- 8. notification_outbox is deny-all
-- ---------------------------------------------------------------------
select is(
  (select count(*)::int from pg_policy where polrelid = 'notification_outbox'::regclass),
  0,
  'KNOWN GAP: notification_outbox has RLS on and no policy, so it is deny-all for every role'
);

select * from finish();
rollback;
