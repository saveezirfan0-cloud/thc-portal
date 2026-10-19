-- =====================================================================
-- 899 · Radar self-apply holds RULE-17's qualified wave
--   20261021010000_radar_apply_holds_the_wave.sql
--
-- Radar hides a section from a worker who is not qualified at that client
-- for that role while anyone qualified there is still reachable
-- (staff_open_shifts). apply_to_shift() used to take the worker's own
-- application anyway. It now answers not_open_yet, exactly while Radar
-- hides the card; the office applying on a worker's behalf is not held to
-- it, and nothing else about applying changes.
-- =====================================================================
begin;
select plan(10);
\ir _shared/fixtures.psql

select cap_week_start(current_date) + 14 as w \gset

\set ro   '89900000-0000-4000-8000-000000000001'
\set ev   '89900000-0000-4000-8000-0000000000e1'
\set s    '89910000-0000-4000-8000-000000000001'
\set q    '89920000-0000-4000-8000-000000000001'

insert into roles (id, name, pay_rate) values (:'ro', 'Wave Waiting Staff', 14.00);
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'ev', :'clientb', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Wave Dinner', :'w'::date + 2, true, true);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'s', :'ev', :'ro', (:'w'::date + 2 + time '12:00') at time zone 'Europe/London',
                       (:'w'::date + 2 + time '18:00') at time zone 'Europe/London', 3, 0, 22, 14, 3);

-- Staff A holds the role and is not qualified at client B. Dee is.
insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'q', 'Dee', 'Qualified', 'q@wave899.test', '+447700989901', date '1995-01-01', 'compliant', 'uk_irish');
insert into staff_roles (staff_id, role_id) values (:'staffa', :'ro'), (:'q', :'ro');
insert into client_qualifications (client_id, role_id, staff_id) values (:'clientb', :'ro', :'q');

-- ---------------------------------------------------------------------
-- Wave 1 still reachable: Radar hides it, and apply refuses
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is_empty(format($$ select 1 from staff_open_shifts(null, %L) $$, :'s'),
  'Radar does not show staff A the section while Dee (qualified) is uninvited');
select is(apply_to_shift(:'s'), jsonb_build_object('ok', false, 'reason', 'not_open_yet'),
  'and staff A''s own application is refused not_open_yet — self-apply does not jump the wave');
reset role;
select is((select count(*)::int from bookings where shift_id = :'s' and staff_id = :'staffa'), 0,
  'nothing was written');

-- The office may still put staff A forward (a manager's override, like Invite).
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(apply_to_shift(:'s', :'staffa') ->> 'ok', 'true',
  'the office lodging the application for staff A is not held to the wave');
reset role;
delete from bookings where shift_id = :'s' and staff_id = :'staffa';

-- ---------------------------------------------------------------------
-- Wave 1 exhausted: Dee is invited, so the section opens to everyone
-- ---------------------------------------------------------------------
insert into bookings (shift_id, staff_id, status, source) values (:'s', :'q', 'invited', 'auto');
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select isnt_empty(format($$ select 1 from staff_open_shifts(null, %L) $$, :'s'),
  'with every qualified worker invited, Radar shows staff A the section');
select is(apply_to_shift(:'s') ->> 'ok', 'true', 'and staff A applies');
reset role;
select is((select status::text from bookings where shift_id = :'s' and staff_id = :'staffa'), 'applied',
  'as an application');

-- ---------------------------------------------------------------------
-- A qualified worker is never held back; a do-not-return one holds nobody
-- ---------------------------------------------------------------------
delete from bookings where shift_id = :'s';
update client_qualifications set do_not_return = true where staff_id = :'q';
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(apply_to_shift(:'s') ->> 'ok', 'true',
  'a do-not-return qualification is not a reachable first wave, so staff A applies');
reset role;
delete from bookings where shift_id = :'s';
update client_qualifications set do_not_return = false where staff_id = :'q';
insert into client_qualifications (client_id, role_id, staff_id) values (:'clientb', :'ro', :'staffa');
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(apply_to_shift(:'s') ->> 'ok', 'true',
  'once qualified there, staff A is wave 1 and applies while Dee is still uninvited');
reset role;
select is((select count(*)::int from bookings where shift_id = :'s' and staff_id = :'q'), 0,
  'and Dee was not touched');

select * from finish();
rollback;
