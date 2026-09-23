-- =====================================================================
-- 360 · The manager's block reason is internal (§9.6, §10.1)
--                      — 20260923090000_block_reason_is_internal.sql
--
-- What this file is defending
-- --------------------------
-- §10.1: "the manager's reason for the block is internal and is never
-- shown to the worker". 330_staff_self_service.sql already holds
-- staff_me() to that — it asserts the function has no blockReason field
-- and that its output never contains the text. That is a test of the
-- application's query, and the application's query was never the
-- boundary: `staff` carried a table-wide SELECT grant for
-- `authenticated` and a row policy (staff_self, 0001_init.sql:482) that
-- gave the worker their own row, so
--
--     GET /rest/v1/staff?select=block_reason
--
-- with the worker's own anon key returned the note regardless of what any
-- screen asked for. So the assertions below are deliberately NOT written
-- through staff_me() or any other function. They are written as the raw
-- roles, in the query shapes a hand-written PostgREST call produces:
-- a named column, `select *`, and the column named only in a WHERE.
--
-- Every assertion runs under `set local role`, never as the migration
-- role. The owner owns `staff` and therefore bypasses both RLS and the
-- column privileges this file exists to check; a test of this written as
-- the owner would pass with the leak wide open.
--
-- The structural half matters as much as the behavioural half. A future
-- `grant select on staff to authenticated` would re-open the column and
-- every behavioural assertion here would go red — but so would the
-- has_column_privilege() checks, which say why in one line instead of
-- five.
--
-- Employee IDs are in the 9xxxx range by the convention 290, 220 and 330
-- use: seed.sql holds 412-1042 and a plausible-looking number collides on
-- the unique index before assertion 1 runs.
-- =====================================================================
begin;
select plan(32);
\ir _shared/fixtures.psql

\set gone 'cbcbcb00-0000-4000-8000-000000000001'

-- The worker under test is manually blocked, with a reason of exactly the
-- kind §9.6 invites a manager to type and §10.1 forbids showing.
update staff
   set status       = 'blocked',
       block_kind   = 'manual',
       block_reason = 'Internal: escorted off site by the client, under review'
 where id = :'staffa';

-- A removed worker whose block reason is still on the row. §1.7's
-- suppression has to survive this change: the anonymisation is applied in
-- the view, not trusted to the wipe, and moving block_reason into
-- staff_block_reason_v moved that `case` with it.
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status,
                   photo_path, rating, reliability, removed_at, block_kind, block_reason) values
  (:'gone', 90360, 'Removed', 'Worker', 'gone360@rls.test', '+447700900360',
   date '1990-03-03', 'removed', 'selfies/gone360.jpg', 4.10, 96.00, now(),
   'manual', 'Internal: do not re-engage');

-- =====================================================================
-- 1. Structure — the privilege, not the query
-- =====================================================================
select has_view('staff_block_reason_v',
  'the office has an owner-rights view to read the reason through (ADR-0004)');

select ok(
  (select not coalesce('security_invoker=true' = any(reloptions), false)
      and coalesce('security_barrier=true' = any(reloptions), false)
     from pg_class where relname = 'staff_block_reason_v'),
  'staff_block_reason_v runs with OWNER rights and security_barrier: the column privilege below does not bind it, and no user-supplied qual can be evaluated ahead of its admin gate');

select ok(
  (select coalesce('security_invoker=true' = any(reloptions), false)
     from pg_class where relname = 'staff_directory_v'),
  'staff_directory_v is still security_invoker: `staff`''s own RLS remains what decides which workers a caller sees through it (290)');

select ok(not has_column_privilege('authenticated', 'public.staff', 'block_reason', 'select'),
  '§10.1 no signed-in PostgREST role holds SELECT on staff.block_reason — this is the assertion that goes red if somebody re-grants the table');
select ok(not has_column_privilege('anon', 'public.staff', 'block_reason', 'select'),
  'and neither does anon');

select ok(has_column_privilege('authenticated', 'public.staff', 'id', 'select'),
  'the rest of the row is untouched: staff_self (0001) still has a column to select');
select ok(has_column_privilege('authenticated', 'public.staff', 'dob', 'select'),
  'including the personal columns a worker legitimately reads about themselves — the cut is one column wide, not a narrowing of `staff`');

