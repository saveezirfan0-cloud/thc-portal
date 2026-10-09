-- =====================================================================
-- 784 · The invite list shows who has applied (20261008190000, ADR-0107)
--
--   1. shape: a view that runs with the caller's rights; the public has
--      no grant on it;
--   2. what it counts: a matched application, one under a different name,
--      someone already here when the list was loaded — and not somebody
--      who only used /apply/spudbros without being on the list;
--   3. one row per person, newest event first; the payroll-ID-held flag;
--   4. a removed person reads the anonymised label, no email, no ID (§1.7);
--   5. who reads it: the office; a worker reads nothing.
-- =====================================================================
begin;
select plan(16);
\ir _shared/fixtures.psql

\set ada   '78400000-0000-4000-8000-000000000001'
\set bo    '78400000-0000-4000-8000-000000000002'
\set cy    '78400000-0000-4000-8000-000000000003'
\set di    '78400000-0000-4000-8000-000000000004'
\set eli   '78400000-0000-4000-8000-000000000005'
\set fay   '78400000-0000-4000-8000-000000000006'

insert into staff (id, first_name, last_name, email, phone, dob, status, spudbros_express, payroll_id) values
  (:'ada', 'Ada', 'Applied',  'ada@t784.test', '+447700984001', date '1999-01-01', 'documents',  true,  '1641A'),
  (:'bo',  'Bo',  'Mismatch', 'bo@t784.test',  '+447700984002', date '1999-01-02', 'documents',  false, null),
  (:'cy',  'Cy',  'Here',     'cy@t784.test',  '+447700984003', date '1990-01-03', 'compliant',  false, '2200'),
  (:'di',  'Di',  'Linked',   'di@t784.test',  '+447700984004', date '1999-01-04', 'documents',  true,  null),
  (:'eli', 'Eli', 'Twice',    'eli@t784.test', '+447700984005', date '1999-01-05', 'documents',  false, '1500'),
  (:'fay', 'Fay', 'Removed',  'fay@t784.test', '+447700984006', date '1999-01-06', 'documents',  false, null);

insert into audit_log (at, actor, action, entity, entity_id, data) values
  (now() - interval '3 days', null, 'roster.matched', 'staff', :'ada',
     jsonb_build_object('staffId', :'ada', 'group', 'spudbros', 'via', 'list', 'payrollId', '1641A', 'payrollIdTaken', false)),
  (now() - interval '2 days', null, 'roster.name_mismatch', 'staff', :'bo',
     jsonb_build_object('staffId', :'bo')),
  (now() - interval '5 days', null, 'roster.applied_existing', 'staff', :'cy',
     jsonb_build_object('staffId', :'cy', 'group', 'thc', 'payrollId', '2200')),
  (now() - interval '1 days', null, 'roster.matched', 'staff', :'di',
     jsonb_build_object('staffId', :'di', 'group', 'spudbros', 'via', 'link', 'payrollId', null, 'payrollIdTaken', false)),
  (now() - interval '4 days', null, 'roster.matched', 'staff', :'eli',
     jsonb_build_object('staffId', :'eli', 'group', 'thc', 'via', 'list', 'payrollId', null, 'payrollIdTaken', true)),
  (now() - interval '1 hour', null, 'roster.matched', 'staff', :'eli',
     jsonb_build_object('staffId', :'eli', 'group', 'thc', 'via', 'list', 'payrollId', null, 'payrollIdTaken', true)),
  (now() - interval '6 days', null, 'roster.matched', 'staff', :'fay',
     jsonb_build_object('staffId', :'fay', 'group', 'thc', 'via', 'list', 'payrollId', null, 'payrollIdTaken', false)),
  -- noise that is not an application: a failed match, a payroll ID edit
  (now(), null, 'roster.match_failed', 'staff', :'bo', jsonb_build_object('staffId', :'bo')),
  (now(), null, 'staff.payroll_id_set', 'staff', :'ada', jsonb_build_object('staffId', :'ada'));

update staff set removed_at = now() where id = :'fay';

-- =====================================================================
-- 1 · Shape
-- =====================================================================
select ok((select reloptions @> array['security_invoker=true'] from pg_class
            where oid = 'public.invite_list_applied_v'::regclass),
  'the view runs with the caller''s rights, so audit_log''s and staff''s own policies decide');
select ok(not has_table_privilege('anon', 'public.invite_list_applied_v', 'select')
      and has_table_privilege('authenticated', 'public.invite_list_applied_v', 'select'),
  'signed-in sessions may select it; the public may not');

-- =====================================================================
-- 2-4 · What it lists (read as the office)
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*)::int from invite_list_applied_v where staff_id::text like '78400000-%'), 5,
  'five people: matched, name mismatch, already here, matched twice (once), removed — not the unlisted link user');
select is((select how from invite_list_applied_v where staff_id = :'ada'), 'applied',
  'a matched application reads "applied"');
select is((select grp from invite_list_applied_v where staff_id = :'ada'), 'spudbros',
  'with the group the matcher decided');
select is((select email || ':' || payroll_id from invite_list_applied_v where staff_id = :'ada'), 'ada@t784.test:1641A',
  'and the email and Payroll ID now on the person');
select is((select how from invite_list_applied_v where staff_id = :'bo'), 'name_mismatch',
  'an application under a different name says so');
select is((select grp from invite_list_applied_v where staff_id = :'bo'), 'thc',
  'and, with no group on the audit row, reads the person''s own marking');
select is((select how from invite_list_applied_v where staff_id = :'cy'), 'already_here',
  'somebody in the system when the list was loaded says so');
select is((select count(*)::int from invite_list_applied_v where staff_id = :'di'), 0,
  'somebody who only used /apply/spudbros and was not on the list is not on this page');
select is((select count(*)::int from invite_list_applied_v where staff_id = :'eli'), 1,
  'one row per person, however many audit rows');
select ok((select applied_at > now() - interval '2 hours' from invite_list_applied_v where staff_id = :'eli'),
  'carrying the latest event');
select is((select payroll_id_taken::text from invite_list_applied_v where staff_id = :'eli'), 'true',
  'and whether the Payroll ID was already held by someone else');
select is((select display_name || ':' || coalesce(email, '-') || ':' || coalesce(payroll_id, '-') || ':' || removed::text
             from invite_list_applied_v where staff_id = :'fay'),
  (select deleted_account_label(employee_id) || ':-:-:true' from staff where id = :'fay'),
  'a removed person reads the anonymised label, with no email or Payroll ID (§1.7)');
select is((select array_agg(staff_id order by applied_at desc) from invite_list_applied_v
            where staff_id::text like '78400000-%'),
  array[:'eli', :'bo', :'ada', :'cy', :'fay']::uuid[],
  'newest first');
reset role;

-- =====================================================================
-- 5 · Who reads it
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from invite_list_applied_v), 0, 'a worker reads nothing of it');
reset role;

select * from finish();
rollback;
