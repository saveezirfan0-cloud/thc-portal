-- =====================================================================
-- 772 · Clock format (ADR-0085)
--   20261005100000_time_format.sql
--
--   1. Everyone starts on the 24-hour clock.
--   2. Any signed-in role (office, worker, client) reads and sets its own,
--      and only its own: one login's change never moves another's.
--   3. Only "24h" and "12h" are accepted, and nothing is half-written.
--   4. No session, no access; anon holds no grant; no UPDATE policy was added.
-- =====================================================================
begin;
select plan(17);
\ir _shared/fixtures.psql

-- ---------------------------------------------------------------------
-- 1 · The default
-- ---------------------------------------------------------------------
select is((select time_format from profiles where id = :'admin_uid'), '24h',
  'an office login starts on the 24-hour clock');
select is((select time_format from profiles where id = :'staffa_uid'), '24h',
  'a worker starts on it');
select is((select time_format from profiles where id = :'clienta_uid'), '24h',
  'and so does a client');

-- ---------------------------------------------------------------------
-- 2 · A worker sets their own
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(my_time_format(), '24h', 'a worker reads their own: 24h');
select is(set_my_time_format('12h'), '12h', 'a worker switches to 12-hour');
select is(my_time_format(), '12h', 'and reads it back');

-- ---------------------------------------------------------------------
-- 3 · Only theirs
-- ---------------------------------------------------------------------
reset role;
select is((select time_format from profiles where id = :'staffb_uid'), '24h',
  'another worker is untouched');
select is((select time_format from profiles where id = :'admin_uid'), '24h',
  'and so is the office login');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(my_time_format(), '24h', 'the office login still reads 24h');
select is(set_my_time_format('12h'), '12h', 'an office login sets its own');
select is(set_my_time_format('24h'), '24h', 'and can set it back');

-- ---------------------------------------------------------------------
-- 4 · What is accepted
-- ---------------------------------------------------------------------
select throws_ok($$ select set_my_time_format('13h') $$, 'P0001', 'time_format_invalid',
  'a value that is not a clock format is refused');
select throws_ok($$ select set_my_time_format(null) $$, 'P0001', 'time_format_invalid',
  'and so is null');
select is(my_time_format(), '24h', 'a refused call changed nothing');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select is(set_my_time_format('12h'), '12h', 'a client login can set theirs too');

-- ---------------------------------------------------------------------
-- 5 · Closed to the signed-out
-- ---------------------------------------------------------------------
reset role;
select ok(not has_function_privilege('anon', 'public.set_my_time_format(text)', 'execute'),
  'anon cannot call set_my_time_format');
select ok(not has_function_privilege('anon', 'public.my_time_format()', 'execute'),
  'anon cannot call my_time_format');

select * from finish();
rollback;
