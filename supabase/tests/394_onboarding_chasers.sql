-- =====================================================================
-- 394 · Onboarding chasers (ADR-0071, 20261001212000)
--
--   A. Who can reach it.
--   B. Who is chased: only a candidate whose next move is their own —
--      the Willo interview (OC1 email), the activation (OC2 email), a
--      wizard step (OC3 push); never the office's move.
--   C. Daily from a day after the last progress, never stopping; one per
--      day even for someone idle for weeks; Stalled after three.
--   D. Progress starts the count again.
--   E. OC2: the minted link, refreshed, fenced and redacted like E3.
--   F. The daytime window and the off switch.
-- =====================================================================
begin;
select plan(68);
\ir _shared/fixtures.psql

\set c_int   '39400000-0000-4000-8000-000000000001'
\set c_old   '39400000-0000-4000-8000-000000000002'
\set c_new   '39400000-0000-4000-8000-000000000003'
\set c_wait  '39400000-0000-4000-8000-000000000004'
\set c_act   '39400000-0000-4000-8000-000000000005'
\set c_e3q   '39400000-0000-4000-8000-000000000006'
\set c_app   '39400000-0000-4000-8000-000000000007'
\set c_rev   '39400000-0000-4000-8000-000000000008'
\set c_quiz  '39400000-0000-4000-8000-000000000009'
\set u_act   '39400000-0000-4000-8000-0000000000a5'
\set u_e3q   '39400000-0000-4000-8000-0000000000a6'
\set u_app   '39400000-0000-4000-8000-0000000000a7'
\set u_rev   '39400000-0000-4000-8000-0000000000a8'
\set u_quiz  '39400000-0000-4000-8000-0000000000a9'
\set manager '39400000-0000-4000-8000-0000000000f1'
\set t0      '2026-09-01 11:00+01'
\set link1   'https://staff.test/activate/a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'
\set link2   'https://staff.test/activate/b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2'
\set install 'https://staff.test/install'

insert into auth.users (id, email, raw_app_meta_data, encrypted_password, email_confirmed_at) values
  (:'u_act',  'ada@chase.test',  '{"role":"staff"}', '',             null),
  (:'u_e3q',  'eli@chase.test',  '{"role":"staff"}', '',             null),
  (:'u_app',  'amy@chase.test',  '{"role":"staff"}', '$2a$10$hash', :'t0'),
  (:'u_rev',  'rex@chase.test',  '{"role":"staff"}', '$2a$10$hash', :'t0'),
  (:'u_quiz', 'quin@chase.test', '{"role":"staff"}', '$2a$10$hash', :'t0'),
  (:'manager', 'manager.394@chase.test', '{}', '', null);
insert into profiles (id, role, office_role, full_name) values
  (:'manager', 'admin', 'manager', 'Mona Manager');

insert into staff (id, user_id, first_name, last_name, email, phone, dob, status) values
  (:'c_int',  null,      'Ivy',  'Int',  'ivy@chase.test',  '+447700939401', date '2001-01-01', 'interview_requested'),
  (:'c_old',  null,      'Olly', 'Old',  'olly@chase.test', '+447700939402', date '2001-01-02', 'interview_requested'),
  (:'c_new',  null,      'Ned',  'New',  'ned@chase.test',  '+447700939403', date '2001-01-03', 'interview_requested'),
  (:'c_wait', null,      'Wes',  'Wait', 'wes@chase.test',  '+447700939404', date '2001-01-04', 'interview_completed'),
  (:'c_act',  :'u_act',  'Ada',  'Act',  'ada@chase.test',  '+447700939405', date '2001-01-05', 'documents'),
  (:'c_e3q',  :'u_e3q',  'Eli',  'Queued','eli@chase.test', '+447700939406', date '2001-01-06', 'documents'),
  (:'c_app',  :'u_app',  'Amy',  'App',  'amy@chase.test',  '+447700939407', date '2001-01-07', 'documents'),
  (:'c_rev',  :'u_rev',  'Rex',  'Rev',  'rex@chase.test',  '+447700939408', date '2001-01-08', 'documents'),
  (:'c_quiz', :'u_quiz', 'Quin', 'Quiz', 'quin@chase.test', '+447700939409', date '2001-01-09', 'quiz');

