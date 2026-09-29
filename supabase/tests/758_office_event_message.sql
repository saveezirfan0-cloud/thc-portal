-- =====================================================================
-- 758 · Message the line-up (ADR-0069)
--   20261001209000_office_event_message.sql
--
--   1. Admin only — not anon, not a worker, not the client, not a
--      read-only viewer (ADR-0060).
--   2. Refusals: unknown audience, blank, over 300 characters, unknown section, cancelled
--      event, an event that is over, nobody to message. None of them
--      queues anything.
--   3. Recipients come from the bookings, by audience: booked (confirmed
--      and worked), invited only, or both; never applied, closed or
--      cancelled. One push per
--      worker even across two sections, deep-linked to their first one.
--   4. The payload is the values map OM1 asks for, and the text is kept
--      as typed (trimmed). Two sends are two messages.
--   5. The answer names the recipients with no push subscription.
-- =====================================================================
begin;
select plan(33);
\ir _shared/fixtures.psql

\set ev  '75800000-0000-4000-8000-000000000001'
\set evx '75800000-0000-4000-8000-000000000002'
\set evp '75800000-0000-4000-8000-000000000003'
\set sp  '75810000-0000-4000-8000-000000000004'
\set bp  '75820000-0000-4000-8000-000000000008'
\set viewer '75840000-0000-4000-8000-000000000001'
\set s1  '75810000-0000-4000-8000-000000000001'
\set s2  '75810000-0000-4000-8000-000000000002'
\set sx  '75810000-0000-4000-8000-000000000003'
\set b1a '75820000-0000-4000-8000-000000000001'
\set b1b '75820000-0000-4000-8000-000000000002'
\set b2  '75820000-0000-4000-8000-000000000003'
\set b3  '75820000-0000-4000-8000-000000000004'
\set b4  '75820000-0000-4000-8000-000000000005'
\set b5  '75820000-0000-4000-8000-000000000006'
\set w1  '75830000-0000-4000-8000-000000000001'
\set w2  '75830000-0000-4000-8000-000000000002'
\set w3  '75830000-0000-4000-8000-000000000003'
\set w4  '75830000-0000-4000-8000-000000000004'
\set w5  '75830000-0000-4000-8000-000000000005'

insert into staff (id, first_name, last_name, email, phone, dob, status) values
  (:'w1', 'Two',  'Sections', 'w1@om758.test', '+447700957001', date '1995-01-01', 'compliant'),
  (:'w2', 'Chec', 'Kedin',    'w2@om758.test', '+447700957002', date '1995-01-01', 'compliant'),
  (:'w3', 'In',   'Vited',    'w3@om758.test', '+447700957003', date '1995-01-01', 'compliant'),
  (:'w4', 'Ap',   'Plied',    'w4@om758.test', '+447700957004', date '1995-01-01', 'compliant'),
  (:'w5', 'Clo',  'Sed',      'w5@om758.test', '+447700957005', date '1995-01-01', 'compliant');

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, auto_assign, cancelled_at, cancel_reason) values
  (:'ev',  :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Summer Gala', date '2026-10-03',
   true, true, true, null, null),
  (:'evx', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Called Off', current_date + 5,
   true, true, false, now(), 'Client cancelled'),
  (:'evp', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Last Week', current_date - 7,
   true, true, false, null, null);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour, auto_assign) values
  (:'s1', :'ev',  :'role_id', now() + interval '1 hour',  now() + interval '7 hours',  5, 1, 20, 12, 5, true),
  (:'s2', :'ev',  :'role_id', now() + interval '3 hours', now() + interval '9 hours',  5, 1, 20, 12, 5, true),
  (:'sx', :'evx', :'role_id', now() + interval '5 days',  now() + interval '5 days 6 hours', 5, 0, 20, 12, 5, false),
  (:'sp', :'evp', :'role_id', now() - interval '7 days',  now() - interval '7 days' + interval '6 hours', 5, 0, 20, 12, 5, false);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at, applied_at, cancelled_at, cancel_cause) values
  (:'b1a', :'s1', :'w1', 'confirmed', 'auto', now(), null, null, null),
  (:'b1b', :'s2', :'w1', 'confirmed', 'auto', now(), null, null, null),
  (:'b2',  :'s1', :'w2', 'worked',    'auto', now(), null, null, null),
  (:'b3',  :'s2', :'w3', 'invited',   'auto', null,  null, null, null),
  (:'b4',  :'s2', :'w4', 'applied',   'self', null,  now(), null, null),
  (:'b5',  :'s2', :'w5', 'closed',    'auto', null,  null, now(), 'declined'),
  (:'bp',  :'sp', :'w5', 'worked',    'auto', now() - interval '8 days', null, null, null);

