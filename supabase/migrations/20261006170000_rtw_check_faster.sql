-- =====================================================================
-- The gov.uk right-to-work check, faster (ADR-0025)
--
-- A check whose first attempt failed waited 30 min, 2 h, 6 h, 16 h and was
-- picked up only by a runner that fired every 10 minutes. That suits a gov.uk
-- outage and nothing else: a failure where gov.uk answered and we could not
-- read the answer (`govuk_no_expiry` …) is now decided in the domain
-- (RTW_CHECK_PERMANENT_ERRORS) and goes straight to Needs review.
--
--   1 · rtw_check_backoff(): 2 min, 10 min, 30 min, 2 h — five attempts over
--       about three hours. Equal to RTW_CHECK_BACKOFF_MINUTES in
--       packages/domain (rtwCheck.sql.test.ts compares the literal).
--   2 · The runner row fires every minute, not every 10 (pg_cron's floor).
--       Run install_job_schedules() once after this migration so an already
--       enabled row is rescheduled; a disabled one is untouched.
--   3 · A retry already waiting on the old schedule is pulled forward to
--       the new one.
-- =====================================================================

create or replace function public.rtw_check_backoff(p_attempt int)
returns interval
language sql
immutable
set search_path = public, extensions
as $$
  select make_interval(mins => (array[2, 10, 30, 120])[least(greatest(coalesce(p_attempt, 1), 1), 4)])
$$;

comment on function public.rtw_check_backoff(int) is
  'Wait after failed attempt N before attempt N + 1: 2 min, 10 min, 30 min, 2 h (20261006170000). Equal to RTW_CHECK_BACKOFF_MINUTES in packages/domain.';

update job_schedules
   set cron_expression = '* * * * *',
       note = replace(note, 'Every 10 min;', 'Every minute;')
 where job = 'rtw-check';

update rtw_checks
   set next_attempt_at = least(next_attempt_at, now() + rtw_check_backoff(attempts))
 where status = 'queued' and attempts > 0;