update staff set stage_entered_at = :'t0', onboarding_started_at = :'t0'::timestamptz - interval '40 days'
 where id::text like '39400000-%';
update staff set willo_invited_at = :'t0' where id in (:'c_int', :'c_wait');
update staff set willo_invited_at = :'t0'::timestamptz - interval '30 days',
                 stage_entered_at = :'t0'::timestamptz - interval '30 days'
 where id = :'c_old';

insert into onboarding_progress (staff_id, rtw_at, address_at, selfie_at, documents_at, induction_at, updated_at) values
  (:'c_app',  :'t0', null,  null,  null,  null,  :'t0'),
  (:'c_rev',  :'t0', :'t0', :'t0', :'t0', null,  :'t0'),
  (:'c_quiz', :'t0', :'t0', :'t0', :'t0', :'t0', :'t0');

insert into compliance_docs (staff_id, doc_type, file_path, review_status, uploaded_at) values
  (:'c_rev', 'passport', 'x/passport/1.pdf', 'pending', :'t0');

-- Ada's E3 went out; Eli's is still in the queue (the drain is down).
insert into notification_outbox (key, channel, template, recipient_emails, payload, sent_at) values
  ('E3:staff:' || :'c_act' || ':1', 'email', 'E3', array['ada@chase.test'],
   jsonb_build_object('installLink', :'install', 'name', 'Ada', 'linkRedacted', true), :'t0'),
  ('E3:staff:' || :'c_e3q' || ':1', 'email', 'E3', array['eli@chase.test'],
   jsonb_build_object('link', :'link1', 'installLink', :'install', 'name', 'Eli'), null);

-- =====================================================================
-- A · who can reach it
-- =====================================================================
select ok(not has_function_privilege('authenticated', 'onboarding_chasers(timestamptz)', 'execute')
      and not has_function_privilege('anon', 'onboarding_chasers(timestamptz)', 'execute'),
  'no signed-in session can run the job');
select ok(has_function_privilege('service_role', 'onboarding_chasers(timestamptz)', 'execute')
      and has_function_privilege('service_role', 'onboarding_chaser_activation(uuid,uuid,text,text,timestamptz)', 'execute'),
  'the service role can (the Edge Function)');
select ok(not has_function_privilege('authenticated', 'onboarding_chaser_activation(uuid,uuid,text,text,timestamptz)', 'execute')
      and not has_function_privilege('authenticated', 'onboarding_chaser_candidates(timestamptz)', 'execute')
      and not has_function_privilege('authenticated', 'onboarding_chaser_config()', 'execute'),
  'nor queue an activation reminder, nor read the internal list');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok($$ select * from onboarding_chaser_state() $$, '42501', 'forbidden',
  'a client cannot read the chaser state');
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select throws_ok($$ select * from onboarding_chaser_state() $$, '42501', 'forbidden',
  'nor a worker');
reset role;

select is((select enabled from job_schedules where job = 'onboarding-chasers'), true,
  'the hourly schedule is registered and enabled');

-- =====================================================================
-- B · who is chased
-- =====================================================================
create temporary table t_c as
  select * from onboarding_chaser_candidates('2026-09-03 12:00+01');

select is((select track || '/' || template from t_c where staff_id = :'c_int'), 'interview/OC1',
  'Interview requested with the Willo invite sent: an OC1 email');
select is((select count(*)::int from t_c where staff_id = :'c_new'), 0,
  'not yet created in Willo: no interview to chase');
select is((select count(*)::int from t_c where staff_id = :'c_wait'), 0,
  'Interview completed is the office''s move (the Willo decision): never chased');
