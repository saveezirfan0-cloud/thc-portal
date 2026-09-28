-- =====================================================================
-- 717 · Date of birth corrections (ADR-0069)
--   20261001209000_date_of_birth_corrections.sql
--
--   A. Shape: the three new RPCs are authenticated-only definers; the rule
--      and the effect are granted to nobody; kind 'dob' is allowed and
--      shaped; office_can('identity') is owner + manager only.
--   B. The rule: dob_change_problem() agrees with dobChangeProblem() on
--      every `dobs` vector (changeRequest.vectors.json).
--   C. office_correct_dob — who: owner and manager yes; scheduler
--      not_permitted, viewer read_only, a worker, a client and anon no.
--   D. office_correct_dob — refusals: no-op, future, under 18, missing,
--      the reason (required, ≥ 10, ≤ 300), unknown and removed profiles.
--   E. office_correct_dob — effect: staff.dob, the staff.dob_corrected
--      audit row (dates under `dob`, reason, actorName), and the gov.uk
--      check of a pending share code: re-queued, superseding a finished
--      needs_review check in rtw_checks_latest_v; left alone while
--      running; 'off' with the check switched off; 'none' without one.
--   F. Under 18 and the opt-out: a correction moving the eighteenth
--      birthday past the opt-out's signature is flagged, not refused.
--   G. submit_share_code_with_dob: a changed date written and audited as
--      the worker with the share code filed; a refused date files
--      nothing; an unchanged one is not audited; the 24 h cap.
--   H. Request a change → date of birth: request_dob_change's refusals,
--      RC1's payload, the worker's read; a scheduler and a viewer cannot
--      decide it; a manager approves → dob written, RC2, audit, no RC4.
--   I. §1.7: removal turns a requested date into 1900-01-01 and strips
--      the dates from the audit rows about the worker.
-- =====================================================================
begin;
select plan(85);
\ir _shared/fixtures.psql
\ir _shared/change_request_vectors.psql

\set manager   '71700000-0000-4000-8000-000000000001'
\set scheduler '71700000-0000-4000-8000-000000000002'
\set viewer    '71700000-0000-4000-8000-000000000003'
\set doc_b     '71710000-0000-4000-8000-000000000001'
\set chk_old   '71720000-0000-4000-8000-000000000001'
\set w_opt     '71730000-0000-4000-8000-000000000001'
\set w_gone    '71730000-0000-4000-8000-000000000002'

select (now() at time zone 'Europe/London')::date as today \gset
select ((now() at time zone 'Europe/London')::date - interval '17 years')::date as minor \gset
select ((now() at time zone 'Europe/London')::date + 1) as tomorrow \gset

insert into auth.users (id, email) values
  (:'manager',   'manager.717@rls.test'),
  (:'scheduler', 'scheduler.717@rls.test'),
  (:'viewer',    'viewer.717@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'manager',   'admin', 'manager',   'Mona Manager'),
  (:'scheduler', 'admin', 'scheduler', 'Sam Scheduler'),
  (:'viewer',    'admin', 'viewer',    'Vera Viewer');

-- Both fixture workers are on a visa: a share code is theirs to file.
update staff set rtw_branch = 'work_visa' where id in (:'staffa', :'staffb');

-- A worker who signed the 48-hour opt-out ten days ago, and a removed one.
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status,
                   wtr_optout, wtr_optout_signed_at) values
  (:'w_opt', 97171, 'Olu', 'Opted', 'olu@dob717.test', '+447700971701', date '1990-01-01',
   'compliant', true, now() - interval '10 days');
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status, removed_at) values
  (:'w_gone', 97172, 'Deleted', 'account', 'gone@dob717.test', '+447700971702', date '1900-01-01',
   'removed', now());

