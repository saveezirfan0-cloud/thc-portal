-- =====================================================================
-- 240 · background tracking and the live monitor (§5.1, §9.5, BG-06/07)
--
-- record_ping() is the only write path into location_pings, and until it
-- existed every off-site check-out fell through to RULE-02's second
-- trigger because the trail was always empty. The last case here is that
-- integration: a real on-site fix, and the off-site press records it.
--
-- `now()` is frozen inside a transaction, so pings that need to be ordered
-- are written through the RPC and then back-dated where the ordering is
-- what matters.
-- =====================================================================
begin;

\ir _shared/fixtures.psql

select plan(34);

\set ev_mon   '9e9e9e9e-0000-4000-8000-000000000001'
\set ev_paid  '9e9e9e9e-0000-4000-8000-000000000002'
\set sh_mon   '9f9f9f9f-0000-4000-8000-000000000001'
\set sh_paid  '9f9f9f9f-0000-4000-8000-000000000002'
\set bk_on    '9a9a9a9a-0000-4000-8000-000000000001'
\set bk_due   '9a9a9a9a-0000-4000-8000-000000000002'
\set bk_paid  '9a9a9a9a-0000-4000-8000-000000000003'

-- The venue sits at (-0.1000, 51.5000) with a 150 m fence. 51.6 is ~11 km north.
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer) values
  (:'ev_mon',  :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Monitor Gala', current_date, false, true),
  (:'ev_paid', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Monitor Paid Breaks', current_date, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'sh_mon',  :'ev_mon',  :'role_id', now() - interval '10 minutes', now() + interval '6 hours', 6, 0, 22.97, 14.00, 6),
  (:'sh_paid', :'ev_paid', :'role_id', now() - interval '10 minutes', now() + interval '6 hours', 6, 0, 22.97, 14.00, 6);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at, on_day_confirmed_at) values
  (:'bk_on',   :'sh_mon',  :'staffa', 'confirmed', 'auto', now() - interval '2 days', now()),
  (:'bk_due',  :'sh_mon',  :'staffb', 'confirmed', 'auto', now() - interval '2 days', null),
  (:'bk_paid', :'sh_paid', :'staffb', 'confirmed', 'auto', now() - interval '2 days', now());

-- ---------------------------------------------------------------------
-- 1 · record_ping (§5.1)
-- ---------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

select throws_ok(
  format('select record_ping(%L, 51.5, -0.1)', :'bk_on'),
  'P0001', 'not_checked_in',
  '§5.1 tracking does not run before check-in — there is no shift to track yet'
);

select is(attempt_check_in(:'bk_on', 51.5000, -0.1000)->>'accepted', 'true',
  'the worker checks in on site');

select is(record_ping(:'bk_on', 51.5000, -0.1000)->>'decision', 'on_site',
  '§5.1 a fix inside the fence records the worker on site');
select is((select count(*)::int from location_pings where booking_id = :'bk_on'), 1,
  'the ping is stored — this is the only write path into the table');
select is((select last_on_site_at is not null from check_logs where booking_id = :'bk_on'), true,
  'and the check log carries the last on-site fix, so RULE-01 reads one column not a trail');

-- Leaving the venue mid-shift.
select is(record_ping(:'bk_on', 51.6000, -0.1000)->>'exitRecorded', 'true',
  '§5.1 walking out of the geofence is recorded as an exit');
select is((select count(*)::int from violations where booking_id = :'bk_on' and type = 'left_geofence'), 1,
  'BG-06/07 the exit raises a Violation for the manager to deal with');

select is(record_ping(:'bk_on', 51.6000, -0.1000)->>'exitRecorded', 'false',
  'a phone still reporting from across town is the same exit, not a new one');
select is((select count(*)::int from violations where booking_id = :'bk_on' and type = 'left_geofence'), 1,
  '§9.5 so the violation log gets one row per exit, not one per GPS sample'
);

-- Coming back and leaving again is genuinely a second exit.
select is(record_ping(:'bk_on', 51.5000, -0.1000)->>'decision', 'on_site', 'the worker returns');
select is(record_ping(:'bk_on', 51.6000, -0.1000)->>'exitRecorded', 'true', 'and leaves a second time');
select is((select count(*)::int from violations where booking_id = :'bk_on' and type = 'left_geofence'), 2,
  'which is a second exit, and a second row');

select throws_ok(
  format('select record_ping(%L, 51.5, -0.1)', :'bk_due'),
  '42501', 'not_your_booking',
  'a worker cannot write pings onto somebody else''s booking'
);

-- ---------------------------------------------------------------------
-- 2 · the integration this whole file exists for (§5.1, RULE-02)
--
-- Before record_ping the trail was always empty, so an off-site check-out
-- could only ever take RULE-02's second trigger. With a real on-site fix
-- it records that fix instead, and raises nothing.
-- ---------------------------------------------------------------------
update location_pings set at = now() - interval '2 hours'
 where booking_id = :'bk_on' and inside_geofence;
-- Every role section is at least four hours (§3.2), so the window moves as a whole.
update check_logs set check_in_at = now() - interval '4 hours 30 minutes' where booking_id = :'bk_on';
update shift_requirements set starts_at = now() - interval '4 hours 30 minutes', ends_at = now() - interval '5 minutes'
 where id = :'sh_mon';

select is(check_out(:'bk_on', 51.6000, -0.1000)->>'decision', 'recorded_last_on_site',
  '§5.1 an off-site check-out now records the last on-site fix instead of failing to RULE-02');
select is((select count(*)::int from violations where booking_id = :'bk_on' and type = 'no_checkout'), 0,
  'RULE-02 is not raised, because tracking did produce a time'
);

-- ---------------------------------------------------------------------
-- 3 · checkin_monitor_v statuses (§9.5)
-- ---------------------------------------------------------------------
reset role;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is((select status from checkin_monitor_v where booking_id = :'bk_on'), 'checked_out',
  '§9.5 a closed shift reads Checked out');
select is((select late_check_out from checkin_monitor_v where booking_id = :'bk_on'), false,
  '§9.5 and is not flagged when the recorded finish is inside the 15 minutes');

-- The row stays Checked out but turns red once the recorded finish is late.
update check_logs set check_out_at = (select ends_at + interval '40 minutes' from shift_requirements where id = :'sh_mon')
 where booking_id = :'bk_on';
select is((select late_check_out from checkin_monitor_v where booking_id = :'bk_on'), true,
  '§9.5 a recorded finish more than 15 minutes past the end turns the pill red');

-- A worker still on shift, and the same worker off site.
update check_logs set check_out_at = null, check_out_pressed_at = null where booking_id = :'bk_on';
delete from location_pings where booking_id = :'bk_on';
update shift_requirements set starts_at = now() - interval '10 minutes', ends_at = now() + interval '6 hours'
 where id = :'sh_mon';
select is((select status from checkin_monitor_v where booking_id = :'bk_on'), 'on_shift',
  '§9.5 checked in with no fix against them reads On shift');

insert into location_pings (booking_id, at, location, inside_geofence) values
  (:'bk_on', now(), st_setsrid(st_makepoint(-0.1000, 51.6000), 4326)::geography, false);
select is((select status from checkin_monitor_v where booking_id = :'bk_on'), 'off_site',
  '§9.5 and flips to Off-site the moment the last fix is outside the fence');

-- RULE-02's end state.
update shift_requirements set starts_at = now() - interval '9 hours 30 minutes', ends_at = now() - interval '5 hours'
 where id = :'sh_mon';
select is((select status from checkin_monitor_v where booking_id = :'bk_on'), 'no_check_out',
  'RULE-02 four hours past the end with nothing recorded reads No check-out');

-- The waiting states, on the worker who never checked in.
update shift_requirements set starts_at = now() + interval '3 hours', ends_at = now() + interval '9 hours'
 where id = :'sh_mon';
select is((select status from checkin_monitor_v where booking_id = :'bk_due'), 'not_confirmed_today',
  '§3.5 a worker who has not pressed the on-the-day confirmation is shown as such, not as Due');
update bookings set on_day_confirmed_at = now() where id = :'bk_due';
select is((select status from checkin_monitor_v where booking_id = :'bk_due'), 'due',
  '§9.5 once they have, the row is simply Due');

update shift_requirements set starts_at = now() + interval '20 minutes', ends_at = now() + interval '6 hours'
 where id = :'sh_mon';
select is((select status from checkin_monitor_v where booking_id = :'bk_due'), 'not_checked_in',
  '§9.5 the red alert fires 30 minutes BEFORE the start, not after it');
update shift_requirements set starts_at = now() - interval '45 minutes', ends_at = now() + interval '6 hours'
 where id = :'sh_mon';
select is((select status from checkin_monitor_v where booking_id = :'bk_due'), 'not_checked_in',
  '§9.5 and keeps that label through the automatic No-show — there is no separate pill'
);

-- Breaks: a dash, never a zero, where the client pays (§3.2, §5.2b).
select is((select breaks_count from checkin_monitor_v where booking_id = :'bk_paid'), null,
  '§9.5 a client that pays for breaks holds no break data, so the column is empty');
insert into breaks (booking_id, started_at) values (:'bk_on', now() - interval '30 minutes');
select is((select breaks_count from checkin_monitor_v where booking_id = :'bk_on'), 1,
  '§9.5 where the client does not pay, the count is real');
select is((select breaks_count from checkin_monitor_v where booking_id = :'bk_due'), 0,
  '§9.5 and a worker who has taken none reads 0, which is not the same as no data');

-- RULE-18: the window is the role section's own.
select is(
  (select starts_at from checkin_monitor_v where booking_id = :'bk_on'),
  (select starts_at from shift_requirements where id = :'sh_mon'),
  'RULE-18 the WINDOW column is the role section''s window, never the event''s'
);

-- §11.1: no rate can leave through this view.
reset role;
set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from checkin_monitor_v), 0,
  '§11.1 a client reads no row of the monitor at all');
reset role;

-- ---------------------------------------------------------------------
-- 4 · booking_venue_point (§5.1)
--
-- The shift screen needs the venue centre as numbers, which a geography
-- column does not survive PostgREST as. It is a reader: the distance that
-- decides a check-in is computed inside attempt_check_in from the fix the
-- device sends.
-- ---------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select is(
  round((booking_venue_point(:'bk_on')->>'lat')::numeric, 4), 51.5000::numeric,
  '§5.1 the worker can read their own venue''s latitude');
select is(
  round((booking_venue_point(:'bk_on')->>'lng')::numeric, 4), -0.1000::numeric,
  'and its longitude');
select is(
  (booking_venue_point(:'bk_on')->>'radiusM')::int, 150,
  'and the radius the screen quotes back to them');
select throws_ok(
  format('select booking_venue_point(%L)', :'bk_paid'),
  '42501', 'not_your_booking',
  'but not a venue they hold no booking at — the booking is the entitlement');
reset role;

select * from finish();
rollback;
