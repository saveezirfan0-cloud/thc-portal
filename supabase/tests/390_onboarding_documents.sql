-- =====================================================================
-- 390 · Onboarding wizard, steps 1–4 — 20260923120000
--       (§10.3, §2.5, §2.6, §2.10, §2.3, §2.9 gate)
--
-- What this file holds the database to:
--
--   · every step is refused out of order and out of stage — the screens
--     hide later steps, the database REFUSES them;
--   · the share code is validated before anything is filed (§2.5), DOB
--     is mandatory in every branch and 18+ is enforced (§2.1, §2.5);
--   · a branch's document set is exactly §2.5's, uploads are PDF / JPG /
--     PNG / HEIC up to 10 MB (§2.5 pt 7) and only into the worker's own
--     folder;
--   · the criminal declaration: No is verified on submission, Yes waits
--     for a manager (§2.10);
--   · the AI seam pre-fills and flags, never verifies; the term letter
--     keeps its 31 December expiry whatever the AI read (§2.6, §4.2);
--   · the move to Quiz happens by itself once EVERYTHING — share code and
--     declaration included — is verified (§2.3), and not a moment before;
--   · the three new tables, read as admin, client, staff and anon.
--
-- The automatic move to Quiz and the No auto-verify are the office
-- pipeline's (20260923110000, B5): this file asserts the wizard's
-- submissions drive them, and needs that migration applied.
--
-- Every row is created inside the transaction and rolled back.
-- employee_id is left null: candidates have none until they sign (§2.7).
-- =====================================================================
begin;
select plan(94);

\set cl        'c3900000-0000-4000-8000-000000000001'
\set amara     'c3910000-0000-4000-8000-000000000001'
\set tom       'c3910000-0000-4000-8000-000000000002'
\set amara_uid 'c3920000-0000-4000-8000-000000000001'
\set tom_uid   'c3920000-0000-4000-8000-000000000002'
\set admin_uid 'c3920000-0000-4000-8000-000000000003'
\set cli_uid   'c3920000-0000-4000-8000-000000000004'

insert into auth.users (id, email) values
  (:'amara_uid', 'amara@onboarding.test'),
  (:'tom_uid',   'tom@onboarding.test'),
  (:'admin_uid', 'office@onboarding.test'),
  (:'cli_uid',   'client@onboarding.test');

insert into clients (id, name, contact_name, phone, staff_contact_point, contact_emails)
values (:'cl', 'Onboarding Test Client', 'Cara C', '+447700900401', 'Front desk',
        array['c@onboarding.test']);

insert into profiles (id, role, full_name, client_id) values
  (:'amara_uid', 'staff',  'Amara Kalu', null),
  (:'tom_uid',   'staff',  'Tom Reid',   null),
  (:'admin_uid', 'admin',  'Gisela M.',  null),
  (:'cli_uid',   'client', 'Client user', :'cl');

insert into staff (id, user_id, first_name, last_name, email, phone, dob, status) values
  (:'amara', :'amara_uid', 'Amara', 'Kalu', 'amara@onboarding.test', '+447700900321',
   date '2003-11-22', 'documents'),
  (:'tom',   :'tom_uid',   'Tom',   'Reid', 'tom@onboarding.test',   '+447700900322',
   date '1994-01-09', 'documents');

-- The objects as Storage records them once the Staff App has uploaded
-- them with the service key. onboarding_attach_document() judges the
-- size and type off these, never off what the caller says
-- (20260923200000).
insert into storage.objects (bucket_id, name, metadata) values
  ('documents', :'amara' || '/passport/a.jpg',   '{"mimetype":"image/jpeg","size":10485761}'),
  ('documents', :'amara' || '/passport/1.jpg',   '{"mimetype":"image/jpeg","size":2202009}'),
  ('documents', :'amara' || '/passport/2.heic',  '{"mimetype":"image/heic","size":2202009}'),
  ('documents', :'amara' || '/passport/3.jpg',   '{"mimetype":"image/jpeg","size":1000}'),
  ('documents', :'amara' || '/passport/4.jpg',   '{"mimetype":"image/jpeg","size":1900000}'),
  ('documents', :'amara' || '/university_term_dates_letter/1.pdf', '{"mimetype":"application/pdf","size":348160}'),
  ('documents', :'tom'   || '/passport/1.pdf',   '{"mimetype":"application/pdf","size":50000}');

