-- =====================================================================
-- 899 · Allow 3 more attempts at the H&S quiz (ADR-0168)
--   20261021100000_quiz_more_attempts.sql
--
--   1. Grants: the office RPC is closed to anon and PUBLIC; the worker
--      function is service role only.
--   2. Only the office: a client and a worker are refused, a viewer is
--      refused by office_read_only, and nothing moves.
--   3. The reason is mandatory; only a candidate the QUIZ rejected (not
--      one the office rejected, not one still in the quiz), and only while
--      the §2.3 gate is clear (a missing document keeps the quiz locked).
--   4. The office sends a quiz-rejected candidate back to Quiz: the three
--      attempts kept and superseded, quiz_attempts 0, rejection cleared,
--      one audit row; the board counts 0 used and keeps the scores.
--   5. The worker then has three attempts again — the third failure
--      rejects again with a new E4 — and a pass moves them on.
--   6. The state machine has the edge, and only from rejected.
-- =====================================================================
begin;
select plan(32);
\ir _shared/fixtures.psql

\set viewer    '89900000-0000-4000-8000-000000000001'
\set w1_uid    '89900000-0000-4000-8000-000000000011'
\set w2_uid    '89900000-0000-4000-8000-000000000012'
\set w1        '89910000-0000-4000-8000-000000000001'
\set w2        '89910000-0000-4000-8000-000000000002'
\set by_office '89910000-0000-4000-8000-000000000003'
\set locked    '89910000-0000-4000-8000-000000000004'

insert into auth.users (id, email) values
  (:'viewer', 'viewer@io899.test'), (:'w1_uid', 'w1@io899.test'), (:'w2_uid', 'w2@io899.test');
insert into profiles (id, role, office_role, full_name) values
  (:'viewer', 'admin', 'viewer', 'Vi Viewer'),
  (:'w1_uid', 'staff', null, 'Abe'),
  (:'w2_uid', 'staff', null, 'Bea');
insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'w1', :'w1_uid', 'Abe', 'Test', 'w1@io899.test', '+447700989901', date '1998-01-01', 'quiz', 'uk_irish'),
  (:'w2', :'w2_uid', 'Bea', 'Test', 'w2@io899.test', '+447700989902', date '1998-01-02', 'quiz', 'uk_irish');
insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch,
                   rejected_from, rejection_cause, rejection_reason) values
  (:'by_office', 'Cal', 'Test', 'c@io899.test', '+447700989903', date '1998-01-03', 'rejected', 'uk_irish',
   'documents', 'manager', 'No show at the interview'),
  (:'locked', 'Dee', 'Test', 'd@io899.test', '+447700989904', date '1998-01-04', 'rejected', 'uk_irish',
   'quiz', 'quiz_failed', null);

-- Abe's §2.3 evidence, as a candidate who reached the quiz has it (391 · 5).
-- Dee has none: her documents are what stands between her and the quiz.
insert into compliance_docs (staff_id, doc_type, file_path, review_status, uploaded_at)
values (:'w1', 'passport', :'w1' || '/passport/2027.jpg', 'pending', clock_timestamp());
insert into criminal_declarations (staff_id, source, answer) values (:'w1', 'onboarding', false);
update compliance_docs set review_status = 'verified', reviewed_at = now()
 where staff_id = :'w1' and review_status = 'pending';

create temporary table sheet as
  select jsonb_object_agg(id::text, correct_index) as all_right,
         jsonb_object_agg(id::text, case when position <= 3
                                         then (correct_index + 1) % array_length(options, 1)
                                         else correct_index end) as three_wrong
    from quiz_questions where active;

-- Abe fails three times (§2.9) — rejected, E4.
set local "request.jwt.claims" = '{"sub":"89900000-0000-4000-8000-000000000011","role":"authenticated"}';
select lives_ok($$ select onboarding_complete_induction() $$, 'Abe completes the induction');
select is((select submit_quiz_attempt(three_wrong)->>'outcome' from sheet), 'retry', 'fail 1');
select is((select submit_quiz_attempt(three_wrong)->>'outcome' from sheet), 'retry', 'fail 2');
select is((select submit_quiz_attempt(three_wrong)->>'outcome' from sheet), 'rejected',
  'Abe is rejected by the third failure');
reset role;

-- 1 · Grants.
select ok(not has_function_privilege('anon', 'public.onboarding_grant_quiz_attempts(uuid, text)', 'execute')
      and not has_function_privilege('public', 'public.onboarding_grant_quiz_attempts(uuid, text)', 'execute'),
  'anon and PUBLIC cannot execute onboarding_grant_quiz_attempts');
select ok(not has_function_privilege('authenticated', 'public.grant_quiz_attempts(uuid, text, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.grant_quiz_attempts(uuid, text, uuid)', 'execute'),
  'grant_quiz_attempts is not callable by any session');

