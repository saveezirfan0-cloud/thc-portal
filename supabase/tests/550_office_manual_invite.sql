-- =====================================================================
-- 550 · The manager's Invite from the Potential pool (§3.3, §3.4)
--   20260927100000_office_manual_invite.sql
--
--   1. Who may call it: admin only — not a worker, not a client, not anon.
--   2. The board's read path: an admin can call auto_assign_candidates
--      through RLS and sees the gates the Unavailable list shows.
--   3. An invitation: `invited`, source manual, N5 queued with the same
--      key auto-assign uses, an audit row; a second press is refused.
--   4. Past open invitations, but never past a full CONFIRMED role.
--   5. Every refusal by name, writing nothing: the hard gates,
--      not_bookable, event_ended (RULE-16), event_cancelled.
-- =====================================================================
begin;
select plan(32);
\ir _shared/fixtures.psql

select cap_week_start(current_date) + 14 as w \gset

\set ev   '55000000-0000-4000-8000-000000000001'
\set evx  '55000000-0000-4000-8000-000000000002'
\set s    '55100000-0000-4000-8000-000000000001'
\set s2   '55100000-0000-4000-8000-000000000002'
\set s3   '55100000-0000-4000-8000-000000000003'
\set s4   '55100000-0000-4000-8000-000000000004'
\set sx   '55100000-0000-4000-8000-000000000005'
\set sz   '55100000-0000-4000-8000-0000000000ff'

\set w1  '55200000-0000-4000-8000-000000000001'
\set w2  '55200000-0000-4000-8000-000000000002'
\set w3  '55200000-0000-4000-8000-000000000003'
\set w4  '55200000-0000-4000-8000-000000000004'
\set w5  '55200000-0000-4000-8000-000000000005'
\set w6  '55200000-0000-4000-8000-000000000006'
\set w7  '55200000-0000-4000-8000-000000000007'
\set w8  '55200000-0000-4000-8000-000000000008'
\set w9  '55200000-0000-4000-8000-000000000009'
\set w10 '55200000-0000-4000-8000-000000000010'

-- ---------------------------------------------------------------------
-- Fixture: one event in week W, a cancelled one, ten workers.
-- ---------------------------------------------------------------------
insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch, left_at) values
  (:'w1',  'Ada', 'One',     'w1@mi550.test',  '+447700955001', date '1995-01-01', 'compliant', 'uk_irish', null),
  (:'w2',  'Ben', 'Two',     'w2@mi550.test',  '+447700955002', date '1995-01-01', 'compliant', 'uk_irish', null),
  (:'w3',  'Cai', 'Three',   'w3@mi550.test',  '+447700955003', date '1995-01-01', 'compliant', 'uk_irish', null),
  (:'w4',  'Dee', 'Blocked', 'w4@mi550.test',  '+447700955004', date '1995-01-01', 'blocked',   'uk_irish', null),
  (:'w5',  'Eve', 'Dnr',     'w5@mi550.test',  '+447700955005', date '1995-01-01', 'compliant', 'uk_irish', null),
  (:'w6',  'Fin', 'Selfcx',  'w6@mi550.test',  '+447700955006', date '1995-01-01', 'compliant', 'uk_irish', null),
  (:'w7',  'Gus', 'Norole',  'w7@mi550.test',  '+447700955007', date '1995-01-01', 'compliant', 'uk_irish', null),
  (:'w8',  'Hal', 'Left',    'w8@mi550.test',  '+447700955008', date '1995-01-01', 'inactive',  'uk_irish', now()),
  (:'w9',  'Ivy', 'Booked',  'w9@mi550.test',  '+447700955009', date '1995-01-01', 'compliant', 'uk_irish', null),
  (:'w10', 'Jo',  'Four',    'w10@mi550.test', '+447700955010', date '1995-01-01', 'compliant', 'uk_irish', null);
