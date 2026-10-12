-- =====================================================================
-- 796 · sign-in, two-step code and forgot-password are throttled per
--       account
--       20261012121000 · ADR-0051 §25
--
-- GoTrue's limits are per IP and see only Vercel. auth_attempt_allowed()
-- and record_auth_attempt() count per sha256 of the normalised email:
-- sign_in and verify 5 failures / 15 min, recover 3 requests / hour.
-- Service role only.
-- =====================================================================
begin;
select plan(18);

select encode(extensions.digest('a.worker@example.com', 'sha256'), 'hex') as k1 \gset
select encode(extensions.digest('another@example.com', 'sha256'), 'hex') as k2 \gset

select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;

-- =====================================================================
-- 1 · sign_in
-- =====================================================================
select ok(auth_attempt_allowed('sign_in', :'k1'), 'a fresh address may sign in');
select record_auth_attempt('sign_in', :'k1', true) from generate_series(1, 4);
select ok(auth_attempt_allowed('sign_in', :'k1'), 'four failures: still allowed');
select record_auth_attempt('sign_in', :'k1', false) from generate_series(1, 3);
select ok(auth_attempt_allowed('sign_in', :'k1'), 'successes do not count');
select record_auth_attempt('sign_in', :'k1', true);
select ok(not auth_attempt_allowed('sign_in', :'k1'), 'the fifth failure in 15 minutes closes the door: the sixth try is refused');
select ok(auth_attempt_allowed('sign_in', :'k2'), 'another address is unaffected');
select ok(auth_attempt_allowed('verify', :'k1'), 'and the code step counts separately');
select ok(auth_attempt_allowed('recover', :'k1'), 'as does forgot-password');
reset role;

update private.auth_attempts set at = at - interval '16 minutes' where key_hash = :'k1' and kind = 'sign_in';
set local role service_role;
select ok(auth_attempt_allowed('sign_in', :'k1'), 'fifteen minutes later the window has passed');

-- =====================================================================
-- 2 · verify and recover
-- =====================================================================
select record_auth_attempt('verify', :'k2', true) from generate_series(1, 5);
select ok(not auth_attempt_allowed('verify', :'k2'), 'five wrong two-step codes in 15 minutes: refused');
select record_auth_attempt('recover', :'k2', false) from generate_series(1, 3);
select ok(not auth_attempt_allowed('recover', :'k2'), 'three reset requests in an hour, whatever p_failed says: refused');

-- =====================================================================
-- 3 · Input
-- =====================================================================
select throws_ok($$ select auth_attempt_allowed('login', repeat('a', 64)) $$, '22023', 'auth_attempt_kind_invalid',
  'an unknown kind is refused');
select throws_ok($$ select record_auth_attempt('sign_in', 'a.worker@example.com', true) $$, '22023', 'auth_attempt_key_invalid',
  'a raw address is refused — only the digest is stored');
select throws_ok(format($$ select auth_attempt_allowed('sign_in', %L) $$, upper(:'k1')), '22023', 'auth_attempt_key_invalid',
  'the digest is lowercase hex');
reset role;

-- =====================================================================
-- 4 · Retention and grants
-- =====================================================================
insert into private.auth_attempts (kind, key_hash, at) values ('sign_in', :'k2', now() - interval '25 hours');
set local role service_role;
select record_auth_attempt('sign_in', :'k2', true);
reset role;
select is((select count(*)::int from private.auth_attempts where at < now() - interval '24 hours'), 0,
  'rows older than 24 hours are purged on the next record');

select ok(not has_function_privilege('anon', 'public.auth_attempt_allowed(text, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.auth_attempt_allowed(text, text)', 'execute'),
  'anon and authenticated cannot ask');
select ok(not has_function_privilege('anon', 'public.record_auth_attempt(text, text, boolean)', 'execute')
      and not has_function_privilege('authenticated', 'public.record_auth_attempt(text, text, boolean)', 'execute'),
  'nor record');
select ok(has_function_privilege('service_role', 'public.auth_attempt_allowed(text, text)', 'execute')
      and has_function_privilege('service_role', 'public.record_auth_attempt(text, text, boolean)', 'execute'),
  'the apps'' admin client can do both');
select ok(not has_table_privilege('authenticated', 'private.auth_attempts', 'select')
      and not has_table_privilege('service_role', 'private.auth_attempts', 'select'),
  'the table itself is nobody''s to read');

select * from finish();
rollback;