-- Staff Bravo's share code is with the office: gov.uk said "not found"
-- (needs_review), because the date of birth on file is wrong. Filed with
-- the check off, so the insert trigger queues nothing; the finished check
-- is written as the runner would leave it.
insert into compliance_docs (id, staff_id, doc_type, share_code, review_status, needs_manual_review, uploaded_at)
values (:'doc_b', :'staffb', 'share_code_report', 'W71700001', 'pending', true, clock_timestamp());
insert into rtw_checks (id, staff_id, compliance_doc_id) values (:'chk_old', :'staffb', :'doc_b');
update rtw_checks set status = 'running' where id = :'chk_old';
update rtw_checks set status = 'needs_review', outcome = 'not_found', finished_at = now() where id = :'chk_old';
update settings set value = value || '{"enabled": true}'::jsonb where key = 'rtw_check';

insert into storage.objects (bucket_id, name, metadata) values
  ('documents', :'staffb' || '/change-requests/dob-1.pdf', '{"mimetype":"application/pdf","size":2048}'),
  ('documents', :'staffa' || '/change-requests/dob-a.pdf', '{"mimetype":"application/pdf","size":2048}');

-- =====================================================================
-- A · Shape
-- =====================================================================
select ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=public, extensions'])
     from pg_proc p
    where p.oid in ('public.office_correct_dob(uuid, date, text)'::regprocedure,
                    'public.submit_share_code_with_dob(text, date, text)'::regprocedure,
                    'public.request_dob_change(date, text, text)'::regprocedure,
                    'public.staff_dob_apply(uuid, date, uuid, text, jsonb, boolean)'::regprocedure)),
  'A: the three routes and the effect are security definer with a fixed search_path');
select ok(
  has_function_privilege('authenticated', 'public.office_correct_dob(uuid, date, text)', 'execute')
  and has_function_privilege('authenticated', 'public.submit_share_code_with_dob(text, date, text)', 'execute')
  and has_function_privilege('authenticated', 'public.request_dob_change(date, text, text)', 'execute'),
  'A: a signed-in session may call the three routes (each checks its caller)');
select ok(
  not has_function_privilege('anon', 'public.office_correct_dob(uuid, date, text)', 'execute')
  and not has_function_privilege('anon', 'public.submit_share_code_with_dob(text, date, text)', 'execute')
  and not has_function_privilege('anon', 'public.request_dob_change(date, text, text)', 'execute')
  and not has_function_privilege('public', 'public.office_correct_dob(uuid, date, text)', 'execute'),
  'A: anon and public may not');
select ok(
  not has_function_privilege('authenticated', 'public.staff_dob_apply(uuid, date, uuid, text, jsonb, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.staff_dob_apply(uuid, date, uuid, text, jsonb, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.dob_change_problem(date, date, date)', 'execute'),
  'A: the effect and the rule are internal — granted to no API role');
select lives_ok(
  format($$ insert into profile_change_requests (staff_id, kind, proposed_dob, evidence_path)
            values (%L, 'dob', date '1990-01-01', %L) $$, :'w_opt', :'w_opt' || '/change-requests/x.pdf'),
  'A: kind ''dob'' is allowed, with its date and its evidence');
select throws_ok(
  format($$ insert into profile_change_requests (staff_id, kind, proposed_dob)
            values (%L, 'dob', date '1990-01-01') $$, :'staffa'),
  '23514', null, 'A: a dob request without evidence is refused by the table');
select throws_ok(
  format($$ insert into profile_change_requests (staff_id, kind, proposed_photo_path, proposed_dob)
            values (%L, 'photo', %L, date '1990-01-01') $$, :'staffa', :'staffa' || '/p.jpg'),
  '23514', null, 'A: only a dob request carries a date');
select throws_ok(
  format($$ update profile_change_requests set proposed_dob = date '1991-01-01' where staff_id = %L $$, :'w_opt'),
  'P0001', 'change_request_immutable', 'A: the requested date is immutable, like the other proposed values');
delete from profile_change_requests where staff_id = :'w_opt';

