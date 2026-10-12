-- =====================================================================
-- 790 · Same staff on all days (ADR-0116)
--   20261012140000_same_staff_all_days.sql
--
-- Held here:
--   A · the columns: both off / null by default, readable by a signed-in
--     session (shift_requirements has per-column grants), and invisible to
--     the client portal - no client policy on either table, no client_*
--     view column;
--   B · the pool split: auto_assign_candidates() is the wrapper (this fails
--     if a later migration redefines it and drops the series gate), is
--     identical to auto_assign_candidates_pool() for a section that is not
--     flagged, and the pool itself knows nothing of series;
--   C · the series gate, one hard gate at a time: a booking elsewhere
--     (confirmed, overlapping), the 2 h different-venue gap (and same-venue
--     back-to-back being fine), a self-cancel off a sibling's event, the
--     availability calendar, a right to work that ends mid-series - each
--     reads not_available_all_days on the OTHER days and its own gate on
--     the day it is about; blocked and do-not-return are the section's own
--     gate everywhere;
--   D · the projected hours: three 8 h days in a student term week fail
--     although each fits alone; two pass; another booking in the week
--     counts; the same three days spread over two weeks pass;
--   E · what is NOT a sibling: another role, a day that does not ask for the
--     same staff, a cancelled event, a day that has ended, an unflagged
--     section (no gating at all), a single-day event;
--   F · every entry path: invite_worker (auto and manual) refuses by name
--     and writes nothing, a clear worker is invited, accept_invite refuses
--     an invitation written before a sibling day went wrong and leaves it
--     live, Radar does not list the section;
--   G · link_event_series: both events get the series, a second Duplicate
--     reuses it, idempotent, one client, no clone already elsewhere, office
--     only and not a viewer; the audit row.
--
-- Every row is created inside the transaction and rolled back.
-- =====================================================================
begin;
select plan(78);
\ir _shared/fixtures.psql

select cap_week_start(current_date) + 14 as w \gset

\set ser     '78700000-0000-4000-8000-0000000000a1'
\set ser_b   '78700000-0000-4000-8000-0000000000a2'
\set ev_fri  '78710000-0000-4000-8000-000000000001'
\set ev_sat  '78710000-0000-4000-8000-000000000002'
\set ev_sun  '78710000-0000-4000-8000-000000000003'
\set ev_solo '78710000-0000-4000-8000-000000000004'
\set ev_mon  '78710000-0000-4000-8000-000000000005'
\set ev_oth  '78710000-0000-4000-8000-000000000006'
\set ev_x    '78710000-0000-4000-8000-000000000007'
\set ev_y    '78710000-0000-4000-8000-000000000008'
\set ev_z    '78710000-0000-4000-8000-000000000009'
\set ev_b    '78710000-0000-4000-8000-00000000000a'
\set ev_c    '78710000-0000-4000-8000-00000000000b'
\set ev_d    '78710000-0000-4000-8000-00000000000c'
\set ev_e    '78710000-0000-4000-8000-00000000000d'
\set ev_cb   '78710000-0000-4000-8000-00000000000e'

\set s_fri   '78720000-0000-4000-8000-000000000001'
\set s_sat   '78720000-0000-4000-8000-000000000002'
\set s_sun   '78720000-0000-4000-8000-000000000003'
\set s_solo  '78720000-0000-4000-8000-000000000004'
\set s_mon   '78720000-0000-4000-8000-000000000005'
\set s_clash '78720000-0000-4000-8000-000000000006'
\set s_gap   '78720000-0000-4000-8000-000000000007'
\set s_back  '78720000-0000-4000-8000-000000000008'
\set s_chef  '78720000-0000-4000-8000-000000000009'
\set s_x     '78720000-0000-4000-8000-00000000000a'
\set s_y     '78720000-0000-4000-8000-00000000000b'
\set s_z     '78720000-0000-4000-8000-00000000000c'

\set ro_chef '78730000-0000-4000-8000-000000000001'
\set ve2     '78730000-0000-4000-8000-000000000002'

