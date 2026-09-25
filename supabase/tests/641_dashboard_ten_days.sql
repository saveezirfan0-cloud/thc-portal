-- =====================================================================
-- 641 · "Upcoming events · next 10 days" is ten days (§9.1)
--
-- Migration 20260929160200. dashboard_upcoming_v took today .. today + 10
-- inclusive — eleven days. Ten days is today and the nine after it, in
-- Europe/London.
-- =====================================================================
begin;
select plan(5);
\ir _shared/fixtures.psql

\set d0_event  '64100000-0000-4000-8000-000000000001'
\set d9_event  '64100000-0000-4000-8000-000000000002'
\set d10_event '64100000-0000-4000-8000-000000000003'

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer)
select v.id::uuid, :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
       st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
       v.title, (now() at time zone 'Europe/London')::date + v.days, true, true
  from (values (:'d0_event',  'Ten-day Today', 0),
               (:'d9_event',  'Ten-day Day 9', 9),
               (:'d10_event', 'Ten-day Day 10', 10)) as v(id, title, days);

-- One four-hour section each, midday UK on its own day, so the start and
-- the event date agree whatever time the suite runs.
insert into shift_requirements (event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour)
select e.id, :'role_id',
       (e.event_date + time '12:00') at time zone 'Europe/London',
       (e.event_date + time '16:00') at time zone 'Europe/London',
       2, 0, 22.97, 14.00, 'All black', 2
  from events e where e.id in (:'d0_event', :'d9_event', :'d10_event');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*)::int from dashboard_upcoming_v where event_id = :'d0_event'), 1,
  'today is the first of the ten days');
select is((select count(*)::int from dashboard_upcoming_v where event_id = :'d9_event'), 1,
  'today + 9 is the tenth day, and is on the list');
select is((select count(*)::int from dashboard_upcoming_v where event_id = :'d10_event'), 0,
  'today + 10 would be the eleventh day, and is not (§9.1 "10 days ahead")');

reset role;

select ok((select 'security_invoker=true' = any(reloptions) from pg_class where relname = 'dashboard_upcoming_v')
          and (select 'security_barrier=true' = any(reloptions) from pg_class where relname = 'dashboard_upcoming_v'),
  'dashboard_upcoming_v keeps security_invoker and security_barrier');
select ok(not has_table_privilege('anon', 'dashboard_upcoming_v', 'select'),
  'anon still has no privilege on dashboard_upcoming_v');

select * from finish();
rollback;