-- Amara is the caller until said otherwise.
set local "request.jwt.claims" = '{"sub":"c3920000-0000-4000-8000-000000000001","role":"authenticated"}';

-- =====================================================================
-- 1. The read
-- =====================================================================
select is(onboarding_state()->>'status', 'documents',
  'onboarding_state() resolves the caller from the session and reports the stage');
select is(onboarding_state()->'progress'->>'rtwAt', null,
  'and nothing is done yet');
select ok(not (onboarding_state() ? 'blockReason') and not (onboarding_state()->'hmrc' ? 'statement'),
  'it has no field for block_reason or the HMRC letter (§10.1, §2.8)');

-- =====================================================================
-- 2. Step 1 — Right to work (§2.5)
-- =====================================================================
select throws_ok(
  $$ select onboarding_save_address('Flat 4, 22 Roman Road', 'London', 'E2 0RY', 51.5290, -0.0450) $$,
  'P0001', 'previous_step', 'step 2 is refused before step 1 is done');

select throws_ok(
  $$ select onboarding_save_right_to_work('eu_settled', date '1999-09-30', 'W12 3AB', null, null, null, false) $$,
  'P0001', 'bad_share_code', 'a short share code is refused before anything is filed (§2.5)');
select throws_ok(
  $$ select onboarding_save_right_to_work('eu_settled', date '1999-09-30', 'A123AB4CD', null, null, null, false) $$,
  'P0001', 'bad_share_code', 'and one that does not start with W');
select throws_ok(
  $$ select onboarding_save_right_to_work('eu_settled', null, 'W123AB4CD', null, null, null, false) $$,
  'P0001', 'dob_required', 'DOB is mandatory — share-code branch');
select throws_ok(
  $$ select onboarding_save_right_to_work('uk_irish', null, null, null, null, 'passport', false) $$,
  'P0001', 'dob_required', 'DOB is mandatory — UK branch too');
select throws_ok(
  format($$ select onboarding_save_right_to_work('eu_settled', %L::date, 'W123AB4CD', null, null, null, false) $$,
         (onboarding_uk_today() - interval '17 years')::date),
  'P0001', 'under_18', 'under 18 is refused on the server (§2.1)');
select throws_ok(
  $$ select onboarding_save_right_to_work('uk_irish', date '1999-09-30', null, null, null, null, false) $$,
  'P0001', 'doc_choice_required', 'UK / Irish must say passport or birth certificate + NI evidence');
select throws_ok(
  $$ select onboarding_save_right_to_work('work_visa', date '1999-09-30', 'W123AB4CD', null, date '2028-03-31', null, false) $$,
  'P0001', 'visa_type_required', 'work visa needs a visa type (§2.5 pt 3)');
select throws_ok(
  $$ select onboarding_save_right_to_work('work_visa', date '1999-09-30', 'W123AB4CD', 'Skilled Worker', date '2020-01-01', null, false) $$,
  'P0001', 'expiry_past', 'and an expiry that has not passed');
select throws_ok(
  $$ select onboarding_save_right_to_work('dependant_other', date '1999-09-30', 'W123AB4CD', null, null, null, false) $$,
  'P0001', 'expiry_required', 'dependant / other needs its expiry (§2.5 pt 5)');
select throws_ok(
  $$ select onboarding_save_right_to_work('martian', date '1999-09-30', 'W123AB4CD', null, null, null, false) $$,
  'P0001', 'bad_branch', 'there are five branches and no sixth');

select lives_ok(
  $$ select onboarding_save_right_to_work('international_student', date '2003-11-22', 'w12 3ab 4cd', null, null, null, true) $$,
  'an international student with a pasted, lower-case share code is accepted');
select is((select share_code from staff where id = :'amara'), 'W123AB4CD',
  'and the code is stored upper-case with the spaces stripped');
select is((select rtw_branch::text from staff where id = :'amara'), 'international_student',
  'the branch is on the worker');
select ok((select rtw_at is not null from onboarding_progress where staff_id = :'amara'),
  'and step 1 is stamped done');

-- =====================================================================
-- 3. Step 2 — Home address (a pin)
-- =====================================================================
select throws_ok(
  $$ select onboarding_confirm_selfie() $$, 'P0001', 'previous_step',
  'step 3 is refused before step 2');
select throws_ok(
  $$ select onboarding_save_address('Flat 4, 22 Roman Road', 'London', 'NOT A CODE', 51.5290, -0.0450) $$,
  'P0001', 'bad_postcode', 'a postcode has to look like one');
