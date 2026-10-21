-- =====================================================================
-- Every candidate in the wizard is emailed the step, with how to do it
-- (ADR-0186; owner request, 21.10.2026)
--
-- ADR-0169 emailed the daily app reminder (OC4) only to a candidate with
-- no device that has notifications on. Live on 21.10.2026: 33 of the 42
-- candidates in the wizard got an email, and the 9 who had notifications
-- on got a push that said "Next up: your home address" and nothing else.
-- The owner asked that everybody stuck in onboarding be emailed clear
-- instructions, daily, until they move on.
--
--   · A candidate with a device now gets the OC4 email as well as the OC3
--     push. Same rung, same condition for the address (the one they sign
--     in with) and the link; the only difference is the key. The push
--     keeps OC3's key, so the ladder (onboarding_chaser_candidates, the
--     board's "reminder 2 of 3") counts the day once; the email takes
--     `OC4:staff:<id>:<epoch>:<n>`, outside the ladder, and carries
--     `pushOn` = '1' so its copy does not say it is an email because
--     notifications are off. A candidate with no device is unchanged.
--   · The job reports the extra emails as `oc4_also`; `oc4` still counts
--     the ones that replace a push.
--
-- The instructions themselves live in the register (templates.ts); the
-- row carries `step`, as before.
--
-- Only onboarding_chasers(timestamptz, text) changes, re-created from its
-- live body (md5 fb677bc1…, checked against project dgxtqvalfiisfpbwodew
-- on 21.10.2026) with three edits. Grants are unchanged and restated.
-- pgTAP: 900 and 394 follow; vitest in packages/notifications.
-- =====================================================================

