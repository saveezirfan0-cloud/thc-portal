-- =====================================================================
-- 778 · SpudBros Express staff: onboarding only (ADR-0103)
--   20261007130000_spudbros_express_staff.sql
--
-- Held here:
--   1. the two columns: off by default, and staff_onboarding_only() is
--      true only for SpudBros staff whose THC shifts are not switched on;
--   2. the pool: an onboarding-only worker has NO row (not an Unavailable
--      row); a SpudBros worker with THC shifts on is in it as anyone is;
--   3. the hard stop: a booking for an onboarding-only worker is refused
--      by the table itself, a switched-on one is not;
--   4. set_staff_scheduling: the office sets it and it is audited; a
--      viewer, a worker and a client are refused, and so is a removed
--      account; it will not close the app on someone who holds an
--      upcoming booking; THC shifts "on" means nothing without SpudBros;
--   5. staff_me() carries spudbros / onboardingOnly for the app lock;
--   6. /apply/spudbros marks the NEW candidate it creates and never an
--      existing worker (§2.12 returning applicant).
-- =====================================================================
begin;
select plan(31);
\ir _shared/fixtures.psql

\set evt      '77800000-0000-4000-8000-00000000000e'
\set sec      '77800000-0000-4000-8000-0000000000a1'
\set spud     '77810000-0000-4000-8000-000000000001'
\set spud_on  '77810000-0000-4000-8000-000000000002'
\set plain    '77810000-0000-4000-8000-000000000003'
\set busy     '77810000-0000-4000-8000-000000000004'
\set gone     '77810000-0000-4000-8000-000000000005'
\set spud_uid '77820000-0000-4000-8000-000000000001'
\set viewer   '77820000-0000-4000-8000-000000000002'

insert into auth.users (id, email) values (:'spud_uid', 'spud.778@rls.test'), (:'viewer', 'viewer.778@rls.test');
insert into profiles (id, role, full_name) values (:'spud_uid', 'staff', 'Sid Spud');
insert into profiles (id, role, office_role, full_name) values (:'viewer', 'admin', 'viewer', 'Vic Viewer');

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer, auto_assign) values
  (:'evt', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Onboarding-only Gala', date '2027-03-10', true, true, true);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour, auto_assign) values
  (:'sec', :'evt', :'role_id', '2027-03-10 17:00+00', '2027-03-10 23:00+00', 6, 0, 30, 15, 6, true);

insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, rtw_branch,
                   spudbros_express, thc_shifts_enabled) values
  (:'spud',    :'spud_uid', 'Sid', 'Spud',  's1@sb.test', '+447700978001', date '1995-01-01', 'compliant', 'uk_irish', true,  false),
  (:'spud_on', null,        'Sue', 'Both',  's2@sb.test', '+447700978002', date '1995-01-01', 'compliant', 'uk_irish', true,  true),
  (:'plain',   null,        'Pat', 'Plain', 's3@sb.test', '+447700978003', date '1995-01-01', 'compliant', 'uk_irish', false, false),
  (:'busy',    null,        'Bea', 'Busy',  's4@sb.test', '+447700978004', date '1995-01-01', 'compliant', 'uk_irish', false, false),
  (:'gone',    null,        'Gus', 'Gone',  's5@sb.test', '+447700978005', date '1995-01-01', 'compliant', 'uk_irish', false, false);
insert into staff_roles (staff_id, role_id)
select id, :'role_id' from staff where id in (:'spud', :'spud_on', :'plain', :'busy', :'gone');

-- ---------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------
select is(
  (select row(spudbros_express, thc_shifts_enabled)::text from staff where id = :'staffa'),
  row(false, false)::text, 'nobody is SpudBros staff unless they are marked');
select is(
  (select array_agg(staff_onboarding_only(id) order by first_name)
     from staff where id in (:'spud', :'spud_on', :'plain')),
  array[false, true, false]::boolean[],   -- Pat, Sid, Sue
  'onboarding only = SpudBros staff without THC shifts switched on');
select is(staff_onboarding_only(null), false, 'no worker, not onboarding-only');

-- ---------------------------------------------------------------------
-- 2. The pool
-- ---------------------------------------------------------------------
select is((select count(*)::int from auto_assign_candidates(:'sec') where staff_id = :'spud'), 0,
  'an onboarding-only worker has no row in the pool — not even an Unavailable one');
select ok(exists (select 1 from auto_assign_candidates(:'sec') where staff_id = :'spud_on' and gate is null),
  'a SpudBros worker with THC shifts switched on is in the pool as anyone is');
select ok(exists (select 1 from auto_assign_candidates(:'sec') where staff_id = :'plain' and gate is null),
  'an ordinary worker is untouched');
select is((select count(*)::int from auto_assign_candidates(:'sec', true) where staff_id = :'spud'), 0,
  'and the escalation pool leaves them out too');

