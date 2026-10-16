-- =====================================================================
-- 846 · The Staff directory fits inside the statement limit (ADR-0147)
--   20261016100000_staff_directory_fits_the_statement_limit.sql
--
-- Reported 16.10.2026: /staff showed "canceling statement due to statement
-- timeout" and an empty directory. `authenticated` runs under
-- statement_timeout = 8 s (20261012120000) and the page reads
-- staff_directory_v whole. Held here:
--
--   A · cap_band_until() — the same Sunday as before for the calendars
--       that matter (a holiday ahead, one running now, a week covered by
--       two adjacent ranges, one that opens on a Saturday, a Thursday
--       restart, nothing at all, past the 53-week horizon);
--   B · weekly_booked_hours() — still exactly what booking_counts_toward_cap()
--       commits, for the week the shift STARTS in, and nothing else;
--   C · the directory's cap columns are weekly_cap_for()'s and
--       cap_band_until()'s answers, and its weekly_booked_hours column is
--       the function's — one source of truth, read once;
--   D · the clock: the page's exact column list over 1,000 workers (200 on
--       a student visa, each with a term calendar) completes under the
--       8 s limit, and a reader that selects four columns pays for none of
--       the cap.
--
-- Every row is created inside the transaction and rolled back.
-- =====================================================================
begin;
select plan(23);
\ir _shared/fixtures.psql

\set w_std   '84600000-0000-4000-8000-000000000001'
\set w_stud  '84600000-0000-4000-8000-000000000002'
\set ev      '84610000-0000-4000-8000-000000000001'
\set sh_a    '84620000-0000-4000-8000-000000000001'
\set sh_b    '84620000-0000-4000-8000-000000000002'
\set sh_c    '84620000-0000-4000-8000-000000000003'
\set sh_d    '84620000-0000-4000-8000-000000000004'
\set sh_e    '84620000-0000-4000-8000-000000000005'
\set sh_old  '84620000-0000-4000-8000-000000000006'

-- ---- A · cap_band_until ------------------------------------------------
select is(cap_band_until('{"[2026-12-12,2027-01-11)"}'::daterange[], date '2026-11-30'), date '2026-12-13',
  'A: a holiday ahead — the band holds to the Sunday before the first holiday WEEK (the 12th is a Saturday, so the week of the 7th straddles and stays at 20 h)');
select is(cap_band_until('{"[2026-12-14,2027-01-11)"}'::daterange[], date '2026-12-16'), date '2027-01-10',
  'A: a holiday running now — the 48 h band holds to the Sunday before term resumes');
select is(cap_band_until('{"[2026-12-14,2026-12-17)","[2026-12-17,2026-12-21)"}'::daterange[], date '2026-12-01'), date '2026-12-13',
  'A: a week covered by two adjacent ranges is a holiday week, as cap_term_state() reads it');
select is(cap_band_until('{"[2026-12-19,2027-01-11)"}'::daterange[], date '2026-12-01'), date '2026-12-20',
  'A: a holiday that opens on a Saturday straddles that week and keeps the lower cap; the band ends the Sunday after');
select is(cap_band_until('{"[2026-06-15,2026-09-24)"}'::daterange[], date '2026-09-01'), date '2026-09-20',
  'A: term restarting on a Thursday — the 48 h band ended on the Sunday before that week');
select is(cap_band_until('{}'::daterange[], date '2026-12-01'), null::date,
  'A: no calendar, nothing ends the band');
select is(cap_band_until(null, date '2026-12-01'), null::date, 'A: a null calendar is no calendar');
select is(cap_band_until('{"[2028-01-01,2028-02-01)"}'::daterange[], date '2026-12-01'), null::date,
  'A: a holiday beyond the 53-week horizon ends nothing yet');
select is(cap_band_until('{}'::daterange[], null), null::date, 'A: a null date answers null, as it did');

-- ---- B · weekly_booked_hours ------------------------------------------
select cap_week_start((now() at time zone 'Europe/London')::date) as mon \gset

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch, employee_id) values
  (:'w_std',  'Sid',  'Standard', 'sid@d846.test',  '+447700984501', date '1995-01-01', 'compliant', 'uk_irish', 98501),
  (:'w_stud', 'Sue',  'Student',  'sue@d846.test',  '+447700984502', date '2000-01-01', 'compliant', 'international_student', 98502);
