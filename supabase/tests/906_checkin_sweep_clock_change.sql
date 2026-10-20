-- =====================================================================
-- 906 · The day of the shift across the 25.10.2026 clock change
--   (§1.8, §5.1, §5.2, RULE-01, RULE-02 / BG-09, BG-03, BG-02b, BG-10)
--
-- At 02:00 BST on Sunday 25 October 2026 the UK clocks go back to 01:00
-- GMT: the night has 25 hours, and 01:00–01:59 happens twice. Every rule
-- on the day of the shift is measured in ELAPSED time from the role
-- section's own start or end (RULE-18) — "30 minutes after", "4 hours
-- after", "6 hours since check-in" — so none of them may read the wall
-- clock. A wall-clock reading would put the No check-out an hour late on
-- a shift that ends before the change, pay a 22:00–03:00 shift five hours
-- instead of six, and send N13 an hour late.
--
-- Every instant is fixed and passed to booking_tick(p_now) /
-- check_in_decision(); nothing reads now().
-- =====================================================================
begin;
select plan(16);
\ir _shared/fixtures.psql

\set evt '89900000-0000-4000-8000-00000000000a'

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'evt', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Clock Change Night', date '2026-10-24', false, true);

-- s_over: 22:00 BST Sat → 03:00 GMT Sun, six hours of elapsed time.
-- s_pre:  21:00 BST Sat → 01:30 BST Sun (the FIRST 01:30), ends before
--         the change; four hours later is 04:30 GMT, not 05:30.
-- s_long: 20:00 BST Sat → 03:00 GMT Sun, unpaid breaks, for N13.
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  ('89900000-0000-4000-8000-000000000001', :'evt', :'role_id',
   '2026-10-24 22:00+01', '2026-10-25 03:00+00', 5, 0, 30, 15, 1),
  ('89900000-0000-4000-8000-000000000002', :'evt', :'role_id',
   '2026-10-24 21:00+01', '2026-10-25 01:30+01', 5, 0, 30, 15, 1),
  ('89900000-0000-4000-8000-000000000003', :'evt', :'role_id',
   '2026-10-24 20:00+01', '2026-10-25 03:00+00', 5, 0, 30, 15, 1);

\set b_noshow '89900000-0000-4000-8000-0000000000b1'
\set b_over   '89900000-0000-4000-8000-0000000000b2'
\set b_pre    '89900000-0000-4000-8000-0000000000b3'
\set b_long   '89900000-0000-4000-8000-0000000000b4'

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b_noshow', '89900000-0000-4000-8000-000000000001', :'staffb', 'confirmed', 'auto', '2026-10-20 10:00+01'),
  (:'b_over',   '89900000-0000-4000-8000-000000000001', :'staffa', 'worked',    'auto', '2026-10-20 10:00+01'),
  (:'b_pre',    '89900000-0000-4000-8000-000000000002', :'staffa', 'worked',    'auto', '2026-10-20 10:00+01'),
  (:'b_long',   '89900000-0000-4000-8000-000000000003', :'staffb', 'worked',    'auto', '2026-10-20 10:00+01');

insert into check_logs (booking_id, outcome, attempted_at, check_in_at, on_site_verified) values
  (:'b_over', 'checked_in', '2026-10-24 21:55+01', '2026-10-24 21:55+01', true),
  (:'b_pre',  'checked_in', '2026-10-24 21:00+01', '2026-10-24 21:00+01', true),
  (:'b_long', 'checked_in', '2026-10-24 20:00+01', '2026-10-24 20:00+01', true);

-- ---------------------------------------------------------------------
-- RULE-01 across the change: elapsed minutes, not the wall clock
-- ---------------------------------------------------------------------
select is(
  (payable_minutes('2026-10-24 22:00+01', '2026-10-25 03:00+00',
                   '2026-10-24 21:55+01', '2026-10-25 03:00+00') ->> 'payableMin')::int,
  360,
  'RULE-01: 22:00 BST → 03:00 GMT is six hours paid (360 min), not the five the wall clock reads');
select is(
  (payable_minutes('2026-10-24 22:00+01', '2026-10-25 03:00+00',
                   '2026-10-24 21:55+01', '2026-10-25 03:14+00') ->> 'lateCheckOutFlag')::boolean,
  false,
  '§5.2: a check-out 14 minutes after a GMT end is inside the 15-minute grace');
select is(
  (payable_minutes('2026-10-24 22:00+01', '2026-10-25 03:00+00',
                   '2026-10-24 21:55+01', '2026-10-25 03:16+00') ->> 'lateCheckOutFlag')::boolean,
  true,
  '§5.2: 16 minutes after it is the red flag — and still paid only to the end');

