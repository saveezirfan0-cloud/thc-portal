-- =====================================================================
-- 480 · The Willo receiver and the "create candidate" sweep
--   20260924110000_willo_receiver_and_resend_activation.sql, ADR-0021
--   (§2.4, §2.12, Appendix B B1)
--
--   A. Who can reach what: admin / client / staff / anon / service role.
--   B. willo_event_plan: provision a login only for an Accept that will
--      move the card — never for a repeat.
--   C. willo_accept_with_account: link + E3 in one transaction, the same
--      refusals as the office Accept, idempotent on a retried delivery,
--      and a lost race keeps the unsent E3 on the newest token.
--   D. willo_record_refusal audits what no retry can fix.
--   E. willo_invite_due leases each due candidate once per backoff, per
--      onboarding period; the nudge never fails the write that fires it.
--   F. staff_account_activated and onboarding_candidates_v.activated.
-- =====================================================================
begin;
select plan(41);
\ir _shared/fixtures.psql

\set c_acc    '48000000-0000-4000-8000-000000000001'
\set c_req    '48000000-0000-4000-8000-000000000002'
\set c_mis    '48000000-0000-4000-8000-000000000003'
\set c_new    '48000000-0000-4000-8000-000000000004'
\set c_gone   '48000000-0000-4000-8000-000000000005'
\set c_docs   '48000000-0000-4000-8000-000000000006'
\set u_acc    '48000000-0000-4000-8000-0000000000a1'
\set u_req    '48000000-0000-4000-8000-0000000000a2'
\set u_other  '48000000-0000-4000-8000-0000000000a3'
\set u_docs   '48000000-0000-4000-8000-0000000000a6'
\set link1    'https://staff.test/activate/a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'
\set link2    'https://staff.test/activate/b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2'

insert into auth.users (id, email, raw_app_meta_data, encrypted_password) values
  (:'u_acc',   'ana@willo.test',   '{"role":"staff"}', ''),
  (:'u_req',   'ben@willo.test',   '{"role":"staff"}', ''),
  (:'u_other', 'other@willo.test', '{"role":"staff"}', ''),
  (:'u_docs',  'dee@willo.test',   '{"role":"staff"}', '$2a$10$hash');

insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, willo_candidate_id, removed_at) values
  (:'c_acc',  null,      'Ana', 'Acc',  'ana@willo.test',  '+447700948001', date '2001-01-01', 'interview_completed', 'W-ana',  null),
  (:'c_req',  null,      'Ben', 'Req',  'ben@willo.test',  '+447700948002', date '2001-02-02', 'interview_requested', 'W-ben',  null),
  (:'c_mis',  null,      'Cal', 'Mis',  'cal@willo.test',  '+447700948003', date '2001-03-03', 'interview_completed', 'W-cal',  null),
  (:'c_new',  null,      'Nia', 'New',  'nia@willo.test',  '+447700948004', date '2001-04-04', 'interview_requested', null,     null),
  (:'c_gone', null,      'Gus', 'Gone', 'gus@willo.test',  '+447700948005', date '2001-05-05', 'interview_requested', null,     now()),
  (:'c_docs', :'u_docs', 'Dee', 'Docs', 'dee@willo.test',  '+447700948006', date '2001-06-06', 'documents',           'W-dee',  null);

-- =====================================================================
-- A · who can reach what
-- =====================================================================
select is_empty(
  $$ select p.proname::text || ' → ' || r.rolname
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       cross join (values ('anon'), ('authenticated')) r(rolname)
      where n.nspname = 'public'
        and p.proname in ('willo_event_plan', 'willo_accept_with_account', 'willo_record_refusal',
                          'willo_invite_due', 'willo_invite_failed', 'activation_link_refresh',
                          'activation_resend_refusal', 'willo_invite_nudge')
        and has_function_privilege(r.rolname, p.oid, 'execute') $$,
  'neither anon nor any signed-in account can call the Willo integration or the internal helpers');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('willo_event_plan', 'willo_accept_with_account', 'willo_record_refusal',
                        'willo_invite_due', 'willo_invite_failed')
      and has_function_privilege('service_role', p.oid, 'execute')),
  5, 'the service role — what the Edge Function holds — can call all five');
