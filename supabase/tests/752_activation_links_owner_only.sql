-- =====================================================================
-- 752 · E3 activation links: owners only, and gone once sent
--       (20260930220200, ADR-0054)
--
-- An E3 row's `payload.link` is a worker's one-time /activate link; whoever
-- holds it sets that worker's password. Before this, every Back Office
-- login could read it through notification_outbox's admin_read. This pins
-- the fence (as 746 does for E11), the redaction, and that every other row
-- — and an unsent E3's link, which the drain still needs — is unchanged.
-- =====================================================================
begin;
select plan(17);
\ir _shared/fixtures.psql

\set manager   '75200000-0000-4000-8000-000000000001'
\set scheduler '75200000-0000-4000-8000-000000000002'
\set viewer    '75200000-0000-4000-8000-000000000003'

insert into auth.users (id, email) values
  (:'manager',   'manager.752@rls.test'),
  (:'scheduler', 'scheduler.752@rls.test'),
  (:'viewer',    'viewer.752@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'manager',   'admin', 'manager',   'Mona Manager'),
  (:'scheduler', 'admin', 'scheduler', 'Sam Scheduler'),
  (:'viewer',    'admin', 'viewer',    'Vera Viewer');

insert into notification_outbox (key, channel, template, recipient_emails, payload) values
  ('E3:staff:752:1', 'email', 'E3', array['candidate@rls.test'],
   jsonb_build_object('link', 'https://staff.test/activate/' || repeat('b', 40),
                      'installLink', 'https://staff.test/install', 'name', 'Cara')),
  ('E3:resend:752:1', 'email', 'E3', array['candidate@rls.test'],
   jsonb_build_object('link', 'https://staff.test/activate/' || repeat('c', 40),
                      'installLink', 'https://staff.test/install', 'name', 'Cara')),
  ('E11:invite:752:1', 'email', 'E11', array['new@rls.test'],
   jsonb_build_object('app', 'Back Office', 'name', 'New', 'link', 'http://127.0.0.1:3000/auth/invite?token=' || repeat('a', 56))),
  ('E5:752:probe', 'email', 'E5', array['office@rls.test'], '{"staffName":"Staff Alpha"}');

select policy_roles_are('public', 'notification_outbox', 'office_activation_links', array['authenticated'],
  'the E3 fence applies to signed-in sessions');
select ok((select not polpermissive and polcmd = 'r' from pg_policy
            where polrelid = 'notification_outbox'::regclass and polname = 'office_activation_links'),
  'and is a RESTRICTIVE select policy: it narrows admin_read, grants nothing');

-- ---------------------------------------------------------------------
-- 1 · Who reads E3
-- ---------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select count(*)::int from notification_outbox where template = 'E3' and key like 'E3:%:752:%'), 2,
  'an owner reads E3 rows');

set local "request.jwt.claims" = '{"sub":"75200000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::int from notification_outbox where template = 'E3'), 0,
  'a manager cannot read an E3 row at all');
select is((select count(*)::int from notification_outbox where key = 'E5:752:probe'), 1,
  'but still reads the office emails (the Inbox)');

set local "request.jwt.claims" = '{"sub":"75200000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from notification_outbox where template = 'E3'), 0,
  'a scheduler cannot (they run Onboarding, which queues E3 through definer RPCs and never reads it)');
select is((select count(*)::int from notification_outbox where template = 'E11'), 0,
  'nor E11, as before (746)');

set local "request.jwt.claims" = '{"sub":"75200000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*)::int from notification_outbox where template = 'E3'), 0,
  'a viewer cannot');
select is((select count(*)::int from notification_outbox where key = 'RLS:fixture:outbox'), 1,
  'and reads the rest');

set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select is((select count(*)::int from notification_outbox), 0, 'a worker reads no outbox rows (unchanged)');
set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*)::int from notification_outbox), 0, 'nor a client');
reset role;

-- ---------------------------------------------------------------------
-- 2 · Redaction
-- ---------------------------------------------------------------------
select ok((select payload ? 'link' from notification_outbox where key = 'E3:staff:752:1'),
  'an unsent E3 keeps its link — the drain sends it, and a resend points it at the newest token');

update notification_outbox set sent_at = now() where key = 'E3:staff:752:1';
select is((select payload ? 'link' from notification_outbox where key = 'E3:staff:752:1'), false,
  'once sent, the E3 row no longer carries the activation link');
select is((select array[payload ->> 'linkRedacted', payload ->> 'installLink', payload ->> 'name']
             from notification_outbox where key = 'E3:staff:752:1'),
          array['true', 'https://staff.test/install', 'Cara'],
  'it says so, and keeps what is not a secret (the install page, the name)');

update notification_outbox set failed_at = now(), error = 'bounced' where key = 'E3:resend:752:1';
select is((select payload ? 'link' from notification_outbox where key = 'E3:resend:752:1'), false,
  'a failed E3 loses its link too');

update notification_outbox set sent_at = now() where key = 'E11:invite:752:1';
select is((select payload ->> 'linkRedacted' from notification_outbox where key = 'E11:invite:752:1'), 'true',
  'E11 is still redacted by the same trigger (20260930210600 unchanged)');
update notification_outbox set sent_at = now() where key = 'E5:752:probe';
select is((select payload ->> 'staffName' from notification_outbox where key = 'E5:752:probe'), 'Staff Alpha',
  'other templates keep their payload');

select * from finish();
rollback;