\set w_ok     '78740000-0000-4000-8000-000000000001'
\set w_clash  '78740000-0000-4000-8000-000000000002'
\set w_gap    '78740000-0000-4000-8000-000000000003'
\set w_back   '78740000-0000-4000-8000-000000000004'
\set w_self   '78740000-0000-4000-8000-000000000005'
\set w_away   '78740000-0000-4000-8000-000000000006'
\set w_rtw    '78740000-0000-4000-8000-000000000007'
\set w_stud   '78740000-0000-4000-8000-000000000008'
\set w_blk    '78740000-0000-4000-8000-000000000009'
\set w_dnr    '78740000-0000-4000-8000-00000000000a'
\set w_wrong  '78740000-0000-4000-8000-00000000000b'
\set w_acc    '78740000-0000-4000-8000-00000000000c'
\set w_rad    '78740000-0000-4000-8000-00000000000d'
\set w_split  '78740000-0000-4000-8000-00000000000e'

\set viewer   '78750000-0000-4000-8000-000000000001'
\set acc_uid  '78750000-0000-4000-8000-000000000002'
\set stf_uid  '78750000-0000-4000-8000-000000000003'

insert into auth.users (id, email) values
  (:'viewer',  'viewer.787@rls.test'),
  (:'acc_uid', 'acc.787@rls.test'),
  (:'stf_uid', 'stf.787@rls.test');
insert into profiles (id, role, office_role, full_name) values (:'viewer', 'admin', 'viewer', 'Vera Viewer');
insert into profiles (id, role, full_name) values (:'acc_uid', 'staff', 'Acc Cepts'), (:'stf_uid', 'staff', 'Stef Staff');

-- A second venue, far enough that "different venue" is unambiguous, and a
-- second role for the "another role is not a sibling" case.
insert into venues (id, name, address, location, venue_type, geofence_radius_m) values
  (:'ve2', 'Series Venue 2', '9 Test Street, London',
   st_setsrid(st_makepoint(-0.1400, 51.5000), 4326)::geography, 'hotel', 150);
insert into roles (id, name, pay_rate) values (:'ro_chef', 'Series Chef', 14.00);

