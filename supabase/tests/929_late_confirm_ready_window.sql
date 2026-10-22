-- =====================================================================
-- 929 · A worker who confirms after the noon deadline has one hour to press
--       "I'm ready" (§3.5, ADR-0196)
--   20261024110000_late_confirm_ready_window.sql
--
-- Held here:
--   * the rule: confirmed from the deadline to the end of the UK day before
--     the shift is on the hour's clock; before it, on the day, or with no
--     confirmed_at is not; the hour is capped at the start;
--   * late_ready_tick() warns each such booking once, with the late N6 and
--     the time the hour ends;
--   * release_late_unready_bookings() releases it when the hour is up — and
--     not before, not twice, not a worker who pressed it, not one who was
--     never warned, not one on the on-time clock, not a same-day booking,
--     never into a start the hour outlasts;
--   * the release is a cancel with cause ready_cutoff and an N6b whose copy
--     speaks of the hour (variant late);
--   * mark_ready() accepts a late confirmer's press inside their hour;
--   * both jobs are the service role's alone.
-- February, so UK time is UTC and the instants read plainly. Almas's case:
-- confirmed 15:00 the day before a 17:00 start, hour up at 16:00.
-- =====================================================================
begin;
select plan(30);
\ir _shared/fixtures.psql

update shift_requirements set starts_at = timestamptz '2027-06-01 10:00+00',
                              ends_at   = timestamptz '2027-06-01 18:00+00';

\set evt     '92900000-0000-4000-8000-00000000000e'
\set tmrw    '92900000-0000-4000-8000-0000000000a1'
\set early   '92900000-0000-4000-8000-0000000000a2'
\set s_ahead '92900000-0000-4000-8000-0000000000a3'
\set b_late     '92900000-0000-4000-8000-000000000001'
\set b_pressed  '92900000-0000-4000-8000-000000000002'
\set b_ontime   '92900000-0000-4000-8000-000000000003'
\set b_sameday  '92900000-0000-4000-8000-000000000004'
\set b_unwarned '92900000-0000-4000-8000-000000000005'
\set b_cap      '92900000-0000-4000-8000-000000000006'
\set b_now      '92900000-0000-4000-8000-000000000007'

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'evt', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Late Confirm Dinner', date '2027-02-12', true, true);

-- `tmrw` starts 17:00 on the 12th: deadline 12:00 on the 11th.
-- `early` starts 00:30 on the 12th: an hour that outlasts it.
-- `s_ahead` is three days from now, for mark_ready(), which reads now().
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'tmrw',    :'evt', :'role_id', '2027-02-12 17:00+00', '2027-02-12 23:00+00', 9, 0, 30, 15, 1),
  (:'early',   :'evt', :'role_id', '2027-02-12 00:30+00', '2027-02-12 05:00+00', 9, 0, 30, 15, 1),
  (:'s_ahead', :'evt', :'role_id', now() + interval '3 days', now() + interval '3 days 4 hours', 9, 0, 30, 15, 1);

insert into staff (id, first_name, last_name, email, phone, dob, status) values
  ('92a00000-0000-4000-8000-000000000001', 'Late', 'One',   'l1@late.test', '+447700929931', date '1995-01-01', 'compliant'),
  ('92a00000-0000-4000-8000-000000000002', 'Late', 'Two',   'l2@late.test', '+447700929932', date '1995-01-01', 'compliant'),
  ('92a00000-0000-4000-8000-000000000003', 'Late', 'Three', 'l3@late.test', '+447700929933', date '1995-01-01', 'compliant'),
  ('92a00000-0000-4000-8000-000000000004', 'Late', 'Four',  'l4@late.test', '+447700929934', date '1995-01-01', 'compliant');

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at, day_before_confirmed_at) values
  -- Almas: confirmed at 15:00 the day before, never pressed it
  (:'b_late',    :'tmrw', :'staffa', 'confirmed', 'auto', '2027-02-11 15:00+00', null),
  -- confirmed at the same time and pressed it
  (:'b_pressed', :'tmrw', :'staffb', 'confirmed', 'auto', '2027-02-11 15:00+00', '2027-02-11 15:20+00'),
  -- confirmed days ago: the noon clock, whose release is release_unready_bookings()
  (:'b_ontime',  :'tmrw', '92a00000-0000-4000-8000-000000000001', 'confirmed', 'auto', '2027-02-01 10:00+00', null),
  -- confirmed on the morning of the shift (RULE-08)
  (:'b_sameday', :'tmrw', '92a00000-0000-4000-8000-000000000002', 'confirmed', 'auto', '2027-02-12 08:00+00', null);

