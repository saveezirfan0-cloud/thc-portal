-- =====================================================================
-- 676 · The gov.uk check waits for an admin, and needs no provider
--   20260930150000_rtw_check_admin_confirms.sql · ADR-0041 (amends ADR-0025)
--
--   A. Defaults: gov.uk is the only route (no provider), and the admin
--      confirms every result.
--   B. The photo: filed on a running check, under the worker's own folder
--      only, service role only.
--   C. A pass waits: needs_review, recommendation verify, the document
--      still pending with gov.uk's date pre-filled, nothing verified; the
--      admin's Verify decides it and stamps the check reviewed.
--   D. "Not found" waits too: recommendation reject, the N8 text held
--      office-only, no N8 sent, the worker sees no reason; the admin's
--      Reject sends it.
--   E. No right to work: the same, with its own reason.
--   F. Settled status: recommendation verify, "no time limit".
--   G. Who reads the new columns.
--   H. GDPR removal owes the photo to the purge.
--
-- Every gov.uk result here is SYNTHETIC.
-- =====================================================================
begin;
select plan(42);
\ir _shared/fixtures.psql

\set u1 'c6760000-0000-4000-8000-0000000000a1'
\set w1 'c6760000-0000-4000-8000-000000000001'
\set w2 'c6760000-0000-4000-8000-000000000002'
\set w3 'c6760000-0000-4000-8000-000000000003'
\set w4 'c6760000-0000-4000-8000-000000000004'
\set d1 'c6770000-0000-4000-8000-000000000001'
\set d2 'c6770000-0000-4000-8000-000000000002'
\set d3 'c6770000-0000-4000-8000-000000000003'
\set d4 'c6770000-0000-4000-8000-000000000004'
\set w5 'c6760000-0000-4000-8000-000000000005'
\set d5 'c6770000-0000-4000-8000-000000000005'

select (now() at time zone 'Europe/London')::date as today \gset

insert into auth.users (id, email) values (:'u1', 'nina@rtw676.test');
insert into profiles (id, role, full_name) values (:'u1', 'staff', 'Nina Novak');

insert into staff (id, user_id, employee_id, first_name, last_name, email, phone, dob, status, rtw_branch, share_code) values
  (:'w1', null,  97601, 'Priya', 'Shah',  'priya@rtw676.test', '+447700967601', date '1994-02-02', 'compliant', 'work_visa',       'W67600001'),
  (:'w2', :'u1', 97602, 'Nina',  'Novak', 'nina@rtw676.test',  '+447700967602', date '1995-03-03', 'compliant', 'work_visa',       'W67600002'),
  (:'w3', null,  97603, 'Omar',  'Haddad','omar@rtw676.test',  '+447700967603', date '1992-04-04', 'compliant', 'dependant_other', 'W67600003'),
  (:'w4', null,  97604, 'Eva',   'Berg',  'eva@rtw676.test',   '+447700967604', date '1991-05-05', 'compliant', 'eu_settled',      'W67600004');

-- =====================================================================
-- A · Defaults
-- =====================================================================
select results_eq(
  $$ select rtw_check_config() ->> 'primary', rtw_check_config() -> 'fallback', (rtw_check_config() ->> 'admin_confirms')::boolean $$,
  $$ values ('govuk'::text, 'null'::jsonb, true) $$,
  'A: gov.uk is the only route — no provider — and the admin confirms every result');

update settings set value = value || '{"enabled": true}'::jsonb where key = 'rtw_check';
-- A malformed value is not a way to switch the review off: only JSON
-- false does that. Everything below runs with this string in place.
update settings set value = value || '{"admin_confirms": "off"}'::jsonb where key = 'rtw_check';

insert into compliance_docs (id, staff_id, doc_type, share_code, review_status, needs_manual_review, uploaded_at) values
  (:'d1', :'w1', 'share_code_report', 'W67600001', 'pending', true, clock_timestamp()),
  (:'d2', :'w2', 'share_code_report', 'W67600002', 'pending', true, clock_timestamp()),
  (:'d3', :'w3', 'share_code_report', 'W67600003', 'pending', true, clock_timestamp()),
  (:'d4', :'w4', 'share_code_report', 'W67600004', 'pending', true, clock_timestamp());

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
create temp table claimed on commit drop as select * from rtw_check_claim(10, 600);
select is((select count(*)::int from claimed where document_id in (:'d1', :'d2', :'d3', :'d4')), 4,
  'A: the four share codes are claimed');

