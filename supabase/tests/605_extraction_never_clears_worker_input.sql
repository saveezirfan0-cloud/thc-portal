-- =====================================================================
-- 605 · §2.6: an empty extraction never clears what the worker entered
--       (20260928120100, ADR-0033)
--
--   A · A read that found nothing (confidence 0, every field null — what
--       the Claude extractor reports for a failed call) keeps the
--       completion date and awarding institution the worker typed, and a
--       term letter's existing ranges.
--   B · A read that did find values still pre-fills them.
--
-- Every row is created inside the transaction and rolled back.
-- =====================================================================
begin;
select plan(8);
\ir _shared/fixtures.psql

\set w_stu    'c6050000-0000-4000-8000-000000000001'
\set d_comp   'c6051000-0000-4000-8000-000000000001'
\set d_comp2  'c6051000-0000-4000-8000-000000000002'
\set d_term   'c6051000-0000-4000-8000-000000000003'

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'w_stu', 'Empty', 'Read', 'er@605.test', '+447700960501', date '2001-01-01', 'compliant', 'international_student');
insert into compliance_docs (id, staff_id, doc_type, uploaded_at, review_status, file_path,
                             completion_date, awarding_institution, term_dates) values
  (:'d_comp',  :'w_stu', 'university_completion_letter', now() - interval '1 day', 'pending',
   'documents/605/comp.pdf', current_date + 30, 'University of Westminster', null),
  (:'d_comp2', :'w_stu', 'university_completion_letter', now() - interval '1 day', 'pending',
   'documents/605/comp2.pdf', current_date + 30, 'University of Westminster', null),
  (:'d_term',  :'w_stu', 'university_term_dates_letter', now() - interval '1 day', 'pending',
   'documents/605/term.pdf', null, null, array[daterange(current_date + 60, current_date + 90)]);

-- =====================================================================
-- A · Nothing read: nothing erased
-- =====================================================================
select is(
  record_document_extraction(:'d_comp', null, null, null, null, 0, '{"provider":"anthropic","error":"timeout"}'::jsonb)->>'needsManualReview',
  'true', 'A: a failed read goes to a human');
select results_eq(
  format($$ select completion_date, awarding_institution from compliance_docs where id = %L $$, :'d_comp'),
  format($$ values (%L::date, 'University of Westminster'::text) $$, current_date + 30),
  'A: the completion date and institution the worker typed survive it');

select lives_ok(
  format($$ select record_document_extraction(%L, null, null, null, '   ', 0.2, '{}'::jsonb) $$, :'d_comp'),
  'A: a blank institution is read as none');
select is((select awarding_institution from compliance_docs where id = :'d_comp'), 'University of Westminster',
  'A: and does not clear the typed one either');

select lives_ok(
  format($$ select record_document_extraction(%L, null, null, null, null, 0, '{}'::jsonb) $$, :'d_term'),
  'A: an empty read of a term letter');
select is((select term_dates from compliance_docs where id = :'d_term'),
  array[daterange(current_date + 60, current_date + 90)],
  'A: keeps the ranges already on the row');

-- =====================================================================
-- B · A read that found values still pre-fills them
-- =====================================================================
select lives_ok(
  format($$ select record_document_extraction(%L, null, null, %L::date, 'Westminster University', 0.95, '{}'::jsonb) $$,
         :'d_comp2', current_date + 45),
  'B: a confident read of a completion letter');
select results_eq(
  format($$ select completion_date, awarding_institution, review_status::text from compliance_docs where id = %L $$, :'d_comp2'),
  format($$ values (%L::date, 'Westminster University'::text, 'pending'::text) $$, current_date + 45),
  'B: pre-fills what it read, and still never verifies');

select * from finish();
rollback;
