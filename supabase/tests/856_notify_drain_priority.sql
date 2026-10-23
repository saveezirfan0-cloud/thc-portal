-- =====================================================================
-- 856 · The drain claims urgent sends first, and hands back what it did
--       not start (ADR-0158)
--   20261019195000_notify_drain_priority.sql
--
-- The register's send classes live in packages/notifications/src/priority.ts.
-- The code list below is the register (TEMPLATES + the document emails);
-- packages/notifications/src/__tests__/priority.test.ts fails while it
-- differs from the register, and this file fails while the database's
-- mapping misses a code on it — so a new code cannot ship without a class.
-- =====================================================================
begin;
select plan(30);
\ir _shared/fixtures.psql

create temporary table t_register (code text primary key);
insert into t_register (code) select unnest(array[
  -- register-codes:begin
  'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N6b', 'N7', 'N8', 'N9', 'N9b', 'N13',
  'N10', 'N10b', 'N10d', 'N10e', 'N10c', 'N11', 'N11b', 'N12', 'N14', 'N15',
  'E1', 'E2', 'E2b', 'E3', 'E4', 'E5', 'E5b', 'E6', 'E7', 'E8', 'E9', 'E10',
  'E11', 'E12',
  'CL1', 'CL2', 'CL3', 'CL4', 'CL5', 'CL6',
  'RC1', 'RC2', 'RC3', 'RC5', 'RC4',
  'OF1', 'OF2', 'OF3', 'OF4', 'OF5', 'OF6',
  'CR1', 'CR2', 'CR3', 'OM1', 'OM2',
  'OC1', 'OC2', 'OC3', 'OC4', 'IR1',
  'CP1', 'CP2', 'CP3', 'DR1', 'SC1', 'TK1',
  'BG08', 'NS1', 'D1', 'D2', 'INV1'
  -- register-codes:end
]);

-- ---------------------------------------------------------------------
-- The mapping covers the register, and only the register.
-- ---------------------------------------------------------------------
select is_empty(
  $$ select code from t_register except select code from notification_priorities() $$,
  'every register code has a send class (add the new code to notification_priorities())');
select is_empty(
  $$ select code from notification_priorities() except select code from t_register $$,
  'and the mapping names no code the register does not have');
select is_empty(
  $$ select code from notification_priorities() group by code having count(*) > 1 $$,
  'one class per code');
select is_empty(
  $$ select code from notification_priorities() where priority not between 0 and 2 $$,
  'every class is 0 urgent, 1 normal or 2 bulk');

select is(notification_priority('N9'), 0::smallint, 'N9 "time to check in" is urgent');
select is(notification_priority('N6b'), 0::smallint, 'N6b "you have been released" is urgent');
select is(notification_priority('N5'), 0::smallint, 'N5 invitations are urgent');
select is(notification_priority('OC1'), 2::smallint, 'the OC1 chaser is bulk');
select is(notification_priority('IR1'), 2::smallint, 'the IR1 invite-list reminder is bulk');
select is(notification_priority('E3'), 1::smallint, 'E3 activation is normal');
select is(notification_priority('N99'), 1::smallint,
  'an unknown code is normal, so a row is never held for want of a class');

-- ---------------------------------------------------------------------
-- The column is set at insert, from the template, whatever the caller says.
-- ---------------------------------------------------------------------
select col_not_null('notification_outbox', 'priority', 'notification_outbox.priority is not null');
select has_trigger('notification_outbox', 'notification_outbox_set_priority',
  'a trigger sets it');

-- Keep everything already queued out of the claims below.
update notification_outbox set send_after = now() + interval '1 day'
 where sent_at is null and failed_at is null;

insert into notification_outbox (key, channel, template, recipient_emails, send_after, priority) values
  ('T856-OC1:1',  'email', 'OC1', array['a@example.com'], now() - interval '10 minutes', 0),
  ('T856-E3:2',   'email', 'E3',  array['b@example.com'], now() - interval '5 minutes', null),
  ('T856-N9:3',   'push',  'N9',  null,                   now() - interval '1 minute', 2),
  ('T856-N6b:4',  'push',  'N6b', null,                   now() - interval '2 minutes', 1);

