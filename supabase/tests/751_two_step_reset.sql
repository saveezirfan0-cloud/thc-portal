-- =====================================================================
-- 751 · Reset someone's two-step from /users (20260930220200, ADR-0054)
--
-- admin_reset_two_step: owners only, Back Office logins only, never your
-- own, a reason, a verified factor to reset; removes the factors, ends the
-- sessions, audits. And admin_accounts, re-created for its `two_step`
-- column, keeps every column and refusal it had (docs/10 §3b).
-- =====================================================================
begin;
select plan(29);
\ir _shared/fixtures.psql

\set manager   '75100000-0000-4000-8000-000000000001'
\set scheduler '75100000-0000-4000-8000-000000000002'
\set viewer    '75100000-0000-4000-8000-000000000003'
\set bare      '75100000-0000-4000-8000-000000000004'
\set sess1     '75100000-0000-4000-8000-0000000000a1'
\set sess2     '75100000-0000-4000-8000-0000000000a2'
\set sess3     '75100000-0000-4000-8000-0000000000a3'

insert into auth.users (id, email) values
  (:'manager',   'manager.751@rls.test'),
  (:'scheduler', 'scheduler.751@rls.test'),
  (:'viewer',    'viewer.751@rls.test'),
  (:'bare',      'bare.751@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'manager',   'admin', 'manager',   'Mona Manager'),
  (:'scheduler', 'admin', 'scheduler', 'Sam Scheduler'),
  (:'viewer',    'admin', 'viewer',    'Vera Viewer'),
  (:'bare',      'admin', 'manager',   'Bea NoFactor');

-- GoTrue's NOT NULL columns, as the real auth.mfa_factors has them.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
  (gen_random_uuid(), :'manager',   'Mona phone 751',      'totp', 'verified',   now(), now()),
  (gen_random_uuid(), :'manager',   'Mona abandoned 751',  'totp', 'unverified', now(), now()),
  (gen_random_uuid(), :'scheduler', 'Sam phone 751',       'totp', 'verified',   now(), now()),
  (gen_random_uuid(), :'bare',      'Bea abandoned 751',   'totp', 'unverified', now(), now());
insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
  (:'sess1', :'manager',   now(), now(), 'aal2'),
  (:'sess2', :'manager',   now(), now(), 'aal1'),
  (:'sess3', :'scheduler', now(), now(), 'aal2');
insert into auth.refresh_tokens (token, user_id, revoked, created_at, updated_at, session_id) values
  ('rt-751-1', :'manager',   false, now(), now(), :'sess1'),
  ('rt-751-3', :'scheduler', false, now(), now(), :'sess3');

-- ---------------------------------------------------------------------
-- 1 · Shape
-- ---------------------------------------------------------------------
select ok((select prosecdef from pg_proc where oid = 'admin_reset_two_step(uuid,text)'::regprocedure),
  'admin_reset_two_step is security definer (it reaches auth.mfa_factors)');
select ok(not has_function_privilege('anon', 'admin_reset_two_step(uuid,text)', 'execute')
      and not has_function_privilege('public', 'admin_reset_two_step(uuid,text)', 'execute')
      and has_function_privilege('authenticated', 'admin_reset_two_step(uuid,text)', 'execute'),
  'callable by a signed-in session only');
select ok(not has_function_privilege('anon', 'admin_accounts(app_role)', 'execute')
      and has_function_privilege('authenticated', 'admin_accounts(app_role)', 'execute'),
  'admin_accounts keeps its grants after the re-create');

-- ---------------------------------------------------------------------
-- 2 · Who may not
-- ---------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select throws_ok(format($$ select admin_reset_two_step(%L, 'lost phone') $$, :'manager'),
  '42501', 'not_authorised', 'a worker cannot');
set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok(format($$ select admin_reset_two_step(%L, 'lost phone') $$, :'manager'),
  '42501', 'not_authorised', 'a client cannot');
-- The scheduler has a verified factor, so their session must be aal2 to
-- be a Back Office session at all (20260930210500).
set local "request.jwt.claims" = '{"sub":"75100000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';
select throws_ok(format($$ select admin_reset_two_step(%L, 'lost phone') $$, :'manager'),
  '42501', 'not_permitted', 'a scheduler cannot (Users & access is the owner''s)');
set local "request.jwt.claims" = '{"sub":"75100000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(format($$ select admin_reset_two_step(%L, 'lost phone') $$, :'manager'),
  '42501', 'not_permitted', 'a viewer cannot');
