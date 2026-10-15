-- =====================================================================
-- 844 · setting a password from an emailed link clears that account's
--       sign-in lockout
--       20261015140000 · ADR-0051 §25
--
-- Five failures before a reset must not refuse the new password.
-- clear_sign_in_failures() deletes the account's sign_in rows and nothing
-- else. Service role only.
-- =====================================================================
begin;
select plan(10);

select encode(extensions.digest('a.worker@example.com', 'sha256'), 'hex') as k1 \gset
select encode(extensions.digest('another@example.com', 'sha256'), 'hex') as k2 \gset
select encode(extensions.digest('ip:198.51.100.7', 'sha256'), 'hex') as k3 \gset

select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;

select record_auth_attempt('sign_in', :'k1', true) from generate_series(1, 5);
select record_auth_attempt('sign_in', :'k2', true) from generate_series(1, 5);
select record_auth_attempt('verify', :'k1', true) from generate_series(1, 5);
select record_auth_attempt('recover', :'k1', true) from generate_series(1, 3);
select record_auth_attempt('sign_in_ip', :'k3', true) from generate_series(1, 30);
select ok(not auth_attempt_allowed('sign_in', :'k1'), 'five failures before the reset: locked');

select lives_ok(format('select clear_sign_in_failures(%L)', :'k1'), 'the service role clears one account');
select ok(auth_attempt_allowed('sign_in', :'k1'), 'the new password may be tried at once');
select ok(not auth_attempt_allowed('sign_in', :'k2'), 'another account stays locked');
select ok(not auth_attempt_allowed('verify', :'k1'), 'the two-step code count is not touched');
select ok(not auth_attempt_allowed('recover', :'k1'), 'nor the reset-request count');
select ok(not auth_attempt_allowed('sign_in_ip', :'k3'), 'nor the per-address count');

select throws_ok($$ select clear_sign_in_failures('not-a-key') $$, '22023', 'auth_attempt_key_invalid',
  'a key that is not 64 lowercase hex characters is refused');
reset role;

select ok(not has_function_privilege('authenticated', 'public.clear_sign_in_failures(text)', 'execute'),
  'a signed-in user cannot clear a lockout');
select ok(not has_function_privilege('anon', 'public.clear_sign_in_failures(text)', 'execute'),
  'nor can an anonymous caller');

select * from finish();
rollback;