create temp table perms (who text, identity boolean, write boolean);
grant all on perms to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into perms select 'owner', office_can('identity'), office_can('write');
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
insert into perms select 'manager', office_can('identity'), office_can('write');
select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
insert into perms select 'scheduler', office_can('identity'), office_can('write');
select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
insert into perms select 'viewer', office_can('identity'), office_can('write');
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
insert into perms select 'worker', office_can('identity'), office_can('write');
reset role;
select results_eq(
  $$ select who, identity, write from perms order by who $$,
  $$ values ('manager'::text, true, true), ('owner', true, true), ('scheduler', false, true),
            ('viewer', false, false), ('worker', false, false) $$,
  'A: office_can(''identity'') is owner and manager only; ''write'' is unchanged');

-- =====================================================================
-- B · The rule, held to the shared vectors
-- =====================================================================
select is((select count(*)::int from change_request_dob_vectors), :change_request_dob_count,
  'B: every dobs vector is loaded');
select is_empty(
  $$ select name from change_request_dob_vectors
      where dob_change_problem(input, current_dob, today) is distinct from refusal $$,
  'B: dob_change_problem() agrees with dobChangeProblem() on every case');
select is(dob_change_problem(:'minor'::date, date '1995-01-01'), 'under_18',
  'B: p_today defaults to today in UK time');

-- =====================================================================
-- C · office_correct_dob — who may
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select office_correct_dob(%L, date '1994-12-31', 'Passport shows 31 December') $$, :'staffa'),
  '42501', 'not_permitted', 'C: a scheduler is refused (ADR-0056: identity is owner and manager)');
select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
select throws_ok(
  format($$ select office_correct_dob(%L, date '1994-12-31', 'Passport shows 31 December') $$, :'staffa'),
  '42501', 'read_only', 'C: a viewer is told it is read-only (ADR-0060)');
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select throws_ok(
  format($$ select office_correct_dob(%L, date '1994-12-31', 'Passport shows 31 December') $$, :'staffa'),
  '42501', 'not_authorised', 'C: a worker cannot correct even their own');
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select throws_ok(
  format($$ select office_correct_dob(%L, date '1994-12-31', 'Passport shows 31 December') $$, :'staffa'),
  '42501', 'not_authorised', 'C: a client cannot');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  format($$ select office_correct_dob(%L, date '1994-12-31', 'Passport shows 31 December') $$, :'staffa'),
  '42501', null, 'C: anon cannot execute it at all');
reset role;
select is((select dob from staff where id = :'staffa'), date '1995-01-01',
  'C: none of them changed anything');

-- =====================================================================
-- D · office_correct_dob — refusals (as the owner)
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select office_correct_dob(%L, date '1995-01-01', 'Passport shows the same date') $$, :'staffa'),
  'P0001', 'unchanged', 'D: the date already on file is a no-op, refused');
select throws_ok(
  format($$ select office_correct_dob(%L, %L::date, 'Typo in the office') $$, :'staffa', :'tomorrow'),
  'P0001', 'dob_invalid', 'D: a date in the future');
select throws_ok(
  format($$ select office_correct_dob(%L, date '1920-01-01', 'Typo in the office') $$, :'staffa'),
  'P0001', 'dob_invalid', 'D: more than 100 years ago');
select throws_ok(
  format($$ select office_correct_dob(%L, %L::date, 'Birth certificate says so') $$, :'staffa', :'minor'),
  'P0001', 'under_18', 'D: under 18 is refused out loud, as /apply does');
select throws_ok(
  format($$ select office_correct_dob(%L, null, 'Birth certificate says so') $$, :'staffa'),
  'P0001', 'dob_required', 'D: no date');
select throws_ok(
  format($$ select office_correct_dob(%L, date '1994-12-31', '   ') $$, :'staffa'),
  '22023', 'reason_required', 'D: a reason is required');
select throws_ok(
  format($$ select office_correct_dob(%L, date '1994-12-31', 'typo') $$, :'staffa'),
  '22023', 'reason_too_short', 'D: and says something (10 characters at least)');
select throws_ok(
  format($$ select office_correct_dob(%L, date '1994-12-31', %L) $$, :'staffa', repeat('r', 301)),
  '22023', 'reason_too_long', 'D: at most 300 characters');
select throws_ok(
  $$ select office_correct_dob('71799999-0000-4000-8000-000000000000', date '1994-12-31', 'Passport shows 31 December') $$,
  'P0002', 'staff_not_found', 'D: an unknown profile');
