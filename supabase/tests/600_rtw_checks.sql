-- =====================================================================
-- 600 · The automated gov.uk share-code check
--   20260928090000_rtw_checks.sql · ADR-0025
--
--   A. The switch: the rtw-check job ships disabled, and while it is
--      disabled nothing is queued.
--   B. The queue: a share code from the Documents hub
--      (submit_document_upload) and one in the shape the wizard's step 4
--      inserts (onboarding_submit_documents) each queue exactly one check;
--      a second check for the same submission is refused; a replaced
--      submission's check is cancelled.
--   C. The runner: claim (share code + DOB out, running, attempt counted),
--      record (never the inputs in `result`, date pre-filled on the still
--      pending document, report on gov_report_path, audit row without the
--      inputs), fail (5 then 10 minutes, the third is final), and a
--      finished check cannot be recorded twice.
--   D. "Run check again": admin only, pending only, idempotent while
--      queued, resets a failed check.
--   E. RLS: admin reads; a worker reads nothing directly and exactly
--      status / outcome / checkedAt through my_rtw_check(); a client reads
--      nothing; anon is refused.
--   F. Grants: the runner's functions are service_role only; every
--      definer function added here pins its search_path.
--   G. GDPR: remove_worker() takes the check rows and queues their files.
-- =====================================================================
begin;
select plan(49);
\ir _shared/fixtures.psql

\set d_hub    'c6000000-0000-4000-8000-000000000001'
\set d_wiz    'c6000000-0000-4000-8000-000000000002'
\set d_wiz2   'c6000000-0000-4000-8000-000000000003'
\set d_off    'c6000000-0000-4000-8000-000000000004'

update staff set rtw_branch = 'work_visa', share_code = 'W60000001' where id = :'staffa';
update staff set rtw_branch = 'international_student', share_code = 'W60000002' where id = :'staffb';

-- ---------------------------------------------------------------------
-- A · The switch
-- ---------------------------------------------------------------------
select is((select enabled from job_schedules where job = 'rtw-check'), false,
  'A: the rtw-check job is registered, and registered disabled');

insert into compliance_docs (id, staff_id, doc_type, share_code, needs_manual_review, review_status)
values (:'d_off', :'staffb', 'share_code_report', 'W60000002', true, 'pending');
select is((select count(*)::int from rtw_checks where document_id = :'d_off'), 0,
  'A: while the job is disabled a share code queues nothing (the office checks by hand)');
update compliance_docs set review_status = 'superseded' where id = :'d_off';

update job_schedules set enabled = true where job = 'rtw-check';

-- ---------------------------------------------------------------------
-- B · The queue
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((submit_document_upload('share_code_report', null, 'w12 3ab 4cd') ->> 'ok'), 'true',
  'B: the worker submits a share code from the Documents hub');
reset role;

select is((select count(*)::int from rtw_checks c join compliance_docs d on d.id = c.document_id
            where d.staff_id = :'staffa' and d.doc_type = 'share_code_report'), 1,
  'B: the Documents hub submission queued exactly one check');
select is((select status from rtw_checks where staff_id = :'staffa'), 'queued',
  'B: and it is queued');

-- The wizard's step 4 (onboarding_submit_documents, 20260923120000):
-- supersede any pending share code row, then insert this one.
insert into compliance_docs (id, staff_id, doc_type, share_code, needs_manual_review, review_status, uploaded_at)
values (:'d_wiz', :'staffb', 'share_code_report', 'W60000002', true, 'pending', clock_timestamp());
select is((select count(*)::int from rtw_checks where document_id = :'d_wiz'), 1,
  'B: a wizard submission queued exactly one check');

select throws_ok(
  format($$ insert into rtw_checks (staff_id, document_id) values (%L, %L) $$, :'staffb', :'d_wiz'),
  '23505', null, 'B: a second check for the same submission is refused');

update compliance_docs set review_status = 'superseded' where id = :'d_wiz';
select is((select status from rtw_checks where document_id = :'d_wiz'), 'cancelled',
  'B: a replaced submission''s queued check is cancelled');
insert into compliance_docs (id, staff_id, doc_type, share_code, needs_manual_review, review_status, uploaded_at)
values (:'d_wiz2', :'staffb', 'share_code_report', 'W60000002', true, 'pending', clock_timestamp());
select is((select count(*)::int from rtw_checks where staff_id = :'staffb' and status = 'queued'), 1,
  'B: the resubmission is queued once');

