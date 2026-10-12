-- =====================================================================
-- 790 · a worker's token counts only while its sign-in session exists
--       20261012120400 · §1.4, §10.1
--
-- "Sign out other devices" deletes the other sessions; the access token a
-- stolen phone already holds used to keep working for up to an hour,
-- because staff_caller() / staff_writer() resolved the worker from
-- auth.uid() alone. Now they ask auth.sessions, as current_app_role()
-- already did for the office, and a banned login is nobody too.
-- =====================================================================
begin;
select plan(11);
\ir _shared/fixtures.psql

\set sess '79000000-0000-4000-8000-0000000000e1'

insert into auth.sessions (id, user_id, created_at, updated_at) values (:'sess', :'staffa_uid', now(), now());
select set_config('request.jwt.claims', json_build_object(
  'sub', :'staffa_uid', 'role', 'authenticated', 'session_id', :'sess',
  'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint)))::text, true);
set local role authenticated;

select is(staff_caller(), :'staffa'::uuid, 'a live session: staff_caller() is the worker');
select is(current_app_role()::text, 'staff', 'and the role is staff');
select lives_ok($$ select staff_save_bank('Staff Alpha', '20-00-00', '55779911') $$,
  'a staff RPC works');
reset role;
-- staff_writer() is reached only from definers; the same claims, as one would see them.
select is(staff_writer(), :'staffa'::uuid, 'and staff_writer() resolves the worker too');

-- Sign out other devices / the reset flow: GoTrue deletes the session row.
delete from auth.sessions where id = :'sess';
set local role authenticated;
select is(staff_caller(), null::uuid, 'the session is gone: the old token is nobody');
select is(current_app_role(), null::app_role, 'and holds no role');
select throws_ok($$ select staff_save_bank('Thief', '20-00-00', '11112222') $$,
  'P0001', 'unknown_staff', 'a staff RPC with the old claims is refused');
reset role;
select is(staff_writer(), null::uuid, 'for staff_writer() too');

-- A banned login is nobody, session or not.
update auth.users set banned_until = now() + interval '1 day' where id = :'staffa_uid';
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(staff_caller(), null::uuid, 'a banned worker''s token resolves to nobody');
reset role;
update auth.users set banned_until = null where id = :'staffa_uid';

-- A token with no session_id (jobs, fixtures) is judged as before.
set local role authenticated;
select is(staff_caller(), :'staffa'::uuid, 'a token without session_id keeps the previous behaviour');
reset role;

select ok(not has_function_privilege('authenticated', 'public.auth_session_live()', 'execute')
      and not has_function_privilege('anon', 'public.auth_session_live()', 'execute'),
  'auth_session_live() is not an RPC');

select * from finish();
rollback;
