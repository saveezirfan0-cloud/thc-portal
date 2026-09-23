-- =====================================================================
-- 391 · Onboarding wizard, steps 5–6 — 20260923120100
--       (§2.9, §2.12, §10.1 case 3, §8 E4)
--
--   · the induction and the quiz are open only in the `quiz` stage, and
--     the quiz only after the induction;
--   · the worker gets the questions without the key, and cannot read the
--     key table;
--   · 80% passes, compared exactly; three attempts; the third failure
--     rejects the candidate and queues E4 to them — and a pass on the
--     third attempt is still a pass;
--   · Reset to candidate starts the three attempts again without
--     colliding with the old ones, which stay as history (§2.12).
--
-- Answers are built from quiz_questions itself, so these hold whatever
-- THC's real questions turn out to be.
-- =====================================================================
begin;
select plan(37);

\set pass_uid  'c3930000-0000-4000-8000-000000000001'
\set fail_uid  'c3930000-0000-4000-8000-000000000002'
\set late_uid  'c3930000-0000-4000-8000-000000000003'
\set early_uid 'c3930000-0000-4000-8000-000000000004'
\set pass      'c3940000-0000-4000-8000-000000000001'
\set fail      'c3940000-0000-4000-8000-000000000002'
\set late      'c3940000-0000-4000-8000-000000000003'
\set early     'c3940000-0000-4000-8000-000000000004'

insert into auth.users (id, email) values
  (:'pass_uid', 'pass@quiz.test'), (:'fail_uid', 'fail@quiz.test'),
  (:'late_uid', 'late@quiz.test'), (:'early_uid', 'early@quiz.test');
insert into profiles (id, role, full_name) values
  (:'pass_uid', 'staff', 'Pass'), (:'fail_uid', 'staff', 'Fail'),
  (:'late_uid', 'staff', 'Late'), (:'early_uid', 'staff', 'Early');
insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'pass',  :'pass_uid',  'Priya', 'Shah',  'pass@quiz.test',  '+447700900501', date '1998-01-01', 'quiz', 'uk_irish'),
  (:'fail',  :'fail_uid',  'Fergus', 'Hale', 'fail@quiz.test',  '+447700900502', date '1998-01-02', 'quiz', 'uk_irish'),
  (:'late',  :'late_uid',  'Lena', 'Moss',   'late@quiz.test',  '+447700900503', date '1998-01-03', 'quiz', 'uk_irish'),
  (:'early', :'early_uid', 'Eli', 'Park',    'early@quiz.test', '+447700900504', date '1998-01-04', 'documents', 'uk_irish');

-- The answer sheets, from the key. `wrong(n)` gets the first n questions wrong.
create temporary table sheet as
  select jsonb_object_agg(id::text, correct_index) as all_right,
         jsonb_object_agg(id::text, case when position <= 2
                                         then (correct_index + 1) % array_length(options, 1)
                                         else correct_index end) as two_wrong,
         jsonb_object_agg(id::text, case when position <= 3
                                         then (correct_index + 1) % array_length(options, 1)
                                         else correct_index end) as three_wrong,
         count(*)::int as total
    from quiz_questions where active;
grant select on sheet to authenticated;

select ok((select total from sheet) >= 5, 'the quiz is configured');
select ok((select count(*) from quiz_questions where active and is_placeholder) = (select total from sheet),
  'and every active question is still the flagged PLACEHOLDER set until THC''s arrive (§2.9, Appendix B)');

-- =====================================================================
-- 1. Gates
-- =====================================================================
set local "request.jwt.claims" = '{"sub":"c3930000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok($$ select onboarding_complete_induction() $$, 'P0001', 'wrong_stage',
  'a candidate whose documents are not all verified cannot open the induction (§2.9)');
select throws_ok($$ select * from onboarding_quiz_questions() $$, 'P0001', 'wrong_stage',
  'nor the quiz');

set local "request.jwt.claims" = '{"sub":"c3930000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ select * from onboarding_quiz_questions() $$, 'P0001', 'induction_first',
  'in the quiz stage, the questions wait for the induction');
select throws_ok(format($$ select submit_quiz_attempt(%L::jsonb) $$, (select all_right from sheet)),
  'P0001', 'induction_first', 'and so does an attempt');
select lives_ok($$ select onboarding_complete_induction() $$, 'the induction is completed');
select is((select count(*)::int from onboarding_quiz_questions()), (select total from sheet),
  'now every question is served');
select ok(pg_get_function_result('public.onboarding_quiz_questions()'::regprocedure) !~ 'correct',
  'without its answer: the function has no column that could carry the key');

set local role authenticated;
select is((select count(*)::int from quiz_questions), 0, 'and the key table is closed to the worker');
reset role;

-- =====================================================================
-- 2. Marking
-- =====================================================================
select throws_ok($$ select submit_quiz_attempt('{}'::jsonb) $$, 'P0001', 'quiz_incomplete',
  'every question must be answered');