set local "request.jwt.claims" = '{"sub":"75100000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok(format($$ select admin_reset_two_step(%L, 'lost phone') $$, :'manager'),
  '42501', 'not_permitted', 'a manager cannot');

-- ---------------------------------------------------------------------
-- 3 · What an owner may not
-- ---------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok($$ select admin_reset_two_step('75100000-0000-4000-8000-0000000000ff', 'lost phone') $$,
  'P0001', 'unknown_account', 'an unknown login');
select throws_ok(format($$ select admin_reset_two_step(%L, 'lost phone') $$, :'clienta_uid'),
  'P0001', 'not_office_login', 'a Client Portal login (two-step is the Back Office''s)');
select throws_ok(format($$ select admin_reset_two_step(%L, 'lost phone') $$, :'staffa_uid'),
  'P0001', 'not_office_login', 'a Staff App login');
select throws_ok(format($$ select admin_reset_two_step(%L, 'lost phone') $$, :'admin_uid'),
  'P0001', 'cannot_reset_own_two_step', 'their own (that is /account, with a fresh code)');
select throws_ok(format($$ select admin_reset_two_step(%L, '   ') $$, :'manager'),
  'P0001', 'reason_required', 'without a reason');
select throws_ok(format($$ select admin_reset_two_step(%L, 'lost phone') $$, :'bare'),
  'P0001', 'no_two_step', 'a login with no verified factor (an abandoned set-up is not two-step)');
reset role;
select is((select count(*)::int from auth.mfa_factors where user_id = :'bare'), 1,
  'and the refused call removed nothing');

-- ---------------------------------------------------------------------
-- 4 · admin_accounts shows it, and keeps everything it had
-- ---------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select two_step from admin_accounts() where id = :'manager'), true,
  'admin_accounts: two_step true for a verified factor');
select is((select two_step from admin_accounts() where id = :'bare'), false,
  'and false for an unverified one');
select is((select array[office_role::text, role::text, email, disabled::text]
             from admin_accounts('admin') where id = :'manager'),
          array['manager', 'admin', 'manager.751@rls.test', 'false'],
  'the ADR-0050 columns are all still there');
select is((select count(*)::int from admin_accounts('client') where id = :'clienta_uid' and client_name is not null), 1,
  'and the client filter and client name');

-- ---------------------------------------------------------------------
-- 5 · The reset
-- ---------------------------------------------------------------------
select is(admin_reset_two_step(:'manager', '  Lost phone, confirmed by call  ') ->> 'factorsRemoved', '2',
  'an owner resets a manager''s two-step: both factors go (the abandoned one too)');
reset role;
select is((select count(*)::int from auth.mfa_factors where user_id = :'manager'), 0, 'no factor left');
select is((select count(*)::int from auth.sessions where user_id = :'manager'), 0,
  'every session ended — an aal2 one made with the lost phone included');
select is((select count(*)::int from auth.refresh_tokens where user_id = :'manager'), 0,
  'and its refresh tokens');
select is((select count(*)::int from auth.mfa_factors where user_id = :'scheduler'), 1,
  'nobody else''s factor is touched');
select is((select count(*)::int from auth.sessions where user_id = :'scheduler'), 1,
  'nor their sessions');
select is((select data ->> 'reason' from audit_log where action = 'account.two_step_reset' and entity_id = :'manager'),
  'Lost phone, confirmed by call', 'audited as account.two_step_reset with the trimmed reason');
select is((select actor from audit_log where action = 'account.two_step_reset' and entity_id = :'manager'),
  :'admin_uid'::uuid, 'against the owner who did it');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select two_step from admin_accounts() where id = :'manager'), false,
  'admin_accounts now says two-step is off for them');
select throws_ok(format($$ select admin_reset_two_step(%L, 'again') $$, :'manager'),
  'P0001', 'no_two_step', 'a second reset has nothing to do');
reset role;

select * from finish();
rollback;
