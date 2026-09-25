-- =====================================================================
-- 636 · N8 lands where the Re-upload is, and the NI number is checked
--       against its evidence (audit D42, D43)
--   20260929150200_n8_lands_where_the_reupload_is.sql
--   20260929150400_ni_check_office_uploads_and_rtw_audit.sql
-- =====================================================================
begin;
select plan(27);
\ir _shared/fixtures.psql

\set cand    '63600000-0000-4000-8000-000000000001'
\set wkr     '63600000-0000-4000-8000-000000000002'
\set late    '63600000-0000-4000-8000-000000000003'
\set cdoc    '63610000-0000-4000-8000-000000000001'
\set wdoc    '63610000-0000-4000-8000-000000000002'
\set ni_now  '63610000-0000-4000-8000-000000000003'
\set ni_late '63610000-0000-4000-8000-000000000004'
\set ni_bad  '63610000-0000-4000-8000-000000000005'
\set cdecl   '63620000-0000-4000-8000-000000000001'

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status, rtw_branch, ni_number) values
  (:'cand', null,  'Cleo', 'Candidate', 'cleo@636.test', '+447700963601', date '2001-01-01', 'documents', 'uk_irish', null),
  (:'wkr',  63602, 'Will', 'Worker',    'will@636.test', '+447700963602', date '1990-01-01', 'compliant', 'uk_irish', 'QQ123456C'),
  (:'late', null,  'Lina', 'Later',     'lina@636.test', '+447700963603', date '2001-01-01', 'documents', 'uk_irish', null);

insert into compliance_docs (id, staff_id, doc_type, file_path, review_status) values
  (:'cdoc',    :'cand', 'passport',    :'cand' || '/passport/p.pdf', 'pending'),
  (:'wdoc',    :'wkr',  'passport',    :'wkr'  || '/passport/p.pdf', 'pending'),
  (:'ni_now',  :'wkr',  'ni_evidence', :'wkr'  || '/ni-evidence/n.pdf', 'pending'),
  (:'ni_late', :'late', 'ni_evidence', :'late' || '/ni-evidence/n.pdf', 'pending');

insert into criminal_declarations (id, staff_id, source, answer, details, conviction_date) values
  (:'cdecl', :'cand', 'onboarding', true, 'Fixture conviction', date '2019-01-01');

-- =====================================================================
-- 1 · D42 · where N8 lands
-- =====================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok($$ select compliance_reject_document('63610000-0000-4000-8000-000000000001', 'The photo page is cut off') $$,
  'the office rejects a candidate''s passport');
select lives_ok($$ select compliance_reject_document('63610000-0000-4000-8000-000000000002', 'Expired') $$,
  'and a worker''s');
select lives_ok($$ select compliance_reject_declaration('63620000-0000-4000-8000-000000000001', 'Details incomplete') $$,
  'and a candidate''s Yes declaration');
reset role;

select is((select payload ->> 'link' from notification_outbox where key = 'N8:doc:' || :'cdoc'), '/onboarding',
  'D42: a candidate''s N8 opens the onboarding wizard, where their re-upload is — not the locked Documents hub');
select is((select payload ->> 'link' from notification_outbox where key = 'N8:doc:' || :'wdoc'), '/documents',
  'D42: a worker''s N8 opens the Documents hub');
select is((select payload ->> 'documentId' from notification_outbox where key = 'N8:doc:' || :'wdoc'), :'wdoc',
  'D42: the push is about one document, and says which — the tag is built from it');
select is((select payload ->> 'reason' from notification_outbox where key = 'N8:doc:' || :'wdoc'), 'Expired',
  'the reason goes to the worker word for word, as before');
select is((select payload ->> 'link' from notification_outbox where key = 'N8:declaration:' || :'cdecl'), '/onboarding',
  'D42: a rejected onboarding declaration lands in the wizard too');
select is((select payload ->> 'documentId' from notification_outbox where key = 'N8:declaration:' || :'cdecl'), :'cdecl',
  'and is tagged by the declaration');
select is(n8_link('compliant'), '/documents', 'n8_link: compliant → /documents');
select is(n8_link('blocked'), '/documents', 'n8_link: blocked → /documents (the app is locked to Documents)');
select is(n8_link('contract'), '/onboarding', 'n8_link: a candidate at any stage → /onboarding');

