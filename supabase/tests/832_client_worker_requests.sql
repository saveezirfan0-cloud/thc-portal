-- =====================================================================
-- 832 · "Request this person again" (§11.2, §9.7, §8; ADR-0004,
--       ADR-0026, ADR-0060, ADR-0135 §2)
--       — 20261014170100_client_worker_requests.sql
--
-- A customer can ask THC for a worker again from a finished event — a
-- message, never a booking:
--   · client_worker_requests: RLS on, admin_read only, no client or staff
--     policy, the office_read_only guard;
--   · client_request_worker(): the booking must be on the caller's
--     VISIBLE line-up (tenancy, confirmed, the headcount trim), the event
--     finished and not cancelled, the worker not removed; a repeat while
--     open answers {already: true}; 20 a day per client; one row and one
--     CP1 office email with a unique key; nothing written to bookings or
--     client_qualifications;
--   · client_worker_requests_v / client_lineup_v.worker_requested: the
--     customer's own open requests only;
--   · mark_client_worker_request_handled(): office only, audited once.
-- =====================================================================
begin;
select plan(43);
\ir _shared/fixtures.psql

\set ev_done 'e8320000-0000-4000-8000-000000000001'
\set ev_live 'e8320000-0000-4000-8000-000000000002'
\set ev_canc 'e8320000-0000-4000-8000-000000000003'
\set ev_b    'e8320000-0000-4000-8000-000000000004'
\set ev_old  'e8320000-0000-4000-8000-000000000005'
\set sh_done 'f8320000-0000-4000-8000-000000000001'
\set sh_live 'f8320000-0000-4000-8000-000000000002'
\set sh_canc 'f8320000-0000-4000-8000-000000000003'
\set sh_b    'f8320000-0000-4000-8000-000000000004'
\set sh_old  'f8320000-0000-4000-8000-000000000005'
\set s1 'd8320000-0000-4000-8000-000000000001'
\set s2 'd8320000-0000-4000-8000-000000000002'
\set s3 'd8320000-0000-4000-8000-000000000003'
\set s4 'd8320000-0000-4000-8000-000000000004'
\set k1 '08320000-0000-4000-8000-000000000001'
\set k2 '08320000-0000-4000-8000-000000000002'
\set k3 '08320000-0000-4000-8000-000000000003'
\set k4 '08320000-0000-4000-8000-000000000004'
\set kl '08320000-0000-4000-8000-000000000011'
\set kc '08320000-0000-4000-8000-000000000021'
\set kb '08320000-0000-4000-8000-000000000031'
\set ko '08320000-0000-4000-8000-000000000041'

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'s1', 98321, 'Again', 'One',   'again1-832@rls.test', '+447700983201', date '1996-01-01', 'compliant'),
  (:'s2', 98322, 'Again', 'Two',   'again2-832@rls.test', '+447700983202', date '1996-01-02', 'compliant'),
  (:'s3', 98323, 'Again', 'Three', 'again3-832@rls.test', '+447700983203', date '1996-01-03', 'compliant'),
  (:'s4', 98324, 'Again', 'Four',  'again4-832@rls.test', '+447700983204', date '1996-01-04', 'compliant');

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer) values
  (:'ev_done', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Finished gala', current_date - 1, true, true),
  (:'ev_live', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Still running', current_date, true, true),
  (:'ev_canc', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Cancelled lunch', current_date - 2, true, true),
  (:'ev_b',    :'clientb', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Client B dinner', current_date - 1, true, true),
  (:'ev_old',  :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Older party', current_date - 20, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour) values
  (:'sh_done', :'ev_done', :'role_id', now() - interval '30 hours',  now() - interval '22 hours', 2, 1, 22.97, 14.00, null, 6),
  (:'sh_live', :'ev_live', :'role_id', now() - interval '1 hour',    now() + interval '5 hours',  2, 0, 22.97, 14.00, null, 6),
  (:'sh_canc', :'ev_canc', :'role_id', now() - interval '54 hours',  now() - interval '46 hours', 2, 0, 22.97, 14.00, null, 6),
  (:'sh_b',    :'ev_b',    :'role_id', now() - interval '30 hours',  now() - interval '22 hours', 2, 0, 22.97, 14.00, null, 6),
  (:'sh_old',  :'ev_old',  :'role_id', now() - interval '20 days',   now() - interval '20 days' + interval '6 hours', 2, 0, 22.97, 14.00, null, 6);

update events set cancelled_at = now() - interval '3 days', cancel_reason = 'AUDIT test' where id = :'ev_canc';

-- Finished: k1 and k2 hold the two seats (confirmed first), k3 is THC's
-- buffer past the headcount (never shown); k4 is on the older event.
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'k1', :'sh_done', :'s1', 'worked',    'auto', now() - interval '9 days'),
  (:'k2', :'sh_done', :'s2', 'worked',    'auto', now() - interval '8 days'),
  (:'k3', :'sh_done', :'s3', 'confirmed', 'auto', now() - interval '7 days'),
  (:'ko', :'sh_old',  :'s1', 'worked',    'auto', now() - interval '25 days'),
  (:'k4', :'sh_old',  :'s4', 'worked',    'auto', now() - interval '25 days'),
  (:'kl', :'sh_live', :'s2', 'confirmed', 'auto', now() - interval '3 days'),
  (:'kc', :'sh_canc', :'s2', 'confirmed', 'auto', now() - interval '9 days'),
  (:'kb', :'sh_b',    :'s3', 'worked',    'auto', now() - interval '9 days');

create temporary table counts_before as
  select (select count(*) from bookings) as bookings,
         (select count(*) from client_qualifications) as quals;

-- ---------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.client_worker_requests'::regclass),
  'client_worker_requests has RLS on');
select bag_eq(
  $$ select polname::text from pg_policy where polrelid = 'public.client_worker_requests'::regclass $$,
  $$ values ('admin_read'::text) $$,
  'one policy, admin_read: no client, no staff, no write policy (ADR-0026)');
select ok(exists (select 1 from pg_trigger
                   where tgrelid = 'public.client_worker_requests'::regclass and tgname = 'office_read_only'),
  'the office_read_only guard is on the table (ADR-0060)');
select ok(not has_function_privilege('anon', 'public.client_request_worker(uuid, text)', 'execute')
          and has_function_privilege('authenticated', 'public.client_request_worker(uuid, text)', 'execute')
          and not has_function_privilege('anon', 'public.mark_client_worker_request_handled(uuid)', 'execute'),
  'the two functions are closed to anon and open to a signed-in caller, who is checked inside');
select ok(not (coalesce((select reloptions from pg_class where relname = 'client_worker_requests_v'), '{}') @> '{security_invoker=true}')
          and (coalesce((select reloptions from pg_class where relname = 'client_worker_requests_v'), '{}') @> '{security_barrier=true}')
          and pg_get_viewdef('client_worker_requests_v'::regclass) ~ 'client_portal_visible\(q\.client_id\)'
          and not has_table_privilege('anon', 'client_worker_requests_v', 'select')
          and not has_table_privilege('authenticated', 'client_worker_requests_v', 'insert'),
  'client_worker_requests_v has ADR-0004''s shape');
select bag_eq(
  $$ select column_name::text from information_schema.columns
      where table_schema = 'public' and table_name = 'client_worker_requests_v' $$,
  $$ values ('id'::text), ('booking_id'), ('event_id'), ('name'), ('role'), ('note'), ('requested_at') $$,
  'client_worker_requests_v names its columns: no staff id, nothing about the office''s handling');
select ok((coalesce((select reloptions from pg_class where relname = 'clients_worker_requests_v'), '{}') @> '{security_invoker=true}'),
  'the office''s view runs with the caller''s rights');

-- ---------------------------------------------------------------------
-- As Client A
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((client_request_worker(:'k1', '  Brilliant with our VIP table — please send again.  ') ->> 'already'), 'false',
  'a finished event''s worker can be asked for again');
select is((client_request_worker(:'ko', 'From the older party') ->> 'already'), 'true',
  'the same worker again — from another event — while open: "already", no second request');
select is((select count(*)::int from client_worker_requests_v), 1,
  'the customer sees one open request');
select results_eq(
  $$ select name, note, event_id::text from client_worker_requests_v $$,
  $$ values ('Again One'::text, 'Brilliant with our VIP table — please send again.'::text,
             'e8320000-0000-4000-8000-000000000001'::text) $$,
  'with the name, the trimmed note and the event it was asked from');
select is((select bool_and(worker_requested) from client_lineup_v where booking_id in (:'k1', :'ko')), true,
  'every row of that worker reads "✓ Requested", on both events');
select is((select worker_requested from client_lineup_v where booking_id = :'k2'), false,
  'nobody else does');
select is((select count(*)::int from client_worker_requests), 0,
  'the client reads nothing from the table itself (no policy)');
select throws_ok(
  format($$ insert into client_worker_requests (client_id, staff_id) values (%L, %L) $$, :'clienta', :'s2'),
  '42501', null, 'the client cannot write the table directly');

select throws_ok(format($$ select client_request_worker(%L, %L) $$, :'k2', repeat('x', 501)),
  '22023', 'request_note_too_long', 'a note over 500 characters is refused');
select throws_ok(format($$ select client_request_worker(%L, null) $$, :'k3'),
  '42501', 'That booking is not on your line-up',
  'THC''s buffer worker the customer never saw cannot be asked for (the headcount trim)');
select throws_ok(format($$ select client_request_worker(%L, null) $$, :'kl'),
  '22023', 'request_after_event', 'not before the event has finished');
select throws_ok(format($$ select client_request_worker(%L, null) $$, :'kc'),
  '42501', 'That booking is not on your line-up', 'not on a cancelled event');
select throws_ok(format($$ select client_request_worker(%L, null) $$, :'kb'),
  '42501', 'That booking is not on your line-up', 'not another customer''s worker');
select throws_ok(format($$ select client_request_worker(%L, null) $$, :'new_id'),
  '42501', 'That booking is not on your line-up', 'not an unknown booking — the same sentence');
reset role;

update staff set removed_at = now() where id = :'s4';
set local role authenticated;
select throws_ok(format($$ select client_request_worker(%L, null) $$, :'k4'),
  '22023', 'worker_removed', 'not a removed worker (§1.7)');
reset role;
update staff set removed_at = null where id = :'s4';

select is((select count(*)::int from client_worker_requests where client_id = :'clienta'), 1,
  'one row in all, after one request, one repeat and seven refusals');
select results_eq(
  $$ select template, channel::text, recipient_emails = array['admin@thehospitalitycompany.co.uk'], payload ->> 'name', payload ->> 'client',
            payload ->> 'clientNote', payload ->> 'employeeId'
       from notification_outbox
      where key = 'CP1:request:' || (select id::text from client_worker_requests
                                      where staff_id = 'd8320000-0000-4000-8000-000000000001') $$,
  $$ values ('CP1'::text, 'email'::text, true, 'Again One'::text, 'RLS Fixture Client A'::text,
             'Brilliant with our VIP table — please send again.'::text, '98321'::text) $$,
  'one CP1 office email, keyed by the request, the register''s recipients (admin@), values only');
select is((select count(*)::int from notification_outbox where template = 'CP1'
            and payload ->> 'staffId' = :'s1'), 1,
  'the repeat queued nothing');
select results_eq(
  $$ select (select count(*) from bookings), (select count(*) from client_qualifications) $$,
  $$ select bookings, quals from counts_before $$,
  'nothing was written to bookings or client_qualifications');

-- ---------------------------------------------------------------------
-- Another customer, a worker, the admin
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'clientb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_worker_requests_v), 0,
  'Client B sees none of Client A''s requests');
select is((select count(*)::int from client_lineup_v where worker_requested), 0,
  '… and no "✓ Requested" from them on its own line-up');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select client_request_worker(%L, null) $$, :'k1'),
  '42501', 'Only the Client Portal asks for a worker again', 'a worker cannot call it');
