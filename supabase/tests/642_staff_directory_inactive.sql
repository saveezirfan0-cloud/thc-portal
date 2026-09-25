-- =====================================================================
-- 642 · The staff directory's Inactive tab, the "Limit reached" date and
--       the week's worked hours (§9.6, §10.6, RULE-20)
--
-- Migration 20260929160100. The Inactive tab needs the last completed
-- shift, the shifts the leaver's request released and whether E8 reached
-- the office; the "Limit reached" hover needs the date a student's band
-- holds until; the profile's "Hours this week" is worked / limit; the
-- search runs over the phone. The views keep security_invoker, and
-- staff_profile_v, recreated, still masks a removed worker.
-- =====================================================================
begin;
select plan(24);
\ir _shared/fixtures.psql

\set leaver   '64200000-0000-4000-8000-000000000001'
\set weekly   '64200000-0000-4000-8000-000000000002'
\set student  '64200000-0000-4000-8000-000000000003'
\set gone     '64200000-0000-4000-8000-000000000004'
\set ev_old   '64210000-0000-4000-8000-000000000001'
\set ev_last  '64210000-0000-4000-8000-000000000002'
\set ev_next  '64210000-0000-4000-8000-000000000003'
\set ev_week  '64210000-0000-4000-8000-000000000004'
\set sh_old   '64220000-0000-4000-8000-000000000001'
\set sh_last  '64220000-0000-4000-8000-000000000002'
\set sh_next  '64220000-0000-4000-8000-000000000003'
\set sh_next2 '64220000-0000-4000-8000-000000000004'
\set sh_wk_a  '64220000-0000-4000-8000-000000000005'
\set sh_wk_b  '64220000-0000-4000-8000-000000000006'

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch, employee_id) values
  (:'leaver',  'Rosa',  'Leaver',  'rosa@rls.test',  '+447700900601', date '1995-01-01', 'compliant', 'uk_irish', 96401),
  (:'weekly',  'Wendy', 'Weekly',  'wendy@rls.test', '+447700900602', date '1995-01-01', 'compliant', 'uk_irish', 96402),
  (:'student', 'Sami',  'Student', 'sami@rls.test',  '+447700900603', date '2000-01-01', 'compliant', 'international_student', 96403),
  (:'gone',    'Gina',  'Gone',    'gina@rls.test',  '+447700900604', date '1995-01-01', 'compliant', 'uk_irish', 96404);

update staff set term_dates = array[daterange((now() at time zone 'Europe/London')::date + 40,
                                              (now() at time zone 'Europe/London')::date + 70)]
 where id = :'student';

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer)
select v.id::uuid, :'clienta', :'venue_id', v.venue, '1 Test Street, London',
       st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
       v.title, (now() at time zone 'Europe/London')::date + v.days, true, true
  from (values (:'ev_old',  'Members Night',   'The Dorchester', -40),
               (:'ev_last', 'Corporate Lunch', 'The Savoy',      -20),
               (:'ev_next', 'Gala Dinner',     'Leonardo',        20),
               (:'ev_week', 'This Week Event', 'Leonardo',         0)) as v(id, title, venue, days);

-- The week's two sections start at 00:01 UK today, so they sit in the
-- current Mon–Sun week whatever time the suite runs.
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'sh_old',   :'ev_old',  :'role_id', now() - interval '40 days', now() - interval '40 days' + interval '8 hours', 4, 0, 30, 15, 1),
  (:'sh_last',  :'ev_last', :'role_id', now() - interval '20 days', now() - interval '20 days' + interval '6 hours', 4, 0, 30, 15, 1),
  (:'sh_next',  :'ev_next', :'role_id', now() + interval '20 days', now() + interval '20 days' + interval '8 hours', 4, 0, 30, 15, 1),
  (:'sh_next2', :'ev_next', :'role_id', now() + interval '21 days', now() + interval '21 days' + interval '8 hours', 4, 0, 30, 15, 1),
  (:'sh_wk_a',  :'ev_week', :'role_id',
     ((now() at time zone 'Europe/London')::date + time '00:01') at time zone 'Europe/London',
     ((now() at time zone 'Europe/London')::date + time '04:01') at time zone 'Europe/London', 4, 0, 30, 15, 1),
  (:'sh_wk_b',  :'ev_week', :'role_id',
     ((now() at time zone 'Europe/London')::date + time '05:00') at time zone 'Europe/London',
     ((now() at time zone 'Europe/London')::date + time '11:00') at time zone 'Europe/London', 4, 0, 30, 15, 1);

insert into bookings (shift_id, staff_id, status, source, confirmed_at) values
  (:'sh_old',   :'leaver', 'worked',    'auto', now()),
  (:'sh_last',  :'leaver', 'worked',    'auto', now()),
  (:'sh_next',  :'leaver', 'confirmed', 'auto', now()),
  (:'sh_wk_a',  :'weekly', 'worked',    'auto', now()),
  (:'sh_wk_b',  :'weekly', 'confirmed', 'auto', now());
