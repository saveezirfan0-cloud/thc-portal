-- =====================================================================
-- 855 · onboarding_candidates_v reads each candidate's documents and quiz
--       once — and shows exactly what it showed
--   20261018130200_onboarding_candidates_one_pass.sql · ADR-0153
--
-- The old view, the old staff_rejection_reason_v and the old
-- current_compliance_docs() are recreated in `_old` and compared with the
-- new ones over a generated pipeline (_shared/cap_dataset: candidates in
-- every onboarding status, documents in every review status with older
-- and superseded uploads behind the current one, declarations, quiz
-- attempts before and after a restart, references, a rejection with a
-- reason), under each role that reads it:
--
--   * the office (admin): every row, every column, identical;
--   * a worker reading their own row, and a client: identical (the view is
--     still security_invoker, so their RLS decides, as before);
--   * the rejection reason is still the office's alone;
--   * the columns, their types and their order are unchanged, the options
--     are still what they were, a reader that selects no document or quiz
--     column pays for neither, and the gate runs once per statement.
--
-- Every row is created inside the transaction and rolled back.
-- =====================================================================
begin;
select plan(14);
\ir _shared/fixtures.psql
\set cap_n 20
\set cap_cands 150
\set cap_back 7
\set cap_ahead 7
\ir _shared/cap_dataset.psql
\ir _shared/rule20_before_20261018130000.psql

-- ---- the shape -----------------------------------------------------------
select is(
  (select array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) order by a.attnum)
     from pg_attribute a where a.attrelid = 'public.onboarding_candidates_v'::regclass and a.attnum > 0),
  (select array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) order by a.attnum)
     from pg_attribute a where a.attrelid = '_old.onboarding_candidates_v'::regclass and a.attnum > 0),
  'the same columns, the same types, in the same order');
select is((select reloptions from pg_class where oid = 'public.onboarding_candidates_v'::regclass),
  array['security_invoker=true'], 'onboarding_candidates_v is still security_invoker');
select is((select reloptions from pg_class where oid = 'public.staff_rejection_reason_v'::regclass),
  array['security_barrier=true'], 'staff_rejection_reason_v is still a security_barrier view with its owner''s rights');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'quiz_attempts_staff_taken_idx'),
  'quiz_attempts has the (staff_id, taken_at) index the quiz figures read');

-- current_compliance_docs, now inlined: the same current document per type.
select is_empty($$
  (select s.id, d.* from staff s cross join lateral _old.current_compliance_docs(s.id) d
    where s.email like 'cand%@capset.test'
   except all
   select s.id, d.* from staff s cross join lateral public.current_compliance_docs(s.id) d
    where s.email like 'cand%@capset.test')
  union all
  (select s.id, d.* from staff s cross join lateral public.current_compliance_docs(s.id) d
    where s.email like 'cand%@capset.test'
   except all
   select s.id, d.* from staff s cross join lateral _old.current_compliance_docs(s.id) d
    where s.email like 'cand%@capset.test') $$,
  'current_compliance_docs gives every candidate the same current document per type as before');

-- ---- the office ------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table d855_old as select * from _old.onboarding_candidates_v;
create temp table d855_new as select * from public.onboarding_candidates_v;
reset role;

select is((select count(*) from d855_new), (select count(*) from d855_old), 'the office sees as many candidates as before');
select is_empty($$
  (select * from d855_old except all select * from d855_new)
  union all
  (select * from d855_new except all select * from d855_old) $$,
  'and every row, every column, is the value it was — document counts, quiz figures, rejection reason included');
select ok(
  (select count(*) from d855_new where docs_pending > 0) > 0
  and (select count(*) from d855_new where docs_rejected > 0) > 0
  and (select count(*) from d855_new where docs_verified > 0) > 0
  and (select count(*) from d855_new where quiz_attempts_used > 0 and quiz_passed_at is null) > 0
  and (select count(*) from d855_new where quiz_passed_at is not null) > 0
  and (select count(*) from d855_new n join staff s on s.id = n.id
        where n.quiz_attempts_used < (select count(*) from quiz_attempts q where q.staff_id = s.id)) > 0
  and (select count(*) from d855_new where rejection_reason is not null) > 0,
  'the comparison met pending, rejected and verified documents, failed and passed quizzes, an attempt from before a restart, and a rejection reason');

-- ---- a worker, and a client -----------------------------------------------------
update staff set user_id = null where id = :'staffb';
update staff set user_id = :'staffb_uid'
 where id = (select id from staff where email like 'cand%@capset.test' and rejection_reason is not null order by id limit 1);
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is_empty($$
  (select * from _old.onboarding_candidates_v except all select * from public.onboarding_candidates_v)
  union all
  (select * from public.onboarding_candidates_v except all select * from _old.onboarding_candidates_v) $$,
  'a candidate reading their own row sees what they saw before');
select is((select count(*)::int from public.onboarding_candidates_v where rejection_reason is not null), 0,
  'and the rejection reason is still not theirs to read (20260923220000)');
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select is((select count(*) from public.onboarding_candidates_v), (select count(*) from _old.onboarding_candidates_v),
  'a client sees as many rows as before');
reset role;

-- ---- what the planner does with it ---------------------------------------------
create temp table d855_plan (what text, line text);
do $$
declare r text;
begin
  for r in execute 'explain (costs off) select id, display_name, status from public.onboarding_candidates_v' loop
    insert into d855_plan values ('narrow', r);
  end loop;
  for r in execute 'explain (costs off) select rejection_reason from public.staff_rejection_reason_v' loop
    insert into d855_plan values ('gate', r);
  end loop;
end $$;
select is_empty($$ select 1 from d855_plan where what = 'narrow' and line ~ '(compliance_docs|quiz_attempts)' $$,
  'a reader that selects no document or quiz column reads neither table: the two laterals are dropped');
select ok(exists (select 1 from d855_plan where what = 'gate' and line ~ 'InitPlan'),
  'the admin gate is an InitPlan, run once per statement rather than once per row');
select is_empty($$ select 1 from d855_plan where what = 'gate' and line ~ 'Filter: .*current_app_role\(\)' $$,
  '... and no row filter calls current_app_role() itself');

select * from finish();
rollback;
