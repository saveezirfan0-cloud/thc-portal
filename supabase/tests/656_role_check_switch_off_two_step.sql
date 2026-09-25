-- =====================================================================
-- 656 · current_app_role() honours a switched-off login and two-step
--       sign-in (20260930160000), and queue_account_invite needs the
--       owner's Users & access permission.
--
-- The app already stopped both at its door (ADR-0035 switch off ends
-- sessions; ADR-0037 middleware sends an aal1 session to the code step).
-- This pins the DATABASE half: the same token used straight against the
-- API gets no role, so every policy and admin RPC refuses it.
-- =====================================================================
begin;
select plan(12);
\ir _shared/fixtures.psql

\set admin_claims_aal1 '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aal":"aal1"}'
\set admin_claims_aal2 '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aal":"aal2"}'

-- ---------------------------------------------------------------------
-- 1 · No factor: aal1 is enough, as before
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', :'admin_claims_aal1', true);
select is(current_app_role()::text, 'admin', 'an admin without two-step keeps the admin role at aal1');

-- An unfinished set-up (unverified factor) changes nothing.
insert into auth.mfa_factors (user_id, status) values (:'admin_uid', 'unverified');
select is(current_app_role()::text, 'admin', 'an unverified factor does not demand the code step');

-- ---------------------------------------------------------------------
-- 2 · A verified factor: aal1 gets nothing, aal2 gets admin
-- ---------------------------------------------------------------------
insert into auth.mfa_factors (user_id, status) values (:'admin_uid', 'verified');
select is(current_app_role(), null, 'with two-step on, a password-only (aal1) session has no role');
select is(office_can('finance'), false, 'and no office permission');
set local role authenticated;
select is((select count(*)::int from clients), 0, 'so RLS shows it no client rows');
reset role;
select throws_ok($$ select * from admin_accounts() $$, '42501', null, 'and every admin RPC refuses it');

select set_config('request.jwt.claims', :'admin_claims_aal2', true);
select is(current_app_role()::text, 'admin', 'after the code step (aal2) the admin role is back');
select is(office_can('users'), true, 'with the owner''s permissions');

-- Client logins are not affected by the office's two-step rule.
insert into auth.mfa_factors (user_id, status) values (:'clienta_uid', 'verified');
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select is(current_app_role()::text, 'client', 'the two-step rule is the Back Office''s; a client login is unchanged');

-- ---------------------------------------------------------------------
-- 3 · A switched-off login has no role, even with a live token
-- ---------------------------------------------------------------------
update auth.users set banned_until = now() + interval '100 years' where id = :'clientb_uid';
select set_config('request.jwt.claims', json_build_object('sub', :'clientb_uid', 'role', 'authenticated')::text, true);
select is(current_app_role(), null, 'a switched-off login''s still-valid token gets no role');
update auth.users set banned_until = now() - interval '1 minute' where id = :'clientb_uid';
select is(current_app_role()::text, 'client', 'a ban that has ended no longer counts');

-- ---------------------------------------------------------------------
-- 4 · queue_account_invite is Users & access (owner only)
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', :'admin_claims_aal2', true);
update profiles set office_role = 'manager' where id = :'admin_uid';
select throws_ok(
  format('select queue_account_invite(%L, %L)', :'clienta_uid', 'http://127.0.0.1:3002/auth/invite?token=' || repeat('a', 56)),
  '42501', 'not_permitted', 'a manager cannot email a set-up link');

select * from finish();
rollback;
