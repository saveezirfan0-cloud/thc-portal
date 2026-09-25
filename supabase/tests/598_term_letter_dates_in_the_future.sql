-- =====================================================================
-- 598 · §4.2: an already-expired University Term Dates Letter is not
--       accepted (20260928110300)
--
--   A · term_letter_expired() agrees with termLetterDatesVerdict()
--       (packages/domain/src/termLetter.vectors.json), case for case.
--       The vectors carry inclusive printed dates; the SQL side gets
--       the half-open daterange the Staff App's extractor stores.
--   B · record_document_extraction() flags an expired letter for a human
--       with the reason on the row, however confident the read.
--   C · compliance_verify_document() refuses to verify one — on the
--       reviewer's ranges, or the row's when the reviewer passes none —
--       and still verifies a current one.
--
-- Every row is created inside the transaction and rolled back.
-- =====================================================================
begin;
select plan(27);
\ir _shared/fixtures.psql

\set w_stu   'c5980000-0000-4000-8000-000000000001'
\set d_old   'c5981000-0000-4000-8000-000000000001'
\set d_cur   'c5981000-0000-4000-8000-000000000002'
\set d_mix   'c5981000-0000-4000-8000-000000000003'
\set d_none  'c5981000-0000-4000-8000-000000000004'

-- =====================================================================
-- A · The rule, against the shared vectors (today = 2026-09-25 there)
-- =====================================================================
select is(term_letter_expired(array[daterange('2025-12-13','2026-01-06'), daterange('2026-03-21','2026-04-20'),
                                    daterange('2026-06-13','2026-09-21')], date '2026-09-25'), true,
  'vector: every range before today → expired');
select is(term_letter_expired(array[daterange('2026-06-13','2026-09-25')], date '2026-09-25'), true,
  'vector: last day was yesterday → expired');
select is(term_letter_expired(array[daterange('2026-06-13','2026-09-26')], date '2026-09-25'), false,
  'vector: last day is today → still current');
select is(term_letter_expired(array[daterange('2026-06-13','2026-09-21'), daterange('2026-12-12','2027-01-11')],
                              date '2026-09-25'), false,
  'vector: one past range and one to come → current, the rule is about all of them');
select is(term_letter_expired(array[daterange('2026-12-12','2027-01-11'), daterange('2027-03-27','2027-04-26')],
                              date '2026-09-25'), false,
  'vector: next year''s letter, every range ahead → current');
select is(term_letter_expired(array[daterange('2026-12-12','2027-01-11')], date '2026-12-20'), false,
  'vector: a range that starts before today and ends after it → current');
select is(term_letter_expired('{}'::daterange[], date '2026-09-25'), false,
  'vector: no ranges found → not expired (the human reviews)');
select is(term_letter_expired(null, date '2026-09-25'), false,
  'vector: ranges absent → not expired');
select is(term_letter_expired(array['empty'::daterange], date '2026-09-25'), false,
  'an empty range says nothing either way');
select is(term_letter_expired(array[daterange('2026-06-13', null)], date '2026-09-25'), false,
  'an open-ended range never expires');

-- =====================================================================
-- Fixtures: a student with four pending term letters
-- =====================================================================
insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'w_stu', 'Term', 'Letter', 'tl@598.test', '+447700959801', date '2001-01-01', 'compliant', 'international_student');
insert into compliance_docs (id, staff_id, doc_type, uploaded_at, review_status, file_path) values
  (:'d_old',  :'w_stu', 'university_term_dates_letter', now() - interval '2 days', 'pending', 'documents/598/old.pdf'),
  (:'d_cur',  :'w_stu', 'university_term_dates_letter', now() - interval '2 days', 'pending', 'documents/598/cur.pdf'),
  (:'d_mix',  :'w_stu', 'university_term_dates_letter', now() - interval '2 days', 'pending', 'documents/598/mix.pdf'),
  (:'d_none', :'w_stu', 'university_term_dates_letter', now() - interval '2 days', 'pending', 'documents/598/none.pdf');
-- The 31 December the upload path stamps on every term letter (§4.2, ADR-0011).
update compliance_docs
   set expiry_date = doc_expires_on('university_term_dates_letter', null, null, null, uploaded_at)
 where staff_id = :'w_stu';

