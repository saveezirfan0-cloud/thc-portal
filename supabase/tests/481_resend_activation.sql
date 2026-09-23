-- =====================================================================
-- 481 · Resend activation link (§2.7, §2.8 E3; docs/14 §2 item 4)
--   20260924110000_willo_receiver_and_resend_activation.sql, ADR-0021
--
--   A. Who can reach it: admin / client / staff / anon.
--   B. Who it refuses: not yet accepted, rejected, inactive, removed,
--      already activated.
--   C. A resend: a NEW E3 under E3:resend:<staff>:<n>, the personal link,
--      audited; an older unsent E3 follows the new token.
--   D. Once per 10 minutes, and the race that gets past the pre-check.
-- =====================================================================
begin;
select plan(24);
\ir _shared/fixtures.psql

\set c_docs   '48100000-0000-4000-8000-000000000001'
\set c_wait   '48100000-0000-4000-8000-000000000002'
\set c_rej    '48100000-0000-4000-8000-000000000003'
\set c_act    '48100000-0000-4000-8000-000000000004'
\set c_gone   '48100000-0000-4000-8000-000000000005'
\set c_free   '48100000-0000-4000-8000-000000000006'
\set u_docs   '48100000-0000-4000-8000-0000000000a1'
\set u_act    '48100000-0000-4000-8000-0000000000a4'
\set u_free   '48100000-0000-4000-8000-0000000000a6'
\set link1    'https://staff.test/activate/a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'
\set link2    'https://staff.test/activate/b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2'
\set link3    'https://staff.test/activate/c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3'
\set install  'https://staff.test/install'

insert into auth.users (id, email, raw_app_meta_data, encrypted_password) values
  (:'u_docs', 'rae@resend.test', '{"role":"staff"}', ''),
  (:'u_act',  'act@resend.test', '{"role":"staff"}', '$2a$10$hash'),
  (:'u_free', 'fay@resend.test', '{"role":"staff"}', '');

insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, removed_at) values
  (:'c_docs', :'u_docs', 'Rae', 'Docs', 'rae@resend.test', '+447700948101', date '2001-01-01', 'documents',           null),
  (:'c_wait', null,      'Wes', 'Wait', 'wes@resend.test', '+447700948102', date '2001-02-02', 'interview_completed', null),
  (:'c_rej',  null,      'Rob', 'Rej',  'rob@resend.test', '+447700948103', date '2001-03-03', 'rejected',            null),
  (:'c_act',  :'u_act',  'Ace', 'Act',  'act@resend.test', '+447700948104', date '2001-04-04', 'quiz',                null),
  (:'c_gone', null,      'Gil', 'Gone', 'gil@resend.test', '+447700948105', date '2001-05-05', 'documents',           now()),
  (:'c_free', null,      'Fay', 'Free', 'fay@resend.test', '+447700948106', date '2001-06-06', 'documents',           null);

-- The Accept's E3, still waiting in the outbox (the drain is not live).
insert into notification_outbox (key, channel, template, recipient_emails, payload) values
  ('E3:staff:' || :'c_docs' || ':1', 'email', 'E3', array['rae@resend.test'],
   jsonb_build_object('link', :'link1', 'installLink', :'install', 'name', 'Rae'));

-- =====================================================================
-- A · who can reach it
-- =====================================================================
select ok(
  not has_function_privilege('anon', 'onboarding_resend_activation_check(uuid)', 'execute')
  and not has_function_privilege('anon', 'onboarding_resend_activation(uuid,uuid,text,text)', 'execute'),
  'anon can execute neither');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok($$ select onboarding_resend_activation_check('48100000-0000-4000-8000-000000000001') $$,
  '42501', 'not_authorised', 'a client cannot resend');