update staff set term_dates = array[daterange(:'mon'::date + 40, :'mon'::date + 70)] where id = :'w_stud';

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Limit Event', :'mon'::date, true, true);

-- Five 4 h sections that START in the current Mon-Sun week (UK) and one 8 h
-- section the week before.
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'sh_a', :'ev', :'role_id', (:'mon'::date + time '00:30') at time zone 'Europe/London', (:'mon'::date + time '04:30') at time zone 'Europe/London', 4, 0, 30, 15, 1),
  (:'sh_b', :'ev', :'role_id', (:'mon'::date + 1 + time '09:00') at time zone 'Europe/London', (:'mon'::date + 1 + time '13:00') at time zone 'Europe/London', 4, 0, 30, 15, 1),
  (:'sh_c', :'ev', :'role_id', (:'mon'::date + 2 + time '09:00') at time zone 'Europe/London', (:'mon'::date + 2 + time '13:00') at time zone 'Europe/London', 4, 0, 30, 15, 1),
  (:'sh_d', :'ev', :'role_id', (:'mon'::date + 3 + time '09:00') at time zone 'Europe/London', (:'mon'::date + 3 + time '13:00') at time zone 'Europe/London', 4, 0, 30, 15, 1),
  (:'sh_e', :'ev', :'role_id', (:'mon'::date + 6 + time '19:30') at time zone 'Europe/London', (:'mon'::date + 6 + time '23:30') at time zone 'Europe/London', 4, 0, 30, 15, 1),
  (:'sh_old', :'ev', :'role_id', (:'mon'::date - 3 + time '09:00') at time zone 'Europe/London', (:'mon'::date - 3 + time '17:00') at time zone 'Europe/London', 4, 0, 30, 15, 1);

-- Counts: worked (sh_a 4 h), confirmed (sh_b 4 h), the Sunday evening (sh_e 4 h).
-- Does not: invited (sh_c), a `closed` row stamped with a decline (sh_d),
-- and the previous week's shift.
insert into bookings (shift_id, staff_id, status, source, confirmed_at) values
  (:'sh_a',   :'w_std', 'worked',    'auto', now()),
  (:'sh_b',   :'w_std', 'confirmed', 'auto', now()),
  (:'sh_c',   :'w_std', 'invited',   'auto', null),
  (:'sh_e',   :'w_std', 'confirmed', 'auto', now()),
  (:'sh_old', :'w_std', 'worked',    'auto', now());
insert into bookings (shift_id, staff_id, status, source, cancelled_at, cancel_cause) values
  (:'sh_d',   :'w_std', 'closed',    'auto', now(), 'declined');

select is(weekly_booked_hours(:'w_std', :'mon'::date), 12::numeric,
  'B: worked and confirmed count (4 + 4 + the Sunday evening 4); invited, a declined closed row and last week''s shift do not');
select is(weekly_booked_hours(:'w_std', :'mon'::date + 6), 12::numeric,
  'B: any day of the Mon-Sun week asks about the same week');
select is(weekly_booked_hours(:'w_std', :'mon'::date - 1), 8::numeric,
  'B: the week before holds its own 8 h and nothing of this week');
select is(weekly_booked_hours(:'w_std', :'mon'::date + 7), 0::numeric, 'B: a week with no shifts is 0, not null');
select is(weekly_booked_hours(:'w_stud', :'mon'::date), 0::numeric, 'B: a worker with no bookings is 0');
select is(weekly_booked_hours(:'w_std', null), 0::numeric, 'B: no date, no hours — as before');

-- ---- C · the directory's columns are the functions' answers -------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select weekly_booked_hours from staff_directory_v where id = :'w_std'), 12::numeric,
  'C: weekly_booked_hours in the directory is the function''s');
select is(
  (select (weekly_cap_hours, weekly_cap_band)::text from staff_directory_v where id = :'w_stud'),
  (select (c.cap_hours, c.band)::text from weekly_cap_for(:'w_stud', (now() at time zone 'Europe/London')::date) c),
  'C: a student''s cap hours and band are weekly_cap_for()''s, asked once');