select throws_ok(
  format($$ select office_correct_dob(%L, date '1994-12-31', 'Passport shows 31 December') $$, :'w_gone'),
  'P0001', 'staff_removed', 'D: a removed (GDPR-anonymised) profile gets nothing personal back');
reset role;
select is((select count(*)::int from audit_log where action = 'staff.dob_corrected'), 0,
  'D: nothing refused was audited');

-- =====================================================================
-- E · office_correct_dob — the effect
-- =====================================================================
-- E1 · Staff Bravo: the owner corrects it; the not-found check is re-run.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table res_e1 as
  select office_correct_dob(:'staffb', date '1994-02-20', 'Passport shows 20 February, not 2 February') as r;
reset role;
select is((select dob from staff where id = :'staffb'), date '1994-02-20', 'E: staff.dob is corrected');
select is((select r ->> 'rtwCheck' from res_e1), 'queued', 'E: the pending share code''s check is queued again');
select results_eq(
  format($$ select check_id, status, requested_by from rtw_checks_latest_v where document_id = %L $$, :'doc_b'),
  format($$ select (r ->> 'checkId')::uuid, 'queued'::text, %L::uuid from res_e1 $$, :'admin_uid'),
  'E: the new check supersedes the needs_review one in rtw_checks_latest_v, requested by the manager');
select is((select status from rtw_checks where id = :'chk_old'), 'needs_review',
  'E: the finished check is kept as it was (history)');
select results_eq(
  format($$ select actor, entity, data -> 'dob', data ->> 'reason', data ->> 'source', data ->> 'actorName',
                   data ->> 'rtwCheck', data ->> 'documentId'
              from audit_log where action = 'staff.dob_corrected' and entity_id = %L $$, :'staffb'),
  format($$ values (%L::uuid, 'staff'::text, '{"from": "1994-02-02", "to": "1994-02-20"}'::jsonb,
                    'Passport shows 20 February, not 2 February'::text, 'office'::text, 'Gisela M.'::text,
                    'queued'::text, %L::text) $$, :'admin_uid', :'doc_b'),
  'E: audited staff.dob_corrected — from/to under dob, the reason, the manager by name');
select ok((select not (r ? 'optOutSignedUnder18') from res_e1), 'E: no opt-out, no flag');

-- E2 · The check is running (claimed with the old date): left alone.
update rtw_checks set status = 'running' where id = (select (r ->> 'checkId')::uuid from res_e1);
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  office_correct_dob(:'staffb', date '1994-02-21', 'Second look at the passport') ->> 'rtwCheck', 'running',
  'E: a manager may correct too; a running check is reported, not duplicated');
reset role;
select is((select count(*)::int from rtw_checks where compliance_doc_id = :'doc_b'), 2,
  'E: still two checks on the document');

-- E3 · The check switched off: checked by hand, so nothing to queue.
update rtw_checks set status = 'needs_review', finished_at = now()
 where id = (select (r ->> 'checkId')::uuid from res_e1);
update settings set value = value || '{"enabled": false}'::jsonb where key = 'rtw_check';
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  office_correct_dob(:'staffb', date '1994-02-22', 'Third look at the passport') ->> 'rtwCheck', 'off',
  'E: with the check off, nothing is queued');
-- E4 · No pending share code: nothing to re-run.
select is(
  office_correct_dob(:'staffa', date '1994-12-31', 'Passport shows 31 December 1994') ->> 'rtwCheck', 'none',
  'E: without a pending share code, nothing to re-run');
reset role;
update settings set value = value || '{"enabled": true}'::jsonb where key = 'rtw_check';
select is((select dob from staff where id = :'staffa'), date '1994-12-31', 'E: Staff Alpha corrected too');

-- =====================================================================
-- F · Under 18 and the 48-hour opt-out
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select ok(
  not (office_correct_dob(:'w_opt', date '1989-05-05', 'Birth certificate: 5 May 1989') ? 'optOutSignedUnder18'),
  'F: an older date leaves the opt-out alone');
