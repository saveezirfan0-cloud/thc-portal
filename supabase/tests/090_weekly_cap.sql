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
-- Sections 6-10 add the half the University Completion Letter requirement
-- brought (docs/scope/university-completion-letter-requirement.pdf,
-- migration 20260922090100): the per-shift right-to-work hard stop that
-- the weekly cap cannot express, "under 18" asked of a week rather than of
-- today, and the three new dated facts read off a real worker's row.
--
-- Every row is created inside the transaction and rolled back, so this
-- coexists with supabase/seed.sql; assertions address fixture rows by
-- their fixed UUIDs, never by global counts.
-- =====================================================================
begin;
select plan(50);

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

-- The four-argument signature 0008 shipped is still there and still
-- answers what it answered, which is what lets every existing caller --
-- cap_band_until() among them -- stay as it is. The vectors that carry no
-- week_start are exactly the ones with no dated fact to offer, so they are
-- precisely the set that signature is allowed to be asked about.
select results_eq(
  $$ select v.name, c.cap_hours, c.band::text
       from cap_vectors v
       cross join lateral weekly_cap(v.visa_limited, v.term_state,
                                     v.completion_letter_verified, v.optout_48h) c
      where v.week_start is null
      order by v.name $$,
  $$ select name, expect_cap_hours, expect_band from cap_vectors
      where week_start is null order by name $$,
  'the 0008 four-argument weekly_cap() still gives the same answers: absent dated facts change nothing'
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

-- This read "no ceiling is null, never 0" when I wrote it for PR #3, and it
-- was right then: no band returned 0, so a 0 could only have been a null
-- that lost its way. The completion-letter requirement introduced
-- visa_expired_0, which is a real cap of no hours and a different thing
-- entirely — the assertion outlived the rule it was protecting.
--
-- What still has to hold, and what it was actually guarding, is that the
-- two are never confused: null means NO CEILING and belongs to `uncapped`
-- alone, so a real zero can never be written as one, nor a no-ceiling week
-- as 0 hours.
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
-- 6. The per-shift right-to-work hard stop
--
-- The weekly cap cannot express this one, which is the whole reason it
-- exists as a second function: a week that straddles the visa expiry has
-- workable days before it and none after, so the band for that week is
-- untouched and the question has to be asked per shift (the University
-- Completion Letter requirement, §2.3 and acceptance criterion 6).
--
-- Mirrors canRoster() in packages/domain/src/cap.ts: expiry inclusive, and
-- an absent expiry is "no limit recorded", never a block.
-- ---------------------------------------------------------------------
select ok(can_roster(date '2026-09-30', date '2026-09-30'),
  'the expiry date is INCLUSIVE — the day it expires is still a day the worker may work');
select ok(not can_roster(date '2026-10-01', date '2026-09-30'),
  'the day after is not, whatever the weekly cap says');
select ok(can_roster(date '2026-09-29', date '2026-09-30'),
  'and every day before it is');
select ok(can_roster(date '2030-01-01', null),
  'no expiry recorded is no limit — every UK and settled worker, who must not be blocked by a null');

-- ---------------------------------------------------------------------
-- 7. Under 18, as of the WEEK — the opt-out that was never valid
--
-- An under-18 cannot sign a 48-hour opt-out (requirement §2.4), and the
-- question is asked of the Mon-Sun week, not of today: a worker who turns
-- 18 on the Tuesday was under 18 for part of that week, so the week takes
-- the lower cap like every other straddle in RULE-20.
-- ---------------------------------------------------------------------
select ok(cap_under_18(date '2009-06-01', date '2027-05-31'),
  'the week a worker turns 18 in is still an under-18 week: the ceiling stands for all seven days');
select ok(not cap_under_18(date '2009-06-01', date '2027-06-07'),
  'the first whole week after their eighteenth birthday is not');
select ok(not cap_under_18(null, date '2027-06-07'),
  'an unknown date of birth is not evidence of being under 18 — /apply collects an age band, not a dob (§2.1)');

-- ---------------------------------------------------------------------
-- 8. The new facts, read off a real worker's row
--
-- Section 5 left capstudent graduated and opted out; put them back to a
-- plain student first, so each fact below is the only thing moving.
-- ---------------------------------------------------------------------
update staff set graduated_at = null, wtr_optout = false where id = :'capstudent';

-- Below degree level: the Student condition is 10 h, not 20 (requirement
-- §1, §3 state table).
update staff set below_degree_level = true where id = :'capstudent';
select is(weekly_cap_hours(:'capstudent', date '2026-11-04'), 10,
  'a student below degree level is capped at 10 h in term time, not 20');
select is(weekly_cap_band(:'capstudent', date '2026-11-04')::text, 'student_term_10',
  'and the band says so, so the §2.3 profile line and N14 can name it');
update staff set below_degree_level = false where id = :'capstudent';

-- The completion letter has TWO gates and both have to pass: §4.5 says
-- the release is effective-dated from verification, the requirement §2.3
-- says it runs from the course completion date on the letter. The later
-- of the two therefore wins, which is the only reading that satisfies
-- both documents — and a letter issued before the final exam carries a
-- future date and must not lift anything yet (requirement §7).
update staff set graduated_at = date '2026-06-30', course_completion_date = date '2026-07-03'
 where id = :'capstudent';
select is(weekly_cap_hours(:'capstudent', date '2026-07-01'), 20,
  'verified in June, but the letter says the course ends on 3 July: the week of 29 June straddles that date and stays at the term cap');
select is(weekly_cap_hours(:'capstudent', date '2026-07-08'), 48,
  'the first whole week after the completion date is released to 48 h');

-- Right to work outranks the letter (requirement §3, acceptance criterion 6).
update staff set right_to_work_until = date '2026-10-30' where id = :'capstudent';
select is(weekly_cap_hours(:'capstudent', date '2026-11-04'), 0,
  'a week wholly past the recorded right to work is zero hours — the completion letter does not outrank it');
select is(weekly_cap_band(:'capstudent', date '2026-11-04')::text, 'visa_expired_0',
  'and the band is the hard stop, not a 48 that happens to have nothing left in it');
update staff set right_to_work_until = null, graduated_at = null,
                 course_completion_date = null where id = :'capstudent';

-- ---------------------------------------------------------------------
-- 9. The hard stop inside the gate auto-assign calls
--
-- capbrit holds no bookings and is capped at 48 h, so the hours side of
-- weekly_cap_would_breach has nothing to say about an 8-hour shift. That
-- is what makes them the right worker to show the expiry half with: the
-- only thing that can change the answer is the right-to-work date.
--
-- cap_shift3 runs on Wednesday 04.11.2026, inside the Mon-Sun week of
-- 02.11.2026.
-- ---------------------------------------------------------------------
select is(weekly_cap_would_breach(:'capbrit', :'cap_shift3'), false,
  'a worker with 48 h free and nothing booked is not gated out of an 8-hour shift');

update staff set right_to_work_until = date '2026-11-03' where id = :'capbrit';
select is(weekly_hours_remaining(:'capbrit', date '2026-11-04'), 48::numeric,
  'a week that straddles the expiry keeps its cap: it still has workable days, so the band is untouched');
select ok(can_roster_staff(:'capbrit', date '2026-11-02'),
  'and the Monday of that week is one of them');
select is(weekly_cap_would_breach(:'capbrit', :'cap_shift3'), true,
  'but the Wednesday shift is past the day their right to work ends, and the §3.4 gate stops it — the weekly cap alone never could');
update staff set right_to_work_until = null where id = :'capbrit';

-- ---------------------------------------------------------------------
-- 10. The opt-out: valid, invalid, and cancelled
--
-- Two ways a recorded tick is not an opt-out in force (requirement §2.4,
-- acceptance criteria 4 and 5). capbrit was born 04.04.1993.
-- ---------------------------------------------------------------------
update staff set wtr_optout = true where id = :'capbrit';
select is(weekly_cap_hours(:'capbrit', date '2026-11-04'), null,
  'a signed opt-out removes the 48 h ceiling for a worker with no visa condition');
select is(weekly_cap_hours(:'capbrit', date '2011-03-30'), 48,
  'the same tick lifts nothing in a week they were 17 in: an under-18 cannot sign a 48-hour opt-out');

update staff set wtr_optout_cancelled_from = date '2026-11-04' where id = :'capbrit';
select is(weekly_cap_hours(:'capbrit', date '2026-11-04'), 48,
  'the 48 h ceiling is back for the week the notice period ends in — the lower cap, as everywhere else in RULE-20');
select is(weekly_cap_hours(:'capbrit', date '2026-10-28'), null,
  'and the week before it still has none: the ceiling returns from the end of the notice, not from the day notice was given');


select * from finish();
rollback;
