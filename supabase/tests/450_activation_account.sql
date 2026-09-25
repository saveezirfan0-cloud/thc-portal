-- =====================================================================
-- 450 · Candidate account activation (§1.4, §2.7, §2.8 E3, §10.2)
--   20260923180000_activation_account.sql
--
--   A. Who can reach the three functions: admin / client / staff / anon /
--      service role.
--   B. The office's Accept: E3 only with a personal link, for a linked
--      account; every refusal leaves nothing behind.
--   C. link_staff_account never relinks, and never makes an office or
--      client login into a worker's.
--   D. activation_preview reads without spending, and an empty token
--      column matches nothing.
-- =====================================================================
begin;
select plan(33);
\ir _shared/fixtures.psql

\set c_ok     '45000000-0000-4000-8000-000000000001'
\set c_wait   '45000000-0000-4000-8000-000000000002'
\set c_zed    '45000000-0000-4000-8000-000000000003'
\set c_gone   '45000000-0000-4000-8000-000000000004'
\set c_dupe   '45000000-0000-4000-8000-000000000005'
\set c_cli    '45000000-0000-4000-8000-000000000006'
\set u_mei    '45000000-0000-4000-8000-0000000000a1'
\set u_noor   '45000000-0000-4000-8000-0000000000a2'
\set u_zed    '45000000-0000-4000-8000-0000000000a3'
\set u_norole '45000000-0000-4000-8000-0000000000a4'
\set u_cli    '45000000-0000-4000-8000-0000000000a5'
\set u_gone   '45000000-0000-4000-8000-0000000000a6'
\set u_ghost  '45000000-0000-4000-8000-0000000000ff'
-- 56 hex characters: the shape of GoTrue's hashed token (sha224).
\set tok_mei  'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'
\set tok_zed  'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2'
\set tok_noor 'c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3'

insert into auth.users (id, email, raw_app_meta_data, confirmation_token, recovery_token) values
  (:'u_mei',    'Mei@Act.test',    '{"role":"staff"}',  :'tok_mei', ''),
  (:'u_noor',   'noor@act.test',   '{"role":"staff"}',  :'tok_noor', ''),
  (:'u_zed',    'zed@act.test',    '{"role":"staff"}',  '', :'tok_zed'),
  (:'u_norole', 'norole@act.test', '{}',                '', ''),
  (:'u_cli',    'cli@act.test',    '{"role":"staff"}',  '', ''),
  (:'u_gone',   'gone@act.test',   '{"role":"staff"}',  '', '');
insert into profiles (id, role, full_name, client_id) values
  (:'u_cli', 'client', 'A client login', 'aaaaaaaa-0000-4000-8000-000000000001');

insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, removed_at) values
  (:'c_ok',   null,     'Mei',  'Lin',   'mei@act.test',    '+447700945001', date '2003-05-02', 'interview_completed', null),
  (:'c_wait', null,     'Noor', 'Ahmed', 'noor@act.test',   '+447700945002', date '2004-01-10', 'interview_requested', null),
  (:'c_zed',  :'u_zed', 'Zed',  'Ray',   'zed@act.test',    '+447700945003', date '2000-03-03', 'documents', null),
  (:'c_gone', null,     'Gus',  'One',   'gone@act.test',   '+447700945004', date '2000-04-04', 'interview_completed', now()),
  (:'c_dupe', null,     'Zed',  'Ray',   'zed@act.test',    '+447700945005', date '2000-03-03', 'interview_completed', null),
  (:'c_cli',  null,     'Cli',  'Ent',   'cli@act.test',    '+447700945006', date '2000-05-05', 'interview_completed', null);

