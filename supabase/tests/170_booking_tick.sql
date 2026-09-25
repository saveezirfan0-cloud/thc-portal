-- =====================================================================
-- 170 · The per-booking timers (§7 BG-01/02/02b/03/09/10)
--   booking_tick() from 20260921155908_booking_tick.sql, as restated by
--   20260929100000 (N13 to the check-out lock; No-show at the end for a
--   booking confirmed after its start)
--
-- Six rules that fire off one booking's own clock. What matters here is
-- not that each one fires — that is the easy half — but that each one
-- STOPS firing: the job runs every minute, so a rule that is merely
-- correct on the first pass sends sixty pushes in the half hour before a
-- shift, and raises sixty No-shows against one worker's show rate (§6).
--
-- Every case pins a fixed instant rather than now(), so the arithmetic is
-- readable and nothing here depends on when the suite runs.
-- =====================================================================
begin;
select plan(24);
\ir _shared/fixtures.psql

-- ---------------------------------------------------------------------
-- A world with a known clock. The fixtures' own bookings are pushed out
-- of reach so the counts below are only about the rows added here.
-- ---------------------------------------------------------------------
\set now    '2026-09-21 20:00:00+00'
\set evt_unpaid '7c000000-0000-4000-8000-00000000000a'
\set evt_paid   '7c000000-0000-4000-8000-00000000000b'

