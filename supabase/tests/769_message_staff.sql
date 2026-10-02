-- =====================================================================
-- 769 · Message hand-picked workers (ADR-0081)
--   20261002109000_message_staff.sql
--
--   1. Who may call it: admin only — not anon, a worker, a client or a
--      read-only viewer.
--   2. One OM2 push per worker on the list, whatever they are booked on,
--      each once, with the register's payload keys, a key per message and
--      worker, and the "notifications off" names.
--   3. Refusals: no text, too long, nobody, over 200, a removed worker,
--      an unknown id. None of them queues anything.
--   4. audit_log: staff.message_sent on each worker; GDPR removal drops
--      the text from the removed worker's row only.
-- =====================================================================
begin;
select plan(26);
\ir _shared/fixtures.psql

\set w1     '76930000-0000-4000-8000-000000000001'
\set w2     '76930000-0000-4000-8000-000000000002'
\set w3     '76930000-0000-4000-8000-000000000003'
\set w4     '76930000-0000-4000-8000-000000000004'
\set w5     '76930000-0000-4000-8000-000000000005'
\set w6     '76930000-0000-4000-8000-000000000006'
\set viewer '76940000-0000-4000-8000-000000000001'

insert into staff (id, first_name, last_name, email, phone, dob, status) values
  (:'w1', 'Push',  'On',    'w1@om769.test', '+447700969001', date '1995-01-01', 'compliant'),
  (:'w2', 'Push',  'Off',   'w2@om769.test', '+447700969002', date '1995-01-01', 'compliant'),
  (:'w3', 'Gone',  'Soon',  'w3@om769.test', '+447700969003', date '1995-01-01', 'compliant'),
  (:'w4', 'Also',  'Off',   'w4@om769.test', '+447700969004', date '1995-01-01', 'inactive'),
  (:'w5', 'Is',    'Blocked', 'w5@om769.test', '+447700969005', date '1995-01-01', 'blocked'),
  (:'w6', 'Still', 'Joining', 'w6@om769.test', '+447700969006', date '1995-01-01', 'documents');

-- Only w1 has notifications on. Nobody here is booked on anything.
insert into push_subscriptions (staff_id, endpoint, p256dh, auth) values
  (:'w1', 'https://push.example.test/om769-w1', 'p256dh', 'auth');

-- A read-only Back Office login (ADR-0060).
insert into auth.users (id, email) values (:'viewer', 'viewer.769@rls.test');
insert into profiles (id, role, office_role, full_name) values (:'viewer', 'admin', 'viewer', 'Vera Viewer');

-- ---------------------------------------------------------------------
-- 1 · Who may call it
-- ---------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.send_staff_message(uuid[], text)', 'execute'),
  'anon cannot execute send_staff_message');
select ok(not has_function_privilege('authenticated', 'public.staff_removed_scrub_messages()', 'execute'),
  'the removal trigger function is not an RPC');
select matches(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
    where t.tgrelid = 'public.staff'::regclass and t.tgname = 'staff_removed_scrub_messages'),
  'AFTER UPDATE OF removed_at ON public\.staff FOR EACH ROW WHEN \(\(\(old\.removed_at IS NULL\) AND \(new\.removed_at IS NOT NULL\)\)\)',
  'the scrub fires after update of removed_at, once — when removed_at is first set');
select ok(
  (select p.prosecdef from pg_proc p where p.oid = 'public.staff_removed_scrub_messages()'::regprocedure),
  'and runs as its owner, so a manager''s removal reaches audit_log');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select send_staff_message(array[%L]::uuid[], 'hi') $$, :'w1'), '42501', 'not_authorised',
  'a worker cannot message other workers');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select send_staff_message(array[%L]::uuid[], 'hi') $$, :'w1'), '42501', 'not_authorised',
  'nor can a client');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select send_staff_message(array[%L]::uuid[], 'hi') $$, :'w1'), '42501', 'read_only',
  'nor can a view-only Back Office login (ADR-0060)');
reset role;

-- ---------------------------------------------------------------------
-- 2 · One push per worker on the list
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(send_staff_message(array[:'w1']::uuid[], '  Please call the office about Saturday {not a placeholder}  ') - 'messageId',
  jsonb_build_object('ok', true, 'sent', 1, 'withoutPush', '[]'::jsonb),
  'one worker on no event is messaged; with notifications on, nobody to phone');
select is(send_staff_message(array[:'w1', :'w2', :'w4', :'w2']::uuid[], 'Uniforms are ready to collect') - 'messageId',
  jsonb_build_object('ok', true, 'sent', 3, 'withoutPush', jsonb_build_array('Also Off', 'Push Off')),
  'three hand-picked workers, each once (w2 was ticked twice), a leaver among them; those with notifications off are named');

