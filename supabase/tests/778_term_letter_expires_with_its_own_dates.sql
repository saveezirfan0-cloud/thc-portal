-- =====================================================================
-- 778 · A term letter expires on the last day printed on it, and the
--       reminder ladder counts down to that day (20261007130000, ADR-0103)
--
--   A · the rule: term_letter_last_day() and doc_expires_on(), six
--       arguments, with the calendar rule (ADR-0011) as the fallback
--   B · the ladder: one month ahead of the REAL expiry, then two weeks,
--       one week, the day — and the automatic block on the day
--   C · a letter that is in date is not chased, and a newer one silences
--       the ladder for the old one
--   D · what the office and the worker are shown agrees
--
-- `now` is 05:02 UK on 27 August 2026. Every row is created inside the
-- transaction and rolled back; assertions address rows by key, never by
-- global count, because the seed has people of its own.
-- =====================================================================
begin;
select plan(25);
\set now  '2026-08-27 05:02:00+01'
\ir _shared/fixtures.psql

\set wa 'c7780000-0000-4000-8000-00000000000a'
\set wb 'c7780000-0000-4000-8000-00000000000b'
\set wc 'c7780000-0000-4000-8000-00000000000c'
\set wd 'c7780000-0000-4000-8000-00000000000d'
\set we 'c7780000-0000-4000-8000-00000000000e'
\set wf 'c7780000-0000-4000-8000-00000000000f'
\set wg 'c7780000-0000-4000-8000-000000000010'

\set da 'c7781000-0000-4000-8000-00000000000a'
\set db 'c7781000-0000-4000-8000-00000000000b'
\set dc 'c7781000-0000-4000-8000-00000000000c'
\set dd 'c7781000-0000-4000-8000-00000000000d'
\set de 'c7781000-0000-4000-8000-00000000000e'
\set df 'c7781000-0000-4000-8000-00000000000f'
\set dg_old 'c7781000-0000-4000-8000-000000000010'
\set dg_new 'c7781000-0000-4000-8000-000000000011'

-- =====================================================================
-- A · The rule
-- =====================================================================
select is(
  term_letter_last_day(array[daterange('2026-12-19','2027-01-11'), daterange('2027-06-19','2027-09-27')]),
  date '2027-09-26',
  'A: the last printed day is the day before the half-open upper bound of the latest range');
select is(
  term_letter_last_day(array[daterange('2027-06-19','2027-09-27'), daterange('2026-12-19','2027-01-11')]),
  date '2027-09-26',
  'A: and does not depend on the order the ranges are stored in');
select is(term_letter_last_day('{}'::daterange[]), null, 'A: no ranges → no last day');
select is(term_letter_last_day(null), null, 'A: absent ranges → no last day');
select is(
  term_letter_last_day(array['empty'::daterange, daterange('2026-12-19', null), daterange('2026-12-19','2027-01-11')]),
  date '2027-01-10',
  'A: an empty or open-ended range is not a printed date and is ignored');

select is(
  doc_expires_on('university_term_dates_letter', null, null, null, timestamptz '2026-02-01',
                 array[daterange('2026-06-19','2026-09-27')]),
  date '2026-09-26',
  'A: doc_expires_on() gives a term letter the last day printed on it');
select is(
  doc_expires_on('university_term_dates_letter', date '2026-12-31', null, null, timestamptz '2026-02-01',
                 array[daterange('2026-06-19','2026-09-27')]),
  date '2026-09-26',
  'A: whatever the row''s own expiry_date says (it holds the upload''s calendar stamp, not a finding)');
select is(
  doc_expires_on('university_term_dates_letter', null, null, null, timestamptz '2026-02-01', '{}'::daterange[]),
  date '2026-12-31',
  'A: no readable dates → the calendar rule of ADR-0011, so there is always an expiry');
select is(
  doc_expires_on('university_term_dates_letter', null, null, null, timestamptz '2026-11-15', null),
  date '2027-12-31',
  'A: and its November/December exception still holds for that fallback');
select is(
  doc_expires_on('university_term_dates_letter', null, null, null, timestamptz '2026-02-01'),
  date '2026-12-31',
  'A: the five-argument form (no dates known — the AI pre-fill) is the fallback');
select is(
  doc_expires_on('passport', date '2031-03-04', null, null, timestamptz '2026-02-01',
                 array[daterange('2026-06-19','2026-09-27')]),
  date '2031-03-04',
  'A: term dates mean nothing on any other document');

-- =====================================================================
-- Fixtures: seven students, each with one verified term letter
-- =====================================================================
insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch, term_dates) values
  (:'wa','Term','A','a@778.test','+447700977801', date '2001-01-01','compliant','international_student','{}'),
  (:'wb','Term','B','b@778.test','+447700977802', date '2001-01-01','compliant','international_student','{}'),
  (:'wc','Term','C','c@778.test','+447700977803', date '2001-01-01','compliant','international_student','{}'),
  (:'wd','Term','D','d@778.test','+447700977804', date '2001-01-01','compliant','international_student','{}'),
  (:'we','Term','E','e@778.test','+447700977805', date '2001-01-01','compliant','international_student','{}'),
  (:'wf','Term','F','f@778.test','+447700977806', date '2001-01-01','compliant','international_student','{}'),
  (:'wg','Term','G','g@778.test','+447700977807', date '2001-01-01','compliant','international_student','{}');

