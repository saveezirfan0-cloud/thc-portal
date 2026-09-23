-- =====================================================================
-- 521 · home_location follows the postcode (ADR-0025)
--       — 20260926100100_home_location_from_postcode.sql
--
-- What the database must hold for the app's postcodes.io lookup to be
-- safe to accept from a phone:
--
--   · the caller only, and only to a postcode in their OWN current
--     home_address. A worker cannot be parked at a postcode they did not
--     write, and a colleague cannot move them at all — there is no id to
--     name them by.
--   · inside the UK box. postcodes.io never answers outside it; a forged
--     point can.
--   · the source label: 'pin' by default, 'postcode' once this runs, and
--     back to 'pin' when something else moves the point — the wizard's
--     pin after a reset, for instance — without saying otherwise.
--   · staff_update_contact() is exactly as it was: it saves the address,
--     queues E7, and does not move the pin. The pin moves only here.
--
-- employee_id is 93xxx (see 330 for why); every row rolls back.
-- =====================================================================
begin;
select plan(28);

\set me       'c6c6c6c6-0000-4000-8000-000000000001'
\set mate     'c6c6c6c6-0000-4000-8000-000000000002'
\set me_uid   'c7c7c7c7-0000-4000-8000-000000000001'
\set mate_uid 'c7c7c7c7-0000-4000-8000-000000000002'
\set fn       'public.staff_set_home_location_from_postcode(text, double precision, double precision)'

insert into auth.users (id, email) values
  (:'me_uid',   'me@postcode.test'),
  (:'mate_uid', 'mate@postcode.test');

insert into staff (id, user_id, first_name, last_name, email, phone, dob, home_address,
                   home_location, status, employee_id, rtw_branch)
values
  (:'me', :'me_uid', 'Amara', 'Kalu', 'me@postcode.test', '+447700900521',
   date '1996-04-02', 'Flat 4, 22 Roman Road, London E2 0RY',
   st_setsrid(st_makepoint(-0.0430, 51.5290), 4326)::geography, 'compliant', 93521, 'uk_irish'),
  (:'mate', :'mate_uid', 'Tom', 'Reid', 'mate@postcode.test', '+447700900522',
   date '1994-01-09', '9 Other Road, London', null, 'compliant', 93522, 'uk_irish');

-- =====================================================================
-- 1. The column and the grants
-- =====================================================================
select is((select home_location_source from staff where id = :'me'), 'pin',
  'a point the worker placed — or no point yet — is labelled ''pin'' by default');
select throws_ok(
  format($$ update staff set home_location_source = 'gps' where id = %L $$, :'me'),
  '23514', null, 'the label is one of pin / postcode / office and nothing else');
select ok(has_column_privilege('authenticated', 'public.staff', 'home_location_source', 'select'),
  'the column is granted by name, as #44 requires of every column added to staff');

select ok(has_function_privilege('authenticated', :'fn', 'execute'),
  'a signed-in worker may call it');
select ok(not has_function_privilege('anon', :'fn', 'execute'),
  'anon may not: there is no caller to move');
select ok(not has_function_privilege('public', :'fn', 'execute'),
  'and PUBLIC may not, so no role inherits it');

select throws_ok($$ select staff_set_home_location_from_postcode('E2 0RY', 51.5290, -0.0430) $$,
  'P0001', 'unknown_staff', 'with no session there is nobody to move');

-- =====================================================================
-- 2. The worker moves their own pin to their own postcode
-- =====================================================================
set local "request.jwt.claims" = '{"sub":"c7c7c7c7-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok($$ select staff_set_home_location_from_postcode('e2 0ry', 51.5300, -0.0450) $$,
  'the caller may set their pin from the postcode in their own address, however it was typed');
select is((select home_location_source from staff where id = :'me'), 'postcode',
  'and the point is labelled as a postcode centroid');
select is((select round(st_y(home_location::geometry)::numeric, 4) from staff where id = :'me'),
  51.5300, 'the latitude moved');
select is((select round(st_x(home_location::geometry)::numeric, 4) from staff where id = :'me'),
  -0.0450, 'and the longitude — x is lng and y is lat, as venues store it');

