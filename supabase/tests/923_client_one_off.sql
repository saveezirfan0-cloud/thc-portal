-- =====================================================================
-- 923 · One-off clients (ADR-0186)
--       — 20261023110000_client_one_off.sql
--
-- A flag the office sets on clients that will not order again, so the
-- qualification pickers and the directory can lead without them. It must
-- never become a gate: only the office may set it, a viewer is refused,
-- every change reaches the client's History, the directory view carries it,
-- and the client role still sees nothing new.
-- =====================================================================
begin;
select plan(24);
\ir _shared/fixtures.psql

\set viewer '92300000-0000-4000-8000-000000000001'
\set c_one   '92310000-0000-4000-8000-000000000001'
\set c_two   '92310000-0000-4000-8000-000000000002'

insert into auth.users (id, email) values (:'viewer', 'viewer.923@rls.test');
insert into profiles (id, role, office_role, full_name) values (:'viewer', 'admin', 'viewer', 'Vera Viewer');

insert into clients (id, name, contact_name, phone, staff_contact_point, contact_emails) values
  (:'c_one', 'Private Birthday 923', 'Pat', '+447700923001', 'Front', array['p1@rls.test']),
  (:'c_two', 'Private Wedding 923',  'Sam', '+447700923002', 'Front', array['p2@rls.test']);

-- 1-3 · The column
select col_not_null('public', 'clients', 'one_off', 'clients.one_off is never "not set"');
select col_default_is('public', 'clients', 'one_off', 'false', 'a client is regular unless the office says otherwise');
select is((select one_off from clients where id = :'c_one'), false, 'a new client is regular');

-- 4-8 · Who may call it
select ok(not has_function_privilege('anon', 'public.set_clients_one_off(uuid[], boolean)', 'execute'),
  'anon cannot call set_clients_one_off');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format('select set_clients_one_off(array[%L]::uuid[], true)', :'c_one'), '42501', 'admins_only',
  'a worker cannot mark a client one-off');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format('select set_clients_one_off(array[%L]::uuid[], true)', :'c_one'), '42501', 'admins_only',
  'a client cannot mark itself one-off');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_like(format('select set_clients_one_off(array[%L]::uuid[], true)', :'c_one'), '%read_only%',
  'a viewer cannot (ADR-0060)');
reset role;
select is((select one_off from clients where id = :'c_one'), false, 'and nothing changed');

-- 9-17 · The office
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select set_clients_one_off(array[:'c_one', :'c_two']::uuid[], true)), 2, 'the office marks two clients, 2 changed');
select is((select set_clients_one_off(array[:'c_one', :'c_two']::uuid[], true)), 0, 'doing it again changes nothing');
select is((select set_clients_one_off(array[]::uuid[], true)), 0, 'an empty list is a no-op');
select throws_ok(format('select set_clients_one_off(array[%L]::uuid[], null)', :'c_one'), '22004', 'one_off_must_be_on_or_off',
  'the flag has no "not set" state');
select throws_ok(format('select set_clients_one_off(array[%L]::uuid[], true)', '00000000-0000-4000-8000-000000000000'), 'P0002', null,
  'an unknown client is refused');
select is((select set_clients_one_off(array[:'c_one', :'c_one']::uuid[], false)), 1, 'a client named twice changes once');
reset role;

select is((select one_off from clients where id = :'c_one'), false, 'client one is back to regular');
select is((select one_off from clients where id = :'c_two'), true, 'client two is still one-off');
select is((select count(*)::int from audit_log
            where action = 'client.one_off' and entity = 'client' and entity_id = :'c_one'),
  2, 'two History rows for client one (on, off), none for the no-ops');

-- 18-19 · What the History says
select is((select data from audit_log
            where action = 'client.one_off' and entity_id = :'c_two'),
  '{"from": false, "to": true}'::jsonb, 'the History row says what it was and what it became');
select is((select count(*)::int from audit_log
            where action = 'client.one_off' and entity_id = :'c_two'),
  1, 'one row for client two');

-- 20-21 · The directory carries it, last
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select one_off from clients_directory_v where id = :'c_two'), true, 'clients_directory_v shows client two as one-off');
select is((select one_off from clients_directory_v where id = :'c_one'), false, 'and client one as regular');
reset role;

-- 22-23 · It gates nothing: an event can still be built for a one-off client
select lives_ok(format($$
  insert into events (client_id, venue_name, venue_address, venue_location, geofence_radius_m, title, event_date, pays_breaks, pays_buffer)
  values (%L, 'One-off Venue', '1 St', st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150, 'Second booking', date '2026-11-20', true, true)
$$, :'c_two'), 'an event can still be built for a one-off client');
select is((select count(*)::int from clients where id = :'c_two'), 1, 'and the client is still there (§9.7: never deleted)');

-- 24 · The client role still sees no table
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from clients where id = :'c_two'), 0, 'the client role reads no clients row (ADR-0026)');
reset role;

select * from finish();
rollback;
