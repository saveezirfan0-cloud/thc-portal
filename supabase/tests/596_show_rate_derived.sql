-- =====================================================================
-- 596 · The show-rate is derived (§6, BG-03, RULE-14, §9.5)
--       — 20260928110100_show_rate_derived_and_monitor_off_site.sql
--
-- staff_show_rate() replays, BY NAME, the `showRate` cases of
-- packages/domain/src/pay.vectors.json (Vitest runs them against
-- showRate() in pay.ts). They are not in the generated .psql — the rate
-- needs real bookings and violations, not a jsonb input — so each case
-- here builds its rows, asserts, and clears them, and the expected
-- figure is the vector's. Change a case in one place and the other
-- fails.
--
-- Then the consumer: auto_assign_candidates' reliability column is the
-- derived figure, 90 with no history, and the stored staff.reliability
-- is ignored.
--
-- The fixtures give staffa one CONFIRMED future booking carrying a Late
-- violation — exactly the shape that must NOT be in the sample.
-- =====================================================================
begin;
select plan(20);
\ir _shared/fixtures.psql

\set ev    '59600000-0000-4000-8000-000000000001'
\set s1    '59600000-0000-4000-8000-000000000011'
\set s2    '59600000-0000-4000-8000-000000000012'
\set s3    '59600000-0000-4000-8000-000000000013'
\set s4    '59600000-0000-4000-8000-000000000014'
\set s5    '59600000-0000-4000-8000-000000000015'
\set s6    '59600000-0000-4000-8000-000000000016'
\set b1    '59600000-0000-4000-8000-000000000021'
\set b2    '59600000-0000-4000-8000-000000000022'
\set b3    '59600000-0000-4000-8000-000000000023'
\set b4    '59600000-0000-4000-8000-000000000024'
\set b5    '59600000-0000-4000-8000-000000000025'
\set b6    '59600000-0000-4000-8000-000000000026'

-- A past event with six role sections, so one worker can hold six
-- bookings (unique on shift + staff) with different outcomes.
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer) values
  (:'ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Show-rate History', current_date - 3, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour)
select id, :'ev', :'role_id', now() - interval '3 days', now() - interval '3 days' + interval '8 hours',
       6, 0, 22.97, 14.00, 6
  from unnest(array[:'s1', :'s2', :'s3', :'s4', :'s5', :'s6']::uuid[]) as id;

-- The stored column is set to something the derived figure can never be
-- confused with.
update staff set reliability = 55 where id = :'staffa';

-- Each case starts from an empty history; the fixtures' future confirmed
-- booking (with its Late violation) stays throughout.
create function pg_temp.clear_history() returns void language sql as $$
  delete from bookings where staff_id = 'dddddddd-0000-4000-8000-000000000001'
     and shift_id <> 'ffffffff-0000-4000-8000-000000000001';
$$;

-- ---------------------------------------------------------------------
-- 1 · The vectors, by name
-- ---------------------------------------------------------------------
select is(staff_show_rate(:'staffa'), null,
  'no history is null, and the candidates default it to 90');

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b1', :'s1', :'staffa', 'worked', 'auto', now() - interval '4 days');
select is(staff_show_rate(:'staffa'), 100.00,
  'one worked shift is 100');

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b2', :'s2', :'staffa', 'turned_away', 'auto', now() - interval '4 days');
select is(staff_show_rate(:'staffa'), 100.00,
  'a turn-away counts as shown (RULE-15 pays it, §5.2 never marks it)');

select pg_temp.clear_history();
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b1', :'s1', :'staffa', 'worked',    'auto', now() - interval '4 days'),
  (:'b3', :'s3', :'staffa', 'confirmed', 'auto', now() - interval '4 days');
insert into violations (staff_id, booking_id, type, detected_at) values
  (:'staffa', :'b3', 'no_show', now() - interval '3 days' + interval '30 minutes');
select is(staff_show_rate(:'staffa'), 50.00,
  'an unresolved No-show counts against, on its still-confirmed booking (BG-03)');

delete from bookings where id = :'b1';
select is(staff_show_rate(:'staffa'), 0.00,
  'a No-show alone is zero, not null');

-- "Get back" through the real path: resolve_violation reclassifies the
-- entry to Late and moves the booking to worked (§9.5, §3.3). The section
-- ended days ago, so the manager enters the arrival (D17, 20260930100000:
-- after the end the press is not an arrival).
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b1', :'s1', :'staffa', 'worked', 'auto', now() - interval '4 days');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select is(
  resolve_violation((select id from violations where booking_id = :'b3'), 'Arrived, spoke to the client',
                    null, now() - interval '3 days' + interval '40 minutes')->>'nowType',
  'late',
  'Get back reclassifies the No-show to Late');
select is(staff_show_rate(:'staffa'), 100.00,
  'Get back reclassifies a No-show to Late, and it counts as shown (§9.5)');

select pg_temp.clear_history();
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b1', :'s1', :'staffa', 'worked', 'auto', now() - interval '4 days'),
  (:'b4', :'s4', :'staffa', 'worked', 'auto', now() - interval '4 days');
