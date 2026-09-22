-- =====================================================================
-- 320 · The Dashboard's numbers (§9.1) — 20260922180000_dashboard_kpis.sql
--
-- Four counters, one weekly money panel and a ten-day list, and every one
-- of them is a place where a plausible-looking wrong number would go
-- unnoticed for months. So the figures below are worked out by hand in the
-- comments and asserted against that arithmetic, the way 280 pins the
-- client margin.
--
-- Why the assertions measure DELTAS rather than absolutes
-- -------------------------------------------------------
-- These views are global aggregates by definition — "open positions across
-- ALL events" has no scope to filter by — and this suite runs against a
-- database that already carries supabase/seed.sql. So a baseline is read
-- first, into psql variables, and each assertion states what the fixture
-- rows below it ADD. That is the same discipline as addressing rows by
-- fixed UUID, applied to a number that cannot be addressed that way.
--
-- The baselines are taken as the admin, because the views return nothing
-- to anybody else — which is the last section of this file. There are two
-- of them, and the second one is the interesting one: `staff_available`
-- excludes anybody booked on a shift that touches TODAY, and the week
-- fixture below lands on a Wednesday, which is today one day in seven. A
-- single baseline would therefore have made two of these assertions pass
-- six days a week and fail on the seventh. Re-reading the baseline after
-- the events are in makes the staff assertions measure staff only.
--
-- Dollar-quoting is avoided in the delta assertions on purpose: psql does
-- not interpolate :variables inside dollar-quoted text (see 110's note), so
-- they are written as ordinary value comparisons instead.
-- =====================================================================
begin;
select plan(34);
\ir _shared/fixtures.psql

\set week_event  '7a7a7a7a-0000-4000-8000-000000000001'
\set week_shift  '7b7b7b7b-0000-4000-8000-000000000001'
\set soon_event  '7a7a7a7a-0000-4000-8000-000000000002'
\set soon_wait   '7b7b7b7b-0000-4000-8000-000000000002'
\set soon_chef   '7b7b7b7b-0000-4000-8000-000000000003'
\set soon_host   '7b7b7b7b-0000-4000-8000-000000000004'
\set far_event   '7a7a7a7a-0000-4000-8000-000000000003'
\set far_shift   '7b7b7b7b-0000-4000-8000-000000000005'
\set gone_event  '7a7a7a7a-0000-4000-8000-000000000004'
\set gone_shift  '7b7b7b7b-0000-4000-8000-000000000006'
\set past_event  '7a7a7a7a-0000-4000-8000-000000000005'
\set past_shift  '7b7b7b7b-0000-4000-8000-000000000007'
\set today_event '7a7a7a7a-0000-4000-8000-000000000006'
\set today_shift '7b7b7b7b-0000-4000-8000-000000000008'
\set today_book  '7c7c7c7c-0000-4000-8000-000000000001'

\set role_chef    '7d7d7d7d-0000-4000-8000-000000000001'
\set role_host    '7d7d7d7d-0000-4000-8000-000000000002'

\set conf_a       '7e7e7e7e-0000-4000-8000-000000000001'
\set conf_b       '7e7e7e7e-0000-4000-8000-000000000002'
\set inv_staff    '7e7e7e7e-0000-4000-8000-000000000003'
\set app_staff    '7e7e7e7e-0000-4000-8000-000000000004'
\set free_staff   '7e7e7e7e-0000-4000-8000-000000000005'
\set lapsed_staff '7e7e7e7e-0000-4000-8000-000000000006'
\set doc_blocked  '7e7e7e7e-0000-4000-8000-000000000007'
\set man_blocked  '7e7e7e7e-0000-4000-8000-000000000008'
\set gone_staff   '7e7e7e7e-0000-4000-8000-000000000009'

-- ---------------------------------------------------------------------
-- 1-8. How each view resolves.
--
-- security_invoker so the admin policies on events, shift_requirements,
-- bookings and staff decide (ADR-0004's shape for a Back Office view built
-- on charge rates, as clients_directory_v already is), and security_barrier
-- so no user-supplied qual runs ahead of the `current_app_role() = 'admin'`
-- predicate the view bodies carry.
-- ---------------------------------------------------------------------
select ok((select 'security_invoker=true' = any(reloptions) from pg_class where relname = 'dashboard_sections_v'),
  'dashboard_sections_v is security_invoker');
select ok((select 'security_barrier=true' = any(reloptions) from pg_class where relname = 'dashboard_sections_v'),
  'dashboard_sections_v is a security barrier');
select ok((select 'security_invoker=true' = any(reloptions) from pg_class where relname = 'dashboard_kpis_v'),
  'dashboard_kpis_v is security_invoker');
select ok((select 'security_barrier=true' = any(reloptions) from pg_class where relname = 'dashboard_kpis_v'),
  'dashboard_kpis_v is a security barrier');
select ok((select 'security_invoker=true' = any(reloptions) from pg_class where relname = 'dashboard_week_finance_v'),
  'dashboard_week_finance_v is security_invoker');
select ok((select 'security_barrier=true' = any(reloptions) from pg_class where relname = 'dashboard_week_finance_v'),
  'dashboard_week_finance_v is a security barrier');
select ok((select 'security_invoker=true' = any(reloptions) from pg_class where relname = 'dashboard_upcoming_v'),
  'dashboard_upcoming_v is security_invoker');
select ok((select 'security_barrier=true' = any(reloptions) from pg_class where relname = 'dashboard_upcoming_v'),
  'dashboard_upcoming_v is a security barrier');

-- ---------------------------------------------------------------------
-- Baseline 1, read as the admin. One row each, so \gset is safe.
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select open_positions as b_open from dashboard_kpis_v
\gset

select charge_total  as b_charge,
       base_total    as b_base,
       holiday_total as b_holiday,
       pay_total     as b_pay,
       margin_total  as b_margin
  from dashboard_week_finance_v
\gset

reset role;

-- ---------------------------------------------------------------------
-- Fixture roles and the workers who fill the sections below.
-- ---------------------------------------------------------------------
insert into roles (id, name, description, pay_rate) values
  (:'role_chef', 'Dashboard Fixture Chef', 'internal only', 19.00),
  (:'role_host', 'Dashboard Fixture Host', 'internal only', 16.00);

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'conf_a',    90101, 'Dash', 'Confirmed-A', 'dash-ca@rls.test',  '+447700900201', date '1993-01-01', 'compliant'),
  (:'conf_b',    90102, 'Dash', 'Confirmed-B', 'dash-cb@rls.test',  '+447700900202', date '1993-02-02', 'compliant'),
  (:'inv_staff', 90103, 'Dash', 'Invited',     'dash-inv@rls.test', '+447700900203', date '1993-03-03', 'compliant'),
  (:'app_staff', 90104, 'Dash', 'Applied',     'dash-app@rls.test', '+447700900204', date '1993-04-04', 'compliant');

