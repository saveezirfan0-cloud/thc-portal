-- =====================================================================
-- 600 · The automated gov.uk right-to-work check
--   20260928100000_rtw_check.sql · ADR-0025
--
--   A. Off by default: filing a share code queues nothing, and the office
--      verifies it by hand exactly as before (ADR-0018).
--   B. On: every path that files a share code queues one check; while it
--      runs the document is not in Needs review and the office's manual
--      Verify is refused (rtw_check_required).
--   C. The claim hands the share code and date of birth to the service role
--      only; a document that left review is failed instead.
--   D. not_found → the document is rejected through the office's Reject
--      (N8 with the worker's reason); the candidate re-enters with their
--      date of birth; settled status passes through the office's Verify
--      with a system actor, no time limit, the report on the profile.
--   E. A dated pass sets the worker's right-to-work date.
--   F. no_right_to_work → rejected AND a needs-review item of its own,
--      cleared by Mark reviewed.
--   G. Errors back off (30 min …) and the last attempt goes to the office,
--      where the hand-typed date is allowed again.
--   H. A name mismatch waits for the office with gov.uk's date pre-filled;
--      Run check again; a pass Verify refuses becomes needs_review.
--   I. Guards: the share code never reaches rtw_checks, illegal
--      transitions, grants, who reads what.
--   J. GDPR removal takes the checks and owes their reports to the purge.
--
-- Every gov.uk / provider result here is SYNTHETIC (ADR-0025).
-- =====================================================================
begin;
select plan(108);
\ir _shared/fixtures.psql

\set u1 'c6000000-0000-4000-8000-0000000000a1'
\set w1 'c6000000-0000-4000-8000-000000000001'
\set w2 'c6000000-0000-4000-8000-000000000002'
\set w3 'c6000000-0000-4000-8000-000000000003'
\set w4 'c6000000-0000-4000-8000-000000000004'
\set w5 'c6000000-0000-4000-8000-000000000005'
\set d0 'c6010000-0000-4000-8000-000000000000'
\set d1 'c6010000-0000-4000-8000-000000000001'
\set d3 'c6010000-0000-4000-8000-000000000003'
\set d4 'c6010000-0000-4000-8000-000000000004'
\set d5 'c6010000-0000-4000-8000-000000000005'
\set d6 'c6010000-0000-4000-8000-000000000006'

select (now() at time zone 'Europe/London')::date as today \gset

insert into auth.users (id, email) values (:'u1', 'marta@rtw600.test');
insert into profiles (id, role, full_name) values (:'u1', 'staff', 'Marta Villanueva');

insert into staff (id, user_id, employee_id, first_name, last_name, email, phone, dob, status, rtw_branch, share_code) values
  (:'w1', :'u1', null,  'Marta', 'Villanueva', 'marta@rtw600.test', '+447700960001', date '1996-05-05', 'documents', 'eu_settled',            'W60000001'),
  (:'w2', null,  96002, 'Priya', 'Shah',       'priya@rtw600.test', '+447700960002', date '1994-02-02', 'compliant', 'work_visa',             'W60000003'),
  (:'w3', null,  96003, 'Ben',   'Tran',       'ben@rtw600.test',   '+447700960003', date '1993-03-03', 'compliant', 'eu_settled',            'W60000004'),
  (:'w4', null,  96004, 'Hana',  'Kato',       'hana@rtw600.test',  '+447700960004', date '2003-04-04', 'compliant', 'international_student', 'W60000005'),
  (:'w5', null,  96005, 'Olu',   'Ade',        'olu@rtw600.test',   '+447700960005', date '1990-05-05', 'compliant', 'dependant_other',       'W60000006');

insert into onboarding_progress (staff_id, rtw_at, address_at, selfie_at, documents_at, updated_at)
values (:'w1', now(), now(), now(), now(), now());

-- =====================================================================
-- A · Off by default
-- =====================================================================
select is(rtw_check_enabled(), false, 'A: the automated check ships switched off');
insert into compliance_docs (id, staff_id, doc_type, share_code, review_status, needs_manual_review, uploaded_at)
values (:'d0', :'w1', 'share_code_report', 'W60000001', 'pending', true, clock_timestamp());
select is((select count(*)::int from rtw_checks where compliance_doc_id = :'d0'), 0,
  'A: off, filing a share code queues no check');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select is(rtw_check_manual_allowed(:'d0'), true, 'A: off, the office may verify it by hand (ADR-0018)');
select is((select count(*)::int from compliance_review_queue_v where item_id = :'d0'), 1,
  'A: and it is in Needs review as before');
select is((select count(*)::int from rtw_check_claim(10, 600)), 0, 'A: off, the claim hands out nothing');
update compliance_docs set review_status = 'superseded' where id = :'d0';

-- =====================================================================
-- B · On: queued on filing, not the office's while it runs
-- =====================================================================
update settings set value = value || '{"enabled": true}'::jsonb where key = 'rtw_check';
select is(rtw_check_enabled(), true, 'B: switched on through settings.rtw_check.enabled');

insert into compliance_docs (id, staff_id, doc_type, share_code, review_status, needs_manual_review, uploaded_at) values
  (:'d1', :'w1', 'share_code_report', 'W60000001', 'pending', true, clock_timestamp()),
  (:'d3', :'w2', 'share_code_report', 'W60000003', 'pending', true, clock_timestamp()),
  (:'d4', :'w3', 'share_code_report', 'W60000004', 'pending', true, clock_timestamp()),
  (:'d5', :'w4', 'share_code_report', 'W60000005', 'pending', true, clock_timestamp()),
  (:'d6', :'w5', 'share_code_report', 'W60000006', 'pending', true, clock_timestamp());

select results_eq(
  format($$ select count(*)::int, min(status), min(attempts), max(max_attempts)
              from rtw_checks where compliance_doc_id in (%L, %L, %L, %L, %L) $$,
         :'d1', :'d3', :'d4', :'d5', :'d6'),
  $$ values (5, 'queued'::text, 0, 5) $$,
  'B: each share code filed queues exactly one check, five attempts');
select is(rtw_check_enqueue(:'d1', null), (select id from rtw_checks where compliance_doc_id = :'d1'),
  'B: enqueueing again returns the check already open — one in flight per document');
select throws_ok(format($$ insert into rtw_checks (staff_id, compliance_doc_id) values (%L, %L) $$, :'w1', :'d1'),
  '23505', null, 'B: and the table refuses a second open check outright');

select is((select count(*)::int from compliance_review_queue_v where item_id = :'d1'), 0,
  'B: a share code whose check is running is not in Needs review');
select throws_like(format($$ select compliance_verify_document(%L, null, null, %L::date) $$, :'d3', :'today'::date + 300),
  '%rtw_check_required%', 'B: nor can the office type a date on it while the automation owns it');

select set_config('request.jwt.claims', json_build_object('sub', :'u1', 'role', 'authenticated')::text, true);
select results_eq($$ select status, outcome from my_rtw_checks() $$,
  $$ values ('queued'::text, null::text) $$,
  'B: the worker sees their own check, queued');

-- =====================================================================
-- C · The claim
-- =====================================================================
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
create temp table claimed on commit drop as select * from rtw_check_claim(10, 600);
select is((select count(*)::int from claimed), 5, 'C: the service role claims the five due checks');
select results_eq(
  format($$ select share_code, date_of_birth, first_name, rtw_branch, attempt from claimed where document_id = %L $$, :'d1'),
  $$ values ('W60000001'::text, date '1996-05-05', 'Marta'::text, 'eu_settled'::text, 1) $$,
  'C: with the share code, date of birth, name and branch for this run');
select is((select count(*)::int from rtw_checks where status = 'running' and lease_until > now()
            and compliance_doc_id in (select document_id from claimed)), 5,
  'C: each is running under a lease');
select is((select count(*)::int from rtw_check_claim(10, 600)), 0, 'C: a leased check is not handed out twice');

-- =====================================================================
-- D · not_found → re-enter → settled status passes
-- =====================================================================
select is(
  rtw_check_record(
    (select check_id from claimed where document_id = :'d1'),
    jsonb_build_object('outcome', 'not_found', 'source', 'provider', 'fullName', null,
                       'rightToWorkUntil', null, 'conditions', '[]'::jsonb,
                       'checkedAt', now()),
    jsonb_build_object('action', 'reject',
                       'workerReason', 'gov.uk did not recognise this share code with your date of birth — check both and try again')
  ) ->> 'status', 'rejected', 'D: not_found is recorded as rejected');
select results_eq(format($$ select review_status::text, reviewed_by, rejection_reason from compliance_docs where id = %L $$, :'d1'),
  $$ values ('rejected'::text, null::uuid, 'gov.uk did not recognise this share code with your date of birth — check both and try again'::text) $$,
  'D: the document is rejected through the office''s Reject, by the system (no reviewer)');
select is((select payload ->> 'reason' from notification_outbox where key = 'N8:doc:' || :'d1'),
  'gov.uk did not recognise this share code with your date of birth — check both and try again',
  'D: N8 goes to the worker with that reason');
select is((select count(*)::int from audit_log where action = 'rtw_check.rejected' and entity_id = :'d1' and actor is null), 1,
  'D: audited as the automatic check');

select set_config('request.jwt.claims', json_build_object('sub', :'u1', 'role', 'authenticated')::text, true);
select results_eq($$ select status, outcome, worker_reason from my_rtw_checks() $$,
  $$ values ('rejected'::text, 'not_found'::text, 'gov.uk did not recognise this share code with your date of birth — check both and try again'::text) $$,
  'D: the worker reads the outcome and the reason, nothing else');
select throws_like($$ select onboarding_reenter_share_code('W123', null) $$, '%bad_share_code%',
  'D: a malformed code is refused');
select throws_like($$ select onboarding_reenter_share_code('W60 000 002', date '2015-01-01') $$, '%under_18%',
  'D: an under-18 date of birth is refused');
select is(onboarding_reenter_share_code('w60 000 002', date '1996-06-06') ->> 'ok', 'true',
  'D: the candidate re-enters the code and corrects their date of birth');
select throws_like($$ select onboarding_reenter_share_code('W60000002', null) $$, '%already_pending%',
  'D: not twice while the new one is in review');
reset role;
select results_eq(format($$ select dob, share_code from staff where id = %L $$, :'w1'),
  $$ values (date '1996-06-06', 'W60000002'::text) $$, 'D: the new date of birth and code are on the profile');
select results_eq(
  format($$ select data ->> 'dobBefore', data ->> 'dobAfter' from audit_log
             where action = 'document.uploaded' and data ->> 'staffId' = %L and data ->> 'source' = 'onboarding_reenter' $$, :'w1'),
  $$ values ('1996-05-05'::text, '1996-06-06'::text) $$,
  'D: the change of date of birth is audited with the previous one (QA 25.09)');
select is((select count(*)::int from rtw_checks c join compliance_docs d on d.id = c.compliance_doc_id
            where d.staff_id = :'w1' and d.share_code = 'W60000002' and c.status = 'queued'), 1,
  'D: and the new code is queued for the check');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
create temp table claim2 on commit drop as select * from rtw_check_claim(10, 600);
select is((select count(*)::int from claim2), 1, 'D: the re-entered code is claimed');
select is(
  rtw_check_record(
    (select check_id from claim2),
    jsonb_build_object('outcome', 'right_to_work', 'source', 'govuk', 'fullName', 'VILLANUEVA, Marta',
                       'rightToWorkUntil', null,
                       'conditions', jsonb_build_array('No restrictions'),
                       'referenceNumber', 'SYNTH-600-D', 'checkedAt', now()),
    jsonb_build_object('action', 'verify', 'rightToWorkUntil', null, 'noTimeLimit', true),
    :'w1' || '/share-code-report/rtw-check-d.pdf') ->> 'status',
  'passed', 'D: settled status passes');
select results_eq(
  format($$ select review_status::text, reviewed_by, rtw_no_time_limit, right_to_work_until, gov_report_path
              from compliance_docs where id = (select document_id from claim2) $$),
  format($$ values ('verified'::text, null::uuid, true, null::date, %L::text) $$, :'w1' || '/share-code-report/rtw-check-d.pdf'),
  'D: verified by the one Verify with a system actor — no time limit, the report on the profile');
select is((select data ->> 'actorName' from audit_log where action = 'rtw.verified'
            and entity_id = (select document_id from claim2)), 'Automatic gov.uk check',
  'D: the rtw.verified audit row names the automatic check');
select is((select count(*)::int from audit_log where action = 'rtw_check.passed'
            and entity_id = (select document_id from claim2)), 1, 'D: and the pass is audited');
select is((select result ->> 'fullName' from rtw_checks where id = (select check_id from claim2)), 'VILLANUEVA, Marta',
  'D: the result keeps gov.uk''s name for the office');

-- =====================================================================
-- E · A dated pass sets the worker's right-to-work date
-- =====================================================================
select is(
  rtw_check_record(
    (select check_id from claimed where document_id = :'d4'),
    jsonb_build_object('outcome', 'right_to_work', 'source', 'provider', 'fullName', 'Ben Tran',
                       'rightToWorkUntil', (:'today'::date + 400)::text, 'conditions', '[]'::jsonb,
                       'checkedAt', now()),
    jsonb_build_object('action', 'verify', 'rightToWorkUntil', (:'today'::date + 400)::text, 'noTimeLimit', false),
    :'w3' || '/share-code-report/rtw-check-e.pdf') ->> 'status',
  'passed', 'E: pre-settled status with a date passes');
select is((select right_to_work_until from staff where id = :'w3'), :'today'::date + 400,
  'E: that date is the worker''s right to work until — the expiry the ladder and the hard stop use');
select throws_like(
  format($$ select rtw_check_record(%L, '{"outcome":"right_to_work","source":"provider","rightToWorkUntil":"2030-01-01"}'::jsonb,
                                   '{"action":"verify","rightToWorkUntil":"2030-01-01"}'::jsonb) $$,
         (select check_id from claimed where document_id = :'d4')),
  '%rtw_check_not_running%', 'E: a finished check cannot be recorded again');

-- =====================================================================
-- F · no_right_to_work: rejected AND the office's
-- =====================================================================
select is(
  rtw_check_record(
    (select check_id from claimed where document_id = :'d5'),
    jsonb_build_object('outcome', 'no_right_to_work', 'source', 'provider', 'fullName', 'Hana Kato',
                       'conditions', '[]'::jsonb, 'checkedAt', now()),
    jsonb_build_object('action', 'reject',
                       'workerReason', 'gov.uk says this share code does not give the right to work in the UK — check the code, or speak to the office',
                       'officeReason', 'gov.uk returned NO right to work for this share code.'),
    :'w4' || '/share-code-report/rtw-check-f.pdf') ->> 'status',
  'needs_review', 'F: no right to work is rejected and kept for the office');
select is((select review_status::text from compliance_docs where id = :'d5'), 'rejected',
  'F: the worker is asked to re-enter (N8)');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select results_eq(
  format($$ select kind, item_type, rtw_check_status, rtw_check_reason from compliance_review_queue_v
             where staff_id = %L $$, :'w4'),
  $$ values ('rtw_check'::text, 'share_code_report'::text, 'needs_review'::text, 'gov.uk returned NO right to work for this share code.'::text) $$,
  'F: Needs review carries it as an item of its own, with the reason');
select is(rtw_check_mark_reviewed((select check_id from claimed where document_id = :'d5')) ->> 'reviewed', 'true',
  'F: the office marks it reviewed');
select is((select count(*)::int from compliance_review_queue_v where staff_id = :'w4'), 0,
  'F: and it leaves the queue');
select is((select count(*)::int from audit_log where action = 'rtw_check.reviewed' and entity_id = :'d5' and actor = :'admin_uid'), 1,
  'F: audited with the manager as actor');

-- =====================================================================
-- G · Errors back off; the last attempt goes to the office
-- =====================================================================
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(
  rtw_check_record(
    (select check_id from claimed where document_id = :'d3'),
    jsonb_build_object('outcome', 'error', 'source', 'govuk', 'error', 'timeout', 'checkedAt', now()),
    jsonb_build_object('action', 'retry', 'error', 'timeout'), null, 'Timeout for W60000003') ->> 'status',
  'queued', 'G: a failed attempt goes back in the queue');
select results_eq(
  format($$ select attempts, error, next_attempt_at between now() + interval '29 minutes' and now() + interval '31 minutes'
              from rtw_checks where compliance_doc_id = %L $$, :'d3'),
  $$ values (1, 'timeout_for_share_code'::text, true) $$,
  'G: after 30 minutes, with an error that has had the share code taken out of it');
select is((select count(*)::int from rtw_check_claim(10, 600) where document_id = :'d3'), 0,
  'G: not before its time');

update rtw_checks set next_attempt_at = now() - interval '1 minute', attempts = 4 where compliance_doc_id = :'d3';
create temp table claim3 on commit drop as select * from rtw_check_claim(10, 600);
select is((select attempt from claim3 where document_id = :'d3'), 5, 'G: the fifth attempt');
select is(
  rtw_check_record(
    (select check_id from claim3 where document_id = :'d3'),
    jsonb_build_object('outcome', 'error', 'source', 'provider', 'error', 'http_503', 'checkedAt', now()),
    jsonb_build_object('action', 'retry', 'error', 'http_503')) ->> 'status',
  'needs_review', 'G: fails too, and the office decides — the attempt limit is the database''s');
select results_eq(format($$ select review_status::text, needs_manual_review from compliance_docs where id = %L $$, :'d3'),
  $$ values ('pending'::text, true) $$, 'G: the document waits for the office, flagged');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select results_eq(
  format($$ select kind, rtw_check_status, rtw_manual_allowed, rtw_check_reason like '%%after 5 attempts (http_503)%%'
              from compliance_review_queue_v where item_id = %L $$, :'d3'),
  $$ values ('document'::text, 'needs_review'::text, true, true) $$,
  'G: in Needs review with the reason, the hand-typed date allowed again');
select is(compliance_verify_document(:'d3', null, null, :'today'::date + 300) ->> 'verified', 'true',
  'G: the office verifies it by hand (ADR-0018)');
select is((select right_to_work_until from staff where id = :'w2'), :'today'::date + 300,
  'G: and the worker''s date follows');
select is((select count(*)::int from compliance_review_queue_v where staff_id = :'w2'), 0,
  'G: and nothing is left in Needs review — no false "no right to work" item (QA 25.09)');
select results_eq(
  format($$ select reviewed_by, reviewed_at is not null from rtw_checks where compliance_doc_id = %L $$, :'d3'),
  format($$ values (%L::uuid, true) $$, :'admin_uid'),
  'G: the hand Verify answered the waiting check (reviewed_by, reviewed_at)');

-- =====================================================================
-- H · Name mismatch; Run check again; a pass Verify refuses
-- =====================================================================
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(
  rtw_check_record(
    (select check_id from claimed where document_id = :'d6'),
    jsonb_build_object('outcome', 'right_to_work', 'source', 'provider', 'fullName', 'SOMEONE ELSE',
                       'rightToWorkUntil', (:'today'::date + 200)::text, 'conditions', '[]'::jsonb,
                       'checkedAt', now()),
    jsonb_build_object('action', 'needs_review',
                       'officeReason', 'The name on the gov.uk record does not match the name on the profile.'),
    :'w5' || '/share-code-report/rtw-check-h.pdf') ->> 'status',
  'needs_review', 'H: a name mismatch is never verified');
select results_eq(format($$ select review_status::text, right_to_work_until, gov_report_path is not null from compliance_docs where id = %L $$, :'d6'),
  format($$ values ('pending'::text, %L::date, true) $$, :'today'::date + 200),
  'H: pending, with gov.uk''s date pre-filled for the office to confirm and the report attached');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select throws_ok(format($$ select rtw_check_request(%L) $$, :'d6'), '42501', 'not_authorised',
  'H: a worker cannot run the check again');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select is(rtw_check_request(:'d6') ->> 'queued', 'true', 'H: the office runs the check again');
select throws_like(format($$ select rtw_check_request(%L) $$, :'d6'), '%rtw_check_running%',
  'H: not while it is running');
select is((select count(*)::int from rtw_checks where compliance_doc_id = :'d6'), 2,
  'H: a new row — each run keeps its own record');
select is((select count(*)::int from compliance_review_queue_v where item_id = :'d6'), 0,
  'H: and the document leaves the queue while it runs');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
create temp table claim4 on commit drop as select * from rtw_check_claim(10, 600);
select is(
  rtw_check_record(
    (select check_id from claim4 where document_id = :'d6'),
    jsonb_build_object('outcome', 'right_to_work', 'source', 'provider', 'fullName', 'Olu Ade',
                       'rightToWorkUntil', :'today'::text, 'conditions', '[]'::jsonb, 'checkedAt', now()),
    jsonb_build_object('action', 'verify', 'rightToWorkUntil', :'today'::text),
    :'w5' || '/share-code-report/rtw-check-h2.pdf') ->> 'status',
  'needs_review', 'H: a pass the one Verify refuses (already expired) goes to the office, not through');
select is((select review_reason from rtw_checks where id = (select check_id from claim4 where document_id = :'d6')),
  'gov.uk passed the check but Verify refused it (already_expired). Check the report and verify by hand.',
  'H: saying why');
select is((select review_status::text from compliance_docs where id = :'d6'), 'pending',
  'H: and the document is untouched by the refused Verify');

savepoint h_reject;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select is(compliance_reject_document(:'d6', 'Please send a new code') ->> 'rejected', 'true',
  'H: the office rejects it by hand instead');
select is((select count(*)::int from compliance_review_queue_v where staff_id = :'w5'), 0,
  'H: which leaves no item behind: the check is answered, and it was not a no-right-to-work');
select is((select count(*)::int from rtw_checks where compliance_doc_id = :'d6'
            and status = 'needs_review' and reviewed_at is null), 0,
  'H: every needs-review check on the document is stamped reviewed');
rollback to savepoint h_reject;

savepoint h_narrow;
-- Decided behind the functions' back (no stamp): the narrowed branch still
-- shows nothing, because the outcome was not no_right_to_work.
update compliance_docs set review_status = 'rejected', rejection_reason = 'x' where id = :'d6';
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select is((select count(*)::int from compliance_review_queue_v where kind = 'rtw_check' and staff_id = :'w5'), 0,
  'H: the rtw_check item is only ever a no-right-to-work result');
rollback to savepoint h_narrow;

-- =====================================================================
-- I · Guards
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select is(rtw_check_request(:'d6') ->> 'queued', 'true', 'I: queue one more to test the guards on');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
create temp table claim5 on commit drop as select * from rtw_check_claim(10, 600);
select throws_like(
  format($$ select rtw_check_record(%L, '{"outcome":"not_found","source":"provider","referenceNumber":"ref W60000006"}'::jsonb,
                                   '{"action":"reject","workerReason":"x"}'::jsonb) $$,
         (select check_id from claim5 where document_id = :'d6')),
  '%rtw_result_carries_share_code%', 'I: a result carrying the share code is refused outright');
select throws_like(
  format($$ select rtw_check_record(%L, '{"outcome":"not_found","source":"provider"}'::jsonb,
                                   '{"action":"verify","rightToWorkUntil":"2030-01-01"}'::jsonb) $$,
         (select check_id from claim5 where document_id = :'d6')),
  '%rtw_decision_inconsistent%', 'I: a verify needs a right_to_work result');
select throws_like(
  format($$ select rtw_check_record(%L, '{"outcome":"right_to_work","source":"provider","rightToWorkUntil":"2031-01-01"}'::jsonb,
                                   '{"action":"verify","rightToWorkUntil":"2030-01-01"}'::jsonb) $$,
         (select check_id from claim5 where document_id = :'d6')),
  '%rtw_decision_inconsistent%', 'I: …with the date gov.uk returned, not another');
select throws_like(
  format($$ select rtw_check_record(%L, '{"outcome":"not_found","source":"provider"}'::jsonb,
                                   '{"action":"reject","workerReason":"x"}'::jsonb, 'someone-else/share-code-report/x.pdf') $$,
         (select check_id from claim5 where document_id = :'d6')),
  '%rtw_report_path_invalid%', 'I: the report must be under the worker''s own folder');
select is(
  rtw_check_record(
    (select check_id from claim5 where document_id = :'d6'),
    jsonb_build_object('outcome', 'right_to_work', 'source', 'provider', 'fullName', 'Olu Ade',
                       'rightToWorkUntil', (:'today'::date + 300)::text, 'conditions', '[]'::jsonb),
    jsonb_build_object('action', 'verify', 'rightToWorkUntil', (:'today'::date + 300)::text)) ->> 'status',
  'queued', 'I: a pass with no report stored is not complete (§2.6): it is retried');
select results_eq(
  format($$ select c.error, d.review_status::text from rtw_checks c join compliance_docs d on d.id = c.compliance_doc_id
             where c.id = %L $$, (select check_id from claim5 where document_id = :'d6')),
  $$ values ('report_missing'::text, 'pending'::text) $$,
  'I: saying why, with the document untouched');
select throws_like(
  format($$ update rtw_checks set status = 'queued' where id = %L $$, (select check_id from claimed where document_id = :'d4')),
  '%illegal_rtw_check_transition%', 'I: a passed check cannot be re-queued (terminal)');
select throws_like(
  format($$ insert into rtw_checks (staff_id, compliance_doc_id, status) values (%L, %L, 'passed') $$, :'w3', :'d4'),
  '%illegal_rtw_check_transition%', 'I: nothing inserts a finished check');
select throws_ok(
  format($$ update rtw_checks set result = '{"shareCode":"W60000004"}' where id = %L $$, (select check_id from claimed where document_id = :'d4')),
  '23514', null, 'I: and the table itself refuses a shareCode key');
select is((select count(*)::int from rtw_checks where result::text ilike '%W6000000%'), 0,
  'I: no share code anywhere in rtw_checks.result');

select ok(has_function_privilege('service_role', 'rtw_check_claim(int,int)', 'execute')
      and not has_function_privilege('authenticated', 'rtw_check_claim(int,int)', 'execute')
      and not has_function_privilege('anon', 'rtw_check_claim(int,int)', 'execute'),
  'I: only the service role can claim (it hands out share codes and dates of birth)');
select ok(has_function_privilege('service_role', 'rtw_check_record(uuid,jsonb,jsonb,text,text)', 'execute')
      and not has_function_privilege('authenticated', 'rtw_check_record(uuid,jsonb,jsonb,text,text)', 'execute'),
  'I: only the service role can record');
select ok(not has_function_privilege('authenticated', 'compliance_verify_document_as(uuid,uuid,date,daterange[],date)', 'execute')
      and not has_function_privilege('service_role', 'compliance_verify_document_as(uuid,uuid,date,daterange[],date)', 'execute')
      and not has_function_privilege('authenticated', 'compliance_reject_document_as(uuid,uuid,text)', 'execute'),
  'I: the reviewer-as-argument bodies are internal');

-- Who reads what.
select check_id as c5 from claim5 where document_id = :'d6' \gset
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select ok((select count(*) from rtw_checks where staff_id in (:'w1', :'w3')) >= 3, 'I: the office reads rtw_checks');
select ok((select count(*) from rtw_checks_latest_v where staff_id = :'w3') = 1, 'I: and the latest-per-document view');
select throws_ok(format($$ update rtw_checks set status = 'failed' where id = %L $$, :'c5'),
  '42501', null, 'I: but writes nothing to it directly');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'u1', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from rtw_checks), 0, 'I: a worker reads no rtw_checks rows (their status comes through my_rtw_checks)');
