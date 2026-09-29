-- =====================================================================
-- 762 · Message one person (ADR-0069, amended 29.09.2026)
--   20261002102000_message_one_person.sql
--
--   1. p_booking sends to that one worker only, linked to that booking.
--   2. An invitee named on purpose is messaged whatever the audience says.
--   3. Refusals: a booking on another event, one outside the named
--      section, one no longer live. None of them queues anything.
--   4. Without p_booking nothing changed: the four-argument call still
--      messages the audience.
-- =====================================================================
begin;
select plan(12);
\ir _shared/fixtures.psql

\set ev  '76200000-0000-4000-8000-000000000001'
\set ev2 '76200000-0000-4000-8000-000000000002'
\set s1  '76210000-0000-4000-8000-000000000001'
\set s2  '76210000-0000-4000-8000-000000000002'
\set s3  '76210000-0000-4000-8000-000000000003'
\set b1  '76220000-0000-4000-8000-000000000001'
\set b2  '76220000-0000-4000-8000-000000000002'
\set b3  '76220000-0000-4000-8000-000000000003'
\set b4  '76220000-0000-4000-8000-000000000004'
\set bx  '76220000-0000-4000-8000-000000000005'
\set w1  '76230000-0000-4000-8000-000000000001'
\set w2  '76230000-0000-4000-8000-000000000002'
\set w3  '76230000-0000-4000-8000-000000000003'
\set w4  '76230000-0000-4000-8000-000000000004'

insert into staff (id, first_name, last_name, email, phone, dob, status) values
  (:'w1', 'Wait', 'One',   'w1@om762.test', '+447700962001', date '1995-01-01', 'compliant'),
  (:'w2', 'Wait', 'Two',   'w2@om762.test', '+447700962002', date '1995-01-01', 'compliant'),
  (:'w3', 'Host', 'Three', 'w3@om762.test', '+447700962003', date '1995-01-01', 'compliant'),
  (:'w4', 'In',   'Vited', 'w4@om762.test', '+447700962004', date '1995-01-01', 'compliant');

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, auto_assign) values
  (:'ev',  :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Awards Night', current_date + 1, true, true, true),
  (:'ev2', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Other Night', current_date + 2, true, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour, auto_assign) values
  (:'s1', :'ev',  :'role_id', now() + interval '1 day',  now() + interval '1 day 6 hours', 5, 0, 20, 12, 5, true),
  (:'s2', :'ev',  :'role_id', now() + interval '1 day 1 hour', now() + interval '1 day 7 hours', 5, 0, 20, 12, 5, true),
  (:'s3', :'ev2', :'role_id', now() + interval '2 days', now() + interval '2 days 6 hours', 5, 0, 20, 12, 5, true);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at, cancelled_at, cancel_cause) values
  (:'b1', :'s1', :'w1', 'confirmed', 'auto', now(), null, null),
  (:'b2', :'s1', :'w2', 'confirmed', 'auto', now(), null, null),
  (:'b3', :'s2', :'w3', 'confirmed', 'auto', now(), null, null),
  (:'b4', :'s1', :'w4', 'invited',   'auto', null,  null, null),
  (:'bx', :'s3', :'w1', 'confirmed', 'auto', now(), null, null);

select ok(not has_function_privilege('anon', 'public.send_event_message(uuid, uuid, text, text, uuid)', 'execute'),
  'anon cannot execute the five-argument send_event_message');
select is((select count(*)::int from pg_proc where proname = 'send_event_message'), 1,
  'exactly one send_event_message: the four-argument one was dropped, not overloaded');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

-- 1 · One person.
select is(send_event_message(:'ev', null, 'booked', 'Please bring your black apron', :'b2') - 'messageId',
  jsonb_build_object('ok', true, 'sent', 1, 'withoutPush', jsonb_build_array('Wait Two')),
  'naming one booking sends to that one worker');
select results_eq(
  $$ select recipient_staff_id::text, payload ->> 'bookingId' from notification_outbox where template = 'OM1' $$,
  $$ values ('76230000-0000-4000-8000-000000000002', '76220000-0000-4000-8000-000000000002') $$,
  'only Wait Two, deep-linked to that booking — not the other waiter on the same role');

-- 2 · An invitee named on purpose, with the default audience.
select is((send_event_message(:'ev', :'s1', 'booked', 'Can you still make it?', :'b4') ->> 'sent')::int, 1,
  'an invitee named on purpose is messaged even though the audience is "booked"');

-- 3 · Refusals.
select is(send_event_message(:'ev', null, 'booked', 'x', :'bx'),
  jsonb_build_object('ok', false, 'reason', 'booking_not_on_event'), 'a booking on another event is refused');
select is(send_event_message(:'ev', :'s2', 'booked', 'x', :'b1'),
  jsonb_build_object('ok', false, 'reason', 'booking_not_on_event'), 'so is one outside the section also named');
reset role;
update bookings set status = 'cancelled', cancelled_at = now(), cancel_cause = 'office_withdraw' where id = :'b1';
set local role authenticated;
select is(send_event_message(:'ev', null, 'booked', 'x', :'b1'),
  jsonb_build_object('ok', false, 'reason', 'person_not_booked'), 'a withdrawn booking is refused');
select is((select count(*)::int from notification_outbox where template = 'OM1'), 2,
  'and none of the refusals queued anything');

-- 4 · Unchanged without p_booking.
select is((send_event_message(:'ev', :'s1', 'booked', 'Everyone on the role') ->> 'sent')::int, 1,
  'the four-argument call still messages the audience (w2; w1 was withdrawn)');
select is((select data ->> 'audience' from audit_log
            where action = 'event.message_sent' and data ->> 'booking' = :'b2'), 'person',
  'a one-person send is recorded as audience "person" with its booking');
select is((select count(*)::int from audit_log where action = 'event.message_sent' and entity_id = :'ev'), 3,
  'three sends, three history rows');

select * from finish();
rollback;