select results_eq(
  $$ select key, priority from notification_outbox where key like 'T856-%' order by key $$,
  $$ values ('T856-E3:2', 1::smallint), ('T856-N6b:4', 0::smallint),
            ('T856-N9:3', 0::smallint), ('T856-OC1:1', 2::smallint) $$,
  'each row carries its code''s class — a caller''s own value (even null) is overridden');

update notification_outbox set template = 'N5' where key = 'T856-E3:2';
select is((select priority from notification_outbox where key = 'T856-E3:2'), 0::smallint,
  'a change of template re-derives it');
update notification_outbox set template = 'E3' where key = 'T856-E3:2';

-- ---------------------------------------------------------------------
-- The claim: priority first, oldest first within it.
-- ---------------------------------------------------------------------
select is((select key from claim_outbox_batch(1)), 'T856-N6b:4',
  'the oldest urgent row is claimed first, ahead of older normal and bulk rows');
select is((select key from claim_outbox_batch(1)), 'T856-N9:3', 'then the next urgent row');
select is((select key from claim_outbox_batch(1)), 'T856-E3:2', 'then normal');
select is((select key from claim_outbox_batch(1)), 'T856-OC1:1',
  'and bulk last, though it has waited longest');
select is((select count(*)::int from claim_outbox_batch(50) where key like 'T856-%'), 0,
  'a claimed row is leased: no second drain takes it');

select ok(
  (select pg_get_functiondef('public.claim_outbox_batch(integer, interval)'::regprocedure)
     ilike '%for update skip locked%'),
  'the claim still locks with skip locked');
select ok(
  (select indexdef ilike '%(priority, send_after, id)%'
              and indexdef ilike '%sent_at IS NULL%' and indexdef ilike '%failed_at IS NULL%'
     from pg_indexes where indexname = 'notification_outbox_claim_idx'),
  'a partial index over unsettled rows serves the claim order');

-- A switched-off code is still settled by the claim, not sent (20261002113000).
insert into notification_outbox (key, channel, template, recipient_emails, send_after)
values ('T856-IR1:5', 'email', 'IR1', array['c@example.com'], now() - interval '1 minute');
update settings set value = '{"IR1": false}'::jsonb where key = 'notification_switches';
select is((select count(*)::int from claim_outbox_batch(50) where key = 'T856-IR1:5'), 0,
  'a switched-off row is not claimed');
select is((select error from notification_outbox where key = 'T856-IR1:5'),
  'Not sent: switched off in Settings', 'it is settled as switched off, as before');
update settings set value = '{}'::jsonb where key = 'notification_switches';

-- ---------------------------------------------------------------------
-- release_outbox_claims: the run's budget ran out before these started.
-- ---------------------------------------------------------------------
update notification_outbox set error = 'Resend answered 500' where key = 'T856-OC1:1';
select lives_ok(
  $$ select complete_outbox_send((select id from notification_outbox where key = 'T856-N9:3'), true) $$,
  'one of the claimed rows is sent before the budget runs out');
select is(
  release_outbox_claims(array(select id from notification_outbox
                               where key in ('T856-OC1:1', 'T856-N9:3', 'T856-E3:2'))),
  2, 'two claims handed back; the row already sent is left alone');
select results_eq(
  $$ select attempts, send_after <= now(), error from notification_outbox
      where key = 'T856-OC1:1' $$,
  $$ values (0, true, 'Resend answered 500') $$,
  'a released row is due at once, its attempt refunded, its last error kept');
select isnt((select sent_at from notification_outbox where key = 'T856-N9:3'), null,
  'and the sent row is still sent');

-- ---------------------------------------------------------------------
-- Who may call it.
-- ---------------------------------------------------------------------
select is_empty(
  $$ select p.proname::text || ' is callable by ' || r.rolname
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       cross join (values ('anon'), ('authenticated')) as r(rolname)
      where n.nspname = 'public'
        and p.proname in ('release_outbox_claims', 'notification_priority',
                          'notification_priorities', 'notification_outbox_set_priority')
        and has_function_privilege(r.rolname, p.oid, 'execute') $$,
  'neither anon nor authenticated can call the release or the mapping');
select ok(
  has_function_privilege('service_role', 'public.release_outbox_claims(bigint[])', 'execute'),
  'the service role, which the drain holds, can release');

select * from finish();
rollback;
