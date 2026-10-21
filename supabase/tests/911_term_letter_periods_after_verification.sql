-- =====================================================================
-- 911 · a verified term letter's holiday periods can be corrected by
--       hand (ADR-0178, 20261022145000)
--
--   A · set_term_letter_periods() replaces the ranges on the letter and
--       on the worker, and writes the audit row.
--   B · it refuses what Verify refuses: an unbounded range, a set that
--       leaves the letter expired; and a letter that is not a verified
--       term letter.
--   C · nobody but the office calls it.
--
-- Every row is created inside the transaction and rolled back.
-- =====================================================================
begin;
select plan(13);
\ir _shared/fixtures.psql

\set w_stu   'c9110000-0000-4000-8000-000000000001'
\set d_term  'c9111000-0000-4000-8000-000000000001'
\set d_pend  'c9111000-0000-4000-8000-000000000002'
\set d_pass  'c9111000-0000-4000-8000-000000000003'

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'w_stu', 'Term', 'Periods', 'tp@911.test', '+447700991101', date '2001-01-01', 'compliant', 'international_student');
insert into compliance_docs (id, staff_id, doc_type, uploaded_at, review_status, file_path, term_dates) values
  (:'d_term', :'w_stu', 'university_term_dates_letter', now() - interval '2 days', 'pending', 'documents/911/term.pdf',
   array[daterange(current_date + 60, current_date + 90)]),
  (:'d_pend', :'w_stu', 'university_term_dates_letter', now() - interval '1 day', 'pending', 'documents/911/pend.pdf',
   array[daterange(current_date + 60, current_date + 90)]),
  (:'d_pass', :'w_stu', 'passport', now() - interval '2 days', 'pending', 'documents/911/passport.pdf', null);

-- The office verifies the letter as the AI read it: one holiday.
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(format('select compliance_verify_document(%L)', :'d_term'), 'the letter is verified as read');

-- =====================================================================
-- A · The correction lands on the letter and the worker
-- =====================================================================
select lives_ok(
  format('select set_term_letter_periods(%L, %L::daterange[])', :'d_term',
         array[daterange(current_date + 10, current_date + 20), daterange(current_date + 60, current_date + 90)]),
  'A: the office adds the vacation the AI missed to a verified letter');
select is((select term_dates from compliance_docs where id = :'d_term'),
          array[daterange(current_date + 10, current_date + 20), daterange(current_date + 60, current_date + 90)],
  'A: the letter carries both periods');
select is((select term_dates from staff where id = :'w_stu'),
          array[daterange(current_date + 10, current_date + 20), daterange(current_date + 60, current_date + 90)],
  'A: and so does the worker — the RULE-20 cap reads them from now');
select is((select review_status::text from compliance_docs where id = :'d_term'), 'verified',
  'A: the letter stays verified');
select is((select count(*)::int from audit_log
            where action = 'term_letter.periods_changed' and entity_id = :'d_term'::uuid
              and jsonb_array_length(data -> 'before') = 1 and jsonb_array_length(data -> 'after') = 2),
  1, 'A: audited with the ranges before and after');

-- =====================================================================
-- B · Refusals
-- =====================================================================
select throws_like(
  format('select set_term_letter_periods(%L, %L::daterange[])', :'d_term',
         array[daterange(current_date + 10, null)]),
  '%term_dates_invalid%', 'B: an open-ended range is refused');
select throws_like(
  format('select set_term_letter_periods(%L, %L::daterange[])', :'d_term',
         array[daterange(current_date - 40, current_date - 10)]),
  '%term_periods_expire_letter%', 'B: a set of ranges that are all past would expire the letter — refused');
select throws_like(
  format('select set_term_letter_periods(%L, %L::daterange[])', :'d_pend',
         array[daterange(current_date + 10, current_date + 20)]),
  '%term_letter_not_verified%', 'B: a pending letter''s periods go through Verify, not here');
select throws_like(
  format('select set_term_letter_periods(%L, %L::daterange[])', :'d_pass',
         array[daterange(current_date + 10, current_date + 20)]),
  '%not_a_term_letter%', 'B: only a University Term Dates Letter has periods');
select is((select cardinality(term_dates) from staff where id = :'w_stu'), 2,
  'B: no refusal changed the worker''s ranges');

-- =====================================================================
-- C · Office only
-- =====================================================================
set local "request.jwt.claims" = '{"sub":"00000000-0000-4000-8000-000000000999","role":"authenticated"}';
select throws_like(
  format('select set_term_letter_periods(%L, %L::daterange[])', :'d_term',
         array[daterange(current_date + 10, current_date + 20)]),
  '%not_authorised%', 'C: a session that is not the office is refused');
reset "request.jwt.claims";
select is((select has_function_privilege('anon', 'public.set_term_letter_periods(uuid, daterange[])', 'execute')),
  false, 'C: anon cannot call it');

select * from finish();
rollback;
