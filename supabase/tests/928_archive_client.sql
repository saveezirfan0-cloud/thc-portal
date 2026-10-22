-- =====================================================================
-- 928 · archive_client() / restore_client() (20261022210000, ADR-0195)
--
--   A. Office only: a client login is refused, anon cannot execute.
--   B. A client with an event today or later is refused (the count in the
--      detail); a cancelled one or one in the past does not count.
--   C. Archiving sets archived_at / archived_by, audits client.archived,
--      and archiving again changes and audits nothing.
--   D. An archived client cannot have an event built for it, or moved to
--      it; an event it already has stays editable.
--   E. clients_directory_v carries archived_at; nothing is removed.
--   F. Restore clears it, audits client.restored, is a no-op when live,
--      and lets an event be built again.
--   G. archived_by without archived_at is refused by the table.
-- =====================================================================
begin;
select plan(26);
set local search_path = public, extensions;
\ir _shared/fixtures.psql

\set c_none   '92800000-0000-4000-8000-000000000001'
\set c_past   '92800000-0000-4000-8000-000000000002'
\set c_cancel '92800000-0000-4000-8000-000000000003'
\set e_past   '92800000-0000-4000-8000-0000000000a1'
\set e_cancel '92800000-0000-4000-8000-0000000000a2'
\set e_new    '92800000-0000-4000-8000-0000000000a3'

insert into clients (id, name, contact_name, phone, staff_contact_point, contact_emails, pays_breaks, pays_buffer) values
  (:'c_none',   'Archive 928 None',   'Ann', '+447700928001', 'Desk', array['a928@x.test'], true, true),
  (:'c_past',   'Archive 928 Past',   'Bea', '+447700928002', 'Desk', array['b928@x.test'], true, true),
  (:'c_cancel', 'Archive 928 Cancel', 'Cat', '+447700928003', 'Desk', array['c928@x.test'], true, true);

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer, cancelled_at) values
  (:'e_past', :'c_past', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Archive 928 past', current_date - 14, true, true, null),
  (:'e_cancel', :'c_cancel', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Archive 928 cancelled', current_date + 5, true, true, now());

-- ---- A · who can call it ---------------------------------------------
select ok(not has_function_privilege('anon', 'public.archive_client(uuid)', 'execute'),
  'anon cannot execute archive_client');
select ok(not has_function_privilege('anon', 'public.restore_client(uuid)', 'execute'),
  'anon cannot execute restore_client');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$select archive_client('aaaaaaaa-0000-4000-8000-000000000002')$$, '42501', 'admins_only',
  'a client login cannot archive');
select throws_ok($$select restore_client('aaaaaaaa-0000-4000-8000-000000000002')$$, '42501', 'admins_only',
  'a client login cannot restore');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

-- ---- B · upcoming events ----------------------------------------------
select throws_ok(format('select archive_client(%L)', :'clienta'), 'P0001', 'client_has_upcoming_events',
  'a client with an event today or later cannot be archived');
select is((select archived_at from clients_directory_v where id = :'clienta'), null,
  'and it stays live');
select throws_ok($$select archive_client('92800000-0000-4000-8000-0000000000ff')$$, 'P0002', null,
  'an unknown client is refused');

select lives_ok(format('select archive_client(%L)', :'c_past'),
  'a client with only past events can be archived');
select lives_ok(format('select archive_client(%L)', :'c_cancel'),
  'a cancelled future event does not count as upcoming');

-- ---- C · archive -------------------------------------------------------
select lives_ok(format('select archive_client(%L)', :'c_none'), 'a client with no events can be archived');
reset role;
select ok((select archived_at is not null from clients where id = :'c_none'), 'archived_at is set');
select is((select archived_by from clients where id = :'c_none'), :'admin_uid'::uuid, 'archived_by is the office user');
select is((select count(*)::int from audit_log where action = 'client.archived' and entity_id = :'c_none'), 1,
  'archiving is audited once');

set local role authenticated;
select lives_ok(format('select archive_client(%L)', :'c_none'), 'archiving again is allowed');
reset role;
select is((select count(*)::int from audit_log where action = 'client.archived' and entity_id = :'c_none'), 1,
  'and audits nothing more');

-- ---- D · no new event for an archived client ---------------------------
select throws_ok(
  format($f$insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer)
            values (%L, %L, %L, 'RLS Fixture Venue', '1 Test Street, London',
                    st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
                    'Archive 928 new', current_date + 9, true, true)$f$,
         :'e_new', :'c_past', :'venue_id'),
  'P0001', 'client_archived', 'an event cannot be built for an archived client');
select lives_ok(format('update events set title = %L where id = %L', 'Archive 928 past (edited)', :'e_past'),
  'an event the archived client already has stays editable');
select throws_ok(format('update events set client_id = %L where id = %L', :'c_past', 'eeeeeeee-0000-4000-8000-000000000001'),
  'P0001', 'client_archived', 'an event cannot be moved to an archived client');

-- ---- E · nothing removed, the directory shows it -----------------------
select is((select count(*)::int from events where client_id = :'c_past'), 1, 'its events are all still there');
select ok((select archived_at is not null from clients_directory_v where id = :'c_past'),
  'clients_directory_v carries archived_at');

-- ---- F · restore ---------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(format('select restore_client(%L)', :'c_past'), 'an archived client can be restored');
reset role;
select ok((select archived_at is null and archived_by is null from clients where id = :'c_past'), 'archived_at and archived_by are cleared');
select is((select count(*)::int from audit_log where action = 'client.restored' and entity_id = :'c_past'), 1,
  'restoring is audited once');
set local role authenticated;
select lives_ok(format('select restore_client(%L)', :'clienta'), 'restoring a live client is a no-op');
reset role;
select lives_ok(
  format($f$insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer)
            values (%L, %L, %L, 'RLS Fixture Venue', '1 Test Street, London',
                    st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
                    'Archive 928 new', current_date + 9, true, true)$f$,
         :'e_new', :'c_past', :'venue_id'),
  'an event can be built again once restored');

-- ---- G · the pair is whole -------------------------------------------------
select throws_ok(format('update clients set archived_by = %L where id = %L', :'admin_uid', :'c_past'),
  '23514', null, 'archived_by without archived_at is refused');

select * from finish();
rollback;