-- ---------------------------------------------------------------------
-- PHASE A · the current week (§9.1 financial snapshot)
--
-- One event on the Wednesday of the current Europe/London week, one role
-- section, deliberately the same figures 280 uses for the client margin so
-- the two files agree about what "final pay" means:
--
--   2 people x 5 hours            = 10 forecast hours
--   charge  £30.00 x 10           = £300.00
--   base    £20.00 x 10           = £200.00
--   final   round(20 x 1.1207, 2) = £22.41 x 10 = £224.10
--   holiday £224.10 - £200.00     =  £24.10   (broken out, never blended)
--   margin  £300.00 - £224.10     =  £75.90
--
-- The section is FULLY confirmed on purpose. Wednesday of the current week
-- may be behind or ahead of "now" depending on the day the suite runs, so
-- an unfilled seat here would make the open-positions assertion in phase B
-- depend on the day of the week.
-- ---------------------------------------------------------------------
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'week_event', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Dashboard Week Event',
   date_trunc('week', (now() at time zone 'Europe/London'))::date + 2, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour) values
  (:'week_shift', :'week_event', :'role_id',
   ((date_trunc('week', (now() at time zone 'Europe/London'))::date + 2) + time '09:00')
     at time zone 'Europe/London',
   ((date_trunc('week', (now() at time zone 'Europe/London'))::date + 2) + time '14:00')
     at time zone 'Europe/London',
   2, 0, 30.00, 20.00, 'Black tie', 2);

insert into bookings (shift_id, staff_id, status, source, confirmed_at) values
  (:'week_shift', :'staffa', 'confirmed', 'auto',   now()),
  (:'week_shift', :'staffb', 'confirmed', 'manual', now());

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