-- ---------------------------------------------------------------------
-- §5.1 grace across the change: a section starting at the first 01:30 BST
-- ---------------------------------------------------------------------
select is(
  check_in_decision('2026-10-25 01:30+01', '2026-10-25 06:00+00', '2026-10-25 01:59+01',
                    true, '2026-10-20 10:00+01', 0, 5, false) ->> 'decision',
  'checked_in_late',
  '§5.1: 29 minutes after a 01:30 BST start is Late');
select is(
  check_in_decision('2026-10-25 01:30+01', '2026-10-25 06:00+00', '2026-10-25 01:00+00',
                    true, '2026-10-20 10:00+01', 0, 5, false) ->> 'decision',
  'locked',
  '§5.1: 30 elapsed minutes later the wall clock reads 01:00 GMT — and check-in has locked');
select is(
  (check_in_decision('2026-10-25 01:30+01', '2026-10-25 06:00+00', '2026-10-25 01:00+00',
                     true, '2026-10-20 10:00+01', 5, 5, true) ->> 'turnAwayPayMin')::int,
  0,
  'RULE-15: a turn-away at that instant is late, so nothing — whatever the clock face says');

-- ---------------------------------------------------------------------
-- BG-03 · No-show at start + 30, elapsed
-- ---------------------------------------------------------------------
select booking_tick('2026-10-24 22:29+01');
select is(
  (select count(*)::int from violations where booking_id = :'b_noshow' and type = 'no_show'), 0,
  'BG-03: at 22:29 BST the worker still has a minute of grace');
select booking_tick('2026-10-24 22:30+01');
select is(
  (select count(*)::int from violations where booking_id = :'b_noshow' and type = 'no_show'), 1,
  'BG-03: at 22:30 BST (start + 30) the No-show is raised');

-- ---------------------------------------------------------------------
-- BG-10 · N13 six ELAPSED hours after check-in (20:00 BST → 01:00 GMT)
-- ---------------------------------------------------------------------
select booking_tick('2026-10-25 01:59+01');
select is(
  (select count(*)::int from notification_outbox where key = 'N13:booking:' || :'b_long'), 0,
  'BG-10: at 01:59 BST only five hours and 59 minutes have passed since the 20:00 BST check-in');
select booking_tick('2026-10-25 01:00+00');
select is(
  (select count(*)::int from notification_outbox where key = 'N13:booking:' || :'b_long'), 1,
  'BG-10: at 01:00 GMT — six elapsed hours, though the clock reads "five" — N13 is queued once');

-- ---------------------------------------------------------------------
-- BG-09 · No check-out at end + 4 h, elapsed, on a shift that ended
-- BEFORE the change: 01:30 BST + 4 h = 04:30 GMT, not 05:30
-- ---------------------------------------------------------------------
select booking_tick('2026-10-25 04:29+00');
select is(
  (select count(*)::int from violations where booking_id = :'b_pre' and type = 'no_checkout'), 0,
  'BG-09: at 04:29 GMT the check-out button is still open (end + 3 h 59 min)');
select is(
  (select count(*)::int from notification_outbox where key = 'N9b:booking:' || :'b_pre'), 1,
  'BG-02b: N9b went in the meantime, while check-out was still open');
select booking_tick('2026-10-25 04:30+00');
select is(
  (select count(*)::int from violations where booking_id = :'b_pre' and type = 'no_checkout'), 1,
  'BG-09: at 04:30 GMT — four elapsed hours after the 01:30 BST end — No check-out is raised');
select is(
  (select check_out_at from check_logs where booking_id = :'b_pre' and check_in_at is not null),
  null::timestamptz,
  'RULE-02: and nothing is defaulted to the scheduled end');

-- ---------------------------------------------------------------------
-- BG-09 on the shift ending after the change: 03:00 GMT + 4 h = 07:00 GMT
-- ---------------------------------------------------------------------
select booking_tick('2026-10-25 06:59+00');
select is(
  (select count(*)::int from violations where booking_id = :'b_over' and type = 'no_checkout'), 0,
  'BG-09: at 06:59 GMT the 03:00 GMT shift is still open');
select booking_tick('2026-10-25 07:00+00');
select is(
  (select count(*)::int from violations where booking_id = :'b_over' and type = 'no_checkout'), 1,
  'BG-09: at 07:00 GMT it locks with No check-out');

select * from finish();
rollback;
