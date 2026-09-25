-- =====================================================================
-- 612 · N6 / N7 per start, N7 just after midnight, and no release
--       without N6
--   20260929100000_confirmation_timers_restated.sql (ADR-0034; audit D26,
--   D25's retry)
--
--   1. The key is <code>:booking:<id>:<start epoch>: one row per booking
--      per start however often the job runs, and a fresh one when the
--      office moves the shift.
--   2. n7_closes_at(): a section starting 00:01–00:59 UK has an N7 window;
--      00:00 exactly has none.
--   3. release_unready_bookings() releases only a booking that was sent N6
--      for its current start — a booking accepted after the last tick
--      before noon is not released unwarned.
--   4. A 12:05 run that failed is made good by a later run the same
--      afternoon, and never on the day of the shift.
--
-- February 2026: UK time is UTC, and every shift is in the past so no
-- rota guard is involved. Every instant is fixed.
-- =====================================================================
begin;
select plan(26);
\ir _shared/fixtures.psql

update shift_requirements set starts_at = timestamptz '2027-06-01 10:00+00',
                              ends_at   = timestamptz '2027-06-01 18:00+00';

-- ---------------------------------------------------------------------
-- 1 · The key
-- ---------------------------------------------------------------------
select is(booking_reminder_key('N6', '61e00000-0000-4000-8000-000000000001', '2026-02-11 18:00+00'),
  'N6:booking:61e00000-0000-4000-8000-000000000001:1770832800',
  'the key is <code>:booking:<id>:<start as epoch seconds>');
select isnt(booking_reminder_key('N6', '61e00000-0000-4000-8000-000000000001', '2026-02-11 19:00+00'),
  booking_reminder_key('N6', '61e00000-0000-4000-8000-000000000001', '2026-02-11 18:00+00'),
  'a different start is a different key');

-- ---------------------------------------------------------------------
-- 2 · n7_closes_at
-- ---------------------------------------------------------------------
select is(n7_closes_at('2026-02-11 19:00+00'), '2026-02-11 18:30+00'::timestamptz,
  'an evening section: N7 closes 30 minutes before the start, where N9 takes over');
select is(n7_closes_at('2026-02-11 07:00+00'), '2026-02-11 06:30+00'::timestamptz,
  'a breakfast section: likewise');
select is(n7_closes_at('2026-02-12 00:45+00'), '2026-02-12 00:30+00'::timestamptz,
  'a 00:45 section: open 00:00–00:30 rather than the 15 minutes start − 30 would leave');
select is(n7_closes_at('2026-02-12 00:15+00'), '2026-02-12 00:15+00'::timestamptz,
  'a 00:15 section: open 00:00 until the start — before, the window was empty');
select is(n7_closes_at('2026-09-24 00:20+01'), '2026-09-24 00:20+01'::timestamptz,
  'and in BST, off the UK day');
select is(n7_closes_at('2026-02-12 00:00+00'), n7_due_at('2026-02-12 00:00+00'),
  'a section starting at exactly 00:00 has no N7 window: no moment of its UK day comes before it (ADR-0034)');

-- ---------------------------------------------------------------------
-- The world
-- ---------------------------------------------------------------------
\set evt '61e00000-0000-4000-8000-00000000000e'
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'evt', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Reminder Dinner', date '2026-02-11', true, true);

\set s_mv    '61e10000-0000-4000-8000-000000000001'
\set s_0015  '61e10000-0000-4000-8000-000000000002'
\set s_cut   '61e10000-0000-4000-8000-000000000003'
\set s_retry '61e10000-0000-4000-8000-000000000004'

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'s_mv',    :'evt', :'role_id', '2026-02-11 18:00+00', '2026-02-11 23:00+00', 5,0, 30,15, 1),
  (:'s_0015',  :'evt', :'role_id', '2026-02-12 00:15+00', '2026-02-12 06:00+00', 5,0, 30,15, 1),
  (:'s_cut',   :'evt', :'role_id', '2026-02-11 17:00+00', '2026-02-11 22:00+00', 5,0, 30,15, 1),
  (:'s_retry', :'evt', :'role_id', '2026-02-14 17:00+00', '2026-02-14 22:00+00', 5,0, 30,15, 1);

\set b_mv     '61e00000-0000-4000-8000-000000000001'
\set b_0015   '61e00000-0000-4000-8000-000000000002'
\set b_warn   '61e00000-0000-4000-8000-000000000003'
\set b_nowarn '61e00000-0000-4000-8000-000000000004'
\set b_retry  '61e00000-0000-4000-8000-000000000005'

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b_mv',    :'s_mv',    :'staffa', 'confirmed', 'auto', '2026-02-01 10:00+00'),
  (:'b_0015',  :'s_0015',  :'staffa', 'confirmed', 'auto', '2026-02-01 10:00+00'),
  (:'b_warn',  :'s_cut',   :'staffa', 'confirmed', 'auto', '2026-02-01 10:00+00'),
  (:'b_retry', :'s_retry', :'staffa', 'confirmed', 'auto', '2026-02-01 10:00+00');