-- 9-10. The week is Monday to Sunday in Europe/London, not in the session's
--       zone. `current_date` is UTC on Supabase and 20260922100000 is the
--       migration that had to go back and fix exactly that mistake.
select is((select week_start from dashboard_week_finance_v),
          date_trunc('week', (now() at time zone 'Europe/London'))::date,
  'the snapshot week starts on the Monday of the current Europe/London week');
select is((select week_end from dashboard_week_finance_v),
          date_trunc('week', (now() at time zone 'Europe/London'))::date + 6,
  'and ends on the Sunday: Mon-Sun, seven days (§9.1)');

-- 11-15. The money.
select is((select charge_total from dashboard_week_finance_v) - :b_charge, 300.00::numeric,
  'Chargeable is headcount x section hours at the charge rate: £30.00 x 2 x 5h = £300.00');
select is((select base_total from dashboard_week_finance_v) - :b_base, 200.00::numeric,
  'the base element is the same hours at the base rate: £20.00 x 10 = £200.00');
select is((select holiday_total from dashboard_week_finance_v) - :b_holiday, 24.10::numeric,
  'and the holiday element stands on its own: (£22.41 - £20.00) x 10 = £24.10, never blended into the base (§1.5, §9.8)');
select is((select pay_total from dashboard_week_finance_v) - :b_pay, 224.10::numeric,
  'Payable is the FINAL rate, base plus the 12.07%: final_rate(20.00) = £22.41 x 10 = £224.10');
select is((select margin_total from dashboard_week_finance_v) - :b_margin, 75.90::numeric,
  'so the margin is £75.90 — charge minus final pay, not the £100.00 a base-rate calculation would show');

reset role;

