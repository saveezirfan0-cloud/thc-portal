-- =====================================================================
-- 930 · A late confirmer is reminded every 15 minutes to press "I'm ready"
--       (§3.5, ADR-0198)
--   20261024130000_late_ready_reminders.sql
--
-- Held here, on one worker's hour (confirmed 15:00 the day before a 17:00
-- start, hour up at 16:00):
--   * the first warning goes with the first tick and says when the hour ends;
--   * then a reminder at +15, +30 and +45 minutes — one per quarter-hour, with
--     the minutes left (45, 30, 15) and the time it runs out — and never a
--     second one in the same quarter-hour;
--   * a worker who presses "I'm ready" is not reminded again;
--   * a worker whose first tick came late is sent one message, with the
--     minutes left from then, and not that quarter-hour's reminder after it;
--   * nothing after the hour is up;
--   * release_late_unready_bookings() releases at the hour a worker reached
--     only by a reminder, and not one reached by nothing, and tells them
--     with N6b (late).
-- February, so UK time is UTC and the instants read plainly (the fixtures'
-- own shifts are moved to June; this file's shift is in February).
-- =====================================================================
begin;
select plan(28);
\ir _shared/fixtures.psql

update shift_requirements set starts_at = timestamptz '2027-06-01 10:00+00',
                              ends_at   = timestamptz '2027-06-01 18:00+00';

\set evt      '93000000-0000-4000-8000-00000000000e'
\set tmrw     '93000000-0000-4000-8000-0000000000a1'
\set b_a      '93000000-0000-4000-8000-000000000001'
\set b_ready  '93000000-0000-4000-8000-000000000002'
\set b_first  '93000000-0000-4000-8000-000000000003'
\set b_never  '93000000-0000-4000-8000-000000000004'

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'evt', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Late Reminder Dinner', date '2027-02-12', true, true);

-- Starts 17:00 on the 12th: noon deadline 12:00 on the 11th, so a 15:00
-- confirmation is late, and its hour ends at 16:00.
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'tmrw', :'evt', :'role_id', '2027-02-12 17:00+00', '2027-02-12 23:00+00', 9, 0, 30, 15, 1);

insert into staff (id, first_name, last_name, email, phone, dob, status) values
  ('93a00000-0000-4000-8000-000000000001', 'Rem', 'One', 'r1@remind.test', '+447700930931', date '1995-01-01', 'compliant'),
  ('93a00000-0000-4000-8000-000000000002', 'Rem', 'Two', 'r2@remind.test', '+447700930932', date '1995-01-01', 'compliant');

-- Both of these confirmed at 15:00 and are on the hour's clock from the start.
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at, day_before_confirmed_at) values
  (:'b_a',     :'tmrw', :'staffa', 'confirmed', 'auto', '2027-02-11 15:00+00', null),
  (:'b_ready', :'tmrw', :'staffb', 'confirmed', 'auto', '2027-02-11 15:00+00', null);

-- ---------------------------------------------------------------------
-- 1. The helpers
-- ---------------------------------------------------------------------
select is(late_ready_step_key(:'b_a', timestamptz '2027-02-12 17:00+00', timestamptz '2027-02-11 15:00+00', 2),
  late_ready_key(:'b_a', timestamptz '2027-02-12 17:00+00', timestamptz '2027-02-11 15:00+00') || ':2',
  'a reminder''s key is the first warning''s key plus its step');
select is(late_ready_told(:'b_a', timestamptz '2027-02-12 17:00+00', timestamptz '2027-02-11 15:00+00'), false,
  'nothing sent yet: not told');

-- ---------------------------------------------------------------------
-- 2. The first warning
-- ---------------------------------------------------------------------
select is((late_ready_tick('2027-02-11 15:00:30+00'))->>'lateN6', '2',
  'the first tick warns both workers, who have not pressed it');
select is((select array[payload->>'variant', payload->>'dueBy'] from notification_outbox
            where key = late_ready_key(:'b_a', timestamptz '2027-02-12 17:00+00', timestamptz '2027-02-11 15:00+00')),
  array['late', '16:00'], 'the first warning is the late variant and names the time the hour ends');
select is(late_ready_told(:'b_a', timestamptz '2027-02-12 17:00+00', timestamptz '2027-02-11 15:00+00'), true,
  'and the booking is now told');
select is((late_ready_tick('2027-02-11 15:01+00')), '{"lateN6": 0, "lateReminders": 0}'::jsonb,
  'the next minute sends nothing');
select is((late_ready_tick('2027-02-11 15:14:59+00')), '{"lateN6": 0, "lateReminders": 0}'::jsonb,
  'and nothing before 15 minutes');

-- ---------------------------------------------------------------------
-- 3. Every 15 minutes
-- ---------------------------------------------------------------------
select is((late_ready_tick('2027-02-11 15:15+00')), '{"lateN6": 0, "lateReminders": 2}'::jsonb,
  'at +15 minutes both are reminded');
