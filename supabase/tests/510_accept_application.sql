-- =====================================================================
-- 510 · The office takes a Radar application forward (§3.3, §10.4,
--       §8 N10 / N10c) and accept_invite names an expired right to work
--   20260925100000_accept_application.sql
--
--   1. Who may call it: admin only — not a worker, not a client, not anon.
--   2. applied → confirmed, N10 with {event} and {date}; the fill counts
--      only confirmed and the buffer is absolute; the press that fills the
--      role closes the other applications (closed / slot_taken) with N10c.
--   3. Every refusal, by name, leaving the application untouched.
--   4. accept_invite: rtw_expired, and a first-to-confirm fill closes the
--      pending applications too (one trigger for both, §8).
-- =====================================================================
begin;
select plan(51);
\ir _shared/fixtures.psql

select cap_week_start(current_date) + 14 as w \gset

\set ev   '51000000-0000-4000-8000-000000000001'
\set evx  '51000000-0000-4000-8000-000000000002'
\set s    '51100000-0000-4000-8000-000000000001'
\set s2   '51100000-0000-4000-8000-000000000002'
\set s3   '51100000-0000-4000-8000-000000000003'
\set s4   '51100000-0000-4000-8000-000000000004'
\set s5   '51100000-0000-4000-8000-000000000005'
\set s6   '51100000-0000-4000-8000-000000000006'
\set s7   '51100000-0000-4000-8000-000000000007'
\set sx   '51100000-0000-4000-8000-000000000008'
\set h1   '51100000-0000-4000-8000-000000000011'
\set h2   '51100000-0000-4000-8000-000000000012'

\set w1  '51200000-0000-4000-8000-000000000001'
\set w2  '51200000-0000-4000-8000-000000000002'
\set w3  '51200000-0000-4000-8000-000000000003'
\set w4  '51200000-0000-4000-8000-000000000004'
\set w5  '51200000-0000-4000-8000-000000000005'
\set w6  '51200000-0000-4000-8000-000000000006'
\set w7  '51200000-0000-4000-8000-000000000007'
\set w8  '51200000-0000-4000-8000-000000000008'
\set w9  '51200000-0000-4000-8000-000000000009'
\set w10 '51200000-0000-4000-8000-000000000010'
\set w11 '51200000-0000-4000-8000-000000000011'
\set w12 '51200000-0000-4000-8000-000000000012'

\set a1  '51300000-0000-4000-8000-000000000001'
\set a2  '51300000-0000-4000-8000-000000000002'
\set a3  '51300000-0000-4000-8000-000000000003'
\set a4  '51300000-0000-4000-8000-000000000004'
\set g5  '51300000-0000-4000-8000-000000000005'
\set g6  '51300000-0000-4000-8000-000000000006'
\set g7  '51300000-0000-4000-8000-000000000007'
\set g8  '51300000-0000-4000-8000-000000000008'
\set g9  '51300000-0000-4000-8000-000000000009'
\set g10 '51300000-0000-4000-8000-000000000010'
\set g11 '51300000-0000-4000-8000-000000000011'
\set g12 '51300000-0000-4000-8000-000000000012'
\set ge  '51300000-0000-4000-8000-000000000013'
\set gx  '51300000-0000-4000-8000-000000000014'
\set i6  '51300000-0000-4000-8000-000000000016'
\set a6  '51300000-0000-4000-8000-000000000017'
\set i7  '51300000-0000-4000-8000-000000000018'

