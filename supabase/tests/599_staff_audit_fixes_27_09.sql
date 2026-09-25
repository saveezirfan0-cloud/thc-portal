-- =====================================================================
-- 599 · Staff App audit fixes, 27.09
--       — 20260927182000_radar_week_meter_and_declaration_reads.sql
--
--   A. staff_week_meter() describes the CURRENT Mon–Sun week in
--      Europe/London: its Monday, its Sunday, the hours booked in it, the
--      calculated cap and the worker's roles — and it takes no id a
--      worker could point at a colleague.
--   B. staff_open_shifts() carries the venue pin, its geofence and the
--      worker's home pin for the detail's map, and nothing that was there
--      before has moved.
--   C. A worker's own session cannot read criminal_declarations at all —
--      not `details`, not the row — while staff_documents() still tells
--      them the declaration's status without the text (§10.7).
--
-- employee_id is 96xxx (330's convention: the seed holds 412-1042).
-- =====================================================================
begin;
select plan(20);
\ir _shared/fixtures.psql

\set cl      '59900000-0000-4000-8000-000000000001'
\set ro      '59900000-0000-4000-8000-000000000002'
\set ro2     '59900000-0000-4000-8000-000000000003'
\set ve      '59900000-0000-4000-8000-000000000004'
\set ev_now  '59900000-0000-4000-8000-000000000011'
\set ev_next '59900000-0000-4000-8000-000000000012'
\set sh_now  '59900000-0000-4000-8000-000000000021'
\set sh_next '59900000-0000-4000-8000-000000000022'
\set sh_open '59900000-0000-4000-8000-000000000023'
\set me      '59900000-0000-4000-8000-000000000031'
\set me_uid  '59900000-0000-4000-8000-0000000000a1'
\set bk_now  '59900000-0000-4000-8000-000000000041'
\set bk_next '59900000-0000-4000-8000-000000000042'
\set decl    '59900000-0000-4000-8000-000000000051'

insert into auth.users (id, email) values (:'me_uid', 'me@audit599.test');
insert into clients (id, name, contact_name, phone, staff_contact_point, contact_emails)
values (:'cl', 'Audit 599 Client', 'Cara C', '+447700900599', 'Front desk', array['c@audit599.test']);
insert into roles (id, name, pay_rate) values
  (:'ro',  'Audit 599 Waiting Staff', 14.00),
  (:'ro2', 'Audit 599 Bar Staff',     15.50);
insert into venues (id, name, address, location, venue_type, geofence_radius_m)
values (:'ve', 'Audit 599 Venue', '7 Test Street, London EC4V 5AJ',
        st_setsrid(st_makepoint(-0.0990, 51.5130), 4326)::geography, 'hotel', 150);

insert into staff (id, user_id, first_name, last_name, email, phone, dob, home_address,
                   home_location, status, employee_id, rtw_branch)
values (:'me', :'me_uid', 'Amara', 'Kalu', 'me@audit599.test', '+447700900321',
        date '1996-04-02', 'Flat 4, 22 Roman Road, London E2 0RY',
        st_setsrid(st_makepoint(-0.0500, 51.5300), 4326)::geography, 'compliant', 96001,
        'uk_irish');
insert into staff_roles (staff_id, role_id) values (:'me', :'ro'), (:'me', :'ro2');

-- Two events: one whose section starts later THIS UK week (or, on a Sunday
-- evening, is nudged so that it still does), one next week.
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer)
values
  (:'ev_now', :'cl', :'ve', 'Audit 599 Venue', '7 Test Street, London EC4V 5AJ',
   st_setsrid(st_makepoint(-0.0990, 51.5130), 4326)::geography, 150,
   'Audit 599 This Week', (now() at time zone 'Europe/London')::date, false, false),
  (:'ev_next', :'cl', :'ve', 'Audit 599 Venue', '7 Test Street, London EC4V 5AJ',
   st_setsrid(st_makepoint(-0.0990, 51.5130), 4326)::geography, 150,
   'Audit 599 Next Week', (now() at time zone 'Europe/London')::date + 7, false, false);

-- A 5 h section this week and an 8 h one next week, both confirmed. The
-- this-week section starts at 23:00 UK on the UK day of "now" would cross
-- midnight on a Sunday, so it is pinned to the week's Monday at 09:00 —
-- always inside the current Mon–Sun week and, for the booked-hours count,
-- the start is what matters (weekly_booked_hours).
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour)
values
  (:'sh_now', :'ev_now', :'ro',
   (cap_week_start((now() at time zone 'Europe/London')::date)::timestamp + interval '9 hours') at time zone 'Europe/London',
   (cap_week_start((now() at time zone 'Europe/London')::date)::timestamp + interval '14 hours') at time zone 'Europe/London',
   2, 0, 22.97, 14.00, 2),
  (:'sh_next', :'ev_next', :'ro',
   (cap_week_start((now() at time zone 'Europe/London')::date)::timestamp + interval '7 days 9 hours') at time zone 'Europe/London',
   (cap_week_start((now() at time zone 'Europe/London')::date)::timestamp + interval '7 days 17 hours') at time zone 'Europe/London',
   2, 0, 22.97, 14.00, 2),
  -- An open section next week, for the map columns.
  (:'sh_open', :'ev_next', :'ro2',
   (cap_week_start((now() at time zone 'Europe/London')::date)::timestamp + interval '8 days 18 hours') at time zone 'Europe/London',
   (cap_week_start((now() at time zone 'Europe/London')::date)::timestamp + interval '8 days 23 hours') at time zone 'Europe/London',
   3, 1, 24.00, 15.50, 3);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'bk_now',  :'sh_now',  :'me', 'confirmed', 'auto', now()),
  (:'bk_next', :'sh_next', :'me', 'confirmed', 'auto', now());

