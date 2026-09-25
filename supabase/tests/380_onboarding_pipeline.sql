-- =====================================================================
-- 380 · The onboarding pipeline, office side (§2.2, §2.3, §2.4, §2.12)
--   20260923110000_onboarding_pipeline.sql
--
-- What this pins, in the order a candidate meets it:
--   A. The §2.12 machine on the ROW: every move touching an onboarding
--      status is an edge of staff_transitions or it is refused — asserted
--      pair by pair against the table, not by a list of examples. And the
--      three evidence gates: nobody skips the quiz or the contract.
--   B. The quiz unlocks by itself when the last item is verified (§2.3);
--      a No declaration is verified on submission.
--   C. The office RPCs refuse client, worker and anon callers.
--   D-G. Accept (roles mandatory, E3), Reject (reason mandatory, E2),
--      document Verify / Reject (N8), declaration Verify / Reject.
--   H. The returning applicant (§2.12): Reset to candidate or reject.
--   I. Willo, driven by settings.willo_stage_map, service role only.
--   J. The two read views across admin / client / staff / anon.
-- =====================================================================
begin;
select plan(76);
\ir _shared/fixtures.psql

\set c_req      '38000000-0000-4000-8000-000000000001'
\set c_done     '38000000-0000-4000-8000-000000000002'
\set c_docs     '38000000-0000-4000-8000-000000000003'
\set c_quiz     '38000000-0000-4000-8000-000000000004'
\set c_contract '38000000-0000-4000-8000-000000000005'
\set c_rej      '38000000-0000-4000-8000-000000000006'
\set c_student  '38000000-0000-4000-8000-000000000007'
\set c_willo    '38000000-0000-4000-8000-000000000008'
\set d_pass     '38000000-0000-4000-8000-0000000000d1'
\set d_term     '38000000-0000-4000-8000-0000000000d2'
\set d_ni       '38000000-0000-4000-8000-0000000000d3'
\set decl_yes   '38000000-0000-4000-8000-0000000000e1'
\set applic_rej '38000000-0000-4000-8000-0000000000a1'
\set applic_new '38000000-0000-4000-8000-0000000000a2'

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch, share_code, employee_id) values
  (:'c_req',      'Noor',  'Ahmed',  'noor@onb.test',  '+447700938001', date '2004-01-10', 'interview_requested', null, null, null),
  (:'c_done',     'Mei',   'Lin',    'mei@onb.test',   '+447700938002', date '2003-05-02', 'interview_completed', null, null, null),
  (:'c_docs',     'Aisha', 'Bello',  'aisha@onb.test', '+447700938003', date '2001-07-07', 'documents', 'uk_irish', null, null),
  (:'c_quiz',     'Ivan',  'Petrov', 'ivan@onb.test',  '+447700938004', date '2000-02-02', 'quiz', 'uk_irish', null, null),
  (:'c_contract', 'Theo',  'Baker',  'theo@onb.test',  '+447700938005', date '1999-09-09', 'contract', 'uk_irish', null, null),
  (:'c_rej',      'Carl',  'Voss',   'carl@onb.test',  '+447700938006', date '1998-03-03', 'rejected', null, null, 99412),
  (:'c_student',  'Hana',  'Kowal',  'hana@onb.test',  '+447700938007', date '2005-04-03', 'documents', 'international_student', null, null),
  (:'c_willo',    'Lily',  'Owen',   'lily@onb.test',  '+447700938008', date '2002-06-06', 'interview_requested', null, null, null);

-- =====================================================================
-- A · the machine on the row
-- =====================================================================
select has_trigger('staff', 'staff_status_guard', 'staff carries the §2.12 row guard');

