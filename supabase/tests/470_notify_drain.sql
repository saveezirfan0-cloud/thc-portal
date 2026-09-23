-- =====================================================================
-- 470 · The outbox drain's settle paths (§8, P2)
--   20260924100000_notify_drain.sql
--
-- 110 holds claim/complete and the backoff curve. This file holds what
-- the drain added on top: failing a row that can never be sent without
-- spending six attempts on it, handing a claim back WITHOUT counting it
-- when the channel has no keys, the one-row-per-key guarantee end to end,
-- the lease that keeps two drains apart, and who may call any of it.
-- =====================================================================
begin;
select plan(30);
\ir _shared/fixtures.psql

-- Keep the shared fixture row, and anything seed.sql queued, out of every
-- claim below, so the counts see only this file's rows.
update notification_outbox set send_after = now() + interval '1 day'
 where sent_at is null and failed_at is null;

insert into notification_outbox (key, channel, template, recipient_staff_id, send_after) values
  ('T470-N12:booking:1', 'push', 'N12', :'staffa', now() - interval '1 minute'),
  ('T470-N99:booking:2', 'push', 'N99', :'staffa', now() - interval '1 minute'),
  ('T470-N5:invite:3',   'push', 'N5',  :'staffa', now() - interval '1 minute');

-- ---------------------------------------------------------------------
-- One key, one row, one send.
-- ---------------------------------------------------------------------
insert into notification_outbox (key, channel, template, recipient_staff_id)
values ('T470-N12:booking:1', 'push', 'N12', :'staffa')
on conflict (key) do nothing;

select is((select count(*)::int from notification_outbox where key = 'T470-N12:booking:1'), 1,
  'enqueueing the same key twice leaves one row');

select throws_ok(
  $$ insert into notification_outbox (key, channel, template) values ('T470-N12:booking:1', 'push', 'N12') $$,
  '23505', null,
  'and a plain second insert of the key is refused outright');

-- ---------------------------------------------------------------------
-- The lease: a claimed row is invisible to the next drain.
-- ---------------------------------------------------------------------
create temporary table t_first as select id, key from claim_outbox_batch(2);
create temporary table t_second as select id, key from claim_outbox_batch(50);

select is((select count(*)::int from t_first), 2, 'the first drain takes its limit');
select is((select count(*)::int from t_second), 1, 'the second drain takes only what is left');
select is_empty(
  $$ select id from t_first intersect select id from t_second $$,
  'no row is handed to both drains');
select ok(
  (select pg_get_functiondef('public.claim_outbox_batch(integer, interval)'::regprocedure)
     ilike '%for update skip locked%'),
  'the claim locks with skip locked, so concurrent drains take disjoint rows instead of waiting');

-- ---------------------------------------------------------------------
-- fail_outbox_send: the row is wrong. Failed now, with the reason.
-- ---------------------------------------------------------------------
select lives_ok(
  $$ select fail_outbox_send((select id from notification_outbox where key = 'T470-N99:booking:2'),
                             'N99 is not a code in the §8 register') $$,
  'a permanent failure settles');
select isnt((select failed_at from notification_outbox where key = 'T470-N99:booking:2'), null,
  'it is failed at once, on its first attempt');
select is((select attempts from notification_outbox where key = 'T470-N99:booking:2'), 1,
  'having spent one attempt, not six');
select is((select error from notification_outbox where key = 'T470-N99:booking:2'),
  'N99 is not a code in the §8 register', 'and it says why');

update notification_outbox set send_after = now() - interval '1 minute'
 where key = 'T470-N99:booking:2';
select is((select count(*)::int from claim_outbox_batch(50) where key = 'T470-N99:booking:2'), 0,
  'a permanently failed row is never claimed again');

select throws_ok(
  $$ select fail_outbox_send((select id from notification_outbox where key = 'T470-N5:invite:3'), '  ') $$,
  '22023', null,
  'a permanent failure with no reason is refused');

-- ---------------------------------------------------------------------
-- release_outbox_claim: no keys. The attempt is handed back.
-- ---------------------------------------------------------------------
select lives_ok(
  $$ select release_outbox_claim((select id from notification_outbox where key = 'T470-N5:invite:3'),
                                 'not configured: VAPID keys are not set') $$,
  'handing a claim back succeeds');
select is((select attempts from notification_outbox where key = 'T470-N5:invite:3'), 0,
  'the claim is un-counted');
select is((select error from notification_outbox where key = 'T470-N5:invite:3'),
  'not configured: VAPID keys are not set', 'the reason is visible on the row');