select check_id as c1 from claimed where document_id = :'d1' \gset
select check_id as c2 from claimed where document_id = :'d2' \gset
select check_id as c3 from claimed where document_id = :'d3' \gset
select check_id as c4 from claimed where document_id = :'d4' \gset

-- =====================================================================
-- B · The photo
-- =====================================================================
select lives_ok(format($$ select rtw_check_attach_photo(%L, %L) $$, :'c1', :'w1' || '/share-code-report/rtw-check-c1-photo.png'),
  'B: the runner files the gov.uk photo on a running check');
select throws_like(format($$ select rtw_check_attach_photo(%L, %L) $$, :'c1', :'w2' || '/share-code-report/x-photo.png'),
  '%rtw_photo_path_invalid%', 'B: never under another worker''s folder');
select throws_like(format($$ select rtw_check_attach_photo(%L, %L) $$, :'c1', :'w1' || '/share-code-report/x.pdf'),
  '%rtw_photo_path_invalid%', 'B: and only a PNG');
insert into storage.objects (bucket_id, name) values
  ('documents', :'w1' || '/share-code-report/rtw-check-c1-photo.png'),
  ('documents', :'w1' || '/share-code-report/rtw-check-c1-a2-photo.png');
select is(evidence_path_discardable(:'w1', :'w1' || '/share-code-report/rtw-check-c1-photo.png'), false,
  'B: a worker cannot have the service key discard the filed photo (security review 26.09)');
select is(evidence_path_discardable(:'w1', :'w1' || '/share-code-report/rtw-check-c1-a2-photo.png'), false,
  'B: nor a runner file not yet filed');
select lives_ok(format($$ select rtw_check_attach_photo(%L, %L) $$, :'c1', :'w1' || '/share-code-report/rtw-check-c1-a2-photo.png'),
  'B: a later attempt''s photo replaces it');
select results_eq(
  format($$ select (select photo_path from rtw_checks where id = %L), (select count(*)::int from storage_deletions where path = %L) $$,
         :'c1', :'w1' || '/share-code-report/rtw-check-c1-photo.png'),
  format($$ values (%L::text, 1) $$, :'w1' || '/share-code-report/rtw-check-c1-a2-photo.png'),
  'B: and the replaced photo is owed to the purge, not left behind');
select ok(has_function_privilege('service_role', 'rtw_check_attach_photo(uuid,text)', 'execute')
      and not has_function_privilege('authenticated', 'rtw_check_attach_photo(uuid,text)', 'execute')
      and not has_function_privilege('anon', 'rtw_check_attach_photo(uuid,text)', 'execute'),
  'B: service role only');

-- =====================================================================
-- C · A pass waits for the admin
-- =====================================================================
select results_eq(
  format($$ select r ->> 'status', r ->> 'recommendation' from (select rtw_check_record(%L,
    jsonb_build_object('outcome', 'right_to_work', 'source', 'govuk', 'fullName', 'SHAH, Priya',
                       'rightToWorkUntil', %L, 'conditions', jsonb_build_array('No restrictions'),
                       'checkedAt', now()),
    jsonb_build_object('action', 'verify', 'rightToWorkUntil', %L, 'noTimeLimit', false),
    %L) r) x $$, :'c1', (:'today'::date + 400)::text, (:'today'::date + 400)::text,
    :'w1' || '/share-code-report/rtw-check-c1.pdf'),
  $$ values ('needs_review'::text, 'verify'::text) $$,
  'C: a clean pass is needs_review with the recommendation verify');
select results_eq(
  format($$ select review_status::text, right_to_work_until, gov_report_path from compliance_docs where id = %L $$, :'d1'),
  format($$ values ('pending'::text, null::date, %L::text) $$, :'w1' || '/share-code-report/rtw-check-c1.pdf'),
  'C: nothing is verified — the document is pending, the report on the profile, and gov.uk''s date NOT on the worker-readable document');
