-- =====================================================================
-- 571 · bank_details is written only through staff_save_bank() (§2.10)
--
-- 20260927120100 dropped the worker's direct INSERT/UPDATE policies on
-- bank_details. With them a worker could PATCH their own sort code through
-- PostgREST and skip both the validation and §2.10's E5 to payroll (audit
-- 24.09 §3). Asserted here, per role:
--   * staff  — reads own row; cannot insert or update directly, not even
--              their own; the RPC still saves AND queues E5;
--   * client — nothing, in either direction;
--   * admin  — still reads and writes (admin_all is untouched);
--   * anon   — nothing.
-- =====================================================================
begin;
select plan(14);
\ir _shared/fixtures.psql

-- ---- the policies themselves --------------------------------------------
select is_empty(
  $$ select polname::text from pg_policy p join pg_class c on c.oid = p.polrelid
      where c.relname = 'bank_details' and p.polcmd in ('a', 'w', 'd', '*')
        and p.polname <> 'admin_all' $$,
  'the only write policy left on bank_details is admin_all');
select isnt_empty(
  $$ select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
      where c.relname = 'bank_details' and p.polname = 'staff_self_bank' and p.polcmd = 'r' $$,
  'the worker keeps a read-only self policy (§10.1 Payment information)');

-- ---- staff ---------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*)::int from bank_details where staff_id = :'staffa'), 1,
  'a worker still reads their own bank details');
select is((select count(*)::int from bank_details where staff_id = :'staffb'), 0,
  'and never another worker''s');

with u as (update bank_details set sort_code = '12-34-56' where staff_id = :'staffa' returning 1)
  select is((select count(*)::int from u), 0,
    'a worker can no longer update their own row directly — no E5, no validation that way');
select throws_ok(
  format($$ insert into bank_details (staff_id, account_holder, sort_code, account_number)
            values (%L, 'Staff Beta', '1', '2') $$, :'staffb'),
  '42501', null, 'a worker cannot insert bank details directly');

select lives_ok($$ select staff_save_bank('Staff Alpha', '20-00-00', '55779911') $$,
  'staff_save_bank() still saves: it is security definer and needs no policy of the caller''s');
select is((select sort_code from bank_details where staff_id = :'staffa'), '20-00-00',
  'the RPC''s write landed, formatted the way payroll reads it');
select throws_ok($$ select staff_save_bank('Staff Alpha', '20-00', '55779911') $$,
  'P0001', 'bad_sort_code', 'and it is the path that validates');

reset role;
select isnt_empty(
  format($$ select 1 from notification_outbox
            where template = 'E5' and key like 'E5:staff:%s:%%' $$, :'staffa'),
  '§2.10: the save queued E5 to payroll in the same transaction');

-- ---- client ----------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from bank_details), 0, 'a client reads no bank details');
with u as (update bank_details set sort_code = '00-00-00' returning 1)
  select is((select count(*)::int from u), 0, 'a client writes no bank details');

-- ---- admin -----------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
with u as (update bank_details set account_holder = 'Staff Bravo (corrected)' where staff_id = :'staffb' returning 1)
  select is((select count(*)::int from u), 1, 'the office can still correct a row (admin_all)');

-- ---- anon ------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select is((select count(*)::int from bank_details), 0, 'anon reads no bank details');

reset role;
select * from finish();
rollback;