select throws_ok(
  format($$ select submit_quiz_attempt(%L::jsonb) $$,
         (select all_right || jsonb_build_object((select id::text from quiz_questions where active order by position limit 1), 99) from sheet)),
  'P0001', 'bad_answer', 'an index outside the options is refused');

select is(
  (select submit_quiz_attempt(three_wrong)->>'outcome' from sheet), 'retry',
  'attempt 1 below the pass mark is a retry');
select results_eq(
  $$ select attempt_no, passed from quiz_attempts where staff_id = 'c3940000-0000-4000-8000-000000000001' $$,
  $$ values (1, false) $$, 'it is recorded');
select is((select quiz_attempts from staff where id = :'pass'), 1, 'and counted on the worker');
select is((select status::text from staff where id = :'pass'), 'quiz', 'she stays in the quiz stage');

select is(
  (select (submit_quiz_attempt(two_wrong)->>'passed')::boolean from sheet),
  (select (total - 2) * 5 >= total * 4 from sheet),
  'attempt 2 is marked against 80% exactly (correct × 5 ≥ total × 4)');
-- With ten questions, eight right is a pass and she moves on.
select is((select status::text from staff where id = :'pass'),
  case when (select (total - 2) * 5 >= total * 4 from sheet) then 'contract' else 'quiz' end,
  'a pass moves the candidate to the next stage of §2.12');

-- =====================================================================
-- 3. The third failure (§2.9, §10.1 case 3, E4)
-- =====================================================================
set local "request.jwt.claims" = '{"sub":"c3930000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$ select onboarding_complete_induction() $$, 'Fergus completes the induction');
select is((select submit_quiz_attempt(three_wrong)->>'attemptsLeft' from sheet), '2', 'fail 1: two left');
select is((select submit_quiz_attempt(three_wrong)->>'attemptsLeft' from sheet), '1', 'fail 2: one left');
select is_empty($$ select 1 from notification_outbox where template = 'E4' and recipient_staff_id = 'c3940000-0000-4000-8000-000000000002' $$,
  'no E4 before the third failure');
select is((select submit_quiz_attempt(three_wrong)->>'outcome' from sheet), 'rejected',
  'fail 3: rejected');
select is((select status::text from staff where id = :'fail'), 'rejected',
  'the candidate is rejected automatically (§2.12)');
select is((select quiz_attempts from staff where id = :'fail'), 3,
  'with three attempts on the row — what puts the terminal screen in place of the wizard (appLock quiz_failed)');
select results_eq(
  $$ select channel::text, recipient_emails from notification_outbox
      where template = 'E4' and recipient_staff_id = 'c3940000-0000-4000-8000-000000000002' $$,
  $$ values ('email'::text, array['fail@quiz.test']) $$,
  'E4 is queued once, by email, to the candidate');
select throws_ok(format($$ select submit_quiz_attempt(%L::jsonb) $$, (select all_right from sheet)),
  'P0001', 'wrong_stage', 'there is no fourth attempt');

-- =====================================================================
-- 4. A pass on the third attempt is a pass
-- =====================================================================
set local "request.jwt.claims" = '{"sub":"c3930000-0000-4000-8000-000000000003","role":"authenticated"}';
select lives_ok($$ select onboarding_complete_induction() $$, 'Lena completes the induction');
select is((select submit_quiz_attempt(three_wrong)->>'outcome' from sheet), 'retry', 'fail 1');
select is((select submit_quiz_attempt(three_wrong)->>'outcome' from sheet), 'retry', 'fail 2');
select is((select submit_quiz_attempt(all_right)->>'outcome' from sheet), 'passed',
  'full marks on the third attempt');
select is((select status::text from staff where id = :'late'), 'contract',
  'and she goes on to the next stage, not to rejection');

-- =====================================================================
-- 5. Reset to candidate: three fresh attempts, the old ones kept (§2.12)
-- =====================================================================
reset role;
select lives_ok(format($$ select reset_to_candidate(%L, 'Re-applied a year later') $$, :'fail'),
  'the office resets Fergus');
select is(
  (select array_agg(superseded order by attempt_no) from quiz_attempts where staff_id = :'fail'),
  array[true, true, true], 'his three attempts stay, read-only, and stop counting');
select is_empty(format($$ select 1 from onboarding_progress where staff_id = %L $$, :'fail'),
  'and his wizard progress is cleared: the full wizard again, not a partial recheck');
update staff set status = 'interview_completed' where id = :'fail';
update staff set status = 'documents' where id = :'fail';
update staff set status = 'quiz' where id = :'fail';
set local "request.jwt.claims" = '{"sub":"c3930000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$ select onboarding_complete_induction() $$,
  'he sits the induction again');
select is((select submit_quiz_attempt(all_right)->>'attemptNo' from sheet), '1',
  'and his next attempt is attempt 1 of a new three — no collision with the old attempt 1');

select * from finish();
rollback;
