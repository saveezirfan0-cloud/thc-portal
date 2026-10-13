-- =====================================================================
-- 811 · IR1, the daily reminder to THC invite-list rows not yet applied
--       (20261013160000, ADR-0122)
--
--   A. Who can reach it.
--   B. Who is reminded: THC rows whose email nobody in staff holds. Not
--      SpudBros, not somebody who applied under the listed email (a row
--      kept after a name mismatch), a removed record's old email does not
--      count as applied.
--   C. When: inside settings.invite_roster_reminders from/until (UK),
--      once a UK day, never twice; the switch stops it.
--   D. The apply link: the ordinary /apply on an https origin, or nothing
--      is queued.
-- =====================================================================
begin;
select plan(24);
\ir _shared/fixtures.psql

\set s_here '81100000-0000-4000-8000-000000000001'
\set s_gone '81100000-0000-4000-8000-000000000002'
\set link   'https://staff.thc.test/apply'
\set day1   '2026-10-14 10:07+01'

delete from invite_roster;

insert into invite_roster (email, first_name, last_name, payroll_id, grp) values
  ('ivy@ir1.test',   'Ivy',  'Invited', '9101', 'thc'),
  ('nona@ir1.test',  null,   null,      '9102', 'thc'),
  ('spud@ir1.test',  'Sam',  'Spud',    '9103', 'spudbros'),
  ('here@ir1.test',  'Hal',  'Sheet',   '9104', 'thc');

-- Hal applied with the listed email; the sheet spelt his name differently,
-- so his row was kept (ADR-0107). Gus's old record was removed (§1.7).
insert into staff (id, user_id, first_name, last_name, email, phone, dob, status) values
  (:'s_here', null, 'Hal', 'Here', ' Here@IR1.test ', '+447700981101', date '2001-03-01', 'interview_requested'),
  (:'s_gone', null, 'Gus', 'Gone', 'gone@ir1.test',   '+447700981102', date '2001-03-02', 'interview_requested');
update staff set removed_at = now() where id = :'s_gone';
-- Removal clears his old list row (20261012120200); the office has since
-- invited him again.
insert into invite_roster (email, first_name, last_name, payroll_id, grp) values
  ('gone@ir1.test', 'Gus', 'Gone', '9105', 'thc');

-- =====================================================================
-- A · who can reach it
-- =====================================================================
select ok(not has_function_privilege('authenticated', 'invite_roster_reminders(timestamptz, text)', 'execute')
      and not has_function_privilege('anon', 'invite_roster_reminders(timestamptz, text)', 'execute'),
  'no session can queue the reminders');
select ok(has_function_privilege('service_role', 'invite_roster_reminders(timestamptz, text)', 'execute'),
  'the job (service role) can');
select ok(not has_function_privilege('authenticated', 'invite_roster_reminder_config()', 'execute'),
  'nor read its settings through the function');
select is((select value from settings where key = 'invite_roster_reminders'),
  '{"enabled": true, "from": "10:00", "until": "18:00"}'::jsonb,
  'the switch is on, 10:00–18:00 UK');

-- =====================================================================
-- C · outside the window, and D · without a usable link: nothing
-- =====================================================================
select is(invite_roster_reminders(timestamptz '2026-10-14 09:59+01', :'link') ->> 'skipped',
  'outside 10:00–18:00 UK', 'before 10:00 UK: skipped');
select is(invite_roster_reminders(timestamptz '2026-10-14 18:00+01', :'link') ->> 'skipped',
  'outside 10:00–18:00 UK', 'from 18:00 UK: skipped');
select alike(invite_roster_reminders(:'day1', null) ->> 'skipped', 'no apply link%',
  'no STAFF_APP_URL: skipped');
select alike(invite_roster_reminders(:'day1', 'https://evil.test/login') ->> 'skipped', 'no apply link%',
  'a link to anything but /apply: skipped');
select alike(invite_roster_reminders(:'day1', 'javascript:alert(1)//apply') ->> 'skipped', 'no apply link%',
  'a link that is not https: skipped');
select is((select count(*)::int from notification_outbox where template = 'IR1'), 0,
  'nothing was queued by any of those');

-- =====================================================================
-- B · day one: who is reminded
-- =====================================================================
select is((invite_roster_reminders(:'day1', :'link') ->> 'ir1')::int, 3,
  'day one: three reminders queued');
select is(
  (select array_agg(recipient_emails[1] order by recipient_emails[1]) from notification_outbox where template = 'IR1'),
  array['gone@ir1.test', 'ivy@ir1.test', 'nona@ir1.test'],
  'Ivy, the row with no name, and Gus (his removed record does not count as applying)');
select ok(not exists (select 1 from notification_outbox where template = 'IR1' and 'spud@ir1.test' = any (recipient_emails)),
  'a SpudBros row is not reminded');
select ok(not exists (select 1 from notification_outbox where template = 'IR1' and 'here@ir1.test' = any (recipient_emails)),
  'somebody who applied with the listed email is not, whatever the case or spaces');
select is(
  (select key from notification_outbox where template = 'IR1' and recipient_emails = array['ivy@ir1.test']),
  'IR1:roster:' || (select id from invite_roster where email = 'ivy@ir1.test') || ':2026-10-14',
  'keyed on the list row and the UK day');
select is(
  (select payload - 'at' from notification_outbox where template = 'IR1' and recipient_emails = array['ivy@ir1.test']),
  jsonb_build_object('variant', 'named', 'name', 'Ivy', 'applyLink', :'link', 'day', '2026-10-14'),
  'named wording, the first name, and the apply link');
select is(
  (select payload ->> 'variant' from notification_outbox where template = 'IR1' and recipient_emails = array['nona@ir1.test']),
  'unnamed', 'a row with no first name gets the unnamed wording');
select ok(
  (select bool_and(channel = 'email' and recipient_staff_id is null) from notification_outbox where template = 'IR1'),
  'an email to the listed address, with no staff record behind it');

-- =====================================================================
-- C · once a UK day
-- =====================================================================
select is((invite_roster_reminders(timestamptz '2026-10-14 17:07+01', :'link') ->> 'ir1')::int, 0,
  'later the same day: nothing more');
select is((invite_roster_reminders(timestamptz '2026-10-15 10:07+01', :'link') ->> 'ir1')::int, 3,
  'the next day: one each again');

-- They apply: the row is consumed, and the reminders stop.
delete from invite_roster where email = 'ivy@ir1.test';
select is((invite_roster_reminders(timestamptz '2026-10-16 10:07+01', :'link') ->> 'ir1')::int, 2,
  'once Ivy has applied (her row consumed), she is not reminded');
select ok(not exists (select 1 from notification_outbox
                       where template = 'IR1' and recipient_emails = array['ivy@ir1.test']
                         and payload ->> 'day' = '2026-10-16'),
  'and it is Ivy who dropped out');

-- The clocks go back on 25 October: 10:07 UK is 10:07Z, and still day one of the 26th.
select is((invite_roster_reminders(timestamptz '2026-10-26 10:07Z', :'link') ->> 'day'),
  '2026-10-26', 'the day is the UK calendar day, across the clock change');

-- The switch.
update settings set value = '{"enabled": false}' where key = 'invite_roster_reminders';
select is(invite_roster_reminders(timestamptz '2026-10-27 10:07Z', :'link') ->> 'skipped',
  'disabled in settings.invite_roster_reminders', 'switched off: nothing is queued');

select * from finish();
rollback;