-- Fri 20, Sat 21, Sun 22 Nov in the request - here the Friday, Saturday and
-- Sunday of a week two weeks ahead, three days of one job at the fixture
-- venue, each "Bar" 09:00-17:00 UK (8 h).
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, auto_assign, series_id) values
  (:'ev_fri', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Tobacco Dock Fri', :'w'::date + 4, true, true, true, :'ser'),
  (:'ev_sat', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Tobacco Dock Sat', :'w'::date + 5, true, true, true, :'ser'),
  (:'ev_sun', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Tobacco Dock Sun', :'w'::date + 6, true, true, true, :'ser');

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, auto_assign) values
  (:'ev_solo', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Single day', :'w'::date + 4, true, true, true),
  (:'ev_mon', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Monday job', :'w'::date, true, true, true),
  (:'ev_oth', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Saturday elsewhere', :'w'::date + 5, true, true, true);
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, auto_assign) values
  (:'ev_x', :'clienta', :'ve2', 'Series Venue 2', '9 Test Street, London',
   st_setsrid(st_makepoint(-0.1400, 51.5000), 4326)::geography, 150, 'Different venue job', :'w'::date + 5, true, true, true),
  (:'ev_y', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Same venue job', :'w'::date + 5, true, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour, auto_assign, same_staff_all_days) values
  (:'s_fri', :'ev_fri', :'role_id', (:'w'::date + 4 + time '09:00') at time zone 'Europe/London',
                                    (:'w'::date + 4 + time '17:00') at time zone 'Europe/London', 9, 0, 20, 12, 9, true, true),
  (:'s_sat', :'ev_sat', :'role_id', (:'w'::date + 5 + time '09:00') at time zone 'Europe/London',
                                    (:'w'::date + 5 + time '17:00') at time zone 'Europe/London', 9, 0, 20, 12, 9, true, true),
  (:'s_sun', :'ev_sun', :'role_id', (:'w'::date + 6 + time '09:00') at time zone 'Europe/London',
                                    (:'w'::date + 6 + time '17:00') at time zone 'Europe/London', 9, 0, 20, 12, 9, true, true);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour, auto_assign) values
  -- Not flagged: a single-day event, 09:00-17:00 on the Friday.
  (:'s_solo', :'ev_solo', :'role_id', (:'w'::date + 4 + time '09:00') at time zone 'Europe/London',
                                      (:'w'::date + 4 + time '17:00') at time zone 'Europe/London', 9, 0, 20, 12, 9, true),
  -- Monday 09:00-15:00 (6 h) - another booking in the student's week.
  (:'s_mon', :'ev_mon', :'role_id', (:'w'::date + time '09:00') at time zone 'Europe/London',
                                    (:'w'::date + time '15:00') at time zone 'Europe/London', 9, 0, 20, 12, 9, true),
  -- Saturday 10:00-14:00 at the fixture venue, overlapping s_sat.
  (:'s_clash', :'ev_oth', :'role_id', (:'w'::date + 5 + time '10:00') at time zone 'Europe/London',
                                      (:'w'::date + 5 + time '14:00') at time zone 'Europe/London', 9, 0, 20, 12, 9, true),
  -- Saturday 05:00-08:00... min 4 h: 04:00-08:00 at the OTHER venue, ending
  -- an hour before s_sat starts: under the 2 h different-venue gap.
  (:'s_gap', :'ev_x', :'role_id', (:'w'::date + 5 + time '04:00') at time zone 'Europe/London',
                                  (:'w'::date + 5 + time '08:00') at time zone 'Europe/London', 9, 0, 20, 12, 9, true),
  -- Saturday 05:00-09:00 at the SAME venue, ending exactly as s_sat starts.
  (:'s_back', :'ev_y', :'role_id', (:'w'::date + 5 + time '05:00') at time zone 'Europe/London',
                                   (:'w'::date + 5 + time '09:00') at time zone 'Europe/London', 9, 0, 20, 12, 9, true);
-- Saturday's Chef: same series, flagged, but another role.
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour, auto_assign, same_staff_all_days) values
  (:'s_chef', :'ev_sat', :'ro_chef', (:'w'::date + 5 + time '09:00') at time zone 'Europe/London',
                                     (:'w'::date + 5 + time '17:00') at time zone 'Europe/London', 9, 0, 20, 12, 9, true, true);

insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, rtw_branch,
                   home_location, right_to_work_until) values
  (:'w_ok',    null, 'Olly',  'Clear',   'ok@sd787.test',    '+447700978701', date '1995-01-01', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null),
  (:'w_clash', null, 'Cleo',  'Clash',   'cl@sd787.test',    '+447700978702', date '1995-01-02', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null),
  (:'w_gap',   null, 'Gus',   'Gap',     'gp@sd787.test',    '+447700978703', date '1995-01-03', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null),
  (:'w_back',  null, 'Bo',    'Back',    'bk@sd787.test',    '+447700978704', date '1995-01-04', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null),
  (:'w_self',  null, 'Sid',   'Selfcx',  'sc@sd787.test',    '+447700978705', date '1995-01-05', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null),
  (:'w_away',  null, 'Ava',   'Away',    'aw@sd787.test',    '+447700978706', date '1995-01-06', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null),
  (:'w_rtw',   null, 'Rae',   'Visa',    'rw@sd787.test',    '+447700978707', date '2001-01-07', 'compliant', 'international_student',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, :'w'::date + 4),
  (:'w_stud',  null, 'Stu',   'Student', 'st@sd787.test',    '+447700978708', date '2001-01-08', 'compliant', 'international_student',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null),
  (:'w_blk',   null, 'Bea',   'Blocked', 'bl@sd787.test',    '+447700978709', date '1995-01-09', 'blocked',   'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null),
  (:'w_dnr',   null, 'Dee',   'Dnr',     'dn@sd787.test',    '+447700978710', date '1995-01-10', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null),
  (:'w_wrong', null, 'Wes',   'Norole',  'wr@sd787.test',    '+447700978711', date '1995-01-11', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null),
  (:'w_acc',   :'acc_uid', 'Abe', 'Accepts', 'ac@sd787.test','+447700978712', date '1995-01-12', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null),
  (:'w_rad',   :'stf_uid', 'Ray', 'Radar',   'rd@sd787.test','+447700978713', date '1995-01-13', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null),
  (:'w_split', null, 'Sol',   'Split',   'sp@sd787.test',    '+447700978714', date '2001-01-14', 'compliant', 'international_student',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null);
-- A student in term time (no holiday ranges on file) is on the 20 h cap.
update staff set term_dates = '{}' where id in (:'w_stud', :'w_split');

insert into staff_roles (staff_id, role_id)
select id, :'role_id' from staff where email like '%@sd787.test' and id <> :'w_wrong';
insert into client_qualifications (client_id, role_id, staff_id, do_not_return)
values (:'clienta', :'role_id', :'w_dnr', true),
       -- Radar shows a worker not qualified at the client only once nobody
       -- qualified is left (RULE-17); the fixture client has such a worker,
       -- so the Radar worker is qualified too.
       (:'clienta', :'role_id', :'w_rad', false);

-- The worker's other commitments.
insert into bookings (shift_id, staff_id, status, source, confirmed_at) values
  (:'s_clash', :'w_clash', 'confirmed', 'auto', now()),
  (:'s_gap',   :'w_gap',   'confirmed', 'auto', now()),
  (:'s_back',  :'w_back',  'confirmed', 'auto', now());
-- Sid cancelled off Saturday's event (RULE-04) - permanent exclusion from it.
insert into bookings (shift_id, staff_id, status, source, cancelled_at, cancel_cause, self_cancelled)
values (:'s_sat', :'w_self', 'cancelled', 'auto', now(), 'self_cancel', true);
-- Ava marked Sunday unavailable (all day, UK midnight to UK midnight).
insert into staff_unavailability (staff_id, period, all_day) values
  (:'w_away', unavailability_range(:'w'::date + 6), true);

-- =====================================================================
-- A · the columns
-- =====================================================================
select is((select series_id from events where id = :'ev_solo'), null,
  'A: an event is in no series unless Duplicate linked it');
select is((select same_staff_all_days from shift_requirements where id = :'s_solo'), false,
  'A: the requirement is off unless the manager switches it on');
select ok(has_column_privilege('authenticated', 'public.shift_requirements', 'same_staff_all_days', 'select'),
  'A: a signed-in session may read same_staff_all_days (shift_requirements grants SELECT column by column)');
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name like 'client\_%'
              and column_name in ('series_id', 'same_staff_all_days')),
  0, 'A: no client_* view names either column - the client portal never sees them');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from events where series_id is not null), 0,
  'A: the client role reads no event row, so no series_id');