insert into compliance_docs (id, staff_id, doc_type, review_status, expiry_date, term_dates, uploaded_at) values
  -- Last printed day 26 Sep: 30 days out — a month ahead.
  (:'da', :'wa', 'university_term_dates_letter', 'verified', null, array[daterange('2026-06-19','2026-09-27')], '2026-02-01'),
  -- 10 Sep: 14 days out.
  (:'db', :'wb', 'university_term_dates_letter', 'verified', null, array[daterange('2026-06-19','2026-09-11')], '2026-02-01'),
  -- 3 Sep: 7 days out.
  (:'dc', :'wc', 'university_term_dates_letter', 'verified', null, array[daterange('2026-06-19','2026-09-04')], '2026-02-01'),
  -- 27 Aug: today.
  (:'dd', :'wd', 'university_term_dates_letter', 'verified', null, array[daterange('2026-06-19','2026-08-28')], '2026-02-01'),
  -- Runs to 26 Sep 2027: in date for a year, whatever the calendar says.
  (:'de', :'we', 'university_term_dates_letter', 'verified', null,
   array[daterange('2026-12-19','2027-01-11'), daterange('2027-06-19','2027-09-27')], '2026-02-01'),
  -- Nothing could be read: the calendar fallback, 31 Dec 2026 — months out.
  (:'df', :'wf', 'university_term_dates_letter', 'verified', null, '{}', '2026-02-01'),
  -- G's old letter ends in 30 days; the new one, uploaded and verified
  -- since, runs to September 2027.
  (:'dg_old', :'wg', 'university_term_dates_letter', 'verified', null, array[daterange('2026-06-19','2026-09-27')], '2026-02-01'),
  (:'dg_new', :'wg', 'university_term_dates_letter', 'verified', null, array[daterange('2026-12-19','2027-09-27')], '2026-08-20');

-- =====================================================================
-- B · The ladder
-- =====================================================================
select is(
  (select expires_on from current_verified_docs(:'wa') where doc_type = 'university_term_dates_letter'),
  date '2026-09-26',
  'B: the sweep reads the letter''s last printed day');

create temporary table t_run as select compliance_daily(:'now'::timestamptz) as counts;

select ok(exists (select 1 from notification_outbox where key = 'N1:doc:' || :'da'),
  'B: N1 goes out a month before the letter''s last printed day');
select is(
  (select payload->>'document' || ' / ' || (payload->>'date') from notification_outbox where key = 'N1:doc:' || :'da'),
  'University Term Dates Letter / 26 Sep 2026',
  'B: and says which document and the date it really ends');
select ok(exists (select 1 from notification_outbox where key = 'N2:doc:' || :'db'),
  'B: N2 two weeks before');
select ok(exists (select 1 from notification_outbox where key = 'N3:doc:' || :'dc'),
  'B: N3 a week before');
select ok(exists (select 1 from notification_outbox where key = 'N4:doc:' || :'dd'),
  'B: N4 on the day');
select is((select status::text || '/' || block_kind::text from staff where id = :'wd'),
  'blocked/auto_document',
  'B: and the automatic block lands on that day (§4.3) — expired is expired, as for a passport');
select is((select status::text from staff where id in (:'wa', :'wb', :'wc') group by status), 'compliant',
  'B: nobody is blocked before their letter runs out');

-- =====================================================================
-- C · In date is in date
-- =====================================================================
select is(
  (select count(*)::int from notification_outbox where recipient_staff_id = :'we' and key like 'N_:doc:%'), 0,
  'C: a letter that runs to September 2027 is not chased — in the old rule it would have been, from 1 December, for a letter still in date');
select is(
  (select expires_on from current_verified_docs(:'we') where doc_type = 'university_term_dates_letter'),
  date '2027-09-26', 'C: it expires on its own last day');
select is(
  (select count(*)::int from notification_outbox where recipient_staff_id = :'wf' and key like 'N_:doc:%'), 0,
  'C: a letter with no readable dates falls back to 31 December, which is months out in August');
select is(
  (select count(*)::int from notification_outbox where recipient_staff_id = :'wg' and key like 'N_:doc:%'), 0,
  'C: uploading the next letter ahead of the old one running out silences the ladder — the newest verified letter is the one that counts');

-- =====================================================================
-- D · What people see
-- =====================================================================
select is(
  (select expires_on from staff_documents_v where id = :'da'), date '2026-09-26',
  'D: the Documents tab on the profile shows the same date the ladder counts down to');
select is(
  (select expires_on from staff_documents_v where id = :'df'), date '2026-12-31',
  'D: and the fallback date where no dates were read');

select * from finish();
rollback;
