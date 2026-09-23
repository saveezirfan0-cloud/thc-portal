-- =====================================================================
-- 445 · The 23.09 build's staff columns and #44's column grants
--   20260923210000_grant_the_23_09_staff_columns.sql
-- =====================================================================
begin;
select plan(5);
\ir _shared/fixtures.psql

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
  'and staff_rejection_reason_v is the only view that reads staff.rejection_reason: onboarding_candidates_v goes through it, and a new view reading the column directly fails here rather than shipping the leak again');

-- Two columns now, not one. 20260923220000 took rejection_reason out of
-- the grant for the reason 20260923090000 took block_reason: §2.9's
-- reason is the office's, ADR-0017 keeps it out of E2/E2b/E4, and a
-- rejected candidate could read it off their own row. The list is spelled
-- out rather than widened to "any column somebody excluded", so a third
-- exclusion has to be added here deliberately and cannot arrive silently.
select is_empty(
  $$ select a.attname from pg_attribute a
      where a.attrelid = 'public.staff'::regclass and a.attnum > 0 and not a.attisdropped
        and a.attname not in ('block_reason', 'rejection_reason')
        and not has_column_privilege('authenticated', 'public.staff', a.attname, 'select') $$,
  'every staff column but block_reason and rejection_reason is granted, the 23.09 additions included');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$ select count(*) from compliance_review_queue_v $$,
  'the office reads the Needs review queue');
select lives_ok($$ select count(*) from onboarding_returning_v $$,
  'and the returning-applicant cards');
reset role;

select * from finish();
rollback;
