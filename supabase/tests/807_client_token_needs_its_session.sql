-- =====================================================================
-- 807 · 20261013100100: a client token dies with its sign-in session
--
--   current_app_role(): a client token whose auth.sessions row is gone
--   has no role, so client_portal_visible() and every client_* view stop
--   answering at once; a live session and a token with no session_id are
--   judged as before. The admin (756) and the worker (790) are held to
--   the same rule already; the worker is re-checked here so the three
--   roles are pinned side by side.
-- =====================================================================
begin;
select plan(7);
\ir _shared/fixtures.psql

\set sess_client '80700000-0000-4000-8000-000000000001'
\set sess_staff  '80700000-0000-4000-8000-000000000002'

insert into auth.sessions (id, user_id, created_at, updated_at)
  values (:'sess_client', :'clienta_uid', now(), now());

select set_config('request.jwt.claims',
  json_build_object('sub', :'clienta_uid', 'role', 'authenticated', 'session_id', :'sess_client')::text, true);
select is(current_app_role()::text, 'client', 'a client token with a live session keeps its role');
set local role authenticated;
select is((select count(*)::int from client_events_v where id = :'event_a'), 1,
  'and reads its own event through client_events_v');
reset role;

delete from auth.sessions where id = :'sess_client';
select is(current_app_role(), null::app_role,
  'once the session is ended (sign out other devices, password reset, switch off), the token has no role');
set local role authenticated;
select is((select count(*)::int from client_events_v where id = :'event_a'), 0,
  'and the portal''s views answer nothing straight away, not at the token''s exp');
reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select is(current_app_role()::text, 'client', 'a client token without session_id is judged as before');

-- The worker, as 20261012120400 left it: no live session, no role.
select set_config('request.jwt.claims',
  json_build_object('sub', :'staffa_uid', 'role', 'authenticated', 'session_id', :'sess_staff')::text, true);
select is(current_app_role(), null::app_role, 'a worker token with no live session has no role either (790)');

select is((select prolang from pg_proc where oid = 'public.current_app_role()'::regprocedure),
          (select oid from pg_language where lanname = 'plpgsql'),
  'still plpgsql, so its plan stays cached per session (20261012120000, 786)');

select * from finish();
rollback;
