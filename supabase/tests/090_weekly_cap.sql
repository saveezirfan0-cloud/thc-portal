-- =====================================================================
-- 090 · the calculated weekly cap, RULE-20 (Scope §4.4–4.5)
--
-- Two halves, matching the two halves of the rule:
--
--   1. The BAND. Every case in packages/domain/src/cap.vectors.json is run
--      against the SQL weekly_cap(), and the result compared to the same
--      expectation Vitest holds the TypeScript weeklyCap() to. The cases
--      arrive through _shared/cap_vectors.psql, which is generated from
--      that JSON — so neither implementation can be given a case the other
--      lacks, which is the whole point of the vectors.
--
--   2. The HOURS. cap_term_state off real holiday ranges, the Mon-Sun week
--      boundary, the sum of committed hours, what is left and the hard
--      gate auto-assign calls (§3.4).
--
-- Every row is created inside the transaction and rolled back, so this
-- coexists with supabase/seed.sql; assertions address fixture rows by
-- their fixed UUIDs, never by global counts.
-- =====================================================================
begin;
select plan(38);

\ir _shared/cap_vectors.psql

-- ---------------------------------------------------------------------
-- 1. The shared vectors
-- ---------------------------------------------------------------------
select is(
  (select count(*)::int from cap_vectors), :cap_vector_count,
  format('all %s shared cap vectors loaded from cap.vectors.json', :cap_vector_count)
);

select results_eq(
  $$ select v.name, c.cap_hours, c.band::text
       from cap_vectors v
       cross join lateral weekly_cap(v.visa_limited, v.term_state,
                                     v.completion_letter_verified, v.optout_48h,
                                     v.week_start, v.below_degree_level,
                                     v.completion_date, v.visa_expiry,
                                     v.optout_cancelled_from, v.under18) c
      order by v.name $$,
  $$ select name, expect_cap_hours, expect_band from cap_vectors order by name $$,
  'cap.vectors.json: SQL weekly_cap() gives the same cap AND band as TypeScript weeklyCap(), case for case'
);

-- The vectors say what the rule does; these say it is the rule, not a
-- lookup table that happens to fit. Stated in the scope's own words.
select is(
  (select cap_hours from weekly_cap(true, 'straddle', false, true)), 20,
  '§4.4: a Mon-Sun week that straddles term and holiday takes the LOWER cap, opt-out or not'
);
select is(
  (select cap_hours from weekly_cap(true, 'term', false, true)), 20,
  '§4.4 opt-out table: an opt-out cannot exceed a limit imposed by a visa'
);
select is(
  (select cap_hours from weekly_cap(true, 'term', true, false)), 48,
  '§4.5: once the completion letter is verified the term dates no longer switch anything'
);
select is(
  (select cap_hours from weekly_cap(true, 'term', true, true)), null,
  '§4.5: completion letter PLUS opt-out is what removes the weekly ceiling'
);

-- This used to read "no ceiling is null, never 0", written when no band
-- returned 0 and the only way to see one would have been a bug. The
-- completion-letter requirement introduced visa_expired_0, which is a real
-- cap of no hours and a different thing entirely. What still has to hold —
-- and what that assertion was actually protecting — is that the two are
-- never confused: null means no ceiling and belongs to `uncapped` alone.
select is_empty(
  $$ select name from cap_vectors
      where (expect_cap_hours is null) <> (expect_band = 'uncapped') $$,
  'null hours means no ceiling and only the uncapped band; a real cap of 0 (visa_expired_0) is never written as null'
);

-- ---------------------------------------------------------------------
-- 2. Fixtures for the hours side
--
--   capstudent — International student, one holiday range on the verified
--                term letter: 17.12.2026 – 05.01.2027. That one range gives
--                all four term states — a week wholly outside it (term), a
--                week wholly inside it (holiday), the week it starts in and
--                the week term restarts in (both straddles, both 20 h).
--   capbrit    — UK citizen, no opt-out: 48 h whatever the calendar says.
-- ---------------------------------------------------------------------
\set capstudent '6a6a6a6a-0000-4000-8000-000000000001'
\set capbrit    '6a6a6a6a-0000-4000-8000-000000000002'
\set cap_client '6b6b6b6b-0000-4000-8000-000000000001'
\set cap_role   '6b6b6b6b-0000-4000-8000-000000000002'
\set cap_venue  '6b6b6b6b-0000-4000-8000-000000000003'
\set cap_event  '6b6b6b6b-0000-4000-8000-000000000004'
\set cap_shift1 '6c6c6c6c-0000-4000-8000-000000000001'
\set cap_shift2 '6c6c6c6c-0000-4000-8000-000000000002'
\set cap_shift3 '6c6c6c6c-0000-4000-8000-000000000003'

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch,
                   wtr_optout, term_dates) values
  (:'capstudent', 'Cap', 'Student', 'capstudent@cap.test', '+447700900101', date '1999-03-03',
   'compliant', 'international_student', false,
   array[daterange('2026-12-17', '2027-01-06', '[)')]),   -- inclusive 17.12.2026 .. 05.01.2027
  (:'capbrit', 'Cap', 'Brit', 'capbrit@cap.test', '+447700900102', date '1993-04-04',
   'compliant', 'uk_irish', false, '{}');

