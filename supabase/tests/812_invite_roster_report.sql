-- =====================================================================
-- 812 · /staff/roster: the reminder report and Link (20261013170000,
--       ADR-0123)
--
--   A. Who can reach them: any office login reads the report; only owner
--      and manager can Link; a worker neither.
--   B. The report: not applied by group, rows kept after applying, the
--      IR1 counts, per-email reminders and the last failure, the series.
--   C. Possible matches: same first name and last word of the surname, a
--      live record with no Payroll ID, not itself on the list.
--   D. Link: applies the Payroll ID (and Employee ID) and SpudBros marking,
--      consumes the row, audits; refuses a name that does not agree, a
--      Payroll ID somebody else holds.
-- =====================================================================
begin;
select plan(34);
\ir _shared/fixtures.psql

\set viewer '81200000-0000-4000-8000-0000000000a1'
\set sched  '81200000-0000-4000-8000-0000000000a2'
\set s_moon '81200000-0000-4000-8000-000000000001'
\set s_char '81200000-0000-4000-8000-000000000002'
\set s_here '81200000-0000-4000-8000-000000000003'
\set s_ali1 '81200000-0000-4000-8000-000000000004'
\set s_paid '81200000-0000-4000-8000-000000000005'
\set now    '2026-10-14 12:00+01'

insert into auth.users (id, email) values (:'viewer', 'viewer.812@rls.test'), (:'sched', 'sched.812@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'viewer', 'admin', 'viewer', 'Vic Viewer'), (:'sched', 'admin', 'scheduler', 'Sid Scheduler');

delete from invite_roster;
delete from notification_outbox where template = 'IR1';

insert into invite_roster (email, first_name, last_name, payroll_id, grp) values
  ('tanji@r812.test',  'Chowdhury', 'Moon',           '7153', 'thc'),       -- applied as chowdhury@
  ('char@r812.test',   'Charlotte', 'Crossley-Smith', '4162', 'spudbros'),  -- applied as cc@
  ('here@r812.test',   'Hal',       'Sheet',          '9104', 'thc'),       -- applied with this email
  ('nobody@r812.test', 'Nia',       'Nobody',         '9200', 'thc'),       -- not applied
  ('amrita@r812.test', 'Amrita',    null,             '6248', 'thc'),       -- one word: matches nobody
  ('paid@r812.test',   'Pat',       'Paid',           '9300', 'thc');       -- the only Pat Paid has a Payroll ID

insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, payroll_id) values
  (:'s_moon', null, 'Chowdhury', 'Moon',           'chowdhury@r812.test', '+447700981201', date '2001-04-01', 'documents', null),
  (:'s_char', null, 'Charlotte', 'Crossley-Smith', 'cc@r812.test',        '+447700981202', date '2001-04-02', 'interview_requested', null),
  (:'s_here', null, 'Hal',       'Here',           'here@r812.test',      '+447700981203', date '2001-04-03', 'interview_requested', null),
  (:'s_ali1', null, 'Amrita',    'Kaur',           'ak@r812.test',        '+447700981204', date '2001-04-04', 'interview_requested', null),
  (:'s_paid', null, 'Pat',       'Paid',           'pp@r812.test',        '+447700981205', date '2001-04-05', 'compliant', 'Z1');

-- Two days of IR1: nobody@ sent twice, tanji@ sent once and then bounced.
insert into notification_outbox (key, channel, template, recipient_emails, payload, queued_at, sent_at, failed_at, error) values
  ('IR1:t:1', 'email', 'IR1', array['nobody@r812.test'], '{}', '2026-10-13 10:07+01', '2026-10-13 10:08+01', null, null),
  ('IR1:t:2', 'email', 'IR1', array['tanji@r812.test'],  '{}', '2026-10-13 10:07+01', '2026-10-13 10:08+01', null, null),
  ('IR1:t:3', 'email', 'IR1', array['nobody@r812.test'], '{}', '2026-10-14 10:07+01', '2026-10-14 10:08+01', null, null),
  ('IR1:t:4', 'email', 'IR1', array['tanji@r812.test'],  '{}', '2026-10-14 10:07+01', null, '2026-10-14 10:09+01', 'Resend answered 422: invalid address'),
  ('IR1:t:5', 'email', 'IR1', array['paid@r812.test'],   '{}', '2026-10-14 11:59+01', null, null, null);

-- =====================================================================
-- A · who can reach them
-- =====================================================================
select ok(not has_function_privilege('anon', 'invite_roster_report(timestamptz)', 'execute')
      and not has_function_privilege('anon', 'link_invite_roster_entry(uuid, uuid)', 'execute')
      and not has_function_privilege('authenticated', 'invite_roster_possible_matches()', 'execute'),
  'the public reaches neither; the matcher is internal');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select invite_roster_report() $$, '42501', 'not_authorised', 'a worker cannot read the report');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$ select invite_roster_report() $$, 'a viewer can read it');
select throws_ok(format($$ select link_invite_roster_entry((select id from invite_roster where email = 'tanji@r812.test'), %L) $$, :'s_moon'),
  '42501', 'read_only', 'a viewer cannot Link');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'sched', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select link_invite_roster_entry((select id from invite_roster where email = 'tanji@r812.test'), %L) $$, :'s_moon'),
  '42501', 'not_permitted', 'a scheduler cannot Link (a Payroll ID write)');
reset role;