-- Every ordered pair of distinct statuses where either side is an
-- onboarding status, tried on a fresh row. A refusal naming
-- illegal_staff_transition must happen for EXACTLY the pairs that are not
-- edges of staff_transitions — no more (a legal edge refused by the edge
-- check) and no fewer (an illegal one let through).
create temp table tried (from_status staff_status, to_status staff_status, outcome text);
do $$
declare
  f staff_status; t staff_status; v_id uuid; v_err text;
  onboarding staff_status[] := array['interview_requested','interview_completed','documents',
                                     'quiz','additional_info','contract']::staff_status[];
begin
  foreach f in array enum_range(null::staff_status) loop
    foreach t in array enum_range(null::staff_status) loop
      continue when f = t;
      continue when not (f = any(onboarding) or t = any(onboarding));
      v_id := gen_random_uuid();
      insert into staff (id, first_name, last_name, email, phone, dob, status)
      values (v_id, 'Pair', 'Probe', 'pair@onb.test', '+447700938999', date '1990-01-01', f);
      begin
        update staff set status = t where id = v_id;
        v_err := 'ok';
      exception when others then
        v_err := sqlerrm;
      end;
      insert into tried values (f, t, v_err);
    end loop;
  end loop;
end $$;

select bag_eq(
  $$ select from_status, to_status from tried where outcome like 'illegal_staff_transition%' $$,
  $$ select f.v as from_status, t.v as to_status
       from unnest(enum_range(null::staff_status)) f(v)
       cross join unnest(enum_range(null::staff_status)) t(v)
      where f.v <> t.v
        and (f.v in ('interview_requested','interview_completed','documents','quiz','additional_info','contract')
          or t.v in ('interview_requested','interview_completed','documents','quiz','additional_info','contract'))
        and not exists (select 1 from staff_transitions x where x.from_status = f.v and x.to_status = t.v) $$,
  'the row guard refuses exactly the onboarding pairs that are not §2.12 edges — the SQL twin of canTransitionStaff');

select is((select count(*)::int from tried where from_status = 'documents' and to_status = 'compliant' and outcome like 'illegal%'), 1,
  'a candidate in Documents can never jump to compliant — the quiz and the contract cannot be skipped');
select is((select count(*)::int from tried where from_status = 'quiz' and to_status = 'compliant' and outcome like 'illegal%'), 1,
  'nor from the Quiz stage straight to compliant');
select is((select count(*)::int from tried where (from_status = 'additional_info' or to_status = 'additional_info') and outcome = 'ok'), 0,
  'additional_info is never entered or left: it is a board column, not a status (ADR-0013)');

-- Evidence gates.
select throws_like($$ update staff set status = 'quiz' where id = '38000000-0000-4000-8000-000000000003' $$,
  'quiz_locked:%', 'documents → quiz is refused while anything is missing or unverified (§2.3)');
select throws_ok($$ update staff set status = 'contract' where id = '38000000-0000-4000-8000-000000000004' $$,
  'P0001', 'quiz_not_passed', 'quiz → contract is refused without a passed attempt in this period (§2.9)');

insert into quiz_attempts (staff_id, attempt_no, score, passed, answers)
values (:'c_quiz', 1, 90, true, '{}');
select lives_ok($$ update staff set status = 'contract' where id = '38000000-0000-4000-8000-000000000004' $$,
  'and allowed once the attempt is passed');

select throws_ok($$ update staff set status = 'compliant' where id = '38000000-0000-4000-8000-000000000005' $$,
  'P0001', 'contract_not_signed', 'contract → compliant is refused without the signature timestamp (§2.11)');
update staff set status = 'compliant', contract_signed_at = now(), contract_version = 'v3' where id = :'c_contract';
select isnt((select employee_id from staff where id = :'c_contract'), null,
  'signing issues the Employee ID at that moment (§2.7)');
select ok((select stage_entered_at >= now() - interval '1 minute' from staff where id = :'c_contract'),
  'and stamps when the new stage was entered');

-- =====================================================================
-- B · automatic unlock
-- =====================================================================
insert into criminal_declarations (staff_id, source, answer)
values (:'c_docs', 'onboarding', false);
select is((select review_status::text from criminal_declarations where staff_id = :'c_docs'), 'verified',
  'a No declaration is verified on submission and never waits for a manager (§2.10)');