insert into clients (id, name, contact_name, phone, staff_contact_point, contact_emails) values
  (:'cap_client', 'Cap Fixture Client', 'Cara C', '+447700900103', 'Front desk', array['cap@cap.test']);
insert into roles (id, name, pay_rate) values (:'cap_role', 'Cap Fixture Role', 14.00);
insert into venues (id, name, address, location, venue_type, geofence_radius_m) values
  (:'cap_venue', 'Cap Fixture Venue', '2 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 'hotel', 150);
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'cap_event', :'cap_client', :'cap_venue', 'Cap Fixture Venue', '2 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Cap Fixture Event', date '2026-11-04', true, true);

-- Three 8-hour sections in the Mon-Sun week of Mon 02.11.2026 (term time).
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'cap_shift1', :'cap_event', :'cap_role',
   timestamptz '2026-11-02 09:00+00', timestamptz '2026-11-02 17:00+00', 4, 0, 22.97, 14.00, 4),
  (:'cap_shift2', :'cap_event', :'cap_role',
   timestamptz '2026-11-03 09:00+00', timestamptz '2026-11-03 17:00+00', 4, 0, 22.97, 14.00, 4),
  (:'cap_shift3', :'cap_event', :'cap_role',
   timestamptz '2026-11-04 09:00+00', timestamptz '2026-11-04 17:00+00', 4, 0, 22.97, 14.00, 4);

-- ---------------------------------------------------------------------
-- 3. The Mon-Sun week and the term state
-- ---------------------------------------------------------------------
select is(cap_week_start(date '2026-11-08'), date '2026-11-02',
  'the week is Mon-Sun: a Sunday belongs to the Monday before it, not the one after');
select is(cap_week_start(date '2026-11-02'), date '2026-11-02',
  'a Monday is its own week start');

-- The one holiday range off capstudent's verified letter, spelled out: the
-- inclusive 17.12.2026 – 05.01.2027 that the fixture above carries.
select is(cap_term_state(array[daterange('2026-12-17','2027-01-06','[)')], date '2026-12-23'), 'holiday',
  'a week wholly inside a holiday range is holiday');
select is(cap_term_state(array[daterange('2026-12-17','2027-01-06','[)')], date '2026-11-04'), 'term',
  'a week with no day inside any holiday range is term time');
select is(cap_term_state(array[daterange('2026-12-17','2027-01-06','[)')], date '2026-12-17'), 'straddle',
  'the week the holiday begins on the Thursday is a straddle, not a holiday week');
select is(cap_term_state(array[daterange('2026-12-17','2027-01-06','[)')], date '2027-01-07'), 'straddle',
  'the week term restarts in is a straddle too — §4.4 makes it a 20-hour week');
select is(cap_term_state('{}'::daterange[], date '2026-11-04'), 'term',
  'no holiday ranges on file reads as term time — every day is outside every range');
select is(cap_term_state(null, date '2026-11-04'), 'term',
  'a null term_dates array reads as term time too, never as no cap');

-- ---------------------------------------------------------------------
-- 4. The cap for a real worker, read live off their row
-- ---------------------------------------------------------------------
select is(weekly_cap_hours(:'capstudent', date '2026-11-04'), 20,
  'the student is capped at 20 h in a term-time week');
select is(weekly_cap_hours(:'capstudent', date '2026-12-23'), 48,
  'the same student is at 48 h in the university holiday — no cron flipped anything');
select is(weekly_cap_hours(:'capstudent', date '2027-01-07'), 20,
  'the week term restarts in is back to 20 h (§4.4 straddle)');
select is(weekly_cap_band(:'capstudent', date '2026-12-23')::text, 'student_holiday_48',
  'the band says what produced the number, for the §2.3 profile line');
select is(weekly_cap_hours(:'capbrit', date '2026-11-04'), 48,
  'a UK citizen is at 48 h regardless of the calendar');

-- §4.5 is effective-dated from verification, never backdated.
update staff set graduated_at = date '2026-12-01' where id = :'capstudent';
select is(weekly_cap_hours(:'capstudent', date '2026-11-04'), 20,
  'graduation does not reach back: the week before it was verified is still 20 h');
select is(weekly_cap_hours(:'capstudent', date '2027-01-07'), 48,
  'after verification the term dates stop switching anything — flat 48 h');
update staff set graduated_at = null where id = :'capstudent';

-- ---------------------------------------------------------------------
-- 5. The hours-summing side
-- ---------------------------------------------------------------------
insert into bookings (shift_id, staff_id, status, source, confirmed_at) values
  (:'cap_shift1', :'capstudent', 'confirmed', 'auto', now()),
  (:'cap_shift2', :'capstudent', 'invited',   'auto', null);

