-- =====================================================================
-- OC1 · a one-off notice to existing staff who have registered but not
-- taken their Willo interview (owner request, 14.10.2026)
--
-- The owner asked for two things the same day. The daily OC1 reminders to
-- existing staff are firmer (packages/notifications/src/templates.ts, the
-- existing_* rungs): without clicking the link, taking the online
-- interview and fully onboarding, we will be unable to offer them any more
-- shifts going forwards. And everyone in that position now is sent that
-- message once, straight away, rather than waiting for their next daily
-- rung. This is that send.
--
-- Who: exactly the people the daily OC1 run chases with the existing_*
-- wording, whether or not a rung is due today —
--   · in Interview requested, Willo's invitation (E1) sent, no answers in
--     (onboarding_chaser_candidates(), track 'interview'), and
--   · existing staff (onboarding_chaser_existing_staff(): matched to the
--     invite list, applied from a list, or carrying a Payroll ID),
--   · with an email address, and not removed.
-- Not a new applicant, and not somebody Willo has not invited yet (they
-- have no interview to take; E1 and then OC1 reach them as usual).
--
-- What: OC1 with variant `existing_notice`, so the OC1 switch on
-- /settings → Notifications governs it like every other OC1.
--
-- Once: key `OC1:notice:<staff id>`. It sits outside the daily ladder's
-- `OC1:staff:<id>:<epoch>:<n>` keys, so it is not counted as a rung and
-- does not move the daily run. Calling the function again sends nobody a
-- second notice.
--
-- When: inside the chasers' UK daytime (settings.onboarding_chasers
-- from/until, 10:00–18:00 by default). Applied outside it, the rows wait
-- in the outbox (send_after) for the next opening. Paced two seconds apart
-- like IR1, so a few hundred of them never hold an N9 or an invitation up.
--
-- The migration calls it once, at deploy. On a fresh database (CI, a
-- preview branch, `supabase db reset`) the seed loads afterwards, so it
-- finds nobody and sends nothing.
--
-- pgTAP: supabase/tests/835_oc1_existing_staff_notice.sql.
-- =====================================================================

create or replace function public.oc1_existing_staff_notice(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cfg   jsonb     := onboarding_chaser_config();
  v_from  time      := (v_cfg ->> 'from')::time;
  v_until time      := (v_cfg ->> 'until')::time;
  v_local timestamp := uk_local(p_now);
  v_start timestamptz;
  v_n     integer;
begin
  -- The first instant inside the UK daytime window, now or later.
  v_start := case
    when v_local::time >= v_from and v_local::time < v_until then p_now
    when v_local::time < v_from then (v_local::date + v_from) at time zone 'Europe/London'
    else (v_local::date + 1 + v_from) at time zone 'Europe/London'
  end;

  with due as (
    select c.staff_id, s.email, s.first_name,
           row_number() over (order by s.email, c.staff_id) - 1 as n
      from onboarding_chaser_candidates(p_now) c
      join staff s on s.id = c.staff_id
     where c.template = 'OC1'
       and s.removed_at is null
       and coalesce(btrim(s.email), '') <> ''
       and onboarding_chaser_existing_staff(c.staff_id)
       and not exists (select 1 from notification_outbox o
                        where o.key = 'OC1:notice:' || c.staff_id)
  ), ins as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, recipient_emails, payload, send_after)
    select 'OC1:notice:' || d.staff_id,
           'email', 'OC1', d.staff_id, array[d.email],
           jsonb_build_object('name', d.first_name, 'variant', 'existing_notice', 'at', p_now),
           v_start + d.n * interval '2 seconds'
      from due d
    on conflict (key) do nothing
    returning 1
  ) select count(*) into v_n from ins;

  return jsonb_build_object('queued', v_n, 'from', v_start);
end $$;

comment on function public.oc1_existing_staff_notice(timestamptz) is
  'Owner request 14.10.2026: queues OC1 variant existing_notice once (key OC1:notice:<staff id>) to every existing member of staff in Interview requested whose Willo invitation went out and who has not done the interview — no interview and full onboarding, no more shifts. Inside the chasers'' UK daytime, two seconds apart. Idempotent. Service role only.';

revoke all on function public.oc1_existing_staff_notice(timestamptz) from public, anon, authenticated;
grant execute on function public.oc1_existing_staff_notice(timestamptz) to service_role;

-- The send itself, once, at deploy.
select public.oc1_existing_staff_notice();
