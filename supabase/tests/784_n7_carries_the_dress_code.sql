-- =====================================================================
-- 784 · N7 carries the role section's dress code (§3.2, §3.5, §8 N7;
--       ADR-0110, 20261009100000_n7_carries_the_dress_code.sql)
--
-- Owner request 09.10.2026: anyone booked on a United Grand Lodge shift
-- is told, in the morning-of push that asks them to confirm, not to
-- forget to arrive in their plain black waistcoat and plain black tie.
-- The dress code is the section's own (shift_requirements.dress_code,
-- defaulted from the client + role rate card), so the job names no
-- client: it writes `variant: 'dress-code'` and `dressCode` on every N7
-- whose section has a dress code, and nothing on one that has none.
-- The copy itself lives in the register (packages/notifications), which
-- the Vitest suite holds; this file holds what the job writes.
--
-- Times are UK wall clock, written with their offset; every existing
-- section is moved out of reach first, as 590 does.
-- =====================================================================
begin;
select plan(10);
\ir _shared/fixtures.psql

update shift_requirements set starts_at = timestamptz '2027-06-01 10:00+00',
                              ends_at   = timestamptz '2027-06-01 18:00+00';

\set evt      '78300000-0000-4000-8000-00000000000a'
\set s_ugl    '78310000-0000-4000-8000-000000000001'
\set s_none   '78310000-0000-4000-8000-000000000002'
\set s_blank  '78310000-0000-4000-8000-000000000003'
\set s_pad    '78310000-0000-4000-8000-000000000004'
\set s_tmrw   '78310000-0000-4000-8000-000000000005'
\set b_ugl    '78320000-0000-4000-8000-000000000001'
\set b_none   '78320000-0000-4000-8000-000000000002'
\set b_blank  '78320000-0000-4000-8000-000000000003'
\set b_pad    '78320000-0000-4000-8000-000000000004'
\set b_tmrw   '78320000-0000-4000-8000-000000000005'

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer, cancelled_at) values
  (:'evt', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Quarterly Communication', date '2026-09-24', true, true, null);

-- Five role sections of one event: four today, in N7's window at 09:00 UK,
-- and one tomorrow, for N6. Each has its own dress code — or none.
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour) values
  (:'s_ugl',   :'evt', :'role_id', '2026-09-24 18:00+01', '2026-09-24 23:00+01', 9,0, 30,15, 'Plain black waistcoat and plain black tie', 1),
  (:'s_none',  :'evt', :'role_id', '2026-09-24 19:00+01', '2026-09-24 23:30+01', 9,0, 30,15, null, 1),
  (:'s_blank', :'evt', :'role_id', '2026-09-24 20:00+01', '2026-09-25 00:30+01', 9,0, 30,15, '   ', 1),
  (:'s_pad',   :'evt', :'role_id', '2026-09-24 21:00+01', '2026-09-25 01:00+01', 9,0, 30,15, '  All black  ', 1),
  (:'s_tmrw',  :'evt', :'role_id', '2026-09-25 18:00+01', '2026-09-25 23:00+01', 9,0, 30,15, 'Plain black waistcoat and plain black tie', 1);

-- bookings is unique on (shift, staff); the fixtures give two workers and
-- the rest are plain compliant staff with nothing else on.
insert into staff (id, first_name, last_name, email, phone, dob, status) values
  ('78330000-0000-4000-8000-000000000001', 'Dress', 'One', 'd1@n7.test', '+447700907831', date '1995-01-01', 'compliant'),
  ('78330000-0000-4000-8000-000000000002', 'Dress', 'Two', 'd2@n7.test', '+447700907832', date '1995-01-01', 'compliant');

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at,
                      day_before_confirmed_at, on_day_confirmed_at, cancelled_at, cancel_cause) values
  (:'b_ugl',   :'s_ugl',   :'staffa', 'confirmed', 'auto', '2026-09-10 10:00+01', '2026-09-23 09:00+01', null, null, null),
  (:'b_none',  :'s_none',  :'staffb', 'confirmed', 'auto', '2026-09-10 10:00+01', '2026-09-23 09:00+01', null, null, null),
  (:'b_blank', :'s_blank', '78330000-0000-4000-8000-000000000001', 'confirmed', 'auto', '2026-09-10 10:00+01', '2026-09-23 09:00+01', null, null, null),
  (:'b_pad',   :'s_pad',   '78330000-0000-4000-8000-000000000002', 'confirmed', 'auto', '2026-09-10 10:00+01', '2026-09-23 09:00+01', null, null, null),
  (:'b_tmrw',  :'s_tmrw',  :'staffa', 'confirmed', 'auto', '2026-09-10 10:00+01', null, null, null, null);

create temporary table t_783 as select booking_tick('2026-09-24 09:00+01') as counts;

select is((select counts->>'n7' from t_783), '4',
  'at 09:00 UK the four sections starting today are reminded');

-- 1 · A section with a dress code: the push names the variant and the code.
select is(
  (select array[payload->>'variant', payload->>'dressCode']
     from notification_outbox where key like 'N7:booking:' || :'b_ugl' || ':%'),
  array['dress-code', 'Plain black waistcoat and plain black tie'],
  'a section with a dress code: N7 carries variant dress-code and the section''s own dress code (ADR-0110)');
select is(
  (select array[template, payload->>'bookingId', payload->>'event', payload->>'window']
     from notification_outbox where key like 'N7:booking:' || :'b_ugl' || ':%'),
  array['N7', :'b_ugl', 'Quarterly Communication', '18:00–23:00'],
  'and still everything it carried before: the booking its deep link opens, the event and the role''s UK window');

-- 2 · No dress code, or a blank one: no variant at all, so the register
--     sends §8's plain "Confirm today's shift".
select ok(
  (select not (payload ? 'variant') and not (payload ? 'dressCode')
     from notification_outbox where key like 'N7:booking:' || :'b_none' || ':%'),
  'a section with no dress code names no variant: the plain §8 line goes out');
select ok(
  (select not (payload ? 'variant') and not (payload ? 'dressCode')
     from notification_outbox where key like 'N7:booking:' || :'b_blank' || ':%'),
  'a blank dress code is no dress code');

-- 3 · Whitespace around the code is not sent.
select is(
  (select payload->>'dressCode' from notification_outbox where key like 'N7:booking:' || :'b_pad' || ':%'),
  'All black',
  'the dress code is trimmed before it is sent');

-- 4 · N6, the day-before reminder, is unchanged: the dress code rides N7 only.
select is((select counts->>'n6' from t_783), '1',
  'N6 at 09:00 UK the day before, for tomorrow''s section');
select ok(
  (select not (payload ? 'variant') and not (payload ? 'dressCode')
     from notification_outbox where key like 'N6:booking:' || :'b_tmrw' || ':%'),
  'N6 does not carry the dress code: it is the morning-of reminder that does');

-- 5 · Still one row per booking and start, however often the job re-runs.
select is((select (booking_tick('2026-09-24 09:01+01'))->>'n7'), '0',
  'the every-minute re-run a minute later sends nothing');
select is((select count(*)::int from notification_outbox where key like 'N7:booking:' || :'b_ugl' || ':%'), 1,
  'one N7 row for the booking');

select * from finish();
rollback;