select id as d_hub_id from compliance_docs
 where staff_id = :'staffa' and doc_type = 'share_code_report' and review_status = 'pending' \gset
select id as c_a from rtw_checks where document_id = :'d_hub_id' \gset
select id as c_b from rtw_checks where document_id = :'d_wiz2' \gset

-- Only these two are due; other suites' rows would sort by time, so the
-- claim is pinned to them by pushing everything else out of reach.
update rtw_checks set next_attempt_at = now() + interval '1 day'
 where id not in (:'c_a', :'c_b') and status = 'queued';
update rtw_checks set next_attempt_at = now() - interval '2 minutes' where id = :'c_a';
update rtw_checks set next_attempt_at = now() - interval '1 minute'  where id = :'c_b';

-- ---------------------------------------------------------------------
-- C · The runner
-- ---------------------------------------------------------------------
set local role service_role;
create temp table claimed on commit drop as select * from claim_rtw_check();
reset role;

select is((select check_id from claimed), :'c_a'::uuid, 'C: claim takes the longest-due check');
select is((select share_code from claimed), 'W123AB4CD',
  'C: the claim hands the runner the normalised share code');
select is((select dob from claimed), date '1995-01-01', 'C: and the date of birth');
select is((select status || '/' || attempts from rtw_checks where id = :'c_a'), 'running/1',
  'C: the claimed check is running, on attempt 1');

set local role service_role;
select throws_ok(
  format($$ select record_rtw_check(%L, 'pass', '{"shareCode":"W123AB4CD"}'::jsonb, 'Staff Alpha', %L::date) $$,
         :'c_a', (current_date + 400)::text),
  '23514', null, 'C: a result carrying the share code is refused by the table');
select throws_ok(
  format($$ select record_rtw_check(%L, 'pass', '{"dob":"1995-01-01"}'::jsonb, 'Staff Alpha', %L::date) $$,
         :'c_a', (current_date + 400)::text),
  '23514', null, 'C: so is one carrying the date of birth');
select throws_like(
  format($$ select record_rtw_check(%L, 'pass', '{}'::jsonb, 'Staff Alpha', null) $$, :'c_a'),
  '%pass_needs_a_date%', 'C: a pass without a date or "no time limit" is refused');
select is((record_rtw_check(:'c_a', 'pass',
            '{"status":"permission","conditions":"No restrictions"}'::jsonb,
            'STAFF ALPHA', current_date + 400, false, 'No restrictions',
            'share-code-report/a/check.pdf', 'share-code-report/a/check-photo.png') ->> 'ok'), 'true',
  'C: the runner records a pass');
reset role;

select is((select status || '/' || outcome from rtw_checks where id = :'c_a'), 'done/pass',
  'C: the check is done, outcome pass');
select is((select review_status::text from compliance_docs where id = :'d_hub_id'), 'pending',
  'C: the document is NOT verified — the office confirms it');
select is((select right_to_work_until from compliance_docs where id = :'d_hub_id'), current_date + 400,
  'C: the gov.uk right-to-work-until is pre-filled on the document');
select is((select gov_report_path from compliance_docs where id = :'d_hub_id'), 'share-code-report/a/check.pdf',
  'C: the report is on gov_report_path, where the office''s Open report link reads it');
select ok((select data::text not like '%W123AB4CD%' and data::text not like '%1995-01-01%'
             from audit_log where action = 'rtw.checked' and entity_id = :'d_hub_id'),
  'C: the audit row is written and carries neither the share code nor the date of birth');

set local role service_role;
select throws_like(
  format($$ select record_rtw_check(%L, 'not_found') $$, :'c_a'),
  '%not_running%', 'C: a finished check cannot be recorded again');

select is((select check_id from claim_rtw_check()), :'c_b'::uuid, 'C: the next claim takes the other check');
select is((fail_rtw_check(:'c_b', 'gov.uk timed out') ->> 'status'), 'queued', 'C: a first failure is retried');
reset role;
select ok((select next_attempt_at between now() + interval '4 minutes' and now() + interval '6 minutes'
             from rtw_checks where id = :'c_b'), 'C: after 5 minutes');