select is((select right_to_work_until from rtw_checks_latest_v where document_id = :'d1'), :'today'::date + 400,
  'C: the date waits on the check, where only the office reads it');
select ok((select review_reason ~ 'photo' from rtw_checks where id = :'c1'),
  'C: the office is told to compare the photo before verifying');
select is((select count(*)::int from audit_log where action = 'rtw_check.needs_review' and entity_id = :'d1'
            and data ->> 'recommendation' = 'verify'), 1, 'C: audited with its recommendation');
select is((select count(*)::int from audit_log where action = 'rtw.verified' and entity_id = :'d1'), 0,
  'C: and no automatic rtw.verified row');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(rtw_check_manual_allowed(:'d1'), true, 'C: the admin may decide it');
select is((compliance_verify_document(:'d1', null, null, :'today'::date + 400) ->> 'status'), 'compliant',
  'C: the admin verifies it through the one Verify');
reset role;
select results_eq(format($$ select review_status::text, reviewed_by from compliance_docs where id = %L $$, :'d1'),
  format($$ values ('verified'::text, %L::uuid) $$, :'admin_uid'),
  'C: verified, with the admin as the reviewer');
select ok((select reviewed_at is not null from rtw_checks where id = :'c1'),
  'C: and the check is stamped reviewed');

-- =====================================================================
-- D · "Not found" waits too
-- =====================================================================
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select results_eq(
  format($$ select r ->> 'status', r ->> 'recommendation' from (select rtw_check_record(%L,
    jsonb_build_object('outcome', 'not_found', 'source', 'govuk', 'checkedAt', now()),
    jsonb_build_object('action', 'reject',
                       'workerReason', 'gov.uk did not recognise this share code with your date of birth — check both and try again'),
    null) r) x $$, :'c2'),
  $$ values ('needs_review'::text, 'reject'::text) $$,
  'D: not_found is needs_review with the recommendation reject — never rejected automatically');
select is((select review_status::text from compliance_docs where id = :'d2'), 'pending', 'D: the document is still pending');
select ok((select review_reason ~ 'what the worker entered' and review_reason !~ 'report' from rtw_checks where id = :'c2'),
  'D: the office is pointed at the code and date of birth — gov.uk shows no report for a code it does not know');
select is((select count(*)::int from notification_outbox where key = 'N8:doc:' || :'d2'), 0, 'D: no N8 has gone out');
select results_eq(format($$ select worker_reason, suggested_reason from rtw_checks where id = %L $$, :'c2'),
  $$ values (null::text, 'gov.uk did not recognise this share code with your date of birth — check both and try again'::text) $$,
  'D: the N8 text waits, office-only, to pre-fill the Reject box');