insert into compliance_docs (id, staff_id, doc_type, file_path, review_status)
values (:'d_pass', :'c_docs', 'passport', 'c_docs/passport.pdf', 'pending');
select is(onboarding_quiz_blockers(:'c_docs'), array['document_unverified:passport'],
  'with the passport uploaded, the only blocker left is that it is unverified');
select bag_eq($$ select unnest(onboarding_documents_missing('38000000-0000-4000-8000-000000000007')) $$,
  $$ values ('passport'), ('university_term_dates_letter'), ('share_code'), ('criminal_declaration') $$,
  'an International student owes a passport, the term dates letter, a typed share code and the declaration — exactly §2.5 pt 4');

-- =====================================================================
-- C · who may call the office RPCs
-- =====================================================================
select is_empty(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('onboarding_accept','onboarding_reject','verify_document','reject_document',
                          'verify_declaration','reject_declaration','onboarding_resolve_returning',
                          'willo_record_event','willo_link_candidate','onboarding_advance_if_ready')
        and has_function_privilege('anon', p.oid, 'execute') $$,
  'anon can execute none of the onboarding write paths');
select is_empty(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('willo_record_event','willo_link_candidate','onboarding_advance_if_ready',
                          'onboarding_do_accept','onboarding_do_reject')
        and has_function_privilege('authenticated', p.oid, 'execute') $$,
  'no signed-in account can drive Willo events or the internal accept/reject bodies');

-- a client
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok($$ select onboarding_reject('38000000-0000-4000-8000-000000000001', 'x') $$,
  '42501', 'not_authorised', 'a client cannot reject a candidate');
select throws_ok($$ select verify_document('38000000-0000-4000-8000-0000000000d1') $$,
  '42501', 'not_authorised', 'a client cannot verify a document');
select is((select count(*)::int from onboarding_candidates_v), 0, 'a client reads no candidates');
select is((select count(*)::int from onboarding_returning_v), 0, 'nor any returning applicant');

-- a worker
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select throws_ok($$ select onboarding_accept_with_account('38000000-0000-4000-8000-000000000002', array['bbbbbbbb-0000-4000-8000-000000000001']::uuid[], null, '44444444-4444-4444-4444-444444444444', 'https://x', 'https://y') $$,
  '42501', 'not_authorised', 'a worker cannot accept a candidate');
select throws_ok($$ select reject_document('38000000-0000-4000-8000-0000000000d1', 'x') $$,
  '42501', 'not_authorised', 'a worker cannot reject a document');
select throws_ok($$ select onboarding_resolve_returning('6a6a6a6a-0000-4000-8000-000000000001', 'reset', 'x') $$,
  '42501', 'not_authorised', 'a worker cannot reset anybody');
select is((select array_agg(id::text) from onboarding_candidates_v), array['dddddddd-0000-4000-8000-000000000001'],
  'a worker reads only their own row in the candidate view');
select is_empty($$ update staff set status = 'quiz' where id = '38000000-0000-4000-8000-000000000003' returning 1 $$,
  'a worker cannot move a candidate at all: no update policy on staff reaches the row');
select throws_ok($$ select willo_record_event('W-1', 'new_response') $$,
  '42501', null, 'a signed-in account cannot post a Willo event');

-- anon
reset role;
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok($$ select onboarding_reject('38000000-0000-4000-8000-000000000001', 'x') $$,
  '42501', null, 'anon cannot reach the office RPCs at all');
select throws_ok($$ select count(*) from onboarding_candidates_v $$,
  '42501', null, 'anon cannot read the candidate view');

-- =====================================================================
-- D · Accept (§2.4)
-- =====================================================================
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is((select count(*)::int from onboarding_candidates_v where id in
            (:'c_req', :'c_done', :'c_docs', :'c_quiz', :'c_rej', :'c_student', :'c_willo')), 7,
  'the office reads every candidate');
