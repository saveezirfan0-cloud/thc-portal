-- =====================================================================
-- 310 · The office's write path into notification_outbox (§8)
--
-- N11, N10b and N12 are all mandatory (§8) and all three were silently
-- going nowhere: the server actions insert into `notification_outbox` as
-- the signed-in manager, and that table is admin_read, SELECT only, with
-- no table privilege for `authenticated` at all.
--
-- What this pins:
--   1. The hole itself, so a future change cannot quietly reopen it by
--      handing the table back to the `authenticated` role.
--   2. That the office CAN queue through the definer function.
--   3. That a worker and an anonymous caller cannot.
--   4. That the idempotency key still does its job, because that is what
--      stops a double-pressed Cancel event queueing two pushes.
--   5. That 001_rls_guard's policy set is untouched — the fix must not be
--      "give admin an insert policy".
-- =====================================================================
begin;
select plan(12);

\set mgr_uid  'd1d1d1d1-0000-4000-8000-000000000001'
\set wrk_uid  'd1d1d1d1-0000-4000-8000-000000000002'
\set wrk      'd2d2d2d2-0000-4000-8000-000000000001'

insert into auth.users (id, email) values
  (:'mgr_uid', 'queue-mgr@office.test'), (:'wrk_uid', 'queue-wrk@office.test');
insert into profiles (id, role, full_name) values (:'mgr_uid', 'admin', 'Queue Fixture Manager');
insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, rtw_branch)
values (:'wrk', :'wrk_uid', 'Queue', 'Worker', 'queue-wrk@office.test', '+447700900401',
        date '1995-06-01', 'compliant', 'uk_irish');

-- ---------------------------------------------------------------------
-- 1. The table itself is still closed, which is the reason the function
--    has to exist. Asserted as privilege, not policy: `authenticated` has
--    no GRANT here, so RLS never even gets a say.
-- ---------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'notification_outbox', 'insert'),
  'a signed-in account cannot insert into notification_outbox directly — the event board tried and was refused');
select ok(not has_table_privilege('anon', 'notification_outbox', 'insert'),
  'nor can an anonymous one: a row anybody can insert is a notification anybody can send');
select ok(not has_table_privilege('authenticated', 'notification_outbox', 'update'),
  'nor update it, because an updatable sent_at is a send anybody can suppress');

select bag_eq(
  $$ select p.polname::text || ':' || p.polcmd::text
       from pg_policy p where p.polrelid = 'notification_outbox'::regclass $$,
  $$ values ('admin_read:r'::text) $$,
  'and the fix did NOT add an insert policy: the table still carries exactly admin_read, select only');

-- ---------------------------------------------------------------------
-- 2. The office's door, exercised as the role PostgREST actually uses.
--
-- `set local role authenticated` matters and is not decoration. pgTAP runs
-- as the table OWNER, which bypasses RLS and holds every grant — so a test
-- that only sets the JWT proves the admin check inside the function and
-- says nothing about whether PostgREST's role can reach it. That is exactly
-- the gap that let the original bug merge: the insert looked fine
-- everywhere except where it ran.
--
-- Note what this role CANNOT do below: read back what it just queued. That
-- is the table being closed, working as intended — the verification reads
-- are done after `reset role`.
-- ---------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"d1d1d1d1-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  queue_office_notifications(jsonb_build_array(jsonb_build_object(
    'key', 'N12:booking:queue-fixture-1', 'channel', 'push', 'template', 'N12',
    'recipient_staff_id', 'd2d2d2d2-0000-4000-8000-000000000001',
    'payload', jsonb_build_object('title', 'This event has been cancelled')))),
  1, '§3.3: the office queues N12 for a worker whose event it just cancelled');

-- The idempotency key: pressing Cancel event twice must not send twice.
select is(
  queue_office_notifications(jsonb_build_array(jsonb_build_object(
    'key', 'N12:booking:queue-fixture-1', 'channel', 'push', 'template', 'N12'))),
  0, 'a repeat press queues nothing: the unique key is what makes the action safe to re-run (§8)');

-- A batch, which is what N11 sends — one row per confirmed worker.
select is(
  queue_office_notifications(jsonb_build_array(
    jsonb_build_object('key', 'N11:booking:queue-a', 'channel', 'push', 'template', 'N11'),
    jsonb_build_object('key', 'N11:booking:queue-b', 'channel', 'push', 'template', 'N11'))),
  2, '§3.5: a time change queues one row per confirmed worker in a single call');

-- Same role, a worker's JWT: the grant is to `authenticated`, so the gate
-- has to be the admin check inside, not the grant.
set local "request.jwt.claims" = '{"sub":"d1d1d1d1-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ select queue_office_notifications(jsonb_build_array(jsonb_build_object(
       'key', 'N12:forged', 'channel', 'push', 'template', 'N12'))) $$,
  '42501', 'not_authorised',
  'a signed-in WORKER cannot queue a push, though it holds the same grant the office does');

reset role;

-- ---------------------------------------------------------------------
-- 3. What actually landed, read back as the owner.
-- ---------------------------------------------------------------------
select is(
  (select template from notification_outbox where key = 'N12:booking:queue-fixture-1'),
  'N12', 'the row is there, with the template the §8 register named');
select is(
  (select recipient_staff_id from notification_outbox where key = 'N12:booking:queue-fixture-1'),
  'd2d2d2d2-0000-4000-8000-000000000001'::uuid,
  'addressed to the worker, so the drain knows whose device to reach');
select is(
  (select count(*)::int from notification_outbox where key like 'N11:booking:queue-%'),
  2, 'and both N11 rows landed, not one');

select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'queue_office_notifications'
        and has_function_privilege('anon', p.oid, 'execute') $$,
  'anon cannot execute it at all — revoked by name, not only from PUBLIC (docs/14 O7)');

select * from finish();
rollback;