select is_empty(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('willo_event_plan', 'willo_accept_with_account', 'willo_record_refusal',
                          'willo_invite_due', 'willo_invite_failed', 'activation_link_refresh',
                          'activation_resend_refusal', 'willo_invite_nudge', 'staff_account_activated',
                          'onboarding_resend_activation_check', 'onboarding_resend_activation')
        and not (p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=%') $$,
  'every new function is security definer with a pinned search_path');

-- the office, a client, a worker: all refused by privilege, not by luck
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok($$ select willo_event_plan('W-ana', 'accepted') $$, '42501', null,
  'the office cannot call the receiver''s functions — it accepts through its own Accept');
set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok($$ select willo_accept_with_account('W-ana', 'accepted', now(), '{"activationLink":"https://staff.test/activate/a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1","installLink":"https://staff.test/install"}', '22222222-2222-2222-2222-222222222222') $$,
  '42501', null, 'a client cannot forge a Willo Accept');
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select throws_ok($$ select * from willo_invite_due(10) $$, '42501', null,
  'a worker cannot lease the invitation queue');
reset role;
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok($$ select willo_record_refusal('W-ana', 'accepted', 'x') $$, '42501', null,
  'anon cannot write the refusal log');
reset role;

-- =====================================================================
-- B · willo_event_plan
-- =====================================================================
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select is(willo_event_plan('W-nobody', 'accepted'), null::jsonb, 'an unknown Willo candidate plans nothing');
select is(willo_event_plan('W-ana', 'accepted') ->> 'needsAccount', 'true',
  'an Accept for a candidate awaiting the decision needs the login first');
select is(willo_event_plan('W-ana', 'new_response') ->> 'needsAccount', 'false',
  'New Response needs no login');
select is(willo_event_plan('W-dee', 'accepted') ->> 'needsAccount', 'false',
  'a repeat Accept for someone already in Documents mints nothing (it would kill the E3 link already sent)');
select is(willo_event_plan('W-ana', 'accepted') ->> 'email', 'ana@willo.test', 'and it says whose login to provision');

-- =====================================================================
-- C · willo_accept_with_account
-- =====================================================================
select throws_ok(
  $$ select willo_accept_with_account('W-ana', 'accepted', now(), '{"activationLink":"https://staff.test/activate","installLink":"https://staff.test/install"}', '48000000-0000-4000-8000-0000000000a1') $$,
  '22023', 'activation_link_not_personal', 'the bare /activate link is refused, as for the office');
select throws_ok(
  $$ select willo_accept_with_account('W-cal', 'accepted', now(), '{"activationLink":"https://staff.test/activate/a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1","installLink":"https://staff.test/install"}', '48000000-0000-4000-8000-0000000000a3') $$,
  'P0001', 'account_email_mismatch', 'somebody else''s login is refused');
select is((select status::text || '/' || coalesce(user_id::text, '-') from staff where id = :'c_mis'), 'interview_completed/-',
  'and the refusal took nothing with it: not moved, not linked');

select is(
  willo_accept_with_account('W-ana', 'accepted', now(),
    jsonb_build_object('activationLink', :'link1', 'installLink', 'https://staff.test/install'), :'u_acc') ->> 'outcome',
  'documents', 'a Willo Accept moves the candidate to Documents');
select is((select user_id from staff where id = :'c_acc'), :'u_acc'::uuid, 'and links their login in the same transaction');
select is((select array_agg(payload ->> 'link') from notification_outbox where template = 'E3' and recipient_emails = array['ana@willo.test']),
  array[:'link1'], 'with exactly one E3, carrying the personal link');
select is((select willo_decided_via from staff where id = :'c_acc'), 'willo', 'recorded as decided in Willo');

select is(
  willo_accept_with_account('W-ana', 'accepted', now(),
    jsonb_build_object('activationLink', :'link2', 'installLink', 'https://staff.test/install'), :'u_acc') ->> 'outcome',
  'unchanged', 'a retried delivery that got as far as minting changes no state');
select is((select array_agg(payload ->> 'link') from notification_outbox where template = 'E3' and recipient_emails = array['ana@willo.test']),
  array[:'link2'], 'still one E3 — now pointing at the newest token, because that minting replaced the first');
select is(willo_record_event('W-ana', 'accepted') ->> 'outcome', 'unchanged',
  'a plain retry (what the receiver sends when the plan says no login is needed) is a no-op');

select is(
  willo_accept_with_account('W-ben', 'accepted', now(),
    jsonb_build_object('activationLink', :'link1', 'installLink', 'https://staff.test/install'), :'u_req') ->> 'outcome',
  'documents', 'an Accept before New Response walks through Interview completed to Documents');

-- =====================================================================
-- D · refusals
-- =====================================================================
select lives_ok($$ select willo_record_refusal('W-cal', 'accepted', 'account_email_mismatch') $$,
  'a refusal no retry can fix is recorded');
reset role;
select is((select data ->> 'code' from audit_log where action = 'willo_event_refused' and entity_id = :'c_mis'),
  'account_email_mismatch', 'against the candidate, so the office can see why the card did not move');

-- =====================================================================
-- E · the invitation sweep
-- =====================================================================
update staff set onboarding_started_at = now() - interval '1 hour' where id = :'c_new';
set local role service_role;
select is((select count(*)::int from willo_invite_due(50) where staff_id = :'c_new'), 1,
  'a new applicant with no Willo candidate is due an invitation');
select is((select count(*)::int from willo_invite_due(50) where staff_id = :'c_new'), 0,
  'and leased: the schedule and the nudge running together never invite twice');
select is((select count(*)::int from willo_invite_due(50, now() + interval '4 minutes') where staff_id = :'c_new'), 0,
  'not again inside the first backoff');
select is((select attempt from willo_invite_due(50, now() + interval '6 minutes') where staff_id = :'c_new'), 2,
  'after it, a second attempt');
select is((select count(*)::int from willo_invite_due(50, now() + interval '12 minutes') where staff_id = :'c_new'), 0,
  'the backoff doubles (10 minutes after the second attempt)');
select is((select count(*)::int from willo_invite_due(50) where staff_id in (:'c_gone', :'c_docs', :'c_acc')), 0,
  'nobody removed, past the interview or already in Willo is invited');
select lives_ok($$ select willo_invite_failed('48000000-0000-4000-8000-000000000004', 'http_503: down') $$,
  'a failed create is recorded');
select lives_ok($$ select willo_link_candidate('48000000-0000-4000-8000-000000000004', 'W-nia') $$,
  'a successful create records the Willo key');
select is((select count(*)::int from willo_invite_due(50, now() + interval '1 day') where staff_id = :'c_new'), 0,
  'and the candidate is no longer due');
reset role;

-- a Reset starts a new period: a fresh interview is due (§2.12 step 1)
update staff set willo_candidate_id = null, onboarding_started_at = now() + interval '2 days' where id = :'c_new';
set local role service_role;
select is((select attempt from willo_invite_due(50, now() + interval '2 days 1 minute') where staff_id = :'c_new'), 1,
  'claims from an earlier onboarding period do not count against a new one');
reset role;

select is((select enabled::text || ' ' || edge_path from job_schedules where job = 'willo-invite'), 'false willo-webhook/invite',
  'the safety-net schedule is registered, disabled until THC''s Willo keys are set');

insert into settings (key, value) values ('edge_base_url', '"https://edge.test/functions/v1"')
  on conflict (key) do update set value = excluded.value;
select lives_ok(
  $$ insert into staff (first_name, last_name, email, phone, dob, status)
     values ('Pip', 'Nudge', 'pip@willo.test', '+447700948009', date '2002-02-02', 'interview_requested') $$,
  'the nudge never fails the application that fires it, configured or not');

-- =====================================================================
-- F · activated
-- =====================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(staff_account_activated(:'c_acc'), false, 'a linked login without a password is not activated');
select is(staff_account_activated(:'c_docs'), true, 'one with a password is');
select is((select activated from onboarding_candidates_v where id = :'c_acc'), false,
  'the candidate profile no longer reads "Activated" just because Accept linked a login');
set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(staff_account_activated(:'c_docs'), null::boolean, 'a client learns nothing');
reset role;

select * from finish();
rollback;
