-- =====================================================================
-- The daily compliance sweep runs at 05:00 UK, not at midnight
--
-- compliance_daily_due() (20260921170411) answers "the 05:00 UK window, or
-- any time AFTER it on a day whose sweep has not yet succeeded" — its own
-- comment — but the SQL had no "after 05:00": it asked only whether a
-- successful run had finished today. The first */5 tick after midnight UK
-- never has one (yesterday's runs finished yesterday), so every day the
-- sweep ran at 00:00 UK: N1–N4 "update your document" and N14 "your weekly
-- limit is now …" went to workers' phones at midnight, and the 05:00 run
-- §7 names ("compliance_daily (05:00)") and §8 N14 promises ("on the
-- morning the change takes effect") found nothing left to do.
--
-- Now: due inside the 05:00 window, or after 05:00 UK on a day no sweep
-- has succeeded yet — the missed-window heal 20260921170411 meant. A run
-- that only answered "skipped" (every tick before 05:00 now, and after the
-- day's sweep) is not a sweep and does not count: without that, the
-- skipped 00:00–04:55 ticks would read as today's success and a missed
-- 05:00 window would defer the §4.3 block to tomorrow.
-- =====================================================================

create or replace function public.compliance_daily_due(p_now timestamptz default now())
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select is_uk_time(p_now, '05:00')
      or (uk_local(p_now)::time >= time '05:00'
          and not exists (
            select 1 from job_runs r
             where r.job = 'compliance-daily'
               and r.ok
               and not (r.counts ? 'skipped')
               and uk_local(r.finished_at)::date = uk_local(p_now)::date))
$$;

comment on function public.compliance_daily_due(timestamptz) is
  'The 05:00 UK window, or any time after 05:00 UK on a day whose sweep has not yet succeeded (§7) — never before 05:00, so N1–N4 and N14 do not reach phones at midnight. A run that answered "skipped" is not a sweep. A missed 05:00 must not defer a §4.3 block by 24 hours (20261022040200).';
