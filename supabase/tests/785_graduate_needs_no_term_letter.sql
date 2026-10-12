-- =====================================================================
-- 785 · A graduate needs no University Term Dates Letter
--       (20261012110000, ADR-0112)
--
--   A · the term letter is still owed when nothing stands in for it
--   B · a pending completion letter stands in at submit, but holds the quiz
--   C · a rejected completion letter stands in for nothing
--   D · compliance_blockers(): a term letter that no longer applies is no
--       blocker; one that still applies is
--   E · the live case: rejected term letter + approved completion letter →
--       the term letter is superseded and the candidate moves to Quiz
--   F · a future-dated completion letter leaves the term letter in force
--   G · a verified term letter is never superseded
--
-- Every row is created inside the transaction and rolled back; assertions
-- address rows by key, never by global count.
-- =====================================================================
begin;
select plan(16);
\ir _shared/fixtures.psql

\set sa 'c7850000-0000-4000-8000-00000000000a'
\set sb 'c7850000-0000-4000-8000-00000000000b'
\set sc 'c7850000-0000-4000-8000-00000000000c'
\set sd 'c7850000-0000-4000-8000-00000000000d'
\set se 'c7850000-0000-4000-8000-00000000000e'
\set sg 'c7850000-0000-4000-8000-00000000000f'
\set sf 'c7850000-0000-4000-8000-000000000010'
\set sh 'c7850000-0000-4000-8000-000000000011'
\set si 'c7850000-0000-4000-8000-000000000012'
\set sj 'c7850000-0000-4000-8000-000000000013'

\set cg 'c7851000-0000-4000-8000-00000000000f'
\set cf 'c7851000-0000-4000-8000-000000000010'
\set ch 'c7851000-0000-4000-8000-000000000011'
\set tg 'c7852000-0000-4000-8000-00000000000f'
\set tf 'c7852000-0000-4000-8000-000000000010'
\set th 'c7852000-0000-4000-8000-000000000011'

-- Student candidates in Documents, each with a share code, a date of
-- birth and a "No" declaration (verified on insert, §2.10) so that the
-- only thing in question is the term letter.
insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch, share_code,
                   right_to_work_until, graduated_at, course_completion_date) values
  (:'sa','Grad','A','a@785.test','+447700978501', date '2001-01-01','documents','international_student','WABCD0001', current_date + 400, null, null),
  (:'sb','Grad','B','b@785.test','+447700978502', date '2001-01-01','documents','international_student','WABCD0002', current_date + 400, null, null),
  (:'sc','Grad','C','c@785.test','+447700978503', date '2001-01-01','documents','international_student','WABCD0003', current_date + 400, null, null),
  (:'sd','Grad','D','d@785.test','+447700978504', date '2001-01-01','documents','international_student','WABCD0004', current_date + 400,
        current_date - 60, current_date - 70),
  (:'se','Grad','E','e@785.test','+447700978505', date '2001-01-01','documents','international_student','WABCD0005', current_date + 400, null, null),
  (:'sg','Meghana','Live','g@785.test','+447700978506', date '2001-01-01','documents','international_student','WABCD0006', current_date + 400, null, null),
  (:'sf','Grad','F','f@785.test','+447700978507', date '2001-01-01','documents','international_student','WABCD0007', current_date + 400, null, null),
  (:'sh','Grad','H','h@785.test','+447700978508', date '2001-01-01','documents','international_student','WABCD0008', current_date + 400, null, null);

insert into criminal_declarations (staff_id, source, answer)
select id, 'onboarding', false from staff where id in (:'sa', :'sb', :'sc', :'sd', :'se', :'sg', :'sf', :'sh');

insert into compliance_docs (staff_id, doc_type, file_path, review_status)
select id, 'passport', id || '/passport/p.pdf', 'verified'
  from staff where id in (:'sa', :'sb', :'sc', :'sd', :'se', :'sg', :'sf', :'sh');

-- =====================================================================
-- A · nothing stands in for the term letter
-- =====================================================================
select ok('university_term_dates_letter' = any (onboarding_documents_missing(:'sa')),
  'A: a student with neither letter still owes the term letter');

-- =====================================================================
-- B · a pending completion letter stands in at submit, but holds the quiz
-- =====================================================================
insert into compliance_docs (staff_id, doc_type, file_path, review_status)
values (:'sb', 'university_completion_letter', :'sb' || '/completion-letter/c.pdf', 'pending');

select ok(not ('university_term_dates_letter' = any (onboarding_documents_missing(:'sb'))),
  'B: a pending completion letter answers the term-letter requirement, so Submit is open');
select ok('document_unverified:university_completion_letter' = any (onboarding_quiz_blockers(:'sb')),
  'B: but with no term letter the quiz stays shut until that letter is approved');

-- =====================================================================
-- C · a rejected completion letter stands in for nothing
-- =====================================================================
insert into compliance_docs (staff_id, doc_type, file_path, review_status, rejection_reason)
values (:'sc', 'university_completion_letter', :'sc' || '/completion-letter/c.pdf', 'rejected', 'Unreadable');

select ok('university_term_dates_letter' = any (onboarding_documents_missing(:'sc')),
  'C: a rejected completion letter answers nothing — the term letter is owed again');

-- =====================================================================
-- D · compliance_blockers(): applies or not
-- =====================================================================
insert into compliance_docs (staff_id, doc_type, file_path, review_status, rejection_reason)
values (:'sd', 'university_term_dates_letter', :'sd' || '/term/t.pdf', 'rejected', 'Out of date'),
       (:'se', 'university_term_dates_letter', :'se' || '/term/t.pdf', 'rejected', 'Out of date');

