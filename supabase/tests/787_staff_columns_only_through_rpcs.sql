-- =====================================================================
-- 787 · staff.payroll_id and staff.status move only through their RPCs
--       20261012120100 · ADR-0076, ADR-0056, §2.12
--
-- admin_all on staff let any Back Office login PATCH a worker's row. A
-- scheduler could re-key a worker's pay (set_staff_payroll_id() is owner
-- or manager, and audited) and move a candidate past their interview
-- (onboarding_mark_interview_complete() is owner or manager with a
-- reason) — or take any other §2.12 edge without its door.
-- =====================================================================
begin;
select plan(17);
\ir _shared/fixtures.psql

\set owner     '78700000-0000-4000-8000-000000000001'
\set scheduler '78700000-0000-4000-8000-000000000002'
\set cand      '78700000-0000-4000-8000-0000000000c1'
\set cand2     '78700000-0000-4000-8000-0000000000c2'

insert into auth.users (id, email) values
  (:'owner', 'owner787@rls.test'), (:'scheduler', 'scheduler787@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'owner', 'admin', 'owner', 'Olive Owner'),
  (:'scheduler', 'admin', 'scheduler', 'Sam Scheduler');
insert into staff (id, first_name, last_name, email, phone, dob, status) values
  (:'cand',  'Cara',  'Candidate', 'cara787@rls.test', '+447700978701', date '1999-01-01', 'interview_requested'),
  (:'cand2', 'Cyril', 'Candidate', 'cyril787@rls.test', '+447700978702', date '1999-02-02', 'interview_requested');

-- =====================================================================
-- 1 · payroll_id
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ update staff set payroll_id = 'EVIL-1' where id = %L $$, :'staffa'),
  '42501', 'payroll_id_rpc_only', 'a scheduler cannot set a worker''s Payroll ID by direct PATCH');
select throws_ok(format($$ select set_staff_payroll_id(%L, 'EVIL-1') $$, :'staffa'),
  '42501', null, 'nor through the RPC (finance gate)');

select set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, true);
select throws_ok(format($$ update staff set payroll_id = 'OWN-1' where id = %L $$, :'staffa'),
  '42501', 'payroll_id_rpc_only', 'an owner cannot either: the RPC is the only door');
select throws_ok(format($$ insert into staff (id, first_name, last_name, email, phone, dob, status, payroll_id)
                           values (%L, 'X', 'Y', 'x787@rls.test', '+447700978799', date '1990-01-01', 'interview_requested', 'NEW-1') $$, :'new_id'),
  '42501', 'payroll_id_rpc_only', 'nor insert a staff row that already carries one');
select lives_ok(format($$ select set_staff_payroll_id(%L, 'PAY-787') $$, :'staffa'),
  'the owner sets it through set_staff_payroll_id()');
select lives_ok(format($$ update staff set phone = '+447700900099' where id = %L $$, :'staffa'),
  'other columns stay writable by an admin as before');
reset role;

select is((select payroll_id from staff where id = :'staffa'), 'PAY-787', 'the RPC''s value landed');
select is((select count(*)::int from audit_log
            where action = 'staff.payroll_id_set' and entity_id = :'staffa' and actor = :'owner'), 1,
  'and is audited with the owner as actor');

-- =====================================================================
-- 2 · status — interview_requested → interview_completed and the rest
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ update staff set status = 'interview_completed' where id = %L $$, :'cand'),
  '42501', 'staff_status_rpc_only', 'a scheduler cannot move a candidate past the interview by PATCH');
select throws_ok(format($$ update staff set status = 'blocked', block_kind = 'manual' where id = %L $$, :'staffa'),
  '42501', 'staff_status_rpc_only', 'nor block a worker without block_worker()');
select throws_ok(format($$ update staff set status = 'quiz' where id = %L $$, :'cand'),
  'P0001', null, 'an illegal edge still answers illegal_staff_transition first');
select throws_ok(format($$ insert into staff (id, first_name, last_name, email, phone, dob, status)
                           values (%L, 'X', 'Y', 'x787@rls.test', '+447700978799', date '1990-01-01', 'compliant') $$, :'new_id'),
  '42501', 'staff_status_rpc_only', 'nor insert a worker who is already compliant');

select set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, true);
select throws_ok(format($$ update staff set status = 'interview_completed' where id = %L $$, :'cand'),
  '42501', 'staff_status_rpc_only', 'an owner cannot PATCH it either');
select lives_ok(format($$ select onboarding_mark_interview_complete(%L, 'Interviewed by phone') $$, :'cand'),
  'the owner''s RPC, with a reason, still works');
reset role;
select is((select status::text from staff where id = :'cand'), 'interview_completed', 'the candidate moved');

-- The Willo receiver (service role, no login) is untouched.
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
select lives_ok(format($$ update staff set status = 'interview_completed' where id = %L $$, :'cand2'),
  'the service role (the Willo receiver) still moves a candidate');
reset role;

select ok(not (select prosecdef from pg_proc where oid = 'public.staff_status_rpc_only()'::regprocedure)
      and not (select prosecdef from pg_proc where oid = 'public.staff_payroll_id_guard()'::regprocedure),
  'both guards are invoker trigger functions, so current_user is the caller');

select * from finish();
rollback;
