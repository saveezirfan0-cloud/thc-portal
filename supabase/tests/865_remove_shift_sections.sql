-- =====================================================================
-- 865 · Removing a role section with only pending offers on it (ADR-0160)
--   20261019170500_remove_shift_sections.sql
--
--   1. Who may call it: admin only; definer; not anon.
--   2. Anyone confirmed on any section asked for: has_people, and
--      nothing is deleted or queued — not even the other sections.
--   3. Pending applications and an invitation only: each worker is told
--      (N10e / N10d, with {event} and {dateTime}), who was told is
--      audited, and the section goes with its offers.
--   4. An empty section: removed, nobody told, no offers audit row.
--   5. An unknown event is an error.
-- =====================================================================
begin;
select plan(24);
\ir _shared/fixtures.psql

select cap_week_start(current_date) + 14 as w \gset

\set ro  '85100000-0000-4000-8000-000000000001'
\set ev  '85100000-0000-4000-8000-0000000000e1'
\set sa  '85110000-0000-4000-8000-00000000000a'
\set sb  '85110000-0000-4000-8000-00000000000b'
\set sc  '85110000-0000-4000-8000-00000000000c'
\set w1  '85120000-0000-4000-8000-000000000001'
\set w2  '85120000-0000-4000-8000-000000000002'
\set w3  '85120000-0000-4000-8000-000000000003'
\set w4  '85120000-0000-4000-8000-000000000004'
\set w5  '85120000-0000-4000-8000-000000000005'

insert into roles (id, name, pay_rate) values (:'ro', 'Remove Waiting Staff', 14.00);
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Remove Gala', :'w'::date + 3, true, true);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'sa', :'ev', :'ro', (:'w'::date + 3 + time '17:00') at time zone 'Europe/London',
                        (:'w'::date + 3 + time '23:00') at time zone 'Europe/London', 5, 0, 22, 14, 5),
  (:'sb', :'ev', :'ro', (:'w'::date + 3 + time '07:00') at time zone 'Europe/London',
                        (:'w'::date + 3 + time '16:00') at time zone 'Europe/London', 3, 0, 22, 14, 3),
  (:'sc', :'ev', :'ro', (:'w'::date + 3 + time '12:00') at time zone 'Europe/London',
                        (:'w'::date + 3 + time '18:00') at time zone 'Europe/London', 2, 0, 22, 14, 2);
insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'w1', 'Ada', 'Confirmed', 'w1@rm851.test', '+447700985101', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'w2', 'Ben', 'AppliedA',  'w2@rm851.test', '+447700985102', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'w3', 'Cai', 'AppliedB',  'w3@rm851.test', '+447700985103', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'w4', 'Dee', 'AppliedB',  'w4@rm851.test', '+447700985104', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'w5', 'Eve', 'InvitedB',  'w5@rm851.test', '+447700985105', date '1995-01-01', 'compliant', 'uk_irish');
insert into staff_roles (staff_id, role_id) select id, :'ro' from staff where email like '%@rm851.test';

insert into bookings (shift_id, staff_id, status, source, confirmed_at, applied_at) values
  (:'sa', :'w1', 'confirmed', 'auto', now(), null),
  (:'sa', :'w2', 'applied',   'self', null,  now()),
  (:'sb', :'w3', 'applied',   'self', null,  now()),
  (:'sb', :'w4', 'applied',   'self', null,  now()),
  (:'sb', :'w5', 'invited',   'auto', null,  null);

-- ---------------------------------------------------------------------
-- 1 · Who may call it
-- ---------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.remove_shift_sections(uuid, uuid[])', 'execute'),
  'anon cannot execute remove_shift_sections');
select ok(has_function_privilege('authenticated', 'public.remove_shift_sections(uuid, uuid[])', 'execute'),
  'the office reaches it as authenticated; the admin check inside is the gate');
select ok((select prosecdef from pg_proc where oid = 'public.remove_shift_sections(uuid, uuid[])'::regprocedure),
  'remove_shift_sections is security definer');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select remove_shift_sections(%L, array[%L]::uuid[]) $$, :'ev', :'sc'),
  '42501', 'not_authorised', 'a worker cannot remove a role section');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select remove_shift_sections(%L, array[%L]::uuid[]) $$, :'ev', :'sc'),
  '42501', 'not_authorised', 'nor can a client, on their own event');
