-- =====================================================================
-- 445 · The 23.09 build's staff columns and #44's column grants
--   20260923210000_grant_the_23_09_staff_columns.sql
-- =====================================================================
begin;
select plan(4);
\ir _shared/fixtures.psql

select is(
  (select array_agg(distinct c.relname::text) from pg_depend d
     join pg_rewrite r on r.oid = d.objid join pg_class c on c.oid = r.ev_class
     join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
    where d.refobjid = 'public.staff'::regclass and a.attname = 'block_reason'),
  array['staff_block_reason_v'],
  'staff_block_reason_v is the only view that reads staff.block_reason: every other reads it through that one (O16)');

select is_empty(
  $$ select a.attname from pg_attribute a
      where a.attrelid = 'public.staff'::regclass and a.attnum > 0 and not a.attisdropped
        and a.attname <> 'block_reason'
        and not has_column_privilege('authenticated', 'public.staff', a.attname, 'select') $$,
  'every staff column but block_reason is granted, the 23.09 additions included');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$ select count(*) from compliance_review_queue_v $$,
  'the office reads the Needs review queue');
select lives_ok($$ select count(*) from onboarding_returning_v $$,
  'and the returning-applicant cards');
reset role;

select * from finish();
rollback;
