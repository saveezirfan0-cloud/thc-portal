-- =====================================================================
-- 393 · Appendix A — the candidate's journey, end to end, on the database
--
-- One person, from the public form to a signed contract, through every
-- step RPC the Staff App calls, in order:
--
--   1  they apply — name, email, phone, age; under 18 is refused on the
--      spot, and there is no "Applied" stage (§2.1)
--   2–4  Willo: interview requested → completed → accepted, through
--      B5's willo_link_candidate / willo_record_event — what the webhook
--      will call once THC's keys exist (Appendix B) — and E3. Following
--      the activation link is simulated by linking a login.
--   5  the eleven steps: right to work → address → selfie → documents
--      (incl. the declaration) → H&S induction → quiz → HMRC → two
--      references → bank → contract → how it works
--   6  waiting for review: in review · verified · rejected + re-upload
--   7  a worker — documents verified, contract signed: the app unlocks
--   9  they leave (Request my P45) and come back: Reset to candidate puts
--      them at the start of the same record, Employee ID and history
--      kept, evidence superseded, the wizard to walk again (§2.12)
--
-- The office's Verify / Reject is B5's screen; here it is the row update
-- that screen will make, and everything that follows is the database's
-- own — the §2.12 row guard, the automatic move to Quiz and the Employee
-- ID at the signature come from 20260923110000 (B5), which this walk
-- therefore needs applied.
-- =====================================================================
begin;
select plan(52);

\set uid 'c3970000-0000-4000-8000-000000000001'

-- =====================================================================
-- 1. The public form (§2.1)
-- =====================================================================
set local "request.jwt.claims" = '{"role":"anon"}';
set local role anon;
select throws_ok(
  format($$ select submit_application('Young', 'Person', 'young@journey.test', '+447700900998', %L::date, true) $$,
         ((now() at time zone 'Europe/London')::date - interval '17 years')::date),
  '22023', 'You must be 18 or over to apply.', 'under 18 is rejected on the spot, on the server too');
select lives_ok(
  $$ select submit_application('Amara', 'Journey', 'amara@journey.test', '+447700900999', date '2003-11-22', true) $$,
  'Amara applies from the public page, logged out');
reset role;

select id as cand from staff where email = 'amara@journey.test' \gset

select is((select status::text from staff where id = :'cand'), 'interview_requested',
  'she lands straight in Interview requested — there is no Applied stage (§2.1, §2.12)');
select is((select employee_id from staff where id = :'cand'), null,
  'a candidate has no Employee ID yet (§2.7)');

-- =====================================================================
-- 2–4. Willo — B5's entry points, as the webhook will call them
-- =====================================================================
select lives_ok(format($$ select willo_link_candidate(%L, 'willo-journey-1') $$, :'cand'),
  '2: the candidate is created in Willo, which sends E1 itself');
select lives_ok($$ select willo_record_event('willo-journey-1', 'new_response') $$,
  '3: the video interview is completed');
select is((select status::text from staff where id = :'cand'), 'interview_completed',
  'and the card moves by itself (§2.4)');
select throws_ok(format($$ update staff set status = 'quiz' where id = %L $$, :'cand'),
  'P0001', null, 'nobody can skip her past the documents to the quiz');
select lives_ok(
  $$ select willo_record_event('willo-journey-1', 'accepted', now(),
       '{"activationLink":"https://staff.example/activate?t=x","installLink":"https://staff.example/install"}'::jsonb) $$,
  '4: the manager accepts inside Willo');
select is((select status::text from staff where id = :'cand'), 'documents', 'she moves to Documents');
select isnt_empty(
  format($$ select 1 from notification_outbox where template = 'E3' and recipient_emails = array['amara@journey.test'] $$),
  'and the system sends E3: set your password and download the app');

insert into auth.users (id, email) values (:'uid', 'amara@journey.test');
-- What Storage holds once the Staff App has uploaded her files.
insert into storage.objects (bucket_id, name, metadata) values
  ('documents', :'cand' || '/passport/1.jpg', '{"mimetype":"image/jpeg","size":2202009}'),
  ('documents', :'cand' || '/passport/2.jpg', '{"mimetype":"image/jpeg","size":1900000}'),
  ('documents', :'cand' || '/university_term_dates_letter/1.pdf', '{"mimetype":"application/pdf","size":348160}');