select throws_ok(
  $$ select onboarding_save_address('Flat 4, 22 Roman Road', 'London', 'E2 0RY', 40.7, -74.0) $$,
  'P0001', 'pin_outside_uk', 'a pin in New York is a slipped finger, not a home');
select lives_ok(
  $$ select onboarding_save_address('Flat 4, 22 Roman Road', 'London', 'e20ry', 51.5290, -0.0450) $$,
  'a pin in Bethnal Green with its address is saved');
select is((select home_address from staff where id = :'amara'), 'Flat 4, 22 Roman Road, London E2 0RY',
  'the address reads as the office will see it, postcode formatted');
select ok((select home_location is not null from staff where id = :'amara'),
  'and the pin is on the worker — it is what proximity scoring reads (§6)');
select is_empty(
  $$ select 1 from notification_outbox where template = 'E7' and payload->>'name' = 'Amara Kalu' $$,
  'no E7: that is for a change after joining (§10.1), not the first address');

-- =====================================================================
-- 4. Step 3 — the selfie
-- =====================================================================
select throws_ok($$ select onboarding_confirm_selfie() $$, 'P0001', 'photo_required',
  'Continue needs a photo');
-- The upload (photos_worker_insert_own); staff_set_photo() requires the
-- object to exist (20260930120200).
insert into storage.objects (bucket_id, name) values ('photos', :'amara' || '/selfie-1.jpg');
select lives_ok(
  format($$ select staff_set_photo(%L) $$, :'amara' || '/selfie-1.jpg'),
  'the photo goes through staff_set_photo(), which locks it once set (§10.1)');
select lives_ok($$ select onboarding_confirm_selfie() $$, 'then step 3 is done');

-- =====================================================================
-- 5. Step 4 — uploads (§2.5 pts 4, 7, 8)
-- =====================================================================
select throws_ok(
  format($$ select onboarding_attach_document('visa_document', %L, 'visa.pdf', 1000, 'application/pdf') $$,
         :'amara' || '/visa_document/a.pdf'),
  'P0001', 'doc_not_for_branch', 'a student uploads no visa — the share code covers it (§2.5 pt 4)');
select throws_ok(
  $$ select onboarding_attach_document('passport', 'someone-else/passport/a.jpg', 'p.jpg', 1000, 'image/jpeg') $$,
  'P0001', 'wrong_path', 'only into the caller''s own folder');
select throws_ok(
  format($$ select onboarding_attach_document('passport', %L, 'p.jpg', 10485761, 'image/jpeg') $$,
         :'amara' || '/passport/a.jpg'),
  'P0001', 'file_too_large', 'up to 10 MB per file (§2.5 pt 7)');
select throws_ok(
  format($$ select onboarding_attach_document('passport', %L, 'p.docx', 1000, 'application/msword') $$,
         :'amara' || '/passport/a.docx'),
  'P0001', 'file_type', 'PDF, JPG, PNG or HEIC only');
select lives_ok(
  format($$ select onboarding_attach_document('passport', %L, 'passport_first.jpg', 2202009, 'image/jpeg') $$,
         :'amara' || '/passport/1.jpg'),
  'a passport photo within the limits is recorded');
select lives_ok(
  format($$ select onboarding_attach_document('passport', %L, 'passport_amara.jpg', 2202009, 'image/heic') $$,
         :'amara' || '/passport/2.heic'),
  'a HEIC replacement is accepted too');
select is(
  (select array_agg(review_status::text order by uploaded_at, file_name) from compliance_docs
    where staff_id = :'amara' and doc_type = 'passport'),
  array['superseded', 'pending'],
  'before Submit, a new file replaces the pending one rather than queueing twice');
select is(
  (select needs_manual_review from compliance_docs
    where staff_id = :'amara' and doc_type = 'passport' and review_status = 'pending'),
  true, 'with no extractor run yet, the upload is flagged for manual review — nothing was pre-filled');

select throws_ok(
  $$ select onboarding_submit_documents(false, null, null) $$,
  'P0001', 'missing_document:university_term_dates_letter',
  'Submit names the document still missing (the wireframe''s "term letter missing" state)');

select lives_ok(
  format($$ select onboarding_attach_document('university_term_dates_letter', %L, 'UCL_term_dates_2026-27.pdf', 348160, 'application/pdf') $$,
         :'amara' || '/university_term_dates_letter/1.pdf'),
  'the term dates letter');