-- admin_all lets a manager UPDATE staff through PostgREST. The row guard
-- is what stops that door being a way round the quiz.
select throws_like($$ update staff set status = 'compliant' where id = '38000000-0000-4000-8000-000000000007' $$,
  'illegal_staff_transition%', 'a manager writing status directly still cannot skip the quiz and the contract');

-- The office's Accept is onboarding_accept_with_account() (20260923180000),
-- which links the login and then runs onboarding_accept() as owner. The
-- bare five-argument form is no longer granted to any signed-in role
-- (20260923200000); its rules are exercised here as the owner, with the
-- manager's identity still in the claims — assert_office_caller() reads it.
select ok(not has_function_privilege('authenticated', 'onboarding_accept(uuid,uuid[],text,text,text)', 'execute'),
  'the bare onboarding_accept() is not callable by a signed-in session — Accept links the login first');
reset role;
select throws_ok($$ select onboarding_accept('38000000-0000-4000-8000-000000000002', '{}'::uuid[], null, 'https://x', 'https://y') $$,
  '22023', 'roles_required', 'Accept needs at least one qualified role (§2.4)');
select throws_like($$ select onboarding_accept('38000000-0000-4000-8000-000000000001', array['bbbbbbbb-0000-4000-8000-000000000001']::uuid[], null, 'https://x', 'https://y') $$,
  'not_awaiting_decision%', 'a candidate whose interview is not complete cannot be accepted');
select throws_ok($$ select onboarding_accept('38000000-0000-4000-8000-000000000002', array['bbbbbbbb-0000-4000-8000-000000000001']::uuid[], null, '', 'https://y') $$,
  '22023', 'activation_link_required', 'E3 is never queued without its activation link');
select lives_ok($$ select onboarding_accept('38000000-0000-4000-8000-000000000002', array['bbbbbbbb-0000-4000-8000-000000000001']::uuid[], 'strong English', 'https://staff.test/activate', 'https://staff.test/install') $$,
  'the office accepts with a role');

reset role;
select is((select status::text from staff where id = :'c_done'), 'documents', 'Accept moves the card to Documents');
select is((select count(*)::int from staff_roles where staff_id = :'c_done'), 1, 'and records the qualified role');
select is((select payload ->> 'link' from notification_outbox where template = 'E3' and recipient_emails = array['mei@onb.test']),
  'https://staff.test/activate', 'and queues E3 to the candidate with the activation link');
select is((select willo_decided_via from staff where id = :'c_done'), 'office', 'the decision is recorded as the office mirror of Willo');

-- =====================================================================
-- E · Reject candidate (§2.3)
-- =====================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok($$ select onboarding_reject('38000000-0000-4000-8000-000000000001', '  ') $$,
  '22023', 'reason_required', 'Reject candidate needs a reason');
select throws_like($$ select onboarding_reject('dddddddd-0000-4000-8000-000000000001', 'no') $$,
  'not_a_candidate%', 'a compliant worker is not rejected here — Block is §9.6''s tool');
select lives_ok($$ select onboarding_reject('38000000-0000-4000-8000-000000000001', 'No show to the interview') $$,
  'the office rejects a candidate');
reset role;
select results_eq(
  $$ select status::text, rejected_from::text, rejection_cause, rejection_reason, rejected_by::text from staff where id = '38000000-0000-4000-8000-000000000001' $$,
  $$ values ('rejected', 'interview_requested', 'manager', 'No show to the interview', '11111111-1111-1111-1111-111111111111') $$,
  'rejected, with the column it came from, the cause, the reason and who');
-- Noor is still at Interview requested: she has not done the interview, so
-- E2's "thank you for completing your interview" would be untrue. She gets
-- E2b (D44, 20260930130300; 440 holds the rule).
select is((select count(*)::int from notification_outbox where template = 'E2b' and recipient_emails = array['noor@onb.test']), 1,
  'and E2b goes to the candidate — the interview was never done, so not E2 (D44)');
