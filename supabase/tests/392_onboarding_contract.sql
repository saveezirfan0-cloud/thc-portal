-- =====================================================================
-- 392 · Onboarding wizard, steps 7–11 — 20260923120200
--       (§2.8, §2.10, §2.11, §2.7, §2.12, §1.8)
--
--   · HMRC: A/B/C derived from the three sequential questions, never
--     returned to the worker and never readable by them; hidden answers
--     stored as null; the declaration mandatory; NI optional, set once
--     through staff_set_ni_number() (E6) and locked;
--   · references: exactly two, phone AND email, no relatives, not the
--     same person twice;
--   · bank: staff_save_bank()'s rules and its E5;
--   · the contract: "I agree" is the signature, the version is the one
--     shown, the stamp is UK time; signing makes the candidate compliant
--     and generates the Employee ID once — a returning worker keeps
--     theirs; a published version cannot be edited and every version
--     carries the duty to disclose convictions;
--   · each step refused out of order and out of stage.
-- =====================================================================
begin;
select plan(53);

\set chloe_uid 'c3950000-0000-4000-8000-000000000001'
\set dev_uid   'c3950000-0000-4000-8000-000000000002'
\set ret_uid   'c3950000-0000-4000-8000-000000000003'
\set chloe     'c3960000-0000-4000-8000-000000000001'
\set dev       'c3960000-0000-4000-8000-000000000002'
\set ret       'c3960000-0000-4000-8000-000000000003'

insert into auth.users (id, email) values
  (:'chloe_uid', 'chloe@contract.test'), (:'dev_uid', 'dev@contract.test'),
  (:'ret_uid', 'ret@contract.test');
insert into profiles (id, role, full_name) values
  (:'chloe_uid', 'staff', 'Chloe'), (:'dev_uid', 'staff', 'Dev'), (:'ret_uid', 'staff', 'Ret');
-- Ret is a returning worker: Employee ID 93950 from a previous period (§2.12).
insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, rtw_branch, employee_id) values
  (:'chloe', :'chloe_uid', 'Chloe', 'Nwosu', 'chloe@contract.test', '+447700900601', date '1997-05-05', 'contract', 'uk_irish', null),
  (:'dev',   :'dev_uid',   'Dev',   'Patel', 'dev@contract.test',   '+447700900602', date '1996-06-06', 'quiz',     'uk_irish', null),
  (:'ret',   :'ret_uid',   'Rhys',  'Evans', 'ret@contract.test',   '+447700900603', date '1995-07-07', 'contract', 'uk_irish', 93950);

-- =====================================================================
-- 1. Stage
-- =====================================================================
set local "request.jwt.claims" = '{"sub":"c3950000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$ select submit_hmrc_checklist(true, null, null, 'none', false, null, true) $$,
  'P0001', 'wrong_stage', 'the checklist waits for the quiz pass');
select throws_ok($$ select sign_contract(current_contract_version(), true) $$,
  'P0001', 'wrong_stage', 'and so does the contract');

-- =====================================================================
-- 2. Step 7 — HMRC (§2.8)
-- =====================================================================
set local "request.jwt.claims" = '{"sub":"c3950000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ select onboarding_save_references('[]'::jsonb) $$, 'P0001', 'previous_step',
  'references wait for the checklist');
select throws_ok($$ select submit_hmrc_checklist(null, null, null, 'none', false, null, true) $$,
  'P0001', 'answer_required', 'Q1 must be answered');
select throws_ok($$ select submit_hmrc_checklist(false, false, null, 'none', false, null, true) $$,
  'P0001', 'answer_required', 'Q1 = No and Q2 = No: Q3 must be answered');
select throws_ok($$ select submit_hmrc_checklist(false, false, false, 'none', false, null, false) $$,
  'P0001', 'declaration_required', 'the declaration tick is mandatory');
select throws_ok($$ select submit_hmrc_checklist(false, false, false, 'plan9', false, null, true) $$,
  'P0001', 'bad_student_loan', 'the student loan is one of No / Plan 1 / 2 / 4');
select throws_ok($$ select submit_hmrc_checklist(false, false, false, 'none', false, 'nonsense', true) $$,
  'P0001', 'invalid_ni', 'a malformed NI number is refused by the one rule that owns it');

select lives_ok($$ select submit_hmrc_checklist(true, true, true, 'plan1', true, null, true) $$,
  'Q1 = Yes, with stale answers still in the form, a plan AND a Postgraduate Loan');
select results_eq(
  $$ select statement::text, q2_pension, q3_since_6_april, student_loan::text, postgraduate_loan
       from hmrc_checklists where staff_id = 'c3960000-0000-4000-8000-000000000001' and not superseded $$,
  $$ values ('C'::text, null::boolean, null::boolean, 'plan1'::text, true) $$,
  'statement C; the hidden Q2/Q3 are stored as null; plan and PG loan together (§2.8)');

