-- =====================================================================
-- 851 · /staff/roster: the reminder report reads the reminders once
--       (20261019120000)
--
-- The report now groups the IR1 rows by UK day once and reads the
-- possible matches once. 812 pins the figures with reminders on two days;
-- this pins what the regrouping could get wrong: a day with nothing sent
-- reads 0 (not null), an empty outbox reads 0 everywhere with no last
-- send, and a row sent just after midnight UK falls on the UK day.
-- =====================================================================
begin;
select plan(8);
\ir _shared/fixtures.psql

\set now '2026-10-14 12:00+01'

delete from invite_roster;
delete from notification_outbox where template = 'IR1';

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table empty_rep as select invite_roster_report(:'now') as r;
reset role;

select is((select r -> 'kpis' ->> 'sentToday' from empty_rep), '0', 'no reminders: sent today 0');
select is((select r -> 'kpis' ->> 'sentTotal' || '/' || (r -> 'kpis' ->> 'failedTotal') || '/' || (r -> 'kpis' ->> 'queued') from empty_rep),
  '0/0/0', 'no reminders: sent, failed and waiting 0');
select ok((select r -> 'kpis' -> 'lastSentAt' = 'null'::jsonb from empty_rep), 'no reminders: no last send');
select ok((select bool_and((d ->> 'sent') = '0' and (d ->> 'failed') = '0')
             from empty_rep, jsonb_array_elements(r -> 'daily') d)
          and (select jsonb_array_length(r -> 'daily') = 14 from empty_rep),
  'no reminders: fourteen days, each 0 sent and 0 failed');

-- 00:30 UK on the 14th is 23:30 UTC on the 13th: it is the 14th's.
insert into notification_outbox (key, channel, template, recipient_emails, payload, queued_at, sent_at) values
  ('IR1:851:1', 'email', 'IR1', array['a@r851.test'], '{}', '2026-10-14 00:29+01', '2026-10-14 00:30+01'),
  ('IR1:851:2', 'email', 'IR1', array['b@r851.test'], '{}', '2026-10-10 10:00+01', '2026-10-10 10:01+01');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table rep as select invite_roster_report(:'now') as r;
reset role;

select is((select r -> 'kpis' ->> 'sentToday' from rep), '1', 'just after midnight UK counts as today');
select is((select r -> 'daily' -> 13 from rep), '{"day": "2026-10-14", "sent": 1, "failed": 0}'::jsonb,
  'and lands on today in the series');
select is((select r -> 'daily' -> 12 from rep), '{"day": "2026-10-13", "sent": 0, "failed": 0}'::jsonb,
  'the day before (its UTC date) reads 0');
select is((select r -> 'daily' -> 9 from rep), '{"day": "2026-10-10", "sent": 1, "failed": 0}'::jsonb,
  'an earlier day keeps its own send');

select * from finish();
rollback;
