-- =====================================================================
-- 757 · onboarding_documents_missing() under the caller's rights
--       — 20261001208000_documents_missing_reads_named_columns.sql
--
-- The Back Office Onboarding board failed with "permission denied for
-- table staff" (28.09): it reads onboarding_candidates_v with `select *`,
-- which evaluates docs_missing and quiz_blockers, and the INVOKER function
-- behind both did `select * from staff` — block_reason and rejection_reason
-- are not granted to authenticated. 380 and 595 read named view columns
-- only, and an unread view column is never evaluated, so none of them
-- caught it. Every read here asks for the whole row, as the app does.
-- =====================================================================
begin;
select plan(7);
\ir _shared/fixtures.psql

\set c_new '75700000-0000-4000-8000-000000000001'

insert into staff (id, first_name, last_name, email, phone, dob, status, onboarding_started_at, stage_entered_at)
values (:'c_new', 'Nia', 'Newcomer', 'nia@named-columns.test', '+447700957001', date '2000-05-05',
        'interview_requested', now(), now());

-- The cause, pinned: these stay internal, so no invoker path may `select *`.
select ok(not has_column_privilege('authenticated', 'public.staff', 'block_reason', 'SELECT')
          and not has_column_privilege('authenticated', 'public.staff', 'rejection_reason', 'SELECT'),
  'block_reason and rejection_reason are still not granted to authenticated');
select ok((select not prosecdef from pg_proc
            where oid = 'public.onboarding_documents_missing(uuid)'::regprocedure),
  'onboarding_documents_missing still runs with the caller''s rights');

-- ---- the office, as the board reads it -------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok($$ select * from onboarding_candidates_v $$,
  'the office reads the whole of onboarding_candidates_v, docs_missing and quiz_blockers included');
select is((select docs_missing from onboarding_candidates_v where id = :'c_new'),
  array['rtw_branch', 'criminal_declaration'],
  'and a new applicant''s missing items are still reported');
select ok((select quiz_blockers from onboarding_candidates_v where id = :'c_new') @> array['rtw_branch'],
  'and the quiz gate still carries them');
reset role;

-- ---- the candidate, in the Staff App wizard --------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok(format('select onboarding_documents_missing(%L::uuid), onboarding_quiz_blockers(%L::uuid)',
                        :'staffa', :'staffa'),
  'a worker can read their own missing items and quiz blockers');
select is(onboarding_documents_missing(:'c_new'), null::text[],
  'and sees nothing of anyone else (RLS hides the row, so there is nothing to report)');
reset role;

select * from finish();
rollback;