select is(rtw_check_manual_allowed(:'d6'), null::boolean,
  'I: rtw_check_manual_allowed answers a worker nothing (admin and service role only)');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from rtw_checks), 0, 'I: a client reads nothing');
select is((select count(*)::int from my_rtw_checks()), 0, 'I: and has no checks of their own');
reset role;

-- =====================================================================
-- K · A check the runner never runs surfaces after stale_after_minutes
-- =====================================================================
update rtw_checks set next_attempt_at = now() - interval '2 hours' where id = :'c5';
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
update settings set value = value || '{"stale_after_minutes": 180}'::jsonb where key = 'rtw_check';
select is((select count(*)::int from compliance_review_queue_v where item_id = :'d6'), 0,
  'K: due for 2 hours with a 3-hour threshold: still the runner''s');
update settings set value = value || '{"stale_after_minutes": 60}'::jsonb where key = 'rtw_check';
select results_eq(
  format($$ select kind, rtw_check_status, rtw_manual_allowed,
                   rtw_check_reason like 'The automatic gov.uk check has not run for over 60 minutes%%'
              from compliance_review_queue_v where item_id = %L $$, :'d6'),
  $$ values ('document'::text, 'queued'::text, true, true) $$,
  'K: past 60 minutes it is in Needs review, saying why, with the hand-typed date allowed');