select ok(
  (select send_after from notification_outbox where key = 'T470-N5:invite:3')
    between now() + interval '290 seconds' and now() + interval '310 seconds',
  'and it is looked at again in five minutes, not every minute');
select is((select failed_at from notification_outbox where key = 'T470-N5:invite:3'), null,
  'a held row is not failed');

-- A deploy with no keys for a week: claim → release forever never reaches
-- the ceiling, so every row still has all six tries when the key lands.
do $$
declare i int;
begin
  for i in 1..10 loop
    update notification_outbox set send_after = now() - interval '1 second' where key = 'T470-N5:invite:3';
    perform release_outbox_claim(c.id, 'not configured')
       from claim_outbox_batch(50) c where c.key = 'T470-N5:invite:3';
  end loop;
end $$;
select is((select attempts from notification_outbox where key = 'T470-N5:invite:3'), 0,
  'ten held runs later the row has spent no attempts');
select is((select failed_at from notification_outbox where key = 'T470-N5:invite:3'), null,
  'and has not been failed by the ceiling');

select lives_ok(
  $$ select release_outbox_claim((select id from notification_outbox where key = 'T470-N5:invite:3'),
                                 'x', interval '0') $$,
  'a zero delay is allowed');

-- Once the keys exist, the same row sends once.
update notification_outbox set send_after = now() - interval '1 second' where key = 'T470-N5:invite:3';
select is((select count(*)::int from claim_outbox_batch(50) where key = 'T470-N5:invite:3'), 1,
  'with keys set, the held row is claimed again');
do $$ begin
  perform complete_outbox_send((select id from notification_outbox where key = 'T470-N5:invite:3'), true);
end $$;
select isnt((select sent_at from notification_outbox where key = 'T470-N5:invite:3'), null,
  'and sent');
select is((select error from notification_outbox where key = 'T470-N5:invite:3'), null,
  'which clears the not-configured note');

-- Neither path can touch a settled row.
do $$ begin
  perform release_outbox_claim((select id from notification_outbox where key = 'T470-N5:invite:3'), 'late');
  perform fail_outbox_send((select id from notification_outbox where key = 'T470-N5:invite:3'), 'late');
end $$;
select ok(
  (select sent_at is not null and failed_at is null and error is null
     from notification_outbox where key = 'T470-N5:invite:3'),
  'a late release or fail cannot touch a row that was sent');

-- ---------------------------------------------------------------------
-- A permanent failure reaches /reports (§9.9) through the existing trigger.
-- ---------------------------------------------------------------------
insert into notification_outbox (key, channel, template, payload)
values ('T470-BG08:2000-01-03', 'email', 'BG08', '{}'::jsonb);
insert into report_sends (kind, period_start, period_end, status, outbox_key)
values ('payroll', date '2000-01-03', date '2000-01-09', 'queued', 'T470-BG08:2000-01-03');
do $$ begin
  perform fail_outbox_send((select id from notification_outbox where key = 'T470-BG08:2000-01-03'),
    'BG08: attachment reports/payroll/x.csv does not exist');
end $$;
select is(
  (select status || ' / ' || error from report_sends where outbox_key = 'T470-BG08:2000-01-03'),
  'failed / BG08: attachment reports/payroll/x.csv does not exist',
  'a failed BG08 shows as "Failed to send report" with the reason, so the office can Retry');

-- ---------------------------------------------------------------------
-- The schedules.
-- ---------------------------------------------------------------------
select is((select enabled from job_schedules where job = 'notify-drain'), true,
  'the drain is scheduled');
select is((select cron_expression from job_schedules where job = 'notify-drain'), '* * * * *',
  'every minute (§8)');
select is((select enabled from job_schedules where job = 'finance-reports'), true,
  'finance-reports is re-enabled now that its email can go out');

-- ---------------------------------------------------------------------
-- Grants: the service role, and nobody else.
-- ---------------------------------------------------------------------
select is_empty(
  $$ select p.proname::text || ' is callable by ' || r.rolname
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       cross join (values ('anon'), ('authenticated'), ('public')) as r(rolname)
      where n.nspname = 'public'
        and p.proname in ('fail_outbox_send', 'release_outbox_claim')
        and (case when r.rolname = 'public'
                  then exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                where a.grantee = 0 and a.privilege_type = 'EXECUTE')
                  else has_function_privilege(r.rolname, p.oid, 'execute') end) $$,
  'neither anon, a signed-in user nor PUBLIC can fail or hold a notification');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('fail_outbox_send', 'release_outbox_claim')
      and has_function_privilege('service_role', p.oid, 'execute')),
  2, 'the service role, which the drain holds, can call both');

select * from finish();
rollback;