-- ---------------------------------------------------------------------
-- 3. The hard stop on the table
-- ---------------------------------------------------------------------
select throws_ok(
  format($$ insert into bookings (shift_id, staff_id, status, source) values (%L, %L, 'invited', 'manual') $$,
         :'sec', :'spud'),
  'P0001', 'onboarding_only_worker', 'a booking for an onboarding-only worker is refused by the table');
select lives_ok(
  format($$ insert into bookings (shift_id, staff_id, status, source) values (%L, %L, 'invited', 'manual') $$,
         :'sec', :'spud_on'),
  'a SpudBros worker with THC shifts on can be invited');
-- Bea is ordinary and now holds an upcoming invitation (used in section 4).
select lives_ok(
  format($$ insert into bookings (shift_id, staff_id, status, source) values (%L, %L, 'invited', 'manual') $$,
         :'sec', :'busy'),
  'an ordinary worker can be invited');

-- ---------------------------------------------------------------------
-- 4. set_staff_scheduling
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);

select is(set_staff_scheduling(:'plain', true, false)->>'spudbrosExpress', 'true',
  'the office marks a worker as SpudBros Express staff');
select is(staff_onboarding_only(:'plain'), true, 'and they are onboarding only from then on');
select is(
  (select data from audit_log where action = 'staff.scheduling_set' and entity_id = :'plain'),
  jsonb_build_object('staffId', :'plain', 'spudbrosExpress', true, 'thcShiftsEnabled', false),
  'audited');

select throws_ok(format($$ select set_staff_scheduling(%L, true, false) $$, :'busy'),
  'P0001', 'has_upcoming_shifts', 'it will not close the app on someone with an upcoming invitation');
select is(set_staff_scheduling(:'busy', true, true)->>'thcShiftsEnabled', 'true',
  'marked SpudBros with THC shifts on, the same worker is accepted');
select is(staff_onboarding_only(:'busy'), false, 'and they are not onboarding only');
select is(set_staff_scheduling(:'plain', false, true)->>'thcShiftsEnabled', 'false',
  'THC shifts "on" means nothing for a worker who is not SpudBros staff');

select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
select throws_ok(format($$ select set_staff_scheduling(%L, true, false) $$, :'gone'),
  '42501', 'read_only', 'a viewer is refused by the write guard');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select throws_ok(format($$ select set_staff_scheduling(%L, false, false) $$, :'spud'),
  '42501', 'not_authorised', 'a worker cannot switch their own scheduling back on');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select throws_ok(format($$ select set_staff_scheduling(%L, true, false) $$, :'gone'),
  '42501', 'not_authorised', 'a client login cannot call it');
reset role;

update staff set removed_at = now() where id = :'gone';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select throws_ok(format($$ select set_staff_scheduling(%L, true, false) $$, :'gone'),
  'P0001', 'staff_removed', 'refused on a removed worker');
reset role;

-- ---------------------------------------------------------------------
-- 5. staff_me() — what the app lock reads
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'spud_uid', 'role', 'authenticated')::text, true);
select is(staff_me()->>'onboardingOnly', 'true', 'staff_me(): an onboarding-only worker says so');
select is(staff_me()->>'spudbros', 'true', 'staff_me(): and that they are SpudBros staff');
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select is(staff_me()->>'onboardingOnly', 'false', 'staff_me(): an ordinary worker is not');
reset role;

-- ---------------------------------------------------------------------
-- 6. /apply/spudbros
-- ---------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'public.record_application_source(text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_application_source(text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.record_application_source(text,text)', 'execute'),
  'record_application_source is owner-only — no API role can mark anyone directly');

set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select lives_ok(
  $$ select submit_application_as_caller('Nina', 'Spud', 'nina@t778.test', '+447700978101', date '1999-03-03', true,
       null, null, 'spudbros') $$,
  'a new applicant through /apply/spudbros is accepted');
select lives_ok(
  $$ select submit_application_as_caller('Omar', 'Open', 'omar@t778.test', '+447700978102', date '1999-04-04', true,
       null, null, null) $$,
  'a new applicant through /apply is accepted');
-- staffb (fixtures) is a live worker: the §2.12 match.
select lives_ok(
  $$ select submit_application_as_caller('Staff', 'Bravo', 'staffb@rls.test', '+447700978103', date '1994-02-02', true,
       null, null, 'spudbros') $$,
  'an existing worker re-applying through /apply/spudbros is accepted');
reset role;

select is((select spudbros_express from staff where email = 'nina@t778.test'), true,
  'the new candidate from /apply/spudbros is marked SpudBros Express staff');
select is((select spudbros_express from staff where email = 'omar@t778.test'), false,
  'the new candidate from /apply is not');
select is((select spudbros_express from staff where id = :'staffb'), false,
  'a returning applicant is never marked — a live worker cannot be closed out from the public form');

select * from finish();
rollback;