-- 2 · Who may.
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select onboarding_grant_quiz_attempts(%L, 'testing') $$, :'w1'),
  '42501', null, 'a client is refused');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'w1_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select onboarding_grant_quiz_attempts(%L, 'let me in') $$, :'w1'),
  '42501', null, 'the worker cannot give themselves attempts');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select onboarding_grant_quiz_attempts(%L, 'testing') $$, :'w1'),
  '42501', null, 'a viewer is refused');
reset role;

select is((select status::text from staff where id = :'w1'), 'rejected',
  'after every refusal Abe is still rejected');
select is(onboarding_quiz_blockers(:'w1'), '{}'::text[],
  'nothing stands between Abe and the quiz but the three failures');

-- 3 · Reason, and only a candidate the quiz rejected.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select onboarding_grant_quiz_attempts(%L, '  ') $$, :'w1'),
  '22023', 'reason_required', 'a blank reason is refused');
select throws_like(format($$ select onboarding_grant_quiz_attempts(%L, 'testing') $$, :'by_office'),
  'not_quiz_rejected%', 'a candidate the office rejected is refused: Reset to candidate is theirs');
select throws_like(format($$ select onboarding_grant_quiz_attempts(%L, 'testing') $$, :'w2'),
  'not_quiz_rejected%', 'a candidate still in the quiz is refused');
select throws_like(format($$ select onboarding_grant_quiz_attempts(%L, 'testing') $$, :'locked'),
  'quiz_locked%', 'a quiz-rejected candidate with a document outstanding is refused: §2.3 keeps the quiz locked');

-- 4 · The office allows three more.
select is(onboarding_grant_quiz_attempts(:'w1', '  Scored 70% three times  ') ->> 'status', 'quiz',
  'the office allows Abe three more attempts');
reset role;

select results_eq(
  format($$ select status::text, quiz_attempts, rejected_at, rejected_from::text, rejection_cause
              from staff where id = %L $$, :'w1'),
  $$ values ('quiz'::text, 0, null::timestamptz, null::text, null::text) $$,
  'Abe is back in Quiz, no attempts used, the rejection cleared');
select is(
  (select array_agg(superseded order by attempt_no) from quiz_attempts where staff_id = :'w1'),
  array[true, true, true], 'his three attempts stay, read-only, and stop counting');
select isnt((select induction_at from onboarding_progress where staff_id = :'w1'), null,
  'his induction stands: no wizard step is redone');
select results_eq(
  format($$ select actor::text, data ->> 'reason', data ->> 'byName', data -> 'setAside'
              from audit_log where action = 'quiz_attempts_granted' and entity_id = %L $$, :'w1'),
  format($$ values (%L, 'Scored 70%% three times', 'Gisela M.', '[70, 70, 70]'::jsonb) $$, :'admin_uid'),
  'one audit row: who, the trimmed reason, their name and the scores set aside');
select results_eq(
  format($$ select quiz_attempts_used, cardinality(quiz_scores) from onboarding_candidates_v where id = %L $$, :'w1'),
  $$ values (0, 3) $$,
  'the board counts none of the current three used, and keeps the three scores');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_like(format($$ select onboarding_grant_quiz_attempts(%L, 'again') $$, :'w1'),
  'not_quiz_rejected%', 'a second call while he is in the quiz is refused');
reset role;

-- 5 · Three attempts again; the third failure rejects again, with a new E4.
set local "request.jwt.claims" = '{"sub":"89900000-0000-4000-8000-000000000011","role":"authenticated"}';
select is((select submit_quiz_attempt(three_wrong) from sheet) ->> 'attemptsLeft', '2',
  'his first new attempt leaves two');
select is((select submit_quiz_attempt(three_wrong) from sheet) ->> 'attemptsLeft', '1',
  'the second leaves one');
select is((select submit_quiz_attempt(three_wrong) from sheet) ->> 'outcome', 'rejected',
  'the third failure rejects him again');
reset role;
select is((select rejection_cause from staff where id = :'w1'), 'quiz_failed',
  'as a quiz failure, so the office could allow more again');
select is((select count(*)::int from notification_outbox where template = 'E4' and recipient_staff_id = :'w1'), 2,
  'and a second E4 is queued');

-- Allowed once more, he passes and moves on.
select is(grant_quiz_attempts(:'w1', 'Last go, by phone', :'admin_uid') ->> 'status', 'quiz',
  'the service-role function allows three more too');
set local "request.jwt.claims" = '{"sub":"89900000-0000-4000-8000-000000000011","role":"authenticated"}';
select is((select submit_quiz_attempt(all_right) from sheet) ->> 'outcome', 'passed', 'he passes');
reset role;
select is((select status::text from staff where id = :'w1'), 'contract',
  'and goes on to the contract (the pass is in this onboarding period)');

-- 6 · The machine.
select ok(exists (select 1 from staff_transitions where from_status = 'rejected' and to_status = 'quiz'),
  'rejected → quiz is an edge of §2.12');
select is_empty($$ select 1 from staff_transitions where to_status = 'quiz' and from_status not in ('documents', 'rejected') $$,
  'and the quiz is entered only from documents or rejected');

select * from finish();
rollback;
