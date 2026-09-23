-- =====================================================================
-- 444 · Compliance → Needs review and Radar (§4.1–4.3, §10.7)
--   compliance_verify_document(), compliance_reject_document(), compliance_verify_declaration(),
--   compliance_reject_declaration(), compliance_review_queue_v, compliance_radar_v
--   from 20260923100000_compliance_review.sql
--
-- The property the B6 brief asks this file to hold above all:
--
--   "Verifying one document does not unblock a worker by itself; the full
--    compliance re-check does."
--
-- §4.3's own worked example is a worker blocked on one document while a
-- second is already dead. Verifying the first must leave them blocked,
-- and must SAY which one is still outstanding. Verifying the second then
-- unblocks them with nobody pressing anything else.
-- =====================================================================
begin;
select plan(51);
\ir _shared/fixtures.psql

\set w_blk   'c6000000-0000-4000-8000-000000000001'
\set w_cand  'c6000000-0000-4000-8000-000000000002'
\set w_rej   'c6000000-0000-4000-8000-000000000003'
\set w_rem   'c6000000-0000-4000-8000-000000000004'
\set w_conv  'c6000000-0000-4000-8000-000000000005'
\set w_stu   'c6000000-0000-4000-8000-000000000006'

\set d_pass_old  'c6100000-0000-4000-8000-000000000001'
\set d_visa_old  'c6100000-0000-4000-8000-000000000002'
\set d_pass_new  'c6100000-0000-4000-8000-000000000003'
\set d_visa_new  'c6100000-0000-4000-8000-000000000004'
\set d_cand_ni   'c6100000-0000-4000-8000-000000000005'
\set d_cand_term 'c6100000-0000-4000-8000-000000000006'
\set d_rej       'c6100000-0000-4000-8000-000000000007'
\set d_rem       'c6100000-0000-4000-8000-000000000008'
\set d_share     'c6100000-0000-4000-8000-000000000009'
\set d_expired   'c6100000-0000-4000-8000-00000000000a'
\set d_stu_term  'c6100000-0000-4000-8000-00000000000b'
\set d_stu_cl    'c6100000-0000-4000-8000-00000000000c'

\set c_yes_onb   'c6200000-0000-4000-8000-000000000001'
\set c_no_onb    'c6200000-0000-4000-8000-000000000002'
\set c_yes_emp   'c6200000-0000-4000-8000-000000000003'
\set c_yes_sup   'c6200000-0000-4000-8000-000000000004'

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status, block_kind, block_reason, rtw_branch) values
  (:'w_blk',  96001, 'Jonah',  'Blocked',   'jb@cq.test', '+447700960001', date '1990-01-01', 'blocked', 'auto_document', 'Document expired: Passport', 'work_visa'),
  (:'w_cand', null,  'Hana',   'Candidate', 'hc@cq.test', '+447700960002', date '1999-01-01', 'documents', null, null, 'international_student'),
  (:'w_rej',  null,  'Dina',   'Rejected',  'dr@cq.test', '+447700960003', date '1999-01-01', 'rejected', null, null, 'uk_irish'),
  (:'w_rem',  96004, 'Deleted','account',   'dx@cq.test', '+447700960004', date '1990-01-01', 'removed', null, null, null),
  (:'w_conv', 96005, 'Dara',   'Conviction','dc@cq.test', '+447700960005', date '1990-01-01', 'blocked', 'conviction_review',
                     'Criminal conviction declared — under review', 'uk_irish'),
  (:'w_stu',  96006, 'Amara',  'Student',   'as@cq.test', '+447700960006', date '2000-01-01', 'compliant', null, null, 'international_student');
update staff set removed_at = now() - interval '1 day' where id = :'w_rem';

-- Jonah: the passport AND the visa are both dead. Two verified documents,
-- both expired, both from before the block.
insert into compliance_docs (id, staff_id, doc_type, uploaded_at, expiry_date, review_status) values
  (:'d_pass_old', :'w_blk', 'passport',      now() - interval '3 years', current_date - 10, 'verified'),
  (:'d_visa_old', :'w_blk', 'visa_document', now() - interval '3 years', current_date - 3,  'verified'),
  -- He re-uploads the passport only.
  (:'d_pass_new', :'w_blk', 'passport',      now() - interval '1 hour',  current_date + 3000, 'pending'),
  -- The candidate: NI evidence and a term letter waiting on the office.
  (:'d_cand_ni',  :'w_cand', 'ni_evidence',  now() - interval '2 days', null, 'pending'),
  (:'d_cand_term',:'w_cand', 'university_term_dates_letter', now() - interval '3 days', null, 'pending'),
  -- Rejected and removed people's pending documents drop out (§4.1).
  (:'d_rej',      :'w_rej',  'passport',     now() - interval '5 days', current_date + 900, 'pending'),
  (:'d_rem',      :'w_rem',  'passport',     now() - interval '5 days', current_date + 900, 'pending'),
  -- A share code report with a right-to-work date on it.
  (:'d_share',    :'w_cand', 'share_code_report', now() - interval '1 day', null, 'pending'),
  -- A passport that has already run out by the time it is reviewed.
  (:'d_expired',  :'w_cand', 'passport',     now() - interval '1 day', current_date - 1, 'pending');
