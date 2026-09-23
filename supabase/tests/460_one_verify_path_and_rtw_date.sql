-- =====================================================================
-- 460 · One verify path, and a right-to-work date on every non-UK worker
--   20260923200000_one_verify_path_and_rtw_date.sql
--
-- The defect: /onboarding/:id and /compliance each had their own Verify.
-- The onboarding one verified expired documents and Rejected / Removed
-- profiles' documents, and neither ever put a right-to-work date on the
-- worker — so can_roster_staff() read NULL as "no expiry recorded" for
-- every non-UK worker onboarded, and the per-shift hard stop never fired.
--
-- What this file holds:
--   A. A work-visa candidate verified from the ONBOARDING screen ends up
--      with staff.right_to_work_until set, and can_roster_staff() is false
--      for a shift after it.
--   B. The same documents verified from the COMPLIANCE screen produce the
--      identical rows — documents, worker, N8.
--   C. An expired document, and a Rejected or Removed profile's document,
--      are refused on both.
--   D. The date is required per branch (§2.5): a visa, status document or
--      share code needs one; settled status (branch 2) may be confirmed
--      with no time limit, explicitly and nowhere else; the row guard
--      holds for a direct UPDATE too.
--   E. The worker's date is the EARLIEST across current verified evidence,
--      and moves with a renewal.
-- =====================================================================
begin;
select plan(40);
\ir _shared/fixtures.psql

\set c_onb   'c4600000-0000-4000-8000-000000000001'
\set c_cmp   'c4600000-0000-4000-8000-000000000002'
\set c_exp   'c4600000-0000-4000-8000-000000000003'
\set c_rej   'c4600000-0000-4000-8000-000000000004'
\set c_rem   'c4600000-0000-4000-8000-000000000005'
\set c_eu    'c4600000-0000-4000-8000-000000000006'
\set c_dep   'c4600000-0000-4000-8000-000000000007'
\set c_stu   'c4600000-0000-4000-8000-000000000008'

\set onb_pass  'c4610000-0000-4000-8000-000000000001'
\set onb_visa  'c4610000-0000-4000-8000-000000000002'
\set onb_share 'c4610000-0000-4000-8000-000000000003'
\set cmp_pass  'c4610000-0000-4000-8000-000000000011'
\set cmp_visa  'c4610000-0000-4000-8000-000000000012'
\set cmp_share 'c4610000-0000-4000-8000-000000000013'
\set exp_a     'c4610000-0000-4000-8000-000000000021'
\set exp_b     'c4610000-0000-4000-8000-000000000022'
\set exp_visa  'c4610000-0000-4000-8000-000000000023'
\set rej_doc   'c4610000-0000-4000-8000-000000000031'
\set rem_doc   'c4610000-0000-4000-8000-000000000032'
\set eu_share  'c4610000-0000-4000-8000-000000000041'
\set dep_stat  'c4610000-0000-4000-8000-000000000051'
\set dep_visa  'c4610000-0000-4000-8000-000000000052'
\set stu_share 'c4610000-0000-4000-8000-000000000061'
\set stu_cl    'c4610000-0000-4000-8000-000000000062'
\set cmp_visa2 'c4610000-0000-4000-8000-000000000014'
\set cmp_shr2  'c4610000-0000-4000-8000-000000000015'

select (now() at time zone 'Europe/London')::date as today \gset

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status, rtw_branch, share_code) values
  (:'c_onb', null,  'Ola',   'Onboarding', 'ola@rtw.test',  '+447700946001', date '1995-01-01', 'documents', 'work_visa', 'W11111111'),
  (:'c_cmp', null,  'Cai',   'Compliance', 'cai@rtw.test',  '+447700946002', date '1995-01-01', 'documents', 'work_visa', 'W11111111'),
  (:'c_exp', null,  'Eli',   'Expired',    'eli@rtw.test',  '+447700946003', date '1995-01-01', 'documents', 'work_visa', 'W22222222'),
  (:'c_rej', null,  'Rui',   'Rejected',   'rui@rtw.test',  '+447700946004', date '1995-01-01', 'rejected',  'work_visa', null),
  (:'c_rem', 94605, 'Deleted','account',   'rem@rtw.test',  '+447700946005', date '1995-01-01', 'removed',   null,        null),
  (:'c_eu',  null,  'Ewa',   'Settled',    'ewa@rtw.test',  '+447700946006', date '1995-01-01', 'documents', 'eu_settled', 'W33333333'),
  (:'c_dep', null,  'Dev',   'Dependant',  'dev@rtw.test',  '+447700946007', date '1995-01-01', 'documents', 'dependant_other', 'W44444444'),
  (:'c_stu', null,  'Sia',   'Student',    'sia@rtw.test',  '+447700946008', date '2003-01-01', 'documents', 'international_student', 'W55555555');
