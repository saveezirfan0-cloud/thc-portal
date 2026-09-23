-- =====================================================================
-- 445 · The 23.09 build's staff columns and #44's column grants
--   20260923210000_grant_the_23_09_staff_columns.sql
--   20260924130000_rejection_reason_is_internal.sql (ADR-0017)
--
-- Two staff columns are internal and held by no PostgREST role:
-- block_reason (§10.1, #44) and rejection_reason (ADR-0017). Each has one
-- owner-rights, admin-gated route (staff_block_reason_v,
-- staff_rejection_reason_v) and every other view reads through that.
-- =====================================================================
begin;
select plan(17);
\ir _shared/fixtures.psql

-- The office's reason for rejecting staffa, of the kind §2.3 keeps with the
-- office. Status is left alone: the column privilege is what is under test.
update staff
   set rejection_cause  = 'manager',
       rejection_reason = 'Internal: rude to the interviewer, do not re-engage'
 where id = :'staffa';

-- ---------------------------------------------------------------------
-- 1. Structure
-- ---------------------------------------------------------------------
select is(
  (select array_agg(distinct c.relname::text) from pg_depend d
     join pg_rewrite r on r.oid = d.objid join pg_class c on c.oid = r.ev_class
     join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
    where d.refobjid = 'public.staff'::regclass and a.attname = 'block_reason'),
  array['staff_block_reason_v'],
  'staff_block_reason_v is the only view that reads staff.block_reason: every other reads it through that one (O16)');

select is(
  (select array_agg(distinct c.relname::text) from pg_depend d
     join pg_rewrite r on r.oid = d.objid join pg_class c on c.oid = r.ev_class
     join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
    where d.refobjid = 'public.staff'::regclass and a.attname = 'rejection_reason'),
  array['staff_rejection_reason_v'],
  'staff_rejection_reason_v is the only view that reads staff.rejection_reason: onboarding_candidates_v reads it through that one (ADR-0017)');

select is_empty(
  $$ select a.attname from pg_attribute a
      where a.attrelid = 'public.staff'::regclass and a.attnum > 0 and not a.attisdropped
        and a.attname not in ('block_reason', 'rejection_reason')
        and not has_column_privilege('authenticated', 'public.staff', a.attname, 'select') $$,
  'every staff column but the two internal reasons is granted, the 23.09 additions included');

select ok(not has_column_privilege('authenticated', 'public.staff', 'rejection_reason', 'select')
          and not has_column_privilege('anon', 'public.staff', 'rejection_reason', 'select'),
  'ADR-0017: neither anon nor authenticated holds SELECT on staff.rejection_reason');

select is(
  (select coalesce(reloptions, '{}') from pg_class where relname = 'staff_rejection_reason_v'),
  array['security_barrier=true'],
  'staff_rejection_reason_v runs with OWNER rights and security_barrier: the gate in its body decides, not the column grant');

select is(
  (select reloptions from pg_class where relname = 'onboarding_candidates_v'),
  array['security_invoker=true'],
  'onboarding_candidates_v is still security_invoker: staff RLS still decides whose rows a caller reaches');

select ok(not has_table_privilege('anon', 'public.staff_rejection_reason_v', 'select'),
  'the reason view is not reachable signed out');

-- ---------------------------------------------------------------------
-- 2. The worker: no route to the column
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  format($$ select rejection_reason from staff where id = %L $$, :'staffa'),
  '42501', null,
  'a worker cannot read the office''s rejection reason on their OWN row by naming the column');
select throws_ok(
  $$ select count(*) from staff where rejection_reason is not null $$,
  '42501', null,
  'nor probe it in a WHERE clause');
select is((select first_name from staff where id = :'staffa'), 'Staff',
  'their own row is otherwise still readable (staff_self is untouched)');
select is((select count(*)::int from onboarding_candidates_v where id = :'staffa'), 1,
  'onboarding_candidates_v still resolves for them: the view no longer answers 42501 to a worker');
select is((select rejection_reason from onboarding_candidates_v where id = :'staffa'), null,
  'but the rejection reason reads null through it — the sub-view''s admin gate is empty for a worker');
select is((select count(*)::int from staff_rejection_reason_v), 0,
  'and the reason view itself returns nothing to a worker');
reset role;

-- ---------------------------------------------------------------------
-- 3. The admin: still reads it, through the office views
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$ select count(*) from compliance_review_queue_v $$,
  'the office reads the Needs review queue');
select lives_ok($$ select count(*) from onboarding_returning_v $$,
  'and the returning-applicant cards');
select is((select rejection_reason from onboarding_candidates_v where id = :'staffa'),
  'Internal: rude to the interviewer, do not re-engage',
  'the office still reads the rejection reason on /onboarding/:id');
select is((select rejection_reason from staff_rejection_reason_v where staff_id = :'staffa'),
  'Internal: rude to the interviewer, do not re-engage',
  'and through the owner-rights view directly');
reset role;

select * from finish();
rollback;