select is((select track || '/' || template from t_c where staff_id = :'c_act'), 'activation/OC2',
  'accepted, E3 sent, no password: an OC2 email');
select is((select count(*)::int from t_c where staff_id = :'c_e3q'), 0,
  'an E3 that has not gone out yet: nothing to remind them of');
select is((select array[track, template, step_no::text, step] from t_c where staff_id = :'c_app'),
  array['app', 'OC3', '2', 'your home address'],
  'signed up with a wizard step open: an OC3 push naming that step');
select is((select count(*)::int from t_c where staff_id = :'c_rev'), 0,
  'documents submitted and under review: the office''s move, never chased');
select is((select array[step_no::text, step] from t_c where staff_id = :'c_quiz'),
  array['6', 'the Health & Safety quiz'], 'quiz stage, induction done: the quiz');

-- =====================================================================
-- C · daily, and it never stops
-- =====================================================================
create temporary table r0 as select onboarding_chasers('2026-09-01 12:00+01') as r;
select is((select count(*)::int from notification_outbox where key like 'OC%:staff:' || :'c_int' || ':%'), 0,
  'an hour after the invite: nothing yet');
select is((select count(*)::int from notification_outbox where key like 'OC1:staff:' || :'c_old' || ':%'), 1,
  'a candidate idle for a month gets one reminder on the first run, not a month of them');

create temporary table r1 as select onboarding_chasers('2026-09-02 12:00+01') as r;
select is((select array[template, channel::text, recipient_emails[1], payload ->> 'variant', payload ->> 'name']
             from notification_outbox where key like 'OC1:staff:' || :'c_int' || ':%:1'),
  array['OC1', 'email', 'ivy@chase.test', 'first', 'Ivy'],
  'a day after the invite: the first interview email, to the candidate');
select is((select array[template, channel::text, payload ->> 'variant', payload ->> 'step']
             from notification_outbox where key like 'OC3:staff:' || :'c_app' || ':%:1'),
  array['OC3', 'push', 'first', 'your home address'],
  'and the first push for the open wizard step');
select is((select recipient_staff_id from notification_outbox where key like 'OC3:staff:' || :'c_app' || ':%:1'),
  :'c_app'::uuid, 'addressed to the candidate''s devices');
select is((select count(*)::int from notification_outbox where key like 'OC1:staff:' || :'c_old' || ':%'), 2,
  'and one more the next day');
select is((select count(*)::int from notification_outbox where template = 'OC2'), 0,
  'the job queues no OC2 itself: the link must be minted first');
select is((select jsonb_path_query_array(r -> 'activation', '$[*].staffId') from r1),
  jsonb_build_array(:'c_act'), 'it names the one activation reminder due');

create temporary table r1b as select onboarding_chasers('2026-09-02 12:00+01') as r;
select is((select array[(r ->> 'oc1')::int, (r ->> 'oc3')::int] from r1b), array[0, 0],
  'run again: nothing is sent twice');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select array[rungs_sent::text, stalled::text, step, next_due_at::text]
             from onboarding_chaser_state('2026-09-02 13:00+01') where staff_id = :'c_app'),
  array['1', 'false', 'your home address', '2026-09-03 11:00:00+00'],
  'the office sees the reminder sent and when the next is due (a day later)');
reset role;

create temporary table r2a as select onboarding_chasers('2026-09-03 11:20+01') as r;
select is((select count(*)::int from notification_outbox where key like 'OC1:staff:' || :'c_int' || ':%:2'), 0,
  'not before a day has passed');
create temporary table r2 as select onboarding_chasers('2026-09-03 11:40+01') as r;
select is((select payload ->> 'variant' from notification_outbox where key like 'OC1:staff:' || :'c_int' || ':%:2'),
  'second', 'the next day (with half an hour''s grace for the hourly job): the second email');