-- ---------------------------------------------------------------------
-- Fixture: one event in week W at the fixture venue, a second (cancelled)
-- one, and twelve workers.
-- ---------------------------------------------------------------------
insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch, right_to_work_until, left_at) values
  (:'w1',  'Ada',   'One',    'w1@aa510.test',  '+447700951001', date '1995-01-01', 'compliant', 'uk_irish', null, null),
  (:'w2',  'Ben',   'Two',    'w2@aa510.test',  '+447700951002', date '1995-01-01', 'compliant', 'uk_irish', null, null),
  (:'w3',  'Cai',   'Three',  'w3@aa510.test',  '+447700951003', date '1995-01-01', 'compliant', 'uk_irish', null, null),
  (:'w4',  'Dee',   'Four',   'w4@aa510.test',  '+447700951004', date '1995-01-01', 'compliant', 'uk_irish', null, null),
  (:'w5',  'Eve',   'Blocked','w5@aa510.test',  '+447700951005', date '1995-01-01', 'blocked',   'uk_irish', null, null),
  (:'w6',  'Fin',   'Booked', 'w6@aa510.test',  '+447700951006', date '1995-01-01', 'compliant', 'uk_irish', null, null),
  (:'w7',  'Gus',   'Expired','w7@aa510.test',  '+447700951007', date '1995-01-01', 'compliant', 'work_visa', :'w'::date + 4, null),
  (:'w8',  'Hal',   'Hours',  'w8@aa510.test',  '+447700951008', date '1995-01-01', 'compliant', 'uk_irish', null, null),
  (:'w9',  'Ivy',   'Selfcx', 'w9@aa510.test',  '+447700951009', date '1995-01-01', 'compliant', 'uk_irish', null, null),
  (:'w10', 'Jo',    'Dnr',    'w10@aa510.test', '+447700951010', date '1995-01-01', 'compliant', 'uk_irish', null, null),
  (:'w11', 'Kit',   'Norole', 'w11@aa510.test', '+447700951011', date '1995-01-01', 'compliant', 'uk_irish', null, null),
  (:'w12', 'Lou',   'Left',   'w12@aa510.test', '+447700951012', date '1995-01-01', 'inactive',  'uk_irish', null, now());