-- ---------------------------------------------------------------------
-- 1. The rule
-- ---------------------------------------------------------------------
select is(late_ready_applies('2027-02-11 11:59+00', '2027-02-12 17:00+00'), false,
  'confirmed at 11:59, before the deadline: the noon clock, not the hour');
select is(late_ready_applies('2027-02-11 12:00+00', '2027-02-12 17:00+00'), true,
  'confirmed at 12:00, the deadline itself: the hour');
select is(late_ready_applies('2027-02-11 23:59+00', '2027-02-12 17:00+00'), true,
  'confirmed at 23:59, still the day before: the hour');
select is(late_ready_applies('2027-02-12 00:00+00', '2027-02-12 17:00+00'), false,
  'confirmed on the day of the shift: neither clock (RULE-08)');
select is(late_ready_applies(null, '2027-02-12 17:00+00'), false,
  'no confirmed_at: neither clock');
select is(late_ready_due_at('2027-02-11 15:00+00', '2027-02-12 17:00+00'),
  timestamptz '2027-02-11 16:00+00', 'the hour ends one hour after confirming');
select is(late_ready_due_at('2027-02-11 23:50+00', '2027-02-12 00:30+00'),
  timestamptz '2027-02-12 00:30+00', 'and never after the start');
select is(ready_due_at('2027-02-01 10:00+00', '2027-02-12 17:00+00'),
  timestamptz '2027-02-11 12:00+00', 'mark_ready()''s deadline for an on-time booking is noon the day before');
select is(ready_due_at('2027-02-11 15:00+00', '2027-02-12 17:00+00'),
  timestamptz '2027-02-11 16:00+00', 'and for a late confirmer, the hour');

-- ---------------------------------------------------------------------
-- 2. Only the service role runs the jobs
-- ---------------------------------------------------------------------
select ok(has_function_privilege('service_role', 'public.late_ready_tick(timestamptz)', 'execute'),
  'the booking-tick job can call late_ready_tick()');
select ok(has_function_privilege('service_role', 'public.release_late_unready_bookings(timestamptz)', 'execute'),
  'the cutoff job can call release_late_unready_bookings()');
select ok(not has_function_privilege('authenticated', 'public.late_ready_tick(timestamptz)', 'execute')
      and not has_function_privilege('authenticated', 'public.release_late_unready_bookings(timestamptz)', 'execute'),
  'a signed-in worker can call neither');

-- ---------------------------------------------------------------------
-- 3. The warning
-- ---------------------------------------------------------------------
select is((late_ready_tick('2027-02-11 15:10+00'))->>'lateN6', '1',
  'ten minutes after Almas confirms, exactly one worker is warned');
select is((select count(*)::int from notification_outbox
            where key = late_ready_key(:'b_late', timestamptz '2027-02-12 17:00+00',
                                       timestamptz '2027-02-11 15:00+00')
              and template = 'N6' and recipient_staff_id = :'staffa'), 1,
  'a late N6 for the booking, keyed on the confirmation');
select is((select array[payload->>'variant', payload->>'dueBy'] from notification_outbox
            where key = late_ready_key(:'b_late', timestamptz '2027-02-12 17:00+00',
                                       timestamptz '2027-02-11 15:00+00')),
  array['late', '16:00'], 'saying when the hour ends, in UK time');