select is(
  (select expiry_date from compliance_docs where staff_id = :'amara'
      and doc_type = 'university_term_dates_letter' and review_status = 'pending'),
  doc_expires_on('university_term_dates_letter', null, null, null, now()),
  'arrives with §4.2''s 31 December expiry, whatever the letter prints');

-- =====================================================================
-- 6. The AI seam (§2.6) — pre-fill and flag, never verify
-- =====================================================================
select ok(not has_function_privilege('authenticated',
  'public.record_document_extraction(uuid, date, daterange[], date, text, numeric, jsonb)', 'execute'),
  'a worker cannot write the AI''s findings about their own documents');
select ok(has_function_privilege('service_role',
  'public.record_document_extraction(uuid, date, daterange[], date, text, numeric, jsonb)', 'execute'),
  'the extractor, holding the service key, can');

select lives_ok(
  format($$ select record_document_extraction(%L, date '2027-06-30',
            array[daterange('2026-12-13', '2027-01-06')], null, null, 0.55, '{"provider":"test"}'::jsonb) $$,
         (select id from compliance_docs where staff_id = :'amara'
            and doc_type = 'university_term_dates_letter' and review_status = 'pending')),
  'an unsure read of the term letter is recorded');
select is(
  (select expiry_date from compliance_docs where staff_id = :'amara'
      and doc_type = 'university_term_dates_letter' and review_status = 'pending'),
  doc_expires_on('university_term_dates_letter', null, null, null, now()),
  'the printed date does NOT become the expiry (§4.2)');
select is(
  (select term_dates from compliance_docs where staff_id = :'amara'
      and doc_type = 'university_term_dates_letter' and review_status = 'pending'),
  array[daterange('2026-12-13', '2027-01-06')],
  'the holiday ranges are pre-filled for the manager to check');
select is(
  (select needs_manual_review from compliance_docs where staff_id = :'amara'
      and doc_type = 'university_term_dates_letter' and review_status = 'pending'),
  true, 'below the confidence threshold → needs manual review');

select lives_ok(
  format($$ select record_document_extraction(%L, date '2031-03-14', null, null, null, 0.97, '{}'::jsonb) $$,
         (select id from compliance_docs where staff_id = :'amara'
            and doc_type = 'passport' and review_status = 'pending')),
  'a confident read of the passport');
select results_eq(
  $$ select expiry_date, needs_manual_review, review_status::text from compliance_docs
      where staff_id = 'c3910000-0000-4000-8000-000000000001' and doc_type = 'passport'
        and review_status <> 'superseded' $$,
  $$ values (date '2031-03-14', false, 'pending') $$,
  'pre-fills the expiry and clears the flag — and the document is still PENDING: the AI does not verify');

-- =====================================================================
-- 7. Submit documents, with the declaration (§2.10)
-- =====================================================================
select throws_ok($$ select onboarding_submit_documents(null, null, null) $$,
  'P0001', 'declaration_required', 'the declaration must be answered');
select throws_ok($$ select onboarding_submit_documents(true, '   ', null) $$,
  'P0001', 'details_required', 'Yes needs the details');

select lives_ok($$ select onboarding_submit_documents(false, null, null) $$,
  'Amara submits her documents, answering No');
select results_eq(
  $$ select answer, review_status::text, source::text, reviewed_at is not null
       from criminal_declarations where staff_id = 'c3910000-0000-4000-8000-000000000001' $$,
  $$ values (false, 'verified', 'onboarding', true) $$,
  'No is auto-verified on submission — it never enters the review queue (§2.10)');
select results_eq(
  $$ select share_code, review_status::text, file_path is null
       from compliance_docs where staff_id = 'c3910000-0000-4000-8000-000000000001'
        and doc_type = 'share_code_report' $$,
  $$ values ('W123AB4CD'::text, 'pending', true) $$,
  'the share code is filed for the gov.uk check — typed, never uploaded (§2.5, §2.6)');
select is((select status::text from staff where id = :'amara'), 'documents',
  'and she waits: nothing is verified yet, so the quiz stays locked (§2.9)');
select ok((onboarding_state()->'progress'->>'documentsAt') is not null,
  'the wizard knows step 4 is done');

select throws_ok($$ select onboarding_submit_documents(false, null, null) $$,
  'P0001', 'already_submitted', 'a double tap files nothing twice');
select throws_ok(
  $$ select onboarding_save_right_to_work('eu_settled', date '2003-11-22', 'W123AB4CD', null, null, null, false) $$,
  'P0001', 'documents_submitted', 'the branch cannot move under a submitted set');
