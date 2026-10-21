-- =====================================================================
-- 913 · The office confirms or corrects a term letter's holiday periods
--       as it verifies it (ADR-0178, 20261022150000)
--
--   A · Needs review / the Documents tab: Verify with edited periods sets
--       the letter's and the worker's term_dates, and the letter expires on
--       the last date of the EDITED periods (ADR-0103)
--   B · The case the office asked about: the AI missed the dates; the
--       course finished 15/08/2026 and restarts 18/01/2027, so the office
--       enters a holiday of 16/08/2026–17/01/2027 → 48 h up to the week of
--       Monday 11/01/2027, 20 h from Monday 18/01/2027 (RULE-20)
--   C · Nonsense is refused server side, in words the screen maps, and
--       leaves the letter pending and the worker's dates alone
--   D · A letter verified with no holidays at all: 20 h every week, the
--       calendar-year fallback expiry, the previous letter's dates gone
--   E · Only the office verifies
--
-- Verify runs on the real clock (now() inside the function), so every
-- range a Verify must accept is relative to current_date and still ahead
-- whenever this runs; the RULE-20 weeks in B are fixed dates, read with
-- weekly_cap_hours(staff, day), which does not depend on today. Every row
-- is rolled back; assertions address rows by key.
-- =====================================================================
begin;
select plan(34);
\ir _shared/fixtures.psql

\set w_edit   'c9130000-0000-4000-8000-00000000000a'
\set w_prabin 'c9130000-0000-4000-8000-00000000000b'
\set w_bad    'c9130000-0000-4000-8000-00000000000c'
\set w_none   'c9130000-0000-4000-8000-00000000000d'

\set d_edit   'c9131000-0000-4000-8000-00000000000a'
\set d_prabin 'c9131000-0000-4000-8000-00000000000b'
\set d_bad    'c9131000-0000-4000-8000-00000000000c'
\set d_year   'c9131000-0000-4000-8000-00000000000e'
\set d_none   'c9131000-0000-4000-8000-00000000000d'

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch, wtr_optout, term_dates) values
  -- Their previous letter's holiday, still on file.
  (:'w_edit',   'Term', 'Edit',   'edit@913.test',   '+447700991301', date '2001-01-01', 'compliant',
   'international_student', false, array[daterange(current_date - 200, current_date - 150)]),
  (:'w_prabin', 'Prabin', 'T',    'prabin@913.test', '+447700991302', date '2001-01-01', 'compliant',
   'international_student', false, '{}'),
  (:'w_bad',    'Term', 'Bad',    'bad@913.test',    '+447700991303', date '2001-01-01', 'compliant',
   'international_student', false, array[daterange(current_date - 200, current_date - 150)]),
  (:'w_none',   'Term', 'None',   'none@913.test',   '+447700991304', date '2001-01-01', 'compliant',
   'international_student', false, array[daterange(current_date + 10, current_date + 40)]);

insert into compliance_docs (id, staff_id, doc_type, uploaded_at, review_status, file_path, term_dates, ai_confidence) values
  -- The AI read one holiday and got its end wrong.
  (:'d_edit',   :'w_edit',   'university_term_dates_letter', now() - interval '1 day', 'pending',
   'documents/913/edit.pdf', array[daterange(current_date + 30, current_date + 60)], 0.91),
  -- The AI read nothing.
  (:'d_prabin', :'w_prabin', 'university_term_dates_letter', now() - interval '1 day', 'pending',
   'documents/913/prabin.pdf', '{}', 0.40),
  (:'d_bad',    :'w_bad',    'university_term_dates_letter', now() - interval '1 day', 'pending',
   'documents/913/bad.pdf', array[daterange(current_date + 30, current_date + 60)], 0.95),
  (:'d_year',   :'w_bad',    'university_term_dates_letter', now() - interval '1 day', 'pending',
   'documents/913/year.pdf', '{}', 0.95),
  (:'d_none',   :'w_none',   'university_term_dates_letter', now(), 'pending',
   'documents/913/none.pdf', '{}', 0.30);

