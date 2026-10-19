-- =====================================================================
-- /staff/roster: the reminder report reads the reminders once
-- (reported 19.10.2026: "The reminder report could not be read:
-- canceling statement due to statement timeout")
--
-- The cause of that timeout was the database, not this function: the
-- project runs on Supabase's Micro compute (1 GB, shared burstable CPU),
-- and on 19.10.2026 its CPU ran 3-8x below normal; once a few heavy pages
-- overlapped, every request queued behind them (the event board's half of
-- it is fixed in apps/office/app/events/[id]/board-data.ts the same day).
-- This function took 0.3-1.5 s of that throttled CPU, and some of the work
-- was repeated, in ways that grow with every day of reminders:
--
--   1. The 14-day "daily" series ran two correlated counts per day over
--      every IR1 row ever queued — 28 passes over the whole history, which
--      grows by ~830 rows a day. The rows are now grouped by UK day ONCE
--      (by_day) and the fourteen days read from that; sent/failed today
--      come from the same groups (77 ms → 46 ms on 19.10.2026's 5,988 rows).
--
--   2. The totals (sent, failed, waiting, last sent) were five more full
--      passes; they are one aggregate now (totals).
--
--   3. invite_roster_possible_matches() ran twice — once for the count,
--      once for the list. It is read once (pm) and both come from that.
--
-- Pure cost: every key and every value is what 20261015120000 returned
-- (812_invite_roster_report and 842_invite_roster_kept pin them, and
-- 851_invite_roster_report_one_pass pins the empty days and the totals).
-- =====================================================================

create or replace function public.invite_roster_report(p_now timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_today date := uk_local(p_now)::date;
  v_cfg   jsonb := invite_roster_reminder_config();
  v_out   jsonb;
begin
  perform assert_office_caller();

  with held as (
    select ir.*, exists (select 1 from staff s
                          where lower(btrim(s.email)) = ir.email and s.removed_at is null) as applied
      from invite_roster ir
  ), ir1 as materialized (
    select o.recipient_emails[1] as email, o.sent_at, o.failed_at, o.error, o.queued_at,
           uk_local(coalesce(o.sent_at, o.failed_at, o.queued_at))::date as day
      from notification_outbox o
     where o.template = 'IR1'
  ), by_day as (
    -- One pass: each UK day's sent and failed (19.10.2026).
    select day,
           count(*) filter (where sent_at is not null)   as sent,
           count(*) filter (where failed_at is not null) as failed
      from ir1 group by day
  ), totals as (
    select count(*) filter (where sent_at is not null)                   as sent,
           count(*) filter (where failed_at is not null)                 as failed,
           count(*) filter (where sent_at is null and failed_at is null) as queued,
           max(sent_at)                                                  as last_sent_at
      from ir1
  ), per_email as (
    select email,
           count(*) filter (where sent_at is not null)                     as sent,
           max(sent_at)                                                     as last_sent_at,
           min(sent_at)                                                     as first_sent_at,
           (array_agg(error order by failed_at desc) filter (where failed_at is not null))[1] as last_error,
           max(failed_at)                                                   as last_failed_at
      from ir1 group by email
  ), matched as (
    select count(distinct a.entity_id) as n
      from audit_log a
     where (a.action = 'roster.matched' and a.data ->> 'via' in ('list', 'list_over_link', 'list_name_mismatch'))
        or a.action = 'roster.linked'
  ), pm as materialized (
    -- Read once, for the count and the list (19.10.2026).
    select * from invite_roster_possible_matches()
  )
  select jsonb_build_object(
    'today', v_today,
    'settings', jsonb_build_object(
      'enabled', coalesce((v_cfg ->> 'enabled')::boolean, true),
      'switchOn', notification_switched_on('IR1'),
      'from', v_cfg ->> 'from', 'until', v_cfg ->> 'until'),
    'kpis', jsonb_build_object(
      'notAppliedThc',      (select count(*) from held where grp = 'thc' and not applied),
      'notAppliedSpudbros', (select count(*) from held where grp = 'spudbros' and not applied),
      'appliedKept',        (select count(*) from held where applied),
      'appliedFromList',    (select n from matched),
      'possibleMatches',    (select count(distinct entry_id) from pm),
      'sentToday',          coalesce((select sent from by_day where day = v_today), 0),
      'sentTotal',          (select sent from totals),
      'failedTotal',        (select failed from totals),
      'failedToday',        coalesce((select failed from by_day where day = v_today), 0),
      'queued',             (select queued from totals),
      'peopleReminded',     (select count(*) from per_email where sent > 0),
      'appliedAfterReminder', (select count(*) from per_email pe
                                where pe.first_sent_at is not null
                                  and exists (select 1 from staff s
                                               where lower(btrim(s.email)) = pe.email
                                                 and s.removed_at is null
                                                 and s.created_at > pe.first_sent_at)),
      'lastSentAt',         (select last_sent_at from totals)),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object(
                       'day', d::date,
                       'sent',   coalesce(b.sent, 0),
                       'failed', coalesce(b.failed, 0))
                     order by d), '[]'::jsonb)
                from generate_series(v_today - 13, v_today, interval '1 day') d
                left join by_day b on b.day = d::date),
    'reminders', (select coalesce(jsonb_object_agg(pe.email, jsonb_build_object(
                           'sent', pe.sent, 'lastSentAt', pe.last_sent_at,
                           'lastError', case when pe.last_failed_at > coalesce(pe.last_sent_at, '-infinity')
                                             then left(pe.last_error, 160) end)), '{}'::jsonb)
                    from per_email pe
                    where pe.email in (select email from invite_roster)),
    'applied', (select coalesce(jsonb_agg(h.id), '[]'::jsonb) from held h where h.applied),
    -- Why each of those has no Payroll ID yet, and who applied (20261015120000).
    'kept', (select coalesce(jsonb_agg(jsonb_build_object(
                      'entryId', k.entry_id, 'staffId', k.staff_id, 'staffName', k.staff_name,
                      'staffEmail', k.staff_email, 'status', k.staff_status,
                      'staffPayrollId', k.staff_payroll_id, 'reason', k.reason,
                      'holderId', k.holder_id, 'holderName', k.holder_name)), '[]'::jsonb)
               from invite_roster_kept() k),
    'matches', (select coalesce(jsonb_agg(jsonb_build_object(
                         'entryId', m.entry_id, 'staffId', m.staff_id, 'staffName', m.staff_name,
                         'staffEmail', m.staff_email, 'status', m.staff_status,
                         'appliedAt', m.applied_at) order by m.applied_at), '[]'::jsonb)
                  from pm m)
  ) into v_out;

  return v_out;
end $$;

comment on function public.invite_roster_report(timestamptz) is
  'ADR-0123, /staff/roster: KPIs (not applied by group, applied from the list, rows kept after applying, possible matches; IR1 sent today/total, failed, queued, people reminded, applied after a reminder, last sent), a 14-day sent/failed series, per-email reminder counts and last failure, the ids of rows whose person has applied, why each has no Payroll ID (kept, ADR-0143), and possible matches. Office logins only. Since 20261019120000 the IR1 rows are grouped by day once and the possible matches read once.';

revoke all on function public.invite_roster_report(timestamptz) from public, anon;
grant execute on function public.invite_roster_report(timestamptz) to authenticated, service_role;