select throws_ok(
  $$ select onboarding_resend_activation('48100000-0000-4000-8000-000000000001', '48100000-0000-4000-8000-0000000000a1',
       'https://staff.test/activate/a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 'https://staff.test/install') $$,
  '42501', 'not_authorised', 'nor queue the email');
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select throws_ok($$ select onboarding_resend_activation_check('48100000-0000-4000-8000-000000000001') $$,
  '42501', 'not_authorised', 'a worker cannot resend, not even their own');
reset role;
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok($$ select onboarding_resend_activation_check('48100000-0000-4000-8000-000000000001') $$,
  '42501', null, 'anon is refused by privilege');
reset role;

-- =====================================================================
-- B · who it refuses (the office)
-- =====================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok($$ select onboarding_resend_activation_check('48100000-0000-4000-8000-000000000002') $$,
  'P0001', 'not_accepted', 'before Accept there is no link to resend');
select throws_ok($$ select onboarding_resend_activation_check('48100000-0000-4000-8000-000000000003') $$,
  'P0001', 'not_resendable', 'a rejected candidate is given no way in');
select throws_ok($$ select onboarding_resend_activation_check('48100000-0000-4000-8000-000000000004') $$,
  'P0001', 'already_activated', 'someone who has set a password uses Forgot password instead');
select throws_ok(
  $$ select onboarding_resend_activation('48100000-0000-4000-8000-000000000004', '48100000-0000-4000-8000-0000000000a4',
       'https://staff.test/activate/a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 'https://staff.test/install') $$,
  'P0001', 'already_activated', 'and the write refuses too, not only the pre-check');
select throws_ok($$ select onboarding_resend_activation_check('48100000-0000-4000-8000-000000000005') $$,
  'P0001', 'unknown_staff', 'a removed (GDPR) record is refused');
select is(onboarding_resend_activation_check(:'c_docs') ->> 'userId', :'u_docs',
  'an accepted, unactivated candidate may have a new link, for their own login');
select throws_ok(
  $$ select onboarding_resend_activation('48100000-0000-4000-8000-000000000001', '48100000-0000-4000-8000-0000000000a1',
       'https://staff.test/activate', 'https://staff.test/install') $$,
  '22023', 'activation_link_not_personal', 'the bare /activate link is refused');

-- =====================================================================
-- C · a resend
-- =====================================================================
select is(onboarding_resend_activation(:'c_docs', :'u_docs', :'link2', :'install') ->> 'outboxKey',
  'E3:resend:' || :'c_docs' || ':1', 'a resend queues a NEW E3 under its own key');
reset role;
select is((select payload ->> 'link' from notification_outbox where key = 'E3:resend:' || :'c_docs' || ':1'), :'link2',
  'carrying the fresh personal link');
select is((select recipient_emails from notification_outbox where key = 'E3:resend:' || :'c_docs' || ':1'), array['rae@resend.test'],
  'to the candidate');
select is((select payload ->> 'link' from notification_outbox where key = 'E3:staff:' || :'c_docs' || ':1'), :'link2',
  'the Accept''s E3, still unsent, now carries the live token rather than the one this resend replaced');
select is((select actor from audit_log where action = 'onboarding_resend_activation' and entity_id = :'c_docs'), :'admin_uid'::uuid,
  'audited against the manager');

-- =====================================================================
-- D · once per 10 minutes, and the race
-- =====================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_like($$ select onboarding_resend_activation_check('48100000-0000-4000-8000-000000000001') $$,
  'resend_too_soon%', 'a second resend inside 10 minutes is refused before anything is minted');
select is(onboarding_resend_activation(:'c_docs', :'u_docs', :'link3', :'install') ->> 'queued', 'false',
  'a click that raced past the pre-check queues nothing new');
reset role;
select is((select count(*)::int from notification_outbox where key like 'E3:resend:' || :'c_docs' || ':%'), 1,
  'still one resend');
select is((select payload ->> 'link' from notification_outbox where key = 'E3:resend:' || :'c_docs' || ':1'), :'link3',
  'and it follows the token that click minted, so the email that goes out works');

-- once the first resend has gone, a raced click's mint has killed its link: send the new one
update notification_outbox set sent_at = now() where key like 'E3:%' || :'c_docs' || ':%';
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(onboarding_resend_activation(:'c_docs', :'u_docs', :'link1', :'install') ->> 'outboxKey',
  'E3:resend:' || :'c_docs' || ':2', 'a raced click whose rival already went out sends — never a dead link');

-- a candidate with no login yet (accepted before logins existed) gets one linked
select is(onboarding_resend_activation(:'c_free', :'u_free', :'link2', :'install') ->> 'queued', 'true',
  'a resend for a candidate with no linked login');
reset role;
select is((select user_id from staff where id = :'c_free'), :'u_free'::uuid, 'links the login in the same transaction');

select * from finish();
rollback;
