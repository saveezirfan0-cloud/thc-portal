-- =====================================================================
-- 938 · Send password reset from the Back Office (ADR-0207, TK-4)
--   20261027090000_office_password_reset.sql
--
--   A. Who can reach it: anon, a client, a worker, a viewer — refused.
--   B. Who it refuses: not accepted, rejected, removed, not activated.
--   C. An activated person: their login address, audited.
--   D. Once per 10 minutes per person.
-- =====================================================================
begin;
select plan(19);
\ir _shared/fixtures.psql

\set c_act    '93800000-0000-4000-8000-000000000001'
\set c_new    '93800000-0000-4000-8000-000000000002'
\set c_wait   '93800000-0000-4000-8000-000000000003'
\set c_rej    '93800000-0000-4000-8000-000000000004'
\set c_gone   '93800000-0000-4000-8000-000000000005'
\set u_act    '93800000-0000-4000-8000-0000000000a1'
\set u_new    '93800000-0000-4000-8000-0000000000a2'
\set c_inact  '93800000-0000-4000-8000-000000000006'
\set c_block  '93800000-0000-4000-8000-000000000007'
\set c_nouser '93800000-0000-4000-8000-000000000008'
\set u_block  '93800000-0000-4000-8000-0000000000a7'
\set viewer   '93800000-0000-4000-8000-0000000000f1'
\set sched    '93800000-0000-4000-8000-0000000000f2'

insert into auth.users (id, email, raw_app_meta_data, encrypted_password) values
  (:'u_act',  'Rohan@Reset.test', '{"role":"staff"}', '$2a$10$hash'),
  (:'u_new',  'nia@reset.test',   '{"role":"staff"}', ''),
  (:'u_block','bo@reset.test',    '{"role":"staff"}', '$2a$10$hash');
insert into auth.users (id, email) values
  (:'viewer', 'viewer.938@rls.test'),
  (:'sched',  'scheduler.938@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'viewer', 'admin', 'viewer',    'Vera Viewer'),
  (:'sched',  'admin', 'scheduler', 'Sid Scheduler');

insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, removed_at) values
  (:'c_act',  :'u_act', 'Rohan', 'Act',  'rohan.profile@reset.test', '+447700993801', date '2001-01-01', 'documents',           null),
  (:'c_new',  :'u_new', 'Nia',   'New',  'nia@reset.test',           '+447700993802', date '2001-02-02', 'documents',           null),
  (:'c_wait', null,     'Wes',   'Wait', 'wes@reset.test',           '+447700993803', date '2001-03-03', 'interview_completed', null),
  (:'c_rej',  null,     'Rob',   'Rej',  'rob@reset.test',           '+447700993804', date '2001-04-04', 'rejected',            null),
  (:'c_gone', null,     'Gil',   'Gone', 'gil@reset.test',           '+447700993805', date '2001-05-05', 'documents',           now()),
  (:'c_inact',null,     'Ivo',   'Inact','ivo@reset.test',           '+447700993806', date '2001-06-06', 'inactive',            null),
  (:'c_block',:'u_block','Bo',   'Block','bo@reset.test',            '+447700993807', date '2001-07-07', 'blocked',             null),
  (:'c_nouser',null,    'Nell',  'None', 'nell@reset.test',          '+447700993808', date '2001-08-08', 'documents',           null);

-- =====================================================================
-- A · who can reach it
-- =====================================================================
select ok(
  not has_function_privilege('anon', 'onboarding_password_reset_request(uuid)', 'execute'),
  'anon cannot execute it');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok($$ select onboarding_password_reset_request('93800000-0000-4000-8000-000000000001') $$,
  '42501', 'not_authorised', 'a client cannot ask for a reset');
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select throws_ok($$ select onboarding_password_reset_request('93800000-0000-4000-8000-000000000001') $$,
  '42501', 'not_authorised', 'nor can a worker');
set local "request.jwt.claims" = '{"sub":"93800000-0000-4000-8000-0000000000f1","role":"authenticated"}';
select throws_ok($$ select onboarding_password_reset_request('93800000-0000-4000-8000-000000000001') $$,
  null, 'read_only', 'a viewer sends nothing (ADR-0060)');
reset role;

-- =====================================================================
-- B · who it refuses (the office)
-- =====================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok($$ select onboarding_password_reset_request('93800000-0000-4000-8000-000000000003') $$,
  'P0001', 'not_accepted', 'a candidate not yet accepted has no account to reset');
select throws_ok($$ select onboarding_password_reset_request('93800000-0000-4000-8000-000000000004') $$,
  'P0001', 'not_resendable', 'a rejected candidate is given no way in');
select throws_ok($$ select onboarding_password_reset_request('93800000-0000-4000-8000-000000000005') $$,
  'P0001', 'unknown_staff', 'a removed (GDPR) record is refused');
select throws_ok($$ select onboarding_password_reset_request('93800000-0000-4000-8000-000000000002') $$,
  'P0001', 'not_activated', 'before a password is set, Resend activation link is the answer');
select throws_ok($$ select onboarding_password_reset_request('93800000-0000-4000-8000-000000000006') $$,
  'P0001', 'not_resendable', 'an inactive worker is given no way in');
select throws_ok($$ select onboarding_password_reset_request('93800000-0000-4000-8000-000000000008') $$,
  'P0001', 'not_activated', 'an accepted person with no login yet has nothing to reset');
reset role;
select is((select count(*)::int from audit_log where action = 'onboarding_password_reset'), 0,
  'a refusal audits nothing');

-- =====================================================================
-- C · an activated person
-- =====================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(onboarding_password_reset_request(:'c_act') ->> 'email', 'rohan@reset.test',
  'the login address (lower-cased), not the profile''s contact email');
select ok(onboarding_password_reset_request(:'c_block') ->> 'retryAfter' ~ '^\d{2}:\d{2}$',
  'a blocked worker who has activated may be sent one, with the time the next is allowed');
reset role;
select is((select actor from audit_log where action = 'onboarding_password_reset' and entity_id = :'c_act'),
  :'admin_uid'::uuid, 'audited against the manager');
update audit_log set at = now() - interval '11 minutes'
 where action = 'onboarding_password_reset' and entity_id = :'c_block';
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"93800000-0000-4000-8000-0000000000f2","role":"authenticated"}';
select is(onboarding_password_reset_request(:'c_block') ->> 'email', 'bo@reset.test',
  'a scheduler (writes, not an owner) may send one too');
reset role;
select is((select actor from audit_log where action = 'onboarding_password_reset' and entity_id = :'c_block'
            order by at desc limit 1), :'sched'::uuid, 'audited against the scheduler');

-- =====================================================================
-- D · once per 10 minutes
-- =====================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_like($$ select onboarding_password_reset_request('93800000-0000-4000-8000-000000000001') $$,
  'reset_too_soon: %', 'a second request inside 10 minutes is refused, with the time it opens again');
reset role;
update audit_log set at = now() - interval '11 minutes'
 where action = 'onboarding_password_reset' and entity_id = :'c_act';
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(onboarding_password_reset_request(:'c_act') ->> 'staffId', :'c_act',
  'after 10 minutes it may be sent again');
reset role;
select is((select count(*)::int from audit_log where action = 'onboarding_password_reset' and entity_id = :'c_act'), 2,
  'each request is its own audit line');

select * from finish();
rollback;
