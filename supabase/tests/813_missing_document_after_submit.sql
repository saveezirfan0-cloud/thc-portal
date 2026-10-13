-- =====================================================================
-- 813 · A document the office's branch correction adds after "Submit
--       documents" can be uploaded (20261013180000, §2.3, §2.5)
--
-- The worker chose Work visa on step 1 and submitted a passport. The
-- office corrects the branch to International student
-- (record_right_to_work_change), which asks for a University Term Dates
-- Letter the worker was never asked for. The paused documents hub shows
-- it "Missing" with Re-upload; onboarding_attach_document() must take
-- it, where it used to refuse anything but a rejected document.
--
-- Still refused after Submit: a second file on a document in review, a
-- new file on one in review, a document outside the branch's set, and a
-- term letter a completion letter in review already answers (ADR-0112).
-- =====================================================================
begin;
select plan(10);

\set jon       '81300000-0000-4000-8000-000000000001'
\set jon_uid   '81300000-0000-4000-8000-0000000000a1'
\set admin_uid '81300000-0000-4000-8000-0000000000a2'
\set mia       '81300000-0000-4000-8000-000000000002'
\set mia_uid   '81300000-0000-4000-8000-0000000000a3'

insert into auth.users (id, email) values
  (:'jon_uid',   'jon@r813.test'),
  (:'admin_uid', 'office@r813.test'),
  (:'mia_uid',   'mia@r813.test');
insert into profiles (id, role, full_name) values
  (:'jon_uid',   'staff', 'Jon Test'),
  (:'admin_uid', 'admin', 'Olive Office'),
  (:'mia_uid',   'staff', 'Mia Test');
insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'jon', :'jon_uid', 'Jon', 'Test', 'jon@r813.test', '+447700900813',
   date '2001-05-14', 'documents', 'work_visa'),
  (:'mia', :'mia_uid', 'Mia', 'Test', 'mia@r813.test', '+447700900814',
   date '2000-02-03', 'documents', 'international_student');
insert into onboarding_progress (staff_id, rtw_at) values (:'jon', now())
  on conflict (staff_id) do update set rtw_at = excluded.rtw_at;

insert into storage.objects (bucket_id, name, metadata) values
  ('documents', :'jon' || '/passport/1.jpg', '{"mimetype":"image/jpeg","size":900000}'),
  ('documents', :'jon' || '/passport/2.jpg', '{"mimetype":"image/jpeg","size":900000}'),
  ('documents', :'jon' || '/university_term_dates_letter/1.pdf', '{"mimetype":"application/pdf","size":348160}'),
  ('documents', :'jon' || '/university_term_dates_letter/2.pdf', '{"mimetype":"application/pdf","size":348160}'),
  ('documents', :'mia' || '/university_term_dates_letter/1.pdf', '{"mimetype":"application/pdf","size":348160}');

-- The passport goes in before Submit, on the Work visa branch.
set local "request.jwt.claims" = '{"sub":"81300000-0000-4000-8000-0000000000a1","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  format($$ select onboarding_attach_document('passport', %L, 'passport.jpg', 900000, 'image/jpeg') $$,
         :'jon' || '/passport/1.jpg'),
  'the passport is uploaded on step 4');
reset role;
update onboarding_progress set documents_at = now() where staff_id = :'jon';

set local "request.jwt.claims" = '{"sub":"81300000-0000-4000-8000-0000000000a1","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  format($$ select onboarding_attach_document('university_term_dates_letter', %L, 'term.pdf', 348160, 'application/pdf') $$,
         :'jon' || '/university_term_dates_letter/1.pdf'),
  'P0001', 'doc_not_for_branch', 'on the Work visa branch a term letter is not asked for');
reset role;

-- The office corrects the branch.
set local "request.jwt.claims" = '{"sub":"81300000-0000-4000-8000-0000000000a2","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  format($$ select record_right_to_work_change(%L, 'international_student', date '2027-09-30') $$, :'jon'),
  'the office corrects the branch to International student');
reset role;

set local "request.jwt.claims" = '{"sub":"81300000-0000-4000-8000-0000000000a1","role":"authenticated"}';
set local role authenticated;
select results_eq(
  format($$ select r.req_key from onboarding_required_docs('international_student', null) r
             where not exists (select 1 from current_compliance_docs(%L) c where c.doc_type = any (r.accepts)) $$,
         :'jon'),
  $$ values ('university_term_dates_letter') $$,
  'which leaves the term letter missing');
select lives_ok(
  format($$ select onboarding_attach_document('university_term_dates_letter', %L, 'term.pdf', 348160, 'application/pdf') $$,
         :'jon' || '/university_term_dates_letter/1.pdf'),
  'after Submit, the missing term letter takes a file');
reset role;
select results_eq(
  format($$ select review_status::text, needs_manual_review from compliance_docs
             where staff_id = %L and doc_type = 'university_term_dates_letter' $$, :'jon'),
  $$ values ('pending'::text, true) $$,
  'and goes to the office for review');
select is((select status::text from staff where id = :'jon'), 'documents',
  'the worker still waits on the office''s Verify');

set local "request.jwt.claims" = '{"sub":"81300000-0000-4000-8000-0000000000a1","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  format($$ select onboarding_attach_document('university_term_dates_letter', %L, 'term2.pdf', 348160, 'application/pdf') $$,
         :'jon' || '/university_term_dates_letter/2.pdf'),
  'P0001', 'not_rejected', 'a second file on the letter in review is refused');
select throws_ok(
  format($$ select onboarding_attach_document('passport', %L, 'passport2.jpg', 900000, 'image/jpeg') $$,
         :'jon' || '/passport/2.jpg'),
  'P0001', 'not_rejected', 'and so is a new passport while the first is in review');
reset role;

-- A graduate submitted with a completion letter in review in place of
-- the term letter (ADR-0112): that row is answered, not missing.
insert into onboarding_progress (staff_id, rtw_at, documents_at) values (:'mia', now(), now())
  on conflict (staff_id) do update set rtw_at = excluded.rtw_at, documents_at = excluded.documents_at;
insert into compliance_docs (staff_id, doc_type, file_path, review_status)
values (:'mia', 'university_completion_letter', :'mia' || '/completion-letter/c1.pdf', 'pending');
set local "request.jwt.claims" = '{"sub":"81300000-0000-4000-8000-0000000000a3","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  format($$ select onboarding_attach_document('university_term_dates_letter', %L, 'term.pdf', 348160, 'application/pdf') $$,
         :'mia' || '/university_term_dates_letter/1.pdf'),
  'P0001', 'not_rejected', 'a term letter a completion letter in review answers is not taken (ADR-0112)');
reset role;

select * from finish();
rollback;