update staff set removed_at = now() - interval '1 day' where id = :'c_rem';

-- The twins: the same three documents each, as the wizard files them — a
-- visa carrying the expiry typed on step 1, and the share code report with
-- no date (no extractor has read the gov.uk report).
insert into compliance_docs (id, staff_id, doc_type, uploaded_at, expiry_date, share_code, review_status) values
  (:'onb_pass',  :'c_onb', 'passport',          now() - interval '3 hours', :'today'::date + 3000, null, 'pending'),
  (:'onb_visa',  :'c_onb', 'visa_document',     now() - interval '3 hours', :'today'::date + 400,  null, 'pending'),
  (:'onb_share', :'c_onb', 'share_code_report', now() - interval '2 hours', null, 'W11111111', 'pending'),
  (:'cmp_pass',  :'c_cmp', 'passport',          now() - interval '3 hours', :'today'::date + 3000, null, 'pending'),
  (:'cmp_visa',  :'c_cmp', 'visa_document',     now() - interval '3 hours', :'today'::date + 400,  null, 'pending'),
  (:'cmp_share', :'c_cmp', 'share_code_report', now() - interval '2 hours', null, 'W11111111', 'pending'),
  (:'exp_a',     :'c_exp', 'passport',          now() - interval '1 day', :'today'::date - 1, null, 'pending'),
  (:'exp_b',     :'c_exp', 'national_id',       now() - interval '1 day', :'today'::date - 1, null, 'pending'),
  (:'exp_visa',  :'c_exp', 'visa_document',     now() - interval '1 day', :'today'::date,     null, 'pending'),
  (:'rej_doc',   :'c_rej', 'visa_document',     now() - interval '1 day', :'today'::date + 400, null, 'pending'),
  (:'rem_doc',   :'c_rem', 'passport',          now() - interval '1 day', :'today'::date + 400, null, 'pending'),
  (:'eu_share',  :'c_eu',  'share_code_report', now() - interval '1 day', null, 'W33333333', 'pending'),
  (:'dep_stat',  :'c_dep', 'status_document',   now() - interval '1 day', null, null, 'pending'),
  (:'dep_visa',  :'c_dep', 'visa_document',     now() - interval '1 day', null, null, 'pending'),
  (:'stu_share', :'c_stu', 'share_code_report', now() - interval '1 day', null, 'W55555555', 'pending');
insert into compliance_docs (id, staff_id, doc_type, uploaded_at, review_status, completion_date_claimed)
values (:'stu_cl', :'c_stu', 'university_completion_letter', now() - interval '1 day', 'pending', :'today'::date + 30);

-- Every review below is the office's, with a reviewer.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);

-- =====================================================================
-- A · The onboarding screen, a work-visa candidate
-- =====================================================================
select is((select right_to_work_until from staff where id = :'c_onb'), null,
  'before: nothing has put a right-to-work date on the candidate');
select ok(can_roster_staff(:'c_onb', :'today'::date + 5000),
  'and so can_roster_staff() lets her be rostered on any date — the hole');

select throws_ok(format('select verify_document(%L)', :'onb_share'),
  'P0001', 'rtw_date_required: share_code_report',
  '§2.6: a share code report is not verified without the right-to-work date off the gov.uk report');
select lives_ok(format('select verify_document(%L)', :'onb_visa'),
  '§2.5 pt 3: the visa is verified on the expiry the candidate typed, which the manager confirms');
select is((select right_to_work_until from staff where id = :'c_onb'), :'today'::date + 400,
  'verifying the visa puts its expiry on the worker');
