-- =====================================================================
-- 530 · A worker's home location follows their address (§10.1, §6)
--       — 20260926110000_home_location_follows_address.sql
--
--   A. Who can reach it: anon refused; a worker only ever writes their own
--      row (there is no id to name); the office reads every worker's stale
--      flag, a worker only their own, a client none.
--   B. The point moves the pin ONLY alongside a change of address, only
--      inside the UK, and only for an address that ends in a postcode.
--   C. No point on an address change: the address saves, the old pin
--      stays, the flag goes up — and E7 still goes to the office.
--   D. The trigger keeps the flag on the other paths.
-- =====================================================================
begin;
select plan(32);
\ir _shared/fixtures.psql

-- Staff A lives in Bethnal Green; the pin is the one they dropped at 2/11.
update staff
   set home_address = 'Flat 4, 22 Roman Road, London E2 0RY',
       home_location = st_setsrid(st_makepoint(-0.0420, 51.5300), 4326)::geography
 where id = :'staffa';
update staff
   set home_address = '9 Other Road, London N1 1AA',
       home_location = st_setsrid(st_makepoint(-0.1000, 51.5400), 4326)::geography
 where id = :'staffb';

-- =====================================================================
-- A · who can reach it
-- =====================================================================
select ok(
  not has_function_privilege('anon', 'staff_update_contact_geocoded(text,text,double precision,double precision)', 'execute'),
  'anon cannot execute staff_update_contact_geocoded');
select ok(
  has_column_privilege('authenticated', 'public.staff', 'home_location_stale', 'select'),
  'the flag is granted like every other non-internal staff column (445); RLS decides whose row');
select ok(
  has_function_privilege('authenticated', 'staff_update_contact_geocoded(text,text,double precision,double precision)', 'execute'),
  'a signed-in caller can reach it (it resolves the worker itself)');
select ok(
  not has_function_privilege('authenticated', 'staff_home_location_staleness()', 'execute'),
  'the trigger function is not callable');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'staff_update_contact_geocoded'),
  'it is security definer and pins its search_path');

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok(
  $$ select staff_update_contact_geocoded('+447700900011', '1 Anon Street, London E1 6AN', 51.52, -0.07) $$,
  '42501', null, 'a signed-out caller is refused outright');
reset role;

-- The office, who is not a worker, has no row for this to resolve to.
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ select staff_update_contact_geocoded('+447700900011', '1 Office Street, London E1 6AN', 51.52, -0.07) $$,
  'P0001', 'unknown_staff', 'it resolves the caller from the session: the office has no worker row to write');
reset role;

-- =====================================================================
-- B · the point, and when it counts
-- =====================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

select is(
  staff_update_contact_geocoded('+447700900011', 'Flat 4, 22 Roman Road, London E2 0RY', 55.95, -3.19)->'located',
  'null'::jsonb,
  'an unchanged address with a point: nothing located');
reset role;
select is(
  (select round(st_y(home_location::geometry)::numeric, 4) from staff where id = :'staffa'), 51.5300,
  'and the pin did not move — a point alone is not a way to move one''s own score');

set local role authenticated;
select throws_ok(
  $$ select staff_update_contact_geocoded('+447700900011', '1 Rue de Rivoli, Paris 75001 E1 6AN', 48.86, 2.35) $$,
  'P0001', 'pin_outside_uk', 'a point outside the UK box is refused');
select throws_ok(
  $$ select staff_update_contact_geocoded('+447700900011', '12 New Street, London E1 6AN', 51.52, null) $$,
  'P0001', 'bad_location', 'half a point is refused');
select throws_ok(
  $$ select staff_update_contact_geocoded('+447700900011', '12 New Street, London', 51.52, -0.07) $$,
  'P0001', 'no_postcode', 'a point for an address with no postcode cannot have come from a lookup');
reset role;
select is(
  (select home_address from staff where id = :'staffa'), 'Flat 4, 22 Roman Road, London E2 0RY',
  'a refused point saves nothing at all');

set local role authenticated;
select is(
  staff_update_contact_geocoded('+447700900011', '12 New Street, London E1 6AN', 51.5178, -0.0786)->'located',
  'true'::jsonb,
  'a new address with its geocoded point: located');
reset role;
select is(
  (select home_address from staff where id = :'staffa'), '12 New Street, London E1 6AN',
  'the address is saved');
select is(
  (select array[round(st_y(home_location::geometry)::numeric, 4), round(st_x(home_location::geometry)::numeric, 4)]
     from staff where id = :'staffa'),
  array[51.5178, -0.0786]::numeric[],
  'and the pin moved to the point');
select is((select home_location_stale from staff where id = :'staffa'), false,
  'and it is not stale');
select isnt_empty(
  $$ select 1 from notification_outbox where template = 'E7'
      and payload->>'employeeId' = '90001' and payload->>'changed' = 'home address' $$,
  'E7 still goes to the office in the same transaction');
select is(
  (select home_address from staff where id = :'staffb'), '9 Other Road, London N1 1AA',
  'a colleague''s row is untouched — there is no id to point at them');

-- =====================================================================
-- C · the lookup failed
-- =====================================================================
set local role authenticated;
select is(
  staff_update_contact_geocoded('+447700900011', '3 Mare Street, London E8 4RP', null, null)->'located',
  'false'::jsonb,
  'an address change with no point: saved, not located');
reset role;
select is(
  (select home_address from staff where id = :'staffa'), '3 Mare Street, London E8 4RP',
  'the address is saved regardless');
select is(
  (select array[round(st_y(home_location::geometry)::numeric, 4), round(st_x(home_location::geometry)::numeric, 4)]
     from staff where id = :'staffa'),
  array[51.5178, -0.0786]::numeric[],
  'the previous pin is kept, not cleared');
select is((select home_location_stale from staff where id = :'staffa'), true,
  'and flagged stale');

set local role authenticated;
select is((select home_location_stale from staff where id = :'staffa'), true,
  'the worker can see their own location is out of date');
select is_empty(
  $$ select 1 from staff where id = 'dddddddd-0000-4000-8000-000000000002' $$,
  'a worker reads their own flag and nobody else''s (staff_self)');
set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is_empty($$ select home_location_stale from staff $$, 'a client reads no staff row at all');
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select home_location_stale from staff where id = :'staffa'), true,
  'the office does, so a manager knows proximity for this worker is off');
select is((select home_location_stale from staff where id = :'staffb'), false,
  'and sees a current one as current');
reset role;

-- The same postcode again, with a point equal to the kept pin: the flag
-- still clears, although geography equality says the pin did not move.
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select is(
  staff_update_contact_geocoded('+447700900011', '12a New Street, London E1 6AN', 51.5178, -0.0786)->'located',
  'true'::jsonb,
  'a later lookup that succeeds locates the worker again');
reset role;
select is((select home_location_stale from staff where id = :'staffa'), false,
  'and clears the flag, even when the point equals the kept pin');

-- =====================================================================
-- D · the other paths
-- =====================================================================
set local role authenticated;
select lives_ok(
  $$ select staff_update_contact('+447700900011', '8 Old Path, London SE1 7PB') $$,
  'the original two-argument function still saves an address');
reset role;
select is((select home_location_stale from staff where id = :'staffa'), true,
  'and, since it cannot move the pin, the trigger flags it stale');

select * from finish();
rollback;