select ok(not exists (select 1 from compliance_blockers(:'sd') b
                       where b.reason = 'document_unverified:university_term_dates_letter'),
  'D: a rejected term letter is no blocker once the worker has graduated (term_letter_applies() is false)');
select ok(exists (select 1 from compliance_blockers(:'se') b
                   where b.reason = 'document_unverified:university_term_dates_letter'),
  'D: control — the same rejected letter still blocks a student who has not graduated');

-- =====================================================================
-- E · the live case: rejected term letter, completion letter approved
-- =====================================================================
insert into compliance_docs (id, staff_id, doc_type, file_path, review_status, rejection_reason)
values (:'tg', :'sg', 'university_term_dates_letter', :'sg' || '/term/t.pdf', 'rejected', 'Out of date');
insert into compliance_docs (id, staff_id, doc_type, file_path, review_status, completion_date_claimed)
values (:'cg', :'sg', 'university_completion_letter', :'sg' || '/completion-letter/c.pdf', 'pending',
        current_date - 20);

select ok(not ('university_term_dates_letter' = any (onboarding_documents_missing(:'sg')))
          and cardinality(onboarding_quiz_blockers(:'sg')) > 0,
  'E: before approval she is stuck — the rejected term letter holds the gate');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
select is(approve_completion_letter(:'cg', current_date - 20, current_date + 400) ->> 'approved', 'true',
  'E: the office approves her completion letter');
select is((select review_status::text from compliance_docs where id = :'tg'), 'superseded',
  'E: approving it supersedes her rejected term letter — history kept, nothing deleted');
select is(cardinality(onboarding_quiz_blockers(:'sg')), 0,
  'E: nothing is outstanding any more');

select set_config('request.jwt.claims', '', true);
select onboarding_advance_if_ready(:'sg');
select is((select status::text from staff where id = :'sg'), 'quiz',
  'E: she is in Quiz (by the verify trigger, or by the gate when it is run again)');
select is((select count(*)::int from notification_outbox
            where recipient_staff_id = :'sg' and template = 'E12'), 1,
  'E: and E12 "your documents are approved" is queued once, in the transaction that moves her');

-- =====================================================================
-- F · a future-dated completion letter leaves the term letter in force
-- =====================================================================
insert into compliance_docs (id, staff_id, doc_type, file_path, review_status, rejection_reason)
values (:'tf', :'sf', 'university_term_dates_letter', :'sf' || '/term/t.pdf', 'rejected', 'Out of date');
insert into compliance_docs (id, staff_id, doc_type, file_path, review_status, completion_date_claimed)
values (:'cf', :'sf', 'university_completion_letter', :'sf' || '/completion-letter/c.pdf', 'pending',
        current_date + 30);
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
select approve_completion_letter(:'cf', current_date + 30, current_date + 400);
select set_config('request.jwt.claims', '', true);

select is((select review_status::text from compliance_docs where id = :'tf'), 'rejected',
  'F: the course has not finished, so the term letter still applies and is left as it was');

-- =====================================================================
-- G · a verified term letter is never superseded
-- =====================================================================
insert into compliance_docs (id, staff_id, doc_type, file_path, review_status)
values (:'th', :'sh', 'university_term_dates_letter', :'sh' || '/term/t.pdf', 'pending');
update compliance_docs set review_status = 'verified', reviewed_at = now(),
       expiry_date = current_date + 200
 where id = :'th';
insert into compliance_docs (id, staff_id, doc_type, file_path, review_status, completion_date_claimed)
values (:'ch', :'sh', 'university_completion_letter', :'sh' || '/completion-letter/c.pdf', 'pending',
        current_date - 20);
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
select approve_completion_letter(:'ch', current_date - 20, current_date + 400);
select set_config('request.jwt.claims', '', true);

select is((select review_status::text from compliance_docs where id = :'th'), 'verified',
  'G: a term letter the office had verified stays as the evidence it was');

-- =====================================================================
-- H · verified but future-dated, and no term letter: still no term evidence
-- =====================================================================
insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch, share_code,
                   right_to_work_until) values
  (:'si','Grad','I','i@785.test','+447700978509', date '2001-01-01','documents','international_student','WABCD0009', current_date + 400);
insert into criminal_declarations (staff_id, source, answer) values (:'si', 'onboarding', false);
insert into compliance_docs (staff_id, doc_type, file_path, review_status)
values (:'si', 'passport', :'si' || '/passport/p.pdf', 'verified');
insert into compliance_docs (id, staff_id, doc_type, file_path, review_status, completion_date_claimed)
values ('c7851000-0000-4000-8000-000000000012', :'si', 'university_completion_letter',
        :'si' || '/completion-letter/c.pdf', 'pending', current_date + 30);
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
select approve_completion_letter('c7851000-0000-4000-8000-000000000012', current_date + 30, current_date + 400);
select set_config('request.jwt.claims', '', true);

select ok('document_unverified:university_completion_letter' = any (onboarding_quiz_blockers(:'si')),
  'H: a verified completion letter dated in the future is not term evidence — the quiz stays shut until the course has completed');

-- =====================================================================
-- I · a worker no longer on the Student branch is not blocked by a term letter
-- =====================================================================
insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch)
values (:'sj','Grad','J','j@785.test','+447700978510', date '1995-01-01','compliant','work_visa');
insert into compliance_docs (staff_id, doc_type, file_path, review_status, rejection_reason)
values (:'sj', 'university_term_dates_letter', :'sj' || '/term/t.pdf', 'rejected', 'Out of date');

select ok(not exists (select 1 from compliance_blockers(:'sj') b
                       where b.reason = 'document_unverified:university_term_dates_letter'),
  'I: a leftover term letter no longer blocks someone who has moved off the Student branch (§7, term_letter_applies())');

select * from finish();
rollback;