create or replace function public.onboarding_chasers(
  p_now      timestamptz default now(),
  p_app_link text        default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cfg        jsonb := onboarding_chaser_config();
  v_clock      time  := uk_local(p_now)::time;
  v_link       text  := willo_interview_public_url();
  v_app        text  := btrim(coalesce(p_app_link, ''));
  v_oc1        integer;
  v_oc3        integer;
  v_oc4        integer;
  v_oc4_also   integer;
  v_activation jsonb;
begin
  if not coalesce((v_cfg ->> 'enabled')::boolean, true) then
    return jsonb_build_object('skipped', 'disabled in settings.onboarding_chasers');
  end if;
  if v_clock < (v_cfg ->> 'from')::time or v_clock >= (v_cfg ->> 'until')::time then
    return jsonb_build_object('skipped', 'outside ' || (v_cfg ->> 'from') || '–'
                                         || (v_cfg ->> 'until') || ' UK');
  end if;
  -- The app's onboarding page and nothing else: an https origin (or a local
  -- one, for development) followed by /onboarding. Anything else is no
  -- link, and every OC3 stays a push.
  if v_app !~ '^(https://[A-Za-z0-9.-]+|http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?)/onboarding$' then
    v_app := null;
  end if;

  if to_regclass('pg_temp._due') is not null then
    drop table _due;
  end if;
  create temporary table _due on commit drop as
    select c.*, s.email, s.first_name,
           -- ADR-0169: an OC3 goes by email when no device has notifications
           -- on, the address is there and the link is good.
           c.template = 'OC3'
             and v_app is not null
             and coalesce(btrim(s.email), '') <> ''
             and not exists (select 1 from push_subscriptions ps where ps.staff_id = c.staff_id)
             -- The address they sign in with, and no other.
             and lower(btrim(coalesce(u.email, ''))) = lower(btrim(s.email))
             as by_email,
           -- 20261023120000: the same test with the device condition turned
           -- round. A candidate who has notifications on is emailed as well
           -- as pushed.
           c.template = 'OC3'
             and v_app is not null
             and coalesce(btrim(s.email), '') <> ''
             and exists (select 1 from push_subscriptions ps where ps.staff_id = c.staff_id)
             and lower(btrim(coalesce(u.email, ''))) = lower(btrim(s.email))
             as also_email
      from onboarding_chaser_candidates(p_now) c
      join staff s on s.id = c.staff_id
      left join auth.users u on u.id = s.user_id
     where c.due_rung is not null;

  -- Existing staff read that the interview is part of moving onto the new
  -- app (existing_first / existing_second / existing_repeat). When the
  -- office has set the interview's public link, every OC1 carries it too.
  with ins as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, recipient_emails, payload)
    select 'OC1:staff:' || d.staff_id || ':' || d.epoch || ':' || d.due_rung,
           'email', 'OC1', d.staff_id, array[d.email],
           jsonb_build_object('name', d.first_name,
                              'variant', case when onboarding_chaser_existing_staff(d.staff_id)
                                              then 'existing_' else '' end
                                         || onboarding_chaser_variant(d.due_rung),
                              'rung', d.due_rung, 'at', p_now)
             || case when v_link is not null
                     then jsonb_build_object('interviewLink', v_link)
                     else '{}'::jsonb end
      from _due d
     where d.template = 'OC1' and coalesce(d.email, '') <> ''
    on conflict (key) do nothing
    returning 1
  ) select count(*) into v_oc1 from ins;

  with ins as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select 'OC3:staff:' || d.staff_id || ':' || d.epoch || ':' || d.due_rung,
           'push', 'OC3', d.staff_id,
           jsonb_build_object('step', d.step, 'stepNo', d.step_no,
                              'variant', onboarding_chaser_variant(d.due_rung),
                              'rung', d.due_rung, 'at', p_now)
      from _due d
     where d.template = 'OC3' and not d.by_email
    on conflict (key) do nothing
    returning 1
  ) select count(*) into v_oc3 from ins;

  -- OC4: the same rung, on OC3's key, by email.
  with ins as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, recipient_emails, payload)
    select 'OC3:staff:' || d.staff_id || ':' || d.epoch || ':' || d.due_rung,
           'email', 'OC4', d.staff_id, array[btrim(d.email)],
           jsonb_build_object('name', d.first_name, 'step', d.step, 'stepNo', d.step_no,
                              'variant', onboarding_chaser_variant(d.due_rung),
                              'link', v_app, 'pushOn', '0',
                              'rung', d.due_rung, 'at', p_now)
      from _due d
     where d.template = 'OC3' and d.by_email
    on conflict (key) do nothing
    returning 1
  ) select count(*) into v_oc4 from ins;

  -- OC4 as well as the push, for a candidate with a device. Its own key:
  -- the push holds OC3's, so the ladder counts the day once, and a re-run
  -- queues neither twice.
  with ins as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, recipient_emails, payload)
    select 'OC4:staff:' || d.staff_id || ':' || d.epoch || ':' || d.due_rung,
           'email', 'OC4', d.staff_id, array[btrim(d.email)],
           jsonb_build_object('name', d.first_name, 'step', d.step, 'stepNo', d.step_no,
                              'variant', onboarding_chaser_variant(d.due_rung),
                              'link', v_app, 'pushOn', '1',
                              'rung', d.due_rung, 'at', p_now)
      from _due d
     where d.template = 'OC3' and d.also_email
    on conflict (key) do nothing
    returning 1
  ) select count(*) into v_oc4_also from ins;

  -- OC2 needs a link minted outside the database: name them, queue nothing.
  select coalesce(jsonb_agg(jsonb_build_object(
           'staffId', d.staff_id::text,
           'userId',  s.user_id::text,
           'email',   d.email,
           'rung',    d.due_rung) order by d.progress_at), '[]'::jsonb)
    into v_activation
    from _due d
    join staff s on s.id = d.staff_id
   where d.template = 'OC2' and coalesce(d.email, '') <> '';

  return jsonb_build_object('oc1', v_oc1, 'oc3', v_oc3, 'oc4', v_oc4, 'oc4_also', v_oc4_also,
                            'oc2_due', jsonb_array_length(v_activation),
                            'activation', v_activation);
end $$;

comment on function public.onboarding_chasers(timestamptz, text) is
  'ADR-0071, the onboarding-chasers job: between settings.onboarding_chasers from/until (UK), queues the OC1 interview emails (existing staff moving onto the new app get the existing_* wording, 20261012123000; each carries the interview''s public link when settings.willo_interview_public_url is set, 20261016120000) and the OC3 wizard pushes due now — as OC4 emails with p_app_link (<STAFF_APP_URL>/onboarding) to a candidate with no push subscription (ADR-0169, 20261021120000), and as an OC4 email as well as the push to a candidate who has one (ADR-0186, 20261023120000, keyed OC4:staff:…) — and returns the OC2 activation reminders due (staffId, userId, email, rung) for the Edge Function to mint a link for. Idempotent on the outbox key. Service role only.';

revoke all on function public.onboarding_chasers(timestamptz, text) from public, anon, authenticated;
grant execute on function public.onboarding_chasers(timestamptz, text) to service_role;

update job_schedules
   set note = replace(note, 'OC4 the same reminder by email to a candidate with notifications off, ADR-0169', 'OC4 the same reminder by email — in place of the push for a candidate with notifications off, ADR-0169, and as well as it for everyone else, ADR-0186')
 where job = 'onboarding-chasers';
