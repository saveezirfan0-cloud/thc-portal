-- =====================================================================
-- 461 · The 48-hour opt-out is the worker's own, the wizard signs it
--       properly, and a wizard upload is judged on the Storage object
--   20260923200000_one_verify_path_and_rtw_date.sql
--
--   A. sign_wtr_optout() / cancel_wtr_optout(): the worker for themself,
--      or the service role — never an admin naming a worker (WTR reg. 5:
--      the opt-out is the worker's written agreement).
--   B. Wizard step 1: ticking signs (signed_at, notice, audit, CL5);
--      unticking gives notice (the ceiling returns at the END of it, CL6)
--      rather than clearing the flag.
--   C. onboarding_attach_document(): size and type from Storage, never the
--      caller; size in size_bytes; HEIC for the wizard only.
--   D. The extraction seam pre-fills a share code report's date.
-- =====================================================================
begin;
select plan(34);
\ir _shared/fixtures.psql

\set kim     'c4620000-0000-4000-8000-000000000001'
\set kim_uid 'c4630000-0000-4000-8000-000000000001'
\set share   'c4640000-0000-4000-8000-000000000001'

select (now() at time zone 'Europe/London')::date as today \gset

insert into auth.users (id, email) values (:'kim_uid', 'kim@wizard.test');
insert into profiles (id, role, full_name) values (:'kim_uid', 'staff', 'Kim Wizard');
insert into staff (id, user_id, first_name, last_name, email, phone, dob, status) values
  (:'kim', :'kim_uid', 'Kim', 'Wizard', 'kim@wizard.test', '+447700946101', date '1998-04-04', 'documents');

insert into storage.objects (bucket_id, name, metadata) values
  ('documents', :'kim' || '/passport/ok.pdf',   '{"mimetype":"application/pdf","size":482113}'),
  ('documents', :'kim' || '/passport/big.jpg',  '{"mimetype":"image/jpeg","size":11000000}'),
  ('documents', :'kim' || '/passport/lie.heic', '{"mimetype":"image/jpeg","size":90000}'),
  ('documents', :'kim' || '/passport/h.heic',   '{"mimetype":"image/heic","size":90000}');

-- =====================================================================
-- A · Whose opt-out it is
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select throws_ok(format('select sign_wtr_optout(null, 7, %L)', :'staffa'),
  '42501', 'not_your_worker', 'an admin cannot sign a worker out of the 48-hour limit');
select throws_ok(format('select cancel_wtr_optout(%L)', :'staffa'),
  '42501', 'not_your_worker', 'nor cancel a worker''s opt-out for them');
select throws_ok('select sign_wtr_optout()',
  '42501', 'not_a_worker', 'and has no opt-out of their own to sign');

select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
select throws_ok(format('select sign_wtr_optout(null, 7, %L)', :'staffa'),
  '42501', 'not_your_worker', 'one worker cannot sign for another');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select is(sign_wtr_optout() ->> 'ok', 'true', 'the worker signs their own');
select is(sign_wtr_optout(null, 7, :'staffa') ->> 'reason', 'already_signed',
  'naming themself is the same as not naming anyone');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(cancel_wtr_optout(:'staffa') ->> 'ok', 'true',
  'the service role may act for a named worker (server-side tooling holding the key)');
select is((select wtr_optout_cancelled_from from staff where id = :'staffa'), :'today'::date + 7,
  'and the notice runs the same way');

select ok(not has_function_privilege('authenticated', 'wtr_optout_do_sign(uuid,text,int)', 'execute')
      and not has_function_privilege('service_role', 'wtr_optout_do_sign(uuid,text,int)', 'execute')
      and not has_function_privilege('authenticated', 'wtr_optout_do_cancel(uuid)', 'execute'),
  'the bodies are internal: only the checked doors reach them');

-- =====================================================================
-- B · Wizard step 1 signs and gives notice
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'kim_uid', 'role', 'authenticated')::text, true);
select lives_ok(
  $$ select onboarding_save_right_to_work('uk_irish', date '1998-04-04', null, null, null, 'passport', true) $$,
  'step 1 with the opt-out ticked');
select results_eq(
  format($$ select wtr_optout, wtr_optout_signed_at is not null, wtr_optout_notice_days, wtr_optout_cancelled_from
              from staff where id = %L $$, :'kim'),
  $$ values (true, true, 7, null::date) $$,
  'the tick is a signature: signed_at and the notice period are recorded');
select is((select count(*)::int from audit_log where action = 'wtr_optout.signed' and entity_id = :'kim'), 1,
  'the signature is in the audit log');
select is((select count(*)::int from notification_outbox where template = 'CL5' and payload ->> 'name' = 'Kim Wizard'), 1,
  'and the office is told (CL5)');
select is(onboarding_state() ->> 'wtrOptOut', 'true', 'step 1 shows it ticked');