select is((select payload ? 'reason' from notification_outbox where template = 'E2b' and recipient_emails = array['noor@onb.test']), false,
  'the rejection email never carries the office''s reason');

-- =====================================================================
-- F · Documents (§2.3)
-- =====================================================================
insert into compliance_docs (id, staff_id, doc_type, file_path, review_status, term_dates) values
  (:'d_term', :'c_student', 'university_term_dates_letter', 'c_student/term.pdf', 'pending',
   array['[2026-12-13,2027-01-11)'::daterange]),
  (:'d_ni', :'c_student', 'ni_evidence', 'c_student/ni.jpg', 'pending', null);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok($$ select reject_document('38000000-0000-4000-8000-0000000000d3', '') $$,
  'P0001', 'reason_required', 'rejecting a document needs a reason');
select lives_ok($$ select reject_document('38000000-0000-4000-8000-0000000000d3', 'Number obscured — please re-upload') $$,
  'the office rejects a document');
select throws_like($$ select verify_document('38000000-0000-4000-8000-0000000000d3') $$,
  'not_pending%', 'a rejected document is not verified — the worker re-uploads (§2.3)');
select lives_ok($$ select verify_document('38000000-0000-4000-8000-0000000000d2', null,
                    array['[2026-12-13,2027-01-11)'::daterange, '[2027-03-27,2027-04-26)'::daterange]) $$,
  'the office verifies the term letter with a period it added by hand (+ Add period)');
select lives_ok($$ select verify_document('38000000-0000-4000-8000-0000000000d1') $$,
  'and verifies the last outstanding passport');
reset role;

select results_eq(
  $$ select template, recipient_staff_id::text, payload ->> 'reason' from notification_outbox where key = 'N8:doc:38000000-0000-4000-8000-0000000000d3' $$,
  $$ values ('N8', '38000000-0000-4000-8000-000000000007', 'Number obscured — please re-upload') $$,
  'Reject queues N8 to the worker with the reason word for word');
select is((select status::text from staff where id = :'c_student'), 'documents',
  'rejecting a document is not rejecting the candidate');
select is((select cardinality(term_dates) from staff where id = :'c_student'), 2,
  'the verified periods are the cap''s only input (RULE-20) — both reach the worker');
select is((select reviewed_by::text from compliance_docs where id = :'d_term'), '11111111-1111-1111-1111-111111111111',
  'the reviewer is recorded for the UK-time audit stamp');
select is((select status::text from staff where id = :'c_docs'), 'quiz',
  'verifying the last item moved Aisha to the Quiz by herself (§2.3)');

-- =====================================================================
-- G · A Yes declaration (§2.10)
-- =====================================================================
insert into criminal_declarations (id, staff_id, source, answer, details)
values (:'decl_yes', :'c_student', 'onboarding', true, 'Driving without insurance, 2024');
select is((select review_status::text from criminal_declarations where id = :'decl_yes'), 'pending',
  'a Yes declaration waits for a manager');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok($$ select reject_declaration('38000000-0000-4000-8000-0000000000e1', 'Please add the date of the conviction') $$,
  'a Yes declaration can be rejected with a reason');
select throws_like($$ select verify_declaration('38000000-0000-4000-8000-0000000000e1') $$,
  'not_pending%', 'and is then no longer under review');
reset role;
select is((select count(*)::int from notification_outbox where key = 'N8:declaration:' || :'decl_yes'), 1,
  'an onboarding declaration rejection sends N8, like a document');