-- The office, through its own session (assert_reviewer).
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local role authenticated;

-- =====================================================================
-- A · Verify with edited periods
-- =====================================================================
select lives_ok(
  format('select compliance_verify_document(%L, null, %L::daterange[])', :'d_edit',
         array[daterange(current_date + 30, current_date + 75), daterange(current_date + 200, current_date + 230)]),
  'A: the office verifies a pending term letter with the AI''s period corrected and one added');

reset role;
select is((select review_status::text from compliance_docs where id = :'d_edit'), 'verified',
  'A: the letter is verified');
select is((select reviewed_by from compliance_docs where id = :'d_edit'), :'admin_uid'::uuid,
  'A: by the reviewer who pressed Verify (the audit stamp)');
select is((select term_dates from compliance_docs where id = :'d_edit'),
  array[daterange(current_date + 30, current_date + 75), daterange(current_date + 200, current_date + 230)],
  'A: compliance_docs.term_dates holds the periods as the office confirmed them, not as the AI read them');
select is((select term_dates from staff where id = :'w_edit'),
  array[daterange(current_date + 30, current_date + 75), daterange(current_date + 200, current_date + 230)],
  'A: and so does staff.term_dates — the previous letter''s holiday is replaced, the cap reads these from now');
select is(
  (select expires_on from current_verified_docs(:'w_edit') where doc_type = 'university_term_dates_letter'),
  current_date + 229,
  'A: the letter expires on the last date of the edited periods (ADR-0103), not the AI''s');
select is(
  (select expires_on from staff_documents_v where id = :'d_edit'),
  current_date + 229,
  'A: and the Documents tab reads the same expiry');

-- =====================================================================
-- B · The AI missed the dates: 16/08/2026–17/01/2027 entered by hand
-- =====================================================================
set local role authenticated;
-- The letter also prints next year's summer holiday — relative to today,
-- so this Verify is not refused as expired whenever the suite runs. It
-- falls well after January 2027 and changes none of the weeks below.
select lives_ok(
  format('select compliance_verify_document(%L, null, %L::daterange[])', :'d_prabin',
         array['[2026-08-16,2027-01-18)'::daterange, daterange(current_date + 400, current_date + 430)]),
  'B: the office verifies a letter the AI could not read with the holiday typed in');
reset role;

select ok((select '[2026-08-16,2027-01-18)'::daterange = any (term_dates) from staff where id = :'w_prabin'),
  'B: staff.term_dates carries the holiday 16/08/2026–17/01/2027 (both ends included)');
select is(weekly_cap_hours(:'w_prabin', date '2026-08-10'), 20,
  'B: the week of Monday 10/08/2026 runs from term into the holiday — the lower cap, 20 h');
select is(weekly_cap_hours(:'w_prabin', date '2026-08-17'), 48,
  'B: from Monday 17/08/2026 the weeks are holiday weeks — 48 h');
select is(weekly_cap_hours(:'w_prabin', date '2026-11-16'), 48,
  'B: still 48 h in November, when the AI''s empty read would have given 20');
select is(weekly_cap_hours(:'w_prabin', date '2027-01-11'), 48,
  'B: the week of Monday 11/01/2027 (to Sunday 17/01) is wholly holiday — 48 h');
select is(weekly_cap_band(:'w_prabin', date '2027-01-11')::text, 'student_holiday_48',
  'B: in the holiday band');
select is(weekly_cap_hours(:'w_prabin', date '2027-01-18'), 20,
  'B: from Monday 18/01/2027 the course restarts — 20 h');
select is(weekly_cap_band(:'w_prabin', date '2027-01-18')::text, 'student_term_20',
  'B: in the term band');
select is(weekly_cap_hours(:'w_prabin', date '2027-01-24'), 20,
  'B: to the Sunday of that week');

-- =====================================================================
-- C · Nonsense is refused, and nothing moves
-- =====================================================================
set local role authenticated;
select throws_ok(
  format('select compliance_verify_document(%L, null, %L::daterange[])', :'d_bad', '{"[2027-01-17,2026-08-17)"}'),
  '22000', null,
  'C: a period that ends before it starts is refused (the range cannot be built)');