create temp table res_f as
  select office_correct_dob(:'w_opt', (:'today'::date - interval '18 years' - interval '5 days')::date,
                            'Passport: eighteen five days ago') as r;
reset role;
select is((select (r ->> 'optOutSignedUnder18')::boolean from res_f), true,
  'F: an eighteenth birthday after the signature is flagged');
select is(
  (select (data ->> 'optOutSignedUnder18')::boolean from audit_log
    where action = 'staff.dob_corrected' and entity_id = :'w_opt' and data ->> 'reason' like 'Passport:%'),
  true, 'F: and the flag is on the audit row');
select is((select wtr_optout from staff where id = :'w_opt'), true,
  'F: the signature is not revoked here — cancelling is the worker''s, with notice');

-- =====================================================================
-- G · The Documents hub: New share code with the date of birth
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  submit_share_code_with_dob('WAB123CDE', :'minor'::date),
  '{"ok": false, "reason": "under_18"}'::jsonb,
  'G: an under-18 date is refused');
select is(submit_share_code_with_dob('WAB123CDE', :'tomorrow'::date) ->> 'reason', 'dob_invalid',
  'G: a date in the future is refused');
reset role;
select is((select count(*)::int from compliance_docs where staff_id = :'staffa' and doc_type = 'share_code_report'), 0,
  'G: and a refused date files nothing');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table res_g as select submit_share_code_with_dob('wab 123 cde', date '1995-06-15') as r;
reset role;
select results_eq(
  $$ select (r ->> 'ok')::boolean, r ->> 'status', (r ->> 'dobChanged')::boolean from res_g $$,
  $$ values (true, 'pending'::text, true) $$,
  'G: the share code is filed, pending, with the date changed');
select is((select dob from staff where id = :'staffa'), date '1995-06-15', 'G: staff.dob is written');
select results_eq(
  format($$ select share_code, review_status::text from compliance_docs
             where id = (select (r ->> 'documentId')::uuid from res_g) $$),
  $$ values ('WAB123CDE'::text, 'pending'::text) $$,
  'G: submit_document_upload() filed it exactly as before');
select results_eq(
  format($$ select actor, data -> 'dob', data ->> 'source', data ->> 'documentId'
              from audit_log where action = 'staff.dob_changed_with_share_code' and entity_id = %L $$, :'staffa'),
  format($$ select %L::uuid, '{"from": "1994-12-31", "to": "1995-06-15"}'::jsonb, 'staff_app'::text,
                   r ->> 'documentId' from res_g $$, :'staffa_uid'),
  'G: audited as the worker, with the document it came with');
select is(
  (select count(*)::int from audit_log where action = 'document.uploaded'
      and entity_id = (select (r ->> 'documentId')::uuid from res_g)),
  1, 'G: and the upload has its own audit row, as every hub upload does');

-- The cap: with one date change a day, the next is refused before anything else.
update settings set value = value || '{"reenter_per_day": 1}'::jsonb where key = 'rtw_check';
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(submit_share_code_with_dob('WAB123CDF', date '1995-06-16') ->> 'reason', 'too_many_attempts',
  'G: at most reenter_per_day date changes in 24 hours');
select is(submit_share_code_with_dob('WAB123CDF', date '1995-06-15') ->> 'reason', 'already_pending',
  'G: the same date is no change: the hub''s own rules answer (one pending share code)');
reset role;
update settings set value = value - 'reenter_per_day' where key = 'rtw_check';
select is(
  (select count(*)::int from audit_log where action = 'staff.dob_changed_with_share_code' and entity_id = :'staffa'),
  1, 'G: neither was audited');
-- A manual hold is not eligible, whatever the date says.
update staff set status = 'blocked', block_kind = 'manual', block_reason = 'Held by the office' where id = :'staffb';
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(submit_share_code_with_dob('WAB123CDE', :'minor'::date) ->> 'reason', 'not_eligible',
  'G: a manual hold is told it is not eligible, not about the date');
reset role;
update staff set status = 'compliant', block_kind = null, block_reason = null where id = :'staffb';

