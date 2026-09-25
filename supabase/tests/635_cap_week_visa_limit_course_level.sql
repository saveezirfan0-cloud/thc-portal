-- =====================================================================
-- 635 · RULE-20: one cap per week, a visa's own hours limit, and the
--       course level the office confirms (audit D35, D36, D32)
--   20260929150000_cap_band_visa_limit.sql
--   20260929150100_cap_week_visa_limit_and_course_level.sql
--
-- The shared vectors (090) hold the pure weekly_cap() to the TypeScript.
-- This file reads the same rules off real workers' rows, through the
-- office's two setters and record_right_to_work_change(), with the audit
-- rows they write.
-- =====================================================================
begin;
select plan(38);
\ir _shared/fixtures.psql

\set stu   '63500000-0000-4000-8000-000000000001'
\set work  '63500000-0000-4000-8000-000000000002'
\set dep   '63500000-0000-4000-8000-000000000003'
\set brit  '63500000-0000-4000-8000-000000000004'

-- No holiday ranges on file: every week is a term week for the student,
-- whatever today is, so the answers below do not depend on the date.
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status, rtw_branch,
                   right_to_work_until, wtr_optout) values
  (:'stu',  63501, 'Sita', 'Student',   'sita@635.test', '+447700963501', date '2000-01-01', 'compliant',
   'international_student', date '2035-01-01', false),
  (:'work', 63502, 'Wren', 'Worker',    'wren@635.test', '+447700963502', date '1995-01-01', 'compliant',
   'work_visa', date '2035-01-01', true),
  (:'dep',  63503, 'Dara', 'Dependant', 'dara@635.test', '+447700963503', date '1995-01-01', 'compliant',
   'dependant_other', date '2035-01-01', false),
  (:'brit', 63504, 'Bea',  'Brit',      'bea@635.test',  '+447700963504', date '1995-01-01', 'compliant',
   'uk_irish', null, false);

-- =====================================================================
-- 1 · D35 · one cap for the whole Mon-Sun week
--
-- A letter verified on Wednesday 23.09.2026 with a completion date long
-- past. Before the fix the Monday and the Friday of that week answered
-- 20 and 48.
-- =====================================================================
update staff set graduated_at = date '2026-09-23', course_completion_date = date '2025-12-19'
 where id = :'stu';
select is((weekly_cap_for(:'stu', date '2026-09-21')).cap_hours, 20,
  'D35: the Monday of the week the letter was verified is still a term week');
select is((weekly_cap_for(:'stu', date '2026-09-25')).cap_hours, 20,
  'D35: and so is the Friday — one cap for all seven days, not 20 then 48');
select is((weekly_cap_for(:'stu', date '2026-09-27')).cap_hours, 20,
  'D35: and the Sunday');
select is((weekly_cap_for(:'stu', date '2026-09-28')).cap_hours, 48,
  'D35: released from the Monday after the verification');
select is((weekly_cap_for(:'stu', date '2026-09-28')).band::text, 'graduated_48',
  'D35: as graduated_48');
select is(completion_effective_from(date '2025-12-19', date '2026-09-23'), date '2026-09-28',
  'AC3: a completion date already past — the worker is told the Monday after verification');
select is(completion_effective_from(date '2026-10-07', date '2026-09-23'), date '2026-10-12',
  'AC3: a future completion date — the first whole week after it');
select is(completion_effective_from(date '2026-06-30', date '2026-09-21'), date '2026-09-21',
  'verified on a Monday: that week is whole, so it is released at once');

update staff set graduated_at = date '2026-09-21' where id = :'stu';
select is((weekly_cap_for(:'stu', date '2026-09-25')).cap_hours, 48,
  'verified on the Monday: the whole of that week is released');
update staff set graduated_at = null, course_completion_date = null where id = :'stu';

-- =====================================================================
-- 2 · D32 · the course level, confirmed by the office
-- =====================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is((compliance_set_below_degree_level(:'stu', true)) ->> 'capHours', '10',
  'D32: the office confirms the course is below degree level — 10 h in term, straight away');
select is((compliance_set_below_degree_level(:'stu', true)) ->> 'changed', 'false',
  'setting it again changes nothing');
select throws_ok($$ select compliance_set_below_degree_level('63500000-0000-4000-8000-000000000002', true) $$,
  'P0001', 'not_student_visa', 'the course level belongs to the Student visa only');
select throws_ok($$ select compliance_set_below_degree_level('63500000-0000-4000-8000-000000000001', null) $$,
  '22023', 'value_required', 'a yes or a no, never a null');
reset role;

select is(weekly_cap_band(:'stu', current_date)::text, 'student_term_10',
  'D32: the 10 h band is no longer dormant');
select is((select count(*)::int from audit_log where action = 'rtw.conditions' and entity_id = :'stu'), 1,
  'D32: audited once — the repeat that changed nothing wrote no row');