select lives_ok($$ select submit_hmrc_checklist(false, false, true, 'none', false, null, true) $$,
  'resubmitted before signing: Q1 No, Q2 No, Q3 Yes');
select is((select statement::text from hmrc_checklists where staff_id = :'chloe' and not superseded), 'B',
  'derives B');
select lives_ok($$ select submit_hmrc_checklist(false, true, null, 'none', false, null, true) $$, 'Q2 Yes');
select is((select statement::text from hmrc_checklists where staff_id = :'chloe' and not superseded), 'C',
  'a pension is C');
select lives_ok($$ select submit_hmrc_checklist(false, false, false, 'none', false, 'ab 12 34 56 c', true) $$,
  'Q1–Q3 all No, with an NI number');
select is((select statement::text from hmrc_checklists where staff_id = :'chloe' and not superseded), 'A',
  'first job since 6 April: A');
select is((select count(*)::int from hmrc_checklists where staff_id = :'chloe'), 1,
  'one current checklist, edited in place, not four');
select is((select ni_number from staff where id = :'chloe'), 'AB123456C', 'the NI number is stored normalised');
select is_empty(
  $$ select 1 from notification_outbox where template = 'E6' and key = 'E6:staff:c3960000-0000-4000-8000-000000000001' $$,
  '§2.10 / §8: entering it at onboarding queues NO E6 — that email is for "a worker who joined without an NI number" entering one later on the profile (330 pins that route), not for every candidate who has one');
select throws_ok($$ select submit_hmrc_checklist(false, false, false, 'none', false, 'CD 65 43 21 A', true) $$,
  'P0001', 'ni_locked', 'once entered it is locked — corrections go through the office');
select ok(
  not (submit_hmrc_checklist(false, false, false, 'none', false, 'AB123456C', true) ? 'statement'),
  'the same number again is fine, and the reply never carries the statement (§2.8)');

set local role authenticated;
select is((select count(*)::int from hmrc_checklists), 0,
  'and the worker cannot read the checklist table, where the letter is');
select is((onboarding_state()->'hmrc'->>'q1OtherJob'), 'false',
  'though their own answers come back through onboarding_state() to redraw the step');
reset role;

-- =====================================================================
-- 3. Step 8 — two references (§2.10)
-- =====================================================================
select throws_ok(
  $$ select onboarding_save_references('[{"name":"A","relationship":"Tutor","phone":"07700900456","email":"a@x.test"}]'::jsonb) $$,
  'P0001', 'two_references_required', 'two, always');
select throws_ok(
  $$ select onboarding_save_references('[{"name":"A","relationship":"Tutor","phone":"07700900456","email":""},
                                        {"name":"B","relationship":"Coach","phone":"07700900457","email":"b@x.test"}]'::jsonb) $$,
  'P0001', 'reference_incomplete', 'phone AND email — not either/or');
select throws_ok(
  $$ select onboarding_save_references('[{"name":"A","relationship":"Mother","phone":"07700900456","email":"a@x.test"},
                                        {"name":"B","relationship":"Coach","phone":"07700900457","email":"b@x.test"}]'::jsonb) $$,
  'P0001', 'reference_is_relative', 'no relatives');
select throws_ok(
  $$ select onboarding_save_references('[{"name":"A","relationship":"Step-father","phone":"07700900456","email":"a@x.test"},
                                        {"name":"B","relationship":"Coach","phone":"07700900457","email":"b@x.test"}]'::jsonb) $$,
  'P0001', 'reference_is_relative', 'including step-relatives');
select throws_ok(
  $$ select onboarding_save_references('[{"name":"A","relationship":"Tutor","phone":"07700900456","email":"a@x.test"},
                                        {"name":"A2","relationship":"Coach","phone":"07700900457","email":"A@x.test"}]'::jsonb) $$,
  'P0001', 'same_referee_twice', 'two different people');
select lives_ok(
  $$ select onboarding_save_references('[{"name":"Dr Helen Okafor","relationship":"Personal tutor, UCL","phone":"+44 20 7679 2000","email":"h.okafor@ucl.ac.uk"},
                                        {"name":"Sam Whitfield","relationship":"Volunteering supervisor, Crisis at Christmas","phone":"07700 900456","email":"sam@crisis.example"}]'::jsonb) $$,
  'a tutor and a volunteering supervisor are accepted — no work history needed');
select lives_ok(
  $$ select onboarding_save_references('[{"name":"Dr Helen Okafor","relationship":"Personal tutor, UCL","phone":"+44 20 7679 2000","email":"h.okafor@ucl.ac.uk"},
                                        {"name":"Coach Motherwell","relationship":"Motherwell FC youth coach","phone":"07700 900456","email":"coach@mfc.example"}]'::jsonb) $$,
  'edited: "Motherwell" is not a mother');