insert into staff_roles (staff_id, role_id)
select id, :'role_id' from staff where email like '%@aa510.test' and id <> :'w11';
insert into client_qualifications (client_id, role_id, staff_id, do_not_return)
values (:'clienta', :'role_id', :'w10', true);

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer) values
  (:'ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Radar Gala', :'w'::date + 3, true, true),
  (:'evx', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Called Off', :'w'::date + 6, true, true);
update events set cancelled_at = now(), cancel_reason = 'fixture' where id = :'evx';

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  -- Thursday: headcount 1 (+1). The N10 / N10c flow.
  (:'s',  :'ev', :'role_id', (:'w'::date + 3 + time '09:00') at time zone 'Europe/London',
                             (:'w'::date + 3 + time '17:00') at time zone 'Europe/London', 1, 1, 20, 12, 2),
  -- Thursday evening: headcount 1, already confirmed — full.
  (:'s2', :'ev', :'role_id', (:'w'::date + 3 + time '18:00') at time zone 'Europe/London',
                             (:'w'::date + 3 + time '23:00') at time zone 'Europe/London', 1, 0, 20, 12, 1),
  -- Saturday: the gates.
  (:'s3', :'ev', :'role_id', (:'w'::date + 5 + time '09:00') at time zone 'Europe/London',
                             (:'w'::date + 5 + time '17:00') at time zone 'Europe/London', 5, 0, 20, 12, 5),
  -- Saturday, overlapping s3.
  (:'s4', :'ev', :'role_id', (:'w'::date + 5 + time '12:00') at time zone 'Europe/London',
                             (:'w'::date + 5 + time '20:00') at time zone 'Europe/London', 5, 0, 20, 12, 5),
  -- Already over (RULE-16).
  (:'s5', :'ev', :'role_id', now() - interval '10 hours', now() - interval '2 hours', 5, 0, 20, 12, 5),
  -- Friday: headcount 1, for accept_invite's fill.
  (:'s6', :'ev', :'role_id', (:'w'::date + 4 + time '09:00') at time zone 'Europe/London',
                             (:'w'::date + 4 + time '17:00') at time zone 'Europe/London', 1, 0, 20, 12, 1),
  -- Saturday evening, for accept_invite's rtw_expired.
  (:'s7', :'ev', :'role_id', (:'w'::date + 5 + time '18:00') at time zone 'Europe/London',
                             (:'w'::date + 5 + time '23:00') at time zone 'Europe/London', 5, 0, 20, 12, 5),
  (:'sx', :'evx', :'role_id', (:'w'::date + 6 + time '09:00') at time zone 'Europe/London',
                              (:'w'::date + 6 + time '17:00') at time zone 'Europe/London', 5, 0, 20, 12, 5),
  -- Hal's 46 hours earlier in the week.
  (:'h1', :'ev', :'role_id', (:'w'::date + time '00:00') at time zone 'Europe/London',
                             (:'w'::date + 1 + time '16:00') at time zone 'Europe/London', 5, 0, 20, 12, 5),
  (:'h2', :'ev', :'role_id', (:'w'::date + 2 + time '09:00') at time zone 'Europe/London',
                             (:'w'::date + 2 + time '15:00') at time zone 'Europe/London', 5, 0, 20, 12, 5);

insert into bookings (id, shift_id, staff_id, status, source, applied_at) values
  (:'a1',  :'s',  :'w1',  'applied', 'self', now() - interval '3 hours'),
  (:'a2',  :'s',  :'w2',  'applied', 'self', now() - interval '2 hours'),
  (:'a3',  :'s',  :'w3',  'applied', 'self', now() - interval '1 hour'),
  (:'a4',  :'s2', :'w4',  'applied', 'self', now() - interval '1 hour'),
  (:'g5',  :'s3', :'w5',  'applied', 'self', now()),
  (:'g6',  :'s3', :'w6',  'applied', 'self', now()),
  (:'g7',  :'s3', :'w7',  'applied', 'self', now()),
  (:'g8',  :'s3', :'w8',  'applied', 'self', now()),
  (:'g9',  :'s3', :'w9',  'applied', 'self', now()),
  (:'g10', :'s3', :'w10', 'applied', 'self', now()),
  (:'g11', :'s3', :'w11', 'applied', 'self', now()),
  (:'g12', :'s3', :'w12', 'applied', 'self', now()),
  (:'ge',  :'s5', :'w1',  'applied', 'self', now() - interval '12 hours'),
  (:'gx',  :'sx', :'w1',  'applied', 'self', now()),
  (:'i6',  :'s6', :'w2',  'invited', 'auto', null),
  (:'a6',  :'s6', :'w3',  'applied', 'self', now()),
  (:'i7',  :'s7', :'w7',  'invited', 'auto', null);
insert into bookings (shift_id, staff_id, status, source, confirmed_at) values
  (:'s2', :'w5',  'confirmed', 'auto', now()),   -- s2 is full
  (:'s4', :'w6',  'confirmed', 'auto', now()),   -- Fin is booked elsewhere
  (:'h1', :'w8',  'confirmed', 'auto', now()),   -- Hal: 40 h
  (:'h2', :'w8',  'confirmed', 'auto', now());   --      + 6 h
insert into bookings (shift_id, staff_id, status, source, cancelled_at, cancel_cause, self_cancelled)
values (:'s4', :'w9', 'cancelled', 'auto', now(), 'self_cancel', true);   -- Ivy: RULE-04

-- ---------------------------------------------------------------------
-- 1 · Who may call it
-- ---------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.accept_application(uuid)', 'execute'),
  'anon cannot execute accept_application');
select ok(has_function_privilege('authenticated', 'public.accept_application(uuid)', 'execute'),
  'the office reaches it as authenticated; the admin check inside is the gate');
select ok(not has_function_privilege('authenticated', 'public.close_filled_role_applications(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.close_filled_role_applications(uuid)', 'execute'),
  'closing applications is internal: no signed-in caller can close a role''s applications directly');
select ok(not has_function_privilege('authenticated', 'public.queue_application_push(text, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.queue_application_push(text, uuid)', 'execute'),
  'nor queue N10 / N10c to a worker');
select ok((select prosecdef from pg_proc where oid = 'public.accept_application(uuid)'::regprocedure),
  'accept_application is security definer, so its admin check is what guards it');

set local role anon;
select throws_ok(format($$ select accept_application(%L) $$, :'a1'), '42501', null,
  'anon is refused');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select accept_application(%L) $$, :'a1'), '42501', 'not_authorised',
  'a worker cannot accept an application — not even their own');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select accept_application(%L) $$, :'a1'), '42501', 'not_authorised',
  'a client cannot accept one either, on their own event');
