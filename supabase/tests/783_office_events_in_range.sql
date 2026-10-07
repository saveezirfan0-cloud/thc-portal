-- =====================================================================
-- 783 · office_events_in_range — the Scheduling period in one read
--       20261007143000 · ADR-0103 (§3.1)
--
--   A. Shape: SECURITY INVOKER, so the caller's own row security applies;
--      not executable by anon or PUBLIC.
--   B. What it returns, as the office: the event, its client name, its role
--      sections in start order with headcount, buffer and the confirmed
--      count; only `confirmed` bookings are counted; an event with no
--      sections still appears (sections []); a cancelled event still comes
--      back (the app drops it, ADR-0099); the date range is inclusive and
--      events come back in date order; an empty period is [].
--   C. It reads no more than the separate reads did: for a client and for a
--      worker it returns exactly the events a direct select returns for them,
--      and anon cannot call it at all.
-- =====================================================================
begin;
select plan(20);
\ir _shared/fixtures.psql

\set event_c  '78300000-0000-4000-8000-000000000003'
\set event_d  '78300000-0000-4000-8000-000000000004'
\set event_e  '78300000-0000-4000-8000-000000000005'
\set shift_c1 '78300000-0000-4000-8000-0000000000c1'
\set shift_c2 '78300000-0000-4000-8000-0000000000c2'
\set booking_x '78300000-0000-4000-8000-0000000000b1'

-- event_c: two sections inserted LATEST FIRST, to prove the order is by start.
-- event_d: cancelled. event_e: no sections yet.
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, cancelled_at, cancel_reason) values
  (:'event_c', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Fixture Event C', current_date + 7, true, true, null, null),
  (:'event_d', :'clientb', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Fixture Event D', current_date + 8, true, true,
   now(), 'Client withdrew'),
  (:'event_e', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Fixture Event E', current_date + 9, true, true, null, null);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'shift_c1', :'event_c', :'role_id', now() + interval '7 days 18 hours', now() + interval '7 days 23 hours', 3, 0, 20.00, 13.00, 3),
  (:'shift_c2', :'event_c', :'role_id', now() + interval '7 days 9 hours',  now() + interval '7 days 15 hours', 5, 2, 20.00, 13.00, 7);

-- A booking that is NOT confirmed, on a section that also has a confirmed one:
-- the count must stay at 1.
insert into bookings (id, shift_id, staff_id, status, source) values
  (:'booking_x', :'shift_a', :'staffb', 'invited', 'auto');

-- =====================================================================
-- A · Shape
-- =====================================================================
select ok((select not p.prosecdef
             from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname = 'office_events_in_range'),
  'A: office_events_in_range is SECURITY INVOKER — the caller''s own row security applies');
select ok(not has_function_privilege('anon', 'public.office_events_in_range(date, date)', 'execute')
          and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                           where p.proname = 'office_events_in_range' and x.grantee = 0 and x.privilege_type = 'EXECUTE'),
  'A: not executable by anon or PUBLIC');
select ok(has_function_privilege('authenticated', 'public.office_events_in_range(date, date)', 'execute'),
  'A: executable by authenticated, whose rows row security then filters');

-- =====================================================================
-- B · What the office gets
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*)::int
             from jsonb_array_elements(public.office_events_in_range(current_date + 7, current_date + 9)) e
            where e ->> 'id' = :'event_a'), 1,
  'B: an event in the period comes back, once');

select is((select e ->> 'client_name'
             from jsonb_array_elements(public.office_events_in_range(current_date + 7, current_date + 9)) e
            where e ->> 'id' = :'event_a'), 'RLS Fixture Client A',
  'B: with its client''s name');

select is((select jsonb_array_length(e -> 'sections')
             from jsonb_array_elements(public.office_events_in_range(current_date + 7, current_date + 9)) e
            where e ->> 'id' = :'event_a'), 1,
  'B: and its role section');

