-- =====================================================================
-- 665 · "Hours this week" is worked hours; the profile view is rebuilt on
--       today's directory (§9.6, RULE-20)
--
-- Migration 20260930110500. staff_directory_v appends weekly_worked_hours
-- (main's 20260928110700 body otherwise); staff_profile_v is dropped and
-- recreated so `d.*` carries every directory column, with exactly one
-- weekly_cap_until — the directory's. Both keep security_invoker, the
-- profile still masks a removed worker, and the grants are named.
-- =====================================================================
begin;
select plan(18);
\ir _shared/fixtures.psql

\set weekly  '66500000-0000-4000-8000-000000000001'
\set student '66500000-0000-4000-8000-000000000002'
\set gone    '66500000-0000-4000-8000-000000000003'
\set ev      '66510000-0000-4000-8000-000000000001'
\set sh_a    '66520000-0000-4000-8000-000000000001'
\set sh_b    '66520000-0000-4000-8000-000000000002'
\set sh_old  '66520000-0000-4000-8000-000000000003'

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch, employee_id) values
  (:'weekly',  'Wendy', 'Weekly',  'wendy@wh665.test', '+447700966501', date '1995-01-01', 'compliant', 'uk_irish', 96501),
  (:'student', 'Sami',  'Student', 'sami@wh665.test',  '+447700966502', date '2000-01-01', 'compliant', 'international_student', 96502),
  (:'gone',    'Gina',  'Gone',    'gina@wh665.test',  '+447700966503', date '1995-01-01', 'compliant', 'uk_irish', 96503);

update staff set term_dates = array[daterange((now() at time zone 'Europe/London')::date + 40,
                                              (now() at time zone 'Europe/London')::date + 70)]
 where id = :'student';

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'This Week Event',
   (now() at time zone 'Europe/London')::date, true, true);

-- Two sections starting today (UK), so both sit in the current Mon–Sun week
-- whenever the suite runs; one far in the past, outside it.
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'sh_a', :'ev', :'role_id',
     ((now() at time zone 'Europe/London')::date + time '00:01') at time zone 'Europe/London',
     ((now() at time zone 'Europe/London')::date + time '04:01') at time zone 'Europe/London', 4, 0, 30, 15, 1),
  (:'sh_b', :'ev', :'role_id',
     ((now() at time zone 'Europe/London')::date + time '05:00') at time zone 'Europe/London',
     ((now() at time zone 'Europe/London')::date + time '11:00') at time zone 'Europe/London', 4, 0, 30, 15, 1),
  (:'sh_old', :'ev', :'role_id', now() - interval '40 days', now() - interval '40 days' + interval '8 hours',
     4, 0, 30, 15, 1);

insert into bookings (shift_id, staff_id, status, source, confirmed_at) values
  (:'sh_a',   :'weekly', 'worked',    'auto', now()),
  (:'sh_b',   :'weekly', 'confirmed', 'auto', now()),
  (:'sh_old', :'weekly', 'worked',    'auto', now());

-- ---- shape -----------------------------------------------------------------
select is(
  (select column_name::text from information_schema.columns
    where table_schema = 'public' and table_name = 'staff_directory_v'
    order by ordinal_position desc limit 1),
  'weekly_worked_hours',
  'weekly_worked_hours is appended after main''s last directory column, so nothing that names columns moves');
select ok((select 'security_invoker=true' = any(reloptions) from pg_class where relname = 'staff_directory_v'),
  'staff_directory_v keeps security_invoker');
select ok((select 'security_invoker=true' = any(reloptions) from pg_class where relname = 'staff_profile_v'),
  'the recreated staff_profile_v keeps security_invoker');
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'staff_profile_v' and column_name = 'weekly_cap_until'),
  1, 'the profile names weekly_cap_until once — the directory''s, through d.*');
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'staff_profile_v'
      and column_name in ('reliability', 'last_shift_at', 'released_shift_count', 'p45_requested_at',
                          'weekly_worked_hours', 'email', 'phone', 'ni_number_masked', 'shifts_worked')),
  9, 'd.* is expanded against today''s directory: its later columns reach the profile, and the profile''s own stay');

-- ---- worked / booked hours this week (§9.6) ------------------------------------
select is((select weekly_worked_hours from staff_directory_v where id = :'weekly'), 4::numeric,
  'worked: the 4 h section this week that reached worked, at its scheduled window — not the one 40 days ago');
select is((select weekly_booked_hours from staff_directory_v where id = :'weekly'), 10::numeric,
  'booked still counts the confirmed 6 h too — the cap gates on what is committed');
select is((select weekly_worked_hours from staff_profile_v where id = :'weekly'), 4::numeric,
  'the profile reads the same worked figure');
select is((select weekly_worked_hours from staff_directory_v where id = :'student'), 0::numeric,
  'nobody worked yet reads 0, not null');

-- ---- the until date, from one place ----------------------------------------------
select is((select weekly_cap_until from staff_profile_v where id = :'student'),
          (select weekly_cap_until from staff_directory_v where id = :'student'),
  'the profile''s "until" date is the directory''s');
select ok((select weekly_cap_until is null from staff_profile_v where id = :'weekly'),
  'and a worker on no visa condition has none');
select is((select reliability from staff_profile_v where id = :'weekly'),
          staff_show_rate(:'weekly')::numeric(5,2),
  'the derived show-rate still reaches the profile (20260928110700)');

-- ---- §1.7 masking on the recreated view ------------------------------------------
update staff set removed_at = now() where id = :'gone';
select ok((select email is null and phone is null and home_address is null
             from staff_profile_v where id = :'gone'),
  'a removed worker''s personal columns are still masked on the recreated profile');

-- ---- grants ------------------------------------------------------------------------
select ok(not has_table_privilege('anon', 'public.staff_profile_v', 'select'),
  'anon cannot read the profile view');
select ok(has_table_privilege('authenticated', 'public.staff_profile_v', 'select')
      and not has_table_privilege('authenticated', 'public.staff_profile_v', 'insert'),
  'authenticated reads it and writes nothing through it');
select ok(not has_table_privilege('anon', 'public.staff_directory_v', 'select'),
  'nor the directory');

-- ---- who sees what -------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from staff_profile_v where id in (:'weekly', :'student', :'gone')), 0,
  'a worker still sees nobody else through the profile');
select is((select count(*)::int from staff_directory_v where id in (:'weekly', :'student', :'gone')), 0,
  'or the directory');
reset role;

select * from finish();
rollback;