select is((select count(*)::int from shift_requirements where same_staff_all_days), 0,
  'A: nor any role section, so no same_staff_all_days');
reset role;
select set_config('request.jwt.claims', '', true);

-- =====================================================================
-- B · the pool is split
-- =====================================================================
select ok(pg_get_functiondef('public.auto_assign_candidates(uuid,boolean)'::regprocedure)
          like '%not_available_all_days%',
  'B: auto_assign_candidates() still carries the series gate - if this fails a later migration redefined the wrapper; add the new gate to auto_assign_candidates_pool() instead');
select ok(pg_get_functiondef('public.auto_assign_candidates_pool(uuid,boolean)'::regprocedure)
          not like '%not_available_all_days%',
  'B: the pool itself knows nothing of series (a sibling check would recurse)');
select is(
  (select count(*)::int
     from auto_assign_candidates(:'s_solo') a
     join auto_assign_candidates_pool(:'s_solo') p using (staff_id)
    where a.gate is distinct from p.gate or a.qualified is distinct from p.qualified
       or a.booking_status is distinct from p.booking_status),
  0, 'B: for a section that is not flagged the wrapper is the pool, row for row');
select is(
  (select count(*)::int from auto_assign_candidates(:'s_solo')),
  (select count(*)::int from auto_assign_candidates_pool(:'s_solo')),
  'B: and returns the same number of rows');
select ok(has_function_privilege('service_role', 'public.auto_assign_candidates(uuid,boolean)', 'execute')
      and has_function_privilege('authenticated', 'public.auto_assign_candidates(uuid,boolean)', 'execute')
      and not has_function_privilege('anon', 'public.auto_assign_candidates(uuid,boolean)', 'execute'),
  'B: grants as before - the jobs and the office run it, anon does not');
