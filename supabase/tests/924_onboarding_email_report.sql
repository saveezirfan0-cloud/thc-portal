-- =====================================================================
-- 924 · /onboarding/reminders: the daily onboarding reminder emails and
--       their numbers (20261023130000, ADR-0187)
--
--   A. Who can read it: any office login, the viewer included; not a
--      worker, not the public.
--   B. The counts per email: sent today (UK) and in all, failed, waiting,
--      people reached, last sent, next due; rows with no variant (the
--      one-off notice) are not counted.
--   C. OC4 beside a push is counted apart from OC4 in place of one.
--   D. The stages: who is being reminded, reminded today, with a device,
--      and at which wizard step.
--   E. The switches (a code off, the job off), and counts only: no address
--      or link in the answer.
--   F. Edges: the UK day, a client login, a row the 180-day purge has
--      stripped, a candidate whose address changed.
-- =====================================================================
begin;
select plan(27);
\ir _shared/fixtures.psql

\set viewer '92400000-0000-4000-8000-0000000000a1'
\set c_int  '92400000-0000-4000-8000-000000000001'
\set c_app  '92400000-0000-4000-8000-000000000002'
\set u_app  '92400000-0000-4000-8000-0000000000a2'
\set c_act  '92400000-0000-4000-8000-000000000003'
\set u_act  '92400000-0000-4000-8000-0000000000a3'
\set now    '2026-10-22 12:00+01'

insert into auth.users (id, email) values (:'viewer', 'viewer.924@rls.test');
insert into profiles (id, role, office_role, full_name) values (:'viewer', 'admin', 'viewer', 'Vic Viewer');

delete from notification_outbox where template in ('OC1', 'OC2', 'OC3', 'OC4');

-- Ivy is waiting on her interview (invited, not done). Ann has signed up
-- and has a device; her right-to-work is done, the home address is next.
insert into auth.users (id, email, raw_app_meta_data, encrypted_password, email_confirmed_at) values
  (:'u_app', 'ann@e924.test', '{"role":"staff"}', '$2a$10$hash', '2026-10-01 10:00+01');
insert into auth.users (id, email, raw_app_meta_data, encrypted_password) values
  (:'u_act', 'dan@e924.test', '{"role":"staff"}', null);
insert into staff (id, user_id, first_name, last_name, email, phone, dob, status) values
  (:'c_int', null,      'Ivy', 'Int', 'ivy@e924.test', '+447700924001', date '2001-05-01', 'interview_requested'),
  (:'c_app', :'u_app', 'Ann', 'App', 'ann@e924.test', '+447700924002', date '2001-05-02', 'documents'),
  -- Dan was accepted and has had his activation email, but has set no password.
  (:'c_act', :'u_act', 'Dan', 'Act', 'dan@e924.test', '+447700924003', date '2001-05-03', 'documents');
update staff set stage_entered_at = '2026-10-10 11:00+01', onboarding_started_at = '2026-10-10 11:00+01'
 where id::text like '92400000-%';
update staff set willo_invited_at = '2026-10-10 11:00+01' where id = :'c_int';
insert into onboarding_progress (staff_id, rtw_at, updated_at) values (:'c_app', '2026-10-10 12:00+01', '2026-10-10 12:00+01');
insert into push_subscriptions (staff_id, endpoint, p256dh, auth) values
  (:'c_app', 'https://push.test/ann', 'p256dh-ann', 'auth-ann');