-- ---------------------------------------------------------------------
-- 1 · A moved shift is reminded again
-- ---------------------------------------------------------------------
create temporary table t1 as select booking_tick('2026-02-10 08:30+00') as c;
create temporary table t2 as select booking_tick('2026-02-10 08:31+00') as c;
select ok(exists (select 1 from notification_outbox
                   where key = booking_reminder_key('N6', :'b_mv', '2026-02-11 18:00+00')),
  'N6 for the 18:00 start');
select is((select c->>'n6' from t2), '0', 'the re-run a minute later adds nothing');

-- The office moves the section to 19:00 (N11; reconfirm_booking() resets
-- the stages). The next tick reminds the worker of the NEW time.
update shift_requirements set starts_at = '2026-02-11 19:00+00', ends_at = '2026-02-11 23:30+00'
 where id = :'s_mv';
create temporary table t3 as select booking_tick('2026-02-10 09:00+00') as c;
select ok(exists (select 1 from notification_outbox
                   where key = booking_reminder_key('N6', :'b_mv', '2026-02-11 19:00+00')),
  'D26: after the move, N6 goes again for the 19:00 start');
select is((select count(*)::int from notification_outbox where key like 'N6:booking:' || :'b_mv' || ':%'), 2,
  'one row per start: two in all');

-- N7 on the day, then a second move in the morning.
create temporary table t4 as select booking_tick('2026-02-11 09:00+00') as c;
update shift_requirements set starts_at = '2026-02-11 20:00+00', ends_at = '2026-02-12 00:00+00'
 where id = :'s_mv';
create temporary table t5 as select booking_tick('2026-02-11 09:05+00') as c;
select is((select count(*)::int from notification_outbox where key like 'N7:booking:' || :'b_mv' || ':%'), 2,
  'N7 likewise: one for 19:00 at 09:00, one for 20:00 after the move');
select ok(exists (select 1 from notification_outbox
                   where key = booking_reminder_key('N7', :'b_mv', '2026-02-11 20:00+00')),
  'the second one keyed on the new start');

-- ---------------------------------------------------------------------
-- 2 · N7 for a 00:15 start
-- ---------------------------------------------------------------------
create temporary table t6 as select booking_tick('2026-02-11 23:59+00') as c;
select ok(not exists (select 1 from notification_outbox where key like 'N7:booking:' || :'b_0015' || ':%'),
  'not before its UK day begins');
create temporary table t7 as select booking_tick('2026-02-12 00:05+00') as c;
select ok(exists (select 1 from notification_outbox
                   where key = booking_reminder_key('N7', :'b_0015', '2026-02-12 00:15+00')),
  'D26: a section starting at 00:15 is reminded at 00:05 — before, its window was empty');

-- ---------------------------------------------------------------------
-- 3 · No release without N6
-- ---------------------------------------------------------------------
-- The moved booking pressed "I'm ready" for its new time, so it is out of
-- the cutoff's reach and the count below is only about s_cut.
update bookings set day_before_confirmed_at = '2026-02-10 10:00+00' where id = :'b_mv';

-- b_warn was reminded by the 08:30 tick above. At 11:59:30 another worker
-- accepts: before the deadline, so the cutoff applies — but the 11:59
-- tick has already run and the 12:00 one is past the deadline.
create temporary table t8 as select booking_tick('2026-02-10 11:59+00') as c;
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at)
values (:'b_nowarn', :'s_cut', :'staffb', 'confirmed', 'auto', '2026-02-10 11:59:30+00');
select is(ready_cutoff_applies('2026-02-10 11:59:30+00', '2026-02-11 17:00+00'), true,
  'premise: an acceptance at 11:59:30 is subject to the deadline');
create temporary table t9 as select booking_tick('2026-02-10 12:00+00') as c;
select ok(not exists (select 1 from notification_outbox where key like 'N6:booking:' || :'b_nowarn' || ':%'),
  'and it was never sent N6: the 12:00 tick is at the deadline, not before it');

select is(release_unready_bookings('2026-02-10 12:05+00'), 1,
  'the 12:05 run releases one booking');
select is((select status::text from bookings where id = :'b_warn'), 'cancelled',
  'the one that was warned');
select is((select status::text from bookings where id = :'b_nowarn'), 'confirmed',
  'D26: the one never sent N6 is not released unwarned');
select ok(not exists (select 1 from notification_outbox where key = 'N6b:booking:' || :'b_nowarn'),
  'and is not told it was removed');

-- ---------------------------------------------------------------------
-- 4 · A failed 12:05 run, retried in the afternoon
-- ---------------------------------------------------------------------
create temporary table t10 as select booking_tick('2026-02-13 08:30+00') as c;
-- No run at 12:05 on the 13th: the Edge Function failed. The gate now
-- lets every run until midnight through (610 §3).
select is(release_unready_bookings('2026-02-13 18:40+00'), 1,
  'D25: the 18:40 run releases the booking the failed 12:05 run left behind');
select is((select count(*)::int from notification_outbox where key = 'N6b:booking:' || :'b_retry'), 1,
  'with N6b, once');
select is(release_unready_bookings('2026-02-13 18:45+00'), 0,
  'the next run finds nothing more to do');
select is(release_unready_bookings('2026-02-10 18:40+00'), 0,
  'and a retry releases nobody the first run did not: b_nowarn is still not warned');

select * from finish();
rollback;
