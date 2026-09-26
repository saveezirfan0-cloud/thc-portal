-- =====================================================================
-- 608 · Change password is throttled per account (ADR-0051, review L2)
--
-- 20261001100200. The Client Portal's Change password action re-verifies
-- the current password with signInWithPassword. Every attempt leaves from
-- Vercel's addresses, so Supabase's per-IP limit does not bind somebody
-- guessing from a left-open session. 5 failed checks per account per 15
-- minutes, then the action refuses before signInWithPassword runs.
-- Asserted here:
--   A. the table is private.password_check_failures: RLS on, no policy,
--      nothing granted to an API role; unreadable and unwritable by a
--      client, a worker and anon;
--   B. the two functions are definer, pin search_path, are closed to anon
--      and PUBLIC, and open to authenticated;
--   C. under 5 allowed, at 5 refused, failures older than 15 minutes do
--      not count, one account's failures do not touch another's, the day
--      trim touches only the caller's rows;
--   D. a null uid is refused and records nothing;
--   E. 001_rls_guard still holds: nothing new in public, and the client
--      role holds no table policy.
-- =====================================================================
begin;
select plan(34);
\ir _shared/fixtures.psql

-- =====================================================================
-- A · the table
-- =====================================================================
select has_table('private', 'password_check_failures', 'private.password_check_failures exists');
select hasnt_table('public', 'password_check_failures',
  'and it is not in public, where PostgREST would publish it and 001_rls_guard would inventory it');
select ok((select relrowsecurity from pg_class where oid = 'private.password_check_failures'::regclass),
  'RLS is on');
select is((select count(*)::int from pg_policy where polrelid = 'private.password_check_failures'::regclass), 0,
  'with no policy for any role: it is reachable only through the two functions');
select ok(not has_schema_privilege('anon', 'private', 'usage')
      and not has_schema_privilege('authenticated', 'private', 'usage'),
  'the private schema is not usable by either API role');
select ok(not has_table_privilege('anon', 'private.password_check_failures', 'select,insert,update,delete')
      and not has_table_privilege('authenticated', 'private.password_check_failures', 'select,insert,update,delete')
      and not has_table_privilege('public', 'private.password_check_failures', 'select,insert,update,delete'),
  'no API role and not PUBLIC holds any privilege on the table');
select has_index('private', 'password_check_failures', 'password_check_failures_user_failed_at_idx',
  array['user_id', 'failed_at'], 'indexed on (user_id, failed_at)');

-- a client contact
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select count(*) from private.password_check_failures $$, '42501', null,
  'a client cannot read the table');
select throws_ok($$ insert into private.password_check_failures (user_id) values ('33333333-3333-3333-3333-333333333333') $$,
  '42501', null, 'a client cannot write a failure against somebody else''s account');
select throws_ok($$ delete from private.password_check_failures $$, '42501', null,
  'a client cannot clear its own count');

-- a worker
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select count(*) from private.password_check_failures $$, '42501', null,
  'a worker cannot read the table');

-- anon
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select count(*) from private.password_check_failures $$, '42501', null,
  'anon cannot read the table');
select throws_ok($$ insert into private.password_check_failures (user_id) values ('22222222-2222-2222-2222-222222222222') $$,
  '42501', null, 'anon cannot write it');

-- =====================================================================
-- B · the functions
-- =====================================================================
reset role;
select ok((select bool_and(p.prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('password_check_allowed', 'record_password_check_failure')
              and exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%'))
      and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('password_check_allowed', 'record_password_check_failure')) = 2,
  'both functions are security definer and pin their search_path');
select ok(not has_function_privilege('anon', 'public.password_check_allowed()', 'execute')
      and not has_function_privilege('anon', 'public.record_password_check_failure()', 'execute'),
  'anon cannot execute either function');
select ok(not has_function_privilege('public', 'public.password_check_allowed()', 'execute')
      and not has_function_privilege('public', 'public.record_password_check_failure()', 'execute'),
  'PUBLIC''s default EXECUTE is revoked from both (190 2f)');
select ok(has_function_privilege('authenticated', 'public.password_check_allowed()', 'execute')
      and has_function_privilege('authenticated', 'public.record_password_check_failure()', 'execute'),
  'a signed-in caller can execute both');

select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select public.password_check_allowed() $$, '42501', null,
  'anon calling password_check_allowed is refused outright');
select throws_ok($$ select public.record_password_check_failure() $$, '42501', null,
  'anon calling record_password_check_failure is refused outright');

-- =====================================================================
-- C · the limit
-- =====================================================================
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select ok(public.password_check_allowed(), 'no failures yet: allowed');

select public.record_password_check_failure();
select public.record_password_check_failure();
select public.record_password_check_failure();
select public.record_password_check_failure();
select ok(public.password_check_allowed(), 'four failures in 15 minutes: still allowed');

select public.record_password_check_failure();
select ok(not public.password_check_allowed(), 'the fifth failure in 15 minutes: refused');

reset role;
select is((select count(*)::int from private.password_check_failures where user_id = :'clienta_uid'), 5,
  'one row per recorded failure, all against the caller''s own account');

-- another account is untouched by client A's five
select set_config('request.jwt.claims', json_build_object('sub', :'clientb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select ok(public.password_check_allowed(), 'client A''s failures do not lock out client B');
select public.record_password_check_failure();
reset role;
select is((select count(*)::int from private.password_check_failures where user_id = :'clientb_uid'), 1,
  'client B''s failure is recorded against client B');
select is((select count(*)::int from private.password_check_failures where user_id = :'clienta_uid'), 5,
  'and client A''s count is unchanged by it');

-- only the last 15 minutes count
insert into private.password_check_failures (user_id, failed_at)
  select :'staffa_uid'::uuid, now() - interval '16 minutes' from generate_series(1, 5);
insert into private.password_check_failures (user_id, failed_at)
  select :'staffa_uid'::uuid, now() - interval '5 minutes' from generate_series(1, 4);
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select ok(public.password_check_allowed(),
  'five failures 16 minutes ago plus four recent: allowed — the old ones have aged out');
select public.record_password_check_failure();
select ok(not public.password_check_allowed(),
  'one more recent failure makes five in the window: refused');

-- the day trim is the caller's own
reset role;
insert into private.password_check_failures (user_id, failed_at) values
  (:'staffb_uid', now() - interval '2 days'),
  (:'admin_uid',  now() - interval '2 days');
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.record_password_check_failure();
reset role;
select is((select count(*)::int from private.password_check_failures
            where user_id = :'staffb_uid' and failed_at < now() - interval '1 day'), 0,
  'recording a failure trims the caller''s own rows older than a day');
select is((select count(*)::int from private.password_check_failures
            where user_id = :'admin_uid' and failed_at < now() - interval '1 day'), 1,
  'and leaves every other account''s rows alone');

-- =====================================================================
-- D · no uid
-- =====================================================================
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
set local role authenticated;
select is(public.password_check_allowed(), false,
  'a caller with no uid is refused, not waved through');
select lives_ok($$ select public.record_password_check_failure() $$,
  'recording with no uid does not raise');
reset role;
select is((select count(*)::int from private.password_check_failures where user_id is null), 0,
  'and writes nothing');

-- =====================================================================
-- E · 001_rls_guard's invariants still hold
-- =====================================================================
select is_empty(
  $$ select c.relname::text from pg_policy p join pg_class c on c.oid = p.polrelid
      where p.polname like 'client\_%' $$,
  'ADR-0026 still holds: the client role has no policy on any table');

select * from finish();
rollback;