select throws_ok($$ select staff_set_home_location_from_postcode('E1 6AN', 51.5200, -0.0700) $$,
  'P0001', 'postcode_not_in_address',
  'a postcode the worker did not write into their address is refused');
select is((select round(st_y(home_location::geometry)::numeric, 4) from staff where id = :'me'),
  51.5300, 'and the point stays where it was');

select throws_ok($$ select staff_set_home_location_from_postcode('E2 0RY', 48.8566, 2.3522) $$,
  'P0001', 'pin_outside_uk',
  'a point outside the UK box is refused even for the right postcode: postcodes.io never answers there, a forged call can');
select throws_ok($$ select staff_set_home_location_from_postcode('nope', 51.5300, -0.0450) $$,
  'P0001', 'bad_postcode', 'something that is not a postcode is refused before anything is read');

-- =====================================================================
-- 3. staff_update_contact() is exactly as it was
-- =====================================================================
select lives_ok($$ select staff_update_contact('+447700900521', '12 New Street, London E1 6AN') $$,
  'the worker changes their address through staff_update_contact() as before');
select isnt_empty(
  $$ select 1 from notification_outbox where template = 'E7'
      and payload->>'employeeId' = '93521' and payload->>'changed' = 'home address' $$,
  'which still queues E7 in the same transaction (§8)');
select is((select round(st_y(home_location::geometry)::numeric, 4) from staff where id = :'me'),
  51.5300, 'and still does not move the pin itself: the old point stays until the lookup answers');
select is((select home_location_source from staff where id = :'me'), 'postcode',
  'so the label is untouched too');

select lives_ok($$ select staff_set_home_location_from_postcode('E1 6AN', 51.5200, -0.0700) $$,
  'once the address carries E1 6AN, the pin may follow it');
select is((select round(st_y(home_location::geometry)::numeric, 4) from staff where id = :'me'),
  51.5200, 'and it does');
select throws_ok($$ select staff_set_home_location_from_postcode('E2 0RY', 51.5300, -0.0450) $$,
  'P0001', 'postcode_not_in_address',
  'while the postcode the address no longer carries is refused: only the CURRENT address counts');

-- =====================================================================
-- 4. Another worker cannot move it
-- =====================================================================
set local "request.jwt.claims" = '{"sub":"c7c7c7c7-0000-4000-8000-000000000002","role":"authenticated"}';

select throws_ok($$ select staff_set_home_location_from_postcode('E1 6AN', 51.0000, -1.0000) $$,
  'P0001', 'postcode_not_in_address',
  'a colleague calling with the first worker''s postcode is refused: no id to name them by, and the postcode is not in the caller''s own address');
select is((select round(st_y(home_location::geometry)::numeric, 4) from staff where id = :'me'),
  51.5200, 'the first worker''s point did not move');
select ok((select home_location is null from staff where id = :'mate'),
  'and neither did the caller''s own — they have no postcode to follow');

-- =====================================================================
-- 5. The label follows whoever moves the point
-- =====================================================================
update staff set home_location = st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography
 where id = :'me';
select is((select home_location_source from staff where id = :'me'), 'pin',
  'a write that moves the point and says nothing about its source is a placed pin — the wizard after a reset to candidate, for instance');

update staff set home_location = st_setsrid(st_makepoint(-0.1100, 51.5100), 4326)::geography,
                 home_location_source = 'office'
 where id = :'me';
select is((select home_location_source from staff where id = :'me'), 'office',
  'a writer that says where the point came from is believed');

-- =====================================================================
-- 6. A leaver's details are frozen, the pin included (§10.6)
-- =====================================================================
set local "request.jwt.claims" = '{"sub":"c7c7c7c7-0000-4000-8000-000000000001","role":"authenticated"}';
update staff set status = 'inactive', left_at = now() where id = :'me';
select throws_ok($$ select staff_set_home_location_from_postcode('E1 6AN', 51.5200, -0.0700) $$,
  'P0001', 'not_editable', 'a leaver cannot move their pin, as they cannot change their address');

select * from finish();
rollback;