select ok(not has_function_privilege('anon', 'public.series_siblings(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.series_hours_blocked(uuid,uuid)', 'execute')
      and not has_function_privilege('anon', 'public.link_event_series(uuid,uuid)', 'execute'),
  'B: anon runs none of the new functions');

-- =====================================================================
-- C · the series gate, one hard gate at a time
-- =====================================================================
select is((select gate from auto_assign_candidates(:'s_fri') where staff_id = :'w_ok'), null,
  'C: a clear worker is a candidate for every day');
select is((select gate from auto_assign_candidates(:'s_sun') where staff_id = :'w_ok'), null,
  'C: ... and for the last day too');

-- booked elsewhere (overlap) on Saturday
select is((select gate from auto_assign_candidates(:'s_fri') where staff_id = :'w_clash'),
  'not_available_all_days', 'C: confirmed on an overlapping Saturday shift: not a candidate for Friday');
select is((select gate from auto_assign_candidates(:'s_sat') where staff_id = :'w_clash'),
  'booked_elsewhere', 'C: ... and on Saturday itself the section''s own gate is the reason');
select is((select gate from auto_assign_candidates_pool(:'s_fri') where staff_id = :'w_clash'), null,
  'C: the pool alone would have let her through Friday - the series gate is what stopped it');

-- the 2 h different-venue gap, and back-to-back at one venue
select is((select gate from auto_assign_candidates(:'s_fri') where staff_id = :'w_gap'),
  'not_available_all_days', 'C: confirmed at another venue 1 h before Saturday starts: the 2 h gap fails Saturday, so Friday is refused');
select is((select gate from auto_assign_candidates(:'s_sat') where staff_id = :'w_gap'),
  'booked_elsewhere', 'C: ... Saturday''s own reason is booked_elsewhere');
select is((select gate from auto_assign_candidates(:'s_fri') where staff_id = :'w_back'), null,
  'C: confirmed at the SAME venue ending exactly as Saturday starts: back-to-back is fine');
select is((select gate from auto_assign_candidates(:'s_sat') where staff_id = :'w_back'), null,
  'C: ... on Saturday too');

-- self-cancelled off a sibling's event (RULE-04)
select is((select gate from auto_assign_candidates(:'s_fri') where staff_id = :'w_self'),
  'not_available_all_days', 'C: cancelled off Saturday''s event: not a candidate for Friday');
select is((select gate from auto_assign_candidates(:'s_sat') where staff_id = :'w_self'),
  'self_cancelled', 'C: ... Saturday''s own gate is self_cancelled');

-- the availability calendar
select is((select gate from auto_assign_candidates(:'s_fri') where staff_id = :'w_away'),
  'not_available_all_days', 'C: marked Sunday unavailable: not a candidate for Friday');
select is((select gate from auto_assign_candidates(:'s_sun') where staff_id = :'w_away'), null,
  'C: Sunday''s own pool is unchanged (the calendar is not a pool gate on its own day; invite_worker handles it)');

-- a right to work that ends mid-series
select is((select gate from auto_assign_candidates(:'s_fri') where staff_id = :'w_rtw'),
  'not_available_all_days', 'C: right to work ends Friday: Saturday and Sunday are past it, so Friday is refused');
select is((select gate from auto_assign_candidates(:'s_sat') where staff_id = :'w_rtw'),
  'rtw_expired', 'C: ... Saturday''s own gate is rtw_expired');

-- worker-level gates are the section's own, on every day
select is((select array_agg(gate order by s) from (
            select 1 s, gate from auto_assign_candidates(:'s_fri') where staff_id = :'w_blk'
            union all select 2, gate from auto_assign_candidates(:'s_sat') where staff_id = :'w_blk'
            union all select 3, gate from auto_assign_candidates(:'s_sun') where staff_id = :'w_blk') x),
  array['blocked', 'blocked', 'blocked'], 'C: a blocked worker is blocked on each day - the section''s own reason, never the series one');
select is((select gate from auto_assign_candidates(:'s_fri') where staff_id = :'w_dnr'), 'do_not_return',
  'C: do-not-return keeps its own name');