reset role;

select is((select status::text from bookings where id = :'a1'), 'applied',
  'and none of those refusals touched the application');

-- ---------------------------------------------------------------------
-- 2 · Taken forward: N10, and the fill that sends N10c
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok($$ select accept_application('51300000-0000-4000-8000-0000000000ff') $$,
  'P0002', 'booking_not_found', 'an unknown booking is an error, not a silent no-op');

select is(accept_application(:'a1'),
  jsonb_build_object('ok', true, 'withdrawn', 0, 'closedApplications', 0),
  'the office accepts Ada''s application: 1 confirmed of 1 (+1), so nobody else is closed yet');
select is((select status::text from bookings where id = :'a1'), 'confirmed', 'applied → confirmed');
select isnt((select confirmed_at from bookings where id = :'a1'), null, 'confirmed_at is stamped');
select is((select template from notification_outbox where key = 'N10:booking:' || :'a1'), 'N10',
  'N10 is queued, keyed per booking');
select is((select recipient_staff_id from notification_outbox where key = 'N10:booking:' || :'a1'), :'w1'::uuid,
  'to the applicant');
select is((select payload ->> 'event' from notification_outbox where key = 'N10:booking:' || :'a1'), 'Radar Gala',
  'N10 carries {event}');
select is((select payload ->> 'date' from notification_outbox where key = 'N10:booking:' || :'a1'),
  to_char(:'w'::date + 3, 'DD Mon YYYY'), 'and {date}, the role''s own UK day');
select is((select count(*)::int from notification_outbox
            where template = 'N10c' and recipient_staff_id in (:'w2', :'w3')), 0,
  'no N10c while the buffer slot is still open: the buffer is absolute, and the role is not full');

select is(accept_application(:'a2'),
  jsonb_build_object('ok', true, 'withdrawn', 0, 'closedApplications', 1),
  'Ben takes the buffer slot: 2 confirmed of 1 (+1) fills the role and closes the one application left');
select is((select status::text || '/' || cancel_cause from bookings where id = :'a3'), 'closed/slot_taken',
  'Cai''s application is closed as not taken forward (ADR-0022''s cause)');
select isnt((select cancelled_at from bookings where id = :'a3'), null,
  'stamped, so it never counts as committed hours');
select is((select count(*)::int from notification_outbox
            where template = 'N10c' and recipient_staff_id = :'w3'
              and payload ->> 'bookingId' = :'a3'
              and payload ->> 'date' = to_char(:'w'::date + 3, 'DD Mon YYYY')), 1,
  'and Cai gets N10c, once, with {event} and {date}');
select is((select count(*)::int from notification_outbox where template = 'N10c' and recipient_staff_id in (:'w1', :'w2')), 0,
  'the two who were booked get no N10c');
select is((select count(*)::int from bookings where shift_id = :'s' and status = 'confirmed'), 2,
  'the role holds headcount + buffer confirmed, and no more');
select is(accept_application(:'a3') ->> 'reason', 'not_applied',
  'a closed application cannot be accepted');
select is((select count(*)::int from audit_log where action = 'booking.application_accepted'
            and entity_id in (:'a1', :'a2')), 2, 'each acceptance is audited');

-- A role that was full before this migration: the application closes now.
select is(accept_application(:'a4'),
  jsonb_build_object('ok', false, 'reason', 'full', 'closedApplications', 1),
  'full: an application on a role already fully confirmed is refused');
select is((select status::text || '/' || cancel_cause from bookings where id = :'a4'), 'closed/slot_taken',
  'and, as §8 says happens at the fill, it is closed now');
select is((select count(*)::int from notification_outbox where template = 'N10c' and recipient_staff_id = :'w4'), 1,
  'with N10c');

