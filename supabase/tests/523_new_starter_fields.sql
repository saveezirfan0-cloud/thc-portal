-- =====================================================================
-- 523 · New Starter fields collected by the wizard
--       — 20260926100300_new_starter_fields.sql (§9.9 Tab 3, §10.3, §2.8)
--
-- What this file holds the database to:
--
--   · staff.gender is M or F, staff.home_postcode is upper-case with the
--     one space, and format_uk_postcode() is the shape's one source;
--   · step 1 refuses a missing or invalid gender in every branch, and the
--     old seven-argument form is closed to every PostgREST role — a
--     client cannot leave the field out;
--   · step 2 stores the postcode on its own and the country as United
--     Kingdom, and onboarding_state() hands all three back;
--   · another worker can neither read nor write them; each RPC writes the
--     caller's row only;
--   · the §9.9 New Starter report reads the stored postcode over the one
--     at the end of the address, with the country and the gender;
--   · the three columns are granted (20260923210000) — no column is added
--     here, and 445 keeps the loud check.
--
-- Every row is created inside the transaction and rolled back. The
-- report fixture uses Mon 3 – Sun 9 March 2025, the week 410 chose
-- because nothing in seed.sql lands in it.
-- =====================================================================
begin;
select plan(33);
\ir _shared/fixtures.psql

\set amara     'c5230000-0000-4000-8000-000000000001'
\set tom       'c5230000-0000-4000-8000-000000000002'
\set rep       'c5230000-0000-4000-8000-000000000003'
\set amara_uid 'c5230000-0000-4000-8000-000000000011'
\set tom_uid   'c5230000-0000-4000-8000-000000000012'

insert into auth.users (id, email) values
  (:'amara_uid', 'amara@newstarter.test'),
  (:'tom_uid',   'tom@newstarter.test');

insert into profiles (id, role, full_name, client_id) values
  (:'amara_uid', 'staff', 'Amara Kalu', null),
  (:'tom_uid',   'staff', 'Tom Reid',   null);

-- Two candidates on step 1, and one compliant worker for the report whose
-- address line ends in a DIFFERENT postcode from the stored one, so the
-- report's preference for the column is visible.
insert into staff (id, user_id, first_name, last_name, email, phone, dob, status) values
  (:'amara', :'amara_uid', 'Amara', 'Kalu', 'amara@newstarter.test', '+447700952301',
   date '2003-11-22', 'documents'),
  (:'tom',   :'tom_uid',   'Tom',   'Reid', 'tom@newstarter.test',   '+447700952302',
   date '1994-01-09', 'documents');
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status,
                   home_address, home_postcode, home_country, gender) values
  (:'rep', 95231, 'Report', 'Starter', 'rep@newstarter.test', '+447700952303',
   date '1998-04-05', 'compliant',
   'Flat 4, 22 Roman Road, London E1 6AN', 'E2 0RY', 'United Kingdom', 'F');

-- =====================================================================
-- 1–9 · The columns, their constraints and the formatter
-- =====================================================================
select has_column('public', 'staff', 'gender',        'staff.gender exists');
select has_column('public', 'staff', 'home_postcode', 'staff.home_postcode exists');
select has_column('public', 'staff', 'home_country',  'staff.home_country exists');

select throws_ok(
  format($$ update staff set gender = 'X' where id = %L $$, :'amara'),
  '23514', null, 'gender is M or F and nothing else (staff_gender_m_or_f)');
select throws_ok(
  format($$ update staff set home_postcode = 'e2 0ry' where id = %L $$, :'amara'),
  '23514', null, 'home_postcode is upper case (staff_home_postcode_format)');
select throws_ok(
  format($$ update staff set home_postcode = 'E20RY' where id = %L $$, :'amara'),
  '23514', null, 'and carries the one space before the inward code');

select is(format_uk_postcode(' e2 0ry '), 'E2 0RY', 'format_uk_postcode: case and spacing normalised');
select is(format_uk_postcode('sw1a1aa'),  'SW1A 1AA', 'a four-character outward code');
select is(format_uk_postcode('NOT A CODE'), null, 'and null for anything that is not a UK postcode');

-- =====================================================================
-- 10–13 · Grants (docs/14 §3c)
-- =====================================================================
select ok(has_function_privilege('authenticated',
  'public.onboarding_save_right_to_work(text, date, text, text, date, text, boolean, text)', 'execute'),
  'the eight-argument step 1 is the worker''s');
select ok(not has_function_privilege('anon',
  'public.onboarding_save_right_to_work(text, date, text, text, date, text, boolean, text)', 'execute'),
  'and not anon''s');
select ok(not has_function_privilege('authenticated',
  'public.onboarding_save_right_to_work(text, date, text, text, date, text, boolean)', 'execute'),
  'the seven-argument form (no gender) is closed to every PostgREST role');
select ok(has_column_privilege('authenticated', 'public.staff', 'gender', 'select')
      and has_column_privilege('authenticated', 'public.staff', 'home_postcode', 'select')
      and has_column_privilege('authenticated', 'public.staff', 'home_country', 'select'),
  'the three columns are granted by name (20260923210000) — nothing added here needs a grant');

