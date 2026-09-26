-- =====================================================================
-- 590 · N6 and N7, the confirmation reminders (§3.5, §8)
--   20260927140000_n6_n7_confirm_reminders.sql
--   (keys since 20260929100000: <code>:booking:<id>:<start epoch>, so the
--   lookups below match on the booking prefix; 610 holds the key itself)
--
-- docs/15 §3: both templates existed and nothing queued them. Four things
-- are held here, per reminder:
--   * it is sent — once, keyed on the booking and its start, however
--     often the every-minute job re-runs;
--   * to the right audience — confirmed only; N6 skips anyone who pressed
--     "I'm ready", N7 anyone who confirmed today or checked in; nothing
--     for invited, cancelled or closed bookings or a cancelled event;
--   * at the right UK wall-clock time, across BST, GMT and both DST
--     boundaries — and never after the cutoff it warns about;
--   * against the ROLE SECTION's start, not the event's (RULE-18).
--
-- Every instant is fixed, so nothing depends on when the suite runs.
-- =====================================================================
begin;
select plan(40);
\ir _shared/fixtures.psql

-- ---------------------------------------------------------------------
-- 1. The arithmetic, on its own
-- ---------------------------------------------------------------------
select is(n6_due_at('2026-09-25 18:00+01'), '2026-09-24 08:00+01'::timestamptz,
  'N6 is due at 08:00 UK on the day before the section starts (BST)');
select is(n6_due_at('2026-11-11 18:00+00'), '2026-11-10 08:00+00'::timestamptz,
  'and at 08:00 UK in winter too (GMT), not at a fixed UTC hour');
select is(n6_due_at('2026-10-26 10:00+00'), '2026-10-25 08:00+00'::timestamptz,
  'autumn boundary: the day before is the day the clocks go back, and 08:00 that day is GMT');
select is(n6_due_at('2026-03-30 10:00+01'), '2026-03-29 08:00+01'::timestamptz,
  'spring boundary: the day before is the day the clocks go forward, and 08:00 that day is BST');
select is(n6_due_at('2026-09-25 00:30+01'), '2026-09-24 08:00+01'::timestamptz,
  'a section starting just after midnight is reminded on the UK day before it, like ready_deadline()');
select ok(n6_due_at(s) < ready_deadline(s),
  'N6 always opens before the noon deadline it warns about')
  from (values ('2026-09-25 18:00+01'::timestamptz)) v(s);

select is(n7_due_at('2026-09-24 19:00+01'), '2026-09-24 09:00+01'::timestamptz,
  'N7 is due at 09:00 UK on the day of an evening section');
select is(n7_due_at('2026-09-24 07:00+01'), '2026-09-24 05:00+01'::timestamptz,
  'a 07:00 section is reminded two hours before it starts, not two hours after');
select is(n7_due_at('2026-09-24 00:30+01'), '2026-09-24 00:00+01'::timestamptz,
  'and never before the UK day of the shift begins — "on the day" (§3.5)');
select is(n7_due_at('2026-11-11 18:00+00'), '2026-11-11 09:00+00'::timestamptz,
  'N7 at 09:00 UK in winter (GMT)');

-- ---------------------------------------------------------------------
-- 2. A world with a known clock
--
-- Every existing section is moved far out of reach, so booking_tick's
-- counts below are only about the rows added here (the same move 170
-- makes). Times are UK wall clock, written with their offset.
-- ---------------------------------------------------------------------
update shift_requirements set starts_at = timestamptz '2027-06-01 10:00+00',
                              ends_at   = timestamptz '2027-06-01 18:00+00';

