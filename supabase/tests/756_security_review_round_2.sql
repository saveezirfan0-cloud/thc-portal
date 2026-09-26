-- =====================================================================
-- 756 · Security review of the second round (20261001204000)
--   1 · a viewer cannot start an auto-assign round
--   2 · a Back Office token dies with its sign-in session
-- =====================================================================
begin;
select plan(7);
\ir _shared/fixtures.psql

\set sess '75600000-0000-4000-8000-000000000001'

-- 1 · auto_assign_first_round refuses a viewer before anything is posted.
update profiles set office_role = 'viewer' where id = :'admin_uid';
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format('select auto_assign_first_round(%L)', :'event_a'), '42501', 'read_only',
  'a viewer cannot start an auto-assign round (it would invite workers from a session-less job)');
reset role;
update profiles set office_role = 'owner' where id = :'admin_uid';
set local role authenticated;
select lives_ok(format('select auto_assign_first_round(%L)', :'event_a'),
  'an owner still can (it answers queued=false here: no Edge base URL locally)');
reset role;

-- 2 · session_id in the token must still exist for a Back Office login.
insert into auth.sessions (id, user_id, created_at, updated_at) values (:'sess', :'admin_uid', now(), now());
select set_config('request.jwt.claims',
  json_build_object('sub', :'admin_uid', 'role', 'authenticated', 'session_id', :'sess')::text, true);
select is(current_app_role()::text, 'admin', 'a live sign-in session keeps the admin role');

delete from auth.sessions where id = :'sess';
select is(current_app_role(), null, 'once the session is ended (reset two-step, switch off, sign out), the token has no role');
select is(office_can('users'), false, 'and no office permission');

-- A client token is unaffected by the Back Office rule.
select set_config('request.jwt.claims',
  json_build_object('sub', :'clienta_uid', 'role', 'authenticated', 'session_id', :'sess')::text, true);
select is(current_app_role()::text, 'client', 'a client login is not held to the session rule');

-- A token with no session_id (jobs, tests) keeps the previous behaviour.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select is(current_app_role()::text, 'admin', 'a token without session_id is judged as before');

select * from finish();
rollback;
