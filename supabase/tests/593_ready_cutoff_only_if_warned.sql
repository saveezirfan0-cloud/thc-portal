-- =====================================================================
-- 593 · The 12:05 cutoff releases only a worker who had the chance (§3.5)
--   20260927140300_ready_cutoff_only_if_warned.sql
--
-- Held here:
--   * the ordinary case — confirmed days ago, not ready — is released at
--     12:05 the day before, with N6b exactly once;
--   * a booking accepted after 12:00 the day before is not released, then
--     or on the next day's run;
--   * a same-day booking (RULE-08) is not released, and neither is any
--     shift starting today, whenever it was confirmed;
--   * a NULL confirmed_at is not released;
--   * N6 goes only to bookings the cutoff can release.
-- February, so UK time is UTC and the instants read plainly.
-- =====================================================================
begin;
select plan(18);
\ir _shared/fixtures.psql

update shift_requirements set starts_at = timestamptz '2027-06-01 10:00+00',
                              ends_at   = timestamptz '2027-06-01 18:00+00';

\set evt    '59800000-0000-4000-8000-00000000000e'
\set tmrw   '59800000-0000-4000-8000-0000000000a1'
\set today  '59800000-0000-4000-8000-0000000000a2'
\set b_ok     '59900000-0000-4000-8000-000000000001'
\set b_ready  '59900000-0000-4000-8000-000000000002'
\set b_after  '59900000-0000-4000-8000-000000000003'
\set b_null   '59900000-0000-4000-8000-000000000004'
\set b_same   '59900000-0000-4000-8000-000000000005'
\set b_old    '59900000-0000-4000-8000-000000000006'

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'evt', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Cutoff Dinner', date '2027-02-11', true, true);

-- `tmrw` starts the day after the 12:05 run below; `today` the same day.
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'tmrw',  :'evt', :'role_id', '2027-02-12 17:00+00', '2027-02-12 23:00+00', 9, 0, 30, 15, 1),
  (:'today', :'evt', :'role_id', '2027-02-11 18:00+00', '2027-02-11 23:00+00', 9, 0, 30, 15, 1);

insert into staff (id, first_name, last_name, email, phone, dob, status) values
  ('59a00000-0000-4000-8000-000000000001', 'Cut', 'One',   'c1@cut.test', '+447700905931', date '1995-01-01', 'compliant'),
  ('59a00000-0000-4000-8000-000000000002', 'Cut', 'Two',   'c2@cut.test', '+447700905932', date '1995-01-01', 'compliant'),
  ('59a00000-0000-4000-8000-000000000003', 'Cut', 'Three', 'c3@cut.test', '+447700905933', date '1995-01-01', 'compliant');

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at, day_before_confirmed_at) values
  -- tomorrow's section
  (:'b_ok',    :'tmrw',  :'staffa', 'confirmed', 'auto',   '2027-02-01 10:00+00', null),
  (:'b_ready', :'tmrw',  :'staffb', 'confirmed', 'auto',   '2027-02-01 10:00+00', '2027-02-11 09:00+00'),
  (:'b_after', :'tmrw',  '59a00000-0000-4000-8000-000000000001', 'confirmed', 'auto', '2027-02-11 12:00+00', null),
  (:'b_null',  :'tmrw',  '59a00000-0000-4000-8000-000000000002', 'confirmed', 'manual', null, null),
  -- today's section: one booked this morning (RULE-08), one booked weeks ago
  (:'b_same',  :'today', :'staffa', 'confirmed', 'auto',   '2027-02-11 09:30+00', null),
  (:'b_old',   :'today', '59a00000-0000-4000-8000-000000000003', 'confirmed', 'auto', '2027-01-20 10:00+00', null);

-- ---------------------------------------------------------------------
-- 1. The rule
-- ---------------------------------------------------------------------
select is(ready_cutoff_applies('2027-02-11 11:59+00', '2027-02-12 17:00+00'), true,
  'confirmed at 11:59 the day before: subject to the noon deadline');
select is(ready_cutoff_applies('2027-02-11 12:00+00', '2027-02-12 17:00+00'), false,
  'confirmed at 12:00: the deadline had already come, so it does not apply');
select is(ready_cutoff_applies(null, '2027-02-12 17:00+00'), false,
  'no confirmed_at: not subject — the system cannot show the worker was ever warned');

-- ---------------------------------------------------------------------
-- 2. N6 goes only where the cutoff can act
-- ---------------------------------------------------------------------
select is((booking_tick('2027-02-11 08:30+00'))->>'n6', '1',
  'N6 at 08:30 the day before reaches one booking');
select ok(exists (select 1 from notification_outbox where key = 'N6:booking:' || :'b_ok'),
  'the ordinary one');
select ok(not exists (select 1 from notification_outbox where key = 'N6:booking:' || :'b_null'),
  'not the booking with no confirmed_at, which the cutoff will not release');

-- ---------------------------------------------------------------------
-- 3. The 12:05 run on the day before
-- ---------------------------------------------------------------------
select is(release_unready_bookings('2027-02-11 12:05+00'), 1,
  'the 12:05 run releases exactly one booking');

select is((select array[status::text, cancel_cause] from bookings where id = :'b_ok'),
  array['cancelled', 'ready_cutoff'],
  'normal case: confirmed days ago, never pressed "I''m ready" — released');
select is((select count(*)::int from notification_outbox where key = 'N6b:booking:' || :'b_ok'), 1,
  'and told so with N6b');

select is((select status::text from bookings where id = :'b_ready'), 'confirmed',
  'the worker who pressed "I''m ready" keeps the shift');
select is((select status::text from bookings where id = :'b_after'), 'confirmed',
  'accepted at 12:00 the day before — after the deadline — not released');
select is((select status::text from bookings where id = :'b_null'), 'confirmed',
  'no confirmed_at — not released');
select is((select status::text from bookings where id = :'b_same'), 'confirmed',
  'same-day booking (RULE-08) — not released');
select is((select status::text from bookings where id = :'b_old'), 'confirmed',
  'and nothing starting today is released, even a booking confirmed weeks ago');

select ok(not exists (select 1 from notification_outbox
                       where template = 'N6b'
                         and key in ('N6b:booking:' || :'b_after', 'N6b:booking:' || :'b_null',
                                     'N6b:booking:' || :'b_same', 'N6b:booking:' || :'b_old')),
  'N6b only for the row actually released');

-- ---------------------------------------------------------------------
-- 4. Re-runs, and the next day's run
-- ---------------------------------------------------------------------
select is(release_unready_bookings('2027-02-11 12:10+00'), 0,
  'a second run releases nobody');
select is(release_unready_bookings('2027-02-12 12:05+00'), 0,
  'the next day''s 12:05 run — the day of the shift — does not reach the late acceptance');
select is((select count(*)::int from notification_outbox where key = 'N6b:booking:' || :'b_ok'), 1,
  'N6b is still one row');

select * from finish();
rollback;
