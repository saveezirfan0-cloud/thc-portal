-- =====================================================================
-- 789 · booking_payroll_exported() answers the office only
--       20261012120300 · RULE-06, ADR-0004, ADR-0056
--
-- A definer any signed-in role could call: a client learned, booking by
-- booking, whether its line-up had gone to payroll. Now a caller with a
-- login must be a Back Office one; jobs and the service role answer as
-- before, and anon cannot call it at all.
-- =====================================================================
begin;
select plan(7);
\ir _shared/fixtures.psql

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format('select booking_payroll_exported(%L)', :'booking_a'),
  '42501', 'admins_only', 'a client cannot ask whether its line-up was exported to payroll');
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select throws_ok(format('select booking_payroll_exported(%L)', :'booking_a'),
  '42501', 'admins_only', 'nor can a worker');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select lives_ok(format('select booking_payroll_exported(%L)', :'booking_a'),
  'the office still reads RULE-06''s flag');
select is(booking_payroll_exported(:'booking_a'), false, 'and gets the answer (nothing exported here)');
reset role;

select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
select lives_ok(format('select booking_payroll_exported(%L)', :'booking_a'),
  'the service role (no login) answers as before');
reset role;

select ok(not has_function_privilege('anon', 'public.booking_payroll_exported(uuid)', 'execute'),
  'anon cannot execute it');
select ok(not exists (select 1 from information_schema.routine_privileges
                       where routine_name = 'booking_payroll_exported' and grantee = 'PUBLIC'),
  'PUBLIC holds no execute on it');

select * from finish();
rollback;