-- =====================================================================
-- H · Request a change → date of birth (Staff Bravo)
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select request_dob_change(null, %L) $$, :'staffb' || '/change-requests/dob-1.pdf'),
  'P0001', 'dob_required', 'H: a date is required');
select throws_ok(
  format($$ select request_dob_change(date '1994-02-22', %L) $$, :'staffb' || '/change-requests/dob-1.pdf'),
  'P0001', 'unchanged', 'H: the date on file is no change');
select throws_ok(
  format($$ select request_dob_change(%L::date, %L) $$, :'minor', :'staffb' || '/change-requests/dob-1.pdf'),
  'P0001', 'under_18', 'H: under 18');
select throws_ok(
  $$ select request_dob_change(date '1990-07-07', null) $$,
  'P0001', 'evidence_required', 'H: evidence is required, as for a name');
select throws_ok(
  format($$ select request_dob_change(date '1990-07-07', %L) $$, :'staffa' || '/change-requests/dob-a.pdf'),
  'P0001', null, 'H: and it must be the worker''s own upload');
select throws_ok(
  $$ select request_profile_change('dob') $$,
  'P0001', 'bad_kind', 'H: request_profile_change() still takes only name or photo');
create temp table res_h as
  select request_dob_change(date '1990-07-07', :'staffb' || '/change-requests/dob-1.pdf', 'Passport attached') as r;
grant select on res_h to authenticated;
select throws_ok(
  format($$ select request_dob_change(date '1990-07-08', %L) $$, :'staffb' || '/change-requests/dob-1.pdf'),
  'P0001', 'already_pending', 'H: one pending date-of-birth request');
select results_eq(
  $$ select kind, status, proposed_dob from my_profile_change_requests() where kind = 'dob' $$,
  $$ values ('dob'::text, 'pending'::text, date '1990-07-07') $$,
  'H: the worker reads their request back, with the date');
reset role;
select results_eq(
  $$ select kind, proposed_dob, evidence_path, proposed_first_name, proposed_photo_path
       from profile_change_requests where id = (select (r ->> 'id')::uuid from res_h) $$,
  format($$ values ('dob'::text, date '1990-07-07', %L::text, null::text, null::text) $$,
         :'staffb' || '/change-requests/dob-1.pdf'),
  'H: a dob row: the date and the evidence, nothing else');
select is(
  (select array_agg(k order by k) from notification_outbox o, jsonb_object_keys(o.payload) k
    where o.key = 'RC1:request:' || (select r ->> 'id' from res_h)),
  array['current', 'employeeId', 'field', 'name', 'note', 'proposed', 'requestedAt'],
  'H: RC1 carries exactly the register''s placeholders');
select results_eq(
  $$ select payload ->> 'field', payload ->> 'current', payload ->> 'proposed', recipient_emails
       from notification_outbox where key = 'RC1:request:' || (select r ->> 'id' from res_h) $$,
  $$ values ('date of birth'::text, '22 Feb 1994'::text, '07 Jul 1990'::text,
             array['admin@thehospitalitycompany.co.uk']) $$,
  'H: RC1 to admin@ — "…to change their date of birth", now → requested');

select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$ select office_decide_profile_change((select (r ->> 'id')::uuid from res_h), true, null) $$,
  '42501', 'not_permitted', 'H: a scheduler cannot decide a date-of-birth request');
select throws_ok(
  $$ select office_decide_profile_change((select (r ->> 'id')::uuid from res_h), false, 'No') $$,
  '42501', 'not_permitted', 'H: either way');
select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
select throws_ok(
  $$ select office_decide_profile_change((select (r ->> 'id')::uuid from res_h), true, null) $$,
  '42501', 'read_only', 'H: a viewer is read-only');
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
select results_eq(
  format($$ select kind, current_dob, proposed_dob from office_profile_change_requests(%L) $$, :'staffb'),
  $$ values ('dob'::text, date '1994-02-22', date '1990-07-07') $$,
  'H: the queue shows now → requested for a date of birth');
create temp table res_h2 as
  select office_decide_profile_change((select (r ->> 'id')::uuid from res_h), true, null) as r;