select set_config('request.jwt.claims', json_build_object('sub', :'u1', 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq($$ select status, outcome, worker_reason from my_rtw_checks() $$,
  $$ values ('needs_review'::text, null::text, null::text) $$,
  'D: the worker sees the check is with the office — no outcome and no reason yet');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(format($$ select compliance_reject_document(%L, %L) $$, :'d2',
                       'gov.uk did not recognise this share code with your date of birth — check both and try again'),
  'D: the admin rejects it with the pre-filled reason');
reset role;
select is((select payload ->> 'reason' from notification_outbox where key = 'N8:doc:' || :'d2'),
  'gov.uk did not recognise this share code with your date of birth — check both and try again',
  'D: and only now does N8 carry it to the worker');

-- =====================================================================
-- E · No right to work
-- =====================================================================
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select results_eq(
  format($$ select r ->> 'status', r ->> 'recommendation' from (select rtw_check_record(%L,
    jsonb_build_object('outcome', 'no_right_to_work', 'source', 'govuk', 'fullName', 'HADDAD, Omar', 'checkedAt', now()),
    jsonb_build_object('action', 'reject', 'workerReason', 'gov.uk does not show a current right to work. Please contact the office.',
                       'officeReason', 'gov.uk returned NO right to work for this share code. The worker has been asked to re-enter it; do not roster them on this evidence — read the report and contact them.'),
    %L) r) x $$, :'c3', :'w3' || '/share-code-report/rtw-check-c3.pdf'),
  $$ values ('needs_review'::text, 'reject'::text) $$,
  'E: no right to work is needs_review, recommendation reject');
select ok((select review_reason ~* 'no right to work' and review_reason !~ 're-enter' and suggested_reason is not null and worker_reason is null
             from rtw_checks where id = :'c3'),
  'E: the office reason is the database''s — never the runner''s "asked to re-enter", which would be false — and the N8 text is held back');
select is((select review_status::text from compliance_docs where id = :'d3'), 'pending', 'E: nothing rejected');

-- =====================================================================
-- F · Settled status
-- =====================================================================
select results_eq(
  format($$ select r ->> 'status', r ->> 'recommendation' from (select rtw_check_record(%L,
    jsonb_build_object('outcome', 'right_to_work', 'source', 'govuk', 'fullName', 'BERG, Eva',
                       'rightToWorkUntil', null, 'conditions', jsonb_build_array('No restrictions'), 'checkedAt', now()),
    jsonb_build_object('action', 'verify', 'rightToWorkUntil', null, 'noTimeLimit', true),
    %L) r) x $$, :'c4', :'w4' || '/share-code-report/rtw-check-c4.pdf'),
  $$ values ('needs_review'::text, 'verify'::text) $$,
  'F: settled status waits for the admin too');
select ok((select review_reason ~ 'no time limit' from rtw_checks where id = :'c4'),
  'F: and says "no time limit"');

-- =====================================================================
-- F2 · A retry drops the earlier attempt's photo
-- =====================================================================
reset role;
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status, rtw_branch, share_code)
values (:'w5', 97605, 'Tom', 'Reyes', 'tom@rtw676.test', '+447700967605', date '1990-06-06', 'compliant', 'work_visa', 'W67600005');
insert into compliance_docs (id, staff_id, doc_type, share_code, review_status, needs_manual_review, uploaded_at)
values (:'d5', :'w5', 'share_code_report', 'W67600005', 'pending', true, clock_timestamp());
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select check_id as c5 from rtw_check_claim(10, 600) where document_id = :'d5' \gset
select rtw_check_attach_photo(:'c5', :'w5' || '/share-code-report/rtw-check-c5-a1-photo.png');
select is(rtw_check_record(:'c5',
    jsonb_build_object('outcome', 'error', 'source', 'govuk', 'error', 'govuk_timeout', 'checkedAt', now()),
    jsonb_build_object('action', 'retry', 'error', 'govuk_timeout')) ->> 'status', 'queued',
  'F2: an error is retried');
select results_eq(
  format($$ select (select photo_path from rtw_checks where id = %L),
                   (select count(*)::int from storage_deletions where path = %L) $$,
         :'c5', :'w5' || '/share-code-report/rtw-check-c5-a1-photo.png'),
  $$ values (null::text, 1) $$,
  'F2: and its photo is dropped and owed to the purge, so it never sits beside a later result');
select throws_like(format($$ select rtw_check_attach_photo(%L, %L) $$, :'c5', :'w5' || '/share-code-report/rtw-check-c5-a2-photo.png'),
  '%rtw_check_not_running%', 'F2: a photo is filed only on a running check');

-- =====================================================================
-- G · Who reads the new columns
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq(
  format($$ select recommendation, photo_path from rtw_checks_latest_v where document_id = %L $$, :'d1'),
  format($$ values ('verify'::text, %L::text) $$, :'w1' || '/share-code-report/rtw-check-c1-a2-photo.png'),
  'G: the office reads the recommendation and the photo path');
select is((select suggested_reason from rtw_checks_latest_v where document_id = :'d3'),
  'gov.uk does not show a current right to work. Please contact the office.', 'G: and the suggested reason');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'u1', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from rtw_checks_latest_v), 0, 'G: a worker reads none of it');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from rtw_checks_latest_v), 0, 'G: nor does a client');
reset role;

-- =====================================================================
-- H · GDPR removal
-- =====================================================================
select remove_worker(:'w1');
select is((select count(*)::int from rtw_checks where staff_id = :'w1'), 0, 'H: the worker''s checks are gone');
select is((select count(*)::int from storage_deletions
            where bucket = 'documents' and path = :'w1' || '/share-code-report/rtw-check-c1-a2-photo.png'), 1,
  'H: and the gov.uk photo is owed to the purge');

select * from finish();
rollback;