select is((select gate from auto_assign_candidates(:'s_fri') where staff_id = :'w_wrong'), 'wrong_role',
  'C: wrong role still produces its own gate (and the board shows no row for it)');

-- =====================================================================
-- D · the projected hours (RULE-20)
-- =====================================================================
select is((select gate from auto_assign_candidates_pool(:'s_fri') where staff_id = :'w_stud'), null,
  'D: a student in term time: 8 h on Friday alone is within the 20 h cap');
select is((select gate from auto_assign_candidates(:'s_fri') where staff_id = :'w_stud'),
  'not_available_all_days', 'D: three 8 h days in one term week (24 h) fail the 20 h cap together');
select is((select gate from auto_assign_candidates(:'s_sun') where staff_id = :'w_stud'),
  'not_available_all_days', 'D: ... from whichever day you ask');
select ok(series_hours_blocked(:'w_stud', :'s_fri'), 'D: series_hours_blocked says so directly');
select ok(not series_hours_blocked(:'w_ok', :'s_fri'), 'D: and not for a worker with no cap');

update shift_requirements set same_staff_all_days = false where id = :'s_sun';
select is((select gate from auto_assign_candidates(:'s_fri') where staff_id = :'w_stud'), null,
  'D: with Sunday not asking for the same staff, two days (16 h) fit');
insert into bookings (shift_id, staff_id, status, source, confirmed_at)
values (:'s_mon', :'w_stud', 'confirmed', 'auto', now());
select is((select gate from auto_assign_candidates(:'s_fri') where staff_id = :'w_stud'),
  'not_available_all_days', 'D: a confirmed 6 h on Monday counts: 6 + 16 = 22 h over the 20 h cap');
delete from bookings where shift_id = :'s_mon' and staff_id = :'w_stud';
update shift_requirements set same_staff_all_days = true where id = :'s_sun';

-- A day the worker already holds is counted once, as projected.
insert into bookings (shift_id, staff_id, status, source, confirmed_at)
values (:'s_fri', :'w_split', 'confirmed', 'auto', now());
select is((select gate from auto_assign_candidates(:'s_sat') where staff_id = :'w_split'),
  'not_available_all_days', 'D: confirmed on Friday already: Friday counts once, not twice (8 + 8 + 8 = 24 h, still over)');
delete from bookings where shift_id = :'s_fri' and staff_id = :'w_split';

-- Three days, but across two cap weeks: each week is judged alone.
update events set event_date = :'w'::date + 7 where id = :'ev_sun';
update shift_requirements
   set starts_at = (:'w'::date + 7 + time '09:00') at time zone 'Europe/London',
       ends_at   = (:'w'::date + 7 + time '17:00') at time zone 'Europe/London'
 where id = :'s_sun';
select is((select gate from auto_assign_candidates(:'s_fri') where staff_id = :'w_stud'), null,
  'D: Fri + Sat (16 h) in one week and the Monday after (8 h) in the next are each within 20 h');
update events set event_date = :'w'::date + 6 where id = :'ev_sun';
update shift_requirements
   set starts_at = (:'w'::date + 6 + time '09:00') at time zone 'Europe/London',
       ends_at   = (:'w'::date + 6 + time '17:00') at time zone 'Europe/London'
 where id = :'s_sun';

-- =====================================================================
-- E · what is not a sibling
-- =====================================================================
select is((select count(*)::int from series_siblings(:'s_fri')), 2,
  'E: Friday''s siblings are Saturday''s and Sunday''s Bar sections');
select is((select count(*)::int from series_siblings(:'s_fri') where shift_id = :'s_chef'), 0,
  'E: another role on the same day is not a sibling');
select is((select count(*)::int from series_siblings(:'s_solo')), 0,
  'E: a section that is not flagged has no siblings');
update shift_requirements set same_staff_all_days = true where id = :'s_solo';
select is((select count(*)::int from series_siblings(:'s_solo')), 0,
  'E: and a flagged section of a single-day event has none either');
update shift_requirements set same_staff_all_days = false where id = :'s_solo';

