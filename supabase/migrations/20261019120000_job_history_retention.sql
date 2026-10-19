-- =====================================================================
-- Job history retention: cron.job_run_details and job_runs (ADR-0154)
--
-- Measured on the live project, 17.10.2026 (go-live audit):
--   · cron.job_run_details: 130,336 rows / 137 MB since 28.09, about
--     6,700 rows and 7 MB a day, and NOTHING deletes it. It was 60% of a
--     227 MB database on a plan that turns read-only at 500 MB, and
--     Supabase's in-place upgrade duplicates the table ("clean unnecessary
--     records from this table prior to an upgrade").
--   · job_runs: 116k rows. notify-drain, booking-tick, willo-invite and
--     rtw-check each write 1,440 rows a day, nearly all of them no-ops,
--     and job_runs_purge() (20261007100000) only pruned rtw-check's idle
--     passes, so the steady state was about 540k rows.
--
-- What this adds
--   1 · job_run_counts_idle(counts): the one definition of "this run did
--       nothing". No number other than 0, no `true`, and no *error* key
--       holding a message, anywhere in the counts. Every per-minute job's
--       idle shape passes ({"claimed":0}, booking-tick's all-zero
--       counters, {"skipped":"not_configured"}, willo-invite's zeros);
--       anything that did work or carries an error does not.
--   2 · job_runs_purge() (same signature, so the rtw-check route's hourly
--       call is unchanged; restated from 20261007100000, its only
--       definition) now prunes the idle runs of EVERY per-minute job — any
--       job_schedules row on '* * * * *', plus rtw-check and the two
--       housekeeping jobs below — after p_idle_days (default 2), keeping
--       the newest row of each as its heartbeat (latest started AND
--       highest id, so neither /compliance's reader nor 776's definition
--       loses its row). Failures and runs
--       that did work keep the p_keep_days retention (90). Each branch
--       deletes in batches of 5,000 and at most 20,000 rows per call, so a
--       call fits inside the 8 s statement limit a PostgREST caller has
--       and the 116k backlog drains over a few hourly calls instead of in
--       one long transaction.
--   3 · job_runs_started_at_idx for the 90-day branch (started_at alone;
--       the existing indexes lead on job, or cover unfinished runs only).
--   4 · cron_history_purge(): deletes cron.job_run_details rows older than
--       7 days, oldest first, in batches of 10,000, at most 100,000 per
--       call. A no-op (returns 0) where pg_cron has no history table —
--       scripts/pgtest-local.sh stubs pg_cron without one.
--   5 · run_housekeeping_job(job): the cron entry point. Writes a
--       job_runs row per run like every other job, and records a failure
--       instead of raising, so cron's own log never holds the only trace.
--   6 · install_housekeeping_schedules(): schedules the two SQL jobs
--         cron-history-purge  '41 3 * * *'  daily, 03:41 UTC
--         job-runs-purge      '46 * * * *'  hourly at :46
--       Both minutes are clear of every HTTP job (:00/:05 grid, :03/:08
--       gdpr-purge, :04/:14 escalation, :07, :17). UTC on purpose and no
--       DST pair: neither is a UK wall-clock rule — 03:41 UTC is 03:41 GMT
--       in winter and 04:41 BST in summer, both before the 05:00 UK
--       compliance sweep and outside any shift the agency books.
--       install_job_schedules() calls it too (20261019120100), so the
--       post-upgrade reinstall (pg_cron is dropped and recreated by an
--       in-place upgrade) brings them back with everything else.
--
-- Why these two are installed HERE when the HTTP jobs are not: the HTTP
-- jobs need settings.edge_base_url, the Vault and deployed functions
-- (docs/01 §4). These need nothing — plain SQL against this database — so
-- the deploy that ships the purge also starts it.
--
-- Owner, once, before an in-place upgrade (docs/16 §4.7): the backlog
-- clears within a day on its own, but a manual prune plus vacuum frees the
-- space at once:
--   delete from cron.job_run_details where end_time < now() - interval '7 days';
--   vacuum (analyze) cron.job_run_details;
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · What counts as a run that did nothing
-- ---------------------------------------------------------------------
create or replace function public.job_run_counts_idle(p_counts jsonb)
returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  select p_counts is null
      or (    not jsonb_path_exists(p_counts, '$.** ? (@.type() == "number" && @ != 0)')
          and not jsonb_path_exists(p_counts, '$.** ? (@ == true)')
          and not jsonb_path_exists(
                p_counts,
                '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "error" flag "i" && @.value.type() != "number" && @.value.type() != "null")'))
$$;

comment on function public.job_run_counts_idle(jsonb) is
  'True when a job run''s counts record no work: no non-zero number, no true, and no *error* key holding a message, at any depth (ADR-0154). {"claimed":0}, {"record_errors":0}, {"skipped":"not_configured"} and {} are idle; {"claimed":1} and {"spudbros_error":"…"} are not.';

revoke execute on function public.job_run_counts_idle(jsonb) from public, anon, authenticated;
grant  execute on function public.job_run_counts_idle(jsonb) to service_role;

-- ---------------------------------------------------------------------
-- 2 · job_runs_purge(), restated from its latest body (20261007100000;
--     the only definition) with the idle branch widened and both branches
--     batched. Same signature and defaults.
-- ---------------------------------------------------------------------
create or replace function public.job_runs_purge(
  p_idle_days int default 2,
  p_keep_days int default 90
) returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c_batch      constant int := 5000;
  c_max        constant int := 20000;
  v_idle_until timestamptz := now() - make_interval(days => greatest(p_idle_days, 1));
  v_keep_until timestamptz := now() - make_interval(days => greatest(p_keep_days, 7));
  v_jobs       text[];
  v_heartbeat  bigint[];
  v_n          int;
  v_idle       int := 0;
  v_old        int := 0;
begin
  -- The per-minute jobs: whatever the registry runs every minute, plus
  -- rtw-check (named, so its idle passes go even while its row is off
  -- the minute schedule) and the housekeeping jobs below.
  v_jobs := array(
    select s.job from job_schedules s where s.cron_expression = '* * * * *'
    union
    select unnest(array['rtw-check', 'job-runs-purge', 'cron-history-purge']));

  -- The newest row of each is its heartbeat, kept however old: both the
  -- latest-started (what /compliance reads for rtw-check) and the highest
  -- id (20261007100000's definition, which 776 holds). In practice they
  -- are the same row.
  v_heartbeat := array_remove(array(
    select (select h.id from job_runs h
             where h.job = j.job
             order by h.started_at desc, h.id desc
             limit 1)
      from unnest(v_jobs) as j(job)
    union
    select (select max(h.id) from job_runs h where h.job = j.job)
      from unnest(v_jobs) as j(job)), null);

  loop
    delete from job_runs r
     where r.id in (
       select c.id from job_runs c
        where c.job = any (v_jobs)
          and c.ok is true
          and c.finished_at is not null
          and c.started_at < v_idle_until
          and c.id <> all (v_heartbeat)
          and job_run_counts_idle(c.counts)
        limit c_batch);
    get diagnostics v_n = row_count;
    v_idle := v_idle + v_n;
    exit when v_n < c_batch or v_idle >= c_max;
  end loop;

  loop
    delete from job_runs r
     where r.id in (
       select c.id from job_runs c
        where c.started_at < v_keep_until
        order by c.started_at
        limit c_batch);
    get diagnostics v_n = row_count;
    v_old := v_old + v_n;
    exit when v_n < c_batch or v_old >= c_max;
  end loop;

  return v_idle + v_old;
end $$;

comment on function public.job_runs_purge(int, int) is
  'Deletes the idle runs (finished ok, job_run_counts_idle) of every per-minute job — job_schedules rows on * * * * *, rtw-check, job-runs-purge, cron-history-purge — older than p_idle_days, keeping the newest row of each as its heartbeat, and any job run older than p_keep_days (floors 1 and 7). Batches of 5,000, at most 20,000 per branch per call. Returns the number of rows deleted. Service role only; the rtw-check runner calls it hourly and so does pg_cron (job-runs-purge, ADR-0154).';

revoke execute on function public.job_runs_purge(int, int) from public, anon, authenticated;
grant  execute on function public.job_runs_purge(int, int) to service_role;

-- ---------------------------------------------------------------------
-- 3 · The index the 90-day branch reads
-- ---------------------------------------------------------------------
create index if not exists job_runs_started_at_idx on public.job_runs (started_at);

-- ---------------------------------------------------------------------
-- 4 · pg_cron's own run log
-- ---------------------------------------------------------------------
create or replace function public.cron_history_purge(
  p_keep_days int default 7,
  p_max_rows  int default 100000
) returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c_batch constant int := 10000;
  v_until timestamptz := now() - make_interval(days => greatest(p_keep_days, 1));
  v_limit int;
  v_n     int;
  v_total int := 0;
begin
  -- The local harness stubs pg_cron with cron.job only.
  if to_regclass('cron.job_run_details') is null then
    return 0;
  end if;

  while v_total < coalesce(p_max_rows, 0) loop
    v_limit := least(c_batch, p_max_rows - v_total);
    -- Oldest first along the primary key, so each batch stops as soon as
    -- it has its rows. A row still running (end_time null) is judged by
    -- its start; one with neither stamp is left alone.
    execute
      'delete from cron.job_run_details d
        where d.runid in (
          select c.runid from cron.job_run_details c
           where coalesce(c.end_time, c.start_time) < $1
           order by c.runid
           limit $2)'
      using v_until, v_limit;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
    exit when v_n < v_limit;
  end loop;

  return v_total;
end $$;

comment on function public.cron_history_purge(int, int) is
  'Deletes cron.job_run_details rows older than p_keep_days (floor 1, default 7), oldest first in batches of 10,000, at most p_max_rows per call. Returns the number deleted; 0 where pg_cron keeps no history table. Run daily by pg_cron (cron-history-purge, ADR-0154).';

revoke execute on function public.cron_history_purge(int, int) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5 · The cron entry point: one job_runs row per run
-- ---------------------------------------------------------------------
create or replace function public.run_housekeeping_job(p_job text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_run    bigint;
  v_n      int;
  v_counts jsonb;
begin
  if p_job is null or p_job not in ('job-runs-purge', 'cron-history-purge') then
    raise exception 'unknown housekeeping job %', coalesce(p_job, '(null)')
      using errcode = '22023';
  end if;

  v_run := job_run_start(p_job);
  begin
    if p_job = 'job-runs-purge' then
      v_n := job_runs_purge();
    else
      v_n := cron_history_purge();
    end if;
    v_counts := jsonb_build_object('deleted', v_n);
    perform job_run_finish(v_run, true, v_counts);
    return jsonb_build_object('job', p_job, 'ok', true, 'counts', v_counts);
  exception when others then
    perform job_run_finish(v_run, false, '{}'::jsonb, sqlerrm);
    return jsonb_build_object('job', p_job, 'ok', false, 'error', sqlerrm);
  end;
end $$;

comment on function public.run_housekeeping_job(text) is
  'pg_cron entry point for the SQL-only housekeeping jobs (job-runs-purge, cron-history-purge; ADR-0154). Writes a job_runs row with counts {deleted} and records a failure rather than raising.';

revoke execute on function public.run_housekeeping_job(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6 · Their schedules
-- ---------------------------------------------------------------------
create or replace function public.install_housekeeping_schedules()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
  n integer := 0;
begin
  if to_regnamespace('cron') is null then
    raise notice 'pg_cron is not installed; the housekeeping jobs are not scheduled';
    return 0;
  end if;

  -- UTC. Neither is a UK wall-clock rule, so there is no DST pair: 03:41
  -- UTC is 03:41 GMT / 04:41 BST. Both minutes avoid every HTTP job's.
  for r in
    select * from (values
      ('cron-history-purge', '41 3 * * *', 'select public.run_housekeeping_job(''cron-history-purge'');'),
      ('job-runs-purge',     '46 * * * *', 'select public.run_housekeeping_job(''job-runs-purge'');')
    ) as v(job, schedule, command)
  loop
    if exists (select 1 from cron.job j where j.jobname = r.job) then
      perform cron.unschedule(r.job);
    end if;
    perform cron.schedule(r.job, r.schedule, r.command);
    n := n + 1;
  end loop;
  return n;
end $$;

comment on function public.install_housekeeping_schedules() is
  'Schedules the SQL-only housekeeping jobs in pg_cron: cron-history-purge daily at 03:41 UTC and job-runs-purge hourly at :46 (ADR-0154). Idempotent. Called by this migration and by install_job_schedules(), so a pg_cron reinstall keeps them. Returns the number scheduled (0 without pg_cron).';

revoke execute on function public.install_housekeeping_schedules() from public, anon, authenticated;
grant  execute on function public.install_housekeeping_schedules() to service_role;

-- No secrets, no HTTP: start them with the deploy.
select public.install_housekeeping_schedules();
