-- =====================================================================
-- 310 · The office's write path into notification_outbox (§8)
--
-- N10b and N12 are mandatory (§8); N11 is required by §3.5 without being
-- unmutable. All three were silently going nowhere: the server actions
-- insert into `notification_outbox` as the signed-in manager, and that
-- table carries exactly one policy — `admin_read`, SELECT only. The Data
-- API roles DO hold table privileges on it (Supabase grants those by
-- default), so the write is not refused for want of a GRANT: it reaches
-- RLS, finds no INSERT policy, and is rejected with "new row violates
-- row-level security policy". The manager can read the outbox and cannot
-- write it, which is exactly the intent — and exactly what the code did
-- not expect.
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
select plan(19);

\set mgr_uid  'd1d1d1d1-0000-4000-8000-000000000001'
\set wrk_uid  'd1d1d1d1-0000-4000-8000-000000000002'
\set wrk      'd2d2d2d2-0000-4000-8000-000000000001'

insert into auth.users (id, email) values
  (:'mgr_uid', 'queue-mgr@office.test'), (:'wrk_uid', 'queue-wrk@office.test');
insert into auth.users (id, email) values
  ('d1d1d1d1-0000-4000-8000-000000000003', 'queue-client@office.test');
insert into clients (id, name, contact_name, phone, staff_contact_point, contact_emails)
values ('d3d3d3d3-0000-4000-8000-000000000001', 'Queue Fixture Client', 'Cara', '+447700900402',
        'Front desk', array['queue-client@office.test']);
insert into profiles (id, role, full_name, client_id) values
  (:'mgr_uid', 'admin', 'Queue Fixture Manager', null),
  ('d1d1d1d1-0000-4000-8000-000000000003', 'client', 'Queue Fixture Client User',
   'd3d3d3d3-0000-4000-8000-000000000001');
insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, rtw_branch)
values (:'wrk', :'wrk_uid', 'Queue', 'Worker', 'queue-wrk@office.test', '+447700900401',
        date '1995-06-01', 'compliant', 'uk_irish');

-- ---------------------------------------------------------------------
-- 1. The policy set, which is the thing that must not move.
--
--    Asserted as POLICY rather than as privilege: the Data API roles hold
--    table grants on everything in `public` by Supabase default, so
--    `has_table_privilege` says `true` here and says nothing useful. What
--    stops the write is the absence of an INSERT policy. The behavioural
--    proof is in section 2, under the role that actually does it.
-- ---------------------------------------------------------------------
select bag_eq(
  $$ select p.polname::text || ':' || p.polcmd::text
       from pg_policy p where p.polrelid = 'notification_outbox'::regclass $$,
  $$ values ('admin_read:r'::text), ('office_users_invite_links:r') $$,
  'and the fix did NOT add an insert policy: the table carries admin_read and, since 20260930170000, the restrictive E11 read fence — both select only');

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

-- THE DEFECT, reproduced. This is what both server actions used to do.
select throws_ok(
  $$ insert into notification_outbox (key, channel, template, payload)
     values ('N12:direct-insert', 'push', 'N12', '{}'::jsonb) $$,
  '42501',
  'new row violates row-level security policy for table "notification_outbox"',
  'an admin inserting straight into the outbox is rejected by RLS — this is the write the event board made on every cancel');

-- And it is only the WRITE. The manager can read their own send queue, so
-- nothing about this looks broken from the outside.
select lives_ok(
  $$ select count(*) from notification_outbox $$,
  'the same admin can READ it (admin_read), which is why the failure was invisible');

select is(
  queue_office_notifications(jsonb_build_array(jsonb_build_object(
    'key', 'N12:booking:queue-fixture-1', 'channel', 'push', 'template', 'N12',
    'recipient_staff_id', 'd2d2d2d2-0000-4000-8000-000000000001',
    'payload', jsonb_build_object('title', 'This event has been cancelled')))),
  1, '§3.3: but through the RPC the office queues N12 for a worker whose event it just cancelled');

-- The idempotency key: pressing Cancel event twice must not send twice.
select is(
  queue_office_notifications(jsonb_build_array(jsonb_build_object(
    'key', 'N12:booking:queue-fixture-1', 'channel', 'push', 'template', 'N12',
    'recipient_staff_id', 'd2d2d2d2-0000-4000-8000-000000000001'))),
  0, 'a repeat press queues nothing: the unique key is what makes the action safe to re-run (§8)');

