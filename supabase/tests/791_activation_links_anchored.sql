-- =====================================================================
-- 791 · a set-up link names one of OUR apps
--       20261012120500 · §2.7 E3, ADR-0021, ADR-0058
--
-- E3 and E11 carry a link the office builds; the database only looked for
-- `/activate/<token>` somewhere in the string (E3) or any https host
-- (E11). Now the link is anchored end to end, and when the vault holds
-- `app_origins` its origin must be one of them. Also: activation_preview()
-- reads the activation token only, within its 24-hour life.
-- =====================================================================
begin;
select plan(20);
\ir _shared/fixtures.psql

\set tok   'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'
\set cand  '79100000-0000-4000-8000-0000000000c1'
\set cand_uid '79100000-0000-4000-8000-0000000000a1'

-- =====================================================================
-- 1 · The shape, with no origins configured
-- =====================================================================
select ok(activation_link_ok('https://staff.test/activate/' || :'tok'), 'the personal link is accepted');
select ok(activation_link_ok('https://staff.test/activate/' || :'tok' || '?type=magiclink'),
  'with the magic-link marker activationLink() adds');
select ok(activation_link_ok('http://127.0.0.1:3001/activate/' || :'tok'), 'and a local development origin');
select ok(not activation_link_ok('https://evil.example/landing?next=https://staff.test/activate/' || :'tok'),
  'a link that merely CONTAINS /activate/<token> is refused');
select ok(not activation_link_ok('https://staff.test@evil.example/activate/' || :'tok'),
  'userinfo (`@`) is refused');
select ok(not activation_link_ok('https://evil.example/x/activate/' || :'tok'), 'a path before /activate is refused');
select ok(not activation_link_ok('https://staff.test/activate/' || :'tok' || '/../../phish'),
  'anything after the token is refused');
select ok(not activation_link_ok('http://staff.test/activate/' || :'tok'), 'plain http off localhost is refused');
select ok(not activation_link_ok(null), 'null is refused, not unknown');

-- =====================================================================
-- 2 · With the vault's app_origins set
-- =====================================================================
-- Through vault.create_secret, not an insert: on Supabase the table's encrypt
-- trigger is not callable by the test role, the SECURITY DEFINER API is (601).
do $$ begin
  perform vault.create_secret('https://staff.test, https://office.thc.example https://clients.thc.example/', 'app_origins');
exception when undefined_function then
  insert into vault.secrets (name, secret)
  values ('app_origins', 'https://staff.test, https://office.thc.example https://clients.thc.example/');
end $$;

select ok(activation_link_ok('https://staff.test/activate/' || :'tok'), 'a configured origin passes');
select ok(not activation_link_ok('https://evil.example/activate/' || :'tok'), 'another origin of the right shape does not');
select ok(account_invite_link_ok('https://clients.thc.example/auth/invite?token=' || :'tok'),
  'an invite link on a configured app passes (trailing slash in the secret ignored)');
select ok(not account_invite_link_ok('https://evil.example/auth/invite?token=' || :'tok'),
  'an invite link on another host does not');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select onboarding_resend_activation(%L, %L, %L, 'https://staff.test/install') $$,
                        :'staffa', :'staffa_uid', 'https://evil.example/activate/' || :'tok'),
  '22023', 'activation_link_not_personal', 'Resend refuses a foreign-origin E3 link');
select throws_ok(format($$ select onboarding_accept_with_account(%L, array[%L]::uuid[], null, %L, %L, 'https://staff.test/install') $$,
                        :'staffa', :'role_id', :'staffa_uid', 'https://evil.example/activate/' || :'tok'),
  '22023', 'activation_link_not_personal', 'Accept refuses it too');
select throws_ok(format($$ select queue_account_invite(%L, %L) $$,
                        :'clienta_uid', 'https://evil.example/auth/invite?token=' || :'tok'),
  '22023', 'invite_link_invalid', 'and so does the E11 invite');
reset role;

-- =====================================================================
-- 3 · activation_preview(): the activation token, within 24 hours
-- =====================================================================
-- Hosted auth.users has confirmation_sent_at; a local harness may not.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'auth' and table_name = 'users' and column_name = 'confirmation_sent_at') then
    execute 'alter table auth.users add column confirmation_sent_at timestamptz';
  end if;
end $$;

insert into auth.users (id, email, confirmation_token, recovery_token)
values (:'cand_uid', 'cand791@rls.test', :'tok', '');
update auth.users set confirmation_sent_at = now() - interval '1 hour' where id = :'cand_uid';
insert into staff (id, user_id, first_name, last_name, email, phone, dob, status)
values (:'cand', :'cand_uid', 'Cleo', 'Candidate', 'cand791@rls.test', '+447700979101', date '1998-01-01', 'interview_requested');

select is(activation_preview(:'tok') ->> 'firstName', 'Cleo', 'a link sent an hour ago previews its candidate');
update auth.users set confirmation_sent_at = now() - interval '25 hours' where id = :'cand_uid';
select is(activation_preview(:'tok'), null::jsonb, 'one sent 25 hours ago (past otp_expiry) previews nobody');
update auth.users set confirmation_token = '', recovery_token = :'tok', confirmation_sent_at = now() where id = :'cand_uid';
select is(activation_preview(:'tok'), null::jsonb,
  'a recovery_token — where a password-reset token lives — previews nobody');

select ok(not has_function_privilege('authenticated', 'public.app_origin_allowed(text)', 'execute')
      and not has_function_privilege('authenticated', 'public.activation_link_ok(text)', 'execute'),
  'the origin and shape checks are not RPCs');

select * from finish();
rollback;