select results_eq(
  $$ select actor::text, data ->> 'field', data ->> 'belowDegreeLevelFrom', data ->> 'belowDegreeLevelTo', data ->> 'actorName'
       from audit_log where action = 'rtw.conditions' and entity_id = '63500000-0000-4000-8000-000000000001' $$,
  $$ values ('11111111-1111-1111-1111-111111111111', 'below_degree_level', 'false', 'true', 'Gisela M.') $$,
  'D32: the audit row says who, what, from and to');

-- =====================================================================
-- 3 · D36 · a work or dependant visa's own hours limit
-- =====================================================================
select is(weekly_cap_hours(:'work', current_date), null,
  'a work-visa worker with the opt-out and no limit recorded has no ceiling');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((compliance_set_visa_hour_limit(:'work', 20)) ->> 'band', 'visa_limit',
  'D36: the office records a 20-hour limit off the visa');
select lives_ok($$ select compliance_set_visa_hour_limit('63500000-0000-4000-8000-000000000003', 16) $$,
  'D36: a dependant visa can carry one too');
select throws_ok($$ select compliance_set_visa_hour_limit('63500000-0000-4000-8000-000000000004', 20) $$,
  'P0001', 'no_visa_hour_limit_on_branch: uk_irish', 'a UK citizen has no visa to carry a limit');
select throws_ok($$ select compliance_set_visa_hour_limit('63500000-0000-4000-8000-000000000001', 20) $$,
  'P0001', 'no_visa_hour_limit_on_branch: international_student',
  'a student''s limit is the term-time rule, not this field');
select throws_ok($$ select compliance_set_visa_hour_limit('63500000-0000-4000-8000-000000000002', 49) $$,
  '22023', 'visa_hour_limit_invalid', 'above 48 is not a limit the rota can apply');
select throws_ok($$ select compliance_set_visa_hour_limit('63500000-0000-4000-8000-000000000002', 0) $$,
  '22023', 'visa_hour_limit_invalid', 'nor is 0 — no right to work is the expiry''s job');
reset role;

select is(weekly_cap_hours(:'work', current_date), 20,
  'D36: applied AHEAD of the opt-out — the worker has signed it and is still capped at 20');
select is(weekly_cap_band(:'work', current_date)::text, 'visa_limit', 'D36: as visa_limit');
select is(weekly_cap_hours(:'dep', current_date), 16, 'D36: the dependant at 16');

-- A value left on a student's row (it can only get there by hand) is not
-- read: the student's limit is the term-time rule.
update staff set visa_weekly_hour_limit = 5 where id = :'stu';
select is(weekly_cap_hours(:'stu', current_date), 10,
  'D36: the limit is read only on the work and dependant branches');
update staff set visa_weekly_hour_limit = null where id = :'stu';

select is((rota_guard_decide(true, 20, 'visa_limit', 16, 8, 'warn')).verdict, 'block',
  'D36: over a visa limit the rota guard blocks, even in warn mode');
select is((rota_guard_decide(true, 20, 'visa_limit', 16, 8, 'warn')).reason, 'visa_cap',
  'D36: and says it is a visa cap, not the Working Time 48');
select is(cap_band_label('visa_limit'), 'the hours limit on your visa',
  'N14 names the band in words, never as visa_limit');

select results_eq(
  $$ select data ->> 'field', data ->> 'visaHourLimitTo', data ->> 'branch'
       from audit_log where action = 'rtw.conditions' and entity_id = '63500000-0000-4000-8000-000000000002' $$,
  $$ values ('visa_weekly_hour_limit', '20', 'work_visa') $$,
  'D36: the limit is audited with the branch it came off');

-- Cleared: the opt-out is back in charge.
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok($$ select compliance_set_visa_hour_limit('63500000-0000-4000-8000-000000000003', null) $$,
  'null clears the limit');
reset role;
select is(weekly_cap_hours(:'dep', current_date), 48, 'cleared: back to the standard 48');

-- A new right-to-work route ends the old route's limit (requirement §7).
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok($$ select record_right_to_work_change('63500000-0000-4000-8000-000000000002', 'eu_settled', null) $$,
  'the work-visa worker moves to settled status');
reset role;
select is((select visa_weekly_hour_limit from staff where id = :'work'), null,
  'the visa''s hours limit goes with the visa');
select is(weekly_cap_hours(:'work', current_date), null,
  'and the signed opt-out lifts the ceiling again');
select is((select data ->> 'visaHourLimitFrom' from audit_log
            where action = 'rtw.changed' and entity_id = :'work'), '20',
  'the route change records the limit it ended');

-- Only the office.
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select throws_ok($$ select compliance_set_visa_hour_limit('63500000-0000-4000-8000-000000000003', 10) $$,
  '42501', 'not_authorised', 'a worker cannot set a visa limit');
reset role;

select * from finish();
rollback;