select is((select count(*)::int from notification_outbox where key like 'OC1:staff:' || :'c_old' || ':%'), 3,
  'the long-idle candidate too: one a day');

create temporary table r3 as select onboarding_chasers('2026-09-04 12:00+01') as r;
select is((select payload ->> 'variant' from notification_outbox where key like 'OC1:staff:' || :'c_int' || ':%:3'),
  'repeat', 'day three: the repeating wording');
create temporary table r4 as select onboarding_chasers('2026-09-05 12:00+01') as r;
select is((select payload ->> 'variant' from notification_outbox where key like 'OC1:staff:' || :'c_int' || ':%:4'),
  'repeat', 'day four: it does not stop');
create temporary table r5 as select onboarding_chasers('2026-09-30 12:00+01') as r;
select is((select count(*)::int from notification_outbox where key like 'OC1:staff:' || :'c_int' || ':%'), 5,
  'a missed stretch of days is not caught up: one reminder per run that finds one due');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select array[rungs_sent::text, stalled::text, next_due_at::text]
             from onboarding_chaser_state('2026-09-30 12:00+01') where staff_id = :'c_int'),
  array['5', 'true', '2026-10-01 11:00:00+00'],
  'the office sees the card as stalled, and the next reminder still due tomorrow');
reset role;
update settings set value = value || '{"stalled_after": 10}' where key = 'onboarding_chasers';
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select stalled from onboarding_chaser_state('2026-09-30 12:00+01') where staff_id = :'c_int'),
  false, 'Stalled follows the setting: five reminders is not stalled when stalled_after is 10');
reset role;
update settings set value = value || '{"stalled_after": 3}' where key = 'onboarding_chasers';

-- =====================================================================
-- D · progress starts a fresh ladder
-- =====================================================================
update onboarding_progress set address_at = '2026-09-04 10:00+01', updated_at = '2026-09-04 10:00+01'
 where staff_id = :'c_app';
create temporary table r8 as select onboarding_chasers('2026-09-06 12:00+01') as r;
select is((select count(*)::int from notification_outbox where key like 'OC3:staff:' || :'c_app' || ':%:1'), 2,
  'a step saved: two days later, rung 1 again under a new ladder');
select is((select payload ->> 'step' from notification_outbox
            where key like 'OC3:staff:' || :'c_app' || ':%:1' order by (payload ->> 'at') desc limit 1),
  'your profile selfie', 'naming the next step');

-- A rejected document hands the move back to the candidate, dated by the review.
update compliance_docs set review_status = 'rejected', reviewed_at = '2026-09-07 10:00+01'
 where staff_id = :'c_rev';
select is((select array[step_no::text, step] from onboarding_chaser_candidates('2026-09-09 12:00+01') where staff_id = :'c_rev'),
  array['4', 're-uploading a rejected document'], 'a rejected document: chased to re-upload it');
select is((select due_rung from onboarding_chaser_candidates('2026-09-08 09:29+01') where staff_id = :'c_rev'),
  null::int, 'counted from the rejection, not from the upload');

-- =====================================================================
-- E · OC2: the activation reminder and its link
-- =====================================================================
select throws_ok(format($$ select onboarding_chaser_activation(%L, %L, 'https://staff.test/activate', %L, '2026-09-03 12:00+01') $$,
                        :'c_act', :'u_act', :'install'),
  '22023', 'activation_link_not_personal', 'a link without a personal token is refused');
select throws_ok(format($$ select onboarding_chaser_activation(%L, %L, %L, %L, '2026-09-03 12:00+01') $$,
                        :'c_act', :'u_app', :'link1', :'install'),
  'P0001', 'account_mismatch', 'so is another person''s login');

select is((select onboarding_chaser_activation(:'c_act', :'u_act', :'link1', :'install', '2026-09-03 12:00+01') ->> 'queued'),
  'true', 'the minted link is queued');
