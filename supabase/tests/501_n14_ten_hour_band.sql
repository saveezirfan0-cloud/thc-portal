-- =====================================================================
-- 501 · N14 "until [date]" for the 10-hour band (§4.4, §8)
--   20260924130200_n14_until_for_the_10_hour_band.sql
--
-- A Student visa holder below degree level is capped at 10 h in term
-- (RULE-20). Their band moves on the same term/holiday calendar as a
-- degree-level student's, so N14 must name the Sunday it holds until —
-- the "dated" half of §8's copy, not the dateless one.
-- =====================================================================
begin;
select plan(4);
\ir _shared/fixtures.psql

\set ten 'c5010000-0000-4000-8000-000000000001'
\set twe 'c5010000-0000-4000-8000-000000000002'

-- Summer holiday through Sunday 27 September; term restarts Monday the
-- 28th; the Christmas range opens on Saturday 12 December (the same
-- calendar 200_compliance_daily uses).
insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch,
                   term_dates, below_degree_level) values
  (:'ten', 'Ten', 'Hour', 'ten@n14.test', '+447700950101', date '2003-01-01', 'compliant',
   'international_student', '{"[2026-06-15,2026-09-28)","[2026-12-12,2027-01-11)"}', true),
  (:'twe', 'Twenty', 'Hour', 'twe@n14.test', '+447700950102', date '2003-01-01', 'compliant',
   'international_student', '{"[2026-06-15,2026-09-28)","[2026-12-12,2027-01-11)"}', false);

-- First assessment: recorded, not announced.
select compliance_daily('2026-09-21 05:02:00+01'::timestamptz) is not null as first \gset
select is((select band::text from cap_band_notices where staff_id = :'ten'), 'student_holiday_48',
  'in the summer holiday the below-degree student is on the 48 h band');

-- Monday 28 September: term.
select compliance_daily('2026-09-28 05:02:00+01'::timestamptz) is not null as second \gset
select is((select band::text from cap_band_notices where staff_id = :'ten'), 'student_term_10',
  'term restarting puts them on the 10 h band');
select is(
  (select payload from notification_outbox where template = 'N14' and recipient_staff_id = :'ten'),
  '{"band": "term time", "date": "13 Dec 2026", "limit": "10", "variant": "dated"}'::jsonb,
  'N14 for the 10 h band carries "until [date]": the dated half, with the Sunday the band holds until');
select is(
  (select payload from notification_outbox where template = 'N14' and recipient_staff_id = :'twe'),
  '{"band": "term time", "date": "13 Dec 2026", "limit": "20", "variant": "dated"}'::jsonb,
  'and it names the same Sunday as a degree-level student on the same calendar');

select * from finish();
rollback;
