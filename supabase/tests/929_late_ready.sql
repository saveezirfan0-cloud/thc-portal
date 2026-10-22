-- =====================================================================
-- 929 · A worker who accepts after the noon deadline gets an hour to press
--       "I'm ready" (§3.5; ADR-0196)
--   20261024120000_late_ready.sql
--
-- Held here:
--   * the rule — accepted at or after ready_deadline(start), on a UK day
--     before the shift's, with the hour over before the start;
--   * late_ready_tick(): LR1 at 15, 30 and 45 minutes after accepting, one
--     per step, with the minutes left in the payload, none for a worker who
--     has pressed "I'm ready", for a noon-rule booking, or for a same-day one;
--   * release_unready_bookings(): at the hour, a warned worker is released
--     (cancel_cause ready_cutoff) and told with LR2, not N6b; one never sent
--     the first LR1 is not; the noon-rule bookings are untouched.
--
-- Not held here: mark_ready() inside the late window. It reads now(), and
-- the window needs a confirmation after 12:00 UK on the day before a shift,
-- which no fixed fixture can be relative to the transaction clock for at
-- every hour of the day. mark_ready()'s other refusals are 610's, and the
-- TypeScript twin (readyWindowClosed) is pinned in packages/domain.
-- February, so UK time is UTC and the instants read plainly.
-- =====================================================================
begin;
select plan(28);
\ir _shared/fixtures.psql

update shift_requirements set starts_at = timestamptz '2027-06-01 10:00+00',
                              ends_at   = timestamptz '2027-06-01 18:00+00';

\set evt     '92800000-0000-4000-8000-00000000000e'
\set tmrw    '92800000-0000-4000-8000-0000000000a1'
\set b_slow  '92900000-0000-4000-8000-000000000001'
\set b_ready '92900000-0000-4000-8000-000000000002'
\set b_noon  '92900000-0000-4000-8000-000000000003'
\set b_same  '92900000-0000-4000-8000-000000000004'
\set b_nowarn '92900000-0000-4000-8000-000000000005'

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'evt', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Late Ready Dinner', date '2027-02-12', true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'tmrw', :'evt', :'role_id', '2027-02-12 17:00+00', '2027-02-12 23:00+00', 9, 0, 30, 15, 1);

insert into staff (id, first_name, last_name, email, phone, dob, status) values
  ('92a00000-0000-4000-8000-000000000001', 'Late', 'One',   'l1@late.test', '+447700928931', date '1995-01-01', 'compliant'),
  ('92a00000-0000-4000-8000-000000000002', 'Late', 'Two',   'l2@late.test', '+447700928932', date '1995-01-01', 'compliant'),
  ('92a00000-0000-4000-8000-000000000003', 'Late', 'Three', 'l3@late.test', '+447700928933', date '1995-01-01', 'compliant');

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at, day_before_confirmed_at) values
  -- accepted 12:30 the day before; never presses it
  (:'b_slow',   :'tmrw', :'staffa', 'confirmed', 'auto',   '2027-02-11 12:30+00', null),
  -- accepted 12:30, presses it at 12:40
  (:'b_ready',  :'tmrw', :'staffb', 'confirmed', 'auto',   '2027-02-11 12:30+00', '2027-02-11 12:40+00'),
  -- accepted days ago: the noon rule, not this one
  (:'b_noon',   :'tmrw', '92a00000-0000-4000-8000-000000000001', 'confirmed', 'auto',   '2027-02-01 10:00+00', null),
  -- booked on the day of the shift (RULE-08)
  (:'b_same',   :'tmrw', '92a00000-0000-4000-8000-000000000002', 'confirmed', 'auto',   '2027-02-12 09:00+00', null),
  -- accepted 14:00 the day before; the reminders below never run in its hour
  (:'b_nowarn', :'tmrw', '92a00000-0000-4000-8000-000000000003', 'confirmed', 'auto',   '2027-02-11 14:00+00', null);

-- ---------------------------------------------------------------------
-- 1. The rule
-- ---------------------------------------------------------------------
select is(late_ready_applies('2027-02-11 12:00+00', '2027-02-12 17:00+00'), true,
  'accepted at 12:00 the day before: the deadline had already come, so the hour applies');
select is(late_ready_applies('2027-02-11 11:59+00', '2027-02-12 17:00+00'), false,
  'accepted at 11:59: the noon rule applies, not this one');