update shift_requirements set same_staff_all_days = false where id = :'s_sat';
select is((select array_agg(shift_id) from series_siblings(:'s_fri')), array[:'s_sun'::uuid],
  'E: a day that does not ask for the same staff does not constrain this one');
select is((select gate from auto_assign_candidates(:'s_fri') where staff_id = :'w_clash'), null,
  'E: so the Saturday clash no longer matters to Friday');
select is((select gate from auto_assign_candidates(:'s_sat') where staff_id = :'w_clash'), 'booked_elsewhere',
  'E: ... though Saturday''s own gate is unchanged');
update shift_requirements set same_staff_all_days = true where id = :'s_sat';

update events set cancelled_at = now(), cancel_reason = 'fixture' where id = :'ev_sat';
select is((select array_agg(shift_id) from series_siblings(:'s_fri')), array[:'s_sun'::uuid],
  'E: a cancelled event is not a day any more');
update events set cancelled_at = null, cancel_reason = null where id = :'ev_sat';

update shift_requirements
   set starts_at = now() - interval '10 hours', ends_at = now() - interval '5 hours'
 where id = :'s_sat';
select is((select array_agg(shift_id) from series_siblings(:'s_fri')), array[:'s_sun'::uuid],
  'E: a day that has already ended cannot be rostered and is left out');
update shift_requirements
   set starts_at = (:'w'::date + 5 + time '09:00') at time zone 'Europe/London',
       ends_at   = (:'w'::date + 5 + time '17:00') at time zone 'Europe/London'
 where id = :'s_sat';

-- =====================================================================
-- F · every entry path
-- =====================================================================
-- Accept and Radar read the caller; the office may name any worker.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);

select is(invite_worker(:'s_fri', :'w_clash', 'auto'),
  jsonb_build_object('invited', false, 'reason', 'not_available_all_days'),
  'F: an automatic invitation is refused by name');
select is(invite_worker(:'s_fri', :'w_clash', 'manual'),
  jsonb_build_object('invited', false, 'reason', 'not_available_all_days'),
  'F: and so is a manager''s own - it is the client''s requirement, not the machine''s');
select is(invite_worker(:'s_fri', :'w_away', 'manual') ->> 'reason', 'not_available_all_days',
  'F: a calendar entry on a SIBLING day is a hard stop even for a manual invite');
select is(invite_worker(:'s_fri', :'w_stud', 'auto') ->> 'reason', 'not_available_all_days',
  'F: the projected-hours refusal reaches invite_worker the same way');
select is(invite_worker(:'s_sat', :'w_clash', 'auto') ->> 'reason', 'booked_elsewhere',
  'F: on the day itself invite_worker says the section''s own reason');
select is((select count(*)::int from bookings
            where staff_id in (:'w_clash', :'w_away', :'w_stud') and shift_id in (:'s_fri', :'s_sat', :'s_sun')
              and status = 'invited'),
  0, 'F: no booking written for any refusal');
select is((select count(*)::int from notification_outbox
            where recipient_staff_id in (:'w_away', :'w_stud', :'w_gap')),
  0, 'F: and no N5 queued');

select is(invite_worker(:'s_fri', :'w_ok', 'auto') ->> 'invited', 'true',
  'F: a worker clear on every day is invited');
select is(invite_worker(:'s_fri', :'w_back', 'auto') ->> 'invited', 'true',
  'F: so is one who is back-to-back at the same venue');
select is(invite_worker(:'s_sun', :'w_away', 'manual') ->> 'invited', 'true',
  'F: Sunday''s own calendar entry is still the manager''s to override on Sunday (ADR-0043) - the series adds nothing to the day itself');

-- accept_invite: an invitation written while the worker was clear, then a
-- sibling day goes wrong. Refused by name; the invitation is left live.
select is(invite_worker(:'s_fri', :'w_acc', 'auto') ->> 'invited', 'true',
  'F: Abe is invited to Friday while clear');
insert into staff_unavailability (staff_id, period, all_day)
values (:'w_acc', unavailability_range(:'w'::date + 6), true);
select is(accept_invite((select id from bookings where shift_id = :'s_fri' and staff_id = :'w_acc'))->>'reason',
  'not_available_all_days', 'F: he marks Sunday unavailable; his Accept on Friday is refused by name');