select throws_ok(
  format('select compliance_verify_document(%L, null, %L::daterange[])', :'d_bad', '{"[2027-02-30,2027-03-02)"}'),
  '22008', null,
  'C: a date that is not on the calendar is refused');
select throws_like(
  format('select compliance_verify_document(%L, null, %L::daterange[])', :'d_bad', '{"[2027-01-17,2027-01-17)"}'),
  '%term_dates_invalid%',
  'C: an empty period is refused as term_dates_invalid');
select throws_like(
  format('select compliance_verify_document(%L, null, %L::daterange[])', :'d_bad', '{"[2027-01-17,)"}'),
  '%term_dates_invalid%',
  'C: so is an open-ended one');
select throws_like(
  format('select compliance_verify_document(%L, null, %L::daterange[])', :'d_bad',
         array[daterange(current_date + 30, current_date + 30 + 367)]),
  '%term_dates_implausible%',
  'C: a period longer than a year — a typed year — is refused as term_dates_implausible');
select throws_ok(
  format('select compliance_verify_document(%L, null, %L::daterange[])', :'d_bad',
         array[daterange(current_date + 30, current_date + 30 + 367)]),
  '22023', null,
  'C: with the code the screen maps');
select throws_like(
  format('select compliance_verify_document(%L, null, %L::daterange[])', :'d_bad',
         array[daterange(current_date - 60, current_date - 30)]),
  '%term_letter_expired%',
  'C: periods that are all past are refused as an expired letter (unchanged)');
reset role;

select is((select review_status::text from compliance_docs where id = :'d_bad'), 'pending',
  'C: after every refusal the letter is still pending');
select is((select term_dates from compliance_docs where id = :'d_bad'),
  array[daterange(current_date + 30, current_date + 60)],
  'C: with the AI''s periods as they were');
select is((select term_dates from staff where id = :'w_bad'),
  array[daterange(current_date - 200, current_date - 150)],
  'C: and the worker''s dates untouched — the refused Verify''s staff write rolled back');

set local role authenticated;
select lives_ok(
  format('select compliance_verify_document(%L, null, %L::daterange[])', :'d_year',
         array[daterange(current_date + 30, current_date + 30 + 366)]),
  'C: a period of exactly a year (366 days, both ends) is accepted');
reset role;

-- The guard is on the row, so it holds for any path to verified.
select throws_like(
  format($$update compliance_docs set review_status = 'verified', term_dates = %L where id = %L$$,
         array[daterange(current_date + 30, current_date + 30 + 400)], :'d_bad'),
  '%term_dates_implausible%',
  'C: the row itself refuses to be verified with such a period, whoever writes it');

-- =====================================================================
-- D · No holidays on the letter
-- =====================================================================
set local role authenticated;
select lives_ok(
  format('select compliance_verify_document(%L, null, %L::daterange[])', :'d_none', '{}'),
  'D: a letter can be verified with no holiday periods (the office ticked that it shows none)');
reset role;
select is((select term_dates from staff where id = :'w_none'), '{}'::daterange[],
  'D: the previous letter''s holiday is gone from the worker');
select is(weekly_cap_hours(:'w_none', current_date + 20), 20,
  'D: so a week that was a holiday on the old letter is a 20-hour week now');
select is(
  (select expires_on from current_verified_docs(:'w_none') where doc_type = 'university_term_dates_letter'),
  doc_expires_on('university_term_dates_letter', null, null, null, now(), '{}'::daterange[]),
  'D: and the letter takes the calendar-year fallback expiry');

-- =====================================================================
-- E · Only the office
-- =====================================================================
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
set local role authenticated;
select throws_like(
  format('select compliance_verify_document(%L, null, %L::daterange[])', :'d_bad',
         array[daterange(current_date + 30, current_date + 60)]),
  '%not_authorised%',
  'E: a worker cannot verify a letter with periods of their own choosing');
reset role;

select * from finish();
rollback;
