-- =====================================================================
-- 080 · The Venues directory (§9.11) — 0007_venues_directory.sql
--
-- Two things to prove. First, that the view really does answer what the
-- screen asks: the type label and default radius from venue_types, the pin
-- as plain lat/lng, and the two event counts split on "has taken place"
-- versus "is still upcoming". Second, that adding a view and three write
-- functions over `venues` widened nobody's access: they are all
-- security_invoker / security invoker, so a client and a worker must see
-- exactly as much of a venue through them as they do through the table
-- itself, which is nothing.
-- =====================================================================
begin;
select plan(40);
\ir _shared/fixtures.psql

-- The fixtures give the venue two events, both in the future (current_date
-- + 7 and + 8). Add one that has taken place and one that was cancelled,
-- so both sides of each count have something to find.
\set event_past      '7a7a7a7a-0000-4000-8000-000000000001'
\set event_cancelled '7a7a7a7a-0000-4000-8000-000000000002'
\set venue_new       '7a7a7a7a-0000-4000-8000-00000000000a'

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer, cancelled_at) values
  (:'event_past', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Fixture Event Past', current_date - 30, true, true, null),
  (:'event_cancelled', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Fixture Event Cancelled', current_date + 9, true, true, now());

-- ---------------------------------------------------------------------
-- Structure: both views must be security_invoker, or venues' RLS would be
-- bypassed and a worker would read the whole venue directory.
-- ---------------------------------------------------------------------
select ok((select 'security_invoker=true' = any(reloptions) from pg_class where relname = 'venue_directory_v'),
  'venue_directory_v is security_invoker');
select ok((select 'security_invoker=true' = any(reloptions) from pg_class where relname = 'venue_upcoming_events_v'),
  'venue_upcoming_events_v is security_invoker');

-- ---------------------------------------------------------------------
-- Admin (§9.11 is a Back Office screen)
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*)::int from venue_directory_v where id = :'venue_id'), 1,
  'admin reads the venue through venue_directory_v');
select is(
  (select array_agg(key order by sort_order)::text from venue_types where key <> 'rls_fixture_type'),
  '{restaurant_bar,hotel,private_residence,conference,exhibition,stadium,racecourse,outdoor,other}',
  'the standard-radius table keeps its §9.11 order, with Other last whatever its radius');
select is((select venue_type_label from venue_directory_v where id = :'venue_id'), 'Hotel',
  'the list shows the venue type label from venue_types, not the key');
select is((select default_radius_m from venue_directory_v where id = :'venue_id'), 150,
  'the type default radius travels with the row, so the modal never hard-codes it');
select is((select geofence_radius_m from venue_directory_v where id = :'venue_id'), 150,
  'the venue''s own radius is what the list column shows');
select is((select round(lat::numeric, 4) from venue_directory_v where id = :'venue_id'), 51.5000,
  'the pin latitude comes back as a plain number, not WKB');
select is((select round(lng::numeric, 4) from venue_directory_v where id = :'venue_id'), -0.1000,
  'the pin longitude comes back as a plain number, not WKB');

-- The counts: one past, two upcoming, and the cancelled one in neither.
select is((select events_past from venue_directory_v where id = :'venue_id'), 1,
  'Events counts only what has taken place (§9.11)');
select is((select events_upcoming from venue_directory_v where id = :'venue_id'), 2,
  'the delete confirmation''s count is the upcoming events, cancelled ones excluded');
select is((select count(*)::int from venue_upcoming_events_v where venue_id = :'venue_id'), 2,
  'admin lists the upcoming events the delete confirmation names');
select is((select count(*)::int from venue_upcoming_events_v
            where venue_id = :'venue_id' and event_id = :'event_cancelled'), 0,
  'a cancelled event is never named as a reason not to delete');

-- ---- the write functions ---------------------------------------------
select lives_ok(
  $$ select create_venue('  Fixture Created  ', '  9 New Street, London  ', 51.52, -0.11, 'stadium', 500) $$,
  'admin creates a venue through create_venue');
select is((select count(*)::int from venues where name = 'Fixture Created'), 1,
  'create_venue trims the name it was given');
select is((select address from venues where name = 'Fixture Created'), '9 New Street, London',
  'create_venue trims the reverse-geocoded address');
select is((select round(st_y(location::geometry)::numeric, 4) from venues where name = 'Fixture Created'), 51.5200,
  'create_venue puts latitude on the Y axis — st_makepoint takes longitude first');

select throws_ok(
  $$ select create_venue('No address', '   ', 51.52, -0.11, 'hotel', 150) $$,
  '23514', null, 'a venue cannot be created without an address the pin resolved to');
select throws_ok(
  $$ select create_venue('Off the globe', '9 New Street', 120.0, -0.11, 'hotel', 150) $$,
  '23514', null, 'a latitude outside ±90 is rejected by the database, not only by the form');
