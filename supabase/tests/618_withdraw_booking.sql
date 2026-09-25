-- =====================================================================
-- 618 · Withdraw is one database function, and N10b goes with it
--       (§3.3, §3.6, §8 N10b; audit D38)
--   20260929110300_withdraw_booking.sql
--
--   1. Who may call it: admin only.
--   2. A confirmed booking: cancelled / office_withdraw and N10b in the
--      same transaction, with {event} and {dateTime}; audited.
--   3. An invitation: the same cancel, and N10d (the invitation's copy).
--   4. Refusals by name, writing nothing: checked_in (worked,
--      turned_away), not_withdrawable (an application, an ended row).
--   5. A reopened booking withdrawn again is told again.
-- =====================================================================
begin;
select plan(25);
\ir _shared/fixtures.psql

select cap_week_start(current_date) + 14 as w \gset

\set ro  '61800000-0000-4000-8000-000000000001'
\set ev  '61800000-0000-4000-8000-0000000000e1'
\set s   '61810000-0000-4000-8000-000000000001'
\set w1  '61820000-0000-4000-8000-000000000001'
\set w2  '61820000-0000-4000-8000-000000000002'
\set w3  '61820000-0000-4000-8000-000000000003'
\set w4  '61820000-0000-4000-8000-000000000004'
\set w5  '61820000-0000-4000-8000-000000000005'
\set bc  '61830000-0000-4000-8000-000000000001'
\set bi  '61830000-0000-4000-8000-000000000002'
\set ba  '61830000-0000-4000-8000-000000000003'
\set bw  '61830000-0000-4000-8000-000000000004'
\set bt  '61830000-0000-4000-8000-000000000005'

insert into roles (id, name, pay_rate) values (:'ro', 'Withdraw Waiting Staff', 14.00);
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Withdraw Gala', :'w'::date + 3, true, true);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'s', :'ev', :'ro', (:'w'::date + 3 + time '17:00') at time zone 'Europe/London',
                       (:'w'::date + 3 + time '23:00') at time zone 'Europe/London', 5, 0, 22, 14, 5);
insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'w1', 'Ada', 'Confirmed', 'w1@wd618.test', '+447700961801', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'w2', 'Ben', 'Invited',   'w2@wd618.test', '+447700961802', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'w3', 'Cai', 'Applied',   'w3@wd618.test', '+447700961803', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'w4', 'Dee', 'Worked',    'w4@wd618.test', '+447700961804', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'w5', 'Eve', 'Turned',    'w5@wd618.test', '+447700961805', date '1995-01-01', 'compliant', 'uk_irish');
insert into staff_roles (staff_id, role_id) select id, :'ro' from staff where email like '%@wd618.test';

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at, applied_at) values
  (:'bc', :'s', :'w1', 'confirmed',   'auto', now(), null),
  (:'bi', :'s', :'w2', 'invited',     'auto', null,  null),
  (:'ba', :'s', :'w3', 'applied',     'self', null,  now()),
  (:'bw', :'s', :'w4', 'worked',      'auto', now(), null),
  (:'bt', :'s', :'w5', 'turned_away', 'auto', now(), null);

-- ---------------------------------------------------------------------
-- 1 · Who may call it
-- ---------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.withdraw_booking(uuid)', 'execute'),
  'anon cannot execute withdraw_booking');
select ok(has_function_privilege('authenticated', 'public.withdraw_booking(uuid)', 'execute'),
  'the office reaches it as authenticated; the admin check inside is the gate');
select ok((select prosecdef from pg_proc where oid = 'public.withdraw_booking(uuid)'::regprocedure),
  'withdraw_booking is security definer');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select withdraw_booking(%L) $$, :'bc'), '42501', 'not_authorised',
  'a worker cannot withdraw anyone');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select withdraw_booking(%L) $$, :'bc'), '42501', 'not_authorised',
  'nor can a client, on their own event');
