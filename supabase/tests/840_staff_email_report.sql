-- =====================================================================
-- 840 · /staff/roster "Emails staff receive" (20261015100000, ADR-0141)
--
--   A. Who can read it: any office login, the viewer included; not a
--      worker, not the public.
--   B. The counts per email: sent today (UK) and in all, failed, waiting,
--      people reached, last sent, next due. New applicants' OC1 wording
--      is not counted.
--   C. Existing staff waiting on their interview, and the switches.
-- =====================================================================
begin;
select plan(12);
\ir _shared/fixtures.psql

\set viewer '84000000-0000-4000-8000-0000000000a1'
\set c_list '84000000-0000-4000-8000-000000000001'
\set c_new  '84000000-0000-4000-8000-000000000002'
\set c_done '84000000-0000-4000-8000-000000000003'
\set now    '2026-10-15 12:00+01'

insert into auth.users (id, email) values (:'viewer', 'viewer.840@rls.test');
insert into profiles (id, role, office_role, full_name) values (:'viewer', 'admin', 'viewer', 'Vic Viewer');

delete from notification_outbox where template in ('IR1', 'OC1');

-- Lou (from the THC list) and Nia (a new applicant) are waiting on their
-- interview; Dot's answers are in.
insert into staff (id, user_id, first_name, last_name, email, phone, dob, status) values
  (:'c_list', null, 'Lou', 'List', 'lou@e840.test', '+447700984001', date '2001-05-01', 'interview_requested'),
  (:'c_new',  null, 'Nia', 'New',  'nia@e840.test', '+447700984002', date '2001-05-02', 'interview_requested'),
  (:'c_done', null, 'Dot', 'Done', 'dot@e840.test', '+447700984003', date '2001-05-03', 'interview_requested');
update staff set stage_entered_at = '2026-10-10 11:00+01', onboarding_started_at = '2026-10-10 11:00+01',
                 willo_invited_at = '2026-10-10 11:00+01'
 where id::text like '84000000-%';
update staff set willo_completed_at = '2026-10-11 15:00+01' where id = :'c_done';
insert into audit_log (actor, action, entity, entity_id, data) values
  (null, 'roster.matched', 'staff', :'c_list', jsonb_build_object('group', 'thc', 'via', 'list')),
  (null, 'roster.matched', 'staff', :'c_done', jsonb_build_object('group', 'thc', 'via', 'list'));

insert into notification_outbox (key, channel, template, recipient_emails, payload, queued_at, sent_at, failed_at, error, send_after) values
  -- IR1: two yesterday to one person, one today, one bounced, one waiting
  ('IR1:e:1', 'email', 'IR1', array['a@e840.test'], '{"variant":"named"}',   '2026-10-14 10:07+01', '2026-10-14 10:08+01', null, null, '2026-10-14 10:07+01'),
  ('IR1:e:2', 'email', 'IR1', array['b@e840.test'], '{"variant":"unnamed"}', '2026-10-14 10:07+01', '2026-10-14 10:08+01', null, null, '2026-10-14 10:07+01'),
  ('IR1:e:3', 'email', 'IR1', array['a@e840.test'], '{"variant":"named"}',   '2026-10-15 10:07+01', '2026-10-15 10:08+01', null, null, '2026-10-15 10:07+01'),
  ('IR1:e:4', 'email', 'IR1', array['c@e840.test'], '{"variant":"named"}',   '2026-10-15 10:07+01', null, '2026-10-15 10:09+01', 'invalid address', '2026-10-15 10:07+01'),
  ('IR1:e:5', 'email', 'IR1', array['d@e840.test'], '{"variant":"named"}',   '2026-10-15 11:59+01', null, null, null, '2026-10-15 12:01+01'),
  -- OC1, existing staff: one day-1 sent today, one notice waiting
  ('OC1:staff:x:1:1', 'email', 'OC1', array['lou@e840.test'], '{"variant":"existing_first"}', '2026-10-15 10:07+01', '2026-10-15 10:08+01', null, null, '2026-10-15 10:07+01'),
  ('OC1:notice:x',    'email', 'OC1', array['lou@e840.test'], '{"variant":"existing_notice"}', '2026-10-14 20:39+01', null, null, null, '2026-10-16 10:00+01'),
  -- OC1, a new applicant: not this page's
  ('OC1:staff:y:1:1', 'email', 'OC1', array['nia@e840.test'], '{"variant":"first"}', '2026-10-15 10:07+01', '2026-10-15 10:08+01', null, null, '2026-10-15 10:07+01');

-- =====================================================================
-- A · who can read it
-- =====================================================================
select ok(not has_function_privilege('anon', 'staff_email_report(timestamptz)', 'execute'),
  'the public cannot');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select staff_email_report() $$, '42501', 'not_authorised', 'a worker cannot');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
set local role authenticated;
create temporary table r on commit drop as select staff_email_report(:'now') as v;
reset role;
select ok((select v ? 'emails' from r), 'the read-only viewer can');

-- =====================================================================
-- B · the counts
-- =====================================================================
select is((select array_agg(e ->> 'id' order by n) from r, jsonb_array_elements(v -> 'emails') with ordinality as t(e, n)),
  array['IR1', 'OC1:existing_first', 'OC1:existing_second', 'OC1:existing_repeat', 'OC1:existing_notice'],
  'one row per email, in the order the page shows them');

create temporary table e on commit drop as
  select x ->> 'id' as id, x from r, jsonb_array_elements(v -> 'emails') x;

select is((select array[(x ->> 'sentToday')::int, (x ->> 'sentTotal')::int, (x ->> 'failedTotal')::int,
                        (x ->> 'queued')::int, (x ->> 'people')::int] from e where id = 'IR1'),
  array[1, 3, 1, 1, 2], 'IR1: 1 today, 3 in all, 1 failed, 1 waiting, 2 people reached');
select is((select (x ->> 'lastSentAt')::timestamptz from e where id = 'IR1'),
  '2026-10-15 10:08+01'::timestamptz, 'IR1: when the last one went');
select is((select (x ->> 'nextAt')::timestamptz from e where id = 'IR1'),
  '2026-10-15 12:01+01'::timestamptz, 'IR1: when the next one is due');

select is((select array[(x ->> 'sentToday')::int, (x ->> 'sentTotal')::int] from e where id = 'OC1:existing_first'),
  array[1, 1], 'interview reminder day 1: the existing-staff one only, not the new applicant''s');
select is((select array[(x ->> 'sentTotal')::int, (x ->> 'queued')::int] from e where id = 'OC1:existing_notice'),
  array[0, 1], 'the one-off notice: none sent yet, one waiting');
select is((select (x ->> 'nextAt')::timestamptz from e where id = 'OC1:existing_notice'),
  '2026-10-16 10:00+01'::timestamptz, 'and when it is due');
select is((select (x ->> 'sentTotal')::int from e where id = 'OC1:existing_repeat'), 0,
  'an email nothing has gone for still has its row, at zero');

-- =====================================================================
-- C · waiting on the interview, and the switches
-- =====================================================================
select is((select array[(v ->> 'interviewWaiting')::int::text, v #>> '{switches,IR1}', v #>> '{switches,OC1}'] from r),
  array['1', 'true', 'true'],
  'one existing member of staff waiting on the interview (not the new applicant, not the done); both emails on');

select * from finish();
rollback;