select is((select (e -> 'sections' -> 0) - 'starts_at' - 'ends_at'
             from jsonb_array_elements(public.office_events_in_range(current_date + 7, current_date + 9)) e
            where e ->> 'id' = :'event_a'),
  '{"role_name":"RLS Fixture Role","headcount":6,"buffer":1,"confirmed":1}'::jsonb,
  'B: the section carries role name, headcount, buffer and the confirmed count');

select is((select (e -> 'sections' -> 0 ->> 'confirmed')::int
             from jsonb_array_elements(public.office_events_in_range(current_date + 7, current_date + 9)) e
            where e ->> 'id' = :'event_a'), 1,
  'B: an invited booking on the same section is not counted as confirmed');

reset role;
select is((select s.starts_at from shift_requirements s where s.id = :'shift_a'),
          (select (e -> 'sections' -> 0 ->> 'starts_at')::timestamptz
             from jsonb_array_elements(public.office_events_in_range(current_date + 7, current_date + 9)) e
            where e ->> 'id' = :'event_a'),
  'B: the section''s window comes back as the same instant');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select array_agg((s ->> 'headcount')::int order by ord)
             from jsonb_array_elements(public.office_events_in_range(current_date + 7, current_date + 9)) e,
                  jsonb_array_elements(e -> 'sections') with ordinality t(s, ord)
            where e ->> 'id' = :'event_c'), array[5, 3],
  'B: sections are in start order, not insertion order');

select is((select jsonb_array_length(e -> 'sections')
             from jsonb_array_elements(public.office_events_in_range(current_date + 7, current_date + 9)) e
            where e ->> 'id' = :'event_e'), 0,
  'B: an event with no sections yet still appears, with an empty list');

select is((select e ->> 'cancel_reason'
             from jsonb_array_elements(public.office_events_in_range(current_date + 7, current_date + 9)) e
            where e ->> 'id' = :'event_d'), 'Client withdrew',
  'B: a cancelled event still comes back, with its reason — the app drops it (ADR-0099)');

select is((select count(*)::int
             from jsonb_array_elements(public.office_events_in_range(current_date + 7, current_date + 7)) e
            where e ->> 'id' in (:'event_a', :'event_c')), 2,
  'B: the range includes both of its end dates (from)');
select is((select count(*)::int
             from jsonb_array_elements(public.office_events_in_range(current_date + 7, current_date + 7)) e
            where e ->> 'id' in (:'event_b', :'event_d', :'event_e')), 0,
  'B: and nothing after its last day');

select ok((select (select t.ord from jsonb_array_elements(public.office_events_in_range(current_date + 7, current_date + 9))
                     with ordinality t(e, ord) where e ->> 'id' = :'event_b')
              > (select t.ord from jsonb_array_elements(public.office_events_in_range(current_date + 7, current_date + 9))
                     with ordinality t(e, ord) where e ->> 'id' = :'event_a')),
  'B: events come back in date order');

select is(public.office_events_in_range(date '1990-01-01', date '1990-01-02'), '[]'::jsonb,
  'B: a period with no events is an empty array, not null');

-- =====================================================================
-- C · No wider than the separate reads
-- =====================================================================
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(jsonb_array_length(public.office_events_in_range(current_date + 7, current_date + 9)),
          (select count(*)::int from events where event_date between current_date + 7 and current_date + 9),
  'C: a client gets exactly the events its own row security shows it');
select is((select count(*)::int
             from jsonb_array_elements(public.office_events_in_range(current_date + 7, current_date + 9)) e
            where e ->> 'id' in (:'event_a', :'event_b')), 0,
  'C: and never the events row of its own or another client (ADR-0026)');

reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(jsonb_array_length(public.office_events_in_range(current_date + 7, current_date + 9)),
          (select count(*)::int from events where event_date between current_date + 7 and current_date + 9),
  'C: a worker gets exactly the events its own row security shows it');

reset role;
set local role anon;
select throws_ok($$select public.office_events_in_range(current_date, current_date)$$, '42501', null,
  'C: anon cannot call it');
reset role;

select * from finish();
rollback;