select lives_ok(format('select verify_document(%L, %L::date)', :'onb_share', :'today'::date + 300),
  'the share code report is verified with the date read off the report');
select is((select right_to_work_until from staff where id = :'c_onb'), :'today'::date + 300,
  'right_to_work_until is the EARLIEST confirmed date across her evidence — the share code, not the visa');
select ok(not can_roster_staff(:'c_onb', :'today'::date + 301),
  'can_roster_staff() is false for a shift the day after it — the per-shift hard stop now fires');
select ok(can_roster_staff(:'c_onb', :'today'::date + 300),
  'and true on the last day she may work (inclusive)');
select is((select right_to_work_until from compliance_docs where id = :'onb_share'), :'today'::date + 300,
  'the date lives on the share code report too, where compliance_daily reads it');
select lives_ok(format('select verify_document(%L)', :'onb_pass'), 'her passport is verified');
select isnt_empty(
  format($$ select 1 from audit_log where action = 'rtw.verified' and entity_id = %L
             and data ->> 'confirmedUntil' = %L $$, :'onb_share', (:'today'::date + 300)::text),
  '§1.8: the right-to-work date the reviewer confirmed is audited');

-- =====================================================================
-- B · The compliance screen produces the same result
-- =====================================================================
select lives_ok(format('select compliance_verify_document(%L)', :'cmp_visa'), 'Compliance verifies the twin''s visa');
select lives_ok(format('select compliance_verify_document(%L, null, null, %L::date)', :'cmp_share', :'today'::date + 300),
  'and the share code with the same date');
select lives_ok(format('select compliance_verify_document(%L)', :'cmp_pass'), 'and the passport');
select results_eq(
  format($$ select doc_type::text, review_status::text, expiry_date, right_to_work_until,
                   rtw_no_time_limit, reviewed_by::text, share_code
              from compliance_docs where staff_id = %L order by doc_type $$, :'c_onb'),
  format($$ select doc_type::text, review_status::text, expiry_date, right_to_work_until,
                   rtw_no_time_limit, reviewed_by::text, share_code
              from compliance_docs where staff_id = %L order by doc_type $$, :'c_cmp'),
  'the two paths leave identical documents: status, dates, reviewer');
select results_eq(
  format($$ select status::text, right_to_work_until, share_code from staff where id = %L $$, :'c_onb'),
  format($$ select status::text, right_to_work_until, share_code from staff where id = %L $$, :'c_cmp'),
  'and an identical worker: stage, right-to-work date, share code');

-- Reject, both ways, on a fresh pair of uploads.
insert into compliance_docs (id, staff_id, doc_type, uploaded_at, expiry_date, review_status) values
  ('c4610000-0000-4000-8000-000000000071', :'c_onb', 'passport', now(), :'today'::date + 3000, 'pending'),
  ('c4610000-0000-4000-8000-000000000072', :'c_cmp', 'passport', now(), :'today'::date + 3000, 'pending');
select lives_ok($$ select reject_document('c4610000-0000-4000-8000-000000000071', 'Photo is blurred') $$,
  'the onboarding screen rejects');
select lives_ok($$ select compliance_reject_document('c4610000-0000-4000-8000-000000000072', 'Photo is blurred') $$,
  'the compliance screen rejects');
select results_eq(
  $$ select template, channel::text, payload - 'documentId', payload ->> 'documentId' = substring(key from 8)
       from notification_outbox where key = 'N8:doc:c4610000-0000-4000-8000-000000000071' $$,
  $$ select template, channel::text, payload - 'documentId', payload ->> 'documentId' = substring(key from 8)
       from notification_outbox where key = 'N8:doc:c4610000-0000-4000-8000-000000000072' $$,
  'the same N8, carrying the same reason and a Re-upload target, whichever screen rejected');

-- =====================================================================
-- C · Refused on both
-- =====================================================================
select throws_like(format('select verify_document(%L)', :'exp_a'), 'already_expired%',
  '§4.2: the onboarding screen refuses an already-expired document');
select throws_like(format('select compliance_verify_document(%L)', :'exp_b'), 'already_expired%',
  'and so does the compliance screen');
