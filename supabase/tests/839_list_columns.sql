-- =====================================================================
-- 839 · Column chooser preferences (ADR-0139)
--   20261014193000_list_columns.sql
--
--   1. Every login starts with no choice ('{}'): the screens' defaults.
--   2. An office login sets and reads its own, one list at a time; NULL
--      takes a list back to its default.
--   3. Only its own: another office login's row is untouched, and the
--      table itself shows a login only its own row (profiles_self).
--   4. Staff and client logins are refused; neither has a chooser.
--   5. Only the shape the screens write is accepted, and a refused call
--      changes nothing.
--   6. No session, no access; anon holds no grant; no write policy added.
-- =====================================================================
begin;
select plan(26);
\ir _shared/fixtures.psql

\set ops_uid '83900000-0000-4000-8000-000000000001'
insert into auth.users (id, email) values (:'ops_uid', 'ops.839@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'ops_uid', 'admin', 'scheduler', 'Ops 839');

-- ---------------------------------------------------------------------
-- 1 · The default
-- ---------------------------------------------------------------------
select is((select list_columns from profiles where id = :'admin_uid'), '{}'::jsonb,
  'an office login starts with no column choice');
select is((select list_columns from profiles where id = :'staffa_uid'), '{}'::jsonb,
  'so does a worker');
select is((select list_columns from profiles where id = :'clienta_uid'), '{}'::jsonb,
  'and a client');

-- ---------------------------------------------------------------------
-- 2 · An office login sets its own
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(my_list_columns(), '{}'::jsonb, 'the admin reads no choice yet');
select is(set_my_list_columns('venues', '{"order": ["type", "address"], "hidden": ["address"]}'),
  '{"order": ["type", "address"], "hidden": ["address"]}'::jsonb,
  'the admin hides and reorders on /venues');
select is(set_my_list_columns('staff.inactive', '{"order": ["left"], "hidden": []}'),
  '{"order": ["left"], "hidden": []}'::jsonb,
  'and on a second list, keyed by view');
select is(my_list_columns() -> 'venues' -> 'hidden', '["address"]'::jsonb,
  'and reads the first back');
select is((select count(*)::int from jsonb_object_keys(my_list_columns())), 2,
  'both lists are kept');
select is(set_my_list_columns('venues', null), 'null'::jsonb,
  'NULL takes a list back to its default');
select ok(not (my_list_columns() ? 'venues') and my_list_columns() ? 'staff.inactive',
  'only that list');
select is((select count(*)::int from profiles), 1,
  'through the table an office login sees only its own row (profiles_self)');

-- ---------------------------------------------------------------------
-- 3 · Only theirs
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'ops_uid', 'role', 'authenticated')::text, true);
select is(my_list_columns(), '{}'::jsonb,
  'a second office login (a scheduler) does not read the first one''s choice');
select is(set_my_list_columns('venues', '{"order": [], "hidden": ["radius"]}') -> 'hidden',
  '["radius"]'::jsonb, 'and sets its own');
reset role;
select is((select list_columns from profiles where id = :'admin_uid'),
  '{"staff.inactive": {"order": ["left"], "hidden": []}}'::jsonb,
  'the first login''s row is untouched');

-- ---------------------------------------------------------------------
-- 4 · Staff and client logins have no chooser
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select set_my_list_columns('venues', '{"order": [], "hidden": []}') $$,
  '42501', 'not_office', 'a worker is refused');
select is(my_list_columns(), '{}'::jsonb, 'and reads nothing');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select throws_ok($$ select set_my_list_columns('venues', '{"order": [], "hidden": []}') $$,
  '42501', 'not_office', 'a client is refused');
select is(my_list_columns(), '{}'::jsonb, 'and reads nothing');
reset role;
select is((select list_columns from profiles where id in (:'staffa_uid', :'clienta_uid') group by list_columns),
  '{}'::jsonb, 'neither row was written');

-- ---------------------------------------------------------------------
-- 5 · What is accepted
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select set_my_list_columns('Bad Key', '{"order": [], "hidden": []}') $$,
  'P0001', 'list_key_invalid', 'a list key that is not lower-case dotted is refused');
select throws_ok($$ select set_my_list_columns('venues', '{"order": ["Type"], "hidden": []}') $$,
  'P0001', 'list_columns_invalid', 'a column id that is not lower-case is refused');
select throws_ok($$ select set_my_list_columns('venues', '{"order": [], "hidden": [], "x": 1}') $$,
  'P0001', 'list_columns_invalid', 'an extra key is refused');
select throws_ok($$ select set_my_list_columns('venues', '{"order": "type", "hidden": []}') $$,
  'P0001', 'list_columns_invalid', 'an order that is not a list is refused');
select is(my_list_columns(), '{"staff.inactive": {"order": ["left"], "hidden": []}}'::jsonb,
  'a refused call changed nothing');

-- ---------------------------------------------------------------------
-- 6 · Closed to the signed-out; no write path through the table
-- ---------------------------------------------------------------------
reset role;
select ok(not has_function_privilege('anon', 'public.set_my_list_columns(text, jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.my_list_columns()', 'execute'),
  'anon can call neither function');
select is((select count(*)::int from pg_policy where polrelid = 'profiles'::regclass and polcmd <> 'r'), 0,
  'profiles still has no write policy: the function is the only door');

select * from finish();
rollback;
