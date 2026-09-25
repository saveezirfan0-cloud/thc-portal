-- =====================================================================
-- 655 · "Short-staffed — next 48 hours" (§9.1) — 20260930150000
--
-- One row per role SECTION starting in [now, now + 48 h) with confirmed
-- below headcount. Fill counts only confirmed; the buffer is not a
-- shortfall; cancelled events are out; the section's own start decides,
-- not the event date (RULE-18). Admin-only, and no money in it.
-- =====================================================================
begin;
select plan(16);
\ir _shared/fixtures.psql

\set ss_event     '65500000-0000-4000-8000-000000000001'
\set ss_cancelled '65500000-0000-4000-8000-000000000002'
\set ss_yesterday '65500000-0000-4000-8000-000000000003'

\set ss_short     '65510000-0000-4000-8000-000000000001'
\set ss_filled    '65510000-0000-4000-8000-000000000002'
\set ss_invited   '65510000-0000-4000-8000-000000000003'
\set ss_far       '65510000-0000-4000-8000-000000000004'
\set ss_running   '65510000-0000-4000-8000-000000000005'
\set ss_cancel_s  '65510000-0000-4000-8000-000000000006'
\set ss_midnight  '65510000-0000-4000-8000-000000000007'

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer, cancelled_at)
select v.id::uuid, :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
       st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
       v.title, (now() at time zone 'Europe/London')::date + v.days, true, true, v.cancelled_at
  from (values (:'ss_event',     'Short-staffed Gala',      0, null::timestamptz),
               (:'ss_cancelled', 'Short-staffed Cancelled', 0, now()),
               -- dated YESTERDAY, with a section starting in the next 48 h:
               -- invisible to a filter on event_date, visible here.
               (:'ss_yesterday', 'Short-staffed Late Bar', -1, null::timestamptz)) as v(id, title, days, cancelled_at);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour) values
  -- 2 needed, 1 confirmed → short by 1
  (:'ss_short',    :'ss_event',     :'role_id', now() + interval '3 hours',  now() + interval '8 hours',  2, 1, 22.97, 14.00, 'All black', 3),
  -- 1 needed, 1 confirmed, buffer 1 empty → NOT short (buffer is THC's cover)
  (:'ss_filled',   :'ss_event',     :'role_id', now() + interval '10 hours', now() + interval '15 hours', 1, 1, 22.97, 14.00, 'All black', 2),
  -- 1 needed, 1 INVITED → short: an invitation is not fill
  (:'ss_invited',  :'ss_event',     :'role_id', now() + interval '20 hours', now() + interval '25 hours', 1, 0, 22.97, 14.00, 'All black', 1),
  -- starts in 49 h → outside the panel
  (:'ss_far',      :'ss_event',     :'role_id', now() + interval '49 hours', now() + interval '54 hours', 3, 0, 22.97, 14.00, 'All black', 3),
  -- started an hour ago → the escalation's, not the panel's
  (:'ss_running',  :'ss_event',     :'role_id', now() - interval '1 hour',   now() + interval '4 hours',  3, 0, 22.97, 14.00, 'All black', 3),
  -- cancelled event → out
  (:'ss_cancel_s', :'ss_cancelled', :'role_id', now() + interval '5 hours',  now() + interval '10 hours', 3, 0, 22.97, 14.00, 'All black', 3),
  -- yesterday's event, section starting in 2 h → in
  (:'ss_midnight', :'ss_yesterday', :'role_id', now() + interval '2 hours',  now() + interval '7 hours',  2, 0, 22.97, 14.00, 'All black', 2);

insert into bookings (shift_id, staff_id, status, source, confirmed_at) values
  (:'ss_short',   :'staffa', 'confirmed', 'manual', now()),
  (:'ss_filled',  :'staffb', 'confirmed', 'manual', now()),
  (:'ss_invited', :'staffa', 'invited',   'auto',   null);

-- ---------------------------------------------------------------------
-- As the admin
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select confirmed from dashboard_short_staffed_v where shift_id = :'ss_short'), 1,
  'a section 1 of 2 confirmed is listed with confirmed = 1');
select is((select open_positions from dashboard_short_staffed_v where shift_id = :'ss_short'), 1,
  'and open = headcount - confirmed = 1');
select is((select headcount from dashboard_short_staffed_v where shift_id = :'ss_short'), 2,
  'headcount is the headcount alone, never headcount + buffer');
select is((select count(*)::int from dashboard_short_staffed_v where shift_id = :'ss_filled'), 0,
  'headcount met with the buffer empty is not short-staffed (§3.2)');
select is((select confirmed from dashboard_short_staffed_v where shift_id = :'ss_invited'), 0,
  'an invitation is not fill: the invited-only section is listed with confirmed = 0');
select is((select count(*)::int from dashboard_short_staffed_v where shift_id = :'ss_far'), 0,
  'a section starting in 49 hours is outside the panel');
select is((select count(*)::int from dashboard_short_staffed_v where shift_id = :'ss_running'), 0,
  'a section already running is not listed');
select is((select count(*)::int from dashboard_short_staffed_v where shift_id = :'ss_cancel_s'), 0,
  'a cancelled event is excluded (§3.3)');
select is((select count(*)::int from dashboard_short_staffed_v where shift_id = :'ss_midnight'), 1,
  'a section on an event dated yesterday that starts in 2 hours is listed (RULE-18: the section decides)');

-- ---------------------------------------------------------------------
-- Everybody else
-- ---------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from dashboard_short_staffed_v where event_id in (:'ss_event', :'ss_yesterday')), 0,
  'a worker reads nothing, not even the section they are booked on');

reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from dashboard_short_staffed_v where event_id in (:'ss_event', :'ss_yesterday')), 0,
  'the event''s own client reads nothing');

reset role;
select set_config('request.jwt.claims', '{}', true);
set local role anon;
select throws_ok('select count(*) from dashboard_short_staffed_v', '42501', null,
  'anon is refused outright');
reset role;

-- ---------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------
select ok((select 'security_invoker=true' = any(reloptions) from pg_class where relname = 'dashboard_short_staffed_v'),
  'dashboard_short_staffed_v is security_invoker');
select ok((select 'security_barrier=true' = any(reloptions) from pg_class where relname = 'dashboard_short_staffed_v'),
  'dashboard_short_staffed_v is a security barrier');
select ok(not has_table_privilege('anon', 'dashboard_short_staffed_v', 'select'),
  'anon has no privilege on dashboard_short_staffed_v');
select is_empty(
  $$ select column_name::text from information_schema.columns
      where table_schema = 'public' and table_name = 'dashboard_short_staffed_v'
        and (column_name like '%rate%' or column_name like '%margin%'
             or column_name like '%charge%' or column_name like '%pay%') $$,
  'the view carries no money column');
select * from finish();
rollback;
