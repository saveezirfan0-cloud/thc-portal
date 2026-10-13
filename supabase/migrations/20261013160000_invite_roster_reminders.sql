-- =====================================================================
-- Migration 20261013160000 · IR1: a daily reminder to everyone on the THC
--                            invite list who has not applied yet
--                            (ADR-0122; owner request, 13.10.2026)
--
-- invite_roster (ADR-0107) is exactly "invited, not applied yet": a row is
-- consumed the moment somebody applies with its email. THC's own staff are
-- moving off AXLR8 and onto the new app, and 898 of them had not applied
-- five days after the invitations went out. The owner asked for a daily
-- email to them, from within the app, until they apply.
--
-- Who: every invite_roster row in the `thc` group. SpudBros Express rows
-- are not reminded (they apply on /apply/spudbros, with other copy).
-- Never anyone the system already holds under that email: a row KEPT after
-- its person applied (a name the sheet spelt differently, a Payroll ID
-- somebody else holds — ADR-0107) belongs to somebody who has applied, and
-- telling them they have not would be untrue.
--
-- When: once per UK calendar day, on the first run of the hourly
-- onboarding-chasers job inside settings.invite_roster_reminders from/until
-- (10:00–18:00 UK by default — the same daytime as OC1–OC3). The key
-- `IR1:roster:<row id>:<UK date>` makes it one a day whatever the job does.
-- A missed day (the job paused, a deploy) is not caught up.
--
-- Until: they apply (the row is consumed, so nothing is queued the next
-- day), the office removes them from the list on /staff/roster, or the
-- switch `enabled` is set to false.
--
-- The Register button: the Edge Function passes `<STAFF_APP_URL>/apply`,
-- the ordinary link, the one the THC invitation carried. Without a usable
-- link nothing is queued and the run says why: a reminder without its
-- button is worse than none.
--
-- The drain sends 40 a minute, so a full list goes out in about 25
-- minutes of the first run.
--
-- pgTAP: supabase/tests/811_invite_roster_reminders.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The switch and the window
-- ---------------------------------------------------------------------
insert into settings (key, value) values
  ('invite_roster_reminders', '{"enabled": true, "from": "10:00", "until": "18:00"}')
on conflict (key) do nothing;

-- A part that is missing or not sane keeps its default, so a typo in the
-- SQL editor can never break the hourly job (the onboarding_chaser_config
-- rule, ADR-0071).
create or replace function public.invite_roster_reminder_config()
returns jsonb
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  d jsonb := '{"enabled": true, "from": "10:00", "until": "18:00"}';
  v jsonb;
begin
  select value into v from settings where key = 'invite_roster_reminders';
  if v is null or jsonb_typeof(v) <> 'object' then
    return d;
  end if;
  if jsonb_typeof(v -> 'enabled') = 'boolean' then
    d := d || jsonb_build_object('enabled', v -> 'enabled');
  end if;
  if (v ->> 'from') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     and (v ->> 'until') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    if (v ->> 'from')::time < (v ->> 'until')::time then
      d := d || jsonb_build_object('from', v ->> 'from', 'until', v ->> 'until');
    end if;
  end if;
  return d;
end $$;

comment on function public.invite_roster_reminder_config() is
  'ADR-0122: settings.invite_roster_reminders over its defaults — enabled, from/until (the UK hours the daily IR1 reminder may be queued).';

revoke all on function public.invite_roster_reminder_config() from public, anon, authenticated;
grant execute on function public.invite_roster_reminder_config() to service_role;

-- ---------------------------------------------------------------------
-- 2 · The job
-- ---------------------------------------------------------------------
create or replace function public.invite_roster_reminders(
  p_now        timestamptz default now(),
  p_apply_link text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cfg   jsonb := invite_roster_reminder_config();
  v_clock time  := uk_local(p_now)::time;
  v_day   date  := uk_local(p_now)::date;
  v_link  text  := btrim(coalesce(p_apply_link, ''));
  v_n     integer;
begin
  if not coalesce((v_cfg ->> 'enabled')::boolean, true) then
    return jsonb_build_object('skipped', 'disabled in settings.invite_roster_reminders');
  end if;
  if v_clock < (v_cfg ->> 'from')::time or v_clock >= (v_cfg ->> 'until')::time then
    return jsonb_build_object('skipped', 'outside ' || (v_cfg ->> 'from') || '–'
                                         || (v_cfg ->> 'until') || ' UK');
  end if;
  -- The ordinary application page and nothing else: an https origin (or a
  -- local one, for development) followed by /apply.
  if v_link !~ '^(https://[A-Za-z0-9.-]+|http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?)/apply$' then
    return jsonb_build_object('skipped', 'no apply link (STAFF_APP_URL is not set or not an origin)');
  end if;

  with ins as (
    insert into notification_outbox (key, channel, template, recipient_emails, payload)
    select 'IR1:roster:' || r.id || ':' || v_day,
           'email', 'IR1', array[r.email],
           case when coalesce(btrim(r.first_name), '') <> ''
                then jsonb_build_object('variant', 'named', 'name', btrim(r.first_name))
                else jsonb_build_object('variant', 'unnamed')
           end
           || jsonb_build_object('applyLink', v_link, 'day', v_day, 'at', p_now)
      from invite_roster r
     where r.grp = 'thc'
       and not exists (select 1 from staff s
                        where lower(btrim(s.email)) = r.email
                          and s.removed_at is null)
    on conflict (key) do nothing
    returning 1
  ) select count(*) into v_n from ins;

  return jsonb_build_object('ir1', v_n, 'day', v_day);
end $$;

comment on function public.invite_roster_reminders(timestamptz, text) is
  'ADR-0122, run by the onboarding-chasers job: between settings.invite_roster_reminders from/until (UK), queues one IR1 email per UK day to every THC invite_roster row whose email nobody in staff holds yet — invited, not applied — with p_apply_link (<STAFF_APP_URL>/apply) as its button. Idempotent on the outbox key. Service role only.';

revoke all on function public.invite_roster_reminders(timestamptz, text) from public, anon, authenticated;
grant execute on function public.invite_roster_reminders(timestamptz, text) to service_role;

-- The job's note names its new half.
update job_schedules
   set note = 'ADR-0071 onboarding chasers: OC1/OC2 emails before sign-up, OC3 pushes after, daily while there is no progress, never stopping; and ADR-0122 IR1, the daily reminder to THC invite-list rows not yet applied. Hourly; both queue only between their settings'' from/until (UK).'
 where job = 'onboarding-chasers';