select is(weekly_booked_hours(:'capstudent', date '2026-11-04'), 8::numeric,
  'only the confirmed booking counts toward the week: an invitation is not a commitment');

select is(weekly_hours_remaining(:'capstudent', date '2026-11-04'), 12::numeric,
  '20 h term cap minus the 8 h already confirmed leaves 12 h');

select is(weekly_cap_would_breach(:'capstudent', :'cap_shift3'), false,
  'an 8-hour shift fits inside the 12 h left, so the hard gate lets the worker through');

-- Confirming the second shift takes them to 16 h; the third would make 24.
update bookings set status = 'confirmed', confirmed_at = now()
 where shift_id = :'cap_shift2' and staff_id = :'capstudent';
select is(weekly_cap_would_breach(:'capstudent', :'cap_shift3'), true,
  '16 h confirmed + an 8-hour shift is 24 h against a 20 h cap: §3.4 gates the worker out');

-- The same worker, uncapped: the gate has to say false, not crash on null.
update staff set graduated_at = date '2026-01-01', wtr_optout = true where id = :'capstudent';
select is(weekly_cap_would_breach(:'capstudent', :'cap_shift3'), false,
  'a worker with no ceiling is never gated out on hours, however many they hold');
select is(weekly_hours_remaining(:'capstudent', date '2026-11-04'), null,
  'no ceiling is null hours remaining, not 0 — the two must never be confused');

-- ---------------------------------------------------------------------
-- 8. The worker-bound wiring (completion-letter requirement)
--
-- The vectors above hold the PURE function to TypeScript. They cannot
-- reach weekly_cap_for(), which is where the six dated facts are read off
-- the row — and two of them are derived rather than stored, which is
-- exactly where a bug would sit unseen.
-- ---------------------------------------------------------------------
\set rtwgone '9a9a9a9a-0000-4000-8000-000000000001'
\set young   '9a9a9a9a-0000-4000-8000-000000000002'
\set lettered '9a9a9a9a-0000-4000-8000-000000000003'
\set legacy  '9a9a9a9a-0000-4000-8000-000000000004'

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch,
                   right_to_work_until, wtr_optout, graduated_at, course_completion_date) values
  (:'rtwgone',  'Expired','RTW',    'x1@cap.test','+447700900301', date '1995-01-01','compliant',
   'international_student', date '2026-06-30', false, null, null),
  (:'young',    'Young','Worker',   'x2@cap.test','+447700900302', date '2008-07-08','compliant',
   'uk_irish',              null,            true,  null, null),
  (:'lettered', 'Letter','Future',  'x3@cap.test','+447700900303', date '1995-01-01','compliant',
   'international_student', null,            false, date '2026-05-01', date '2026-08-03'),
  (:'legacy',   'Legacy','Verified','x4@cap.test','+447700900304', date '1995-01-01','compliant',
   'international_student', null,            false, date '2026-05-04', null);

select is((select band::text from weekly_cap_for(:'rtwgone', date '2026-07-13')), 'visa_expired_0',
  'right_to_work_until is read: a week wholly past expiry is no rota at all');
select is(weekly_hours_remaining(:'rtwgone', date '2026-07-13'), 0::numeric,
  'so nothing is left to book, and weekly_cap_would_breach bars every shift in that week');
select is((select cap_hours from weekly_cap_for(:'rtwgone', date '2026-06-29')), 20,
  'the week the visa expires still has workable days, so the cap is a real number');
select is(can_roster(date '2026-06-30', date '2026-06-30'), true,
  'expiry is inclusive: the last day is workable');
select is(can_roster(date '2026-07-01', date '2026-06-30'), false,
  'and the day after it is not — the per-shift stop the weekly cap cannot express');

select is((select band::text from weekly_cap_for(:'young', date '2026-07-06')), 'standard_48',
  'under-18 is derived from dob, not stored: a worker who turns 18 mid-week was under 18 for part of it, so the opt-out does not lift the ceiling');
select is((select band::text from weekly_cap_for(:'young', date '2026-07-13')), 'uncapped',
  'and from the first whole week after their birthday the same recorded opt-out is valid');

select is((select cap_hours from weekly_cap_for(:'lettered', date '2026-06-01')), 20,
  'a letter verified in May with an August completion date does not release the cap in June');
select is((select cap_hours from weekly_cap_for(:'lettered', date '2026-08-10')), 48,
  'and releases it from the first whole week on or after that completion date');

-- The fallback that keeps rows predating course_completion_date behaving
-- as they did: effective-dated from verification, not from the tick.
select is((select cap_hours from weekly_cap_for(:'legacy', date '2026-04-27')), 20,
  'with no completion date on file the release still dates from graduated_at, so the week before it is unchanged');

select * from finish();
rollback;
