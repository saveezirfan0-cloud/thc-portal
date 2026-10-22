-- =====================================================================
-- /onboarding/reminders: the daily onboarding reminder emails, and how
-- many of each have gone (ADR-0193; owner request, 22.10.2026)
--
-- After ADR-0186 every candidate stuck on a move of their own is emailed
-- daily until they progress: the interview (OC1), the account set-up
-- (OC2) and the wizard step with how to do it (OC4, beside the OC3 push).
-- The owner asked to see those emails and their numbers. /staff/roster's
-- "Emails staff receive" (ADR-0141) does it for THC's own staff only; this
-- is the same for everyone in the pipeline.
--
-- One call answers the whole page:
--
--   · stages  — per track (interview, activation, app): the candidates
--               being chased now, how many were reminded today (UK), how
--               many are Stalled (settings.onboarding_chasers
--               .stalled_after reminders, no progress) and how many have a
--               latest reminder that could not be delivered. The app track
--               adds how many have a device with notifications on and how
--               many sit at each wizard step.
--   · emails  — one row per email: OC1 first / second / repeat (new
--               applicants) and existing_first / existing_second /
--               existing_repeat (existing staff), OC2 and OC3 and OC4
--               first / second / repeat. Each: sent today (UK), sent in
--               all, failed, waiting, people reached, last sent, next due.
--   · besidePush — the OC4 emails sent beside a push (ADR-0186), apart
--               from the ones sent in place of one (ADR-0169).
--   · switches — each code on: its own switch and the job's.
--
-- Counts only: no address, link or payload leaves this function. OC2's
-- rows carry a live activation link (ADR-0060); this reads none of it.
-- Office logins only, the viewer included: it reads, it changes nothing.
-- pgTAP: supabase/tests/926_onboarding_email_report.sql.
-- =====================================================================

create or replace function public.onboarding_email_report(p_now timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_today date := uk_local(p_now)::date;
  v_cfg   jsonb := onboarding_chaser_config();
  v_job   boolean := coalesce((v_cfg ->> 'enabled')::boolean, true);
  v_out   jsonb;
begin
  perform assert_office_caller();

  with c as (
    select cc.*,
           exists (select 1 from push_subscriptions ps where ps.staff_id = cc.staff_id) as has_push
      from onboarding_chaser_candidates(p_now) cc
  ), stages as (
    select c.track,
           count(*)                                                        as waiting,
           count(*) filter (where c.last_sent_at is not null
                              and uk_local(c.last_sent_at)::date = v_today) as reminded_today,
           count(*) filter (where c.rungs_sent >= (v_cfg ->> 'stalled_after')::int) as stalled,
           count(*) filter (where c.last_failed)                            as last_failed,
           count(*) filter (where c.has_push)                               as with_push
      from c group by c.track
  ), steps as (
    select c.step_no, c.step, count(*) as n
      from c where c.track = 'app' group by c.step_no, c.step
  ), o as (
    select x.template || ':' || (x.payload ->> 'variant')                  as id,
           coalesce(x.recipient_staff_id::text, lower(btrim(x.recipient_emails[1]))) as who,
           x.sent_at, x.failed_at, x.send_after,
           uk_local(x.sent_at)::date                                       as sent_day,
           x.template, x.payload ->> 'pushOn'                              as push_on
      from notification_outbox x
     where x.template in ('OC1', 'OC2', 'OC3', 'OC4')
       and x.payload ->> 'variant' in ('first', 'second', 'repeat',
                                       'existing_first', 'existing_second', 'existing_repeat')
  ), counts as (
    select id,
           count(*) filter (where sent_at is not null and sent_day = v_today) as sent_today,
           count(*) filter (where sent_at is not null)                        as sent_total,
           count(*) filter (where failed_at is not null)                      as failed_total,
           count(*) filter (where sent_at is null and failed_at is null)      as queued,
           count(distinct who) filter (where sent_at is not null)             as people,
           max(sent_at)                                                       as last_sent_at,
           min(send_after) filter (where sent_at is null and failed_at is null) as next_at
      from o group by id
  ), beside as (
    select count(*) filter (where sent_at is not null and sent_day = v_today) as sent_today,
           count(*) filter (where sent_at is not null)                        as sent_total,
           count(*) filter (where failed_at is not null)                      as failed_total
      from o where template = 'OC4' and push_on = '1'
  ), ids(id, n) as (
    values ('OC1:first', 1), ('OC1:second', 2), ('OC1:repeat', 3),
           ('OC1:existing_first', 4), ('OC1:existing_second', 5), ('OC1:existing_repeat', 6),
           ('OC2:first', 7), ('OC2:second', 8), ('OC2:repeat', 9),
           ('OC3:first', 10), ('OC3:second', 11), ('OC3:repeat', 12),
           ('OC4:first', 13), ('OC4:second', 14), ('OC4:repeat', 15)
  )
  select jsonb_build_object(
    'today', v_today,
    'switches', jsonb_build_object(
      'OC1', v_job and notification_switched_on('OC1'),
      'OC2', v_job and notification_switched_on('OC2'),
      'OC3', v_job and notification_switched_on('OC3'),
      'OC4', v_job and notification_switched_on('OC4')),
    'stalledAfter', (v_cfg ->> 'stalled_after')::int,
    'stages', (select coalesce(jsonb_object_agg(s.track, jsonb_build_object(
                        'waiting',       s.waiting,
                        'remindedToday', s.reminded_today,
                        'stalled',       s.stalled,
                        'lastFailed',    s.last_failed,
                        'withPush',      s.with_push)), '{}'::jsonb)
                 from stages s),
    'steps', (select coalesce(jsonb_agg(jsonb_build_object('step', t.step, 'n', t.n)
                                        order by t.step_no, t.step), '[]'::jsonb)
                from steps t),
    'besidePush', (select jsonb_build_object('sentToday', b.sent_today,
                                             'sentTotal', b.sent_total,
                                             'failedTotal', b.failed_total)
                     from beside b),
    'emails', (select jsonb_agg(jsonb_build_object(
                        'id', ids.id,
                        'sentToday',   coalesce(k.sent_today, 0),
                        'sentTotal',   coalesce(k.sent_total, 0),
                        'failedTotal', coalesce(k.failed_total, 0),
                        'queued',      coalesce(k.queued, 0),
                        'people',      coalesce(k.people, 0),
                        'lastSentAt',  k.last_sent_at,
                        'nextAt',      k.next_at) order by ids.n)
                 from ids left join counts k on k.id = ids.id)
  ) into v_out;

  return v_out;
end $$;

comment on function public.onboarding_email_report(timestamptz) is
  'ADR-0193, /onboarding/reminders: per track (interview, activation, app) the candidates being reminded, reminded today (UK), Stalled and with a failed latest reminder, the app track''s devices and wizard steps; per email (OC1, OC2, OC3, OC4 first/second/repeat, OC1 existing_*) sent today, sent in all, failed, waiting, people reached, last sent and next due; the OC4 emails sent beside a push; whether each code is switched on. Counts only. Office logins only.';

revoke all on function public.onboarding_email_report(timestamptz) from public, anon;
grant execute on function public.onboarding_email_report(timestamptz) to authenticated;