insert into notification_outbox (key, channel, template, recipient_staff_id, recipient_emails, payload, queued_at, sent_at, failed_at, error, send_after) values
  -- OC1, a new applicant: two reminders to Ivy (yesterday, today), one bounced, one waiting
  ('OC1:staff:a:1:1', 'email', 'OC1', :'c_int', array['ivy@e924.test'], '{"variant":"first"}',  '2026-10-21 10:07+01', '2026-10-21 10:08+01', null, null, '2026-10-21 10:07+01'),
  ('OC1:staff:a:1:2', 'email', 'OC1', :'c_int', array['ivy@e924.test'], '{"variant":"second"}', '2026-10-22 10:07+01', '2026-10-22 10:08+01', null, null, '2026-10-22 10:07+01'),
  ('OC1:staff:b:1:1', 'email', 'OC1', null,     array['bad@e924.test'], '{"variant":"first"}',  '2026-10-22 10:07+01', null, '2026-10-22 10:09+01', 'invalid address', '2026-10-22 10:07+01'),
  ('OC1:staff:c:1:3', 'email', 'OC1', null,     array['soon@e924.test'], '{"variant":"repeat"}', '2026-10-22 11:59+01', null, null, null, '2026-10-22 12:01+01'),
  -- OC1, existing staff, and the one-off notice (not counted here)
  ('OC1:staff:d:1:1', 'email', 'OC1', null, array['lou@e924.test'], '{"variant":"existing_first"}',  '2026-10-22 10:07+01', '2026-10-22 10:08+01', null, null, '2026-10-22 10:07+01'),
  ('OC1:notice:d',    'email', 'OC1', null, array['lou@e924.test'], '{"variant":"existing_notice"}', '2026-10-22 10:07+01', '2026-10-22 10:08+01', null, null, '2026-10-22 10:07+01'),
  -- OC2: one set-up reminder, with a live link the report must never show
  ('OC2:staff:e:1:1', 'email', 'OC2', null, array['eve@e924.test'], '{"variant":"first","link":"https://staff.test/activate/secret-token"}', '2026-10-22 10:07+01', '2026-10-22 10:08+01', null, null, '2026-10-22 10:07+01'),
  -- OC3 pushes: one sent to Ann, one that failed (no subscription)
  ('OC3:staff:f:1:1', 'push', 'OC3', :'c_app', null, '{"variant":"first"}', '2026-10-22 10:07+01', '2026-10-22 10:08+01', null, null, '2026-10-22 10:07+01'),
  ('OC3:staff:g:1:1', 'push', 'OC3', null,     null, '{"variant":"first"}', '2026-10-22 10:07+01', null, '2026-10-22 10:09+01', 'no push subscription', '2026-10-22 10:07+01'),
  -- OC4: one in place of a push (pushOn 0, key on OC3's ladder), two beside one (pushOn 1, own key)
  ('OC3:staff:h:1:2', 'email', 'OC4', null,     array['olive@e924.test'], '{"variant":"second","pushOn":"0"}', '2026-10-22 10:07+01', '2026-10-22 10:08+01', null, null, '2026-10-22 10:07+01'),
  ('OC4:staff:f:1:2', 'email', 'OC4', :'c_app', array['ann@e924.test'],   '{"variant":"second","pushOn":"1"}', '2026-10-22 10:07+01', '2026-10-22 10:08+01', null, null, '2026-10-22 10:07+01'),
  ('OC4:staff:i:1:1', 'email', 'OC4', null,     array['owen@e924.test'],  '{"variant":"first","pushOn":"1"}',  '2026-10-21 10:07+01', '2026-10-21 10:08+01', null, null, '2026-10-21 10:07+01');

-- Ivy's own ladder, under the keys the chaser reads: reminders 1 and 2 went
-- yesterday, the third today and bounced, so she is Stalled (3) and her
-- latest reminder was not delivered.
insert into notification_outbox (key, channel, template, recipient_staff_id, recipient_emails, payload, queued_at, sent_at, failed_at, error, send_after)
select 'OC1:staff:' || :'c_int' || ':' || floor(extract(epoch from timestamptz '2026-10-10 11:00+01'))::bigint || ':' || n,
       'email', 'OC1', :'c_int', array['ivy@e924.test'],
       jsonb_build_object('variant', v, 'rung', n, 'at', at_),
       at_, case when n < 3 then at_ + interval '1 minute' end,
       case when n = 3 then at_ + interval '2 minutes' end, case when n = 3 then 'bounced' end, at_
  from (values (1, 'first',  timestamptz '2026-10-21 10:07+01'),
               (2, 'second', timestamptz '2026-10-21 10:08+01'),
               (3, 'repeat', timestamptz '2026-10-22 10:07+01')) as t(n, v, at_);

-- Dan's activation email went; OC2 reminders sent either side of the UK
-- midnight: 00:30 BST on the 22nd is today, 23:30 BST on the 21st is not.
insert into notification_outbox (key, channel, template, recipient_staff_id, recipient_emails, payload, queued_at, sent_at, send_after) values
  ('E3:staff:' || :'c_act' || ':1', 'email', 'E3', :'c_act', array['dan@e924.test'], '{}', '2026-10-10 12:00+01', '2026-10-10 12:01+01', '2026-10-10 12:00+01'),
  ('OC2:edge:1', 'email', 'OC2', null, array['edge1@e924.test'], '{"variant":"second"}', '2026-10-21 23:30+00', '2026-10-21 23:30+00', '2026-10-21 23:30+00'),
  ('OC2:edge:2', 'email', 'OC2', null, array['edge2@e924.test'], '{"variant":"repeat"}', '2026-10-21 22:30+00', '2026-10-21 22:30+00', '2026-10-21 22:30+00'),
  -- A row the 180-day purge has stripped (ADR-0164): no recipient, no pushOn.
  ('OC1:purged:1', 'email', 'OC1', null, null, '{"variant":"first","rung":1}', '2026-04-01 10:00+01', '2026-04-01 10:01+01', '2026-04-01 10:00+01'),
  -- One person, two spellings of her address (a case and a space): one person.
  ('OC1:staff:z:1:1', 'email', 'OC1', null, array[' IVY2@e924.test '], '{"variant":"second"}', '2026-10-20 10:07+01', '2026-10-20 10:08+01', '2026-10-20 10:07+01'),
  ('OC1:staff:z:1:2', 'email', 'OC1', null, array['ivy2@E924.test'],   '{"variant":"second"}', '2026-10-19 10:07+01', '2026-10-19 10:08+01', '2026-10-19 10:07+01');

-- =====================================================================
-- A · who can read it
-- =====================================================================
select ok(not has_function_privilege('anon', 'onboarding_email_report(timestamptz)', 'execute'),
  'the public cannot');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select onboarding_email_report() $$, '42501', 'not_authorised', 'a worker cannot');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select onboarding_email_report() $$, '42501', 'not_authorised', 'a client login cannot');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
