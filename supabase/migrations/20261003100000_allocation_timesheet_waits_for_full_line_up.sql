-- =====================================================================
-- Migration 20261003100000 · The automatic Allocation Timesheet waits for
--                            a full line-up (§3.2, §11.4; ADR-0084)
--
-- What changes
-- ------------
-- D1 (20261002100000) went out at the configured time the day before for
-- any event with at least one confirmed worker, however many slots were
-- still empty — so a client could be sent a line-up with gaps in it. It
-- now goes only when EVERY role section has reached its headcount:
--
--   unfilled = sum over the event's role sections of
--              max(0, headcount − confirmed-or-worked bookings)
--
-- The same count as shift_fill(): confirmed counts ONLY confirmed (and the
-- worked booking that still holds its slot, ADR-0037); invitations never
-- fill. The buffer is not part of it — it is a confirmation target, not
-- the working headcount (§3.2, RULE-15) — and a section over its headcount
-- cannot cover for one under it, so the sum is taken per section.
--
-- unfilled > 0 gives the new verdict `not_filled`. It is not final: the
-- job runs every 15 minutes, so the Allocation Timesheet goes on the first
-- run after the last gap fills, up to the first shift's start (`too_late`
-- then, as before). The manual Send button is unchanged. D2 is unchanged.
-- Because queue_event_document_autosend() re-takes the verdict under the
-- lock, a worker dropping out while the PDF is drawn stands the send down.
--
-- Where it sits in the order: after manual_sent, before gave_up — the
-- earlier skips (disabled, already_sent, cancelled, not_yet, too_late,
-- no_confirmed_staff, no_contact_emails, manual_sent) keep their place.
--
-- Mirrored, verdict for verdict, by autosendVerdict() in
-- apps/office/app/api/jobs/event-documents/_lib/schedule.ts (the Vitest
-- file and pgTAP 760 hold the same cases).
--
-- Two function bodies are restated from 20261002100000 with exactly one
-- change each: document_autosend_verdict() gains the `not_filled` line and
-- a trailing p_unfilled parameter (default 0 = full, so a caller that does
-- not pass it reads as before); event_documents_due() gains the `unfilled`
-- column. Both are dropped and recreated (a changed signature / return
-- type), so their service-role-only grants are restated.
--
-- Forward-only.
-- =====================================================================

drop function if exists public.event_documents_due(timestamptz, uuid);
drop function if exists public.document_autosend_verdict(text, timestamptz, jsonb, date, timestamptz, timestamptz, boolean, int, int, int, timestamptz, timestamptz, timestamptz, int);

-- ---------------------------------------------------------------------
-- 1 · The rule
-- ---------------------------------------------------------------------
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
  -- Headcount slots still empty over the role sections (ADR-0084); 0 = full.
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
                          else case p_kind when 'allocation' then '14:00' else '10:00' end
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
      when coalesce(p_unfilled, 0) > 0      then 'not_filled'
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
  'ADR-0074/0084: due | disabled | already_sent | cancelled | not_yet | too_late | before_activation | hold_expired | no_confirmed_staff | no_contact_emails | manual_sent | not_filled (D1 only: a role section is short of its headcount) | held_no_checkout | gave_up (eight claims spent) for one automatic D1/D2. Pure; mirrored by autosendVerdict() in apps/office/app/api/jobs/event-documents/_lib/schedule.ts.';

-- ---------------------------------------------------------------------
-- 2 · event_documents_due — with `unfilled`
-- ---------------------------------------------------------------------
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
  unfilled             int,
  manual_allocation_at timestamptz,
  signout_queued_at    timestamptz,
  auto_queued_at       timestamptz,
  attempts             int
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
    select ev.*, k.kind, t.confirmed, t.undetermined, u.unfilled,
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
      -- ADR-0084: headcount slots still empty, per role section — the
      -- fill shift_fill() counts (confirmed or worked), buffer excluded.
      cross join lateral (
        select coalesce(sum(greatest(0, sr.headcount - f.n)), 0)::int as unfilled
          from shift_requirements sr
          cross join lateral (
            select count(*)::int as n from bookings b
             where b.shift_id = sr.id and b.status in ('confirmed', 'worked')) f
         where sr.event_id = ev.id) u
  )
  select f.id, f.kind,
         document_autosend_verdict(f.kind, p_now, v_cfg, f.event_date, f.first_start, f.last_end,
                                   f.cancelled, f.confirmed, f.contacts, f.undetermined,
                                   f.manual_allocation_at, f.signout_queued_at, f.auto_queued_at,
                                   f.attempts, f.unfilled),
         f.event_date, f.first_start, f.last_end, f.cancelled, f.confirmed, f.contacts,
         f.undetermined, f.unfilled, f.manual_allocation_at, f.signout_queued_at, f.auto_queued_at,
         f.attempts
    from facts f
   order by f.event_date, f.id, f.kind;
end $$;

comment on function public.event_documents_due(timestamptz, uuid) is
  'ADR-0074/0084: the event-documents job''s candidates — events dated hold_days + 2 days ago to tomorrow (UK), or one event — with the facts document_autosend_verdict() reads (unfilled: headcount slots still empty over the role sections) and its verdict per kind. Service role only.';

-- ---------------------------------------------------------------------
-- 3 · Grants — the job's functions are the service role's alone
-- ---------------------------------------------------------------------
revoke execute on function
  public.document_autosend_verdict(text, timestamptz, jsonb, date, timestamptz, timestamptz, boolean, int, int, int, timestamptz, timestamptz, timestamptz, int, int),
  public.event_documents_due(timestamptz, uuid)
from public, anon, authenticated;

grant execute on function
  public.document_autosend_verdict(text, timestamptz, jsonb, date, timestamptz, timestamptz, boolean, int, int, int, timestamptz, timestamptz, timestamptz, int, int),
  public.event_documents_due(timestamptz, uuid)
to service_role;