-- =====================================================================
-- 14–27 · Amara, as the worker: step 1 asks for gender, step 2 stores
--         the postcode and the country
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'amara_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$ select onboarding_save_right_to_work('eu_settled', date '1999-09-30', 'W123AB4CD', null, null, null, false) $$,
  '42501', null, 'a client that leaves gender out meets the revoked seven-argument form, not a way round');
select throws_ok(
  $$ select onboarding_save_right_to_work('eu_settled', date '1999-09-30', 'W123AB4CD', null, null, null, false, null) $$,
  'P0001', 'gender_required', 'gender is required — share-code branch');
select throws_ok(
  $$ select onboarding_save_right_to_work('uk_irish', date '1999-09-30', null, null, null, 'passport', false, null) $$,
  'P0001', 'gender_required', 'and in the UK / Irish branch');
select throws_ok(
  $$ select onboarding_save_right_to_work('eu_settled', date '1999-09-30', 'W123AB4CD', null, null, null, false, 'X') $$,
  'P0001', 'bad_gender', 'and only M or F is taken (HMRC''s two values, §9.9 Tab 3)');

select lives_ok(
  $$ select onboarding_save_right_to_work('international_student', date '2003-11-22', 'w12 3ab 4cd', null, null, null, false, 'F') $$,
  'step 1 with a gender is accepted');
select is((select gender from staff where id = :'amara'), 'F', 'and stored on the worker');
select is(onboarding_state()->>'gender', 'F', 'onboarding_state() hands it back so step 1 re-opens with it');

select throws_ok(
  $$ select onboarding_save_address('Flat 4, 22 Roman Road', 'London', 'NOT A CODE', 51.5290, -0.0450) $$,
  'P0001', 'bad_postcode', 'step 2 still refuses a postcode that is not one');
select lives_ok(
  $$ select onboarding_save_address('Flat 4, 22 Roman Road', 'London', 'e20ry', 51.5290, -0.0450) $$,
  'a pin in Bethnal Green with its address is saved');
select is(
  (select row(home_address, home_postcode, home_country)::text from staff where id = :'amara'),
  row('Flat 4, 22 Roman Road, London E2 0RY', 'E2 0RY', 'United Kingdom')::text,
  'the address line as before, the postcode on its own and formatted, the country United Kingdom');
select is(onboarding_state()->>'homePostcode', 'E2 0RY', 'onboarding_state() carries the postcode');
select is(onboarding_state()->>'homeCountry', 'United Kingdom', 'and the country');

select lives_ok(
  $$ select onboarding_save_right_to_work('international_student', date '2003-11-22', 'W123AB4CD', null, null, null, false, 'M') $$,
  'step 1 is editable until the documents are submitted, gender included');
select is((select gender from staff where id = :'amara'), 'M', 'and the change is stored');
reset role;

-- =====================================================================
-- 28–31 · Tom: another worker cannot read or write them, and his own
--         step 1 touches his row only
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'tom_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from staff where id = :'amara'), 0,
  'Tom cannot see Amara''s row at all (staff_self)');
do $$
begin
  update staff set gender = 'F', home_postcode = 'N1 9GU', home_country = 'France'
   where id = 'c5230000-0000-4000-8000-000000000001';
exception when insufficient_privilege then
  null;
end $$;
select lives_ok(
  $$ select onboarding_save_right_to_work('uk_irish', date '1994-01-09', null, null, null, 'passport', false, 'F') $$,
  'Tom''s own step 1 is accepted');
reset role;
select is(
  (select row(gender, home_postcode, home_country)::text from staff where id = :'amara'),
  row('M', 'E2 0RY', 'United Kingdom')::text,
  'Amara''s three fields are exactly as she left them — Tom''s direct write reached nothing');
select is((select gender from staff where id = :'tom'), 'F', 'and the RPC wrote Tom''s row only');

-- =====================================================================
-- 32–33 · The New Starter report reads the stored values
-- =====================================================================
insert into events (id, client_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer)
values ('c5230000-0000-4000-8000-000000000021', :'clienta', 'Report Venue', '1 Report St, London',
        st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150,
        'New Starter Fixture', date '2025-03-04', true, false);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour)
values ('c5230000-0000-4000-8000-000000000022', 'c5230000-0000-4000-8000-000000000021', :'role_id',
        '2025-03-04 12:00+00', '2025-03-04 16:00+00', 1, 0, 22.97,
        (select pay_rate from roles where id = :'role_id'), 1);
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at)
values ('c5230000-0000-4000-8000-000000000023', 'c5230000-0000-4000-8000-000000000022', :'rep',
        'worked', 'manual', '2025-03-02 12:00+00');
insert into check_logs (booking_id, attempted_at, outcome, check_in_at, check_out_at)
values ('c5230000-0000-4000-8000-000000000023', '2025-03-04 12:00+00', 'checked_in',
        '2025-03-04 12:00+00', '2025-03-04 16:00+00');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table ns as select * from new_starter_report('2025-03-10');
reset role;

select is((select count(*)::int from ns where staff_id = :'rep'), 1,
  'the worker whose first paid shift fell in Mon 3 – Sun 9 Mar is in the report picked on Mon 10 Mar');
select is(
  (select row(postcode, country, gender, first_shift_date)::text from ns where staff_id = :'rep'),
  row('E2 0RY', 'United Kingdom', 'F', date '2025-03-04')::text,
  'Postcode is the stored home_postcode, not the E1 6AN at the end of the address; Country and Gender read as stored');

select * from finish();
rollback;