set local role authenticated;
create temporary table r on commit drop as select onboarding_email_report(:'now') as v;
reset role;
select ok((select v ? 'emails' from r), 'the read-only viewer can');

-- =====================================================================
-- B · the counts
-- =====================================================================
select is((select array_agg(e ->> 'id' order by n) from r, jsonb_array_elements(v -> 'emails') with ordinality as t(e, n)),
  array['OC1:first', 'OC1:second', 'OC1:repeat', 'OC1:existing_first', 'OC1:existing_second', 'OC1:existing_repeat',
        'OC2:first', 'OC2:second', 'OC2:repeat', 'OC3:first', 'OC3:second', 'OC3:repeat',
        'OC4:first', 'OC4:second', 'OC4:repeat'],
  'one row per email, in the order the page shows them');

create temporary table e on commit drop as
  select x ->> 'id' as id, x from r, jsonb_array_elements(v -> 'emails') x;

select is((select array[(x ->> 'sentToday')::int, (x ->> 'sentTotal')::int, (x ->> 'failedTotal')::int,
                        (x ->> 'queued')::int, (x ->> 'people')::int] from e where id = 'OC1:first'),
  array[0, 3, 1, 0, 1], 'OC1 first: none today, 3 in all (yesterday, Ivy''s ladder, and one the purge has stripped), 1 bounced, 1 person (the stripped one has none)');
select is((select array[(x ->> 'sentToday')::int, (x ->> 'sentTotal')::int] from e where id = 'OC1:second'),
  array[1, 4], 'OC1 second: 1 today, 4 in all');
select is((select (x ->> 'people')::int from e where id = 'OC1:second'), 2,
  'F: people are counted by candidate, else by address trimmed and lower-cased: Ivy, and one address spelled two ways');
select is((select array[(x ->> 'queued')::int, (x ->> 'sentTotal')::int] from e where id = 'OC1:repeat'),
  array[1, 0], 'OC1 repeat: one waiting, none sent');
select is((select (x ->> 'nextAt')::timestamptz from e where id = 'OC1:repeat'),
  '2026-10-22 12:01+01'::timestamptz, 'and when it is due');
select is((select (x ->> 'lastSentAt')::timestamptz from e where id = 'OC1:second'),
  '2026-10-22 10:08+01'::timestamptz, 'when the last one went');
