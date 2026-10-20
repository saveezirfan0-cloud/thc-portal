-- =====================================================================
-- 907 · Radar's RULE-17 wave check: who holds the wave, who does not
--   20261021130100_radar_one_pool_pass.sql (auto_assign_wave1_reachable,
--   ADR-0170) and 20261022010000_radar_apply_holds_the_wave.sql
--
-- staff_open_shifts() hides a section from a worker not qualified at that
-- client for that role while anyone qualified there is reachable; Apply
-- refuses it with not_open_yet on the same answer. The helper asks the
-- pool in rounds of 1, 4, 16 ... per section, so the verdict must hold
-- whichever round finds (or fails to find) a reachable worker:
--   · qualified workers the pool gates (booked elsewhere) or who are blocked
--     or do-not-return do not hold the wave — the section is shown;
--   · ONE reachable qualified worker among many gated ones holds it,
--     wherever they fall in the set — the section is hidden, and Apply says
--     not_open_yet;
--   · when that worker is gated too, the section opens, on the list and on
--     /radar/[id] alike.
-- =====================================================================
begin;
select plan(9);
\ir _shared/fixtures.psql

select cap_week_start(current_date) + 14 as w \gset

\set ro1  '90700000-0000-4000-8000-000000000001'
\set ro2  '90700000-0000-4000-8000-000000000002'
\set ro3  '90700000-0000-4000-8000-000000000003'
\set ev   '90700000-0000-4000-8000-0000000000e1'
\set evx  '90700000-0000-4000-8000-0000000000e2'
\set s1   '90710000-0000-4000-8000-000000000001'
\set s2   '90710000-0000-4000-8000-000000000002'
\set s3   '90710000-0000-4000-8000-000000000003'
\set sx   '90710000-0000-4000-8000-0000000000ff'
\set r1   '90720000-0000-4000-8000-0000000000a1'
\set b1   '90720000-0000-4000-8000-0000000000b1'
\set d1   '90720000-0000-4000-8000-0000000000d1'

insert into roles (id, name, pay_rate) values
  (:'ro1', 'Wave907 Gated', 14.00), (:'ro2', 'Wave907 Late', 14.00), (:'ro3', 'Wave907 Barred', 14.00);
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'ev', :'clientb', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Wave 907 Dinner', :'w'::date + 2, true, true),
  (:'evx', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Wave 907 Clash', :'w'::date + 2, true, true);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'s1', :'ev', :'ro1', (:'w'::date + 2 + time '12:00') at time zone 'Europe/London',
                         (:'w'::date + 2 + time '17:00') at time zone 'Europe/London', 3, 0, 22, 14, 3),
  (:'s2', :'ev', :'ro2', (:'w'::date + 2 + time '12:00') at time zone 'Europe/London',
                         (:'w'::date + 2 + time '17:00') at time zone 'Europe/London', 3, 0, 22, 14, 3),
  (:'s3', :'ev', :'ro3', (:'w'::date + 2 + time '12:00') at time zone 'Europe/London',
                         (:'w'::date + 2 + time '17:00') at time zone 'Europe/London', 3, 0, 22, 14, 3),
  -- the clash: the same hours, another client, 100 seats
  (:'sx', :'evx', :'ro1', (:'w'::date + 2 + time '11:00') at time zone 'Europe/London',
                          (:'w'::date + 2 + time '18:00') at time zone 'Europe/London', 100, 0, 22, 14, 3);

-- Twelve qualified workers at client B for roles 1 and 2, all booked on the
-- clash (gated: booked elsewhere) -- more than the first step's handful.
insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch)
select ('90720000-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid, 'Gated', 'Worker ' || g,
       'g' || g || '@wave907.test', '+4477009070' || lpad(g::text, 2, '0'), date '1995-01-01', 'compliant', 'uk_irish'
  from generate_series(1, 12) g;
insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'r1', 'Rae', 'Reachable', 'r1@wave907.test', '+447700907101', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'b1', 'Bo',  'Blocked',   'b1@wave907.test', '+447700907102', date '1995-01-01', 'blocked',   'uk_irish'),
  (:'d1', 'Di',  'Barred',    'd1@wave907.test', '+447700907103', date '1995-01-01', 'compliant', 'uk_irish');
insert into staff_roles (staff_id, role_id)
select s.id, r.id from staff s cross join (values (:'ro1'::uuid), (:'ro2'::uuid)) r(id)
 where s.email like 'g%@wave907.test';
insert into staff_roles (staff_id, role_id) values
  (:'r1', :'ro2'), (:'b1', :'ro3'), (:'d1', :'ro3'),
  (:'staffa', :'ro1'), (:'staffa', :'ro2'), (:'staffa', :'ro3');
insert into client_qualifications (client_id, role_id, staff_id, do_not_return)
select :'clientb', sro.role_id, sro.staff_id, false from staff_roles sro
  join staff s on s.id = sro.staff_id and s.email like '%@wave907.test'
 where sro.role_id in (:'ro1', :'ro2', :'ro3');
update client_qualifications set do_not_return = true where staff_id = :'d1';
insert into bookings (shift_id, staff_id, status, source, confirmed_at)
select :'sx', s.id, 'confirmed', 'auto', now() from staff s where s.email like 'g%@wave907.test';

-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select set_eq(
  format($$ select shift_id from staff_open_shifts() where shift_id in (%L, %L, %L) $$, :'s1', :'s2', :'s3'),
  format($$ values (%L::uuid), (%L::uuid) $$, :'s1', :'s3'),
  'staff A''s Radar: role 1 (every qualified worker booked elsewhere) and role 3 (blocked or do-not-return) are open; role 2 is not');
select is_empty(format($$ select 1 from staff_open_shifts(null, %L) $$, :'s2'),
  'one reachable qualified worker among twelve gated ones holds the wave on /radar/[id]');
select is(apply_to_shift(:'s2'), jsonb_build_object('ok', false, 'reason', 'not_open_yet'),
  'and Apply agrees: not_open_yet');
select isnt_empty(format($$ select 1 from staff_open_shifts(null, %L) $$, :'s1'),
  'twelve gated qualified workers hold nothing: role 1 is on /radar/[id]');
select isnt_empty(format($$ select 1 from staff_open_shifts(null, %L) $$, :'s3'),
  'a blocked and a do-not-return qualified worker hold nothing: role 3 is on /radar/[id]');
reset role;

-- The reachable one is booked on the clash too: the wave is exhausted.
insert into bookings (shift_id, staff_id, status, source, confirmed_at) values (:'sx', :'r1', 'confirmed', 'auto', now());
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select set_eq(
  format($$ select shift_id from staff_open_shifts() where shift_id in (%L, %L, %L) $$, :'s1', :'s2', :'s3'),
  format($$ values (%L::uuid), (%L::uuid), (%L::uuid) $$, :'s1', :'s2', :'s3'),
  'with Rae booked elsewhere too, role 2 opens on the list');
select isnt_empty(format($$ select 1 from staff_open_shifts(null, %L) $$, :'s2'),
  'and on /radar/[id]');
select is(apply_to_shift(:'s2') ->> 'ok', 'true', 'and staff A applies');
reset role;

select is((select count(*)::int from bookings where shift_id = :'s2' and staff_id = :'staffa' and status = 'applied'), 1,
  'the application is recorded once');

select * from finish();
rollback;