-- =====================================================================
-- H · Returning applicant (§2.12)
-- =====================================================================
insert into applications (id, first_name, last_name, email, phone, dob, age_band, outcome, matched_on, staff_id, consented_at) values
  (:'applic_rej', 'Carl', 'Voss', 'carl@onb.test', '+447700938006', date '1998-03-03', '28', 'returning_applicant', 'email_dob', :'c_rej', now()),
  (:'applic_new', 'Staff', 'Alpha', 'someone@onb.test', '+447700900011', date '1995-01-01', '31_40', 'returning_applicant', 'msisdn_dob', 'dddddddd-0000-4000-8000-000000000001', now());

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select count(*)::int from onboarding_returning_v where application_id in (:'applic_rej', :'applic_new', :'applic_a')), 3,
  'the office sees every unresolved returning applicant');
select throws_like($$ select onboarding_resolve_returning('6a6a6a6a-0000-4000-8000-000000000001', 'reset', 'came back') $$,
  'not_resettable%', 'Reset is refused on a compliant record — the §9.6 function decides, not the screen');
select lives_ok($$ select onboarding_resolve_returning('38000000-0000-4000-8000-0000000000a1', 'reset', 'Worth another look') $$,
  'Reset to candidate from the returning-applicant card');
select throws_like($$ select onboarding_resolve_returning('38000000-0000-4000-8000-0000000000a1', 'reject', 'x') $$,
  'already_resolved%', 'an entry is acted on once');
select lives_ok($$ select onboarding_resolve_returning('38000000-0000-4000-8000-0000000000a2', 'reject', 'Already working for us') $$,
  'or the application is rejected');
reset role;

select results_eq(
  $$ select status::text, employee_id, rejected_from, rejection_reason from staff where id = '38000000-0000-4000-8000-000000000006' $$,
  $$ values ('interview_requested'::text, 99412, null::staff_status, null::text) $$,
  'Reset: back to Interview requested, the Employee ID kept, the old rejection cleared (§2.12)');
select ok((select onboarding_started_at > now() - interval '1 minute' from staff where id = :'c_rej'),
  'and a new onboarding period starts, so old evidence cannot satisfy the new gates');
select is((select count(*)::int from notification_outbox where key = 'E2b:application:' || :'applic_new' and recipient_emails = array['someone@onb.test']), 1,
  'a rejected application gets E2b at the address on the application — never a reason, and not the interview wording');
select is((select status::text from staff where id = 'dddddddd-0000-4000-8000-000000000001'), 'compliant',
  'and the matched record is untouched');

-- =====================================================================
-- I · Willo (§2.4), service role, driven by settings.willo_stage_map
-- =====================================================================
set local role service_role;
select lives_ok($$ select willo_link_candidate('38000000-0000-4000-8000-000000000008', 'W-lily') $$,
  'the integration records the Willo candidate');
select is(willo_record_event('W-lily', 'new_response') ->> 'outcome', 'interview_completed',
  'New Response moves the card to Interview completed by itself');
select is(willo_record_event('W-lily', 'new_response') ->> 'outcome', 'unchanged',
  'a retried webhook is a no-op, not an illegal transition');
select throws_ok($$ select willo_record_event('W-lily', 'accepted') $$,
  '22023', 'activation_link_required', 'Accept from Willo still needs E3''s link');
select is(willo_record_event('W-lily', 'unknown_stage') ->> 'outcome', 'ignored',
  'a Willo stage the map does not name changes nothing');
reset role;
update settings set value = jsonb_set(value, '{accepted}', '"rejected"') where key = 'willo_stage_map';
set local role service_role;
select is(willo_record_event('W-lily', 'accepted') ->> 'outcome', 'rejected',
  'the map is data: remapped in /settings, the same event now rejects — no release needed');
reset role;
select results_eq(
  $$ select status::text, rejection_cause, rejected_from::text, willo_decision from staff where id = '38000000-0000-4000-8000-000000000008' $$,
  $$ values ('rejected', 'willo', 'interview_completed', 'rejected') $$,
  'a Willo rejection rejects automatically and records the cause');
select is((select count(*)::int from notification_outbox where template = 'E2' and recipient_emails = array['lily@onb.test']), 1,
  'and sends the same E2 as every other rejection route');

select * from finish();
rollback;