reset role;
select is((select count(*)::int from shift_requirements where event_id = :'ev'), 3, 'and every section is still there');

-- ---------------------------------------------------------------------
-- 2 · Someone confirmed: has_people, all or nothing
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(remove_shift_sections(:'ev', array[:'sa', :'sb']::uuid[]),
  jsonb_build_object('ok', false, 'reason', 'has_people', 'held', 1),
  'Ada is confirmed on one of the two: refused by name (§3.6 — Withdraw first)');
reset role;
select is((select count(*)::int from shift_requirements where id in (:'sa', :'sb')), 2,
  'neither section is deleted — not even the one with only applications on it');
select is((select count(*)::int from notification_outbox
            where template in ('N10d', 'N10e') and recipient_staff_id in (:'w2', :'w3', :'w4', :'w5')), 0,
  'and nobody is told anything');

-- ---------------------------------------------------------------------
-- 3 · Pending offers only: told, audited, removed
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(remove_shift_sections(:'ev', array[:'sb']::uuid[]),
  jsonb_build_object('ok', true, 'removed', 1, 'notified', 3),
  'two applications and an invitation, nobody confirmed: the role goes (client report 19.10)');
reset role;
select is((select count(*)::int from shift_requirements where id = :'sb'), 0, 'the section is deleted');
select is((select count(*)::int from bookings where shift_id = :'sb'), 0, 'with its pending offers');
select is((select count(*)::int from notification_outbox where template = 'N10e' and recipient_staff_id in (:'w3', :'w4')), 2,
  'each applicant is told by N10e — not N10c (it did not fill) and not N12 (the event goes on)');
select is((select count(*)::int from notification_outbox where template = 'N10d' and recipient_staff_id = :'w5'), 1,
  'the invitee is told by N10d, the office''s own "invitation withdrawn"');
select is((select payload ->> 'event' from notification_outbox where template = 'N10e' and recipient_staff_id = :'w3'),
  'Remove Gala', 'with {event}');
select is((select payload ->> 'dateTime' from notification_outbox where template = 'N10e' and recipient_staff_id = :'w3'),
  to_char(((:'w'::date + 3 + time '07:00') at time zone 'Europe/London') at time zone 'Europe/London', 'Dy DD Mon HH24:MI'),
  'and {dateTime}, the ROLE''s start in UK time');
select is((select jsonb_array_length(data -> 'applied') from audit_log
            where action = 'event.role_offers_closed' and entity_id = :'ev' and data ->> 'sectionId' = :'sb'
              and actor = :'admin_uid'::uuid), 2,
  'who applied is audited against the manager who saved');
select is((select jsonb_array_length(data -> 'invited') from audit_log
            where action = 'event.role_offers_closed' and data ->> 'sectionId' = :'sb'), 1,
  'and who was invited');
select is((select count(*)::int from audit_log where action = 'event.role_removed' and data ->> 'sectionId' = :'sb'), 1,
  'the section''s own removal is audited by shift_requirements_audit, as before');
select is((select count(*)::int from bookings where shift_id = :'sa'), 2,
  'the other role, with Ada confirmed on it, is untouched');
select is((select count(*)::int from notification_outbox where recipient_staff_id in (:'w1', :'w2')
             and template in ('N10d', 'N10e')), 0,
  'and nobody on it is told anything');

-- ---------------------------------------------------------------------
-- 4 · An empty section
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(remove_shift_sections(:'ev', array[:'sc']::uuid[]),
  jsonb_build_object('ok', true, 'removed', 1, 'notified', 0),
  'a section nobody is on is simply removed');
reset role;
select is((select count(*)::int from audit_log where action = 'event.role_offers_closed' and data ->> 'sectionId' = :'sc'), 0,
  'with no offers audit row: nobody was told');

-- ---------------------------------------------------------------------
-- 5 · An unknown event
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select remove_shift_sections('85100000-0000-4000-8000-0000000000ff', array[]::uuid[]) $$,
  'P0002', 'event_not_found', 'an unknown event is an error');
reset role;

select * from finish();
rollback;