reset role;
select results_eq(
  $$ select r ->> 'status', r ->> 'kind', r ->> 'rtwCheck' from res_h2 $$,
  $$ values ('approved'::text, 'dob'::text, 'queued'::text) $$,
  'H: a manager approves; the pending share code''s check is re-run, as for a correction');
select is((select dob from staff where id = :'staffb'), date '1990-07-07', 'H: staff.dob is the requested date');
select results_eq(
  $$ select status, previous_value, decided_by from profile_change_requests
      where id = (select (r ->> 'id')::uuid from res_h) $$,
  format($$ values ('approved'::text, '{"dob": "1994-02-22"}'::jsonb, %L::uuid) $$, :'manager'),
  'H: approved by the manager, with the date it replaced as the snapshot');
select is(
  (select payload from notification_outbox where key = 'RC2:request:' || (select r ->> 'id' from res_h)),
  '{"field": "date of birth"}'::jsonb,
  'H: RC2 "Your date of birth has been updated."');
select is(
  (select count(*)::int from notification_outbox where key = 'RC4:request:' || (select r ->> 'id' from res_h)),
  0, 'H: no RC4 — payroll''s email is for a name');
select results_eq(
  format($$ select actor, data -> 'dob', data ->> 'source', data ->> 'requestId', data ->> 'actorName'
              from audit_log where action = 'staff.dob_corrected' and entity_id = %L
               and data ->> 'source' = 'change_request' $$, :'staffb'),
  format($$ select %L::uuid, '{"from": "1994-02-22", "to": "1990-07-07"}'::jsonb, 'change_request'::text,
                   r ->> 'id', 'Mona Manager'::text from res_h $$, :'manager'),
  'H: audited staff.dob_corrected as the approving manager, with the request');
select is(
  (select data from audit_log where action = 'profile_change.approve' and actor = :'manager'
      and data ->> 'requestId' = (select r ->> 'id' from res_h)),
  jsonb_build_object('requestId', (select r ->> 'id' from res_h), 'kind', 'dob'),
  'H: and the decision itself, as for every kind');

-- A rejection needs no identity check beyond the manager's, and says why.
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table res_h3 as
  select request_dob_change(date '1990-07-08', :'staffb' || '/change-requests/dob-1.pdf') as r;
grant select on res_h3 to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select is(
  office_decide_profile_change((select (r ->> 'id')::uuid from res_h3), false, 'The passport says 7 July'),
  '{"ok": true, "status": "rejected", "kind": "dob"}'::jsonb,
  'H: the owner rejects with a reason');
reset role;
select is((select payload from notification_outbox where key = 'RC3:request:' || (select r ->> 'id' from res_h3)),
  '{"field": "date of birth", "reason": "The passport says 7 July"}'::jsonb,
  'H: RC3 "We couldn''t update your date of birth: …"');
select is((select dob from staff where id = :'staffb'), date '1990-07-07', 'H: and nothing changed');

-- =====================================================================
-- I · §1.7 removal
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table res_i as
  select request_dob_change(date '1995-06-14', :'staffa' || '/change-requests/dob-a.pdf') as r;
reset role;
select set_config('request.jwt.claims', '', true);
select lives_ok(
  format($$ select remove_worker(%L, now(), %L) $$, :'staffa', :'admin_uid'),
  'I: remove_worker() runs with the dob requests in place');
select results_eq(
  $$ select status, proposed_dob from profile_change_requests where id = (select (r ->> 'id')::uuid from res_i) $$,
  $$ values ('withdrawn'::text, date '1900-01-01') $$,
  'I: the pending request is withdrawn and its date anonymised');
select is_empty(
  format($$ select id from audit_log where (entity_id = %L or data ->> 'staffId' = %L) and data ? 'dob' $$,
         :'staffa', :'staffa'),
  'I: no audit row about the worker keeps the dates');
select ok(
  exists (select 1 from audit_log where action = 'staff.dob_changed_with_share_code' and entity_id = :'staffa'),
  'I: the rows themselves are kept — history');

select * from finish();
rollback;