update compliance_docs
   set term_dates = array[daterange(date '2026-12-13', date '2027-01-10', '[]')]
 where id = :'d_cand_term';
update compliance_docs
   set right_to_work_until = date '2028-03-31', share_code = 'W12345678'
 where id = :'d_share';

insert into criminal_declarations (id, staff_id, source, answer, details, review_status, superseded, declared_at) values
  (:'c_yes_onb', :'w_cand', 'onboarding',    true,  'Fixed penalty, 2024', 'pending',  false, now() - interval '4 days'),
  (:'c_no_onb',  :'w_stu',  'onboarding',    false, null,                  'verified', false, now() - interval '400 days'),
  (:'c_yes_emp', :'w_conv', 'in_employment', true,  'Declared from the app','pending', false, now() - interval '1 day'),
  (:'c_yes_sup', :'w_stu',  'onboarding',    true,  'A previous period',   'pending',  true,  now() - interval '800 days');

-- Every write below is the office's, with a reviewer.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);

-- ---------------------------------------------------------------------
-- 1 · The queue: who is in it, who is not
-- ---------------------------------------------------------------------
select bag_eq(
  $$ select item_id::text from compliance_review_queue_v
      where staff_id in ('c6000000-0000-4000-8000-000000000001','c6000000-0000-4000-8000-000000000002',
                         'c6000000-0000-4000-8000-000000000003','c6000000-0000-4000-8000-000000000004',
                         'c6000000-0000-4000-8000-000000000005','c6000000-0000-4000-8000-000000000006') $$,
  $$ values ('c6100000-0000-4000-8000-000000000003'::text), ('c6100000-0000-4000-8000-000000000005'),
            ('c6100000-0000-4000-8000-000000000006'), ('c6100000-0000-4000-8000-000000000009'),
            ('c6100000-0000-4000-8000-00000000000a'),
            ('c6200000-0000-4000-8000-000000000001'), ('c6200000-0000-4000-8000-000000000003') $$,
  '§4.1: every pending document and every pending Yes declaration, candidates and staff alike — and nothing else'
);
select is((select count(*)::int from compliance_review_queue_v where staff_id = :'w_rej'), 0,
  '§4.1: a Rejected candidate''s outstanding documents drop out of the queue');
select is((select count(*)::int from compliance_review_queue_v where staff_id = :'w_rem'), 0,
  '§4.1: so do a GDPR-removed worker''s');
select is((select count(*)::int from compliance_review_queue_v where item_id = :'c_no_onb'), 0,
  '§2.10: a criminal declaration answered No is auto-verified and never appears');
select is((select count(*)::int from compliance_review_queue_v where item_id = :'c_yes_sup'), 0,
  '§2.12: a superseded declaration is the previous period''s and does not queue');
select is((select declaration_source from compliance_review_queue_v where item_id = :'c_yes_emp'), 'in_employment',
  '§10.7: the in-employment declaration is in the same queue, labelled as such');
select is((select is_candidate from compliance_review_queue_v where item_id = :'d_cand_ni'), true,
  'a candidate''s row says so');
select is((select is_candidate from compliance_review_queue_v where item_id = :'d_pass_new'), false,
  'a current worker''s row says so too — they never reappear on the onboarding kanban');

-- ---------------------------------------------------------------------
-- 2 · THE RE-CHECK: one verification does not unblock
-- ---------------------------------------------------------------------
select is((select string_agg(reason, ',' order by reason) from compliance_blockers(:'w_blk')),
  'document_expired:passport,document_expired:visa_document,document_unverified:passport',
  'Jonah starts with the passport dead, the visa dead and a new passport under review');

select is(compliance_verify_document(:'d_pass_new') ->> 'unblocked', 'false',
  '§4.3: verifying the re-uploaded passport does NOT unblock him while the visa is still expired');
select is((select status::text from staff where id = :'w_blk'), 'blocked',
  'he is still blocked');
select is((select block_kind::text from staff where id = :'w_blk'), 'auto_document',
  'and still on the automatic block, which the next verification may lift');
