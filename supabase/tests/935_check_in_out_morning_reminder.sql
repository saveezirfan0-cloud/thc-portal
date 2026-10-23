-- =====================================================================
-- 935 · Check in and out today (CK1, ADR-0205)
--       — 20261026150000_check_in_out_morning_reminder.sql
--
-- Every worker with a confirmed shift is reminded on the morning of it, at
-- 07:00 UK or three hours before an earlier start, to check in and out.
-- One per worker per UK day, naming the earliest shift; none to a worker
-- already checked in, a cancelled booking, or after the start.
-- 10 December is GMT, so UK time = UTC in this file.
-- =====================================================================
begin;
select plan(15);
\ir _shared/fixtures.psql

\set ev       '93500000-0000-4000-8000-000000000001'
\set sec_am   '93510000-0000-4000-8000-000000000001'
\set sec_pm   '93510000-0000-4000-8000-000000000002'
\set sec_dawn '93510000-0000-4000-8000-000000000003'
\set sec_next '93510000-0000-4000-8000-000000000004'
\set r_wait   '93520000-0000-4000-8000-000000000001'
\set p_luca   '93530000-0000-4000-8000-000000000001'
\set p_mia    '93530000-0000-4000-8000-000000000002'
\set p_noah   '93530000-0000-4000-8000-000000000003'
\set p_zoe    '93530000-0000-4000-8000-000000000004'
\set p_ava    '93530000-0000-4000-8000-000000000005'

insert into roles (id, name, description, pay_rate) values (:'r_wait', 'Check Reminder Waiting', 'fixture', 14.00);
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'p_luca', 93501, 'Luca', 'Moretti', 'ck-1@rls.test', '+447700935001', date '1995-01-01', 'compliant'),
  (:'p_mia',  93502, 'Mia',  'Rossi',   'ck-2@rls.test', '+447700935002', date '1995-01-01', 'compliant'),
  (:'p_noah', 93503, 'Noah', 'Bianchi', 'ck-3@rls.test', '+447700935003', date '1995-01-01', 'compliant'),
  (:'p_zoe',  93504, 'Zoe',  'Ricci',   'ck-4@rls.test', '+447700935004', date '1995-01-01', 'compliant'),
  (:'p_ava',  93505, 'Ava',  'Conti',   'ck-5@rls.test', '+447700935005', date '1995-01-01', 'compliant');

insert into events (id, client_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, po_number) values
  (:'ev', :'clienta', 'Check Venue', '1 Check St', st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150,
   'Winter Gala', date '2026-12-10', false, true, null);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'sec_am',   :'ev', :'r_wait', '2026-12-10 11:00+00', '2026-12-10 17:00+00', 5, 0, 22.97, 14.00, 1),
  (:'sec_pm',   :'ev', :'r_wait', '2026-12-10 18:00+00', '2026-12-10 23:00+00', 5, 0, 22.97, 14.00, 1),
  (:'sec_dawn', :'ev', :'r_wait', '2026-12-10 05:00+00', '2026-12-10 09:00+00', 5, 0, 22.97, 14.00, 1),
  (:'sec_next', :'ev', :'r_wait', '2026-12-11 09:00+00', '2026-12-11 15:00+00', 5, 0, 22.97, 14.00, 1);

-- Luca: 11:00 and 18:00 on the 10th, 09:00 on the 11th. Mia: a 05:00 start.
-- Noah: cancelled. Zoe: already checked in (worked).
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  ('93540000-0000-4000-8000-000000000001', :'sec_am',   :'p_luca', 'confirmed', 'manual', '2026-12-01 10:00+00'),
  ('93540000-0000-4000-8000-000000000002', :'sec_pm',   :'p_luca', 'confirmed', 'manual', '2026-12-01 10:00+00'),
  ('93540000-0000-4000-8000-000000000003', :'sec_next', :'p_luca', 'confirmed', 'manual', '2026-12-01 10:00+00'),
  ('93540000-0000-4000-8000-000000000004', :'sec_dawn', :'p_mia',  'confirmed', 'manual', '2026-12-01 10:00+00'),
  ('93540000-0000-4000-8000-000000000005', :'sec_am',   :'p_noah', 'confirmed', 'manual', '2026-12-01 10:00+00'),
  ('93540000-0000-4000-8000-000000000006', :'sec_pm',   :'p_zoe',  'confirmed', 'manual', '2026-12-01 10:00+00');
