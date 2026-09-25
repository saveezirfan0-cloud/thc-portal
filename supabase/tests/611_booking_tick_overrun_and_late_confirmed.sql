-- =====================================================================
-- 611 · booking_tick(): the overrunning shift, the late-confirmed
--       No-show and the accepted check-in
--   20260929100000_confirmation_timers_restated.sql (ADR-0030;
--   audit D1c/D27, D48 and the _tick nit)
--
--   1. BG-10 / N13 is bounded by the check-out lock (end + 4 h), not the
--      scheduled end (§5.2b: the Breaks block "does not disable or
--      disappear if the shift runs longer than planned"), and never
--      reaches a booking carrying No check-out.
--   2. BG-03: a booking confirmed after its section started is exempt
--      from the start + 30 No-show (§5.1) but is marked No-show at the
--      end if it never checked in.
--   3. The working set reads the accepted check-in, not the latest
--      logged attempt.
--
-- February 2026: UK time is UTC, and every shift is in the past, so no
-- rota guard or real clock is involved. Every instant is fixed.
-- =====================================================================
begin;
select plan(17);
\ir _shared/fixtures.psql

update shift_requirements set starts_at = timestamptz '2027-06-01 10:00+00',
                              ends_at   = timestamptz '2027-06-01 18:00+00';

\set evt      '61a00000-0000-4000-8000-00000000000a'
\set evt_paid '61a00000-0000-4000-8000-00000000000b'

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'evt', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Overrun Dinner', date '2026-02-10', false, true),
  (:'evt_paid', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Paid Breaks Dinner', date '2026-02-10', true, true);

-- One section per case. The tick that matters runs at 16:30.
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  ('61b00000-0000-4000-8000-000000000001', :'evt',      :'role_id', '2026-02-10 10:00+00', '2026-02-10 16:00+00', 5,0, 30,15, 1), -- over
  ('61b00000-0000-4000-8000-000000000002', :'evt',      :'role_id', '2026-02-10 08:00+00', '2026-02-10 12:31+00', 5,0, 30,15, 1), -- edge
  ('61b00000-0000-4000-8000-000000000003', :'evt',      :'role_id', '2026-02-10 07:00+00', '2026-02-10 12:30+00', 5,0, 30,15, 1), -- lock
  ('61b00000-0000-4000-8000-000000000004', :'evt',      :'role_id', '2026-02-10 09:00+00', '2026-02-10 14:00+00', 5,0, 30,15, 1), -- flag
  ('61b00000-0000-4000-8000-000000000005', :'evt',      :'role_id', '2026-02-10 09:00+00', '2026-02-10 15:00+00', 5,0, 30,15, 1), -- out
  ('61b00000-0000-4000-8000-000000000006', :'evt',      :'role_id', '2026-02-10 09:00+00', '2026-02-10 15:30+00', 5,0, 30,15, 1), -- break
  ('61b00000-0000-4000-8000-000000000007', :'evt_paid', :'role_id', '2026-02-10 09:00+00', '2026-02-10 15:30+00', 5,0, 30,15, 1), -- paid
  ('61b00000-0000-4000-8000-000000000008', :'evt',      :'role_id', '2026-02-10 12:20+00', '2026-02-10 16:20+00', 5,0, 30,15, 1), -- late-confirmed
  ('61b00000-0000-4000-8000-000000000009', :'evt',      :'role_id', '2026-02-10 10:00+00', '2026-02-10 18:00+00', 5,0, 30,15, 1); -- press

insert into staff (id, first_name, last_name, email, phone, dob, status) values
  ('61d00000-0000-4000-8000-000000000001', 'Tick', 'One', 't1@tick.test', '+447700906101', date '1995-01-01', 'compliant');

\set b_over   '61c00000-0000-4000-8000-000000000001'
\set b_edge   '61c00000-0000-4000-8000-000000000002'
\set b_lock   '61c00000-0000-4000-8000-000000000003'
\set b_flag   '61c00000-0000-4000-8000-000000000004'
\set b_out    '61c00000-0000-4000-8000-000000000005'
\set b_break  '61c00000-0000-4000-8000-000000000006'
\set b_paid   '61c00000-0000-4000-8000-000000000007'
\set b_lc     '61c00000-0000-4000-8000-000000000008'
\set b_lc_in  '61c00000-0000-4000-8000-000000000009'
\set b_ontime '61c00000-0000-4000-8000-00000000000a'
\set b_press  '61c00000-0000-4000-8000-00000000000b'

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b_over',   '61b00000-0000-4000-8000-000000000001', :'staffa', 'worked',    'auto',       '2026-02-01 10:00+00'),
  (:'b_edge',   '61b00000-0000-4000-8000-000000000002', :'staffa', 'worked',    'auto',       '2026-02-01 10:00+00'),
  (:'b_lock',   '61b00000-0000-4000-8000-000000000003', :'staffa', 'worked',    'auto',       '2026-02-01 10:00+00'),
  (:'b_flag',   '61b00000-0000-4000-8000-000000000004', :'staffa', 'worked',    'auto',       '2026-02-01 10:00+00'),
  (:'b_out',    '61b00000-0000-4000-8000-000000000005', :'staffa', 'worked',    'auto',       '2026-02-01 10:00+00'),
  (:'b_break',  '61b00000-0000-4000-8000-000000000006', :'staffa', 'worked',    'auto',       '2026-02-01 10:00+00'),
  (:'b_paid',   '61b00000-0000-4000-8000-000000000007', :'staffa', 'worked',    'auto',       '2026-02-01 10:00+00'),
  -- Section 8: two replacements confirmed after its 12:20 start (§3.4
  -- escalation) — one never comes, one does — and one booked in advance
  -- who never comes.
  (:'b_lc',     '61b00000-0000-4000-8000-000000000008', :'staffa', 'confirmed', 'escalation', '2026-02-10 12:30+00'),
  (:'b_lc_in',  '61b00000-0000-4000-8000-000000000008', :'staffb', 'worked',    'escalation', '2026-02-10 12:30+00'),
  (:'b_ontime', '61b00000-0000-4000-8000-000000000008', '61d00000-0000-4000-8000-000000000001', 'confirmed', 'auto', '2026-02-01 10:00+00'),
  (:'b_press',  '61b00000-0000-4000-8000-000000000009', :'staffb', 'worked',    'auto',       '2026-02-01 10:00+00');

insert into check_logs (booking_id, outcome, attempted_at, check_in_at, check_out_at) values
  (:'b_over',  'checked_in', '2026-02-10 10:00+00', '2026-02-10 10:00+00', null),
  -- edge and lock checked in late, so they reach six hours only at 16:30.
  (:'b_edge',  'checked_in', '2026-02-10 10:30+00', '2026-02-10 10:30+00', null),
  (:'b_lock',  'checked_in', '2026-02-10 10:30+00', '2026-02-10 10:30+00', null),
  (:'b_flag',  'checked_in', '2026-02-10 09:00+00', '2026-02-10 09:00+00', null),
  (:'b_out',   'checked_in', '2026-02-10 09:00+00', '2026-02-10 09:00+00', '2026-02-10 16:00+00'),
  (:'b_break', 'checked_in', '2026-02-10 09:00+00', '2026-02-10 09:00+00', null),
  (:'b_paid',  'checked_in', '2026-02-10 09:00+00', '2026-02-10 09:00+00', null),
  (:'b_lc_in', 'checked_in', '2026-02-10 12:40+00', '2026-02-10 12:40+00', null),
  -- The accepted press at 10:00, then a later logged attempt with no
  -- check-in on it. The worker is on shift; the later row must not hide it.
  (:'b_press', 'checked_in',    '2026-02-10 10:00+00', '2026-02-10 10:00+00', null),
  (:'b_press', 'out_of_radius', '2026-02-10 10:05+00', null,                   null);

-- A No check-out already on file: RULE-02's on-the-press raise, or a
-- manager flag. Either way the worker is not on site to be prompted.
insert into violations (staff_id, booking_id, type, detected_at)
values (:'staffa', :'b_flag', 'no_checkout', '2026-02-10 14:30+00');

insert into breaks (booking_id, started_at, ended_at)
values (:'b_break', '2026-02-10 12:00+00', '2026-02-10 12:20+00');

-- A tick while section 8 is still running: nobody confirmed after its
-- start is a No-show yet — their check-in is open until 16:20.
create temporary table t_early as select booking_tick('2026-02-10 15:00+00') as counts;

select is(
  (select count(*)::int from violations where booking_id = :'b_lc' and type = 'no_show'), 0,
  '§5.1: at 15:00 a replacement confirmed after the 12:20 start is not a No-show — their check-in stays open until the end');
select is(
  (select count(*)::int from violations where booking_id = :'b_ontime' and type = 'no_show'), 1,
  'while the worker booked in advance is, from 12:50 (start + 30)');

create temporary table t_main as select booking_tick('2026-02-10 16:30+00') as counts;

-- ---------------------------------------------------------------------
-- 1 · N13 to the check-out lock
-- ---------------------------------------------------------------------
select ok(exists (select 1 from notification_outbox where key = 'N13:booking:' || :'b_over'),
  '§5.2b: six and a half hours in, thirty minutes past the scheduled end, still checked in — prompted');
select ok(exists (select 1 from notification_outbox where key = 'N13:booking:' || :'b_edge'),
  'one minute before the check-out lock (end + 3 h 59), still checked in — prompted');
select ok(not exists (select 1 from notification_outbox where key = 'N13:booking:' || :'b_lock'),
  'at end + 4 h, when the button locks, nobody is prompted about a break');
select is(
  (select count(*)::int from violations where booking_id = :'b_lock' and type = 'no_checkout'), 1,
  'because by then they have gone home: BG-09 raised No check-out in the same run');
select ok(not exists (select 1 from notification_outbox where key = 'N13:booking:' || :'b_flag'),
  'a booking already carrying No check-out is not prompted, even inside end + 4 h');
select ok(not exists (select 1 from notification_outbox where key = 'N13:booking:' || :'b_out'),
  'nor one that has checked out');
select ok(not exists (select 1 from notification_outbox where key = 'N13:booking:' || :'b_break'),
  'nor one that has logged a break');
select ok(not exists (select 1 from notification_outbox where key = 'N13:booking:' || :'b_paid'),
  'nor one on a client that pays for breaks');

-- ---------------------------------------------------------------------
-- 2 · The late-confirmed No-show, at the end
-- ---------------------------------------------------------------------
select is(
  (select array_agg(detected_at) from violations where booking_id = :'b_lc' and type = 'no_show'),
  array[timestamptz '2026-02-10 16:30+00'],
  'D48: once section 8 has ended (16:20), the replacement who never came is marked No-show — once, by the run that saw it');
select is(
  (select count(*)::int from violations where booking_id = :'b_lc_in' and type = 'no_show'), 0,
  'the replacement who did check in is not');
select is(
  (select count(*)::int from violations where booking_id = :'b_ontime' and type = 'no_show'), 1,
  'and the advance booking still has exactly one');

-- ---------------------------------------------------------------------
-- 3 · The accepted press
-- ---------------------------------------------------------------------
select ok(exists (select 1 from notification_outbox where key = 'N13:booking:' || :'b_press'),
  'the working set reads the accepted check-in: a later attempt with no check-in on it does not make an on-shift worker look absent');
select ok(not exists (select 1 from violations where booking_id = :'b_press'),
  'and raises nothing against them');

-- ---------------------------------------------------------------------
-- Idempotence
-- ---------------------------------------------------------------------
create temporary table t_again as select booking_tick('2026-02-10 16:30+00') as counts;
select is((select (counts->>'n13')::int + (counts->>'no_show')::int + (counts->>'no_checkout')::int from t_again), 0,
  'a second run at the same instant adds no N13, No-show or No check-out');
select is(
  (select count(*)::int from notification_outbox where key like 'N13:booking:61c00000%'), 3,
  'three N13 rows in all — over, edge and the accepted press — and nobody twice');

select * from finish();
rollback;
