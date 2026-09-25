-- =====================================================================
-- 600 · The views show the show-rate the engine uses (§6, §9.6, §9.7,
--       §10.1, §2.12) — 20260927183000_show_rate_in_views.sql
--
-- 596 proved staff_show_rate() and that auto_assign_candidates reads it.
-- This file is about the people-facing readers: the directory, the
-- profile, the client card's qualified list, the returning-applicant
-- line and the worker's own profile sheet all draw the derived figure,
-- never the stored column.
--
-- Fixture: Staff Alpha has one worked shift and one unresolved No-show
-- (on its still-confirmed booking, BG-03) — the derived figure is 50 —
-- while staff.reliability holds 98, a number the screens must not show.
-- Staff Bravo has no history: null, drawn as "—" / no pill.
-- =====================================================================
begin;
select plan(24);
\ir _shared/fixtures.psql

\set ev  '60006000-0000-4000-8000-000000000001'
\set s1  '60006000-0000-4000-8000-000000000011'
\set s2  '60006000-0000-4000-8000-000000000012'
\set b1  '60006000-0000-4000-8000-000000000021'
\set b2  '60006000-0000-4000-8000-000000000022'

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer) values
  (:'ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Show-rate In Views', current_date - 3, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour)
select id, :'ev', :'role_id', now() - interval '3 days', now() - interval '3 days' + interval '8 hours',
       2, 0, 22.97, 14.00, 2
  from unnest(array[:'s1', :'s2']::uuid[]) as id;

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b1', :'s1', :'staffa', 'worked',    'auto', now() - interval '4 days'),
  (:'b2', :'s2', :'staffa', 'confirmed', 'auto', now() - interval '4 days');
insert into violations (staff_id, booking_id, type, detected_at) values
  (:'staffa', :'b2', 'no_show', now() - interval '3 days' + interval '30 minutes');

-- The stored column carries a figure no derived reading can produce here;
-- the rating is set so the assertion that it is still the stored column
-- compares a value, not two nulls.
update staff set reliability = 98 where id in (:'staffa', :'staffb');
update staff set rating = 4.5 where id = :'staffa';

select is(staff_show_rate(:'staffa'), 50.00, 'fixture: one worked, one unresolved No-show → 50');
select is(staff_show_rate(:'staffb'), null,  'fixture: no history → null');

-- ---------------------------------------------------------------------
-- 1 · The office's views, read as the admin
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select reliability from staff_directory_v where id = :'staffa'), 50.00::numeric(5,2),
  '§9.6 directory: Show-rate is the derived 50, not the stored 98');
select is((select reliability from staff_directory_v where id = :'staffb'), null,
  '§9.6 directory: no history is null — formatShowRate() draws "—", not 90%');

select is((select reliability from staff_profile_v where id = :'staffa'), 50.00::numeric(5,2),
  '§9.6 profile KPI: Show-rate is the derived 50 (through staff_directory_v)');
select is((select reliability from staff_profile_v where id = :'staffb'), null,
  '§9.6 profile KPI: no history is null');

select is((select reliability from clients_qualified_staff_v where client_id = :'clienta' and staff_id = :'staffa'),
  50.00::numeric(5,2),
  '§9.7 qualified staff: show-rate is the derived 50 (through staff_directory_v)');

select is((select reliability from onboarding_returning_v where staff_id = :'staffa'), 50.00::numeric(5,2),
  '§2.12 returning applicant "History: … show-rate": the derived 50');

-- ---------------------------------------------------------------------
-- 2 · The worker's own sheet
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select is((staff_me()->>'reliability')::numeric, 50.00,
  '§10.1 "Show-rate" pill: the worker sees the derived 50, not the stored 98');
select is((staff_me()->>'rating')::numeric, 4.5,
  'the rest of staff_me() is untouched (rating is still the stored column)');

select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
select is(staff_me()->'reliability', 'null'::jsonb,
  '§10.1: no history is JSON null and the sheet hides the pill');

reset role;

-- ---------------------------------------------------------------------
-- 3 · Resolving lifts it on every screen at once (§9.5, RULE-14)
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select lives_ok(
  $$ select resolve_violation((select id from violations where booking_id = '60006000-0000-4000-8000-000000000022'),
                              'Arrived, spoke to the client') $$,
  'Get back on the No-show');
set local role authenticated;
select is((select reliability from staff_directory_v where id = :'staffa'), 100.00::numeric(5,2),
  'the directory reads 100 the moment the No-show is resolved — nothing is cached in a column');
reset role;

-- ---------------------------------------------------------------------
-- 4 · The column stays (seed.sql and the fixtures write it), unread
-- ---------------------------------------------------------------------
select has_column('public', 'staff', 'reliability', 'staff.reliability still exists');
select is((select reliability from staff where id = :'staffa'), 98::numeric(5,2),
  'the stored column still holds what was written to it');
select col_type_is('public', 'staff_directory_v', 'reliability', 'numeric(5,2)',
  'the view column keeps its name and type, so the office selects it unchanged');
select matches(col_description('public.staff'::regclass, (select attnum from pg_attribute
                                                           where attrelid = 'public.staff'::regclass
                                                             and attname = 'reliability')),
  'not by any view or RPC since 20260927183000',
  'the column comment says nobody reads it');

-- ---------------------------------------------------------------------
-- 5 · Grants, security_invoker and definer exactly as before
-- ---------------------------------------------------------------------
select ok(has_table_privilege('authenticated', 'public.staff_directory_v', 'select'),
  'staff_directory_v: authenticated may select, as before');
select ok(not has_table_privilege('anon', 'public.staff_directory_v', 'select'),
  'staff_directory_v: anon may not');
select ok(not has_table_privilege('anon', 'public.onboarding_returning_v', 'select'),
  'onboarding_returning_v: anon may not');
select ok(has_function_privilege('authenticated', 'public.staff_me()', 'execute'),
  'staff_me(): authenticated may execute');
select ok(not has_function_privilege('anon', 'public.staff_me()', 'execute'),
  'staff_me(): anon may not');
select is(
  (select bool_and('security_invoker=true' = any(c.reloptions))
     from pg_class c
    where c.relname in ('staff_directory_v', 'onboarding_returning_v') and c.relkind = 'v'),
  true,
  'both restated views are still security_invoker');
select is((select prosecdef from pg_proc where oid = 'public.staff_me()'::regprocedure), true,
  'staff_me() is still security definer');

select * from finish();
rollback;
