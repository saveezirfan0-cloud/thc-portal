-- =====================================================================
-- 860 · Job history retention (20261019120000, ADR-0154)
--
--   · job_run_counts_idle(): what "a run that did nothing" means.
--   · job_runs_purge(): idle runs of every per-minute job go after two
--     days, the newest of each stays as its heartbeat, failures and runs
--     that did work stay 90 days, other jobs' idle runs stay 90 days, and
--     one call deletes at most 20,000 rows per branch.
--   · cron_history_purge(): pg_cron's run log loses rows older than seven
--     days, oldest first, bounded per call; a no-op without the table.
--   · run_housekeeping_job(): one job_runs row per run, failures recorded.
--   · install_housekeeping_schedules(): both jobs in pg_cron, idempotently.
--   · Nobody but the owner (and, for job_runs_purge, the service role)
--     can call any of it.
-- 776 still holds 20261007100000's rtw-check cases unchanged.
-- =====================================================================
begin;
select plan(35);

-- ---------------------------------------------------------------------
-- 1 · Idle or not
-- ---------------------------------------------------------------------
select ok(job_run_counts_idle('{}'), 'empty counts are idle');
select ok(job_run_counts_idle('{"claimed":0}'), 'notify-drain / rtw-check with nothing claimed is idle');
select ok(job_run_counts_idle('{"claimed":0,"passed":0,"rejected":0,"needs_review":0,"queued":0,"failed":0,"record_errors":0}'),
  'rtw-check''s all-zero counters are idle, record_errors included');
select ok(job_run_counts_idle('{"n9_in":0,"n9_out":0,"no_show":0,"kit":{"queued":0}}'),
  'booking-tick''s zeros are idle, nested ones too');
select ok(job_run_counts_idle('{"skipped":"not_configured"}'), 'a run skipped for configuration is idle');
select ok(job_run_counts_idle('{"skipped":"WILLO_API_KEY or WILLO_INTERVIEW_KEY not set","skipped_spudbros":0}'),
  'willo-invite without its keys is idle');
select ok(not job_run_counts_idle('{"claimed":1,"passed":1}'), 'a run that claimed something is not idle');
select ok(not job_run_counts_idle('{"n9_in":0,"kit":{"queued":2}}'), 'work counted at any depth is not idle');
select ok(not job_run_counts_idle('{"sent":true}'), 'a true flag is not idle');
select ok(not job_run_counts_idle('{"claimed":0,"spudbros_error":"timeout"}'), 'an error message in the counts is not idle');
select ok(not job_run_counts_idle('{"claimed":-1}'), 'any non-zero number is not idle');

-- ---------------------------------------------------------------------
-- 2 · job_runs_purge()
-- ---------------------------------------------------------------------
delete from job_runs;

insert into job_runs (job, started_at, finished_at, ok, counts) values
  ('notify-drain',     now() - interval '3 days',  now() - interval '3 days',  true,  '{"claimed":0}'),          -- idle, old       → purged
  ('notify-drain',     now() - interval '3 days',  now() - interval '3 days',  true,  '{"claimed":3,"sent":3}'), -- did work        → kept
  ('notify-drain',     now() - interval '1 hour',  now() - interval '1 hour',  true,  '{"claimed":0}'),          -- idle, recent    → kept
  ('booking-tick',     now() - interval '4 days',  now() - interval '4 days',  true,  '{"n9_in":0,"no_show":0}'),-- idle, old       → purged
  ('booking-tick',     now() - interval '4 days',  now() - interval '4 days',  false, '{}'),                     -- failure         → kept
  ('booking-tick',     now() - interval '4 days',  null,                       null,  '{}'),                     -- never finished  → kept
  ('booking-tick',     now() - interval '2 hours', now() - interval '2 hours', true,  '{"n9_in":0}'),            -- heartbeat       → kept
  ('willo-invite',     now() - interval '5 days',  now() - interval '5 days',  true,  '{"skipped":"x"}'),        -- idle, old       → purged
  ('willo-invite',     now() - interval '5 days',  now() - interval '5 days',  true,  '{"spudbros_error":"x"}'), -- error in counts → kept
  ('willo-invite',     now() - interval '1 day',   now() - interval '1 day',   true,  '{"created":0}'),          -- heartbeat       → kept
  ('compliance-daily', now() - interval '5 days',  now() - interval '5 days',  true,  '{"due":false}'),          -- not per-minute  → kept
  ('compliance-daily', now() - interval '1 day',   now() - interval '1 day',   true,  '{"due":false}');

select is(job_runs_purge(), 3, 'the three old idle runs of per-minute jobs go');
select is((select count(*)::int from job_runs where job = 'notify-drain'), 2,
  'notify-drain keeps the run that sent and its recent idle run');
select is((select count(*)::int from job_runs where job = 'booking-tick'), 3,
  'booking-tick keeps its failure, its unfinished run and its heartbeat');
select is((select count(*)::int from job_runs where job = 'willo-invite'), 2,
  'willo-invite keeps the run that carried an error and its heartbeat');
select is((select count(*)::int from job_runs where job = 'compliance-daily'), 2,
  'an every-5-minute job''s idle runs keep the 90-day retention');

-- The heartbeat of each per-minute job survives however old it gets.
update job_runs set started_at = now() - interval '30 days', finished_at = now() - interval '30 days'
 where job = 'willo-invite' and counts ? 'created';