select is((select stuck from rtw_checks_latest_v where check_id = :'c5'), true, 'K: the office''s view marks it stuck');
select is(compliance_verify_document(:'d6', null, null, :'today'::date + 200) ->> 'verified', 'true',
  'K: the office verifies it by hand');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((select count(*)::int from rtw_check_claim(10, 600) where document_id = :'d6'), 0,
  'K: when the runner comes back it does not run it');
select results_eq(format($$ select status, error from rtw_checks where id = %L $$, :'c5'),
  $$ values ('failed'::text, 'document_not_pending'::text) $$, 'K: it is stopped instead');

-- =====================================================================
-- L · Re-entry is capped per 24 hours
-- =====================================================================
\set u6 'c6000000-0000-4000-8000-0000000000a6'
\set w6 'c6000000-0000-4000-8000-000000000006'
insert into auth.users (id, email) values (:'u6', 'kofi@rtw600.test');
insert into profiles (id, role, full_name) values (:'u6', 'staff', 'Kofi Mensah');
insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, rtw_branch, share_code) values
  (:'w6', :'u6', 'Kofi', 'Mensah', 'kofi@rtw600.test', '+447700960006', date '1995-06-06', 'documents', 'eu_settled', 'W60000060');
insert into onboarding_progress (staff_id, rtw_at, address_at, selfie_at, documents_at, updated_at)
values (:'w6', now(), now(), now(), now(), now());
insert into compliance_docs (staff_id, doc_type, share_code, review_status, rejection_reason, uploaded_at)
values (:'w6', 'share_code_report', 'W60000060', 'rejected', 'not recognised', clock_timestamp());
update settings set value = value || '{"reenter_per_day": 1}'::jsonb where key = 'rtw_check';
select set_config('request.jwt.claims', json_build_object('sub', :'u6', 'role', 'authenticated')::text, true);
select is(onboarding_reenter_share_code('W60000061', null) ->> 'ok', 'true', 'L: the first re-entry of the day');
select is((select count(*)::int from audit_log where data ->> 'staffId' = :'w6' and data ? 'dobBefore'), 0,
  'L: no date of birth in the audit when it did not change');