-- A batch, which is what N11 sends — one row per confirmed worker.
select is(
  queue_office_notifications(jsonb_build_array(
    jsonb_build_object('key', 'N11:booking:queue-a', 'channel', 'push', 'template', 'N11',
                       'recipient_staff_id', 'd2d2d2d2-0000-4000-8000-000000000001',
                       'payload', jsonb_build_object('window', '11:00 – 00:30 (UK)', 'bookingId', 'b1')),
    jsonb_build_object('key', 'N11:booking:queue-b', 'channel', 'push', 'template', 'N11',
                       'recipient_staff_id', 'd2d2d2d2-0000-4000-8000-000000000001',
                       'payload', jsonb_build_object('window', '11:00 – 00:30 (UK)', 'bookingId', 'b2')))),
  2, '§3.5: a time change queues one row per confirmed worker in a single call');

-- Still the manager: these prove VALIDATION, and would prove nothing run as
-- a worker, who is refused by the authorisation check long before reaching
-- it. Malformed rows RAISE rather than being skipped — a silently dropped
-- notification is the defect this whole migration exists to end.
select throws_ok(
  $$ select queue_office_notifications('{"key":"x"}'::jsonb) $$,
  '22023', 'rows_must_be_an_array', 'a non-array is refused outright');
select throws_ok(
  $$ select queue_office_notifications(jsonb_build_array(jsonb_build_object(
       'channel', 'push', 'template', 'N12',
       'recipient_staff_id', 'd2d2d2d2-0000-4000-8000-000000000001'))) $$,
  '22023', 'every row needs key, template, channel push and recipient_staff_id',
  'a row with no idempotency key is refused, not quietly dropped');
select throws_ok(
  $$ select queue_office_notifications(jsonb_build_array(jsonb_build_object(
       'key', 'E9:forged', 'channel', 'email', 'template', 'E9',
       'recipient_staff_id', 'd2d2d2d2-0000-4000-8000-000000000001'))) $$,
  '22023', 'every row needs key, template, channel push and recipient_staff_id',
  'and the office cannot queue EMAIL through this door: §8 mail has named recipients, not caller-supplied ones');
select throws_ok(
  $$ select queue_office_notifications(jsonb_build_array(jsonb_build_object(
       'key', 'N12:noone', 'channel', 'push', 'template', 'N12'))) $$,
  '22023', 'every row needs key, template, channel push and recipient_staff_id',
  'nor a push addressed to nobody, which the drain could only throw UnsendableRow on');

-- Same role, a worker's JWT: the grant is to `authenticated`, so the gate
-- has to be the admin check inside, not the grant.
set local "request.jwt.claims" = '{"sub":"d1d1d1d1-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ select queue_office_notifications(jsonb_build_array(jsonb_build_object(
       'key', 'N12:forged', 'channel', 'push', 'template', 'N12',
       'recipient_staff_id', 'd2d2d2d2-0000-4000-8000-000000000001'))) $$,
  '42501', 'not_authorised',
  'a signed-in WORKER cannot queue a push, though it holds the same grant the office does');

-- A CLIENT is `authenticated` too, and is the leak-sensitive role (§11.1).
set local "request.jwt.claims" = '{"sub":"d1d1d1d1-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(
  $$ select queue_office_notifications(jsonb_build_array(jsonb_build_object(
       'key', 'N12:client-forged', 'channel', 'push', 'template', 'N12',
       'recipient_staff_id', 'd2d2d2d2-0000-4000-8000-000000000001'))) $$,
  '42501', 'not_authorised',
  'a signed-in CLIENT cannot queue a push to a worker either (§11.1: the portal reaches no worker data)');

-- Nor can the office mark a queued push as already sent: there is no
-- UPDATE policy, so the row is not visible to update and nothing changes.
-- No error — which is the quiet half of the same shape.
with touched as (
  update notification_outbox set sent_at = now()
   where key = 'N12:booking:queue-fixture-1' returning 1
)
select is((select count(*)::int from touched), 0,
  'an admin cannot mark a push sent: an updatable sent_at is a send anybody can suppress (§8)');

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

select is(
  (select payload ->> 'window' from notification_outbox where key = 'N11:booking:queue-a'),
  '11:00 – 00:30 (UK)',
  'payload is a VALUES map: it carries the worker''s own role window (RULE-18, §1.8), which §8''s N11 copy renders as {window} — not a rendered body');
select is_empty(
  $$ select 1 from notification_outbox
      where key like 'N11:booking:queue-%' and payload ? 'body' $$,
  'and carries no pre-rendered body, which the drain would ignore anyway');

select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'queue_office_notifications'
        and has_function_privilege('anon', p.oid, 'execute') $$,
  'anon cannot execute it at all — revoked by name, not only from PUBLIC (docs/14 O7)');

select * from finish();
rollback;
