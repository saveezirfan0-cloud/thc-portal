-- =====================================================================
-- 675 · The office's completion-letter upload, the gov.uk report on the
--       manual path, and right-to-work changes in the audit export
--       (audit D47, D31, AC7)
--   20260930130400_ni_check_office_uploads_and_rtw_audit.sql
-- =====================================================================
begin;
select plan(27);
\ir _shared/fixtures.psql

\set stu    '63700000-0000-4000-8000-000000000001'
\set cand   '63700000-0000-4000-8000-000000000002'
\set brit   '63700000-0000-4000-8000-000000000003'
\set wv     '63700000-0000-4000-8000-000000000004'
\set share  '63710000-0000-4000-8000-000000000001'

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status, rtw_branch,
                   right_to_work_until) values
  (:'stu',  63701, 'Sofi', 'Student',   'sofi@637.test', '+447700963701', date '2000-01-01', 'compliant',
   'international_student', date '2035-01-01'),
  (:'cand', null,  'Cato', 'Candidate', 'cato@637.test', '+447700963702', date '2002-01-01', 'documents',
   'international_student', date '2035-01-01'),
  (:'brit', 63703, 'Bo',   'Brit',      'bo@637.test',   '+447700963703', date '1990-01-01', 'compliant',
   'uk_irish', null),
  (:'wv',   63704, 'Val',  'Visa',      'val@637.test',  '+447700963704', date '1990-01-01', 'compliant',
   'work_visa', date '2035-01-01');

insert into compliance_docs (id, staff_id, doc_type, share_code, review_status, right_to_work_until) values
  (:'share', :'wv', 'share_code_report', 'WV1234567', 'verified', date '2035-01-01');

insert into storage.objects (bucket_id, name, metadata) values
  ('documents', :'stu'  || '/completion-letter/office1.pdf', '{"mimetype":"application/pdf","size":120000}'),
  ('documents', :'cand' || '/completion-letter/office2.png', '{"mimetype":"image/png","size":90000}'),
  ('documents', :'brit' || '/completion-letter/office3.pdf', '{"mimetype":"application/pdf","size":90000}'),
  ('documents', :'wv'   || '/share-code-report/report.pdf',  '{"mimetype":"application/pdf","size":300000}'),
  ('documents', :'wv'   || '/share-code-report/second.pdf',  '{"mimetype":"application/pdf","size":300000}');

-- =====================================================================
-- 1 · D47 · the office uploads a completion letter
-- =====================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(office_submit_completion_letter(:'stu', :'stu' || '/completion-letter/office1.pdf',
                                          date '2026-06-30', 'letter', 'University of Leeds') ->> 'status',
  'pending', 'D47: the office uploads a worker''s completion letter — it lands pending, like the worker''s');
select is(office_submit_completion_letter(:'stu', :'stu' || '/completion-letter/office1.pdf',
                                          date '2026-06-30', 'letter') ->> 'reason',
  'already_pending', 'one pending letter at a time, whoever uploaded it');
select is(office_submit_completion_letter(:'cand', :'cand' || '/completion-letter/office2.png',
                                          date '2026-07-10', 'transcript') ->> 'ok',
  'true', 'D47: and a Student-visa candidate''s, from the candidate profile');
select is(office_submit_completion_letter(:'brit', :'brit' || '/completion-letter/office3.pdf',
                                          date '2026-06-30', 'letter') ->> 'reason',
  'not_student_visa', 'only for the Student visa, as on the worker''s side');
select is(office_submit_completion_letter(:'stu', :'cand' || '/completion-letter/office2.png',
                                          date '2026-06-30', 'letter') ->> 'reason',
  'invalid_path', 'the file must sit under that worker''s own folder');
select is(office_submit_completion_letter(:'stu', :'stu' || '/completion-letter/missing.pdf',
                                          date '2026-06-30', 'letter') ->> 'reason',
  'file_not_found', 'a file Storage never recorded is refused');
