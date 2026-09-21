-- =====================================================================
-- 110 · The jobs layer and the outbox drain (§7, §8)
--   20260921130927_jobs_and_outbox_drain.sql
--
-- The `key` column has made enqueueing idempotent since 0001. What this
-- file proves is the other half, which is where a notification system
-- actually loses messages: that two drains running a minute apart cannot
-- both send the same push, that a send which fails comes back instead of
-- vanishing, and that it stops coming back eventually.
--
-- The backoff numbers are asserted literally, not derived, because
-- packages/notifications repeats the same curve in TypeScript and the two
-- have to agree. If this file and outboxBackoffMs() ever disagree, one of
-- them is wrong and the drain retries on a schedule nobody chose.
-- =====================================================================
begin;
select plan(42);
\ir _shared/fixtures.psql

-- ---------------------------------------------------------------------
-- The backoff curve: 1, 2, 4, 8, 16, then capped at 30 minutes.
-- ---------------------------------------------------------------------
select is(outbox_backoff(1), interval '1 minute',  'backoff 1 is one minute');
select is(outbox_backoff(2), interval '2 minutes', 'backoff 2 doubles');
select is(outbox_backoff(3), interval '4 minutes', 'backoff 3 doubles again');
select is(outbox_backoff(4), interval '8 minutes', 'backoff 4 doubles again');
select is(outbox_backoff(5), interval '16 minutes','backoff 5 doubles again');
select is(outbox_backoff(6), interval '30 minutes','backoff 6 hits the 30-minute cap');
select is(outbox_backoff(9), interval '30 minutes','backoff stays capped however many attempts');
select is(outbox_backoff(0), interval '1 minute',
  'attempt 0 is treated as the first attempt rather than a half-minute');

-- ---------------------------------------------------------------------
-- Fixtures: three rows due now, one due in an hour.
-- ---------------------------------------------------------------------
-- _shared/fixtures.psql inserts RLS:fixture:outbox with no send_after, which
-- defaults to now() (0001_init.sql). Inside one transaction now() is the
-- transaction timestamp, so that row satisfies `send_after <= now()` and is
-- claimable — it would land in the second drain below and make the counts
-- wrong. Push it out of reach so the claim assertions only see TEST- rows.
update notification_outbox set send_after = now() + interval '1 day'
 where key = 'RLS:fixture:outbox';

insert into notification_outbox (key, channel, template, send_after) values
  ('TEST-N9:booking:1',  'push', 'N9',  now() - interval '1 minute'),
  ('TEST-N9:booking:2',  'push', 'N9',  now() - interval '1 minute'),
  ('TEST-N12:booking:3', 'push', 'N12', now() - interval '1 minute'),
  ('TEST-N6:booking:4',  'push', 'N6',  now() + interval '1 hour');

-- ---------------------------------------------------------------------
-- Claiming: the limit is honoured, the lease hides what was claimed, and
-- a row that is not due yet is never handed out.
-- ---------------------------------------------------------------------
select is((select count(*)::int from claim_outbox_batch(2)), 2, 'a claim honours its limit');

select is(
  (select count(*)::int from notification_outbox
    where key like 'TEST-%' and attempts = 1 and send_after > now()),
  2, 'the two claimed rows are leased into the future and counted as attempted');

select is((select count(*)::int from claim_outbox_batch(10)), 1,
  'a second drain sees only the one unleased row, not the two already claimed');

select is((select count(*)::int from claim_outbox_batch(10)), 0,
  'a third drain finds nothing: everything due is leased and the fourth row is not due');

select is(
  (select attempts from notification_outbox where key = 'TEST-N6:booking:4'), 0,
  'a row whose send_after is in the future is never claimed');

-- ---------------------------------------------------------------------
-- Settling a claim: sent, re-armed, or finally failed.
-- ---------------------------------------------------------------------
select lives_ok(
  $$ select complete_outbox_send((select id from notification_outbox where key = 'TEST-N9:booking:1'), true) $$,
  'settling a claim as sent succeeds');

select isnt((select sent_at from notification_outbox where key = 'TEST-N9:booking:1'), null,
  'a successful send stamps sent_at');
select is((select error from notification_outbox where key = 'TEST-N9:booking:1'), null,
  'a successful send clears any error left by an earlier attempt');

select lives_ok(
  $$ select complete_outbox_send(
       (select id from notification_outbox where key = 'TEST-N9:booking:2'), false, 'push endpoint 500') $$,
  'settling a claim as failed succeeds');

select is((select failed_at from notification_outbox where key = 'TEST-N9:booking:2'), null,
  'one failure is not terminal: failed_at stays null');
select is((select error from notification_outbox where key = 'TEST-N9:booking:2'), 'push endpoint 500',
  'the failure records why');
select ok(
  (select send_after from notification_outbox where key = 'TEST-N9:booking:2')
    between now() + interval '50 seconds' and now() + interval '70 seconds',
  'a first failure re-arms one minute out, replacing the lease');