select is(late_ready_applies('2027-02-12 09:00+00', '2027-02-12 17:00+00'), false,
  'booked on the day of the shift (RULE-08): exempt, as ever');
select is(late_ready_applies('2027-02-11 23:30+00', '2027-02-12 00:10+00'), false,
  'an hour that would run into the start: not applied');
select is(late_ready_applies(null, '2027-02-12 17:00+00'), false,
  'no confirmed_at: not applied');
select is(late_ready_closes_at('2027-02-11 12:30+00'), timestamptz '2027-02-11 13:30+00',
  'the hour closes an hour after accepting');

-- ---------------------------------------------------------------------
-- 2. The reminders: 15, 30, 45 minutes after accepting
-- ---------------------------------------------------------------------
select is((late_ready_tick('2027-02-11 12:44+00'))->>'lr1', '0',
  '14 minutes after accepting: nobody is asked yet');

select is((late_ready_tick('2027-02-11 12:45+00'))->>'lr1', '1',
  'at +15 minutes the first push goes — to the one worker still not ready');
select is((select payload->>'minutes' from notification_outbox
            where key = late_ready_key(:'b_slow', '2027-02-11 12:30+00', 1)), '45',
  'it says 45 minutes are left');
select is((select template from notification_outbox
            where key = late_ready_key(:'b_slow', '2027-02-11 12:30+00', 1)), 'LR1',
  'and it is LR1');
select is((late_ready_tick('2027-02-11 12:46+00'))->>'lr1', '0',
  'the next minute sends nothing: one push per step');

select is((late_ready_tick('2027-02-11 13:00+00'))->>'lr1', '1', 'at +30 the reminder goes');
select is((select payload->>'minutes' from notification_outbox
            where key = late_ready_key(:'b_slow', '2027-02-11 12:30+00', 2)), '30',
  '… with 30 minutes left');
select is((late_ready_tick('2027-02-11 13:15+00'))->>'lr1', '1', 'at +45 the last reminder goes');
select is((select payload->>'minutes' from notification_outbox
            where key = late_ready_key(:'b_slow', '2027-02-11 12:30+00', 3)), '15',
  '… with 15 minutes left');

select is((late_ready_tick('2027-02-11 13:30+00'))->>'lr1', '0',
  'at the hour the window is closed: nothing more is sent');

select is((select count(*)::int from notification_outbox where key like 'LR1:booking:' || :'b_slow' || ':%'), 3,
  'three reminders in all for the worker who never pressed it');
select is((select count(*)::int from notification_outbox where key like 'LR1:booking:' || :'b_ready' || ':%'), 0,
  'none for the worker who pressed "I''m ready" at 12:40');
select is((select count(*)::int from notification_outbox
            where key like 'LR1:booking:' || :'b_noon' || ':%' or key like 'LR1:booking:' || :'b_same' || ':%'), 0,
  'none for a noon-rule booking or a same-day one');

-- ---------------------------------------------------------------------
-- 3. The release at the hour
-- ---------------------------------------------------------------------
select is(release_unready_bookings('2027-02-11 13:29+00'), 0,
  'a minute before the hour: nobody is released');
select is(release_unready_bookings('2027-02-11 13:30+00'), 1,
  'at the hour: exactly one worker is released');
select is((select array[status::text, cancel_cause] from bookings where id = :'b_slow'),
  array['cancelled', 'ready_cutoff'],
  'the one who never pressed it — released the way the noon rule releases');
select is((select count(*)::int from notification_outbox where key like 'LR2:booking:' || :'b_slow' || ':%'), 1,
  'and told so with LR2');
select is((select count(*)::int from notification_outbox where key = 'N6b:booking:' || :'b_slow'), 0,
  'not with N6b, whose words are about the 12:00 deadline');

select is((select array_agg(status::text order by id) from bookings
            where id in (:'b_ready', :'b_noon', :'b_same')),
  array['confirmed', 'confirmed', 'confirmed'],
  'the ready worker, the noon-rule booking and the same-day booking all keep the shift');

select is(release_unready_bookings('2027-02-11 13:35+00'), 0, 'a second run releases nobody');

select is(release_unready_bookings('2027-02-11 15:05+00'), 0,
  'a worker whose hour passed without the first reminder being sent is not released');
select is((select status::text from bookings where id = :'b_nowarn'), 'confirmed',
  'the system does not release somebody it cannot show it asked');

select * from finish();
rollback;