reset role;

select is((select graduated_at from staff where id = :'stu'), null,
  'AC2: the office''s upload changes nothing the cap reads — approval does');
select results_eq(
  $$ select review_status::text, evidence_form, completion_date_claimed, awarding_institution, mime_type
       from compliance_docs where staff_id = '63700000-0000-4000-8000-000000000001'
        and doc_type = 'university_completion_letter' $$,
  $$ values ('pending', 'letter', date '2026-06-30', 'University of Leeds', 'application/pdf') $$,
  'D47: the document records what was uploaded and the date the office read off it');
select is((select count(*)::int from notification_outbox
            where template in ('CL1', 'CL3')
              and (recipient_staff_id = :'stu' or payload ->> 'name' = 'Sofi Student')), 0,
  'no "we received your upload" to a worker who did not upload, and no email to the office about its own upload');
select results_eq(
  $$ select actor::text, data ->> 'actorName' from audit_log
      where action = 'completion_letter.uploaded' and data ->> 'staffId' = '63700000-0000-4000-8000-000000000001' $$,
  $$ values ('11111111-1111-1111-1111-111111111111', 'Gisela M.') $$,
  'D47: the upload is audited with the admin as the uploader');
select is((select kind from compliance_review_queue_v
            where staff_id = :'stu' and item_type = 'university_completion_letter'), 'document',
  'D47: and waits in Needs review for the Approve that confirms the dates');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select throws_ok($$ select office_submit_completion_letter('63700000-0000-4000-8000-000000000002',
                     '63700000-0000-4000-8000-000000000002/completion-letter/office2.png', date '2026-06-30', 'letter') $$,
  '42501', 'not_authorised', 'a worker cannot file evidence under someone else''s name');
reset role;

-- =====================================================================
-- 2 · D31 · the gov.uk report on the manual path
-- =====================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(compliance_attach_rtw_report(:'share', :'stu' || '/share-code-report/report.pdf') ->> 'reason',
  'invalid_path', 'D31: the report must be under that worker''s own share-code-report folder');
select is(compliance_attach_rtw_report(:'share', :'wv' || '/share-code-report/report.pdf') ->> 'ok',
  'true', 'D31: the office attaches the gov.uk report it downloaded to a hand-verified share code');
select is(compliance_attach_rtw_report(:'share', :'wv' || '/share-code-report/second.pdf') ->> 'reason',
  'report_already_attached', 'D31: a report on file is never replaced — it is evidence too');
select throws_ok($$ select compliance_attach_rtw_report('0e0e0e0e-0000-4000-8000-000000000001', 'x/share-code-report/y.pdf') $$,
  'P0001', 'not_a_share_code_document', 'only a share code document carries a gov.uk report');
reset role;
select is((select gov_report_path from compliance_docs where id = :'share'), :'wv' || '/share-code-report/report.pdf',
  'D31: gov_report_path is written — the profile''s "gov.uk report" download follows from it');

-- The manual path only: while the automated check owns a share code
-- (on, and not in needs_review or stuck), rtw_check_record() writes
-- gov_report_path itself and would overwrite the office's attachment.
\set share2 '63710000-0000-4000-8000-000000000009'
update settings set value = value || '{"enabled": true}'::jsonb where key = 'rtw_check';
insert into compliance_docs (id, staff_id, doc_type, share_code, review_status, needs_manual_review, uploaded_at)
values (:'share2', :'wv', 'share_code_report', 'WV7654321', 'pending', true, clock_timestamp());
insert into storage.objects (bucket_id, name, metadata) values
  ('documents', :'wv' || '/share-code-report/third.pdf', '{"mimetype":"application/pdf","size":300000}');