select lives_ok(
  $$ select onboarding_save_right_to_work('uk_irish', date '1998-04-04', null, null, null, 'passport', true) $$,
  'saving step 1 again with the tick unchanged');
select is((select count(*)::int from notification_outbox where template = 'CL5' and payload ->> 'name' = 'Kim Wizard'), 1,
  'signs nothing twice');

select lives_ok(
  $$ select onboarding_save_right_to_work('uk_irish', date '1998-04-04', null, null, null, 'passport', false) $$,
  'unticking');
select results_eq(
  format($$ select wtr_optout, wtr_optout_cancelled_from from staff where id = %L $$, :'kim'),
  format($$ values (true, %L::date) $$, :'today'::date + 7),
  'gives notice: the opt-out stands until the notice period ends — it is not cleared on the spot');
select is((select count(*)::int from notification_outbox where template = 'CL6' and payload ->> 'name' = 'Kim Wizard'), 1,
  'the office is told of the cancellation (CL6)');
select is(onboarding_state() ->> 'wtrOptOut', 'false', 'and step 1 shows it unticked');

select lives_ok(
  $$ select onboarding_save_right_to_work('uk_irish', date '1998-04-04', null, null, null, 'passport', true) $$,
  'ticking again during the notice period');
select results_eq(
  format($$ select wtr_optout, wtr_optout_cancelled_from from staff where id = %L $$, :'kim'),
  $$ values (true, null::date) $$,
  'withdraws the cancellation, as signing on the Documents tab does');

-- =====================================================================
-- C · A wizard upload, judged on the Storage object
-- =====================================================================
select throws_ok(
  format($$ select onboarding_attach_document('passport', %L, 'x.pdf', 1000, 'application/pdf') $$,
         :'kim' || '/passport/missing.pdf'),
  'P0001', 'wrong_path', 'a path with no object behind it is refused');
select throws_ok(
  format($$ select onboarding_attach_document('passport', %L, 'x.pdf', 1000, 'application/pdf') $$,
         :'kim' || '/national_id/ok.pdf'),
  'P0001', 'wrong_path', 'the folder must be the document type the Staff App files it under');
select throws_ok(
  format($$ select onboarding_attach_document('passport', %L, 'big.jpg', 1000, 'image/jpeg') $$,
         :'kim' || '/passport/big.jpg'),
  'P0001', 'file_too_large', 'an 11 MB object is refused although the caller said 1,000 bytes');
select throws_ok(
  format($$ select onboarding_attach_document('passport', %L, 'lie.heic', 1000, 'image/heic') $$,
         :'kim' || '/passport/lie.heic'),
  'P0001', 'file_type', 'a .heic Storage recorded as a JPEG is refused although the caller said HEIC');
select lives_ok(
  format($$ select onboarding_attach_document('passport', %L, 'ok.pdf', 1, 'image/png') $$,
         :'kim' || '/passport/ok.pdf'),
  'a real PDF is recorded whatever the caller claimed about it');
select results_eq(
  format($$ select size_bytes, mime_type, file_size from compliance_docs
             where staff_id = %L and review_status = 'pending' $$, :'kim'),
  $$ values (482113::bigint, 'application/pdf'::text, null::int) $$,
  'size and type are Storage''s, in size_bytes; the deprecated file_size is not written');
select is((select (d ->> 'fileSize')::bigint from jsonb_array_elements(onboarding_state() -> 'documents') d
            where d ->> 'docType' = 'passport'), 482113::bigint,
  'the wizard reads the size back from size_bytes');

reset role;
select is((select problem from evidence_upload_problem(:'kim', 'passport', :'kim' || '/passport/h.heic')),
  'invalid_path', 'the completion letter and opt-out copy stay PDF / JPG / PNG (requirement §2.1)');
select is((select problem from evidence_upload_problem(:'kim', 'passport', :'kim' || '/passport/h.heic', true)),
  null, 'the wizard''s form takes HEIC (§2.5 pt 7)');
select is_empty($$ select 1 from compliance_docs where file_size is not null and size_bytes is null $$,
  'every size the wizard ever wrote is in size_bytes');

-- =====================================================================
-- D · The extractor pre-fills the share code's date (ADR-0002)
-- =====================================================================
insert into compliance_docs (id, staff_id, doc_type, share_code, review_status)
values (:'share', :'staffa', 'share_code_report', 'W12345678', 'pending');
select lives_ok(
  format($$ select record_document_extraction(%L, %L::date, null, null, null, 0.95, '{}'::jsonb) $$,
         :'share', :'today'::date + 500),
  'the extractor reads the right-to-work-until off the gov.uk report');
select results_eq(
  format($$ select right_to_work_until, expiry_date, review_status::text from compliance_docs where id = %L $$, :'share'),
  format($$ values (%L::date, null::date, 'pending'::text) $$, :'today'::date + 500),
  'it is pre-filled as right_to_work_until for the reviewer to confirm — and still pending');

select * from finish();
rollback;