insert into bookings (shift_id, staff_id, status, source) values
  (:'sh_next2', :'leaver', 'invited',   'auto');

-- §10.6: the worker leaves through the app.
select request_p45(:'leaver', 'Moving back to Spain', now());

-- ---- shape --------------------------------------------------------------
select ok((select 'security_invoker=true' = any(reloptions) from pg_class where relname = 'staff_directory_v'),
  'staff_directory_v keeps security_invoker: staff''s own RLS still decides who is listed');
select ok((select 'security_invoker=true' = any(reloptions) from pg_class where relname = 'staff_profile_v'),
  'the recreated staff_profile_v keeps security_invoker');
select ok(not has_table_privilege('anon', 'staff_profile_v', 'select')
          and has_table_privilege('authenticated', 'staff_profile_v', 'select'),
  'staff_profile_v is readable by a signed-in session and not by anon');
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name = 'staff_profile_v'
              and column_name in ('phone', 'weekly_cap_until', 'weekly_worked_hours',
                                  'released_shifts', 'email', 'ni_number_masked')), 6,
  'the profile carries the directory''s new columns through d.* and keeps its own');
select ok(exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'student_visa_v'
                     and column_name = 'weekly_cap_until'),
  'student_visa_v carries weekly_cap_until for the "until" line');

-- ---- the Inactive tab (§9.6, §10.6) --------------------------------------
select is((select leave_reason from staff_directory_v where id = :'leaver'), 'Moving back to Spain',
  'the reason they gave');
select ok((select left_at is not null from staff_directory_v where id = :'leaver'),
  'the date they left');
select is((select last_worked_event || ' · ' || last_worked_venue from staff_directory_v where id = :'leaver'),
  'Corporate Lunch · The Savoy',
  'last completed shift: the most recent worked booking, not an older one');
select ok((select last_worked_at::date = (now() - interval '20 days')::date from staff_directory_v where id = :'leaver'),
  'with its date');
select is((select jsonb_array_length(released_shifts) from staff_directory_v where id = :'leaver'), 1,
  'released shifts: the one confirmed booking the request released — the withdrawn invitation is not a lost shift');
select is((select released_shifts->0->>'title' from staff_directory_v where id = :'leaver'), 'Gala Dinner',
  'named by its event');
select ok((select p45_notice_sent_at is null and p45_notice_failed_at is null from staff_directory_v where id = :'leaver'),
  'E8 is queued, neither sent nor failed yet');
update notification_outbox set sent_at = now() where template = 'E8' and key like 'E8:staff:' || :'leaver' || ':%';
select ok((select p45_notice_sent_at is not null from staff_directory_v where id = :'leaver'),
  'once the drain sends E8, the tab says so');
select ok((select released_shifts is null and last_worked_event is null from staff_directory_v where id = :'weekly'),
  'the Inactive columns are only computed for an inactive worker');

-- ---- worked / booked hours this week (§9.6) -------------------------------
select is((select weekly_worked_hours from staff_directory_v where id = :'weekly'), 4::numeric,
  'worked hours: the 4 h section that reached worked');
select is((select weekly_booked_hours from staff_directory_v where id = :'weekly'), 10::numeric,
  'booked hours still count the confirmed 6 h too — the cap gates on what is committed');
select is((select weekly_worked_hours from staff_profile_v where id = :'weekly'), 4::numeric,
  'the profile reads the same worked figure');

-- ---- the "Limit reached" date (§9.6) --------------------------------------
select is((select weekly_cap_until from staff_directory_v where id = :'student'),
          (select cap_band_until(term_dates, (now() at time zone 'Europe/London')::date) from staff where id = :'student'),
  'a student''s band carries the Sunday it holds until');
select ok((select weekly_cap_until is null from staff_directory_v where id = :'weekly'),
  'nobody else gets a date with no visa rule behind it');
select is((select weekly_cap_until from student_visa_v where id = :'student'),
          (select weekly_cap_until from staff_directory_v where id = :'student'),
  'the Student visa view reads the same date');

-- ---- phone, for the search, masked on removal (§1.7) -----------------------
select is((select phone from staff_directory_v where id = :'weekly'), '+447700900602',
  'the directory row carries the phone for the search');
update staff set removed_at = now() where id = :'gone';
select ok((select phone is null from staff_directory_v where id = :'gone'),
  'a removed worker''s phone is masked in the directory');
select ok((select phone is null from staff_profile_v where id = :'gone'),
  'and on the recreated profile');

-- ---- who sees what -----------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from staff_directory_v where id in (:'leaver', :'weekly', :'student', :'gone')), 0,
  'a worker still sees nobody else through the directory');
reset role;

select * from finish();
rollback;