insert into profiles (id, role, full_name) values (:'uid', 'staff', 'Amara Journey');
update staff set user_id = :'uid' where id = :'cand';
set local "request.jwt.claims" = '{"sub":"c3970000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(onboarding_state()->>'status', 'documents', 'activated, she opens the wizard at step 1');

-- =====================================================================
-- 5. The eleven steps
-- =====================================================================
-- 1/11 right to work
select lives_ok(
  $$ select onboarding_save_right_to_work('international_student', date '2003-11-22', 'W12 3AB 4CD', null, null, null, false) $$,
  '1/11 right to work: international student, share code typed');
-- 2/11 home address
select lives_ok(
  $$ select onboarding_save_address('Flat 4, 22 Roman Road', 'London', 'E2 0RY', 51.5290, -0.0450) $$,
  '2/11 home address: the pin');
-- 3/11 selfie
select lives_ok(format($$ select staff_set_photo(%L) $$, :'cand' || '/selfie-1.jpg'), '3/11 the selfie is taken');
select lives_ok($$ select onboarding_confirm_selfie() $$, '3/11 and used');
-- 4/11 documents + declaration
select lives_ok(
  format($$ select onboarding_attach_document('passport', %L, 'passport_amara.jpg', 2202009, 'image/jpeg') $$,
         :'cand' || '/passport/1.jpg'), '4/11 passport');
select lives_ok(
  format($$ select onboarding_attach_document('university_term_dates_letter', %L, 'UCL_term_dates_2026-27.pdf', 348160, 'application/pdf') $$,
         :'cand' || '/university_term_dates_letter/1.pdf'), '4/11 term dates letter');
select lives_ok($$ select onboarding_submit_documents(false, null, null) $$,
  '4/11 submitted, declaration No');

-- 6. Waiting for review
select results_eq(
  $$ select d->>'docType', d->>'status'
       from jsonb_array_elements(onboarding_state()->'documents') d order by 1 $$,
  $$ values ('passport'::text, 'pending'::text), ('share_code_report', 'pending'),
            ('university_term_dates_letter', 'pending') $$,
  '6: every document shows as under review');
select is(onboarding_state()->'declaration'->>'status', 'verified',
  'and the No declaration is already verified');
select throws_ok($$ select onboarding_complete_induction() $$, 'P0001', 'wrong_stage',
  'steps 5–11 wait: the quiz is locked while anything is unverified (§2.9)');

-- The office rejects the passport; she re-uploads; the office verifies all.
reset role;
update compliance_docs set review_status = 'rejected', rejection_reason = 'Photo is blurred — please re-take'
 where staff_id = :'cand' and doc_type = 'passport' and review_status = 'pending';
select results_eq(
  $$ select d->>'status', d->>'rejectionReason'
       from jsonb_array_elements(onboarding_state()->'documents') d where d->>'docType' = 'passport' $$,
  $$ values ('rejected'::text, 'Photo is blurred — please re-take'::text) $$,
  '6: rejected, with the reason she sees beside Re-upload');
select lives_ok(
  format($$ select onboarding_attach_document('passport', %L, 'passport_retake.jpg', 1900000, 'image/jpeg') $$,
         :'cand' || '/passport/2.jpg'), 're-uploaded');
update compliance_docs set review_status = 'verified', reviewed_at = now()
 where staff_id = :'cand' and review_status = 'pending' and doc_type in ('passport', 'university_term_dates_letter');
update compliance_docs set review_status = 'verified', reviewed_at = now(), right_to_work_until = date '2028-01-31'
 where staff_id = :'cand' and review_status = 'pending' and doc_type = 'share_code_report';
select is((select status::text from staff where id = :'cand'), 'quiz',
  'every document verified: she moves to Quiz by herself (§2.3)');

-- 5/11 induction, 6/11 quiz
select lives_ok($$ select onboarding_complete_induction() $$, '5/11 H&S induction, to the last slide');
select is((select count(*)::int from onboarding_quiz_questions()),
          (select count(*)::int from quiz_questions where active), '6/11 the questions arrive, without their key');
select is(
  (select submit_quiz_attempt(jsonb_object_agg(id::text, correct_index))->>'outcome'
     from quiz_questions where active),
  'passed', '6/11 quiz passed (≥ 80%)');
