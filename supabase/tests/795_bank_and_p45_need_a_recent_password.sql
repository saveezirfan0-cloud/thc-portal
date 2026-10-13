-- =====================================================================
-- 795 · bank details and a P45 need the password typed in the last ten
--       minutes
--       20261012120900 · §2.10, §10.6
--
-- A signed-in phone was enough to divert a worker's pay or end their
-- employment. Both RPCs now ask the token's `amr` for a password, otp or
-- recovery sign-in no older than 600 seconds, and refuse with P0001
-- 'reauth_required' otherwise.
-- =====================================================================
begin;
select plan(13);
\ir _shared/fixtures.psql

\set amr_fresh 'json_build_array(json_build_object(''method'', ''password'', ''timestamp'', extract(epoch from now())::bigint))'

-- =====================================================================
-- 1 · recent_password_auth()
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select is(recent_password_auth(), false, 'no amr: not recent');
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated',
  'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 30)))::text, true);
select is(recent_password_auth(), true, 'a password thirty seconds ago is recent');
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated',
  'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 900)))::text, true);
select is(recent_password_auth(), false, 'fifteen minutes ago is not');
select is(recent_password_auth(1200), true, 'unless the caller allows twenty');
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated',
  'amr', json_build_array(json_build_object('method', 'invite', 'timestamp', extract(epoch from now())::bigint),
                          json_build_object('method', 'magiclink', 'timestamp', extract(epoch from now())::bigint)))::text, true);
select is(recent_password_auth(), false, 'an activation or magic link proves the inbox, not the person: not recent');
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated',
  'amr', json_build_array(json_build_object('method', 'recovery', 'timestamp', extract(epoch from now())::bigint)))::text, true);
select is(recent_password_auth(), true, 'a password reset just now counts');

-- =====================================================================
-- 2 · staff_save_bank() and request_my_p45()
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated',
  'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 3600)))::text, true);
set local role authenticated;
select throws_ok($$ select staff_save_bank('Thief', '20-00-00', '99998888') $$,
  'P0001', 'reauth_required', 'a session signed in an hour ago cannot change bank details');
select throws_ok($$ select request_my_p45('Leaving') $$,
  'P0001', 'reauth_required', 'nor ask for a P45');
reset role;
select is((select account_number from bank_details where staff_id = :'staffa'), '11110001', 'the bank details are unchanged');
select is((select count(*)::int from notification_outbox where template = 'E5' and key like 'E5:staff:' || :'staffa' || ':%'), 0,
  'and nothing was emailed');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated',
  'amr', :amr_fresh)::text, true);
set local role authenticated;
select lives_ok($$ select staff_save_bank('Staff Alpha', '20-00-00', '99998888') $$,
  'after re-entering the password, the save goes through');
reset role;
select is((select account_number from bank_details where staff_id = :'staffa'), '99998888', 'and lands');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select staff_save_bank('X', '20-00-00', '12345678') $$,
  'P0001', 'unknown_staff', 'a non-worker still gets unknown_staff first, as before');
reset role;

select * from finish();
rollback;
