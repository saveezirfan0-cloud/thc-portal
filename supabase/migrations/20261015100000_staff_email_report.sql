-- =====================================================================
-- /staff/roster: the emails staff receive while moving onto the new app,
-- and how many of each have gone (ADR-0141; owner request, 15.10.2026)
--
-- The owner asked to see, on the invite list page, what the emails going
-- to THC's own staff say and how many have been sent. The page draws each
-- email from the register (packages/notifications); this function gives
-- the numbers beside it. One row per email:
--
--   · IR1                — the daily reminder to register (ADR-0122), to
--                          everyone on the THC list who has not applied;
--   · OC1 existing_first, existing_second, existing_repeat
--                        — the daily Willo interview reminder to existing
--                          staff who applied (20261012123000), day 1, day 2,
--                          then every day after;
--   · OC1 existing_notice — the one-off interview notice (20261014190000).
--
-- New applicants' OC1 wording (first / second / repeat) is not counted:
-- they are not on the invite list and this page is not about them.
--
-- Each row: sent today (UK), sent in all, failed (a bounce, a mistyped
-- address, or a reminder cancelled before it went), waiting to send, the
-- people it reached, when the last one went and when the next one is due.
-- Beside them: how many existing staff are waiting on their interview
-- now, and whether each email is switched on.
--
-- Office logins only, the viewer included: it reads, it changes nothing.
-- pgTAP: supabase/tests/840_staff_email_report.sql.
-- =====================================================================

create or replace function public.staff_email_report(p_now timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_today date := uk_local(p_now)::date;
  v_out   jsonb;
begin
  perform assert_office_caller();

  with o as (
    select case when x.template = 'IR1' then 'IR1'
                else 'OC1:' || (x.payload ->> 'variant') end            as id,
           x.recipient_emails[1]                                        as email,
           x.sent_at, x.failed_at, x.send_after,
           uk_local(x.sent_at)::date                                    as sent_day
      from notification_outbox x
     where x.template = 'IR1'
        or (x.template = 'OC1'
            and x.payload ->> 'variant' in ('existing_first', 'existing_second',
                                            'existing_repeat', 'existing_notice'))
  ), counts as (
    select id,
           count(*) filter (where sent_at is not null and sent_day = v_today) as sent_today,
           count(*) filter (where sent_at is not null)                        as sent_total,
           count(*) filter (where failed_at is not null)                      as failed_total,
           count(*) filter (where sent_at is null and failed_at is null)      as queued,
           count(distinct email) filter (where sent_at is not null)           as people,
           max(sent_at)                                                       as last_sent_at,
           min(send_after) filter (where sent_at is null and failed_at is null) as next_at
      from o group by id
  ), ids(id, n) as (
    values ('IR1', 1), ('OC1:existing_first', 2), ('OC1:existing_second', 3),
           ('OC1:existing_repeat', 4), ('OC1:existing_notice', 5)
  )
  select jsonb_build_object(
    'today', v_today,
    'interviewWaiting', (select count(*) from onboarding_chaser_candidates(p_now) c
                          join staff s on s.id = c.staff_id
                         where c.template = 'OC1'
                           and s.removed_at is null
                           and onboarding_chaser_existing_staff(c.staff_id)),
    'switches', jsonb_build_object(
      'IR1', notification_switched_on('IR1')
             and coalesce((invite_roster_reminder_config() ->> 'enabled')::boolean, true),
      'OC1', notification_switched_on('OC1')
             and coalesce((onboarding_chaser_config() ->> 'enabled')::boolean, true)),
    'emails', (select jsonb_agg(jsonb_build_object(
                        'id', ids.id,
                        'sentToday',   coalesce(c.sent_today, 0),
                        'sentTotal',   coalesce(c.sent_total, 0),
                        'failedTotal', coalesce(c.failed_total, 0),
                        'queued',      coalesce(c.queued, 0),
                        'people',      coalesce(c.people, 0),
                        'lastSentAt',  c.last_sent_at,
                        'nextAt',      c.next_at) order by ids.n)
                 from ids left join counts c on c.id = ids.id)
  ) into v_out;

  return v_out;
end $$;

comment on function public.staff_email_report(timestamptz) is
  'ADR-0141, /staff/roster "Emails staff receive": per email (IR1; OC1 existing_first, existing_second, existing_repeat, existing_notice) sent today (UK), sent in all, failed, waiting, people reached, last sent and next due; how many existing staff are waiting on their Willo interview; whether IR1 and OC1 are switched on. Office logins only.';

revoke all on function public.staff_email_report(timestamptz) from public, anon;
grant execute on function public.staff_email_report(timestamptz) to authenticated, service_role;