-- ---------------------------------------------------------------------
-- PHASE B · open positions and the ten-day list
--
--   soon      today + 3, three role sections:
--               Waiting  6 (+1), 4 confirmed + 1 invited + 1 applied → 2 open
--               Chef     2 (+0), 2 confirmed                        → 0 open
--               Host     1 (+0), nothing                            → 1 open
--   far       today + 400, 5 unfilled — §9.1 counts it ("even a year
--             out") and the ten-day list must not show it
--   cancelled today + 4, 9 unfilled — visible on the list and greyed
--             (§3.3), worth nothing to the counter
--   past      today - 30, 7 unfilled — cannot be staffed any more
--
-- so the counter moves by 3 + 5 = 8, and by nothing else.
-- ---------------------------------------------------------------------
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, po_number, pays_breaks, pays_buffer) values
  (:'soon_event', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Dashboard Soon Event', (now() at time zone 'Europe/London')::date + 3, 'PO-DASH-1', true, true),
  (:'far_event', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Dashboard Far Event', (now() at time zone 'Europe/London')::date + 400, null, true, true),
  (:'gone_event', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Dashboard Cancelled Event', (now() at time zone 'Europe/London')::date + 4, null, true, true),
  (:'past_event', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Dashboard Past Event', (now() at time zone 'Europe/London')::date - 30, null, true, true);

update events set cancelled_at = now() - interval '1 day',
                  cancel_reason = 'Client cancelled — fixture'
 where id = :'gone_event';

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour) values
  (:'soon_wait', :'soon_event', :'role_id', now() + interval '3 days 9 hours',
   now() + interval '3 days 17 hours',  6, 1, 22.97, 14.00, 'Black & whites', 7),
  (:'soon_chef', :'soon_event', :'role_chef', now() + interval '3 days 7 hours',
   now() + interval '3 days 15 hours',  2, 0, 30.69, 19.00, 'Chef whites', 2),
  (:'soon_host', :'soon_event', :'role_host', now() + interval '3 days 12 hours',
   now() + interval '3 days 18 hours',  1, 0, 26.83, 16.00, 'Business suit (navy)', 1),
  (:'far_shift', :'far_event', :'role_id', now() + interval '400 days',
   now() + interval '400 days 8 hours', 5, 0, 22.97, 14.00, 'All black', 5),
  (:'gone_shift', :'gone_event', :'role_id', now() + interval '4 days',
   now() + interval '4 days 8 hours',   9, 0, 22.97, 14.00, 'All black', 9),
  (:'past_shift', :'past_event', :'role_id', now() - interval '30 days',
   now() - interval '30 days' + interval '8 hours', 7, 0, 22.97, 14.00, 'All black', 7);

insert into bookings (shift_id, staff_id, status, source, confirmed_at) values
  (:'soon_wait', :'staffa',  'confirmed', 'auto',   now()),
  (:'soon_wait', :'staffb',  'confirmed', 'auto',   now()),
  (:'soon_wait', :'conf_a',  'confirmed', 'auto',   now()),
  (:'soon_wait', :'conf_b',  'confirmed', 'manual', now()),
  (:'soon_chef', :'conf_a',  'confirmed', 'auto',   now()),
  (:'soon_chef', :'conf_b',  'confirmed', 'auto',   now());

-- Neither of these is fill: §3.2 counts confirmed bookings only.
insert into bookings (shift_id, staff_id, status, source, applied_at) values
  (:'soon_wait', :'inv_staff', 'invited', 'auto', null),
  (:'soon_wait', :'app_staff', 'applied', 'self', now());

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

-- 16-20. The counter, and what is in and out of it.
select is((select open_positions from dashboard_kpis_v) - :b_open, 8,
  'Open positions moves by 8: the soon event''s 3 plus the 5 on an event 400 days out, because §9.1 counts every event "even a year out" — and nothing from the cancelled event or the one that has already run');
select is((select count(*)::int from dashboard_upcoming_v
            where event_id = :'gone_event' and cancelled_at is not null), 1,
  'a cancelled event stays on the ten-day list so the manager can still see it, greyed (§3.3)');
select is((select count(*)::int from dashboard_upcoming_v where event_id = :'far_event'), 0,
  'an event 400 days out is not on the ten-day list, though its seats are in the counter');
select is((select open_positions from dashboard_sections_v where shift_id = :'far_shift'), 5,
  'the section view reports the far event''s 5 unfilled seats: it is the KPI that applies the date test, not this');
select is((select open_positions from dashboard_sections_v where shift_id = :'past_shift'), 7,
  'and the finished event''s 7 too — the counter excludes a section that has ended, it is not hidden from the view');

-- 21-26. The role rows §9.1 puts the margin on.
select is((select count(*)::int from dashboard_upcoming_v where event_id = :'soon_event'), 3,
  'the ten-day list carries one row per ROLE SECTION, not one per event (§9.1, RULE-18)');
select is((select confirmed from dashboard_upcoming_v where shift_id = :'soon_wait'), 4,
  'fill counts confirmed bookings only: the invited row and the self-applied row do not count (§3.2)');
select is((select open_positions from dashboard_upcoming_v where shift_id = :'soon_wait'), 2,
  '6 headcount less 4 confirmed is 2 open — measured against headcount, never against headcount + buffer');
select is((select buffer from dashboard_upcoming_v where shift_id = :'soon_wait'), 1,
  'and the buffer travels beside it as its own number, so the screen renders "6 (+1)" and never "7"');
select is((select margin_per_hour from dashboard_upcoming_v where shift_id = :'soon_wait'), 7.28::numeric,
  'the role row''s margin is charge minus FINAL pay: £22.97 - £15.69 = £7.28/h, not the £8.97 against base');
select is(
  (select array[event_starts_at = (select min(starts_at) from dashboard_sections_v where event_id = :'soon_event'),
                event_ends_at   = (select max(ends_at)   from dashboard_sections_v where event_id = :'soon_event'),
                role_count = 3]
     from dashboard_upcoming_v where shift_id = :'soon_host'),
  array[true, true, true],
  'the event window on every row is the min start and max end of its own sections, derived (RULE-18) — the Host row carries neither of its own');

-- ---------------------------------------------------------------------
-- Baseline 2, taken with every event above already in place, so the staff
-- assertions below measure staff and nothing else.
-- ---------------------------------------------------------------------
select staff_available   as c_available,
       compliance_blocks as c_blocks,
       on_shift_now      as c_onshift
  from dashboard_kpis_v
\gset

reset role;

-- ---------------------------------------------------------------------
-- PHASE C · who counts as available, and who counts as blocked
--
-- Five workers, in their final state:
--   free      compliant, nothing booked            → available
--   lapsed    compliant, right to work ended yesterday → NOT available
--   docs      blocked on a document                → a compliance block
--   manual    blocked by a manager (§9.6)          → not a document block
--   removed   compliant but GDPR-removed (§1.7)    → NOT available
--
-- so Staff available moves by 1 and Compliance blocks by 1.
-- ---------------------------------------------------------------------
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status,
                   block_kind, block_reason, right_to_work_until, removed_at) values
  (:'free_staff',   90105, 'Dash', 'Free',    'dash-free@rls.test',   '+447700900205',
   date '1993-05-05', 'compliant', null, null, null, null),
  (:'lapsed_staff', 90106, 'Dash', 'Lapsed',  'dash-lapsed@rls.test', '+447700900206',
   date '1993-06-06', 'compliant', null, null, (now() at time zone 'Europe/London')::date - 1, null),
  (:'doc_blocked',  90107, 'Dash', 'Docs',    'dash-docs@rls.test',   '+447700900207',
   date '1993-07-07', 'blocked', 'auto_document', 'Passport expired — fixture', null, null),
  (:'man_blocked',  90108, 'Dash', 'Manual',  'dash-manual@rls.test', '+447700900208',
   date '1993-08-08', 'blocked', 'manual', 'Under review — fixture', null, null),
  (:'gone_staff',   90109, 'Dash', 'Removed', 'dash-gone@rls.test',   '+447700900209',
   date '1993-09-09', 'compliant', null, null, null, now());

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

-- 27-28.
select is((select staff_available from dashboard_kpis_v) - :c_available, 1,
  'Staff available moves by the one plainly compliant worker: the lapsed right to work is a hard stop (RULE-20), the removed account is gone (§1.7), and neither blocked worker is compliant at all');
select is((select compliance_blocks from dashboard_kpis_v) - :c_blocks, 1,
  'Compliance blocks counts the document block only: a manual block is a manager''s decision about conduct, not a document (§9.6)');

reset role;

-- ---------------------------------------------------------------------
-- PHASE D · booked today, and on shift now
--
-- One event today, one section running from an hour ago to five hours
-- hence, `free_staff` confirmed on it and checked in fifty minutes ago.
-- That takes them out of Staff available and puts them into On shift now.
-- ---------------------------------------------------------------------
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'today_event', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Dashboard Today Event', (now() at time zone 'Europe/London')::date, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour) values
  (:'today_shift', :'today_event', :'role_id', now() - interval '1 hour',
   now() + interval '5 hours', 1, 0, 22.97, 14.00, 'All black', 1);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at, on_day_confirmed_at) values
  (:'today_book', :'today_shift', :'free_staff', 'confirmed', 'auto',
   now() - interval '2 days', now());

insert into check_logs (booking_id, outcome, check_in_at, on_site_verified)
values (:'today_book', 'checked_in', now() - interval '50 minutes', true);

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

-- 29-30.
select is((select staff_available from dashboard_kpis_v) - :c_available, 0,
  'a worker confirmed on a shift that touches today in UK terms is no longer available, so the count comes back down');
select is((select on_shift_now from dashboard_kpis_v) - :c_onshift, 1,
  'On shift now reads checkin_monitor_v, so §9.5''s states keep one definition: checked in, not checked out, not yet past end + 4 h');

-- ---------------------------------------------------------------------
-- 31-34. Nobody but the office.
--
-- These views carry charge_rate, pay_rate and the margin. §11.1 keeps all
-- three from the client absolutely, and a worker sees base rate only and
-- never anybody else's. Both roles are `authenticated`, so the privilege
-- is there and the emptiness has to come from the view body and from RLS.
-- ---------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from dashboard_kpis_v), 0,
  'a client reads no row at all from dashboard_kpis_v — not a row of zeros, no row');
select is((select count(*)::int from dashboard_week_finance_v), 0,
  'and none from the weekly money panel (§11.1: the client never sees money)');

reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from dashboard_sections_v), 0,
  'a worker reads nothing from dashboard_sections_v either, including the sections they are booked on: charge rates and margins are the office''s');

reset role;
select ok(not has_table_privilege('anon', 'dashboard_upcoming_v', 'select'),
  'anon holds no privilege on the dashboard views: Supabase grants select on every new object in public, and 0009 is what that cost last time');

select * from finish();
rollback;