select is((select count(*)::int from client_worker_requests), 0, 'a worker reads nothing');
select is((select count(*)::int from client_worker_requests_v), 0, '… through the view either');
select throws_ok(format($$ select mark_client_worker_request_handled(%L) $$, :'new_id'),
  '42501', 'admins_only', 'a worker cannot mark anything handled');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select client_request_worker(%L, null) $$, :'k2'),
  '42501', 'Only the Client Portal asks for a worker again', 'the office does not ask through the portal''s function');
select results_eq(
  $$ select worker_name, employee_id, event_title, role, requested_by_name, handled_at is null
       from clients_worker_requests_v where client_id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  $$ values ('Again One'::text, 98321, 'Finished gala'::text, 'RLS Fixture Role'::text,
             'Client A user'::text, true) $$,
  'the office reads the request on the client card''s view: who, where, which role, who asked');
select lives_ok(
  format($$ select mark_client_worker_request_handled(id) from client_worker_requests where staff_id = %L $$, :'s1'),
  'the office marks it handled');
select lives_ok(
  format($$ select mark_client_worker_request_handled(id) from client_worker_requests where staff_id = %L $$, :'s1'),
  '… and again, harmlessly');
reset role;

select is((select count(*)::int from audit_log
            where action = 'client.worker_request_handled' and entity = 'client'
              and entity_id = :'clienta' and actor = :'admin_uid'), 1,
  'audited once, on the client''s History, by the person who pressed it');