select is((select array[payload->>'variant', payload->>'minutes', payload->>'dueBy'] from notification_outbox
            where key = late_ready_step_key(:'b_a', timestamptz '2027-02-12 17:00+00', timestamptz '2027-02-11 15:00+00', 1)),
  array['late-reminder', '45 minutes', '16:00'],
  'the first reminder says 45 minutes are left and when they run out');
select is((late_ready_tick('2027-02-11 15:16+00')), '{"lateN6": 0, "lateReminders": 0}'::jsonb,
  'a reminder is sent once in its quarter-hour');

-- One of them presses it.
update bookings set day_before_confirmed_at = '2027-02-11 15:20+00' where id = :'b_ready';

select is((late_ready_tick('2027-02-11 15:30+00')), '{"lateN6": 0, "lateReminders": 1}'::jsonb,
  'at +30 only the worker who has not pressed it is reminded');
select is((select payload->>'minutes' from notification_outbox
            where key = late_ready_step_key(:'b_a', timestamptz '2027-02-12 17:00+00', timestamptz '2027-02-11 15:00+00', 2)),
  '30 minutes', 'with 30 minutes left');
select is((late_ready_tick('2027-02-11 15:45+00')), '{"lateN6": 0, "lateReminders": 1}'::jsonb,
  'at +45 the last reminder goes');
select is((select payload->>'minutes' from notification_outbox
            where key = late_ready_step_key(:'b_a', timestamptz '2027-02-12 17:00+00', timestamptz '2027-02-11 15:00+00', 3)),
  '15 minutes', 'with 15 minutes left');

select is((select count(*)::int from notification_outbox where key like 'N6:booking:' || :'b_a' || ':%'), 4,
  'four pushes in the hour for the worker who never pressed it: the warning and three reminders');
select is((select count(*)::int from notification_outbox where key like 'N6:booking:' || :'b_ready' || ':%'), 2,
  'two for the one who pressed it at 15:20: the warning and the +15 reminder, nothing after');

-- ---------------------------------------------------------------------
-- 4. A first warning that came late
-- ---------------------------------------------------------------------
-- Confirmed at 15:00 as well, but nothing ran for it until 15:50.
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at, day_before_confirmed_at) values
  (:'b_first', :'tmrw', '93a00000-0000-4000-8000-000000000001', 'confirmed', 'auto',
   '2027-02-11 15:00+00', null);

select is((late_ready_tick('2027-02-11 15:50+00')), '{"lateN6": 1, "lateReminders": 0}'::jsonb,
  'a first warning at +50 minutes is still a first warning (counted so), but worded as a reminder, not as "you have 1 hour"');
select is((select array[payload->>'variant', payload->>'minutes'] from notification_outbox
            where key = late_ready_step_key(:'b_first', timestamptz '2027-02-12 17:00+00', timestamptz '2027-02-11 15:00+00', 3)),
  array['late-reminder', '10 minutes'], 'saying 10 minutes are left, from now');
select is(late_ready_told(:'b_first', timestamptz '2027-02-12 17:00+00', timestamptz '2027-02-11 15:00+00'), true,
  'which makes them told');
select is((late_ready_tick('2027-02-11 15:59+00')), '{"lateN6": 0, "lateReminders": 0}'::jsonb,
  'and the next tick does not send that quarter-hour''s reminder on top of it');

-- Reached by nothing at all: confirmed 15:00, first seen after the last tick.
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at, day_before_confirmed_at) values
  (:'b_never', :'tmrw', '93a00000-0000-4000-8000-000000000002', 'confirmed', 'auto',
   '2027-02-11 15:00+00', null);

select is(late_ready_told(:'b_never', timestamptz '2027-02-12 17:00+00', timestamptz '2027-02-11 15:00+00'), false,
  'a booking nobody has pushed is not told');

-- ---------------------------------------------------------------------
-- 5. The hour is up
-- ---------------------------------------------------------------------
select is((late_ready_tick('2027-02-11 16:00+00')), '{"lateN6": 0, "lateReminders": 0}'::jsonb,
  'at the hour no more reminders go');

select is(release_late_unready_bookings('2027-02-11 15:59+00'), 0,
  'a minute before the hour nobody is released');
select is(release_late_unready_bookings('2027-02-11 16:00+00'), 2,
  'at the hour two are released: the one reached by every reminder and the one reached by only the late one');
select is((select array_agg(status::text order by id) from bookings where id in (:'b_a', :'b_first')),
  array['cancelled', 'cancelled'], 'both cancelled, so the seats are gaps for auto-assign');
select is((select array_agg(status::text order by id) from bookings where id in (:'b_ready', :'b_never')),
  array['confirmed', 'confirmed'],
  'the worker who pressed it keeps the shift, and so does the one nobody reached');
select is((select count(*)::int from notification_outbox
            where template = 'N6b' and (payload->>'variant') = 'late'), 2,
  'each released worker is told with N6b in the hour''s words');
select is(release_late_unready_bookings('2027-02-11 16:30+00'), 0, 'a second run releases nobody');

select * from finish();
rollback;