update rtw_checks set next_attempt_at = now() - interval '1 second' where id = :'c_b';
set local role service_role;
select is((select check_id from claim_rtw_check()), :'c_b'::uuid, 'C: claimed again when due');
select is((select check_id from claim_rtw_check()), null, 'C: and nothing else is due, so a second claim gets nothing');
select is((fail_rtw_check(:'c_b', 'gov.uk timed out') ->> 'status'), 'queued', 'C: a second failure is retried too');
reset role;
select ok((select next_attempt_at between now() + interval '9 minutes' and now() + interval '11 minutes'
             from rtw_checks where id = :'c_b'), 'C: after 10 minutes');
update rtw_checks set next_attempt_at = now() - interval '1 second' where id = :'c_b';
set local role service_role;
select is((select check_id from claim_rtw_check()), :'c_b'::uuid, 'C: claimed a third time');
select is((fail_rtw_check(:'c_b', 'gov.uk timed out') ->> 'status'), 'failed',
  'C: the third failure is final — the document is left for a manual check');
reset role;

-- ---------------------------------------------------------------------
-- D · "Run check again"
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_like(format($$ select rerun_rtw_check(%L) $$, :'d_wiz2'),
  '%not_authorised%', 'D: a worker cannot run the check again');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((rerun_rtw_check(:'d_wiz2') ->> 'alreadyQueued'), 'false', 'D: an admin re-runs a failed check');
select is((rerun_rtw_check(:'d_wiz2') ->> 'alreadyQueued'), 'true', 'D: pressing it again while queued queues nothing more');
select throws_like(format($$ select rerun_rtw_check(%L) $$, :'doc_a'),
  '%not_a_share_code%', 'D: only a share code report can be checked');
reset role;
select is((select status || '/' || attempts || '/' || (requested_by = :'admin_uid')::text from rtw_checks where id = :'c_b'),
  'queued/0/true', 'D: the failed check is queued again from attempt 0, stamped with the admin');

-- ---------------------------------------------------------------------
-- E · RLS
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from rtw_checks where id in (:'c_a', :'c_b')), 2, 'E: an admin reads the checks');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from rtw_checks), 0, 'E: a worker reads nothing from the table, not even their own row');
select is((select array_agg(k order by k) from jsonb_object_keys(my_rtw_check()) k),
  array['checkedAt', 'outcome', 'status'], 'E: through my_rtw_check() a worker gets status, outcome and the date, nothing else');
select is((my_rtw_check() ->> 'status') || '/' || (my_rtw_check() ->> 'outcome'), 'done/pass',
  'E: and it is their own check');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from rtw_checks), 0, 'E: a client reads nothing');
select is(my_rtw_check(), null::jsonb, 'E: and has no check of their own to read');
reset role;

set local role anon;
select throws_ok($$ select count(*) from rtw_checks $$, '42501', null, 'E: anon is refused the table');
reset role;

-- ---------------------------------------------------------------------
-- F · Grants
-- ---------------------------------------------------------------------
select is_empty(
  $$ select p.proname::text || ':' || r.rolname
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'), ('authenticated')) r(rolname)
      where n.nspname = 'public'
        and p.proname in ('claim_rtw_check', 'record_rtw_check', 'fail_rtw_check', 'rtw_check_enabled',
                          'rtw_check_enqueue', 'rtw_check_cancel_decided', 'rtw_check_queue_files')
        and has_function_privilege(r.rolname, p.oid, 'execute') $$,
  'F: neither anon nor a signed-in user can run the runner''s functions or the triggers');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('claim_rtw_check', 'record_rtw_check', 'fail_rtw_check')
      and has_function_privilege('service_role', p.oid, 'execute')),
  3, 'F: the service role can run all three');
select is_empty(
  $$ select p.proname::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and (p.proname like '%rtw_check%')
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') $$,
  'F: every security definer function this feature added pins its search_path');

-- ---------------------------------------------------------------------
-- G · GDPR removal
-- ---------------------------------------------------------------------
select remove_worker(:'staffa');
select is((select count(*)::int from rtw_checks where staff_id = :'staffa'), 0,
  'G: removing the worker removes their check rows');
select is((select count(*)::int from storage_deletions
            where bucket = 'documents'
              and path in ('share-code-report/a/check.pdf', 'share-code-report/a/check-photo.png')), 2,
  'G: and queues both the report and the gov.uk photo for deletion');

select * from finish();
rollback;