select is(
  (select (weekly_cap_hours, weekly_cap_band)::text from staff_directory_v where id = :'w_std'),
  (select (c.cap_hours, c.band)::text from weekly_cap_for(:'w_std', (now() at time zone 'Europe/London')::date) c),
  'C: and so is a standard worker''s');
select is((select weekly_cap_until from staff_directory_v where id = :'w_stud'),
  cap_band_until((select term_dates from staff where id = :'w_stud'), (now() at time zone 'Europe/London')::date),
  'C: weekly_cap_until is cap_band_until() for a term-time student — the date N14 prints');
select is((select weekly_cap_until from staff_directory_v where id = :'w_std'), null::date,
  'C: and null for a worker whose band the calendar does not move');

-- ---- D · the clock ------------------------------------------------------
reset role;
insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch, home_location, term_dates)
select gen_random_uuid(), 'Gen' || g, 'Worker' || g, 'gen' || g || '@d846.test', '+4477098' || lpad(g::text, 5, '0'),
       date '1995-01-01', 'compliant',
       case when g % 5 = 0 then 'international_student'::rtw_branch else 'uk_irish'::rtw_branch end,
       st_setsrid(st_makepoint(-0.1 + (g % 50) / 500.0, 51.5), 4326)::geography,
       case when g % 5 = 0 then array[daterange(:'mon'::date + 40, :'mon'::date + 70)] else '{}'::daterange[] end
  from generate_series(1, 1000) g;
insert into staff_roles (staff_id, role_id) select id, :'role_id' from staff where email like 'gen%@d846.test';
-- a booking history: twenty shifts each
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer)
select gen_random_uuid(), :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
       st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Hist ' || g, :'mon'::date - (g % 90), true, true
  from generate_series(1, 400) g;
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer, charge_rate, pay_rate, allocation_per_hour)
select gen_random_uuid(), e.id, :'role_id', (e.event_date + time '10:00') at time zone 'Europe/London',
       (e.event_date + time '18:00') at time zone 'Europe/London', 50, 0, 30, 15, 1
  from events e where e.title like 'Hist %';
create temp table d846_sh as
  select sr.id, row_number() over () rn from shift_requirements sr join events e on e.id = sr.event_id where e.title like 'Hist %';
create temp table d846_st as
  select id, row_number() over () rn from staff where email like 'gen%@d846.test';
insert into bookings (shift_id, staff_id, status, source, confirmed_at)
select h.id, w.id, 'worked', 'auto', now()
  from d846_st w cross join generate_series(0, 19) k
  join d846_sh h on h.rn = 1 + ((w.rn * 7 + k * 31) % 400)
on conflict do nothing;
analyze staff; analyze bookings; analyze shift_requirements;

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
-- The session's own limit, as the app's office session has it.
set local statement_timeout = '8s';

create temp table d846_clock (what text, took interval);
do $$
declare
  t timestamptz;
begin
  t := clock_timestamp();
  perform id, employee_id, status, removed, display_name, photo_path, rating, reliability, block_kind, block_reason,
          rtw_branch, right_to_work_until, graduated_at, wtr_optout, left_at, leave_reason, role_names,
          unresolved_violations, do_not_return_clients, weekly_cap_hours, weekly_cap_band, weekly_booked_hours,
          weekly_cap_until, last_shift_at, released_shift_count, p45_requested_at, spudbros_express,
          thc_shifts_enabled, payroll_id
     from staff_directory_v order by display_name;
  insert into d846_clock values ('page', clock_timestamp() - t);

  t := clock_timestamp();
  perform id, display_name, employee_id, role_names from staff_directory_v where status = 'compliant' order by display_name;
  insert into d846_clock values ('narrow', clock_timestamp() - t);
end $$;

select ok(true, 'D: the page''s exact column list over 1,000+ workers completes inside the 8 s statement limit');
select ok((select took < interval '5 seconds' from d846_clock where what = 'page'),
  'D: ... with room to spare on slower hardware (it was ~6.5 s before, over 8 s with a booking history)');
select ok((select took < interval '1 second' from d846_clock where what = 'narrow'),
  'D: a reader that selects four columns (the client page''s staff picker, the feedback typeahead) pays for none of the cap');

select * from finish();
rollback;