reset role;
select results_eq(
  $$ select recipient_staff_id::text, channel::text, payload ->> 'message'
       from notification_outbox where template = 'OM2' order by payload ->> 'message', recipient_staff_id $$,
  $$ values ('76930000-0000-4000-8000-000000000001', 'push', 'Please call the office about Saturday {not a placeholder}'),
            ('76930000-0000-4000-8000-000000000001', 'push', 'Uniforms are ready to collect'),
            ('76930000-0000-4000-8000-000000000002', 'push', 'Uniforms are ready to collect'),
            ('76930000-0000-4000-8000-000000000004', 'push', 'Uniforms are ready to collect') $$,
  'one OM2 push per worker, the words trimmed and braces kept');
select is(
  (select array_agg(distinct k order by k) from notification_outbox, jsonb_object_keys(payload) k where template = 'OM2'),
  array['message', 'messageId'],
  'the payload carries exactly the keys the OM2 register entry asks for');
select ok(
  (select bool_and(key = 'OM2:' || (payload ->> 'messageId') || ':' || recipient_staff_id) from notification_outbox where template = 'OM2'),
  'each row is keyed by its message and its worker');
select is(
  (select count(distinct payload ->> 'messageId')::int from notification_outbox
    where template = 'OM2' and payload ->> 'message' = 'Uniforms are ready to collect'), 1,
  'everyone in one send shares the message id');

-- ---------------------------------------------------------------------
-- 3 · Refusals
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(send_staff_message(array[:'w1']::uuid[], '   '),
  jsonb_build_object('ok', false, 'reason', 'message_required'), 'an empty message is refused');
select is(send_staff_message(array[:'w1']::uuid[], repeat('é', 301)),
  jsonb_build_object('ok', false, 'reason', 'message_too_long'), 'so is one over 300 characters');
select is(send_staff_message(array[]::uuid[], 'hi'),
  jsonb_build_object('ok', false, 'reason', 'nobody_to_message'), 'so is an empty list');
select is(send_staff_message(null, 'hi'),
  jsonb_build_object('ok', false, 'reason', 'nobody_to_message'), 'and no list at all');
select is(send_staff_message(array(select gen_random_uuid() from generate_series(1, 201)), 'hi'),
  jsonb_build_object('ok', false, 'reason', 'too_many_recipients'), 'over 200 is a broadcast, not a hand-picked list');
select throws_ok(format($$ select send_staff_message(array[%L, %L]::uuid[], 'hi') $$, :'w1', '76930000-0000-4000-8000-0000000000ff'),
  'P0002', 'staff_not_found', 'one unknown worker on the list fails the whole send');
reset role;
select is((select count(*)::int from notification_outbox where template = 'OM2'), 4,
  'and none of the refusals queued anything');

-- A blocked worker and a candidate still in the wizard can be told things too.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((send_staff_message(array[:'w5', :'w6']::uuid[], 'Please call the office') ->> 'sent')::int, 2,
  'a blocked worker and a candidate are messaged');
reset role;

-- ---------------------------------------------------------------------
-- 4 · audit_log, and GDPR removal (§1.7)
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((send_staff_message(array[:'w3', :'w1']::uuid[], 'Your P45 is on its way') ->> 'sent')::int, 2,
  'w3 and w1 are messaged before w3 is removed');
reset role;

select lives_ok(format($$ select remove_worker(%L) $$, :'w3'), 'the office removes w3 (§1.7)');
select is_empty(format($$ select 1 from notification_outbox
                           where recipient_staff_id = %L and payload ? 'message' $$, :'w3'),
  'remove_worker() leaves none of w3''s OM2 rows carrying the words');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(send_staff_message(array[:'w1', :'w3']::uuid[], 'hi'),
  jsonb_build_object('ok', false, 'reason', 'staff_removed'), 'a list with a removed worker on it is refused');
reset role;

select results_eq(
  $$ select entity_id::text, actor::text, data ? 'message', (data ->> 'recipients')::int
       from audit_log where action = 'staff.message_sent' and data ->> 'recipients' = '2'
        and entity_id in ('76930000-0000-4000-8000-000000000001', '76930000-0000-4000-8000-000000000003')
      order by entity_id $$,
  $$ values ('76930000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', true, 2),
            ('76930000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111', false, 2) $$,
  'one history row per worker; the removed worker''s loses the words, the other recipient''s keeps them');

select * from finish();
rollback;