select is((select array[channel::text, recipient_emails[1], payload ->> 'link', payload ->> 'installLink', payload ->> 'variant']
             from notification_outbox where template = 'OC2' and key like 'OC2:staff:' || :'c_act' || ':%:1'),
  array['email', 'ada@chase.test', :'link1', :'install', 'first'], 'as an email with the new link');
select is((select onboarding_chaser_activation(:'c_act', :'u_act', :'link2', :'install', '2026-09-03 12:05+01') ->> 'queued'),
  'false', 'a second call for the same rung queues nothing');
select is((select payload ->> 'link' from notification_outbox where key like 'OC2:staff:' || :'c_act' || ':%:1'),
  :'link2', 'but the unsent reminder follows the newest token');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"39400000-0000-4000-8000-0000000000f1","role":"authenticated"}';
select is((select count(*)::int from notification_outbox where template = 'OC2'), 0,
  'a manager cannot read an OC2 row (it carries a live link)');
select ok((select count(*)::int from notification_outbox where template = 'OC1') > 0,
  'but reads the other reminders');
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select count(*)::int from notification_outbox where template = 'OC2'), 1, 'an owner can');
reset role;

update notification_outbox set sent_at = now() where template = 'OC2';
select is((select array[payload ? 'link', (payload ->> 'linkRedacted')::boolean]
             from notification_outbox where template = 'OC2'),
  array[false, true], 'once sent, the link is gone from the row');

-- The office's own resend still refreshes an unsent E3, on the same origin only.
select is(activation_link_refresh(:'c_e3q', :'u_e3q', 'https://evil.example/activate/' || repeat('e', 40)), 0,
  'a link on another site never replaces the one in an unsent E3');
select is(activation_link_refresh(:'c_e3q', :'u_e3q', :'link2'), 1, 'an unsent E3 still follows a resend');

