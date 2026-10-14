-- =====================================================================
-- 831 · Named arrivals on the day (§11.2, §9.5, RULE-15, RULE-18;
--       ADR-0004, ADR-0053, ADR-0134, ADR-0135 §1)
--       — 20261014170000_client_named_arrivals.sql
--
-- client_lineup_v.arrival_status / arrived_at say, per person on the
-- customer's line-up, "arrived at 08:52", "not here yet" or "not arrived"
-- — and only while the event is live:
--   · arrived = a checked_in check-log with a time (or `worked`);
--     an out-of-radius press is not an arrival;
--   · not_arrived from the SECTION's start + 30 min (§9.5's No-show
--     moment), except for a booking confirmed after the start (exempt);
--   · a later section's people are 'expected' and an early check-in is
--     'arrived';
--   · nothing before the event, after it, for a cancelled one, or for a
--     row kept visible only because the customer rated it (beyond the
--     headcount);
--   · another customer and a worker see none of it; no location column;
--   · the named states agree with client_arrivals_v's count.
-- =====================================================================
begin;
select plan(22);
\ir _shared/fixtures.psql

\set ev_live 'e8310000-0000-4000-8000-000000000001'
\set ev_up   'e8310000-0000-4000-8000-000000000002'
\set ev_done 'e8310000-0000-4000-8000-000000000003'
\set ev_canc 'e8310000-0000-4000-8000-000000000004'
\set ev_b    'e8310000-0000-4000-8000-000000000005'
\set sh_a    'f8310000-0000-4000-8000-000000000001'
\set sh_late 'f8310000-0000-4000-8000-000000000002'
\set sh_up   'f8310000-0000-4000-8000-000000000003'
\set sh_done 'f8310000-0000-4000-8000-000000000004'
\set sh_canc 'f8310000-0000-4000-8000-000000000005'
\set sh_b    'f8310000-0000-4000-8000-000000000006'
\set s1 'd8310000-0000-4000-8000-000000000001'
\set s2 'd8310000-0000-4000-8000-000000000002'
\set s3 'd8310000-0000-4000-8000-000000000003'
\set s4 'd8310000-0000-4000-8000-000000000004'
\set s5 'd8310000-0000-4000-8000-000000000005'
\set s6 'd8310000-0000-4000-8000-000000000006'
\set s7 'd8310000-0000-4000-8000-000000000007'
\set a1 '08310000-0000-4000-8000-000000000001'
\set a2 '08310000-0000-4000-8000-000000000002'
\set a3 '08310000-0000-4000-8000-000000000003'
\set a4 '08310000-0000-4000-8000-000000000004'
\set a5 '08310000-0000-4000-8000-000000000005'
\set b1 '08310000-0000-4000-8000-000000000011'
\set b2 '08310000-0000-4000-8000-000000000012'
\set u1 '08310000-0000-4000-8000-000000000021'
\set d1 '08310000-0000-4000-8000-000000000031'
\set c1 '08310000-0000-4000-8000-000000000041'
\set x1 '08310000-0000-4000-8000-000000000051'

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'s1', 98311, 'Door', 'One',   'door1-831@rls.test', '+447700983101', date '1996-01-01', 'compliant'),
  (:'s2', 98312, 'Door', 'Two',   'door2-831@rls.test', '+447700983102', date '1996-01-02', 'compliant'),
  (:'s3', 98313, 'Door', 'Three', 'door3-831@rls.test', '+447700983103', date '1996-01-03', 'compliant'),
  (:'s4', 98314, 'Door', 'Four',  'door4-831@rls.test', '+447700983104', date '1996-01-04', 'compliant'),
  (:'s5', 98315, 'Door', 'Five',  'door5-831@rls.test', '+447700983105', date '1996-01-05', 'compliant'),
  (:'s6', 98316, 'Door', 'Six',   'door6-831@rls.test', '+447700983106', date '1996-01-06', 'compliant'),
  (:'s7', 98317, 'Door', 'Seven', 'door7-831@rls.test', '+447700983107', date '1996-01-07', 'compliant');

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer) values
  (:'ev_live', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Live today', current_date, true, true),
  (:'ev_up',   :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Next week', current_date + 7, true, true),
  (:'ev_done', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Finished', current_date - 1, true, true),
  (:'ev_canc', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Cancelled today', current_date, true, true),
  (:'ev_b',    :'clientb', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Client B live', current_date, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour) values
  (:'sh_a',    :'ev_live', :'role_id', now() - interval '1 hour',   now() + interval '5 hours', 4, 1, 22.97, 14.00, null, 6),
  (:'sh_late', :'ev_live', :'role_id', now() + interval '2 hours',  now() + interval '6 hours', 2, 0, 22.97, 14.00, null, 6),
  (:'sh_up',   :'ev_up',   :'role_id', now() + interval '7 days',   now() + interval '7 days 6 hours', 2, 0, 22.97, 14.00, null, 6),
  (:'sh_done', :'ev_done', :'role_id', now() - interval '10 hours', now() - interval '2 hours', 2, 0, 22.97, 14.00, null, 6),
  (:'sh_canc', :'ev_canc', :'role_id', now() - interval '1 hour',   now() + interval '5 hours', 2, 0, 22.97, 14.00, null, 6),
  (:'sh_b',    :'ev_b',    :'role_id', now() - interval '1 hour',   now() + interval '5 hours', 2, 0, 22.97, 14.00, null, 6);

update events set cancelled_at = now() - interval '2 hours', cancel_reason = 'AUDIT test' where id = :'ev_canc';

-- Live section of four, started an hour ago, five confirmed:
--   a1 checked in 50 min ago                    → arrived
--   a2 confirmed days ago, no check-in           → not arrived (start + 30 passed)
--   a4 confirmed days ago, an out-of-radius press → not arrived
--   a3 confirmed 10 min ago, after the start     → exempt: still expected
--   a5 confirmed 5 min ago: the fifth seat, rated by the customer → kept, no state
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'a1', :'sh_a', :'s1', 'confirmed', 'auto', now() - interval '3 days'),
  (:'a2', :'sh_a', :'s2', 'confirmed', 'auto', now() - interval '2 days'),
  (:'a4', :'sh_a', :'s4', 'confirmed', 'auto', now() - interval '1 day'),
  (:'a3', :'sh_a', :'s3', 'confirmed', 'auto', now() - interval '10 minutes'),
  (:'a5', :'sh_a', :'s5', 'confirmed', 'auto', now() - interval '5 minutes'),
  -- The later section: b1 not yet, b2 checked in early.
  (:'b1', :'sh_late', :'s6', 'confirmed', 'auto', now() - interval '2 days'),
  (:'b2', :'sh_late', :'s7', 'confirmed', 'auto', now() - interval '2 days'),
  (:'u1', :'sh_up',   :'s1', 'confirmed', 'auto', now() - interval '2 days'),
  (:'d1', :'sh_done', :'s2', 'worked',    'auto', now() - interval '5 days'),
  (:'c1', :'sh_canc', :'s3', 'confirmed', 'auto', now() - interval '2 days'),
  (:'x1', :'sh_b',    :'s4', 'confirmed', 'auto', now() - interval '2 days');

insert into check_logs (booking_id, attempted_at, outcome, location, distance_m, check_in_at, accuracy_m) values
  (:'a1', now() - interval '50 minutes', 'checked_in',
   st_setsrid(st_makepoint(-0.1001, 51.5001), 4326)::geography, 12.0, now() - interval '50 minutes', 8.0),
  (:'a4', now() - interval '40 minutes', 'out_of_radius',
   st_setsrid(st_makepoint(-0.2000, 51.6000), 4326)::geography, 9000.0, null, 20.0),
  (:'b2', now() - interval '10 minutes', 'checked_in', null, null, now() - interval '10 minutes', null),
  (:'d1', now() - interval '10 hours',   'checked_in', null, null, now() - interval '10 hours', null),
  (:'c1', now() - interval '50 minutes', 'checked_in', null, null, now() - interval '50 minutes', null),
  (:'x1', now() - interval '45 minutes', 'checked_in', null, null, now() - interval '45 minutes', null);

insert into feedback (author_kind, author_id, staff_id, event_id, rating, text)
values ('client', :'clienta_uid', :'s5', :'ev_live', 4, 'Rated early');

-- ---------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------
select ok(
  (select count(*) = 2 from information_schema.columns
    where table_schema = 'public' and table_name = 'client_lineup_v'
      and column_name in ('arrival_status', 'arrived_at')),
  'client_lineup_v names its two arrival columns');
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name like 'client!_%' escape '!'
      and column_name ~ '(locat|latitude|longitude|^lat$|^lng$|geo|distance|accuracy|check_out|violation|no_show|late)'),
  0,
  'no client_* view has a location, distance, accuracy, check-out, violation or Late / No-show column');
select ok(not (coalesce((select reloptions from pg_class where relname = 'client_lineup_v'), '{}') @> '{security_invoker=true}')
          and (coalesce((select reloptions from pg_class where relname = 'client_lineup_v'), '{}') @> '{security_barrier=true}')
          and pg_get_viewdef('client_lineup_v'::regclass) ~ 'client_portal_visible\(e\.client_id\)'
          and not has_table_privilege('anon', 'client_lineup_v', 'select')
          and not has_table_privilege('authenticated', 'client_lineup_v', 'update'),
  'the restated view keeps ADR-0004''s shape: owner rights, barrier, client_portal_visible() in its body, SELECT to authenticated only');

-- ---------------------------------------------------------------------
-- As Client A, during the event
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select results_eq(
  $$ select arrival_status, arrived_at = (select now() - interval '50 minutes')
       from client_lineup_v where booking_id = '08310000-0000-4000-8000-000000000001' $$,
  $$ values ('arrived'::text, true) $$,
  'a checked-in worker reads "arrived", with their first check-in time');
select is((select arrival_status from client_lineup_v where booking_id = :'a2'), 'not_arrived',
  'no check-in 30 minutes after the section''s start: "not arrived" (never "No-show")');
select is((select arrived_at from client_lineup_v where booking_id = :'a2'), null::timestamptz,
  '… with no time');
select is((select arrival_status from client_lineup_v where booking_id = :'a4'), 'not_arrived',
  'an out-of-radius press is not an arrival');
select is((select arrival_status from client_lineup_v where booking_id = :'a3'), 'expected',
  'a booking confirmed after the start is exempt from the 30-minute lock (§9.5): still expected');
select results_eq(
  $$ select feedback_given, arrival_status, arrived_at
       from client_lineup_v where booking_id = '08310000-0000-4000-8000-000000000005' $$,
  $$ values (true, null::text, null::timestamptz) $$,
  'a rated worker kept past the headcount is visible but gets no arrival state (only the trimmed line-up)');
select is((select arrival_status from client_lineup_v where booking_id = :'b1'), 'expected',
  'a later role section''s worker is expected, never "not arrived" before their own start (RULE-18)');
select is((select arrival_status from client_lineup_v where booking_id = :'b2'), 'arrived',
  'an early check-in on the later section reads "arrived"');
select is(
  (select count(*)::int from client_lineup_v where shift_id = :'sh_a' and arrival_status = 'arrived'),
  (select arrived from client_arrivals_v where shift_id = :'sh_a'),
  'the named states agree with "N of M arrived"');

-- Before, after, cancelled.
select is((select arrival_status from client_lineup_v where booking_id = :'u1'), null::text,
  'nothing before the event');
select results_eq(
  $$ select arrival_status, arrived_at from client_lineup_v where booking_id = '08310000-0000-4000-8000-000000000031' $$,
  $$ values (null::text, null::timestamptz) $$,
  'nothing after the event, although that worker checked in and worked: no attendance record');
select is((select count(*)::int from client_lineup_v where event_id = :'ev_canc' and arrival_status is not null), 0,
  'nothing for a cancelled event, even inside its window');
select is((select count(*)::int from client_lineup_v where event_id = :'ev_canc' and arrived_at is not null), 0,
  '… and no time either');

-- Tenancy.
select is((select count(*)::int from client_lineup_v where event_id = :'ev_b'), 0,
  'Client A reads nothing of Client B''s live event');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clientb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_lineup_v where event_id = :'ev_live'), 0,
  'Client B reads nothing of Client A''s live event');
select is((select arrival_status from client_lineup_v where booking_id = :'x1'), 'arrived',
  'Client B reads its own arrivals');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_lineup_v where event_id in (:'ev_live', :'ev_b')), 0,
  'a worker reads no line-up and no arrival');
reset role;

-- The office's "Get back" registers the worker as arrived (§9.5).
insert into check_logs (booking_id, attempted_at, outcome, check_in_at)
values (:'a2', now(), 'checked_in', now());
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select arrival_status from client_lineup_v where booking_id = :'a2'), 'arrived',
  '"Get back" turns "not arrived" into "arrived"');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select arrival_status from client_lineup_v where booking_id = :'a1'), 'arrived',
  'the admin reads the same definition');
reset role;

select * from finish();
rollback;