-- =====================================================================
-- 2 · D43 · the NI number beside its evidence
-- =====================================================================
select is((select ni_number from compliance_review_queue_v where item_id = :'ni_now'), 'QQ123456C',
  'D43: the reviewer sees the FULL NI number beside the NI evidence');
select is((select ni_number from compliance_review_queue_v where item_id = :'ni_late'), null,
  'D43: no number yet — the row says so by carrying none');
select is((select ni_number from compliance_review_queue_v where item_id = :'wdoc'), null,
  'the number is on NI evidence rows only');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok($$ select compliance_verify_document('63610000-0000-4000-8000-000000000003') $$,
  'verified with the number on file');
select lives_ok($$ select compliance_verify_document('63610000-0000-4000-8000-000000000004') $$,
  'verified before the number was entered');
reset role;

select results_eq(
  $$ select ni_recheck, ni_matched_at is not null, ni_matched_by::text from compliance_docs
      where id = '63610000-0000-4000-8000-000000000003' $$,
  $$ values (false, true, '11111111-1111-1111-1111-111111111111') $$,
  'D43: verified beside the number — stamped as compared, by the reviewer');
select results_eq(
  $$ select ni_recheck, ni_matched_at is null from compliance_docs
      where id = '63610000-0000-4000-8000-000000000004' $$,
  $$ values (true, true) $$,
  'D43: verified with no number on file — flagged for a re-check');
select is_empty($$ select 1 from compliance_review_queue_v where kind = 'ni_check'
                    and item_id = '63610000-0000-4000-8000-000000000004' $$,
  'D43: nothing to compare yet, so nothing in the queue');

-- The number arrives (the wizard's HMRC step writes it).
update staff set ni_number = 'AB123456C' where id = :'late';
select results_eq(
  $$ select kind, ni_number, review_reason from compliance_review_queue_v
      where item_id = '63610000-0000-4000-8000-000000000004' $$,
  $$ values ('ni_check', 'AB123456C', 'NI number entered after the NI evidence was verified — compare them') $$,
  'D43: once it arrives the document is back in Needs review, with the number beside it');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok($$ select compliance_resolve_ni_check('63610000-0000-4000-8000-000000000004', false, ' ') $$,
  'P0001', 'reason_required', 'a mismatch needs a reason — the worker is sent it');
select lives_ok($$ select compliance_resolve_ni_check('63610000-0000-4000-8000-000000000004', true) $$,
  'the reviewer confirms the number matches the evidence');
select throws_ok($$ select compliance_resolve_ni_check('63610000-0000-4000-8000-000000000004', true) $$,
  'P0001', 'no_ni_check_due', 'and it is not due twice');
reset role;

select is_empty($$ select 1 from compliance_review_queue_v where item_id = '63610000-0000-4000-8000-000000000004' $$,
  'D43: compared — it leaves the queue');
select is((select count(*)::int from audit_log
            where action = 'ni.matched' and entity_id = :'ni_late'
              and not (data::text like '%AB123456C%')), 1,
  'D43: the comparison is audited, and the number is not written into the log');

-- A mismatch rejects the evidence and asks for a re-upload.
insert into compliance_docs (id, staff_id, doc_type, file_path, review_status) values
  (:'ni_bad', :'cand', 'ni_evidence', :'cand' || '/ni-evidence/x.pdf', 'pending');
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select compliance_verify_document(:'ni_bad');
reset role;
update staff set ni_number = 'CD123456A' where id = :'cand';
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select compliance_resolve_ni_check(:'ni_bad', false, 'The letter shows a different number');
reset role;
select results_eq(
  $$ select d.review_status::text, d.rejection_reason, o.payload ->> 'link'
       from compliance_docs d
       join notification_outbox o on o.key = 'N8:doc:' || d.id
      where d.id = '63610000-0000-4000-8000-000000000005' $$,
  $$ values ('rejected', 'The letter shows a different number', '/onboarding') $$,
  'D43: a mismatch rejects the NI evidence with the reason, and N8 asks the candidate to re-upload in the wizard');

select * from finish();
rollback;