reset role;
update compliance_docs set review_status = 'rejected', rejection_reason = 'not recognised'
 where staff_id = :'w6' and review_status = 'pending';
select set_config('request.jwt.claims', json_build_object('sub', :'u6', 'role', 'authenticated')::text, true);
select throws_like($$ select onboarding_reenter_share_code('W60000062', null) $$, '%too_many_attempts%',
  'L: the second is refused (settings.rtw_check.reenter_per_day)');
reset role;

-- =====================================================================
-- M · Restated on main's latest bodies (merge of 26.09 main)
-- =====================================================================
select is(
  (select array_agg(attname::text order by attnum) from pg_attribute
    where attrelid = 'compliance_review_queue_v'::regclass and attnum > 0
      and attname in ('size_bytes', 'review_reason', 'rtw_check_id', 'rtw_manual_allowed')),
  array['size_bytes', 'review_reason', 'rtw_check_id', 'rtw_manual_allowed'],
  'M: the queue keeps 20260927160000''s review_reason where the live view has it, the check columns after');
select ok(pg_get_viewdef('compliance_review_queue_v'::regclass) like '%rtw_date%',
  'M: and keeps its rtw_date row');
savepoint m_held;
update compliance_docs set retain_until = :'today'::date + 700 where id = :'d4';
update rtw_checks set report_path = :'w3' || '/share-code-report/rtw-check-held.pdf'
 where compliance_doc_id = :'d4';