select is((select count(*)::int from staff_references where staff_id = :'chloe'), 2,
  'still exactly two on file');

-- =====================================================================
-- 4. Step 9 — bank (§2.10)
-- =====================================================================
select throws_ok($$ select onboarding_save_bank('Chloe Nwosu', '40-47', '31926819') $$,
  'P0001', 'bad_sort_code', 'staff_save_bank()''s format rules apply');
select lives_ok($$ select onboarding_save_bank('Chloe Nwosu', '404784', '31926819') $$, 'bank saved');
select is((select sort_code from bank_details where staff_id = :'chloe'), '40-47-84', 'formatted');
select isnt_empty(
  $$ select 1 from notification_outbox where template = 'E5' and payload->>'name' = 'Chloe Nwosu' $$,
  'E5 is queued, as it is for every later change (§2.10)');

-- =====================================================================
-- 5. Step 10 — the contract (§2.11)
-- =====================================================================
select is(current_contract_version(), 'placeholder-2026-09',
  'the current version is the flagged PLACEHOLDER until THC''s agreement is published (Appendix B)');
select ok((select body ~* 'declare any unspent criminal conviction' from contract_versions
            where version = current_contract_version()),
  'and it carries the ongoing duty to disclose convictions (§2.11, §10.7)');
select throws_ok($$ select sign_contract(current_contract_version(), false) $$,
  'P0001', 'agreement_required', 'unticked is not a signature');
select throws_ok($$ select sign_contract('some-older-version', true) $$,
  'P0001', 'contract_version_changed', 'a signature attaches only to the version shown');

select is(
  (select sign_contract(current_contract_version(), true)->>'stamp'),
  to_char(now() at time zone 'Europe/London', 'DD.MM.YYYY HH24:MI') || ' UK time',
  'signed: the stamp is the UK wall clock, labelled — never the viewer''s zone (§1.8)');
select results_eq(
  $$ select status::text, contract_version, contract_signed_at = now(), employee_id is not null
       from staff where id = 'c3960000-0000-4000-8000-000000000001' $$,
  $$ values ('compliant'::text, 'placeholder-2026-09'::text, true, true) $$,
  'the candidate becomes compliant, with the version signed, the time, and an Employee ID (§2.7)');
select isnt_empty(
  $$ select 1 from audit_log where action = 'contract_signed'
      and entity_id = 'c3960000-0000-4000-8000-000000000001'
      and data->>'version' = 'placeholder-2026-09' $$,
  'the signature is also in the audit log, which survives Reset to candidate');
select throws_ok($$ select sign_contract(current_contract_version(), true) $$,
  'P0001', 'wrong_stage', 'it cannot be signed twice');
select throws_ok($$ select submit_hmrc_checklist(true, null, null, 'none', false, null, true) $$,
  'P0001', 'wrong_stage', 'and steps 7–9 close once it is signed');

-- The returning worker keeps their Employee ID.
set local "request.jwt.claims" = '{"sub":"c3950000-0000-4000-8000-000000000003","role":"authenticated"}';
select lives_ok($$ select submit_hmrc_checklist(true, null, null, 'none', false, null, true) $$, 'Rhys: checklist');
select lives_ok(
  $$ select onboarding_save_references('[{"name":"Ann Lee","relationship":"Former manager","phone":"07700900111","email":"ann@x.test"},
                                        {"name":"Bo Kim","relationship":"Course leader","phone":"07700900112","email":"bo@x.test"}]'::jsonb) $$,
  'references');
select lives_ok($$ select onboarding_save_bank('Rhys Evans', '20-00-00', '12345678') $$, 'bank');
select is((select (sign_contract(current_contract_version(), true)->>'employeeId')::int), 93950,
  'signing again after a reset keeps the Employee ID he already had (§2.12 point 2)');

-- =====================================================================
-- 6. Step 11 — How it works
-- =====================================================================
select lives_ok($$ select onboarding_finish_tutorial() $$, 'the tutorial is finished after signing');
set local "request.jwt.claims" = '{"sub":"c3950000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$ select onboarding_finish_tutorial() $$, 'P0001', 'wrong_stage',
  'and not before');

-- =====================================================================
-- 7. The versions themselves
-- =====================================================================
reset role;
select throws_ok(
  $$ update contract_versions set body = body || ' amended' where version = 'placeholder-2026-09' $$,
  'P0001', null, 'a published version cannot be edited — publish a new one');
select throws_ok(
  $$ insert into contract_versions (version, title, body) values ('no-duty', 'T', 'Nothing about convictions.') $$,
  '23514', null, 'a version without the duty to disclose cannot exist (§2.11)');

select ok(
  not has_function_privilege('anon', 'public.sign_contract(text, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.submit_hmrc_checklist(boolean, boolean, boolean, text, boolean, text, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.submit_quiz_attempt(jsonb)', 'execute'),
  'anon can call none of them');

select * from finish();
rollback;