select is((select reason from compliance_blockers(:'w_blk')), 'document_expired:visa_document',
  'the full re-check names exactly what is still outstanding: the visa');

-- He uploads the visa; the office verifies it; nothing else is pressed.
insert into compliance_docs (id, staff_id, doc_type, uploaded_at, expiry_date, review_status)
values (:'d_visa_new', :'w_blk', 'visa_document', now(), current_date + 700, 'pending');
select is(compliance_verify_document(:'d_visa_new') ->> 'unblocked', 'true',
  '§4.3: verifying the last outstanding document runs the full re-check and unblocks him automatically');
select is((select status::text from staff where id = :'w_blk'), 'compliant', 'Jonah is compliant');
select is((select block_reason from staff where id = :'w_blk'), null, 'and the block reason is gone');

-- ---------------------------------------------------------------------
-- 3 · Verify, the refusals and the side effects
-- ---------------------------------------------------------------------
select throws_ok(format('select compliance_verify_document(%L)', :'d_pass_new'),
  'P0001', 'not_pending: verified', 'a document is verified once');
select throws_ok(format('select compliance_verify_document(%L)', :'d_expired'),
  'P0001', null, '§4.2: an already-expired document is not accepted');
select throws_ok(format('select compliance_verify_document(%L)', :'d_rej'),
  'P0001', 'not_reviewable: rejected', 'a rejected candidate''s document is not reviewed');

select lives_ok(format('select compliance_verify_document(%L)', :'d_cand_term'), 'the term letter is verified');
select is((select term_dates from staff where id = :'w_cand'),
  array[daterange(date '2026-12-13', date '2027-01-10', '[]')],
  'RULE-20: verifying a term letter copies its holiday ranges onto the worker, where the cap reads them');
select lives_ok(format('select compliance_verify_document(%L)', :'d_share'), 'the share code report is verified');
select is((select right_to_work_until from staff where id = :'w_cand'), date '2028-03-31',
  '§4.4: verifying the share code report writes right-to-work-until onto the worker');
select is((select reviewed_by from compliance_docs where id = :'d_share'), :'admin_uid'::uuid,
  '§1.8: the reviewer is stamped on the document');
select isnt((select reviewed_at from compliance_docs where id = :'d_share'), null,
  'with the moment it was verified');

-- ---------------------------------------------------------------------
-- 4 · Reject → N8 with Re-upload
-- ---------------------------------------------------------------------
select throws_ok(format('select compliance_reject_document(%L, %L)', :'d_cand_ni', '   '),
  'P0001', 'reason_required', '§4.1: Reject asks for a reason');
select lives_ok(format('select compliance_reject_document(%L, %L)', :'d_cand_ni',
  'The NI number is not readable — upload a clear photo of the whole letter'),
  'with one, the document is rejected');
select is((select review_status::text from compliance_docs where id = :'d_cand_ni'), 'rejected',
  'the document is Rejected');
select is((select payload ->> 'reason' from notification_outbox where key = 'N8:doc:' || :'d_cand_ni'),
  'The NI number is not readable — upload a clear photo of the whole letter',
  '§8 N8 carries the reason word for word');
select is((select recipient_staff_id from notification_outbox where key = 'N8:doc:' || :'d_cand_ni'),
  :'w_cand'::uuid, 'to the worker who uploaded it');
select is((select count(*)::int from compliance_review_queue_v where item_id = :'d_cand_ni'), 0,
  'and it leaves the queue');
-- The re-upload comes back to the queue, badged.
insert into compliance_docs (staff_id, doc_type, uploaded_at, review_status)
values (:'w_cand', 'ni_evidence', now(), 'pending');
select is((select is_reupload from compliance_review_queue_v
            where staff_id = :'w_cand' and item_type = 'ni_evidence'), true,
  '§4.1: the re-upload returns to Needs review as a re-upload');
select is((select previous_rejection from compliance_review_queue_v
            where staff_id = :'w_cand' and item_type = 'ni_evidence'),
  'The NI number is not readable — upload a clear photo of the whole letter',
  'with the reason the last one was rejected, so the reviewer can check it was fixed');

-- ---------------------------------------------------------------------
-- 5 · Declarations (§10.7)
-- ---------------------------------------------------------------------
select throws_ok(format('select compliance_reject_declaration(%L, %L)', :'c_yes_emp', ''),
  'P0001', 'reason_required', '§10.7: rejecting a declaration needs the manager''s reason');
select is(compliance_verify_declaration(:'c_yes_emp') ->> 'unblocked', 'true',
  '§10.7 Verify: the block lifts through the ordinary full re-check');