-- A Yes declaration with text the worker must never read back (§10.7).
insert into criminal_declarations (id, staff_id, source, answer, details, conviction_date, review_status)
values (:'decl', :'me', 'in_employment', true, 'The text the worker typed', date '2019-03-04', 'pending');

-- =====================================================================
-- A. staff_week_meter() — the current UK week, from the session
-- =====================================================================
select set_config('request.jwt.claims',
  json_build_object('sub', :'me_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((staff_week_meter()->>'weekStart')::date,
  cap_week_start((now() at time zone 'Europe/London')::date),
  'A1 weekStart is the Monday of the CURRENT Mon–Sun week in Europe/London');
select is((staff_week_meter()->>'weekEnd')::date,
  cap_week_start((now() at time zone 'Europe/London')::date) + 6,
  'A2 weekEnd is that week''s Sunday');
select is(extract(dow from (staff_week_meter()->>'weekStart')::date)::int, 1,
  'A3 and the Monday really is a Monday');
select is((staff_week_meter()->>'bookedHours')::numeric, 5.0,
  'A4 bookedHours counts the 5 h confirmed THIS week and not the 8 h next week');
select is((staff_week_meter()->>'capHours')::numeric, 48::numeric,
  'A5 capHours is the calculated RULE-20 ceiling — 48 h for a UK/Irish worker with no opt-out');
select is(staff_week_meter()->'roles', '["Audit 599 Bar Staff", "Audit 599 Waiting Staff"]'::jsonb,
  'A6 roles are the worker''s signed-off roles, sorted, for the strip''s first line');

-- Captured here, as the worker, and compared below as the owner:
-- weekly_booked_hours() is invoker-rights and shift_requirements has no
-- worker policy, so calling it directly as `authenticated` reads nothing.
select (staff_week_meter()->>'bookedHours')::numeric as meter_booked \gset

select throws_ok(
  format($$ select staff_week_meter(%L) $$, :'staffa'), '42501',
  'not_your_worker',
  'A8 a worker cannot ask for a colleague''s week');

reset role;
select is(:'meter_booked'::numeric,
  weekly_booked_hours(:'me', (now() at time zone 'Europe/London')::date),
  'A7 the figure is weekly_booked_hours()''s — the same helper the per-row cards use');
select ok(not has_function_privilege('anon', 'staff_week_meter(uuid)', 'execute'),
  'A9 a signed-out caller cannot execute it');
select ok(has_function_privilege('authenticated', 'staff_week_meter(uuid)', 'execute'),
  'A10 and a signed-in worker can — a missing grant is a dead strip');

-- =====================================================================
-- B. staff_open_shifts() — the map's inputs, appended
-- =====================================================================
select set_config('request.jwt.claims',
  json_build_object('sub', :'me_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select round(venue_lat::numeric, 4) || ',' || round(venue_lng::numeric, 4)
     from staff_open_shifts() where shift_id = :'sh_open'),
  '51.5130,-0.0990',
  'B1 the open row carries the venue pin (lat, lng) for the detail''s map');
select is((select geofence_radius_m from staff_open_shifts() where shift_id = :'sh_open'), 150,
  'B2 and the geofence radius the circle is drawn to');
select is(
  (select round(home_lat::numeric, 4) || ',' || round(home_lng::numeric, 4)
     from staff_open_shifts() where shift_id = :'sh_open'),
  '51.5300,-0.0500',
  'B3 and the worker''s own home pin');
select is((select distance_km from staff_open_shifts() where shift_id = :'sh_open'), 3.9::numeric,
  'B4 while the km badge the card already showed is unchanged');
select is((select cap_hours from staff_open_shifts() where shift_id = :'sh_open'), 48::numeric,
  'B5 and the RULE-20 figures still travel with the row');

reset role;
update staff set home_location = null where id = :'me';
select set_config('request.jwt.claims',
  json_build_object('sub', :'me_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select home_lat from staff_open_shifts() where shift_id = :'sh_open'), null::double precision,
  'B6 no home pin yet: home_lat is null and the map draws the venue alone');

-- =====================================================================
-- C. criminal_declarations — no worker read path but the RPC (§10.7)
-- =====================================================================
select is((select count(*)::int from criminal_declarations where id = :'decl'), 0,
  'C1 the worker''s own session reaches no declaration row directly — not even their own');
select is((select count(*)::int from criminal_declarations where details is not null), 0,
  'C2 so GET /rest/v1/criminal_declarations?select=details returns nothing');
select is(
  (select count(*)::int from jsonb_path_query(staff_documents(), '$.**.details')),
  0,
  'C3 staff_documents() — the one read the app makes — still carries no details key anywhere');
select ok(staff_documents()::text not like '%The text the worker typed%',
  'C4 and the declaration''s text appears nowhere in what the worker is handed');

reset role;
select * from finish();
rollback;