select ok(:'w3' || '/share-code-report/rtw-check-held.pdf' in (select retained_storage_paths(:'w3')),
  'M: a held document keeps its checks'' reports out of the prefix purge (retained_storage_paths)');
rollback to savepoint m_held;
select ok(pg_get_functiondef('install_job_schedules()'::regprocedure) like '%edge_base_url()%',
  'M: install_job_schedules still reads the edge base through edge_base_url() (20260927160300)');

-- =====================================================================
-- J · GDPR removal
-- =====================================================================
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok(format($$ select remove_worker(%L) $$, :'w4'), 'J: the student is removed');
select is((select count(*)::int from rtw_checks where staff_id = :'w4'), 0,
  'J: their checks go with their documents (§1.7)');
select is((select count(*)::int from storage_deletions where path = :'w4' || '/share-code-report/rtw-check-f.pdf'), 1,
  'J: and the gov.uk report is owed to the Storage purge');
select lives_ok(format($$ select remove_worker(%L) $$, :'w1'), 'J: the candidate who changed their date of birth is removed');
select is((select count(*)::int from audit_log where data ->> 'staffId' = :'w1' and (data ? 'dobBefore' or data ? 'dobAfter')), 0,
  'J: and the audit trail forgets their dates of birth (§1.7)');
select is((select count(*)::int from audit_log where data ->> 'staffId' = :'w1' and data ->> 'source' = 'onboarding_reenter'), 1,
  'J: while keeping the fact of the re-entry');

select * from finish();
rollback;