-- =====================================================================
-- B · The extraction seam flags it
-- =====================================================================
-- Last year's letter, read with total confidence.
select is(
  record_document_extraction(:'d_old', null,
    array[daterange(current_date - 400, current_date - 300), daterange(current_date - 200, current_date - 100)],
    null, null, 0.99, '{"provider":"test"}'::jsonb)->>'reason',
  'letter expired',
  'B: a confident read of a letter whose dates are all past is reported as expired');
select results_eq(
  format($$ select needs_manual_review, manual_review_reason, review_status::text
              from compliance_docs where id = %L $$, :'d_old'),
  $$ values (true, 'letter expired', 'pending') $$,
  'B: flagged for a human with the reason on the row — and still pending, the AI never rejects either');
select is(
  (select expiry_date from compliance_docs where id = :'d_old'),
  doc_expires_on('university_term_dates_letter', null, null, null, now() - interval '2 days'),
  'B: the 31 December expiry is untouched — this is about the printed dates, not the ladder (ADR-0011)');

-- A current letter at the same confidence: no flag, no reason.
select is(
  record_document_extraction(:'d_cur', null,
    array[daterange(current_date + 60, current_date + 90)],
    null, null, 0.99, '{"provider":"test"}'::jsonb)->>'needsManualReview',
  'false', 'B: a current letter read confidently needs no manual review');
select is((select manual_review_reason from compliance_docs where id = :'d_cur'), null,
  'B: and carries no reason');

-- One holiday gone, one to come: current.
select is(
  record_document_extraction(:'d_mix', null,
    array[daterange(current_date - 60, current_date - 30), daterange(current_date + 60, current_date + 90)],
    null, null, 0.99, '{"provider":"test"}'::jsonb)->>'needsManualReview',
  'false', 'B: a letter with a past holiday and a future one is current');

-- Nothing read: manual on confidence, not "expired".
select is(
  record_document_extraction(:'d_none', null, null, null, null, 0.30, '{"provider":"test"}'::jsonb)->>'reason',
  null, 'B: a letter the extractor could not read is manual on confidence, with no expiry reason (ADR-0014)');
select is((select needs_manual_review from compliance_docs where id = :'d_none'), true,
  'B: below the threshold → needs manual review, as before');

-- =====================================================================
-- C · Verify refuses it
-- =====================================================================
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select throws_like(
  format('select compliance_verify_document(%L)', :'d_old'), '%term_letter_expired%',
  'C: Verify refuses a term letter whose ranges on the row are all past');
select throws_ok(
  format('select compliance_verify_document(%L)', :'d_old'), 'P0001',
  null, 'C: as a P0001 the screen maps');
select is((select review_status::text from compliance_docs where id = :'d_old'), 'pending',
  'C: the row is untouched — the reviewer rejects it, the worker re-uploads (§4.1 N8)');
select is((select term_dates from staff where id = :'w_stu'), '{}'::daterange[],
  'C: and nothing reached the worker''s cap inputs');

-- The reviewer's own ranges are what is judged: typing this year's dates
-- over an unread row verifies; typing last year's over a current row does not.
select throws_like(
  format('select compliance_verify_document(%L, null, %L::daterange[])', :'d_cur',
         array[daterange(current_date - 40, current_date - 10)]),
  '%term_letter_expired%',
  'C: the reviewer''s ranges are judged when given, even over a row the extractor read as current');
select lives_ok(
  format('select compliance_verify_document(%L, null, %L::daterange[])', :'d_none',
         array[daterange(current_date + 60, current_date + 90)]),
  'C: a current set of ranges typed by the reviewer verifies an unread letter');
select is((select term_dates from staff where id = :'w_stu'), array[daterange(current_date + 60, current_date + 90)],
  'C: and lands on the worker as their holiday ranges (RULE-20)');
select lives_ok(
  format('select compliance_verify_document(%L)', :'d_mix'),
  'C: a letter with a holiday still to come verifies on the row''s own ranges');
select is((select review_status::text from compliance_docs where id = :'d_mix'), 'verified',
  'C: verified');

select * from finish();
rollback;
