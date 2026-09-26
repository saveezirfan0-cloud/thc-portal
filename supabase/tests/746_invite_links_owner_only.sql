-- =====================================================================
-- 746 · E11 set-up links: owners only, and gone once sent (20260930210600)
--
-- The QA review of ADR-0049…0038 found a manager or scheduler could read
-- an E11 row's `payload.link` from notification_outbox (admin_read) and
-- take over a login an owner had just invited. This pins the fence and
-- the redaction, and that every other outbox row still reads as before.
-- =====================================================================
begin;
select plan(9);
\ir _shared/fixtures.psql

insert into notification_outbox (key, channel, template, recipient_emails, payload) values
  ('E11:invite:657:1', 'email', 'E11', array['new@rls.test'],
   jsonb_build_object('app', 'Back Office', 'name', 'New', 'link', 'http://127.0.0.1:3000/auth/invite?token=' || repeat('a', 56))),
  ('E5:657:probe', 'email', 'E5', array['office@rls.test'], '{"staffName":"Staff Alpha"}');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

-- The fixture admin is an owner (20260930210100's insert trigger).
select is((select count(*)::int from notification_outbox where key = 'E11:invite:657:1'), 1,
  'an owner reads the E11 row');
select ok((select payload ? 'link' from notification_outbox where key = 'E11:invite:657:1'),
  'with its link, which the owner just issued');

reset role;
update profiles set office_role = 'manager' where id = :'admin_uid';
set local role authenticated;
select is((select count(*)::int from notification_outbox where key = 'E11:invite:657:1'), 0,
  'a manager cannot read an E11 row at all');
select is((select count(*)::int from notification_outbox where key = 'E5:657:probe'), 1,
  'but still reads every other outbox row (the Inbox)');

reset role;
update profiles set office_role = 'scheduler' where id = :'admin_uid';
set local role authenticated;
select is((select count(*)::int from notification_outbox where template = 'E11'), 0,
  'a scheduler cannot read any E11 row');
reset role;

-- A worker and a client were never able to read the outbox; still not.
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from notification_outbox), 0, 'a worker reads no outbox rows');
reset role;

-- Redaction: sending (the drain, on the service key) removes the link.
update notification_outbox set sent_at = now() where key = 'E11:invite:657:1';
select is((select payload ? 'link' from notification_outbox where key = 'E11:invite:657:1'), false,
  'once sent, the E11 row no longer carries the link');
select is((select payload ->> 'linkRedacted' from notification_outbox where key = 'E11:invite:657:1'), 'true',
  'and says it was removed');
update notification_outbox set failed_at = now() where key = 'E5:657:probe';
select is((select payload ->> 'staffName' from notification_outbox where key = 'E5:657:probe'), 'Staff Alpha',
  'other templates keep their payload when they finish');

select * from finish();
rollback;