update shift_requirements set starts_at = :'now'::timestamptz + interval '40 days',
                              ends_at   = :'now'::timestamptz + interval '41 days';

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'evt_unpaid', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Product Launch', date '2026-09-21', false, true),
  (:'evt_paid', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Wedding', date '2026-09-21', true, true);

-- Eight sections, one per case, each with its own booking.
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  ('51000000-0000-4000-8000-000000000001', :'evt_unpaid', :'role_id', '2026-09-21 20:20+00', '2026-09-22 02:00+00', 1,0, 30,15, 1),
  ('51000000-0000-4000-8000-000000000002', :'evt_unpaid', :'role_id', '2026-09-21 14:00+00', '2026-09-21 20:20+00', 1,0, 30,15, 1),
  ('51000000-0000-4000-8000-000000000003', :'evt_unpaid', :'role_id', '2026-09-21 12:00+00', '2026-09-21 19:00+00', 1,0, 30,15, 1),
  ('51000000-0000-4000-8000-000000000004', :'evt_unpaid', :'role_id', '2026-09-21 19:00+00', '2026-09-22 01:00+00', 1,0, 30,15, 1),
  ('51000000-0000-4000-8000-000000000005', :'evt_unpaid', :'role_id', '2026-09-21 09:00+00', '2026-09-21 15:00+00', 1,0, 30,15, 1),
  ('51000000-0000-4000-8000-000000000006', :'evt_unpaid', :'role_id', '2026-09-21 13:00+00', '2026-09-21 23:00+00', 1,0, 30,15, 1),
  ('51000000-0000-4000-8000-000000000007', :'evt_paid',   :'role_id', '2026-09-21 13:00+00', '2026-09-21 23:00+00', 1,0, 30,15, 1),
  ('51000000-0000-4000-8000-000000000008', :'evt_unpaid', :'role_id', '2026-09-21 19:00+00', '2026-09-22 01:00+00', 1,0, 30,15, 1);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  ('b1000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001',:'staffa','confirmed','auto','2026-09-20 10:00+00'),
  ('b1000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000002',:'staffa','worked',   'auto','2026-09-20 10:00+00'),
  ('b1000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000003',:'staffa','worked',   'auto','2026-09-20 10:00+00'),
  ('b1000000-0000-4000-8000-000000000004','51000000-0000-4000-8000-000000000004',:'staffa','confirmed','auto','2026-09-20 10:00+00'),
  ('b1000000-0000-4000-8000-000000000005','51000000-0000-4000-8000-000000000005',:'staffa','worked',   'auto','2026-09-20 10:00+00'),
  ('b1000000-0000-4000-8000-000000000006','51000000-0000-4000-8000-000000000006',:'staffa','worked',   'auto','2026-09-20 10:00+00'),
  ('b1000000-0000-4000-8000-000000000007','51000000-0000-4000-8000-000000000007',:'staffa','worked',   'auto','2026-09-20 10:00+00'),
  -- confirmed AFTER its own start: the §5.1 escalation replacement.
  ('b1000000-0000-4000-8000-000000000008','51000000-0000-4000-8000-000000000008',:'staffa','confirmed','escalation','2026-09-21 19:30+00');

insert into check_logs (booking_id, outcome, attempted_at, check_in_at) values
  ('b1000000-0000-4000-8000-000000000002','checked_in','2026-09-21 14:00+00','2026-09-21 14:00+00'),
  ('b1000000-0000-4000-8000-000000000003','checked_in','2026-09-21 12:00+00','2026-09-21 12:00+00'),
  ('b1000000-0000-4000-8000-000000000005','checked_in','2026-09-21 09:00+00','2026-09-21 09:00+00'),
  ('b1000000-0000-4000-8000-000000000006','checked_in','2026-09-21 13:00+00','2026-09-21 13:00+00'),
  ('b1000000-0000-4000-8000-000000000007','checked_in','2026-09-21 13:00+00','2026-09-21 13:00+00');

create temporary table t_first as select booking_tick(:'now'::timestamptz) as counts;

-- ---------------------------------------------------------------------
-- BG-01 · check-in reminder, 30 minutes before the section's own start.
-- ---------------------------------------------------------------------
select is((select counts->>'n9_check_in' from t_first), '1',
  'BG-01 reminds exactly the one booking whose start is inside the next 30 minutes');
select is(
  (select payload->>'variant' from notification_outbox
    where key = 'N9:booking:b1000000-0000-4000-8000-000000000001:check-in'),
  'check-in', 'BG-01 names the check-in half of N9, which is the one code with two sends');

-- ---------------------------------------------------------------------
-- BG-02 · check-out reminder, 30 minutes before the end.
-- ---------------------------------------------------------------------
select is((select counts->>'n9_check_out' from t_first), '1',
  'BG-02 reminds exactly the one on-shift booking whose end is inside the next 30 minutes');
select is(
  (select payload->>'variant' from notification_outbox
    where key = 'N9:booking:b1000000-0000-4000-8000-000000000002:check-out'),
  'check-out', 'BG-02 names the check-out half');
select ok(
  not exists (select 1 from notification_outbox
               where key = 'N9:booking:b1000000-0000-4000-8000-000000000001:check-out'),
  'a booking that has not started yet gets no check-out reminder');

-- ---------------------------------------------------------------------
-- BG-02b · "you still haven't checked out", 30 minutes after the end.
-- ---------------------------------------------------------------------
select is((select counts->>'n9b' from t_first), '1', 'BG-02b fires for the one shift 30+ minutes past its end');
select isnt((select id from notification_outbox
              where key = 'N9b:booking:b1000000-0000-4000-8000-000000000003'), null,
  'BG-02b is keyed on the booking, so the every-minute job sends it once');
select is(
  (select payload->>'event' from notification_outbox
    where key = 'N9b:booking:b1000000-0000-4000-8000-000000000003'),
  'Product Launch', 'N9b carries the event name its copy substitutes');
select ok(
  not exists (select 1 from notification_outbox
               where key = 'N9b:booking:b1000000-0000-4000-8000-000000000005'),
  'BG-02b stops at end+4h, where the button locks and BG-09 takes over');

-- ---------------------------------------------------------------------
-- BG-03 · No-show at start + 30, and the §5.1 exemption.
-- ---------------------------------------------------------------------
select is((select counts->>'no_show' from t_first), '1', 'BG-03 raises exactly one No-show');
select is(
  (select count(*)::int from violations
    where booking_id = 'b1000000-0000-4000-8000-000000000004' and type = 'no_show'),
  1, 'the worker who never arrived is marked No-show');
select is(
  (select count(*)::int from violations
    where booking_id = 'b1000000-0000-4000-8000-000000000008' and type = 'no_show'),
  0, '§5.1: a booking confirmed AFTER its own start is exempt — the escalation replacement is measured from a start they were never booked for');
select is(
  (select count(*)::int from violations
    where booking_id = 'b1000000-0000-4000-8000-000000000002' and type = 'no_show'),
  0, 'somebody who checked in is never marked No-show');

-- ---------------------------------------------------------------------
-- BG-09 · No check-out at end + 4 hours.
-- ---------------------------------------------------------------------
select is((select counts->>'no_checkout' from t_first), '1', 'BG-09 raises exactly one No check-out');
select is(
  (select count(*)::int from violations
    where booking_id = 'b1000000-0000-4000-8000-000000000005' and type = 'no_checkout'),
  1, 'the shift four hours past its end with no check-out is flagged, never silently defaulted (RULE-02)');
select is(
  (select count(*)::int from violations
    where booking_id = 'b1000000-0000-4000-8000-000000000003' and type = 'no_checkout'),
  0, 'a shift only one hour past its end is not yet a No check-out — BG-02b is still trying');

-- ---------------------------------------------------------------------
-- BG-10 · The 6-hour break alert.
--
-- The window bound is the part worth pinning, and it is the check-out
-- lock, not the scheduled end (20260929100000). §5.2b: the Breaks block
-- "does not disable or disappear if the shift runs longer than planned",
-- so a worker still checked in an hour into an overrun is prompted. This
-- file pinned `< ends_at` until 29.09 — the wrong way round. What the
-- bound still stops is the worker who went home without checking out:
-- four hours past the end, No check-out raised, never told to ask a
-- manager on site. 611 walks the overrun minute by minute.
-- ---------------------------------------------------------------------
select is((select counts->>'n13' from t_first), '3',
  'BG-10 alerts all three workers six hours in and still checked in on an unpaid-break client, one of them in an overrun');
select ok(
  exists (select 1 from notification_outbox where key = 'N13:booking:b1000000-0000-4000-8000-000000000006'),
  'the worker seven hours into a ten-hour shift is prompted');
select ok(
  not exists (select 1 from notification_outbox where key = 'N13:booking:b1000000-0000-4000-8000-000000000007'),
  'a client who pays for breaks never triggers it (§5.2b)');
select ok(
  exists (select 1 from notification_outbox where key = 'N13:booking:b1000000-0000-4000-8000-000000000003'),
  '§5.2b: a shift running an hour past its scheduled end, worker still checked in, is still prompted');
select ok(
  not exists (select 1 from notification_outbox where key = 'N13:booking:b1000000-0000-4000-8000-000000000005'),
  'but not one four hours past its end and already flagged No check-out');

-- ---------------------------------------------------------------------
-- The property the whole file exists for: the job runs every minute.
-- ---------------------------------------------------------------------
create temporary table t_second as select booking_tick(:'now'::timestamptz) as counts;

select is(
  (select counts from t_second),
  -- n6 / n7 since 20260927140000; their own cases are 590_n6_n7_confirm_reminders.
  '{"n6": 0, "n7": 0, "n13": 0, "n9b": 0, "no_show": 0, "n9_check_in": 0, "no_checkout": 0, "n9_check_out": 0}'::jsonb,
  'a second run at the same instant does nothing at all: every rule is idempotent');

select is((select count(*)::int from violations where booking_id::text like 'b1000000%'), 2,
  'and no second No-show or No check-out row appears, which would double-count against the show rate (§6)');

-- A cancelled booking drops out entirely, whatever its clock says.
update bookings set status = 'cancelled', cancelled_at = :'now'::timestamptz,
                    cancel_cause = 'office_withdraw'
 where id = 'b1000000-0000-4000-8000-000000000001';
delete from notification_outbox where key like 'N9:booking:b1000000-0000-4000-8000-000000000001%';

select is((select (booking_tick(:'now'::timestamptz))->>'n9_check_in'), '0',
  'a cancelled booking is never reminded of anything');

select * from finish();
rollback;
