-- =====================================================================
-- job_runs: keep it from growing for ever (ADR-0025)
--
-- The automated right-to-work runner fires every minute (20261006170000)
-- and, like every §7 job, writes a job_runs row per pass: about 1,440 a day,
-- nearly all of them "claimed 0". Nothing ever deleted a job_runs row.
--
-- job_runs_purge() removes
--   · the IDLE passes of the minute-by-minute runner (finished, ok, claimed
--     nothing) older than p_idle_days — except the newest rtw-check row,
--     which is the runner's heartbeat on /compliance;
--   · any run of any job older than p_keep_days (default 90).
-- Passes that did work, and every failure, stay for the 90 days.
--
-- The runner itself calls it once an hour (the minute-0 pass), on the
-- service key. Not scheduled in job_schedules: every row there is an HTTP
-- job, and this is one statement the runner already has a connection for.
-- =====================================================================

create or replace function public.job_runs_purge(
  p_idle_days int default 2,
  p_keep_days int default 90
) returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_idle int;
  v_old  int;
begin
  delete from job_runs r
   where r.job = 'rtw-check'
     and r.ok is true
     and r.finished_at is not null
     and coalesce((r.counts ->> 'claimed')::int, 0) = 0
     and r.started_at < now() - make_interval(days => greatest(p_idle_days, 1))
     and r.id <> coalesce((select max(h.id) from job_runs h where h.job = 'rtw-check'), -1);
  get diagnostics v_idle = row_count;

  delete from job_runs r
   where r.started_at < now() - make_interval(days => greatest(p_keep_days, 7));
  get diagnostics v_old = row_count;

  return v_idle + v_old;
end $$;

comment on function public.job_runs_purge(int, int) is
  'Deletes idle rtw-check passes (finished ok, claimed 0) older than p_idle_days, keeping the newest as the heartbeat, and any job run older than p_keep_days (floors 1 and 7). Returns the number of rows deleted. Service role only; the rtw-check runner calls it hourly (20261007100000).';

revoke execute on function public.job_runs_purge(int, int) from public, anon, authenticated;
grant  execute on function public.job_runs_purge(int, int) to service_role;
