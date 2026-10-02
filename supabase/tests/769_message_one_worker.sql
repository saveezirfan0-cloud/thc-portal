-- =====================================================================
-- 769 · Message one worker from their profile (ADR-0081)
--   20261002109000_message_one_worker.sql
--
--   1. Who may call it: admin only — not anon, a worker, a client or a
--      read-only viewer.
--   2. One OM2 push to that worker, whatever they are booked on, with the
--      register's payload keys, a key of its own per message, and the
--      "notifications off" answer.
--   3. Refusals: no text, too long, a removed worker, an unknown id. None
--      of them queues anything.
--   4. audit_log: staff.message_sent on the worker; GDPR removal drops the
--      text and keeps the row.
-- =====================================================================
begin;
select plan(19);
\ir _shared/fixtures.psql

\set w1     '76930000-0000-4000-8000-000000000001'
\set w2     '76930000-0000-4000-8000-000000000002'
\set w3     '76930000-0000-4000-8000-000000000003'
\set viewer '76940000-0000-4000-8000-000000000001'

insert into staff (id, first_name, last_name, email, phone, dob, status) values
  (:'w1', 'Push',  'On',    'w1@om769.test', '+447700969001', date '1995-01-01', 'compliant'),
  (:'w2', 'Push',  'Off',   'w2@om769.test', '+447700969002', date '1995-01-01', 'compliant'),
  (:'w3', 'Gone',  'Soon',  'w3@om769.test', '+447700969003', date '1995-01-01', 'compliant');

-- Only w1 has notifications on. Nobody here is booked on anything.
insert into push_subscriptions (staff_id, endpoint, p256dh, auth) values
  (:'w1', 'https://push.example.test/om769-w1', 'p256dh', 'auth');

-- A read-only Back Office login (ADR-0060).
insert into auth.users (id, email) values (:'viewer', 'viewer.769@rls.test');
insert into profiles (id, role, office_role, full_name) values (:'viewer', 'admin', 'viewer', 'Vera Viewer');

-- ---------------------------------------------------------------------
-- 1 · Who may call it
-- ---------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.send_staff_message(uuid, text)', 'execute'),
  'anon cannot execute send_staff_message');
select ok(not has_function_privilege('authenticated', 'public.staff_removed_scrub_messages()', 'execute'),
  'the removal trigger function is not an RPC');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select send_staff_message(%L, 'hi') $$, :'w1'), '42501', 'not_authorised',
  'a worker cannot message another worker');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select send_staff_message(%L, 'hi') $$, :'w1'), '42501', 'not_authorised',
  'nor can a client');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select send_staff_message(%L, 'hi') $$, :'w1'), '42501', 'read_only',
  'nor can a view-only Back Office login (ADR-0060)');
reset role;

-- ---------------------------------------------------------------------
-- 2 · One push to that worker
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(send_staff_message(:'w1', '  Please call the office about Saturday {not a placeholder}  ') - 'messageId',
  jsonb_build_object('ok', true, 'sent', 1, 'withoutPush', '[]'::jsonb),
  'a worker on no event is messaged; with notifications on, nobody to phone');
select is(send_staff_message(:'w2', 'Your uniform is ready to collect') - 'messageId',
  jsonb_build_object('ok', true, 'sent', 1, 'withoutPush', jsonb_build_array('Push Off')),
  'a worker with notifications off is named, so the manager can phone them');

reset role;
select results_eq(
  $$ select recipient_staff_id::text, channel::text, payload ->> 'message'
       from notification_outbox where template = 'OM2' order by payload ->> 'message' $$,
  $$ values ('76930000-0000-4000-8000-000000000001', 'push', 'Please call the office about Saturday {not a placeholder}'),
            ('76930000-0000-4000-8000-000000000002', 'push', 'Your uniform is ready to collect') $$,
  'one OM2 push each, to that worker only, with the words trimmed and braces kept');
select is(
  (select array_agg(distinct k order by k) from notification_outbox, jsonb_object_keys(payload) k where template = 'OM2'),
  array['message', 'messageId'],
  'the payload carries exactly the keys the OM2 register entry asks for');
select ok(
  (select bool_and(key = 'OM2:' || (payload ->> 'messageId')) from notification_outbox where template = 'OM2'),
  'each message has a key of its own');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((send_staff_message(:'w1', 'Same words twice') ->> 'sent')::int, 1, 'a second message is sent');
select is((send_staff_message(:'w1', 'Same words twice') ->> 'sent')::int, 1, 'and so is a repeat of it');

-- ---------------------------------------------------------------------
-- 3 · Refusals
-- ---------------------------------------------------------------------
select is(send_staff_message(:'w1', '   '),
  jsonb_build_object('ok', false, 'reason', 'message_required'), 'an empty message is refused');
select is(send_staff_message(:'w1', repeat('é', 301)),
  jsonb_build_object('ok', false, 'reason', 'message_too_long'), 'so is one over 300 characters');
select throws_ok(format($$ select send_staff_message(%L, 'hi') $$, '76930000-0000-4000-8000-0000000000ff'),
  'P0002', 'staff_not_found', 'an unknown worker is an error');
reset role;

-- ---------------------------------------------------------------------
-- 4 · audit_log, and GDPR removal (§1.7)
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((send_staff_message(:'w3', 'Your P45 is on its way') ->> 'ok')::boolean, true,
  'w3 is messaged before they are removed');
reset role;

select lives_ok(format($$ select remove_worker(%L) $$, :'w3'), 'the office removes w3 (§1.7)');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(send_staff_message(:'w3', 'hi'),
  jsonb_build_object('ok', false, 'reason', 'staff_removed'), 'a removed worker cannot be messaged');
reset role;

select results_eq(
  $$ select entity_id::text, actor::text, data ? 'message', (data ->> 'sent')::int
       from audit_log where action = 'staff.message_sent' and entity_id = '76930000-0000-4000-8000-000000000003' $$,
  $$ values ('76930000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111', false, 1) $$,
  'the removed worker''s message keeps who sent it, and loses what it said');

select * from finish();
rollback;
