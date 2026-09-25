-- =====================================================================
-- 592 · E10, the office email for a self-cancel (§9.12, RULE-04)
--   20260927140200_self_cancel_office_email.sql
--
-- docs/15 §3: "Self-cancel email to admin@ (§9.12) has no code and no
-- sender." Held here:
--   * a worker's own self-cancel queues exactly one E10, to admin@, keyed
--     on the booking — even though the worker holds no write on the outbox;
--   * it names the event, role and shift, and the section's fill after
--     the cancel, with the payload keys packages/notifications renders;
--   * a refused self-cancel (too late, not theirs, already cancelled)
--     queues nothing, and a repeat does not send twice;
--   * nobody can queue it directly.
-- =====================================================================
begin;
select plan(17);
\ir _shared/fixtures.psql

\set evt   '59600000-0000-4000-8000-00000000000e'
\set sec1  '59600000-0000-4000-8000-0000000000a1'
\set sec2  '59600000-0000-4000-8000-0000000000a2'
\set sec3  '59600000-0000-4000-8000-0000000000a3'
\set b1    '59700000-0000-4000-8000-000000000001'
\set b2    '59700000-0000-4000-8000-000000000002'
\set b3    '59700000-0000-4000-8000-000000000003'
\set b4    '59700000-0000-4000-8000-000000000004'

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer, auto_assign) values
  (:'evt', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Winter Gala', date '2027-02-12', true, true, true);

-- February, so UK time is UTC and the expected strings read plainly.
-- sec2 has its role-level auto-assign switched off (§3.4); sec3 starts in
-- two days, inside RULE-04's 72 hours.
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour, auto_assign) values
  (:'sec1', :'evt', :'role_id', '2027-02-12 17:00+00', '2027-02-12 23:00+00', 2, 1, 30, 15, 3, true),
  (:'sec2', :'evt', :'role_id', '2027-02-12 08:00+00', '2027-02-12 12:00+00', 1, 0, 30, 15, 1, false),
  (:'sec3', :'evt', :'role_id', now() + interval '48 hours', now() + interval '54 hours', 1, 0, 30, 15, 1, true);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b1', :'sec1', :'staffa', 'confirmed', 'auto', now()),
  (:'b2', :'sec1', :'staffb', 'confirmed', 'auto', now()),
  (:'b3', :'sec2', :'staffa', 'confirmed', 'auto', now()),
  (:'b4', :'sec3', :'staffa', 'confirmed', 'auto', now());

-- ---------------------------------------------------------------------
-- 1. The worker cancels, from the app
-- ---------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
set local role authenticated;

select is(self_cancel_booking(:'b1')->>'ok', 'true',
  'RULE-04: the worker self-cancels a confirmed booking more than 72 hours out');
select is(self_cancel_booking(:'b1')->>'reason', 'not_confirmed',
  'pressing it again is refused — the booking is already cancelled');
select is(self_cancel_booking(:'b4')->>'reason', 'too_late',
  'inside 72 hours the worker must call the office instead');
select throws_ok(format('select self_cancel_booking(%L)', :'b2'), '42501', 'not_your_booking',
  'and nobody can self-cancel somebody else''s booking');
select is(self_cancel_booking(:'b3')->>'ok', 'true',
  'a second self-cancel, on the section whose auto-assign is off');

select throws_ok(format('select queue_self_cancel_email(%L, now())', :'b2'), '42501', null,
  'a signed-in worker cannot queue the office email directly');

reset role;

-- ---------------------------------------------------------------------
-- 2. What the office receives
-- ---------------------------------------------------------------------
select is((select count(*)::int from notification_outbox where key = 'E10:booking:' || :'b1'), 1,
  'one E10 for the self-cancel, keyed on the booking, though the worker pressed twice');
select is(
  (select array[channel::text, template] from notification_outbox where key = 'E10:booking:' || :'b1'),
  array['email', 'E10'], 'an email on the E10 template');
select is(
  (select recipient_emails from notification_outbox where key = 'E10:booking:' || :'b1'),
  array['admin@thehospitalitycompany.co.uk'], 'to admin@ (§9.12)');

-- The keys packages/notifications/src/__tests__/templates.test.ts holds the
-- E10 copy to. The three ids are for the office's own tooling, not the copy.
select is(
  (select array_agg(k order by k)
     from notification_outbox, jsonb_object_keys(payload) k
    where key = 'E10:booking:' || :'b1' and k not in ('bookingId', 'shiftId', 'eventId')),
  array['autoAssign', 'buffer', 'cancelledAt', 'client', 'confirmed', 'date', 'dateTime',
        'employeeId', 'event', 'headcount', 'name', 'role', 'venue'],
  'the payload carries exactly the values the E10 copy asks for');

select is(
  (select array[payload->>'event', payload->>'role', payload->>'dateTime', payload->>'venue',
                payload->>'client', payload->>'date']
     from notification_outbox where key = 'E10:booking:' || :'b1'),
  array['Winter Gala', 'RLS Fixture Role', 'Fri 12 Feb 2027 17:00–23:00', 'RLS Fixture Venue',
        'RLS Fixture Client A', 'Fri 12 Feb 2027'],
  'it names the event, the role and the role section''s own shift, in UK time');
select is(
  (select array[payload->>'name', payload->>'employeeId'] from notification_outbox
    where key = 'E10:booking:' || :'b1'),
  array['Staff Alpha', '90001'], 'and who cancelled');
select is(
  (select array[payload->>'confirmed', payload->>'headcount', payload->>'buffer', payload->>'autoAssign']
     from notification_outbox where key = 'E10:booking:' || :'b1'),
  array['1', '2', '1', 'on'],
  'and the fill AFTER the cancel — 1 confirmed of 2 (+1) — with auto-assign on to backfill it');
select is(
  (select payload->>'autoAssign' from notification_outbox where key = 'E10:booking:' || :'b3'),
  'off — this slot will only be filled by hand',
  'where the role''s auto-assign is off, the email says nobody but the office will fill it');

select ok(not exists (select 1 from notification_outbox
                       where key in ('E10:booking:' || :'b2', 'E10:booking:' || :'b4')),
  'a refused self-cancel sends the office nothing');

select is((select count(*)::int from notification_outbox
            where template = 'E10' and payload->>'shiftId' in (:'sec1', :'sec2', :'sec3')), 2,
  'two self-cancels, two emails');

select ok(not has_function_privilege('anon', 'public.queue_self_cancel_email(uuid, timestamptz)', 'execute'),
  'anon cannot queue it either');

select * from finish();
rollback;
