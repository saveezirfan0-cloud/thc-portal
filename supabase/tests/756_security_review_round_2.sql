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
  -- aal2: since 20261020130000 (ADR-0164) an office session below aal2 has
  -- no role while two-step is required, which is the default (895).
  json_build_object('sub', :'admin_uid', 'role', 'authenticated', 'session_id', :'sess', 'aal', 'aal2')::text, true);
select is(current_app_role()::text, 'admin', 'a live sign-in session keeps the admin role');

delete from auth.sessions where id = :'sess';
select is(current_app_role(), null, 'once the session is ended (reset two-step, switch off, sign out), the token has no role');
select is(office_can('users'), false, 'and no office permission');

-- A client token was unaffected by this rule until 20261013100100, which
-- holds every role to it (807 pins the client case in full).
select set_config('request.jwt.claims',
  json_build_object('sub', :'clienta_uid', 'role', 'authenticated', 'session_id', :'sess')::text, true);
select is(current_app_role(), null::app_role, 'a client login with an ended session has no role either (20261013100100)');

-- A token with no session_id (jobs, tests) keeps the previous behaviour.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select is(current_app_role()::text, 'admin', 'a token without session_id is judged as before');

select * from finish();
rollback;