insert into staff_roles (staff_id, role_id)
select id, :'role_id' from staff where email like '%@mi550.test' and id <> :'w7';
insert into client_qualifications (client_id, role_id, staff_id, do_not_return)
values (:'clienta', :'role_id', :'w5', true);

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer) values
  (:'ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Manual Gala', :'w'::date + 3, true, true),
  (:'evx', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Called Off', :'w'::date + 6, true, true);
update events set cancelled_at = now(), cancel_reason = 'fixture' where id = :'evx';

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  -- Thursday: headcount 1 (+0), one auto invitation already out.
  (:'s',  :'ev', :'role_id', (:'w'::date + 3 + time '09:00') at time zone 'Europe/London',
                             (:'w'::date + 3 + time '17:00') at time zone 'Europe/London', 1, 0, 20, 12, 1),
  -- Friday: the gates.
  (:'s2', :'ev', :'role_id', (:'w'::date + 4 + time '09:00') at time zone 'Europe/London',
                             (:'w'::date + 4 + time '17:00') at time zone 'Europe/London', 5, 0, 20, 12, 5),
  -- Friday, overlapping s2: Ivy is confirmed here; Fin self-cancelled here.
  (:'s3', :'ev', :'role_id', (:'w'::date + 4 + time '12:00') at time zone 'Europe/London',
                             (:'w'::date + 4 + time '20:00') at time zone 'Europe/London', 5, 0, 20, 12, 5),
  -- Already over (RULE-16).
  (:'s4', :'ev', :'role_id', now() - interval '10 hours', now() - interval '2 hours', 5, 0, 20, 12, 5),
  (:'sx', :'evx', :'role_id', (:'w'::date + 6 + time '09:00') at time zone 'Europe/London',
                              (:'w'::date + 6 + time '17:00') at time zone 'Europe/London', 5, 0, 20, 12, 5);

insert into bookings (shift_id, staff_id, status, source) values
  (:'s', :'w2', 'invited', 'auto');                               -- target 1 already "used" by an invitation
insert into bookings (shift_id, staff_id, status, source, confirmed_at) values
  (:'s3', :'w9', 'confirmed', 'auto', now());                     -- Ivy: booked elsewhere for s2
insert into bookings (shift_id, staff_id, status, source, cancelled_at, cancel_cause, self_cancelled)
values (:'s3', :'w6', 'cancelled', 'auto', now(), 'self_cancel', true);   -- Fin: RULE-04

-- ---------------------------------------------------------------------
-- 1 · Who may call it
-- ---------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.office_invite_worker(uuid, uuid)', 'execute'),
  'anon cannot execute office_invite_worker');
select ok(has_function_privilege('authenticated', 'public.office_invite_worker(uuid, uuid)', 'execute'),
  'the office reaches it as authenticated; the admin check inside is the gate');
select ok((select prosecdef from pg_proc where oid = 'public.office_invite_worker(uuid, uuid)'::regprocedure),
  'office_invite_worker is security definer, so its admin check is what guards it');

set local role anon;
select throws_ok(format($$ select office_invite_worker(%L, %L) $$, :'s2', :'w1'), '42501', null,
  'anon is refused');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select office_invite_worker(%L, %L) $$, :'s2', :'staffa'), '42501', 'not_authorised',
  'a worker cannot invite anyone — not even themselves');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select office_invite_worker(%L, %L) $$, :'s2', :'w1'), '42501', 'not_authorised',
  'a client cannot invite onto their own event either');
reset role;

select is((select count(*)::int from bookings where shift_id = :'s2'), 0,
  'none of those refusals wrote a booking');

-- ---------------------------------------------------------------------
-- 2 · The board's read path, as the admin, through RLS
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select count(*)::int from auto_assign_candidates(:'s2') c
    join staff s on s.id = c.staff_id where s.email like '%@mi550.test'),
  9,
  'the admin reads the pool for a section: every fixture worker but the leaver (§10.6)');
select is(
  (select jsonb_object_agg(s.first_name, coalesce(c.gate, 'pool'))
     from auto_assign_candidates(:'s2') c join staff s on s.id = c.staff_id
    where s.email like '%@mi550.test'),
  jsonb_build_object('Ada', 'pool', 'Ben', 'pool', 'Cai', 'pool', 'Jo', 'pool',
                     'Dee', 'blocked', 'Eve', 'do_not_return', 'Fin', 'self_cancelled',
                     'Gus', 'wrong_role', 'Ivy', 'booked_elsewhere'),
  'with the gate the Unavailable list names for each (wrong_role is filtered by the screen)');

-- ---------------------------------------------------------------------
-- 3 · An invitation
-- ---------------------------------------------------------------------
select throws_ok(format($$ select office_invite_worker(%L, %L) $$, :'sz', :'w1'), 'P0002', 'shift_not_found',
  'an unknown section is an error, not a silent no-op');

