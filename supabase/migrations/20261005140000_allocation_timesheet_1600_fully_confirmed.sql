-- =====================================================================
-- Migration 20261005140000 · The Allocation Timesheet goes at 16:00, and
--                            only once the event is fully confirmed
--                            (§11.3, §11.4; ADR-0074 amended by ADR-0087,
--                            THC 04.10.2026)
--
-- Two changes to the automatic D1 (20261002100000), nothing to D2:
--
--   1 · The cut-off is 16:00 UK the day before, not 14:00. The default,
--       the settings row and the job's note all move. (A value THC has
--       already edited by hand is left alone: only the shipped 14:00 is
--       changed.)
--
--   2 · After that cut-off the sheet goes out only when the event is 100%
--       confirmed — every role section holds at least its headcount of
--       firmly confirmed workers, and nobody is waiting to re-confirm. A
--       headcount, role or time change made after 16:00 therefore holds
--       the sheet back until the line-up is whole again, instead of
--       sending a half-filled one on the next run:
--
--         headcount raised / role added   → the new places are unfilled
--         time / venue / dress changed    → bookings go to reconfirm_required
--                                           (§3.5 "Awaiting")
--
--       "Firmly confirmed" is a booking in confirmed or worked with
--       reconfirm_required = false. The buffer is insurance on top of the
--       headcount and is not needed for the sheet to go (RULE-07: fill
--       counts only confirmed, against the headcount). Invited, applied and
--       Awaiting workers do not count.
--
--       The wait ends when the line-up is whole, or when the first shift
--       starts (`too_late`, as before) — the office can still Send by hand
--       at any time. At most ONE automatic send per event still holds
--       (event_document_autosends' primary key): a change made AFTER the
--       sheet went does not send a second one; the office resends.
--
-- The rule stays mirrored, verdict for verdict, by autosendVerdict() in
-- apps/office/app/api/jobs/event-documents/_lib/schedule.ts (pgTAP 760 and
-- schedule.test.ts hold the same cases). The new verdict is
-- `not_fully_confirmed`, reported after manual_sent and before gave_up.
--
-- document_autosend_verdict() gains a last argument, p_unfilled, and
-- event_documents_due() a last column, `unfilled`; both are restated and
-- re-granted to the service role alone, as in 20261002100000.
--
-- Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · 14:00 → 16:00 in the settings row and the job's note
-- ---------------------------------------------------------------------
update settings
   set value = jsonb_set(value, '{allocation,time}', '"16:00"')
 where key = 'document_autosend'
   and value->'allocation'->>'time' = '14:00';

update job_schedules
   set note = replace(note, 'the day before at 14:00 UK)', 'the day before at 16:00 UK, once every role is fully confirmed)')
 where job = 'event-documents';

-- ---------------------------------------------------------------------
-- 2 · How many places are still open or awaiting re-confirmation
-- ---------------------------------------------------------------------
create or replace function public.event_document_unfilled(p_event uuid)
returns int
language sql stable set search_path = public, extensions as $$
  select coalesce(sum(greatest(sr.headcount - f.firm, 0)), 0)::int
    from shift_requirements sr
    cross join lateral (
      select count(*)::int as firm
        from bookings b
       where b.shift_id = sr.id
         and b.status in ('confirmed', 'worked')
         and not b.reconfirm_required
    ) f
   where sr.event_id = p_event
$$;

comment on function public.event_document_unfilled(uuid) is
  'ADR-0087: places short of the headcount across the event''s role sections, counting only firmly confirmed workers (confirmed or worked, not awaiting re-confirmation). 0 = the event is 100% confirmed. Service role only.';

-- ---------------------------------------------------------------------
-- 3 · The rule, with the new verdict (mirrors schedule.ts)
-- ---------------------------------------------------------------------
drop function if exists public.document_autosend_verdict(
  text, timestamptz, jsonb, date, timestamptz, timestamptz, boolean, int, int, int, timestamptz, timestamptz, timestamptz, int);

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
  p_attempts             int default 0,
  -- Places short of the headcount (event_document_unfilled); D1 only.
  p_unfilled             int default 0
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
      when coalesce(p_unfilled, 0) > 0      then 'not_fully_confirmed'
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

comment on function public.document_autosend_verdict(text, timestamptz, jsonb, date, timestamptz, timestamptz, boolean, int, int, int, timestamptz, timestamptz, timestamptz, int, int) is
  'ADR-0074/0087: due | disabled | already_sent | cancelled | not_yet | too_late | before_activation | hold_expired | no_confirmed_staff | no_contact_emails | manual_sent | not_fully_confirmed (D1 only: a role section is short of its headcount, or someone is awaiting re-confirmation) | held_no_checkout | gave_up (eight claims spent) for one automatic D1/D2. Pure; mirrored by autosendVerdict() in apps/office/app/api/jobs/event-documents/_lib/schedule.ts.';

create or replace function public.document_autosend_config()
returns jsonb
language sql stable set search_path = public, extensions as $$
  -- A missing row is the defaults with the job switched OFF: without the
  -- migration's not_before a first run would reach back a fortnight.
  select coalesce((select value from settings where key = 'document_autosend'),
                  '{"allocation":{"enabled":false,"time":"16:00"},"completed":{"enabled":false,"time":"10:00","hold_days":14}}'::jsonb)
$$;

-- ---------------------------------------------------------------------
-- 4 · event_documents_due — the same candidates, plus `unfilled`
-- ---------------------------------------------------------------------
drop function if exists public.event_documents_due(timestamptz, uuid);

create or replace function public.event_documents_due(
  p_now   timestamptz default now(),
  p_event uuid default null
) returns table (
  event_id             uuid,
  kind                 text,
  verdict              text,
  event_date           date,
  first_start          timestamptz,
  last_end             timestamptz,
  cancelled            boolean,
  confirmed            int,
  contacts             int,
  undetermined         int,
  manual_allocation_at timestamptz,
  signout_queued_at    timestamptz,
  auto_queued_at       timestamptz,
  attempts             int,
  unfilled             int
)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_cfg   jsonb := document_autosend_config();
  v_today date  := (p_now at time zone 'Europe/London')::date;
  v_hold  int   := case when jsonb_typeof(v_cfg->'completed'->'hold_days') = 'number'
                          and (v_cfg->'completed'->>'hold_days') ~ '^[0-9]{1,4}$'
                         then (v_cfg->'completed'->>'hold_days')::int else 14 end;
begin
  return query
  with ev as (
    select e.id, e.event_date, e.cancelled_at is not null as cancelled,
           coalesce(array_length(c.contact_emails, 1), 0) as contacts,
           (select min(sr.starts_at) from shift_requirements sr where sr.event_id = e.id) as first_start,
           (select max(sr.ends_at)   from shift_requirements sr where sr.event_id = e.id) as last_end
      from events e
      join clients c on c.id = e.client_id
     where (p_event is null and e.event_date between v_today - (v_hold + 2) and v_today + 1)
        or e.id = p_event
  ), facts as (
    select ev.*, k.kind, t.confirmed, t.undetermined,
           event_document_unfilled(ev.id) as unfilled,
           (select max(d.queued_at) from event_documents d
             where d.event_id = ev.id and d.kind = 'allocation' and not d.automatic) as manual_allocation_at,
           (select max(d.queued_at) from event_documents d
             where d.event_id = ev.id and d.kind = 'signout') as signout_queued_at,
           (select a.queued_at from event_document_autosends a
             where a.event_id = ev.id and a.kind = k.kind) as auto_queued_at,
           -- Claims spent: a claim whose lease is still live is the run
           -- working on it now, and not yet spent.
           coalesce((select a.attempts - case when a.lease_until > p_now then 1 else 0 end
                       from event_document_autosends a
                      where a.event_id = ev.id and a.kind = k.kind), 0) as attempts
      from ev
      cross join (values ('allocation'::text), ('signout')) as k(kind)
      cross join lateral event_document_tally(ev.id) t
  )
  select f.id, f.kind,
         document_autosend_verdict(f.kind, p_now, v_cfg, f.event_date, f.first_start, f.last_end,
                                   f.cancelled, f.confirmed, f.contacts, f.undetermined,
                                   f.manual_allocation_at, f.signout_queued_at, f.auto_queued_at,
                                   f.attempts, f.unfilled),
         f.event_date, f.first_start, f.last_end, f.cancelled, f.confirmed, f.contacts,
         f.undetermined, f.manual_allocation_at, f.signout_queued_at, f.auto_queued_at,
         f.attempts, f.unfilled
    from facts f
   order by f.event_date, f.id, f.kind;
end $$;

comment on function public.event_documents_due(timestamptz, uuid) is
  'ADR-0074/0087: the event-documents job''s candidates — events dated hold_days + 2 days ago to tomorrow (UK), or one event — with the facts document_autosend_verdict() reads (unfilled: places short of the headcount) and its verdict per kind. Service role only.';

-- ---------------------------------------------------------------------
-- 5 · Grants — still the service role's alone
-- ---------------------------------------------------------------------
revoke execute on function
  public.event_document_unfilled(uuid),
  public.document_autosend_verdict(text, timestamptz, jsonb, date, timestamptz, timestamptz, boolean, int, int, int, timestamptz, timestamptz, timestamptz, int, int),
  public.document_autosend_config(),
  public.event_documents_due(timestamptz, uuid)
from public, anon, authenticated;

grant execute on function
  public.event_document_unfilled(uuid),
  public.document_autosend_verdict(text, timestamptz, jsonb, date, timestamptz, timestamptz, boolean, int, int, int, timestamptz, timestamptz, timestamptz, int, int),
  public.document_autosend_config(),
  public.event_documents_due(timestamptz, uuid)
to service_role;
