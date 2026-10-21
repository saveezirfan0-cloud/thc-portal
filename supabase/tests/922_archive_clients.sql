-- =====================================================================
-- 922 · Archive a client (ADR-0185) — 20261022210000_archive_clients.sql
--
-- Archiving takes a client off the active list and out of the Shift
-- Builder. It removes nothing, so §9.7's "no Delete" still holds. Pinned
-- here: who may archive and restore (office only, a viewer refused), that
-- an event today or later blocks it but a cancelled or past one does not,
-- that no new event can be built for an archived client while the events
-- it already has stay editable, the History rows, and the directory view.
-- =====================================================================
begin;
select plan(32);
\ir _shared/fixtures.psql

\set viewer  '92200000-0000-4000-8000-000000000001'
\set c_live  '92210000-0000-4000-8000-000000000001'
\set c_busy  '92210000-0000-4000-8000-000000000002'
\set c_done  '92210000-0000-4000-8000-000000000003'
\set ev_busy '92220000-0000-4000-8000-000000000001'
\set ev_canc '92220000-0000-4000-8000-000000000002'
\set ev_past '92220000-0000-4000-8000-000000000003'

insert into auth.users (id, email) values (:'viewer', 'viewer.922@rls.test');
insert into profiles (id, role, office_role, full_name) values (:'viewer', 'admin', 'viewer', 'Vera Viewer');

insert into clients (id, name, contact_name, phone, staff_contact_point, contact_emails, pays_breaks, pays_buffer) values
  (:'c_live', 'Archive Live Client', 'Ann A', '+447700922001', 'Desk', array['live@rls.test'], true, true),
  (:'c_busy', 'Archive Busy Client', 'Ben B', '+447700922002', 'Desk', array['busy@rls.test'], true, true),
  (:'c_done', 'Archive Done Client', 'Cal C', '+447700922003', 'Desk', array['done@rls.test'], true, true);

-- c_busy: an event two days from now. c_done: one cancelled event ahead and
-- one past event, neither of which is "still to come".
insert into events (id, client_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, cancelled_at) values
  (:'ev_busy', :'c_busy', 'Archive Venue', '1 Archive St', st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150,
   'Upcoming Dinner', current_date + 2, true, true, null),
  (:'ev_canc', :'c_done', 'Archive Venue', '1 Archive St', st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150,
   'Cancelled Dinner', current_date + 2, true, true, now()),
  (:'ev_past', :'c_done', 'Archive Venue', '1 Archive St', st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150,
   'Past Dinner', current_date - 5, true, true, null);

-- =====================================================================
-- The columns and who can reach the functions
-- =====================================================================
select col_is_null('public', 'clients', 'archived_at', 'a client is live until it is archived');
select col_is_null('public', 'clients', 'archived_by', 'and nobody is recorded as having archived a live client');
select ok(not has_function_privilege('anon', 'public.archive_client(uuid)', 'execute'), 'anon cannot call archive_client');
select ok(not has_function_privilege('anon', 'public.restore_client(uuid)', 'execute'), 'anon cannot call restore_client');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'delete_client'),
  0, 'archiving did not add a delete_client: a client record is still never removed (§9.7)');

-- =====================================================================
-- Who may archive
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format('select archive_client(%L)', :'c_live'), '42501', 'admins_only', 'a worker cannot archive a client');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format('select archive_client(%L)', :'c_live'), '42501', 'admins_only', 'a client cannot archive');
select throws_ok(format('select restore_client(%L)', :'c_live'), '42501', 'admins_only', 'a client cannot restore');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_like(format('select archive_client(%L)', :'c_live'), '%read_only%', 'a viewer cannot (ADR-0060)');
reset role;
select is((select archived_at from clients where id = :'c_live'), null, 'and nothing changed');

-- =====================================================================
-- The office archives
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(format('select archive_client(%L)', '00000000-0000-4000-8000-000000000000'), 'P0002', null,
  'an unknown client is refused');
select throws_ok(format('select archive_client(%L)', :'c_busy'), 'P0001', 'client_has_upcoming_events',
  'a client with an event still to come cannot be archived');
select lives_ok(format('select archive_client(%L)', :'c_live'), 'the office archives a client with no events');
select lives_ok(format('select archive_client(%L)', :'c_live'), 'archiving it again is a no-op');
select lives_ok(format('select archive_client(%L)', :'c_done'),
  'a cancelled event ahead and a past event do not block archiving');
reset role;

select ok((select archived_at is not null and archived_by = :'admin_uid' from clients where id = :'c_live'),
  'the client carries when it was archived and by whom');
select is((select archived_at from clients where id = :'c_busy'), null, 'the refused client is still live');
select is((select count(*)::int from audit_log where action = 'client.archived' and entity_id = :'c_live'),
  1, 'one History row for the archive, none for the no-op');

-- Nothing about the client's history moved.
select is((select count(*)::int from events where client_id = :'c_done'), 2,
  'archiving removed none of the client''s events');

-- =====================================================================
-- The directory view
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select ok((select archived_at is not null from clients_directory_v where id = :'c_live'),
  'clients_directory_v says the client is archived');
select ok((select archived_at is null from clients_directory_v where id = :'c_busy'),
  'and that a live client is not');
select is((select count(*)::int from clients_directory_v where id in (:'c_live', :'c_done')), 2,
  'an archived client is still in the directory view: hiding it is the screen''s default, not a deletion');
reset role;

-- =====================================================================
-- No new event for an archived client
-- =====================================================================
select throws_ok(format($$ insert into events (client_id, venue_name, venue_address, venue_location, geofence_radius_m,
                             title, event_date, pays_breaks, pays_buffer)
                           values (%L, 'V', 'A', st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150,
                                   'Nope', current_date + 5, true, true) $$, :'c_live'),
  'P0001', 'client_archived', 'no event can be built for an archived client');
select lives_ok(format($$ update events set title = 'Past Dinner (edited)' where id = %L $$, :'ev_past'),
  'an event the archived client already has stays editable');
select lives_ok(format($$ update events set title = 'Past Dinner again', client_id = client_id where id = %L $$, :'ev_past'),
  'including an edit that sends the whole row back');
select throws_ok(format($$ update events set client_id = %L where id = %L $$, :'c_done', :'ev_busy'),
  'P0001', 'client_archived', 'and an event cannot be moved to an archived client');
select lives_ok(format($$ insert into events (client_id, venue_name, venue_address, venue_location, geofence_radius_m,
                            title, event_date, pays_breaks, pays_buffer)
                          values (%L, 'V', 'A', st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150,
                                  'Fine', current_date + 5, true, true) $$, :'c_busy'),
  'a live client still gets new events');

-- =====================================================================
-- Restore
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(format('select restore_client(%L)', :'c_live'), 'the office restores the client');
select lives_ok(format('select restore_client(%L)', :'c_live'), 'restoring a live client is a no-op');
reset role;

select ok((select archived_at is null and archived_by is null from clients where id = :'c_live'),
  'restored: live again, nobody recorded as archiving it');
select is((select count(*)::int from audit_log where action = 'client.restored' and entity_id = :'c_live'),
  1, 'one History row for the restore, none for the no-op');
select lives_ok(format($$ insert into events (client_id, venue_name, venue_address, venue_location, geofence_radius_m,
                            title, event_date, pays_breaks, pays_buffer)
                          values (%L, 'V', 'A', st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150,
                                  'Back again', current_date + 6, true, true) $$, :'c_live'),
  'a restored client can have events built for it again');

select * from finish();
rollback;
