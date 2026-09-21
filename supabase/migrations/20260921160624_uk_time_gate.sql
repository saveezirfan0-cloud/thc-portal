-- =====================================================================
-- The UK wall-clock gate for the §7 jobs
--
-- Why this exists
-- ---------------
-- pg_cron runs in UTC. Three of the §7 jobs are pinned to a UK
-- wall-clock time — the 12:05 cutoff (§3.5), the 05:00 compliance sweep
-- (§4) and the Monday 09:00 finance send (§9.9) — and those three drift
-- by an hour across the DST boundary if the schedule alone decides.
--
-- The repo's answer (.claude/skills/supabase-workflow) is to schedule
-- them more often than needed and let the function decide whether this
-- is the right UK minute. `job_schedules` registers all three as
-- every-5-minute entries for exactly that reason.
--
-- Which makes this gate load-bearing rather than a convenience. A
-- `mode=cutoff` run that forgets it does not merely run early: it runs
-- 288 times a day, and every pass releases the confirmed workers who
-- have not pressed "I'm ready" and sends them N6b (§3.5). The whole
-- point of putting it in SQL is that pgTAP can hold it to the DST
-- boundary, which no amount of reading the Edge Function will do.
--
-- `uk_local()` is separated out because the Monday in "Monday 09:00" is
-- a UK Monday too: at 00:30 UTC on a Monday in summer it is still
-- Sunday 23:30 in London, and BG-08 must not fire.
-- =====================================================================

-- The wall clock in London for an instant. `at time zone` resolves the
-- offset for that date, so this is BST or GMT as appropriate without
-- anything here knowing which.
create or replace function public.uk_local(p_now timestamptz default now())
returns timestamp
language sql
immutable
set search_path = public, extensions
as $$
  select p_now at time zone 'Europe/London';
$$;

comment on function public.uk_local(timestamptz) is
  'The Europe/London wall clock for an instant (§1.8). Use for any rule the scope states in UK time.';

-- True when the London wall clock is inside [hh:mm, hh:mm + window).
--
-- The window exists because the caller is a 5-minute cron: asking for
-- the exact minute would make the job depend on pg_cron firing on the
-- second, and a single missed tick would skip the 12:05 cutoff for a
-- whole day. A window wider than the schedule would fire twice, so the
-- default matches the every-5-minute registration in job_schedules.
create or replace function public.is_uk_time(
  p_now   timestamptz,
  p_hhmm  text,
  p_window interval default interval '5 minutes'
) returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  with l as (select uk_local(p_now) as ts)
  select l.ts >= date_trunc('day', l.ts) + p_hhmm::time
     and l.ts <  date_trunc('day', l.ts) + p_hhmm::time + p_window
    from l;
$$;

comment on function public.is_uk_time(timestamptz, text, interval) is
  'The gate for the §7 jobs pinned to a UK wall-clock time. pg_cron is UTC, so the schedule cannot express these; see the migration header for what a forgotten gate costs.';
