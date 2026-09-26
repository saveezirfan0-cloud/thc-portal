-- =====================================================================
-- 150 · Roles & rates (§9.8) — 20260921153100_roles_directory.sql
--
-- The holiday element is the thing to hold still. §1.5 says it is
-- calculated and never stored, and §9.8 says all margin in the system is
-- computed from the final rate, so a drift between the SQL and the
-- TypeScript would move every margin on every screen. The vectors below
-- are the same numbers packages/domain asserts.
--
-- The other half is the delete guard: a role on a rate card or on a built
-- event section cannot be deleted, and the manager must be told which.
-- =====================================================================
begin;
select plan(25);
\ir _shared/fixtures.psql

\set role_free  '8b8b8b8b-0000-4000-8000-000000000001'

-- ---- structure --------------------------------------------------------
select ok((select 'security_invoker=true' = any(reloptions) from pg_class where relname = 'role_directory_v'),
  'role_directory_v is security_invoker');

-- ---- admin ------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*)::int from role_directory_v where id = :'role_id'), 1,
  'admin reads the role through role_directory_v');
select is((select pay_rate from role_directory_v where id = :'role_id'), 14.00::numeric,
  'the base rate is the one on the row');
select is((select holiday_rate from role_directory_v where id = :'role_id'), 1.69::numeric,
  'holiday on £14.00 is £1.69 — 12.07%, broken out, never blended (§9.8)');
select is((select final_rate from role_directory_v where id = :'role_id'), 15.69::numeric,
  'final rate on £14.00 is £15.69, which is what every margin is computed from');

-- The wireframe's own figures, so the screen and the database agree on the
-- numbers a manager will actually see.
select is(final_rate(14.50::numeric), 16.25::numeric, 'wireframe vector: £14.50 → £16.25');
select is(final_rate(15.50::numeric), 17.37::numeric, 'wireframe vector: £15.50 → £17.37');
select is(final_rate(19.00::numeric), 21.29::numeric, 'wireframe vector: £19.00 → £21.29');
select is(final_rate(13.50::numeric), 15.13::numeric, 'wireframe vector: £13.50 → £15.13');
select is(final_rate(18.00::numeric), 20.17::numeric, 'wireframe vector: £18.00 → £20.17');

-- Adding the broken-out holiday to the base must give the final rate, or the
-- three columns of §9.8's table would not add up in front of the manager.
select is(
  (select count(*)::int from generate_series(0, 5000) cents
    where round(cents / 100.0, 2) + round(round(cents / 100.0, 2) * 0.1207, 2)
       <> final_rate(round(cents / 100.0, 2))),
  0,
  'base + holiday = final rate at every penny from £0.00 to £50.00');

-- ---- the counts the list shows ---------------------------------------
select is((select rate_card_count from role_directory_v where id = :'role_id'), 1,
  '"On rate cards" counts the client rate cards using the role (§9.7)');
select is((select section_count from role_directory_v where id = :'role_id'), 2,
  'and the built role sections are counted too, for the delete guard');

-- ---- writes -----------------------------------------------------------
select lives_ok(
  $$ select create_role('  Event Supervisor  ', 18.00, '  Runs a team of up to 15 on site  ') $$,
  'admin adds a role to the catalogue');
select is((select name from role_directory_v where pay_rate = 18.00), 'Event Supervisor',
  'create_role trims the name');
select is((select description from roles where name = 'Event Supervisor'),
  'Runs a team of up to 15 on site', 'and trims the internal description');

select throws_ok(
  $$ select create_role('  ', 18.00, null) $$,
  '23514', null, 'a role cannot be created without a name');
select throws_ok(
  $$ select create_role('Negative', -1.00, null) $$,
  '23514', null, 'a pay rate cannot be negative');
select throws_ok(
  $$ select create_role('Fractions', 14.005, null) $$,
  '23514', null, 'a pay rate is set to the penny, not rounded silently behind the manager');
select throws_ok(
  $$ select create_role('RLS Fixture Role', 12.00, null) $$,
  '23505', null, 'two roles cannot share a name: the rate-card picker would be ambiguous');

-- A role in use cannot be deleted, and the message says what is using it.
select throws_ok(
  $$ select delete_role((select id from roles where name = 'RLS Fixture Role')) $$,
  '23503', null, 'a role on a rate card and on an event cannot be deleted (§9.8)');
select is((select count(*)::int from roles where name = 'RLS Fixture Role'), 1,
  'and it is still there afterwards');

insert into roles (id, name, pay_rate) values (:'role_free', 'Fixture Unused Role', 11.00);
select lives_ok(
  $$ select delete_role('8b8b8b8b-0000-4000-8000-000000000001') $$,
  'a role on no rate card and no event deletes');

-- ---- client and worker ------------------------------------------------
-- `roles` carries pay_rate, so it is money. §11.1: the client sees none of
-- it, and a worker sees their own rate through their booking, never here.
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from role_directory_v), 0,
  'a client reads no role through role_directory_v (§11.1 — it carries pay_rate)');

reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from role_directory_v), 0,
  'a worker reads no role through role_directory_v: their own rate reaches them through their booking');

reset role;
select * from finish();
rollback;
