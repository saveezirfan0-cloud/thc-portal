-- =====================================================================
-- The automatic Allocation Timesheet goes at 16:00, not 14:00
--
-- THC, 02.10.2026: "Timesheets should be sent at 16:00 not 14:00."
-- ADR-0074's D1 — the day before the event, UK time — moves two hours
-- later. Everything else about it is unchanged: any later run still
-- sends it until the first shift starts (an event filled after 16:00
-- still gets one), it is skipped for an event with nobody confirmed at
-- that run and tried again on every run after, and a manager's own Send
-- since 00:00 UK the day before stands in for it.
--
-- 1 · settings.document_autosend.allocation.time → "16:00".
-- 2 · The two places a missing or malformed time falls back to a
--     default — document_autosend_verdict() and document_autosend_config()
--     — say 16:00 too, so the SQL twin still matches
--     parseAutosendConfig()'s DEFAULT_TIMES in schedule.ts. Both bodies
--     are 20261002100000's with only that literal changed.
-- 3 · The job's note.
--
-- Forward-only.
-- =====================================================================

-- 1 ·
update settings
   set value = jsonb_set(value, '{allocation,time}', '"16:00"'::jsonb, true)
 where key = 'document_autosend';

-- 2 ·
create or replace function public.document_autosend_verdict(
  p_kind                 text,
  p_now                  timestamptz,
  p_config               jsonb,
  p_event_date           date,
  p_first_start          timestamptz,
  p_last_end             timestamptz,
  p_cancelled            boolean,
  p_confirmed            int,
  p_contacts             int,
  p_undetermined         int,
  p_manual_allocation_at timestamptz,
  p_signout_queued_at    timestamptz,
  p_auto_queued_at       timestamptz,
  -- Claims already spent on this event and kind (a live one not counted).
  p_attempts             int default 0
) returns text
language plpgsql immutable set search_path = public, extensions as $$
declare
  v_cfg     jsonb := coalesce(p_config, '{}'::jsonb)
                       -> case p_kind when 'allocation' then 'allocation' else 'completed' end;
  -- Read exactly as parseAutosendConfig() reads it: a value of the wrong
  -- shape takes the default instead of failing the run.
  v_enabled boolean := case when jsonb_typeof(v_cfg->'enabled') = 'boolean'
                            then (v_cfg->>'enabled')::boolean else true end;
  v_time    time := (case when coalesce(v_cfg->>'time', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                          then v_cfg->>'time'
                          else case p_kind when 'allocation' then '16:00' else '10:00' end
                     end)::time;
  v_hold    int := case when jsonb_typeof(v_cfg->'hold_days') = 'number'
                         and (v_cfg->>'hold_days') ~ '^[0-9]{1,4}$'
                        then (v_cfg->>'hold_days')::int else 14 end;
  v_not_before timestamptz;
  v_due     timestamptz;
  v_stop    timestamptz;
begin
  if jsonb_typeof(v_cfg->'not_before') = 'string' then
    begin
      v_not_before := (v_cfg->>'not_before')::timestamptz;
    exception when others then
      v_not_before := null;
    end;
  end if;
  if p_kind = 'allocation' then
    -- The day before, at v_time on the London clock.
    v_due := ((p_event_date - 1) + v_time) at time zone 'Europe/London';
    return case
      when not v_enabled                    then 'disabled'
      when p_auto_queued_at is not null     then 'already_sent'
      when p_cancelled                      then 'cancelled'
      when p_now < v_due                    then 'not_yet'
      when p_first_start is not null
           and p_now >= p_first_start       then 'too_late'
      when coalesce(p_confirmed, 0) = 0     then 'no_confirmed_staff'
      when coalesce(p_contacts, 0) = 0      then 'no_contact_emails'
      when p_manual_allocation_at >= ((p_event_date - 1)::timestamp at time zone 'Europe/London')
                                            then 'manual_sent'
      when coalesce(p_attempts, 0) >= 8     then 'gave_up'
      else 'due'
    end;
  end if;

  -- Completed: the morning after, and never before every check-out
  -- window (end + 4 h) has closed; given up hold_days after that morning.
  v_due  := greatest(((p_event_date + 1) + v_time) at time zone 'Europe/London',
                     p_last_end + interval '4 hours');
  v_stop := ((p_event_date + 1 + v_hold) + v_time) at time zone 'Europe/London';
  return case
    when not v_enabled                      then 'disabled'
    when p_auto_queued_at is not null       then 'already_sent'
    when p_cancelled                        then 'cancelled'
    when p_now < v_due                      then 'not_yet'
    when v_due < v_not_before               then 'before_activation'
    when p_now >= v_stop                    then 'hold_expired'
    when coalesce(p_confirmed, 0) = 0       then 'no_confirmed_staff'
    when coalesce(p_contacts, 0) = 0        then 'no_contact_emails'
    when p_signout_queued_at >= p_last_end  then 'manual_sent'
    when coalesce(p_undetermined, 0) > 0    then 'held_no_checkout'
    when coalesce(p_attempts, 0) >= 8       then 'gave_up'
    else 'due'
  end;
end $$;

create or replace function public.document_autosend_config()
returns jsonb
language sql stable set search_path = public, extensions as $$
  -- A missing row is the defaults with the job switched OFF: without the
  -- migration's not_before a first run would reach back a fortnight.
  select coalesce((select value from settings where key = 'document_autosend'),
                  '{"allocation":{"enabled":false,"time":"16:00"},"completed":{"enabled":false,"time":"10:00","hold_days":14}}'::jsonb)
$$;

-- 3 ·
update job_schedules
   set note = replace(note, 'the day before at 14:00 UK', 'the day before at 16:00 UK')
 where job = 'event-documents';