insert into check_logs (booking_id, outcome, attempted_at, check_in_at) values
  (:'b4', 'checked_in', now() - interval '3 days', now() - interval '3 days');
insert into violations (staff_id, booking_id, type, detected_at) values
  (:'staffa', :'b4', 'no_checkout', now() - interval '3 days' + interval '12 hours');
select is(staff_show_rate(:'staffa'), 50.00,
  'an unresolved No check-out counts against (RULE-14)');

-- RULE-14: "once a manager resolves a No check-out via Resolve … the
-- violation stops counting against the worker's show-rate".
select is(
  resolve_violation((select id from violations where booking_id = :'b4'),
                    'Client confirmed she finished at the scheduled end',
                    now() - interval '3 days' + interval '8 hours')->>'decision',
  'resolved',
  'the manager resolves it with the actual finish');
select is(staff_show_rate(:'staffa'), 100.00,
  'a resolved No check-out stops counting against (RULE-14)');

select pg_temp.clear_history();
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b1', :'s1', :'staffa', 'worked', 'auto', now() - interval '4 days'),
  (:'b2', :'s2', :'staffa', 'worked', 'auto', now() - interval '4 days'),
  (:'b3', :'s3', :'staffa', 'worked', 'auto', now() - interval '4 days');
insert into violations (staff_id, booking_id, type, detected_at, minutes_late) values
  (:'staffa', :'b1', 'late',          now() - interval '3 days', 12),
  (:'staffa', :'b2', 'left_early',    now() - interval '3 days', null),
  (:'staffa', :'b3', 'left_geofence', now() - interval '3 days', null);
select is(staff_show_rate(:'staffa'), 100.00,
  'Late, Left early and Left the geofence weigh nothing, unresolved or not (§9.5)');

select pg_temp.clear_history();
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b1', :'s1', :'staffa', 'worked',    'auto', now() - interval '4 days'),
  (:'b2', :'s2', :'staffa', 'cancelled', 'auto', now() - interval '4 days'),
  (:'b3', :'s3', :'staffa', 'closed',    'auto', null),
  (:'b4', :'s4', :'staffa', 'invited',   'auto', null),
  (:'b5', :'s5', :'staffa', 'applied',   'self', null),
  (:'b6', :'s6', :'staffa', 'confirmed', 'auto', now() - interval '4 days');
select is(staff_show_rate(:'staffa'), 100.00,
  'cancelled, closed, invited, applied and a plain confirmed booking are not in the sample');

select pg_temp.clear_history();
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b1', :'s1', :'staffa', 'worked',    'auto', now() - interval '4 days'),
  (:'b2', :'s2', :'staffa', 'worked',    'auto', now() - interval '4 days'),
  (:'b3', :'s3', :'staffa', 'confirmed', 'auto', now() - interval '4 days');
insert into violations (staff_id, booking_id, type, detected_at) values
  (:'staffa', :'b3', 'no_show', now() - interval '3 days' + interval '30 minutes');
select is(staff_show_rate(:'staffa'), 66.67,
  'two decimals: two shown of three');

-- ---------------------------------------------------------------------
-- 2 · The consumer: auto_assign_candidates reads the derived figure
-- ---------------------------------------------------------------------
select is((select reliability from auto_assign_candidates(:'shift_a') where staff_id = :'staffa'), 66.67,
  '§6 the candidates'' show-rate input is staff_show_rate(), not the stored column (55)');
select is((select reliability from auto_assign_candidates(:'shift_a') where staff_id = :'staffb'), 90::numeric,
  'a worker with no history gets 90, the §6 formula''s zero point, as before');

-- BG-03: the automatic No-show is a penalty the moment it is raised …
select pg_temp.clear_history();
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b1', :'s1', :'staffa', 'worked',    'auto', now() - interval '4 days'),
  (:'b3', :'s3', :'staffa', 'confirmed', 'auto', now() - interval '4 days');
select is((select reliability from auto_assign_candidates(:'shift_a') where staff_id = :'staffa'), 100.00,
  'before a No-show the worker scores 100');
insert into violations (staff_id, booking_id, type, detected_at) values
  (:'staffa', :'b3', 'no_show', now() - interval '3 days' + interval '30 minutes');
select is((select reliability from auto_assign_candidates(:'shift_a') where staff_id = :'staffa'), 50.00,
  'BG-03: "automatically marked No-show with the show-rate penalty applied" — the candidates read 50 at once');

-- … and the stored column is inert either way.
update staff set reliability = 100 where id = :'staffa';
select is((select reliability from auto_assign_candidates(:'shift_a') where staff_id = :'staffa'), 50.00,
  'changing staff.reliability changes nothing the engine reads');
select matches(col_description('public.staff'::regclass, (select attnum from pg_attribute
                                                           where attrelid = 'public.staff'::regclass
                                                             and attname = 'reliability')),
  'NOT read by auto-assign',
  'the column comment says so');

select ok(has_function_privilege('authenticated', 'public.staff_show_rate(uuid)', 'execute'),
  'the office reads the function through PostgREST like the candidates function');

select * from finish();
rollback;