update bookings set status = 'cancelled', cancelled_at = '2026-12-05 10:00+00', cancel_cause = 'office_withdraw'
 where id = '93540000-0000-4000-8000-000000000005';
update bookings set status = 'worked' where id = '93540000-0000-4000-8000-000000000006';

select is((select check_in_out_morning_tick('2026-12-10 01:59+00')), '{"ck1": 0}'::jsonb,
  'before three hours ahead of a 05:00 start, nothing');
select is((select check_in_out_morning_tick('2026-12-10 02:00+00')), '{"ck1": 1}'::jsonb,
  'a 05:00 start is reminded at 02:00, three hours before');
select is((select recipient_staff_id from notification_outbox where template = 'CK1'), :'p_mia'::uuid,
  'and it is the early starter who is reminded');
select is((select check_in_out_morning_tick('2026-12-10 06:59+00')), '{"ck1": 0}'::jsonb,
  'nobody else before 07:00 UK');
select is((select check_in_out_morning_tick('2026-12-10 07:00+00')), '{"ck1": 1}'::jsonb,
  'at 07:00 UK one reminder: not the cancelled booking, not the worker already checked in');
select is((select count(*)::int from notification_outbox where template = 'CK1' and recipient_staff_id = :'p_luca'), 1,
  'two shifts in a day are one reminder');
select is((select key from notification_outbox where template = 'CK1' and recipient_staff_id = :'p_luca'),
  'CK1:staff:' || :'p_luca' || ':2026-12-10',
  'keyed on the worker and the UK day');
select is((select payload from notification_outbox where template = 'CK1' and recipient_staff_id = :'p_luca'),
  jsonb_build_object('bookingId', '93540000-0000-4000-8000-000000000001', 'event', 'Winter Gala',
                     'window', '11:00–17:00'),
  'it names the earliest shift of the day, in UK time');
select is((select priority from notification_outbox where template = 'CK1' and recipient_staff_id = :'p_luca'),
  0::smallint, 'it is an urgent send');
select is((select check_in_out_morning_tick('2026-12-10 12:00+00')), '{"ck1": 0}'::jsonb,
  'the afternoon shift sends no second reminder that day, and a re-run never doubles');

-- Booked on the day, after the morning: reminded at the next tick before the start.
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  ('93540000-0000-4000-8000-000000000007', :'sec_pm', :'p_ava', 'confirmed', 'manual', '2026-12-10 14:00+00');
select is((select check_in_out_morning_tick('2026-12-10 14:01+00')), '{"ck1": 1}'::jsonb,
  'a booking confirmed after 07:00 is reminded at the next tick');

-- Not once the shift has started.
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  ('93540000-0000-4000-8000-000000000008', :'sec_dawn', :'p_noah', 'confirmed', 'manual', '2026-12-10 06:00+00');
select is((select check_in_out_morning_tick('2026-12-10 06:00+00')), '{"ck1": 0}'::jsonb,
  'nothing once the shift has started');

-- A 09:00 start is three hours ahead at 06:00, before 07:00: CR2's time.
select is((select check_in_out_morning_tick('2026-12-11 05:59+00')), '{"ck1": 0}'::jsonb,
  'the next day, nothing before three hours ahead of a 09:00 start');
select is((select check_in_out_morning_tick('2026-12-11 06:00+00')), '{"ck1": 1}'::jsonb,
  'and a new reminder at 06:00 for it');

select is(
  (select array_agg(privilege_type::text order by privilege_type)
     from information_schema.routine_privileges
    where routine_name = 'check_in_out_morning_tick' and grantee in ('anon', 'authenticated')),
  null, 'only the job may run it');

select * from finish();
rollback;