\set evt     '59000000-0000-4000-8000-00000000000a'
\set evt_x   '59000000-0000-4000-8000-00000000000b'
\set evt_w   '59000000-0000-4000-8000-00000000000c'

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer, cancelled_at) values
  (:'evt',   :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Gala Dinner', date '2026-09-24', true, true, null),
  (:'evt_x', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Cancelled Launch', date '2026-09-25', true, true, timestamptz '2026-09-20 10:00+01'),
  (:'evt_w', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Winter Ball', date '2026-11-11', true, true, null);

-- Sections. `tmrw` and `later` are two roles of ONE event: the event's
-- window starts tomorrow, but the `later` role does not (RULE-18).
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  ('59100000-0000-4000-8000-000000000001', :'evt',   :'role_id', '2026-09-25 18:00+01', '2026-09-25 23:00+01', 9,0, 30,15, 1), -- tmrw
  ('59100000-0000-4000-8000-000000000002', :'evt',   :'role_id', '2026-09-26 18:00+01', '2026-09-26 23:00+01', 9,0, 30,15, 1), -- later
  ('59100000-0000-4000-8000-000000000003', :'evt_x', :'role_id', '2026-09-25 18:00+01', '2026-09-25 23:00+01', 9,0, 30,15, 1), -- cancelled event
  ('59100000-0000-4000-8000-000000000004', :'evt',   :'role_id', '2026-09-24 19:00+01', '2026-09-24 23:30+01', 9,0, 30,15, 1), -- today, evening
  ('59100000-0000-4000-8000-000000000005', :'evt',   :'role_id', '2026-09-24 07:00+01', '2026-09-24 12:00+01', 9,0, 30,15, 1), -- today, breakfast
  ('59100000-0000-4000-8000-000000000006', :'evt_w', :'role_id', '2026-11-11 18:00+00', '2026-11-11 23:00+00', 9,0, 30,15, 1); -- winter

\set b_n6      '59200000-0000-4000-8000-000000000001'
\set b_ready   '59200000-0000-4000-8000-000000000002'
\set b_inv     '59200000-0000-4000-8000-000000000003'
\set b_canc    '59200000-0000-4000-8000-000000000004'
\set b_closed  '59200000-0000-4000-8000-000000000005'
\set b_evtx    '59200000-0000-4000-8000-000000000006'
\set b_later   '59200000-0000-4000-8000-000000000007'
\set b_n7      '59200000-0000-4000-8000-000000000008'
\set b_onday   '59200000-0000-4000-8000-000000000009'
\set b_brk     '59200000-0000-4000-8000-00000000000a'
\set b_inv7    '59200000-0000-4000-8000-00000000000b'
\set b_winter  '59200000-0000-4000-8000-00000000000c'
\set b_late    '59200000-0000-4000-8000-00000000000d'
\set b_after   '59200000-0000-4000-8000-00000000000e'

-- bookings is unique on (shift, staff), and the fixtures give two workers;
-- the extra ones below are plain compliant staff with nothing else on.
insert into staff (id, first_name, last_name, email, phone, dob, status) values
  ('59300000-0000-4000-8000-000000000001', 'Rem', 'One',   'r1@n6.test', '+447700905901', date '1995-01-01', 'compliant'),
  ('59300000-0000-4000-8000-000000000002', 'Rem', 'Two',   'r2@n6.test', '+447700905902', date '1995-01-01', 'compliant'),
  ('59300000-0000-4000-8000-000000000003', 'Rem', 'Three', 'r3@n6.test', '+447700905903', date '1995-01-01', 'compliant'),
  ('59300000-0000-4000-8000-000000000004', 'Rem', 'Four',  'r4@n6.test', '+447700905904', date '1995-01-01', 'compliant'),
  ('59300000-0000-4000-8000-000000000005', 'Rem', 'Five',  'r5@n6.test', '+447700905905', date '1995-01-01', 'compliant');

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at,
                      day_before_confirmed_at, on_day_confirmed_at, cancelled_at, cancel_cause) values
  -- tomorrow's section
  (:'b_n6',     '59100000-0000-4000-8000-000000000001', :'staffa', 'confirmed', 'auto', '2026-09-10 10:00+01', null, null, null, null),
  (:'b_ready',  '59100000-0000-4000-8000-000000000001', :'staffb', 'confirmed', 'auto', '2026-09-10 10:00+01', '2026-09-24 07:00+01', null, null, null),
  (:'b_inv',    '59100000-0000-4000-8000-000000000001', '59300000-0000-4000-8000-000000000001', 'invited', 'auto', null, null, null, null, null),
  (:'b_canc',   '59100000-0000-4000-8000-000000000001', '59300000-0000-4000-8000-000000000002', 'cancelled', 'auto', '2026-09-10 10:00+01', null, null, '2026-09-20 10:00+01', 'office_withdraw'),
  (:'b_closed', '59100000-0000-4000-8000-000000000001', '59300000-0000-4000-8000-000000000003', 'closed', 'auto', null, null, null, '2026-09-20 10:00+01', 'declined'),
  -- a confirmed worker on an event the office has cancelled
  (:'b_evtx',   '59100000-0000-4000-8000-000000000003', :'staffa', 'confirmed', 'auto', '2026-09-10 10:00+01', null, null, null, null),
  -- the SAME event, a role that starts the day after tomorrow
  (:'b_later',  '59100000-0000-4000-8000-000000000002', :'staffa', 'confirmed', 'auto', '2026-09-10 10:00+01', null, null, null, null),
  -- today's evening section
  (:'b_n7',     '59100000-0000-4000-8000-000000000004', :'staffa', 'confirmed', 'auto', '2026-09-10 10:00+01', '2026-09-23 09:00+01', null, null, null),
  (:'b_onday',  '59100000-0000-4000-8000-000000000004', :'staffb', 'confirmed', 'auto', '2026-09-10 10:00+01', '2026-09-23 09:00+01', '2026-09-24 08:45+01', null, null),
  (:'b_inv7',   '59100000-0000-4000-8000-000000000004', '59300000-0000-4000-8000-000000000001', 'invited', 'auto', null, null, null, null, null),
  -- today's breakfast section, already under way at 09:00
  (:'b_brk',    '59100000-0000-4000-8000-000000000005', '59300000-0000-4000-8000-000000000004', 'confirmed', 'auto', '2026-09-10 10:00+01', '2026-09-23 09:00+01', null, null, null),
  -- the winter section
  (:'b_winter', '59100000-0000-4000-8000-000000000006', :'staffa', 'confirmed', 'auto', '2026-10-01 10:00+01', null, null, null, null);

-- ---------------------------------------------------------------------
-- 3. N6
-- ---------------------------------------------------------------------
select is((select (booking_tick('2026-09-24 07:59+01'))->>'n6'), '0',
  'N6: nothing at 07:59 UK the day before');

create temporary table t_n6 as select booking_tick('2026-09-24 08:30+01') as counts;

select is((select counts->>'n6' from t_n6), '1',
  'N6: at 08:30 UK the day before, exactly one booking is reminded');
select is(
  (select recipient_staff_id from notification_outbox
    where key = 'N6:booking:' || :'b_n6' || ':' || extract(epoch from timestamptz '2026-09-25 18:00+01')::bigint),
  :'staffa'::uuid, 'the confirmed worker who has not pressed "I''m ready" gets N6, keyed N6:booking:<id>:<start epoch> (20260929100000)');
select is(
  (select array[channel::text, template, payload->>'bookingId', payload->>'window']
     from notification_outbox where key like 'N6:booking:' || :'b_n6' || ':%'),
  array['push', 'N6', :'b_n6', '18:00–23:00'],
  'a push on the N6 template, carrying the booking its deep link opens and the role''s own UK window');
select ok(not exists (select 1 from notification_outbox where key like 'N6:booking:' || :'b_ready' || ':%'),
  'not to a worker who has already pressed "I''m ready"');
select ok(not exists (select 1 from notification_outbox where key like 'N6:booking:' || :'b_inv' || ':%'),
  'not to an invitation — there is nothing to be ready for until it is accepted');
select ok(not exists (select 1 from notification_outbox where key like 'N6:booking:' || :'b_canc' || ':%'),
  'not to a cancelled booking');
select ok(not exists (select 1 from notification_outbox where key like 'N6:booking:' || :'b_closed' || ':%'),
  'not to a closed one');
select ok(not exists (select 1 from notification_outbox where key like 'N6:booking:' || :'b_evtx' || ':%'),
  'not to anyone on an event the office has cancelled');
select ok(not exists (select 1 from notification_outbox where key like 'N6:booking:' || :'b_later' || ':%'),
  'RULE-18: not to a role of the same event that does not start tomorrow — its own section decides');
select ok(not exists (select 1 from notification_outbox where key like 'N6:booking:' || :'b_n7' || ':%'),
  'and not for a section that starts today: its deadline was yesterday');

select is((select (booking_tick('2026-09-24 08:31+01'))->>'n6'), '0',
  'the every-minute re-run a minute later sends nothing');

-- ---------------------------------------------------------------------
-- 4. N7
-- ---------------------------------------------------------------------
select is((select (booking_tick('2026-09-24 08:59+01'))->>'n7'), '0',
  'N7: nothing at 08:59 UK on the day of an evening section');

create temporary table t_n7 as select booking_tick('2026-09-24 09:00+01') as counts;

select is((select counts->>'n7' from t_n7), '1',
  'N7: at 09:00 UK exactly one booking is reminded');
select is(
  (select array[recipient_staff_id::text, template, payload->>'bookingId']
     from notification_outbox
    where key = 'N7:booking:' || :'b_n7' || ':' || extract(epoch from timestamptz '2026-09-24 19:00+01')::bigint),
  array[:'staffa', 'N7', :'b_n7'],
  'the confirmed worker on today''s section gets N7, keyed N7:booking:<id>:<start epoch> (20260929100000)');
select ok(not exists (select 1 from notification_outbox where key like 'N7:booking:' || :'b_onday' || ':%'),
  'not to a worker who has already confirmed today');
select ok(not exists (select 1 from notification_outbox where key like 'N7:booking:' || :'b_inv7' || ':%'),
  'not to an invitation');
select ok(not exists (select 1 from notification_outbox where key like 'N7:booking:' || :'b_brk' || ':%'),
  'not to a section already under way: its reminder window closed 30 minutes before it began');

select is((select (booking_tick('2026-09-24 09:01+01'))->>'n7'), '0',
  'the re-run a minute later sends nothing');
select is((select count(*)::int from notification_outbox where key like 'N7:booking:' || :'b_n7' || ':%'), 1,
  'one row for the booking');

-- Checked in before the push: no N7. The breakfast worker checks in at
-- 06:10 and the job asks at 06:20, inside that section's N7 window
-- (05:00–06:30) — only the check-in keeps them out of it.
update bookings set status = 'worked' where id = :'b_brk';
insert into check_logs (booking_id, outcome, attempted_at, check_in_at)
values (:'b_brk', 'checked_in', '2026-09-24 06:10+01', '2026-09-24 06:10+01');
select is((select (booking_tick('2026-09-24 06:20+01'))->>'n7'), '0',
  'a worker who has checked in is never asked to confirm they are coming');

-- N7 never releases anything: the booking is still confirmed long after.
select is((select status::text from bookings where id = :'b_n7'), 'confirmed',
  '§3.5: N7 is a reminder only — the booking is still confirmed');

-- ---------------------------------------------------------------------
-- 5. N6, late acceptances and winter
--
-- After the N7 block on purpose: these runs are inside N7's window for
-- today's evening section, and would queue its N7 before 09:00 is asked.
-- ---------------------------------------------------------------------
-- A worker who accepts at 10:30 the day before is still reminded in time.
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at)
values (:'b_late', '59100000-0000-4000-8000-000000000001', '59300000-0000-4000-8000-000000000004',
        'confirmed', 'auto', '2026-09-24 10:30+01');
select is((select (booking_tick('2026-09-24 10:31+01'))->>'n6'), '1',
  'a booking accepted at 10:30 the day before gets N6 on the next minute');

select is((select (booking_tick('2026-09-24 11:59+01'))->>'n6'), '0',
  'and a run at 11:59 sends nobody a second one');
select is((select count(*)::int from notification_outbox where key like 'N6:booking:' || :'b_n6' || ':%'), 1,
  'one row for the booking, however many times the job ran');

-- One accepted at 12:00 is past the deadline: no reminder of it.
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at)
values (:'b_after', '59100000-0000-4000-8000-000000000001', '59300000-0000-4000-8000-000000000005',
        'confirmed', 'auto', '2026-09-24 12:00+01');
select is((select (booking_tick('2026-09-24 12:00+01'))->>'n6'), '0',
  'not after the cutoff: at 12:00 UK nothing is queued');
select ok(not exists (select 1 from notification_outbox where key like 'N6:booking:' || :'b_after' || ':%'),
  'so a booking accepted at 12:00 the day before is never told to beat a deadline already gone');

-- GMT: 08:00 UTC is 09:00 in summer, so a UTC-hour rule would differ here.
select is((select (booking_tick('2026-11-10 07:59+00'))->>'n6'), '0',
  'winter: nothing at 07:59 GMT the day before');
select is((select (booking_tick('2026-11-10 08:00+00'))->>'n6'), '1',
  'winter: N6 at 08:00 GMT the day before');
select ok(exists (select 1 from notification_outbox where key like 'N6:booking:' || :'b_winter' || ':%'),
  'to the winter booking');

select * from finish();
rollback;