-- An office edit to staff.email on a linked login must never route a
-- freshly minted link to the new address (link_staff_account's rule).
update auth.users set email = 'ada.real@chase.test' where id = :'u_act';
select is((select count(*)::int from onboarding_chaser_candidates('2026-09-30 12:00+01') where staff_id = :'c_act'), 0,
  'staff email no longer the login''s: the job does not name them, so nothing is minted');
select throws_ok(format($$ select onboarding_chaser_activation(%L, %L, %L, %L, '2026-09-30 12:00+01') $$,
                        :'c_act', :'u_act', :'link1', :'install'),
  'P0001', 'account_email_mismatch', 'and a link minted anyway is refused, not sent to the new address');

-- =====================================================================
-- F · daytime only, and the off switch
-- =====================================================================
update onboarding_progress set updated_at = '2026-09-20 10:00+01' where staff_id = :'c_quiz';
select is((select r ->> 'skipped' from (select onboarding_chasers('2026-09-23 09:59+01') as r) x),
  'outside 10:00–18:00 UK', 'nothing before 10:00 UK');
select is((select r ->> 'skipped' from (select onboarding_chasers('2026-09-23 18:00+01') as r) x),
  'outside 10:00–18:00 UK', 'nor from 18:00 UK');
select is((select count(*)::int from notification_outbox
            where key like 'OC3:staff:' || :'c_quiz' || ':'
                           || floor(extract(epoch from timestamptz '2026-09-20 10:00+01'))::bigint || ':%'), 0,
  'so nobody was reminded out of hours');
select is((select (r ->> 'oc3')::int >= 1 from (select onboarding_chasers('2026-12-23 10:00+00') as r) x),
  true, '10:00 UK in winter (GMT) is inside the window');

update settings set value = value || '{"enabled": false}' where key = 'onboarding_chasers';
select is((select r ->> 'skipped' from (select onboarding_chasers('2026-12-30 12:00+00') as r) x),
  'disabled in settings.onboarding_chasers', 'the setting switches it off');

update settings set value = value || '{"enabled": true}' where key = 'onboarding_chasers';

-- =====================================================================
-- G · the edges: whose move it is, the right E3, the race, delivery,
--     and a setting typed wrong
-- =====================================================================
\set c_let   '39400000-0000-4000-8000-000000000011'
\set c_ret   '39400000-0000-4000-8000-000000000012'
\set c_con   '39400000-0000-4000-8000-000000000013'
\set c_ind   '39400000-0000-4000-8000-000000000014'
\set c_race  '39400000-0000-4000-8000-000000000015'
\set u_let   '39400000-0000-4000-8000-0000000000b1'
\set u_ret   '39400000-0000-4000-8000-0000000000b2'
\set u_con   '39400000-0000-4000-8000-0000000000b3'
\set u_ind   '39400000-0000-4000-8000-0000000000b4'
\set u_race  '39400000-0000-4000-8000-0000000000b5'
\set t1      '2026-10-01 11:00+01'

insert into auth.users (id, email, raw_app_meta_data, encrypted_password, email_confirmed_at) values
  (:'u_let',  'lea@chase.test',  '{"role":"staff"}', '$2a$10$hash', :'t1'),
  (:'u_ret',  'ron@chase.test',  '{"role":"staff"}', '',             null),
  (:'u_con',  'cat@chase.test',  '{"role":"staff"}', '$2a$10$hash', :'t1'),
  (:'u_ind',  'ian@chase.test',  '{"role":"staff"}', '$2a$10$hash', :'t1'),
  (:'u_race', 'ray@chase.test',  '{"role":"staff"}', '',             null);
insert into staff (id, user_id, first_name, last_name, email, phone, dob, status) values
  (:'c_let',  :'u_let',  'Lea',  'Letter', 'lea@chase.test', '+447700939411', date '2001-02-01', 'documents'),
  (:'c_ret',  :'u_ret',  'Ron',  'Return', 'ron@chase.test', '+447700939412', date '2001-02-02', 'documents'),
  (:'c_con',  :'u_con',  'Cat',  'Con',    'cat@chase.test', '+447700939413', date '2001-02-03', 'contract'),
  (:'c_ind',  :'u_ind',  'Ian',  'Ind',    'ian@chase.test', '+447700939414', date '2001-02-04', 'quiz'),
  (:'c_race', :'u_race', 'Ray',  'Race',   'ray@chase.test', '+447700939415', date '2001-02-05', 'documents');
update staff set stage_entered_at = :'t1', onboarding_started_at = :'t1'::timestamptz - interval '10 days'
 where id in (:'c_let', :'c_con', :'c_ind', :'c_race');
-- Ron is a returning applicant: this period began after his old E3.
update staff set stage_entered_at = :'t1', onboarding_started_at = now() + interval '1 minute'
 where id = :'c_ret';
insert into onboarding_progress (staff_id, rtw_at, address_at, selfie_at, documents_at, induction_at, hmrc_at, references_at, updated_at) values
  (:'c_let', :'t1', :'t1', :'t1', :'t1', null, null,  null,  :'t1'),
  (:'c_con', :'t1', :'t1', :'t1', :'t1', :'t1', :'t1', null, :'t1'),
  (:'c_ind', :'t1', :'t1', :'t1', :'t1', null, null,  null,  :'t1');
-- Lea's passport is under review; her optional completion letter was rejected.
insert into compliance_docs (staff_id, doc_type, file_path, review_status, uploaded_at, reviewed_at) values
  (:'c_let', 'passport', 'l/passport/1.pdf', 'pending', :'t1', null),
  (:'c_let', 'university_completion_letter', 'l/ucl/1.pdf', 'rejected', :'t1', :'t1');
insert into notification_outbox (key, channel, template, recipient_emails, payload, sent_at) values
  ('E3:staff:' || :'c_ret' || ':old', 'email', 'E3', array['ron@chase.test'], '{"name":"Ron"}', '2026-06-01 10:00+01'),
  ('E3:staff:' || :'c_race' || ':1', 'email', 'E3', array['ray@chase.test'], '{"name":"Ray"}', :'t1');

create temporary table t_g as select * from onboarding_chaser_candidates('2026-10-05 12:00+01');
select is((select count(*)::int from t_g where staff_id = :'c_let'), 0,
  'a rejected OPTIONAL completion letter is not the candidate''s move while the passport is under review');
select is((select count(*)::int from t_g where staff_id = :'c_ret'), 0,
  'an E3 from a previous period does not count: this period''s has not gone out');
select is((select array[step_no::text, step] from t_g where staff_id = :'c_con'),
  array['8', 'your two references'], 'contract stage: the first of HMRC, references, bank, contract still open');
select is((select array[step_no::text, step] from t_g where staff_id = :'c_ind'),
  array['5', 'the Health & Safety induction'], 'quiz stage without the induction: the induction first');

-- An E3 re-send is progress: a fresh OC2 ladder, counted from it.
insert into notification_outbox (key, channel, template, recipient_emails, payload, sent_at) values
  ('E3:resend:' || :'c_race' || ':1', 'email', 'E3', array['ray@chase.test'], '{"name":"Ray"}', '2026-10-04 10:00+01');
select is((select array[progress_at::text, coalesce(due_rung::text, 'none')] from onboarding_chaser_candidates('2026-10-05 09:00+01')
            where staff_id = :'c_race'),
  array['2026-10-04 09:00:00+00', 'none'], 'the office''s resend restarts the activation ladder');

-- The race: the job asked at p_now, then an E3 went out, then the mint.
select is((select onboarding_chaser_activation(:'c_race', :'u_race', :'link1', :'install', '2026-10-04 09:30+01') ->> 'raced'),
  'true', 'a link minted after an E3 went out is sent, because the mint killed that one');
select is((select payload ->> 'link' from notification_outbox where key like 'OC2:staff:' || :'c_race' || ':raced:%'),
  :'link1', 'with the newest link');
update auth.users set encrypted_password = '$2a$10$hash' where id = :'u_race';
select is((select onboarding_chaser_activation(:'c_race', :'u_race', :'link2', :'install', '2026-10-04 09:30+01') ->> 'queued'),
  'false', 'but once they have activated, a late mint sends nothing');

-- Delivery: a rung that could not be delivered is visible to the office.
update notification_outbox set failed_at = now(), error = 'no push subscription'
 where id = (select id from notification_outbox
              where key like 'OC3:staff:' || :'c_app' || ':%'
                and payload ->> 'step' = 'your profile selfie'
              order by (payload ->> 'rung')::int desc limit 1);
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select last_failed from onboarding_chaser_state('2026-09-06 13:00+01') where staff_id = :'c_app'),
  true, 'the office sees that the latest reminder never reached them');
reset role;

-- A setting typed wrong keeps the defaults for that part.
update settings set value = '{"from": "9am", "until": "18:00", "every_days": 0, "stalled_after": "3", "enabled": "yes"}'
 where key = 'onboarding_chasers';
select is(onboarding_chaser_config(),
  '{"enabled": true, "every_days": 1, "stalled_after": 3, "from": "10:00", "until": "18:00"}'::jsonb,
  'a bad time, a zero interval, a quoted number and a non-boolean switch all keep their defaults');
select lives_ok($$ select onboarding_chasers('2026-12-23 12:00+00') $$, 'and the job still runs');
update settings set value = '{"every_days": 2, "stalled_after": 5, "from": "09:00", "until": "17:00"}'
 where key = 'onboarding_chasers';
select is(onboarding_chaser_config(),
  '{"enabled": true, "every_days": 2, "stalled_after": 5, "from": "09:00", "until": "17:00"}'::jsonb,
  'a sane setting is taken');
update settings set value = '{"every_days": 45}' where key = 'onboarding_chasers';
select is(onboarding_chaser_config() -> 'every_days', '1'::jsonb, 'an interval over 30 days is refused');

select * from finish();
rollback;