select is((select array[(x ->> 'sentToday')::int, (x ->> 'sentTotal')::int] from e where id = 'OC1:existing_first'),
  array[1, 1], 'the existing-staff interview reminder is its own row; the one-off notice is in none');
select is((select array[(x ->> 'sentTotal')::int, (x ->> 'people')::int] from e where id = 'OC2:first'),
  array[1, 1], 'OC2 set-up reminder: 1 sent');
select is((select array[(x ->> 'sentTotal')::int, (x ->> 'failedTotal')::int, (x ->> 'people')::int] from e where id = 'OC3:first'),
  array[1, 1, 1], 'OC3 pushes: 1 sent, 1 not delivered; a push is counted by candidate');
select is((select array[(x ->> 'sentToday')::int, (x ->> 'sentTotal')::int] from e where id = 'OC4:second'),
  array[2, 2], 'OC4 second: both the one in place of a push and the one beside it');
select is((select (x ->> 'sentTotal')::int from e where id = 'OC4:repeat'), 0,
  'an email nothing has gone for still has its row, at zero');

-- =====================================================================
-- C · beside the push, apart from in place of it
-- =====================================================================
select is((select array[(v #>> '{besidePush,sentToday}')::int, (v #>> '{besidePush,sentTotal}')::int] from r),
  array[1, 2], 'OC4 beside a push: 1 today, 2 in all; the one in place of a push is not in it');

-- =====================================================================
-- D · the stages
-- =====================================================================
select is((select array[v #>> '{stages,interview,waiting}', v #>> '{stages,app,waiting}',
                         v #>> '{stages,app,withPush}', v #>> '{stages,activation,waiting}'] from r),
  array['1', '1', '1', '1'],
  'Ivy is being chased for her interview, Ann at the wizard with a device, Dan for his set-up');
select is((select v #> '{steps}' from r), '[{"n": 1, "step": "your home address"}]'::jsonb,
  'the app track by wizard step: Ann is at her home address');
select is((select array[v #>> '{stages,interview,stalled}', v #>> '{stages,interview,remindedToday}'] from r),
  array['1', '1'],
  'Ivy has had three reminders and no progress: Stalled; the third went today');
select is((select v #>> '{stages,interview,lastFailed}' from r), '1',
  'and her latest reminder bounced');

-- =====================================================================
-- F · the UK day
-- =====================================================================
select is((select (x ->> 'sentToday')::int from e where id = 'OC2:second'), 1,
  'F: 00:30 BST on the 22nd is today, though it is still the 21st in UTC');
select is((select array[(x ->> 'sentToday')::int, (x ->> 'sentTotal')::int] from e where id = 'OC2:repeat'),
  array[0, 1], 'F: 23:30 BST on the 21st is yesterday');

-- =====================================================================
-- E · the switches, and counts only
-- =====================================================================
select is((select array[v #>> '{switches,OC1}', v #>> '{switches,OC4}'] from r), array['true', 'true'], 'every email is on');
select ok((select position('secret-token' in v::text) = 0 and position('@e924.test' in v::text) = 0 from r),
  'counts only: no address and no activation link in the answer');

-- A code switched off in Settings, then the whole job (read as the viewer).
select set_config('request.jwt.claims', '', true);
insert into settings (key, value) values ('notification_switches', '{"OC4": false}')
  on conflict (key) do update set value = excluded.value;
select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
set local role authenticated;
create temporary table r_off on commit drop as select onboarding_email_report(:'now') as v;
reset role;
select is((select array[v #>> '{switches,OC4}', v #>> '{switches,OC1}'] from r_off),
  array['false', 'true'], 'a code switched off in Settings reads Off, the others stay on');

select set_config('request.jwt.claims', '', true);
insert into settings (key, value) values ('onboarding_chasers', '{"enabled": false}')
  on conflict (key) do update set value = excluded.value;
select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
set local role authenticated;
create temporary table r_job on commit drop as select onboarding_email_report(:'now') as v;
reset role;
select is((select array[v #>> '{switches,OC1}', v #>> '{switches,OC3}'] from r_job),
  array['false', 'false'], 'and with the job disabled every reminder reads Off');

select * from finish();
rollback;