reset role;
select is((select status::text from bookings where id = :'bc'), 'confirmed', 'and nothing moved');

-- ---------------------------------------------------------------------
-- 2 · A confirmed booking: N10b
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select withdraw_booking('61830000-0000-4000-8000-0000000000ff') $$, 'P0002', 'booking_not_found',
  'an unknown booking is an error');
select is(withdraw_booking(:'bc'),
  jsonb_build_object('ok', true, 'was', 'confirmed', 'notified', 'N10b'),
  'the office withdraws Ada, who had confirmed');
reset role;
select is((select status::text || '/' || cancel_cause from bookings where id = :'bc'), 'cancelled/office_withdraw',
  'cancelled with the §3.6 cause the Staff App''s "You''ve been removed" screen reads');
select is((select count(*)::int from notification_outbox
            where template = 'N10b' and recipient_staff_id = :'w1'), 1,
  'N10b is queued in the same transaction — not a second call the page may never make');
select is((select payload ->> 'event' from notification_outbox where template = 'N10b' and recipient_staff_id = :'w1'),
  'Withdraw Gala', 'with {event}');
select is((select payload ->> 'dateTime' from notification_outbox where template = 'N10b' and recipient_staff_id = :'w1'),
  to_char(((:'w'::date + 3 + time '17:00') at time zone 'Europe/London') at time zone 'Europe/London', 'Dy DD Mon HH24:MI'),
  'and {dateTime}, the ROLE''s start in UK time ("Fri 19 Sep 17:00")');
select is((select count(*)::int from audit_log where action = 'booking.withdrawn' and entity_id = :'bc'
             and actor = :'admin_uid'::uuid and data ->> 'notified' = 'N10b'), 1,
  'audited against the manager who pressed it');

-- ---------------------------------------------------------------------
-- 3 · An invitation: N10d
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(withdraw_booking(:'bi'),
  jsonb_build_object('ok', true, 'was', 'invited', 'notified', 'N10d'),
  'the office withdraws Ben''s invitation — decided from the row, never a flag the page sent');
reset role;
select is((select status::text || '/' || cancel_cause from bookings where id = :'bi'), 'cancelled/office_withdraw',
  'the same transition as a confirmed booking (§3.6)');
select is((select count(*)::int from notification_outbox where template = 'N10d' and recipient_staff_id = :'w2'), 1,
  'and Ben is told — with the invitation''s copy, not "You''ve been removed"');
select is((select count(*)::int from notification_outbox where template = 'N10b' and recipient_staff_id = :'w2'), 0,
  'no N10b for an invitation');

-- ---------------------------------------------------------------------
-- 4 · Refusals
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(withdraw_booking(:'bw') ->> 'reason', 'checked_in', 'a worked booking has no edge out (§3.6)');
select is(withdraw_booking(:'bt') ->> 'reason', 'checked_in', 'nor a turned-away one');
select is(withdraw_booking(:'ba') ->> 'reason', 'not_withdrawable',
  'an application is not withdrawn by the office (ADR-0023)');
select is(withdraw_booking(:'bc') ->> 'reason', 'not_withdrawable', 'a second press on the same row does nothing');
reset role;
select is((select count(*)::int from notification_outbox
            where template in ('N10b', 'N10d') and recipient_staff_id in (:'w3', :'w4', :'w5')), 0,
  'and none of the refusals queued anything');

-- ---------------------------------------------------------------------
-- 5 · Reopened and withdrawn again: told again
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select is(office_invite_worker(:'s', :'w2') ->> 'invited', 'true', 'the office invites Ben again (D33)');
select is(withdraw_booking(:'bi') ->> 'notified', 'N10d', 'and withdraws him again');
select is((select count(*)::int from notification_outbox where template = 'N10d' and recipient_staff_id = :'w2'), 2,
  'two withdrawals, two messages: the key carries the moment of the cancel');

select * from finish();
rollback;