-- A read-only Back Office login (ADR-0060).
insert into auth.users (id, email) values (:'viewer', 'viewer.758@rls.test');
insert into profiles (id, role, office_role, full_name) values (:'viewer', 'admin', 'viewer', 'Vera Viewer');

-- Only w1 has notifications on.
insert into push_subscriptions (staff_id, endpoint, p256dh, auth) values
  (:'w1', 'https://push.example.test/om758-w1', 'p256dh', 'auth');

-- ---------------------------------------------------------------------
-- 1 · Who may call it
-- ---------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.send_event_message(uuid, uuid, text, text, uuid)', 'execute'),
  'anon cannot execute send_event_message');
select hasnt_function('public', 'send_event_message', array['uuid', 'uuid', 'boolean', 'text'],
  'the old "also invited" switch is gone (20261001211000)');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select send_event_message(%L, null, 'booked', 'hi') $$, :'ev'), '42501', 'not_authorised',
  'a worker cannot message a line-up');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select send_event_message(%L, null, 'booked', 'hi') $$, :'ev'), '42501', 'not_authorised',
  'nor can the client whose event it is');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select send_event_message(%L, null, 'booked', 'hi') $$, :'ev'), '42501', 'read_only',
  'nor can a view-only Back Office login (ADR-0060)');
reset role;

-- ---------------------------------------------------------------------
-- 2 · Refusals
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(send_event_message(:'ev', null, 'everybody', 'hi'),
  jsonb_build_object('ok', false, 'reason', 'audience_unknown'), 'an unknown audience is refused');
select is(send_event_message(:'ev', null, 'booked', '   '),
  jsonb_build_object('ok', false, 'reason', 'message_required'), 'a blank message is refused');
select is(send_event_message(:'ev', null, 'booked', repeat('x', 301)),
  jsonb_build_object('ok', false, 'reason', 'message_too_long'), 'over 300 characters is refused');
select is(send_event_message(:'ev', :'sx', 'booked', 'hi'),
  jsonb_build_object('ok', false, 'reason', 'section_not_on_event'), 'a section from another event is refused');
select is(send_event_message(:'evx', null, 'booked_and_invited', 'hi'),
  jsonb_build_object('ok', false, 'reason', 'event_cancelled'), 'a cancelled event is refused');
select is(send_event_message(:'evp', null, 'booked', 'hi'),
  jsonb_build_object('ok', false, 'reason', 'event_over'),
  'an event whose every role has ended is refused, though someone worked it');
select throws_ok($$ select send_event_message('75800000-0000-4000-8000-00000000dead', null, 'booked', 'hi') $$,
  'P0002', 'event_not_found', 'an unknown event raises');
select is((select count(*)::int from notification_outbox where template = 'OM1'), 0,
  'and none of that queued anything');
select is((select count(*)::int from audit_log where action = 'event.message_sent'), 0,
  'nor wrote any history');

-- ---------------------------------------------------------------------
-- 3 · Recipients — the whole event, confirmed and worked
-- ---------------------------------------------------------------------
select is(send_event_message(:'ev', null, 'booked', '  Staff entrance is on King St tonight {x}  ') - 'messageId',
  jsonb_build_object('ok', true, 'sent', 2, 'withoutPush', jsonb_build_array('Chec Kedin')),
  'sent to the two workers on the shift; the one without notifications is named');
select is((select array_agg(recipient_staff_id order by recipient_staff_id)
             from notification_outbox where template = 'OM1'),
  array[:'w1'::uuid, :'w2'::uuid],
  'confirmed and worked only — not the invitee, the applicant or the closed invitation');
select is((select payload ->> 'bookingId' from notification_outbox
            where template = 'OM1' and recipient_staff_id = :'w1'), :'b1a',
  'one push for a worker on two sections, linked to the section they start first');