select is((select count(*)::int from notification_outbox
            where key like 'N6:booking:' || :'b_pressed' || ':%'
               or key like 'N6:booking:' || :'b_ontime'  || ':%'
               or key like 'N6:booking:' || :'b_sameday' || ':%'), 0,
  'nobody else: not the worker who pressed it, the on-time one or the same-day one');
select is((late_ready_tick('2027-02-11 15:11+00'))->>'lateN6', '0',
  'a second tick warns nobody again');

-- A booking nobody warned: confirmed after the tick above, so no late N6.
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at, day_before_confirmed_at) values
  (:'b_unwarned', :'tmrw', '92a00000-0000-4000-8000-000000000003', 'confirmed', 'auto',
   '2027-02-11 15:00+00', null);

-- ---------------------------------------------------------------------
-- 4. The release
-- ---------------------------------------------------------------------
select is(release_late_unready_bookings('2027-02-11 15:59+00'), 0,
  'at 15:59 the hour is not up: nobody is released');
select is(release_late_unready_bookings('2027-02-11 16:00+00'), 1,
  'at 16:00 exactly one booking is released');
select is((select array[status::text, cancel_cause] from bookings where id = :'b_late'),
  array['cancelled', 'ready_cutoff'],
  'Almas: cancelled, as the 12:05 release does, so the slot is a gap and auto-assign refills it');
select is((select array[count(*)::text, min(payload->>'variant')] from notification_outbox
            where key = 'N6b:booking:' || :'b_late'),
  array['1', 'late'], 'and told so with N6b, once, in the hour''s words');
select is((select count(*)::int from bookings
            where id in (:'b_pressed', :'b_ontime', :'b_sameday', :'b_unwarned')
              and status = 'confirmed'), 4,
  'the worker who pressed it, the on-time and same-day bookings and the one never warned all keep the shift');
select is((select count(*)::int from notification_outbox
            where template = 'N6b' and key <> 'N6b:booking:' || :'b_late'), 0,
  'N6b only for the row released');
select is(release_late_unready_bookings('2027-02-11 16:30+00'), 0,
  'a second run releases nobody');
select is((select count(*)::int from notification_outbox where key = 'N6b:booking:' || :'b_late'), 1,
  'and N6b is still one row');

-- ---------------------------------------------------------------------
-- 5. An hour the shift outlasts releases nobody
-- ---------------------------------------------------------------------
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at, day_before_confirmed_at) values
  (:'b_cap', :'early', '92a00000-0000-4000-8000-000000000004', 'confirmed', 'auto',
   '2027-02-11 23:50+00', null);

select is((late_ready_tick('2027-02-11 23:55+00'))->>'lateN6', '1',
  'a worker who confirms at 23:50 for a 00:30 start is warned');
select is(release_late_unready_bookings('2027-02-12 00:30+00'), 0,
  'but once the shift has started nobody is released into it');
select is((select status::text from bookings where id = :'b_cap'), 'confirmed',
  'they keep the shift (check-in, not the cutoff, takes it from here)');

-- ---------------------------------------------------------------------
-- 6. mark_ready() inside the hour
-- ---------------------------------------------------------------------
-- The shift is three days away, so its noon deadline is two days off and a
-- real late confirmation cannot be built from now(); placing confirmed_at a
-- minute after the deadline puts the booking on the hour's clock, and the
-- hour (confirmed_at + 1 h) is ahead of now().
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at, day_before_confirmed_at)
select :'b_now', :'s_ahead', :'staffa', 'confirmed', 'auto',
       ready_deadline(starts_at) + interval '1 minute', null
  from shift_requirements where id = :'s_ahead';

set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
set local role authenticated;

select is(mark_ready(:'b_now'), '{"ok": true}'::jsonb,
  'a late confirmer''s "I''m ready" is accepted inside their hour');

reset role;

select isnt((select day_before_confirmed_at from bookings where id = :'b_now'), null,
  'and recorded, so neither release can take them');

select * from finish();
rollback;