select throws_ok(
  $$ select create_venue('Too tight', '9 New Street', 51.52, -0.11, 'hotel', 50) $$,
  '23514', null, 'the 100–3000 m slider range is a database constraint too (§9.11)');

insert into venues (id, name, address, location, venue_type, geofence_radius_m) values
  (:'venue_new', 'Fixture Editable', '2 Test Street, London',
   st_setsrid(st_makepoint(-0.1001, 51.5001), 4326)::geography, 'hotel', 150);

select lives_ok(
  $$ select update_venue('7a7a7a7a-0000-4000-8000-00000000000a', 'Fixture Edited',
                         '3 Test Street, London', 51.6, -0.2, 'outdoor', 3000) $$,
  'admin edits a venue through update_venue');
select is((select geofence_radius_m from venues where id = :'venue_new'), 3000,
  'the edited radius is stored');

select lives_ok(
  $$ select delete_venue('7a7a7a7a-0000-4000-8000-00000000000a') $$,
  'admin deletes a venue');
select isnt((select deleted_at from venues where id = :'venue_new'), null,
  'delete is soft: the row stays so events keep resolving their venue_id (§9.11)');
select is((select count(*)::int from venue_directory_v where id = :'venue_new'), 0,
  'a deleted venue leaves the directory, so it leaves venue selection too (§9.11)');
select is((select count(*)::int from venues where id = :'venue_new'), 1,
  'and the row itself is still there for the events that reference it');
select throws_ok(
  $$ select delete_venue('7a7a7a7a-0000-4000-8000-00000000000a') $$,
  'P0002', null, 'deleting an already-deleted venue is rejected rather than silently repeated');
select throws_ok(
  $$ select update_venue('7a7a7a7a-0000-4000-8000-00000000000a', 'Resurrected',
                         '4 Test Street, London', 51.6, -0.2, 'hotel', 150) $$,
  'P0002', null, 'a deleted venue cannot be edited back into the directory');

-- ---------------------------------------------------------------------
-- Client — no policy on venues, so the new view shows them nothing.
-- Their own upcoming events still resolve, because that view reads events.
-- ---------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*)::int from venue_directory_v), 0,
  'a client reads no venue through venue_directory_v (§11.1)');
select is((select count(*)::int from venue_upcoming_events_v where venue_id = :'venue_id'), 0,
  'a client reads nothing through the venue''s upcoming-events view: the client role holds no policy on events at all (ADR-0026) — its own events come from client_events_v');

-- A client's update and delete fail differently from an insert: RLS filters
-- the row out first, so the function reports "no live venue" rather than a
-- privilege error. Both directions matter — silently matching zero rows is
-- how a write that should be refused looks like a write that did nothing.
select throws_ok(
  $$ select update_venue('cccccccc-0000-4000-8000-000000000001', 'Client edit',
                         '1 Test Street, London', 51.5, -0.1, 'hotel', 150) $$,
  'P0002', null, 'a client cannot edit a venue');
select throws_ok(
  $$ select delete_venue('cccccccc-0000-4000-8000-000000000001') $$,
  'P0002', null, 'a client cannot delete a venue');
select throws_ok(
  $$ select create_venue('Client venue', '1 Forged Street', 51.5, -0.1, 'hotel', 150) $$,
  '42501', null, 'a client cannot create a venue');

-- ---------------------------------------------------------------------
-- Worker — the geofence reaches them through their booking, never through
-- the directory, and they cannot write a venue.
-- ---------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*)::int from venue_directory_v), 0,
  'a worker reads no venue through venue_directory_v');
select is((select count(*)::int from venue_upcoming_events_v), 0,
  'a worker reads no event through venue_upcoming_events_v');
select throws_ok(
  $$ select create_venue('Forged', '1 Forged Street', 51.5, -0.1, 'hotel', 150) $$,
  '42501', null, 'a worker cannot create a venue: create_venue is security invoker, so RLS refuses');
select throws_ok(
  $$ select update_venue('cccccccc-0000-4000-8000-000000000001', 'Worker edit',
                         '1 Test Street, London', 51.5, -0.1, 'hotel', 3000) $$,
  'P0002', null, 'a worker cannot widen a geofence by editing the venue');
select throws_ok(
  $$ select delete_venue('cccccccc-0000-4000-8000-000000000001') $$,
  'P0002', null, 'a worker cannot delete a venue');

reset role;

-- Back on the migration role: every refused write above really did leave
-- the geofence alone. A write that is refused and a write that silently
-- matches no rows look the same from the caller's side, and the radius is
-- what decides whether a worker can check in at all (§5.1).
select is((select geofence_radius_m from venues where id = :'venue_id'), 150,
  'none of the refused writes moved the geofence a worker checks in against (§5.1)');
select is((select name from venues where id = :'venue_id'), 'RLS Fixture Venue',
  'nor renamed the venue');

select * from finish();
rollback;