select throws_ok(
  format($$ select onboarding_attach_document('passport', %L, 'p.jpg', 1000, 'image/jpeg') $$,
         :'amara' || '/passport/3.jpg'),
  'P0001', 'not_rejected', 'after Submit, only a rejected document takes a new file');

-- =====================================================================
-- 8. Rejected → re-upload → back to review (§2.3)
-- =====================================================================
reset role;
update compliance_docs set review_status = 'rejected', rejection_reason = 'Photo is blurred — please re-take'
 where staff_id = :'amara' and doc_type = 'passport' and review_status = 'pending';
select lives_ok(
  format($$ select onboarding_attach_document('passport', %L, 'passport_retake.jpg', 1900000, 'image/jpeg') $$,
         :'amara' || '/passport/4.jpg'),
  'a rejected passport takes a new file');
select is(
  (select array_agg(review_status::text order by uploaded_at) from compliance_docs
    where staff_id = :'amara' and doc_type = 'passport'),
  array['superseded', 'rejected', 'pending'],
  'which returns to review, with the rejected one kept as history');
select is(
  (select status from current_compliance_docs(:'amara') where doc_type = 'passport')::text,
  'pending', 'and it is the new one the office now sees');

-- =====================================================================
-- 9. The automatic move to Quiz (§2.3)
-- =====================================================================
update compliance_docs set review_status = 'verified', reviewed_at = now()
 where staff_id = :'amara' and doc_type = 'passport' and review_status = 'pending';
select is((select status::text from staff where id = :'amara'), 'documents',
  'passport verified: still documents — the term letter is not');
update compliance_docs set review_status = 'verified', reviewed_at = now()
 where staff_id = :'amara' and doc_type = 'university_term_dates_letter' and review_status = 'pending';
select is((select status::text from staff where id = :'amara'), 'documents',
  'term letter verified: still documents — the gov.uk share-code check is not');
update compliance_docs set review_status = 'verified', reviewed_at = now(),
       right_to_work_until = date '2028-01-31'
 where staff_id = :'amara' and doc_type = 'share_code_report' and review_status = 'pending';
select is((select status::text from staff where id = :'amara'), 'quiz',
  'share code verified → every document is: she advances to Quiz by herself (§2.3)');

-- Tom: UK passport, and a Yes.
set local "request.jwt.claims" = '{"sub":"c3920000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok(
  $$ select onboarding_save_right_to_work('uk_irish', date '1994-01-09', null, null, null, 'passport', false) $$,
  'Tom is UK / Irish, passport route, no share code');
select is((select share_code from staff where id = :'tom'), null, 'no share code is stored in branch 1');
select lives_ok($$ select onboarding_save_address('9 Other Road', 'London', 'N1 9GU', 51.53, -0.12) $$, 'address');
insert into storage.objects (bucket_id, name) values ('photos', :'tom' || '/selfie-1.jpg');
select lives_ok(format($$ select staff_set_photo(%L) $$, :'tom' || '/selfie-1.jpg'), 'photo');
select lives_ok($$ select onboarding_confirm_selfie() $$, 'selfie');
select lives_ok(
  format($$ select onboarding_attach_document('passport', %L, 'tom.pdf', 50000, 'application/pdf') $$,
         :'tom' || '/passport/1.pdf'), 'passport');
select lives_ok(
  $$ select onboarding_submit_documents(true, 'Driving without insurance, fined, March 2025.', date '2025-03-12') $$,
  'Tom answers Yes, with details');
select is(
  (select review_status::text from criminal_declarations where staff_id = :'tom'),
  'pending', 'Yes goes to the office like a document (§2.10)');
select is_empty(
  $$ select 1 from compliance_docs where staff_id = 'c3910000-0000-4000-8000-000000000002'
      and doc_type = 'share_code_report' $$,
  'branch 1 files no share-code check');

reset role;
update compliance_docs set review_status = 'verified', reviewed_at = now()
 where staff_id = :'tom' and doc_type = 'passport';
select is((select status::text from staff where id = :'tom'), 'documents',
  'his passport is verified but his declaration is not: the quiz stays locked');
update criminal_declarations set review_status = 'rejected', reviewed_at = now()
 where staff_id = :'tom';
select is((select status::text from staff where id = :'tom'), 'documents',
  'rejecting the declaration opens nothing: only a verified item can move him on (§2.3)');
update criminal_declarations set review_status = 'verified', reviewed_at = now()
 where staff_id = :'tom';