select is((select count(*)::int from notification_outbox where key = 'N15:declaration:' || :'c_yes_emp'), 1,
  'and N15 "your shifts are open again" is queued');
select is((select reviewed_by from criminal_declarations where id = :'c_yes_emp'), :'admin_uid'::uuid,
  'with the reviewer stamped');

-- A second worker, rejected: the block stands and becomes manual.
update staff set status = 'blocked', block_kind = 'conviction_review',
                 block_reason = 'Criminal conviction declared — under review'
 where id = :'w_stu';
insert into criminal_declarations (id, staff_id, source, answer, details, review_status, declared_at)
values ('c6200000-0000-4000-8000-000000000005', :'w_stu', 'in_employment', true, 'Declared', 'pending', now());
select lives_ok($$ select compliance_reject_declaration('c6200000-0000-4000-8000-000000000005',
                                             'Not compatible with licensed-venue work') $$,
  '§10.7 Reject');
select is((select block_kind::text || ' — ' || block_reason from staff where id = :'w_stu'),
  'manual — Not compatible with licensed-venue work',
  '§10.7: the block converts to a manual block carrying the manager''s reason ("Blocked — <reason>")');
select is((select count(*)::int from notification_outbox
            where recipient_staff_id = :'w_stu' and template in ('N8', 'N15')), 0,
  'and nothing is pushed: the office calls the worker');

-- At onboarding a Yes follows the document mechanic instead (§2.3, §2.10).
select lives_ok(format('select compliance_reject_declaration(%L, %L)', :'c_yes_onb',
                       'Please call the office about this before we continue'),
  '§2.10: an onboarding Yes can be rejected from the queue');
select is((select payload ->> 'reason' from notification_outbox where key = 'N8:declaration:' || :'c_yes_onb'),
  'Please call the office about this before we continue',
  '§2.3: and, unlike §10.7, the candidate gets N8 with the reason — the key the onboarding screen uses too');

-- ---------------------------------------------------------------------
-- 6 · Only the office reviews
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid')::text, true);
select throws_ok(format('select compliance_verify_document(%L)', :'d_rej'),
  '42501', 'not_authorised', 'a worker cannot verify a document');
select throws_ok(format('select compliance_reject_document(%L, %L)', :'d_rej', 'no'),
  '42501', 'not_authorised', 'nor reject one');
select set_config('request.jwt.claims', '', true);
select throws_ok(format('select compliance_verify_declaration(%L)', :'c_yes_onb'),
  '42501', 'not_authorised', 'and a caller with no identity cannot review at all — a review needs a reviewer');

-- ---------------------------------------------------------------------
-- 7 · Radar
-- ---------------------------------------------------------------------
-- The seed carries its own expiring and expired documents; this section
-- names rows, never counts.
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status, rtw_branch)
values ('c6000000-0000-4000-8000-000000000007', 96007, 'Tom', 'Radar', 'tr@cq.test', '+447700960007',
        date '1990-01-01', 'compliant', 'uk_irish');
insert into compliance_docs (id, staff_id, doc_type, uploaded_at, expiry_date, review_status) values
  ('c6100000-0000-4000-8000-0000000000d1', 'c6000000-0000-4000-8000-000000000007', 'passport',
   now() - interval '5 years', current_date + 7, 'verified');
insert into notification_outbox (key, channel, template, recipient_staff_id)
values ('N3:doc:c6100000-0000-4000-8000-0000000000d1', 'push', 'N3', 'c6000000-0000-4000-8000-000000000007');

select is((select state || ':' || days_left from compliance_radar_v
            where doc_id = 'c6100000-0000-4000-8000-0000000000d1'), 'expiring:7',
  '§4.1 Radar: a passport a week out is Expiring with 7 days left');
select isnt((select n3_at from compliance_radar_v where doc_id = 'c6100000-0000-4000-8000-0000000000d1'), null,
  'and shows the N3 rung the ladder actually queued');
select is((select n1_at from compliance_radar_v where doc_id = 'c6100000-0000-4000-8000-0000000000d1'), null,
  'and no rung that was never queued');
select is((select count(*)::int from compliance_radar_v where doc_id = :'d_pass_old'), 0,
  'a superseded-by-newer passport is not on the Radar: the latest verified one is what counts');

-- ---------------------------------------------------------------------
-- 8 · Nobody but the office reads the queue
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid')::text, true);
select is((select count(*)::int from compliance_review_queue_v), 0,
  'a client sees nothing in the queue (§11.1)');
select is((select count(*)::int from compliance_radar_v), 0, 'nor on the Radar');
reset role;

select * from finish();
rollback;