select is(job_runs_purge(), 0, 'the newest idle run of a job is its heartbeat and stays');

-- Bounded per call: 25,000 deletable idle rows take two calls.
delete from job_runs;
insert into job_runs (job, started_at, finished_at, ok, counts)
select 'notify-drain', now() - interval '3 days' - make_interval(secs => g), now() - interval '3 days', true, '{"claimed":0}'
  from generate_series(1, 25000) g;
insert into job_runs (job, started_at, finished_at, ok, counts)
values ('notify-drain', now() - interval '3 days', now() - interval '3 days', true, '{"claimed":0}');   -- the heartbeat
select is(job_runs_purge(), 20000, 'one call deletes at most 20,000 idle rows');
select is(job_runs_purge(), 5000, 'the next call takes the rest');
select is((select count(*)::int from job_runs), 1, 'leaving the heartbeat');

-- The 90-day branch is bounded the same way.
delete from job_runs;
insert into job_runs (job, started_at, finished_at, ok, counts)
select 'finance-reports', now() - interval '100 days', now() - interval '100 days', false, '{}'
  from generate_series(1, 20001) g;
select is(job_runs_purge(), 20000, 'runs past 90 days also go at most 20,000 a call');
select is(job_runs_purge(), 1, 'and the remainder on the next');

select ok(
  exists (select 1 from pg_indexes
           where schemaname = 'public' and tablename = 'job_runs'
             and indexname = 'job_runs_started_at_idx'),
  'the 90-day branch has its index on started_at');

-- ---------------------------------------------------------------------
-- 3 · cron_history_purge()
-- ---------------------------------------------------------------------
-- Real pg_cron has the table; the local stub does not, and there the
-- purge must be a quiet no-op.
select is(
  case when to_regclass('cron.job_run_details') is null then cron_history_purge() else 0 end,
  0, 'without pg_cron''s history table the purge deletes nothing and does not fail');

do $$
begin
  if to_regclass('cron.job_run_details') is null then
    create table cron.job_run_details (
      jobid bigint, runid bigserial primary key, job_pid integer, database text, username text,
      command text, status text, return_message text, start_time timestamptz, end_time timestamptz);
  end if;
end $$;
delete from cron.job_run_details;
insert into cron.job_run_details (jobid, command, status, start_time, end_time)
select 0, 'select 849', 'succeeded', now() - interval '8 days', now() - interval '8 days'
  from generate_series(1, 5)
union all
select 0, 'select 849', 'succeeded', now() - interval '6 days', now() - interval '6 days'
union all
select 0, 'select 849', 'running',   now() - interval '1 minute', null;

select is(cron_history_purge(7, 3), 3, 'p_max_rows bounds one call');
select is(cron_history_purge(), 2, 'the default call takes the remaining week-old rows');
select is((select count(*)::int from cron.job_run_details), 2,
  'the six-day-old row and the running one stay');

-- ---------------------------------------------------------------------
-- 4 · run_housekeeping_job()
-- ---------------------------------------------------------------------
delete from job_runs;
select is(run_housekeeping_job('job-runs-purge') ->> 'ok', 'true', 'the job-runs purge runs');
select results_eq(
  $$ select job, ok, counts from job_runs where job = 'job-runs-purge' $$,
  $$ values ('job-runs-purge'::text, true, '{"deleted":0}'::jsonb) $$,
  'and records itself in job_runs like every other job');
select throws_ok($$ select run_housekeeping_job('drop-everything') $$, '22023', null,
  'an unknown housekeeping job is refused');

-- ---------------------------------------------------------------------
-- 5 · install_housekeeping_schedules()
-- ---------------------------------------------------------------------
select is(install_housekeeping_schedules(), 2, 'two housekeeping jobs are scheduled');
select is(install_housekeeping_schedules(), 2, 'and installing again is harmless');
select results_eq(
  $$ select jobname::text, schedule::text, command::text from cron.job
      where jobname in ('cron-history-purge', 'job-runs-purge') order by jobname $$,
  $$ values ('cron-history-purge'::text, '41 3 * * *'::text, 'select public.run_housekeeping_job(''cron-history-purge'');'::text),
            ('job-runs-purge', '46 * * * *', 'select public.run_housekeeping_job(''job-runs-purge'');') $$,
  'daily at 03:41 UTC and hourly at :46, once each, calling the SQL entry point — no HTTP, no secret');

-- ---------------------------------------------------------------------
-- 6 · Who may call it
-- ---------------------------------------------------------------------
select is_empty(
  $$ select f from unnest(array[
       'public.job_runs_purge(int, int)', 'public.cron_history_purge(int, int)',
       'public.run_housekeeping_job(text)', 'public.install_housekeeping_schedules()']) f
      where has_function_privilege('anon', f, 'execute')
         or has_function_privilege('authenticated', f, 'execute') $$,
  'neither anon nor a signed-in user can run any housekeeping');

select ok(
  not has_function_privilege('service_role', 'public.cron_history_purge(int, int)', 'execute')
  and not has_function_privilege('service_role', 'public.run_housekeeping_job(text)', 'execute'),
  'the cron-history purge and the cron entry point are pg_cron''s alone');

select * from finish();
rollback;
