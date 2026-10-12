-- =====================================================================
-- 799 · an AI read that disagrees goes to a human
--       20261012121300 · §2.6, ADR-0033
--
-- A document is text the worker chose; a page that tells the model what
-- to read sets the date AND the confidence. The read is now also flagged
-- when it disagrees with what the worker typed, or with the calendar.
-- =====================================================================
begin;
select plan(12);
\ir _shared/fixtures.psql

\set cl   '79900000-0000-4000-8000-000000000001'
\set tl   '79900000-0000-4000-8000-000000000002'
\set tl2  '79900000-0000-4000-8000-000000000003'
\set pp   '79900000-0000-4000-8000-000000000004'
\set pp2  '79900000-0000-4000-8000-000000000005'

select (now() at time zone 'Europe/London')::date as today \gset

insert into compliance_docs (id, staff_id, doc_type, file_path, review_status, completion_date_claimed, evidence_form) values
  (:'cl', :'staffa', 'university_completion_letter', 'a/cl.pdf', 'pending', date '2026-06-30', 'letter');
insert into compliance_docs (id, staff_id, doc_type, file_path, review_status, term_dates) values
  (:'tl', :'staffa', 'university_term_dates_letter', 'a/tl.pdf', 'pending',
   array[daterange(:'today'::date + 30, :'today'::date + 60)]),
  (:'tl2', :'staffb', 'university_term_dates_letter', 'b/tl.pdf', 'pending', null);
insert into compliance_docs (id, staff_id, doc_type, file_path, review_status) values
  (:'pp', :'staffa', 'passport', 'a/pp2.pdf', 'pending'),
  (:'pp2', :'staffb', 'passport', 'b/pp2.pdf', 'pending');

-- Completion letter: the read agrees, then it does not.
select is(record_document_extraction(:'cl', null, null, date '2026-06-30', 'Uni', 0.99, '{}'::jsonb) ->> 'needsManualReview',
  'false', 'a confident read that matches the worker''s date is not flagged');
select is(record_document_extraction(:'cl', null, null, date '2025-01-01', 'Uni', 0.99, '{}'::jsonb) ->> 'needsManualReview',
  'true', 'a confident read with ANOTHER completion date is flagged');
select is((select manual_review_reason from compliance_docs where id = :'cl'),
  'completion date differs from the worker''s', 'with the reason on the row');
select is((select completion_date from compliance_docs where id = :'cl'), date '2025-01-01',
  'what is written is unchanged (the AI pre-fills, a manager decides)');

-- Term letter: worker's ranges vs the read.
select is(record_document_extraction(:'tl', null, array[daterange(:'today'::date + 30, :'today'::date + 60)], null, null, 0.99, '{}'::jsonb)
            ->> 'needsManualReview', 'false', 'the same ranges as the worker''s: not flagged');
select is(record_document_extraction(:'tl', null, array[daterange(:'today'::date + 30, :'today'::date + 90)], null, null, 0.99, '{}'::jsonb)
            ->> 'needsManualReview', 'true', 'different ranges: flagged');
select is((select manual_review_reason from compliance_docs where id = :'tl'), 'term dates differ from the worker''s',
  'and says why');
select is(record_document_extraction(:'tl2', null, array[daterange(:'today'::date + 30, :'today'::date + 1200)], null, null, 0.99, '{}'::jsonb)
            ->> 'reason', 'term dates out of range', 'a letter running more than two years out is flagged');
select is(record_document_extraction(:'tl2', null, array[daterange(null, :'today'::date + 60)], null, null, 0.99, '{}'::jsonb)
            ->> 'needsManualReview', 'true', 'an unbounded range is flagged');

-- Any document: an expiry no UK document has.
select is(record_document_extraction(:'pp', :'today'::date + 3650, null, null, null, 0.99, '{}'::jsonb) ->> 'needsManualReview',
  'false', 'a passport expiring in ten years is an ordinary read');
select is(record_document_extraction(:'pp2', date '2099-01-01', null, null, null, 1.0, '{}'::jsonb) ->> 'reason',
  'expiry out of range', '"2099-01-01, confidence 1.0" is flagged');

select ok(not has_function_privilege('authenticated', 'public.record_document_extraction(uuid, date, daterange[], date, text, numeric, jsonb)', 'execute'),
  'still service role only');

select * from finish();
rollback;