-- ---------------------------------------------------------------------
-- 4 · The payload
-- ---------------------------------------------------------------------
select is((select payload - 'bookingId' - 'messageId' from notification_outbox
            where template = 'OM1' and recipient_staff_id = :'w2'),
  jsonb_build_object('event', 'Summer Gala', 'date', 'Sat 03 Oct',
                     'message', 'Staff entrance is on King St tonight {x}'),
  'the values OM1 renders: event, date, and the message as typed, trimmed');
select is((select array_agg(distinct k order by k)
             from notification_outbox o, jsonb_object_keys(o.payload) k where o.template = 'OM1'),
  array['bookingId', 'date', 'event', 'message', 'messageId'],
  'exactly the keys the register asks for (templates.test.ts, OM1)');
select is((select count(distinct payload ->> 'messageId')::int from notification_outbox where template = 'OM1'), 1,
  'one message id across the send');
select ok((select bool_and(channel = 'push' and key like 'OM1:%' and sent_at is null)
             from notification_outbox where template = 'OM1'),
  'queued as pushes for the drain, keyed per message');
select is((select count(*)::int from audit_log where action = 'event.message_sent' and entity_id = :'ev'), 1,
  'the send is in the event''s history');

-- ---------------------------------------------------------------------
-- 3b · Invitees on request, one section
-- ---------------------------------------------------------------------
select is(send_event_message(:'ev', :'s2', 'booked_and_invited', 'Bring black shoes') - 'messageId',
  jsonb_build_object('ok', true, 'sent', 2, 'withoutPush', jsonb_build_array('In Vited')),
  'one section with invitees: its confirmed worker and its invitee');
select is((select array_agg(recipient_staff_id order by recipient_staff_id)
             from notification_outbox where template = 'OM1' and payload ->> 'message' = 'Bring black shoes'),
  array[:'w1'::uuid, :'w3'::uuid],
  'w1 through their second section, w3 as invited; not the worked worker on the other section');
select is((select payload ->> 'bookingId' from notification_outbox
            where template = 'OM1' and payload ->> 'message' = 'Bring black shoes' and recipient_staff_id = :'w1'),
  :'b1b', 'linked to the booking on the section that was messaged');
select is((select count(distinct payload ->> 'messageId')::int from notification_outbox where template = 'OM1'), 2,
  'a second send is a second message, not swallowed by the first');
select is((select count(*)::int from notification_outbox where template = 'OM1'), 4,
  'four pushes queued across the two sends');

-- ---------------------------------------------------------------------
-- 3c · Invitees on their own, the whole event
-- ---------------------------------------------------------------------
select is(send_event_message(:'ev', null, 'invited', 'You still have an invite for tonight') - 'messageId',
  jsonb_build_object('ok', true, 'sent', 1, 'withoutPush', jsonb_build_array('In Vited')),
  'invited only: the one open invitation');
select is((select array_agg(recipient_staff_id)
             from notification_outbox where template = 'OM1'
              and payload ->> 'message' = 'You still have an invite for tonight'),
  array[:'w3'::uuid],
  'not the confirmed, the checked-in, the applicant or the closed invitation');
select is((select data ->> 'audience' from audit_log
            where action = 'event.message_sent' and data ->> 'message' = 'You still have an invite for tonight'),
  'invited', 'the history records who it was for');

-- ---------------------------------------------------------------------
-- 2b · Nobody left to message
-- ---------------------------------------------------------------------
reset role;
update bookings set status = 'cancelled', cancelled_at = now(), cancel_cause = 'office_withdraw'
 where id in (:'b1a', :'b1b', :'b3');
set local role authenticated;
select is(send_event_message(:'ev', :'s2', 'booked', 'Anyone?'),
  jsonb_build_object('ok', false, 'reason', 'nobody_to_message'),
  'a section with nobody confirmed has nobody to message');
select is(send_event_message(:'ev', null, 'invited', 'Anyone?'),
  jsonb_build_object('ok', false, 'reason', 'nobody_to_message'),
  'with the invitation withdrawn there is no invitee left to message');
select is((select count(*)::int from notification_outbox where template = 'OM1'), 5, 'and queued nothing');

select * from finish();
rollback;