-- =====================================================================
-- A · who can reach what
-- =====================================================================
select ok(
  not has_function_privilege('anon', 'link_staff_account(uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'activation_preview(text)', 'execute')
  and not has_function_privilege('anon', 'onboarding_accept_with_account(uuid,uuid[],text,uuid,text,text)', 'execute'),
  'anon can execute none of the three');
select ok(
  not has_function_privilege('authenticated', 'link_staff_account(uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'activation_preview(text)', 'execute'),
  'no signed-in account links a login or previews a token directly');
select ok(
  has_function_privilege('service_role', 'link_staff_account(uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'activation_preview(text)', 'execute'),
  'the service role can (the Staff App preview; the Willo route)');
select bag_eq(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('link_staff_account', 'activation_preview', 'onboarding_accept_with_account')
        and p.prosecdef
        and array_to_string(p.proconfig, ',') like '%search_path=%' $$,
  $$ values ('link_staff_account'::text), ('activation_preview'), ('onboarding_accept_with_account') $$,
  'all three are security definer and pin their search_path');

-- a client
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ select onboarding_accept_with_account('45000000-0000-4000-8000-000000000001', array['bbbbbbbb-0000-4000-8000-000000000001']::uuid[], null,
       '45000000-0000-4000-8000-0000000000a1', 'https://staff.test/activate/a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 'https://staff.test/install') $$,
  '42501', 'not_authorised', 'a client cannot accept a candidate');
select throws_ok($$ select link_staff_account('45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-0000000000a1') $$,
  '42501', null, 'a client cannot link a login');

-- a worker
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select throws_ok(
  $$ select onboarding_accept_with_account('45000000-0000-4000-8000-000000000001', array['bbbbbbbb-0000-4000-8000-000000000001']::uuid[], null,
       '44444444-4444-4444-4444-444444444444', 'https://staff.test/activate/a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 'https://staff.test/install') $$,
  '42501', 'not_authorised', 'a worker cannot accept a candidate onto their own login');
select throws_ok($$ select activation_preview('a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1') $$,
  '42501', null, 'a worker cannot look up whose link a token is');

-- anon
reset role;
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok($$ select activation_preview('a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1') $$,
  '42501', null, 'anon cannot preview a token through the API — the page does it server-side');
select throws_ok($$ select link_staff_account('45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-0000000000a1') $$,
  '42501', null, 'anon cannot link a login');

-- =====================================================================
-- B · the office's Accept
-- =====================================================================
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select throws_ok($$ select link_staff_account('45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-0000000000a1') $$,
  '42501', null, 'the office links a login only through Accept, never on its own');
select throws_ok(
  $$ select onboarding_accept_with_account('45000000-0000-4000-8000-000000000001', array['bbbbbbbb-0000-4000-8000-000000000001']::uuid[], null,
       '45000000-0000-4000-8000-0000000000a1', 'https://staff.test/activate', 'https://staff.test/install') $$,
  '22023', 'activation_link_not_personal', 'the bare /activate link is refused: E3 carries the personal link or nothing');
select throws_like(
  $$ select onboarding_accept_with_account('45000000-0000-4000-8000-000000000002', array['bbbbbbbb-0000-4000-8000-000000000001']::uuid[], null,
       '45000000-0000-4000-8000-0000000000a2', 'https://staff.test/activate/c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3', 'https://staff.test/install') $$,
  'not_awaiting_decision%', 'a candidate whose interview is not complete is still refused');
select throws_ok(
  $$ select onboarding_accept_with_account('45000000-0000-4000-8000-000000000001', array['bbbbbbbb-0000-4000-8000-000000000001']::uuid[], null,
       '45000000-0000-4000-8000-0000000000a4', 'https://staff.test/activate/a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 'https://staff.test/install') $$,
  'P0001', 'account_not_staff', 'a login without app_metadata.role = staff would activate into a 403, so Accept refuses it');
select throws_ok(
  $$ select onboarding_accept_with_account('45000000-0000-4000-8000-000000000001', array['bbbbbbbb-0000-4000-8000-000000000001']::uuid[], null,
       '45000000-0000-4000-8000-0000000000a2', 'https://staff.test/activate/c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3', 'https://staff.test/install') $$,
  'P0001', 'account_email_mismatch', 'another person''s login is refused');
select lives_ok(
  $$ select onboarding_accept_with_account('45000000-0000-4000-8000-000000000001', array['bbbbbbbb-0000-4000-8000-000000000001']::uuid[], 'good',
       '45000000-0000-4000-8000-0000000000a1', 'https://staff.test/activate/a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 'https://staff.test/install') $$,
  'the office accepts with the candidate''s own login and personal link');

reset role;
select is((select user_id from staff where id = :'c_wait'), null::uuid,
  'a refused Accept links nothing: the transaction took the link with it');
select is((select count(*)::int from notification_outbox where template = 'E3' and recipient_emails && array['noor@act.test']), 0,
  'and queues no E3');
select is((select user_id from staff where id = :'c_ok'), :'u_mei'::uuid, 'Accept links staff.user_id');
select is((select status::text from staff where id = :'c_ok'), 'documents', 'and moves the candidate to Documents');
select is((select role::text || ' · ' || full_name from profiles where id = :'u_mei'), 'staff · Mei Lin',
  'the login gets a staff profile, so current_app_role() knows it');
select is((select array_agg(payload ->> 'link') from notification_outbox where template = 'E3' and recipient_emails = array['mei@act.test']),
  array['https://staff.test/activate/a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'],
  'exactly one E3, carrying the personal link');
select is((select actor from audit_log where action = 'link_staff_account' and entity_id = :'c_ok'), :'admin_uid'::uuid,
  'the link is audited against the manager who accepted');

-- =====================================================================
-- C · link_staff_account (service role)
-- =====================================================================
set local role service_role;
select is(link_staff_account(:'c_ok', :'u_mei') ->> 'linked', 'false',
  'the same pair again is a no-op, not an error');
select throws_ok($$ select link_staff_account('45000000-0000-4000-8000-000000000001', '45000000-0000-4000-8000-0000000000a2') $$,
  'P0001', 'staff_linked_elsewhere', 'a staff row already linked is never moved to another login');
select throws_ok($$ select link_staff_account('45000000-0000-4000-8000-000000000005', '45000000-0000-4000-8000-0000000000a3') $$,
  'P0001', 'account_linked_elsewhere', 'a login already linked is never given a second staff row, even at the same address');
select throws_ok($$ select link_staff_account('45000000-0000-4000-8000-000000000006', '45000000-0000-4000-8000-0000000000a5') $$,
  'P0001', 'account_not_staff', 'a client login is never made into a worker''s');
select throws_ok($$ select link_staff_account('45000000-0000-4000-8000-000000000002', '45000000-0000-4000-8000-0000000000ff') $$,
  'P0002', 'unknown_account', 'an account that does not exist is refused');
select throws_ok($$ select link_staff_account('45000000-0000-4000-8000-000000000004', '45000000-0000-4000-8000-0000000000a6') $$,
  'P0002', 'unknown_staff', 'a removed (GDPR) record gets no login');

-- =====================================================================
-- D · activation_preview (service role)
-- =====================================================================
-- `activated` joined the preview in 20260928110000: false here, because
-- none of these logins has a password yet (595 covers the true case).
select is(activation_preview(:'tok_mei'),
  '{"firstName":"Mei","lastName":"Lin","email":"Mei@Act.test","activated":false}'::jsonb,
  'an invite token (confirmation_token) previews the candidate it is for');
select is(activation_preview(:'tok_zed') ->> 'firstName', 'Zed',
  'a magic-link token (recovery_token) does too');
select ok(activation_preview('') is null and activation_preview('short') is null and activation_preview(null) is null,
  'an empty or malformed token matches nothing — the token columns default to an empty string');
select is(activation_preview(:'tok_noor'), null::jsonb,
  'a token for a login linked to no staff record previews nothing');
reset role;

select * from finish();
rollback;