select ok((select not (data ? 'name') and not (data ? 'note') and data ? 'staffId'
             from audit_log where action = 'client.worker_request_handled' and entity_id = :'clienta'),
  'the audit row carries ids, not the name or the note');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select is((select count(*)::int from client_worker_requests_v), 0,
  'handled: off the customer''s open list');
select is((select worker_requested from client_lineup_v where booking_id = :'k1'), false,
  '… and the row offers "Request again" once more');
select throws_ok(format($$ select mark_client_worker_request_handled(%L) $$, :'new_id'),
  '42501', 'admins_only', 'the customer cannot mark anything handled');
reset role;

-- ---------------------------------------------------------------------
-- The daily ceiling: twenty a day per client
-- ---------------------------------------------------------------------
insert into client_worker_requests (client_id, staff_id, created_at, handled_at)
select :'clienta', :'s3', now() - interval '1 hour', now() from generate_series(1, 19);
set local role authenticated;
select throws_ok(format($$ select client_request_worker(%L, null) $$, :'k2'),
  'P0001', 'request_limit_reached', 'a 21st request inside 24 hours is refused');
reset role;
update client_worker_requests set created_at = now() - interval '25 hours'
 where client_id = :'clienta' and staff_id = :'s3';
set local role authenticated;
select is((client_request_worker(:'k2', null) ->> 'already'), 'false',
  'outside the 24 hours the customer can ask again');
reset role;

select * from finish();
rollback;
