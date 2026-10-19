-- =====================================================================
-- 887 · The "Needs review" counter is one exact count, and the block
--       reason's admin gate runs once per statement
--   20261020110300_compliance_queue_count.sql · ADR-0160
--
--   * compliance_review_queue_count() is exactly the number of rows of
--     compliance_review_queue_v as each caller sees it — the office, a
--     worker, a client — and anon cannot call it;
--   * it is a pinned, invoker, stable SQL function returning integer;
--   * staff_block_reason_v, and the two views that read it per row
--     (compliance_review_queue_v, onboarding_returning_v), are identical
--     to their old definitions (_shared/office_views_before_20261020110000:
--     public._old_*) as the office, a worker and a client; the view keeps
--     owner rights and security_barrier, and its gate is an InitPlan.
--
-- Every row is created inside the transaction and rolled back.
-- =====================================================================
begin;
select plan(19);
\ir _shared/fixtures.psql
\set cap_n 100
\set cap_cands 80
\set cap_back 7
\set cap_ahead 7
\ir _shared/cap_dataset.psql
\ir _shared/office_views_dataset.psql
\ir _shared/office_views_before_20261020110000.psql

-- ---- the shape -----------------------------------------------------------
select is(
  (select format('%s %s %s %s %s', l.lanname, p.provolatile, p.prosecdef, p.proconfig is not null, format_type(p.prorettype, null))
     from pg_proc p join pg_language l on l.oid = p.prolang
    where p.oid = 'public.compliance_review_queue_count()'::regprocedure),
  'sql s f t integer',
  'compliance_review_queue_count(): SQL, stable, invoker, pinned, returns integer');
select ok(has_function_privilege('authenticated', 'public.compliance_review_queue_count()', 'execute')
          and has_function_privilege('service_role', 'public.compliance_review_queue_count()', 'execute')
          and not has_function_privilege('anon', 'public.compliance_review_queue_count()', 'execute'),
  'authenticated and service_role may call it; anon may not');
select is((select reloptions from pg_class where oid = 'public.staff_block_reason_v'::regclass),
  array['security_barrier=true'], 'staff_block_reason_v is still a security_barrier view with its owner''s rights');
select is(
  (select array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) order by a.attnum)
     from pg_attribute a where a.attrelid = 'public.staff_block_reason_v'::regclass and a.attnum > 0),
  array['staff_id:uuid', 'block_reason:text'], 'and has the same two columns');

create temp table d887_plan (line text);
do $$
declare r text;
begin
  for r in execute 'explain (costs off) select block_reason from public.staff_block_reason_v' loop
    insert into d887_plan values (r);
  end loop;
end $$;
select ok(exists (select 1 from d887_plan where line ~ 'InitPlan'),
  'the admin gate is an InitPlan, run once per statement rather than once per row');

-- ---- the office ------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(public.compliance_review_queue_count(), (select count(*)::int from public.compliance_review_queue_v),
  'the office: the count is the number of rows /compliance lists');
select ok(public.compliance_review_queue_count() > 50
          and (select count(distinct kind) from public.compliance_review_queue_v) >= 4,
  '... over a queue with documents, declarations, right-to-work dates and gov.uk checks in it');
select is_empty($$
  (select * from public._old_staff_block_reason_v except all select * from public.staff_block_reason_v)
  union all (select * from public.staff_block_reason_v except all select * from public._old_staff_block_reason_v) $$,
  'staff_block_reason_v: the same rows and reasons as before');
select ok((select count(*) from public.staff_block_reason_v where block_reason is not null) > 0,
  '... some of them with a reason');
select is_empty($$
  (select * from public._old_compliance_review_queue_v except all select * from public.compliance_review_queue_v)
  union all (select * from public.compliance_review_queue_v except all select * from public._old_compliance_review_queue_v) $$,
  'compliance_review_queue_v: every item, every column, as before — block reasons included');
select is_empty($$
  (select * from public._old_onboarding_returning_v except all select * from public.onboarding_returning_v)
  union all (select * from public.onboarding_returning_v except all select * from public._old_onboarding_returning_v) $$,
  'onboarding_returning_v: as before');

-- ---- a worker ------------------------------------------------------------------
-- A worker with a pending document of their own.
reset role;
update staff set user_id = null where id = :'staffa';
update staff set user_id = :'staffa_uid'
 where id = (select d.staff_id from compliance_docs d join staff s on s.id = d.staff_id
              where d.review_status = 'pending' and s.email like 'cap%@capset.test' order by d.staff_id limit 1);
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(public.compliance_review_queue_count(), (select count(*)::int from public.compliance_review_queue_v),
  'a worker: the count is what their own RLS lets them see of the queue, as the HEAD count was');
select is_empty($$
  (select * from public._old_compliance_review_queue_v except all select * from public.compliance_review_queue_v)
  union all (select * from public.compliance_review_queue_v except all select * from public._old_compliance_review_queue_v) $$,
  '... and those rows are the ones they saw before');
select is((select count(*)::int from public.staff_block_reason_v), 0,
  'the block reason is still not a worker''s to read');

-- ---- a client --------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select is(public.compliance_review_queue_count(), (select count(*)::int from public.compliance_review_queue_v),
  'a client: the count is the view''s, as they see it');
select is(public.compliance_review_queue_count(), 0, '... which is nothing');
select is_empty($$
  (select * from public._old_compliance_review_queue_v except all select * from public.compliance_review_queue_v)
  union all (select * from public.compliance_review_queue_v except all select * from public._old_compliance_review_queue_v) $$,
  '... as before');
select is((select count(*)::int from public.staff_block_reason_v), 0, 'and no block reason');
reset role;

-- ---- anon ----------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select public.compliance_review_queue_count() $$, '42501', null,
  'anon cannot call the count');
reset role;

select * from finish();
rollback;