-- ---------------------------------------------------------------------
-- 3 · Refusals, each by the name the board already shows
-- ---------------------------------------------------------------------
select is(accept_application(:'g5')  ->> 'reason', 'blocked',          'blocked (compliance)');
select is(accept_application(:'g6')  ->> 'reason', 'booked_elsewhere', 'booked elsewhere: an overlapping CONFIRMED shift');
select is(accept_application(:'g7')  ->> 'reason', 'rtw_expired',      'past the right to work: rtw_expired, not hours_limit');
select is(accept_application(:'g8')  ->> 'reason', 'hours_limit',      'RULE-20: 46 h + 8 h is over the 48');
select is(accept_application(:'g9')  ->> 'reason', 'self_cancelled',   'RULE-04: self-cancelled off this event');
select is(accept_application(:'g10') ->> 'reason', 'do_not_return',    'do not return at this client');
select is(accept_application(:'g11') ->> 'reason', 'wrong_role',       'not signed off for the role');
select is(accept_application(:'g12') ->> 'reason', 'not_bookable',     'a leaver has no candidate row: not bookable (§10.6)');
select is(accept_application(:'ge')  ->> 'reason', 'event_ended',      'RULE-16: the shift has ended');
select is(accept_application(:'gx')  ->> 'reason', 'event_cancelled',  'the event is cancelled');
select is((select count(*)::int from bookings
            where id in (:'g5', :'g6', :'g7', :'g8', :'g9', :'g10', :'g11', :'g12', :'ge', :'gx')
              and status = 'applied'), 10,
  'every refusal leaves the application pending, exactly as it was');
select is((select count(*)::int from notification_outbox
            where template in ('N10', 'N10c')
              and payload ->> 'bookingId' in (:'g5', :'g6', :'g7', :'g8', :'g9', :'g10', :'g11', :'g12', :'ge', :'gx')), 0,
  'and queues nothing');

-- The rota guard stays the backstop underneath: forcing the edge by hand
-- past an expired right to work is still refused.
reset role;
select throws_ok(format($$ update bookings set status = 'confirmed' where id = %L $$, :'g7'),
  'P0001', 'rota_guard_rtw_expired', 'a direct write past the right to work is refused by the trigger');

-- ---------------------------------------------------------------------
-- 4 · accept_invite
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(accept_invite(:'i7') ->> 'reason', 'rtw_expired',
  'accept_invite answers rtw_expired for a shift past the right to work (it said hours_limit)');
select is((select status::text from bookings where id = :'i7'), 'invited',
  'and leaves the invitation live — renewing the right to work would let it through');
select is(accept_invite(:'g8'::uuid) ->> 'reason', 'not_invited',
  'an application is not an invitation: accept_invite does not take it');

select is(accept_invite(:'i6'),
  jsonb_build_object('ok', true, 'withdrawn', 0, 'closedApplications', 1),
  'first-to-confirm fills Friday (1 of 1) and reports the application it closed');
select is((select status::text || '/' || cancel_cause from bookings where id = :'a6'), 'closed/slot_taken',
  'the pending application on the filled role is closed');
select is((select count(*)::int from notification_outbox where template = 'N10c' and payload ->> 'bookingId' = :'a6'), 1,
  'with N10c — one trigger for a manual pick and a first-to-confirm fill (§8)');
select is((select count(*)::int from notification_outbox where template = 'N10' and payload ->> 'bookingId' = :'i6'), 0,
  'an accepted invitation is not a Radar application: no N10');

-- ---------------------------------------------------------------------
-- §10.4: closed is not the end — the role reopens, the worker applies
-- again (closed → applied), and the office can take that one forward.
-- ---------------------------------------------------------------------
reset role;
update bookings set status = 'cancelled', cancelled_at = now(), cancel_cause = 'office_withdraw' where id = :'i6';
update bookings set status = 'applied', applied_at = now() + interval '1 minute',
                    cancelled_at = null, cancel_cause = null where id = :'a6';
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(accept_application(:'a6') ->> 'ok', 'true', 'the re-application is taken forward');
select is((select count(*)::int from notification_outbox where template = 'N10' and payload ->> 'bookingId' = :'a6'), 1,
  'N10 for it');
reset role;

select * from finish();
rollback;