select ok(has_table_privilege('authenticated', 'public.staff_block_reason_v', 'select'),
  'the view is granted to authenticated, because admin and worker are the same Postgres role; the gate is in its body, per ADR-0004');
select ok(not has_table_privilege('anon', 'public.staff_block_reason_v', 'select'),
  'anon holds nothing on it at all');

-- =====================================================================
-- 2. The worker — no route to the column, and every legitimate read
--    still working
-- =====================================================================
select set_config('request.jwt.claims',
  json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  format($$ select block_reason from staff where id = %L $$, :'staffa'),
  '42501', null,
  '§10.1 a worker cannot read the block reason on their OWN row by naming the column');
select throws_ok(
  format($$ select * from staff where id = %L $$, :'staffa'),
  '42501', null,
  'nor by asking for the whole row — `select=*` is the shape PostgREST sends by default');
select throws_ok(
  $$ select count(*) from staff where block_reason is not null $$,
  '42501', null,
  'nor by naming it only in a WHERE clause — a column privilege is checked on every reference, so the reason cannot even be probed');

select is((select count(*)::int from staff where id = :'staffa'), 1,
  'their own row is still readable: staff_self is untouched and this change must not cost them it');
select is((select first_name from staff where id = :'staffa'), 'Staff',
  'and the columns on it that are theirs still come back');
select is((select count(*)::int from staff where id = :'staffb'), 0,
  'a colleague''s row is still invisible (§1.4)');

select is((select count(*)::int from staff_directory_v), 1,
  'the directory view still resolves to exactly their own row (290)');
select is((select block_reason from staff_directory_v where id = :'staffa'), null,
  'but the block reason reads null through it: the sub-view''s admin gate is empty for a worker');
select is((select count(*)::int from staff_block_reason_v), 0,
  'and the view itself returns nothing to them, called directly with their own key');

select is(staff_me()->>'staffId', :'staffa'::text,
  'staff_me() still answers for the caller (§10.1 profile sheet)');
select is(staff_me()->>'blockKind', 'manual',
  'and still carries the KIND of block, which decides the lock screen');
select ok(staff_me()::text not like '%escorted off site%',
  'and still never the reason — now because the column is out of reach, not only because the function does not ask for it');

-- =====================================================================
-- 3. The admin — still sees it, for any worker, on both screens
-- =====================================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select block_reason from staff_block_reason_v where staff_id = :'staffa'),
  'Internal: escorted off site by the client, under review',
  '§9.6 the office reads the reason through the owner-rights view');
select is((select block_reason from staff_directory_v where id = :'staffa'),
  'Internal: escorted off site by the client, under review',
  'and therefore on /staff, unchanged: the directory row still carries it');
select is((select block_reason from staff_profile_v where id = :'staffa'),
  'Internal: escorted off site by the client, under review',
  'and on /staff/:id, inherited through staff_directory_v as before');
select is((select count(*)::int from staff_directory_v where id in (:'staffa', :'staffb')), 2,
  'for any worker, not only a blocked one — admin_all still reaches every row');

select throws_ok(
  format($$ select block_reason from staff where id = %L $$, :'staffa'),
  '42501', null,
  'and NOT off the table: the column is closed to the role, because admin and worker share it. The view is the whole of the office''s access (ADR-0004)');

select is((select block_reason from staff_directory_v where id = :'gone'), null,
  '§1.7 a removed worker''s block reason is suppressed even though the column still holds it — the `case` moved into staff_block_reason_v with the read');
select is((select display_name from staff_directory_v where id = :'gone'), 'Deleted account #90360',
  'and deleted_account_label() is still what names them: the anonymisation was not disturbed');

-- =====================================================================
-- 4. The client — nothing, as before (§11.1)
-- =====================================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*)::int from staff_block_reason_v), 0,
  'a client reaches no block reason: the view''s gate names admin and nobody else');
select throws_ok(
  $$ select block_reason from staff $$,
  '42501', null,
  'and cannot go round it to the table either');

-- =====================================================================
-- 5. anon — nothing, as before
-- =====================================================================
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;

select throws_ok(
  $$ select count(*) from staff_block_reason_v $$,
  '42501', null,
  'anon cannot reach the view at all — it holds no privilege on it');
select throws_ok(
  $$ select block_reason from staff $$,
  '42501', null,
  'and no privilege on the column');

reset role;
select * from finish();
rollback;