select is((select status::text from staff where id = :'cand'), 'contract', 'on to the next stage');

-- 7/11 HMRC
select lives_ok($$ select submit_hmrc_checklist(false, false, false, 'none', false, null, true) $$,
  '7/11 HMRC checklist, no NI number yet — allowed');
-- 8/11 references
select lives_ok(
  $$ select onboarding_save_references('[{"name":"Dr Helen Okafor","relationship":"Personal tutor, UCL","phone":"+44 20 7679 2000","email":"h.okafor@ucl.ac.uk"},
                                        {"name":"Sam Whitfield","relationship":"Volunteering supervisor","phone":"07700 900456","email":"sam@crisis.example"}]'::jsonb) $$,
  '8/11 two references');
-- 9/11 bank
select lives_ok($$ select onboarding_save_bank('Amara Journey', '40-47-84', '31926819') $$, '9/11 bank');
-- 10/11 contract
select lives_ok($$ select sign_contract(current_contract_version(), true) $$,
  '10/11 contract: "I agree" is the signature');
-- 11/11 how it works
select lives_ok($$ select onboarding_finish_tutorial() $$, '11/11 how it works → Open app');

-- =====================================================================
-- 7. A worker
-- =====================================================================
select is((select status::text from staff where id = :'cand'), 'compliant',
  '7: documents verified, contract signed — she is Staff');
select ok((select employee_id is not null from staff where id = :'cand'),
  'with an Employee ID, generated at the signature (§2.7)');
select is(jsonb_array_length(staff_me()->'blockers'), 0,
  'and nothing blocks her: Shifts, Radar and Invites unlock (appLock = none)');
select ok((select photo_path is not null from staff where id = :'cand'),
  'her selfie is the avatar across the system');
select is((select expiry_date from compliance_docs
            where staff_id = :'cand' and doc_type = 'university_term_dates_letter' and review_status = 'verified'),
  doc_expires_on('university_term_dates_letter', null, null, null, now()),
  'her verified term letter runs to 31 December, the date its reminders count down to (§4.2)');
select is(
  (select array_agg(template order by template) from notification_outbox
    where recipient_staff_id = :'cand' or payload->>'name' = 'Amara Journey'),
  array['E5'], 'the one email her onboarding sent is E5 to payroll — no E4, no E6 (no NI given)');

select employee_id as emp from staff where id = :'cand' \gset

-- =====================================================================
-- 9. She leaves, and comes back (§10.6, §2.12)
-- =====================================================================
select lives_ok($$ select request_my_p45('Back to university') $$, 'Request my P45');
select is((select status::text from staff where id = :'cand'), 'inactive', 'she is a leaver');

reset role;
select lives_ok(format($$ select reset_to_candidate(%L, 'Re-applied in March') $$, :'cand'),
  'the office presses Reset to candidate');
select is((select status::text from staff where id = :'cand'), 'interview_requested',
  'back to the start of the pipeline, on the same record');
select is((select employee_id from staff where id = :'cand'), :emp,
  'the Employee ID is kept (§2.12 point 2)');
select is_empty(
  format($$ select 1 from compliance_docs where staff_id = %L and review_status <> 'superseded' $$, :'cand'),
  'every document is superseded — none can satisfy the new check');
select isnt_empty(
  format($$ select 1 from compliance_docs where staff_id = %L and review_status = 'superseded' $$, :'cand'),
  'but they are kept, read-only');
select is((select count(*)::int from quiz_attempts where staff_id = :'cand' and superseded), 1,
  'the quiz result is superseded, kept as history');
select is((select count(*)::int from hmrc_checklists where staff_id = :'cand' and superseded), 1,
  'and so is the checklist');
select isnt_empty(
  format($$ select 1 from audit_log where action = 'contract_signed' and entity_id = %L $$, :'cand'),
  'the signature from the first period survives in the audit log');
select is_empty(format($$ select 1 from onboarding_progress where staff_id = %L $$, :'cand'),
  'the wizard starts again from step 1 — the full wizard, not a partial recheck');

set local "request.jwt.claims" = '{"sub":"c3970000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select onboarding_save_right_to_work('international_student', date '2003-11-22', 'W123AB4CD', null, null, null, false) $$,
  'P0001', 'wrong_stage', 'and nothing opens until the new interview is accepted');

select * from finish();
rollback;