select throws_like(format('select verify_document(%L)', :'exp_visa'), 'already_expired%',
  'a visa expiring today is already over for rostering purposes');
select throws_ok(format('select verify_document(%L, %L::date)', :'rej_doc', :'today'::date + 400),
  'P0001', 'not_reviewable: rejected', '§4.1: a Rejected candidate''s document is refused from onboarding');
select throws_ok(format('select compliance_verify_document(%L, %L::date)', :'rej_doc', :'today'::date + 400),
  'P0001', 'not_reviewable: rejected', 'and from compliance');
select throws_ok(format('select verify_document(%L)', :'rem_doc'),
  'P0001', 'not_reviewable: removed', '§4.1: a Removed worker''s document is refused from onboarding');
select throws_ok(format('select compliance_verify_document(%L)', :'rem_doc'),
  'P0001', 'not_reviewable: removed', 'and from compliance');
select throws_ok(format('select verify_document(%L, %L::date, null, %L::date)', :'stu_cl', :'today'::date + 30, :'today'::date + 30),
  'P0001', 'use_approve_completion_letter',
  'a completion letter is not verified from onboarding: approve_completion_letter() confirms both its dates');

-- =====================================================================
-- D · The date, per branch (§2.5)
-- =====================================================================
select throws_ok(format('select compliance_verify_document(%L)', :'eu_share'),
  'P0001', 'rtw_date_required: share_code_report',
  'branch 2: a blank date is never read as settled status');
select lives_ok(format('select compliance_verify_document(%L, null, null, %L::date)', :'eu_share', 'infinity'),
  'branch 2: settled status is confirmed explicitly, with no time limit');
select results_eq(
  format($$ select d.right_to_work_until, d.rtw_no_time_limit, s.right_to_work_until
              from compliance_docs d join staff s on s.id = d.staff_id where d.id = %L $$, :'eu_share'),
  $$ values (null::date, true, null::date) $$,
  'recorded as no time limit, and the worker has no right-to-work expiry — correctly');
select throws_like(format('select verify_document(%L, %L::date)', :'stu_share', 'infinity'),
  'no_time_limit_not_allowed%',
  'branch 4: a Student visa always ends — "no time limit" is refused');
select lives_ok(format('select verify_document(%L, %L::date)', :'stu_share', :'today'::date + 200),
  'branch 4: the share code is verified with its date');
select throws_ok(format('select verify_document(%L)', :'dep_stat'),
  'P0001', 'rtw_date_required: status_document',
  'branch 5: a status document needs its expiry (§2.5 pt 5)');
select throws_ok(format('select compliance_verify_document(%L, %L::date)', :'dep_stat', 'infinity'),
  '22023', 'date_invalid', 'and "no time limit" is not a status document''s to claim');

reset role;
select throws_ok(format($$ update compliance_docs set review_status = 'verified' where id = %L $$, :'dep_visa'),
  'P0001', 'rtw_date_required: visa_document',
  'on the ROW: a direct update cannot verify a visa document without its date');

-- =====================================================================
-- E · Earliest across current evidence, and a renewal
-- =====================================================================
insert into compliance_docs (id, staff_id, doc_type, uploaded_at, expiry_date, review_status)
values (:'cmp_visa2', :'c_cmp', 'visa_document', now() + interval '1 minute', :'today'::date + 800, 'pending');
select lives_ok(format('select compliance_verify_document(%L)', :'cmp_visa2'), 'a renewed visa is verified');
select is((select right_to_work_until from staff where id = :'c_cmp'), :'today'::date + 300,
  'but the stale share code still ends the right to work: the earliest date stands');
insert into compliance_docs (id, staff_id, doc_type, uploaded_at, share_code, review_status)
values (:'cmp_shr2', :'c_cmp', 'share_code_report', now() + interval '2 minutes', 'W11111111', 'pending');
select lives_ok(format('select compliance_verify_document(%L, null, null, %L::date)', :'cmp_shr2', :'today'::date + 790),
  'the new gov.uk check is verified');
select is((select right_to_work_until from staff where id = :'c_cmp'), :'today'::date + 790,
  'with both renewed, the worker''s date moves to the new earliest');

select * from finish();
rollback;