-- =====================================================================
-- B · the report
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table rep as select invite_roster_report(:'now') as r;
reset role;

select is((select r -> 'kpis' ->> 'notAppliedThc' from rep), '4',
  'not applied, THC: Moon, Nobody, Amrita, Paid (Hal applied with his listed email)');
select is((select r -> 'kpis' ->> 'notAppliedSpudbros' from rep), '1', 'not applied, SpudBros: Charlotte');
select is((select r -> 'kpis' ->> 'appliedKept' from rep), '1', 'one row kept after its person applied (Hal)');
select is((select r -> 'applied' from rep),
  jsonb_build_array((select id from invite_roster where email = 'here@r812.test')), 'and it is Hal''s row');
select is((select r -> 'kpis' ->> 'sentToday' from rep), '1', 'sent today (14th): one');
select is((select r -> 'kpis' ->> 'sentTotal' from rep), '3', 'sent in all: three');
select is((select r -> 'kpis' ->> 'failedTotal' from rep), '1', 'failed: one');
select is((select r -> 'kpis' ->> 'queued' from rep), '1', 'still queued: one');
select is((select r -> 'kpis' ->> 'peopleReminded' from rep), '2', 'two people have had one');
select is((select (r -> 'reminders' -> 'nobody@r812.test' ->> 'sent') from rep), '2', 'Nobody: reminded twice');
select is((select (r -> 'reminders' -> 'tanji@r812.test' ->> 'lastError') from rep),
  'Resend answered 422: invalid address', 'the last failure is shown against the address');
select is((select jsonb_array_length(r -> 'daily') from rep), 14, 'a fourteen-day series');
select is((select r -> 'daily' -> 13 from rep), '{"day": "2026-10-14", "sent": 1, "failed": 1}'::jsonb,
  'today''s bar: one sent, one failed');

-- =====================================================================
-- C · possible matches
-- =====================================================================
select is(
  (select array_agg(m ->> 'staffName' order by m ->> 'staffName') from rep, jsonb_array_elements(r -> 'matches') m),
  array['Charlotte Crossley-Smith', 'Chowdhury Moon'],
  'Moon and Charlotte; not Amrita (one word), not Pat (already has a Payroll ID), not Hal');
select is((select r -> 'kpis' ->> 'possibleMatches' from rep), '2', 'counted');

-- =====================================================================
-- D · Link
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select link_invite_roster_entry((select id from invite_roster where email = 'nobody@r812.test'), %L) $$, :'s_moon'),
  'P0001', 'name_mismatch', 'the names must agree');
select is(link_invite_roster_entry((select id from invite_roster where email = 'tanji@r812.test'), :'s_moon'),
  '{"payrollId": "7153", "group": "thc", "spudbros": "unchanged"}'::jsonb, 'Moon linked');
select is(link_invite_roster_entry((select id from invite_roster where email = 'char@r812.test'), :'s_char'),
  '{"payrollId": "4162", "group": "spudbros", "spudbros": "marked"}'::jsonb, 'Charlotte linked, and marked SpudBros');
reset role;

select is((select array[payroll_id, employee_id::text] from staff where id = :'s_moon'), array['7153', '7153'],
  'Moon has the Payroll ID, and it is the Employee ID (system had issued none)');
select ok((select spudbros_express and not thc_shifts_enabled from staff where id = :'s_char'),
  'Charlotte is SpudBros Express, THC shifts off');
select ok(not exists (select 1 from invite_roster where email in ('tanji@r812.test', 'char@r812.test')),
  'both rows consumed, so the reminders stop');
select is((select data ->> 'listEmail' from audit_log where action = 'roster.linked' and entity_id = :'s_moon'),
  'tanji@r812.test', 'audited, with the listed and applied addresses');

-- A Payroll ID somebody else holds is never given twice.
update staff set payroll_id = '9200' where id = :'s_paid';
insert into staff (id, user_id, first_name, last_name, email, phone, dob, status) values
  ('81200000-0000-4000-8000-000000000006', null, 'Nia', 'Nobody', 'nn@r812.test', '+447700981206', date '2001-04-06', 'interview_requested');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select link_invite_roster_entry((select id from invite_roster where email = 'nobody@r812.test'), '81200000-0000-4000-8000-000000000006') $$,
  'P0001', 'payroll_id_taken', 'a Payroll ID somebody else holds is refused');
reset role;

-- =====================================================================
-- E · the page's On/Off
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select set_invite_roster_reminders(false) $$, '42501', 'read_only', 'a viewer cannot turn it off');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'sched', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(set_invite_roster_reminders(false), '{"enabled": false, "cancelled": 1}'::jsonb,
  'a scheduler can turn it off; the one reminder still queued is cancelled');
reset role;

select is((select value ->> 'enabled' from settings where key = 'invite_roster_reminders'), 'false',
  'the setting says off');
select ok((select failed_at is not null and error like 'not sent: the daily reminder was switched off%'
             from notification_outbox where key = 'IR1:t:5'),
  'the queued reminder will not go');
select is(invite_roster_reminders(timestamptz '2026-10-15 10:07+01', 'https://staff.thc.test/apply') ->> 'skipped',
  'disabled in settings.invite_roster_reminders', 'and the job queues nothing while it is off');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(set_invite_roster_reminders(true), '{"enabled": true, "cancelled": 0}'::jsonb, 'turned on again');
reset role;

select * from finish();
rollback;