select is((select status::text from staff where id = :'tom'), 'quiz',
  'a verified one does — the declaration is part of the one combined blocker (§2.10)');

-- =====================================================================
-- 10. Out of stage
-- =====================================================================
set local "request.jwt.claims" = '{"sub":"c3920000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ select onboarding_save_address('x', 'y', 'E2 0RY', 51.5, -0.1) $$,
  'P0001', 'wrong_stage', 'a candidate in Quiz cannot rewrite step 2');

-- =====================================================================
-- 11. The three new tables, as each role (§1.4)
-- =====================================================================
insert into quiz_questions (position, prompt, options, correct_index, active)
values (900, 'RLS probe?', array['a', 'b'], 1, false);
insert into contract_versions (version, title, body, published_at)
values ('rls-probe', 'Probe', 'You must declare any unspent criminal conviction.', now() - interval '1 day');

-- Staff: own progress row only, no key, the contract text.
set local role authenticated;
select is((select count(*)::int from onboarding_progress), 1,
  'staff: sees their own progress row and not Tom''s');
select is((select count(*)::int from quiz_questions), 0,
  'staff: cannot read the quiz answer key');
select ok((select count(*)::int from contract_versions) >= 1,
  'staff: can read the contract they are asked to sign');
select throws_ok(
  $$ insert into onboarding_progress (staff_id, documents_at) values ('c3910000-0000-4000-8000-000000000002', now()) $$,
  '42501', null, 'staff: cannot write progress directly — every write is a stage-checked RPC');
update onboarding_progress set tutorial_at = now();
reset role;
select is((select tutorial_at from onboarding_progress where staff_id = :'amara'), null,
  'staff: an UPDATE of their own progress changes nothing');

-- Admin: everything.
set local "request.jwt.claims" = '{"sub":"c3920000-0000-4000-8000-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from onboarding_progress
            where staff_id in ('c3910000-0000-4000-8000-000000000001', 'c3910000-0000-4000-8000-000000000002')),
  2, 'admin: sees every candidate''s progress');
select ok((select count(*)::int from quiz_questions where position = 900) = 1,
  'admin: reads and maintains the quiz');
select lives_ok(
  $$ insert into contract_versions (version, title, body)
     values ('rls-probe-2', 'Probe 2', 'You must declare any unspent criminal conviction (§2.11).') $$,
  'admin: publishes a contract version — the §2.11 duty text is the office''s to maintain');
reset role;

-- Client: none of it but the contract text.
set local "request.jwt.claims" = '{"sub":"c3920000-0000-4000-8000-000000000004","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from onboarding_progress), 0, 'client: no onboarding data');
select is((select count(*)::int from quiz_questions), 0, 'client: no quiz');
select ok((select count(*)::int from contract_versions) >= 1,
  'client: reads the contract text — the deliberate any-signed-in-role read (20260923120000), carrying no person and no money');
with u as (update contract_versions set title = 'x' where version = 'rls-probe' returning 1)
  select is((select count(*)::int from u), 0, 'client: cannot change it');
reset role;

-- Anon: nothing.
set local "request.jwt.claims" = '{"role":"anon"}';
set local role anon;
select is((select count(*)::int from onboarding_progress), 0, 'anon: no onboarding data');
select is((select count(*)::int from contract_versions), 0, 'anon: not even the contract text');
select is((select count(*)::int from quiz_questions), 0, 'anon: not the answer key, from the public /apply origin or anywhere else (§2.9)');
reset role;

select ok(
  not has_function_privilege('anon', 'public.onboarding_state()', 'execute')
  and not has_function_privilege('anon', 'public.onboarding_submit_documents(boolean, text, date)', 'execute')
  and not has_function_privilege('anon', 'public.onboarding_attach_document(text, text, text, int, text)', 'execute'),
  'anon can call none of the wizard''s functions');

-- =====================================================================
-- 12. GDPR removal reaches the wizard's own row (§1.7)
-- =====================================================================
update onboarding_progress set visa_type = 'Skilled Worker', visa_expiry = date '2028-03-31'
 where staff_id = :'tom';
select lives_ok(format($$ select remove_worker(%L) $$, :'tom'), 'the office removes Tom (§1.7)');
select is_empty(format($$ select 1 from onboarding_progress where staff_id = %L $$, :'tom'),
  'and his wizard progress — visa type and typed expiry are personal data — goes with it');

select * from finish();
rollback;