select is((select status from rtw_checks where compliance_doc_id = :'share2'), 'queued',
  'setup: with the automated check on, filing the share code queued its check');
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(compliance_attach_rtw_report(:'share2', :'wv' || '/share-code-report/third.pdf') ->> 'reason',
  'automated_check_owns_report',
  'D31: while the automated check owns the share code the office cannot attach a report — the check writes its own');
reset role;
select is((select gov_report_path from compliance_docs where id = :'share2'), null,
  'D31: and nothing was written');
update settings set value = value || '{"enabled": false}'::jsonb where key = 'rtw_check';

-- =====================================================================
-- 3 · AC7 · right-to-work changes and decisions in the export
-- =====================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select record_right_to_work_change(:'wv', 'international_student', date '2034-06-30');
select compliance_set_below_degree_level(:'wv', true);
reset role;

select results_eq(
  $$ select record_type, event, branch_before, branch, rtw_until_before, rtw_until, actor_name
       from compliance_evidence_audit_v
      where staff_id = '63700000-0000-4000-8000-000000000004' and event = 'changed' $$,
  $$ values ('rtw', 'changed', 'work_visa', 'international_student', date '2035-01-01', date '2034-06-30', 'Gisela M.') $$,
  'AC7: a change of right-to-work route is in the export — from, to, both dates, who');
select results_eq(
  $$ select record_type, event, condition, below_degree_level
       from compliance_evidence_audit_v
      where staff_id = '63700000-0000-4000-8000-000000000004' and event = 'conditions' $$,
  $$ values ('rtw', 'conditions', 'below_degree_level', true) $$,
  'AC7: the course level the office confirmed is in the export');
select results_eq(
  $$ select record_type, event, doc_type, file_path, document_id::text
       from compliance_evidence_audit_v
      where staff_id = '63700000-0000-4000-8000-000000000004' and event = 'report_attached' $$,
  $$ values ('rtw', 'report_attached', 'share_code_report', '63700000-0000-4000-8000-000000000004/share-code-report/report.pdf',
             '63710000-0000-4000-8000-000000000001') $$,
  'AC7: an attached gov.uk report is in the export, against its document');

-- A Verify on a right-to-work document, and an automated check's result.
insert into audit_log (at, actor, action, entity, entity_id, data) values
  (now(), null, 'rtw_check.passed', 'compliance_docs', :'share',
   jsonb_build_object('staffId', :'wv', 'source', 'provider', 'outcome', 'right_to_work',
                      'rightToWorkUntil', '2035-01-01', 'actorName', 'Automatic gov.uk check'));
select results_eq(
  $$ select record_type, event, check_source, check_outcome, rtw_until, actor_name
       from compliance_evidence_audit_v
      where staff_id = '63700000-0000-4000-8000-000000000004' and record_type = 'rtw_check' $$,
  $$ values ('rtw_check', 'passed', 'provider', 'right_to_work', date '2035-01-01', 'Automatic gov.uk check') $$,
  'AC7: the automated check''s decisions are in the export');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into compliance_docs (id, staff_id, doc_type, review_status, expiry_date)
  values ('63710000-0000-4000-8000-000000000002', :'wv', 'visa_document', 'pending', date '2034-06-30');
select compliance_verify_document('63710000-0000-4000-8000-000000000002', date '2034-06-30');
reset role;
select results_eq(
  $$ select record_type, event, doc_type, rtw_until, actor_name
       from compliance_evidence_audit_v
      where staff_id = '63700000-0000-4000-8000-000000000004' and event = 'verified' $$,
  $$ values ('rtw', 'verified', 'visa_document', date '2034-06-30', 'Gisela M.') $$,
  'AC7: the office''s Verify of a right-to-work document is in the export');
select ok((select count(*) from compliance_evidence_audit_v where record_type = 'completion_letter') >= 2,
  'the completion letter rows are still there alongside');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select is_empty($$ select 1 from compliance_evidence_audit_v $$,
  'the export is the office''s: a worker reads nothing');
reset role;

select * from finish();
rollback;