select is((select status::text from bookings where shift_id = :'s_fri' and staff_id = :'w_acc'), 'invited',
  'F: and the invitation is left as it was - never withdrawn by this');
delete from staff_unavailability where staff_id = :'w_acc';
select is(accept_invite((select id from bookings where shift_id = :'s_fri' and staff_id = :'w_acc'))->>'ok', 'true',
  'F: once Sunday is clear again, he accepts');

-- Radar: staff_open_shifts follows the pool.
select ok(exists (select 1 from staff_open_shifts(:'w_rad') where shift_id = :'s_fri'),
  'F: a clear worker sees the flagged section on Radar');
insert into staff_unavailability (staff_id, period, all_day)
values (:'w_rad', unavailability_range(:'w'::date + 6), true);
select ok(not exists (select 1 from staff_open_shifts(:'w_rad') where shift_id = :'s_fri'),
  'F: Sunday marked unavailable: Friday''s section leaves their Radar');
select ok(exists (select 1 from staff_open_shifts(:'w_rad') where shift_id = :'s_sun'),
  'F: while Sunday itself stays on it, as before');
select set_config('request.jwt.claims', '', true);

-- Switching the requirement off restores the ordinary pool.
update shift_requirements set same_staff_all_days = false where id = :'s_fri';
select is((select gate from auto_assign_candidates(:'s_fri') where staff_id = :'w_gap'), null,
  'F: Friday''s switch off: the Saturday gap no longer matters to Friday');
update shift_requirements set same_staff_all_days = true where id = :'s_fri';

-- =====================================================================
-- G · Duplicate links the days
-- =====================================================================
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, auto_assign) values
  (:'ev_b',  :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Dup source', :'w'::date + 20, true, true, true),
  (:'ev_c',  :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Dup clone 1', :'w'::date + 21, true, true, true),
  (:'ev_d',  :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Dup clone 2', :'w'::date + 22, true, true, true),
  (:'ev_cb', :'clientb', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Other client', :'w'::date + 22, true, true, true);

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(format($$ select link_event_series(%L, %L) $$, :'ev_b', :'ev_c'),
  'G: the office links a clone to its source');
reset role;
select ok((select series_id from events where id = :'ev_b') is not null
      and (select series_id from events where id = :'ev_b') = (select series_id from events where id = :'ev_c'),
  'G: the source and the clone now share a new series id');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(format($$ select link_event_series(%L, %L) $$, :'ev_b', :'ev_d'),
  'G: a second Duplicate of the same source');
select lives_ok(format($$ select link_event_series(%L, %L) $$, :'ev_b', :'ev_d'),
  'G: and linking again is idempotent');
reset role;
select is((select count(distinct series_id)::int from events where id in (:'ev_b', :'ev_c', :'ev_d')), 1,
  'G: all three days share ONE series - the source''s is reused, not reinvented');
select is((select count(*)::int from audit_log where action = 'event.series_linked' and entity_id in (:'ev_c', :'ev_d')),
  2, 'G: each clone''s link is audited once - the idempotent repeat writes nothing new');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select link_event_series(%L, %L) $$, :'ev_b', :'ev_cb'),
  'P0001', 'series_other_client', 'G: the days of one job belong to one client');
select throws_ok(format($$ select link_event_series(%L, %L) $$, :'ev_b', :'ev_b'),
  'P0001', 'series_needs_two_events', 'G: an event cannot be linked to itself');
select throws_ok(format($$ select link_event_series(%L, %L) $$, :'ev_solo', :'ev_c'),
  'P0001', 'series_clone_already_linked', 'G: a clone already in another series is not moved');
select throws_ok(format($$ select link_event_series(%L, %L) $$, :'ev_b', '78710000-0000-4000-8000-0000000000ff'),
  'P0002', 'event_not_found', 'G: an unknown event is refused');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select link_event_series(%L, %L) $$, :'ev_solo', :'ev_mon'),
  '42501', null, 'G: a Back Office viewer reads but does not link');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'stf_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select link_event_series(%L, %L) $$, :'ev_solo', :'ev_mon'),
  '42501', 'not_authorised', 'G: a worker is refused');
reset role;
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