select is(office_invite_worker(:'s2', :'w1') ->> 'invited', 'true', 'the manager invites Ada');
select is((select status::text from bookings where shift_id = :'s2' and staff_id = :'w1'), 'invited',
  'the booking is born invited (§3.6)');
select is((select source::text from bookings where shift_id = :'s2' and staff_id = :'w1'), 'manual',
  'and carries source manual, so the Invited line reads "manual"');
select is(
  (select template from notification_outbox
    where key = 'N5:booking:' || (select id from bookings where shift_id = :'s2' and staff_id = :'w1')::text),
  'N5',
  'N5 is queued with the key auto-assign uses (queue_booking_push)');
select is(
  (select payload ->> 'event' from notification_outbox
    where key = 'N5:booking:' || (select id from bookings where shift_id = :'s2' and staff_id = :'w1')::text),
  'Manual Gala',
  'with the values the §8 register renders from');
reset role;
select is(
  (select count(*)::int from audit_log
    where action = 'booking.manual_invite'
      and entity_id = (select id from bookings where shift_id = :'s2' and staff_id = :'w1')
      and actor = :'admin_uid'::uuid),
  1,
  'and the press is audited against the manager who made it');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(office_invite_worker(:'s2', :'w1'),
  jsonb_build_object('invited', false, 'reason', 'already_has_booking'),
  'a second press is refused: one booking per worker per section');
select is((select count(*)::int from notification_outbox
            where recipient_staff_id = :'w1' and template = 'N5'), 1,
  'and queues no second N5');

-- ---------------------------------------------------------------------
-- 4 · The target: past open invitations, never past a full confirmed role
-- ---------------------------------------------------------------------
select is(office_invite_worker(:'s', :'w3') ->> 'invited', 'true',
  'Thursday is 1 (+0) with Ben''s auto invitation out — the manager can still invite Cai by name');
select is((select count(*)::int from bookings where shift_id = :'s' and status = 'invited'), 2,
  'both invitations stand; auto-assign''s is never withdrawn (§3.6)');
reset role;
update bookings set status = 'confirmed', confirmed_at = now() where shift_id = :'s' and staff_id = :'w2';
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(office_invite_worker(:'s', :'w10'),
  jsonb_build_object('invited', false, 'reason', 'full'),
  'once Ben confirms, Thursday is full (confirmed >= headcount + buffer) and nobody else is invited');
select is((select count(*)::int from bookings where shift_id = :'s' and staff_id = :'w10'), 0,
  'and no booking was written for Jo');

-- ---------------------------------------------------------------------
-- 5 · Refusals by name
-- ---------------------------------------------------------------------
select is(office_invite_worker(:'s2', :'w4') ->> 'reason', 'blocked', 'blocked — compliance');
select is(office_invite_worker(:'s2', :'w5') ->> 'reason', 'do_not_return', 'do not return at this client');
select is(office_invite_worker(:'s2', :'w6') ->> 'reason', 'self_cancelled',
  'self-cancelled off this event: no manual invite either (RULE-04)');
select is(office_invite_worker(:'s2', :'w7') ->> 'reason', 'wrong_role', 'not signed off for the role');
select is(office_invite_worker(:'s2', :'w9') ->> 'reason', 'booked_elsewhere',
  'confirmed on an overlapping section');
select is(office_invite_worker(:'s2', :'w8') ->> 'reason', 'not_bookable',
  'a leaver cannot be manually added to any event (§10.6)');
select is(office_invite_worker(:'s4', :'w10') ->> 'reason', 'event_ended',
  'nothing is offered on a section that is over (RULE-16)');
select is(office_invite_worker(:'sx', :'w10') ->> 'reason', 'event_cancelled',
  'nor on a cancelled event');
reset role;

select is(
  (select count(*)::int from bookings b join staff s on s.id = b.staff_id
    where s.email like '%@mi550.test' and b.shift_id in (:'s2', :'s4', :'sx')
      and s.id in (:'w4', :'w5', :'w6', :'w7', :'w8', :'w9', :'w10')),
  0,
  'no refusal wrote a booking');
select is(
  (select count(*)::int from notification_outbox n join staff s on s.id = n.recipient_staff_id
    where s.email like '%@mi550.test' and n.template = 'N5'
      and s.id in (:'w4', :'w5', :'w6', :'w7', :'w8', :'w9', :'w10')),
  0,
  'nor queued an N5');

select * from finish();
rollback;