-- At the ceiling the row stops coming back.
update notification_outbox set attempts = 6 where key = 'TEST-N12:booking:3';
select lives_ok(
  $$ select complete_outbox_send(
       (select id from notification_outbox where key = 'TEST-N12:booking:3'), false, 'gave up') $$,
  'settling a claim that has exhausted its attempts succeeds');

select isnt((select failed_at from notification_outbox where key = 'TEST-N12:booking:3'), null,
  'at the attempt ceiling the row is marked failed rather than retried forever');

-- ---------------------------------------------------------------------
-- A settled row is never picked up again, whatever its send_after says.
-- ---------------------------------------------------------------------
update notification_outbox set send_after = now() - interval '1 minute'
 where key in ('TEST-N9:booking:1', 'TEST-N12:booking:3');

select is((select count(*)::int from claim_outbox_batch(10)), 0,
  'neither a sent row nor a failed row is ever claimed again, even once due');

-- A send that reports success after the row has already failed terminally
-- must not leave both stamps set: every §9.9 send count would read it twice.
select lives_ok(
  $$ select complete_outbox_send(
       (select id from notification_outbox where key = 'TEST-N12:booking:3'), true) $$,
  'a late success on a failed row is accepted without error');
select is((select sent_at from notification_outbox where key = 'TEST-N12:booking:3'), null,
  'a late success cannot resurrect a row that already exhausted its attempts');

-- ---------------------------------------------------------------------
-- job_runs
-- ---------------------------------------------------------------------
select is((select count(*)::int from job_runs), 0, 'no job has run yet');

-- A temp table rather than \gset: psql does not interpolate :variables
-- inside dollar-quoted text, which every assertion below is.
create temporary table t_run as select job_run_start('notify-drain') as id;

select is((select job from job_runs where id = (select id from t_run)), 'notify-drain',
  'a run records its job');
select is((select finished_at from job_runs where id = (select id from t_run)), null,
  'a started run is not finished');
select is((select ok from job_runs where id = (select id from t_run)), null,
  'a started run has no verdict yet');

select lives_ok(
  $$ select job_run_finish((select id from t_run), true, '{"sent":2,"failed":0}'::jsonb) $$,
  'finishing a run succeeds');
select is((select ok from job_runs where id = (select id from t_run)), true,
  'finishing records the verdict');
select is((select counts->>'sent' from job_runs where id = (select id from t_run)), '2',
  'finishing records the counts');
select isnt((select finished_at from job_runs where id = (select id from t_run)), null,
  'finishing stamps finished_at');

-- Finishing twice must not move the first verdict: a job that retries its
-- own completion call cannot overwrite what actually happened.
select lives_ok(
  $$ select job_run_finish((select id from t_run), false, '{}'::jsonb, 'late error') $$,
  'finishing an already-finished run succeeds quietly');
select is((select ok from job_runs where id = (select id from t_run)), true,
  'a second finish on the same run is ignored, so a retry cannot rewrite history');

select throws_ok(
  $$ insert into job_runs (job, finished_at) values ('x', now()) $$,
  '23514',
  null,
  'a run cannot be finished without a verdict');

-- ---------------------------------------------------------------------
-- Who may CALL any of this (§1.7).
--
-- Every function here is `security definer` in `public`, so PostgREST
-- publishes it as an RPC and Postgres grants EXECUTE to PUBLIC by default.
-- Unrevoked, the anon key reads the whole send queue through
-- claim_outbox_batch() and suppresses any notification through
-- complete_outbox_send(id, true). RLS does not help: a definer function
-- runs as its owner. These two assertions are the regression guard.
-- ---------------------------------------------------------------------
select is_empty(
  $$ select p.proname::text || ' is callable by ' || r.rolname
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       cross join (values ('anon'), ('authenticated')) as r(rolname)
      where n.nspname = 'public'
        and p.proname in ('claim_outbox_batch', 'complete_outbox_send',
                          'job_run_start', 'job_run_finish', 'install_job_schedules')
        and has_function_privilege(r.rolname, p.oid, 'execute') $$,
  'neither anon nor authenticated can execute any of the five jobs functions'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('claim_outbox_batch', 'complete_outbox_send',
                        'job_run_start', 'job_run_finish', 'install_job_schedules')
      and has_function_privilege('service_role', p.oid, 'execute')),
  5, 'the service role, which is what an Edge Function holds, can execute all five');

-- ---------------------------------------------------------------------
-- Who can read the two new tables (§1.4). Both are admin-read and
-- service-role-write, like audit_log and report_sends: a job's error text
-- and the cron registry are operational detail, not worker- or
-- client-facing. Everything above ran as the table owner, which bypasses
-- RLS, so the role has to be switched for these four to mean anything.
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select ok((select count(*) from job_runs) > 0, 'an admin reads the job run log');
select is((select count(*)::int from job_schedules where job = 'notify-drain'), 1,
  'an admin reads the cron registry');

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*)::int from job_runs), 0,
  'a worker reads no job runs: a failed send is not theirs to see');
select is((select count(*)::int from job_schedules), 0,
  'a worker reads no cron registry');

reset role;

select * from finish();
rollback;
