-- =====================================================================
-- Migration 20261002100000 · The Allocation Timesheet and the Completed
--                            Allocation Timesheet go out on their own
--                            (§11.3, §11.4; ADR-0074, THC 29.09.2026)
--
-- What changes
-- ------------
-- Until now both documents were emailed only when a manager pressed Send
-- on the event page (20260923130100). THC decided on 29.09.2026 that they
-- also go automatically, and the buttons stay:
--
--   D1 · Allocation Timesheet — the day before the event at 14:00 UK,
--        after the 12:00 "I'm ready" deadline and the 12:05 release, so
--        the line-up is firm. An event created or filled after 14:00 still
--        gets one on the next run, as long as its first shift has not
--        started. Skipped when a manager already queued a D1 for it since
--        00:00 UK the day before — the client has a fresh one.
--   D2 · Completed Allocation Timesheet — the morning after the event day
--        at 10:00 UK (and never before the last shift's end + 4 h, when
--        the last check-out window closes). HELD while any worker on it
--        still has blank Finish/Hours — an unresolved No check-out
--        (RULE-02): a blank the manager can still fix is never sent. Sent
--        on the first run after they are all resolved, for up to 14 days;
--        after that the job stops trying (the button still works).
--        Skipped when a D2 was already queued after the event ended.
--   Both · skipped for a cancelled event (§3.3: no document at all), an
--        event with nobody confirmed, and a client card with no contact
--        emails. A skip is a reason in the job run's counts, never an
--        error. At most ONE automatic send per event and kind:
--        event_document_autosends' primary key, and the outbox key
--        'D1:auto:<event>' / 'D2:auto:<event>'.
--
-- The times and switches are the settings row `document_autosend`, read on
-- every run. The rule is mirrored, verdict for verdict, by the pure
-- TypeScript in apps/office/app/api/jobs/event-documents/_lib/schedule.ts;
-- the route acts only when both say `due` (pgTAP 759 and the Vitest file
-- hold the same cases).
--
-- Why a Back Office route and not an Edge Function
-- ------------------------------------------------
-- The PDF is drawn by @react-pdf/renderer in Node, which Deno cannot run —
-- the same reason as rtw-check (ADR-0025). So the job is
-- apps/office/app/api/jobs/event-documents, posted to by pg_cron every 15
-- minutes at the vault's office_base_url with the SAME bearer secret as
-- rtw-check (vault rtw_job_secret, env RTW_JOB_SECRET; ADR-0074 records
-- the sharing). It is registered ENABLED: both vault secrets already
-- exist wherever rtw-check runs, and without them install_job_schedules()
-- skips the row with a notice (20260928100100) rather than failing.
--
-- Who may call what
-- -----------------
-- Every function below that the route calls is service-role only: revoked
-- from public, anon and authenticated, granted to service_role, like
-- rtw_check_claim / rtw_check_record. An office, client or worker session
-- can call nothing new. The manual path is unchanged: event_document_data,
-- record_event_document and queue_event_document_email keep
-- assert_reports_caller(). queue_event_document_email is restated from its
-- only body (20260923130100) with one change — the payload comes from
-- event_document_email_payload(), which adds `schedule`, `totalHours`
-- (D2) and `documentName` and keeps every existing key.
--
-- New table: event_document_autosends — admin read, no client or staff
-- policy (ADR-0026: the client role holds no table policy), the
-- office_read_only guard (ADR-0060), written only by the functions here.
--
-- Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The switches and times (settings, read every run)
-- ---------------------------------------------------------------------
-- completed.not_before: D2 is sent automatically only for an event whose
-- D2 time (the morning after) falls on or after this instant — when this
-- migration ran. Without it, switching the job on would email every client
-- a Completed Allocation Timesheet for up to a fortnight of past events the
-- office had chosen not to send.
insert into settings (key, value) values
  ('document_autosend',
   jsonb_build_object(
     'allocation', jsonb_build_object('enabled', true, 'time', '14:00'),
     'completed',  jsonb_build_object('enabled', true, 'time', '10:00', 'hold_days', 14,
                                      'not_before', now())))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2 · A copy the job drew is marked as such
-- ---------------------------------------------------------------------
alter table event_documents add column if not exists automatic boolean not null default false;

comment on column event_documents.automatic is
  'ADR-0074: true for a copy drawn and queued by the event-documents job (generated_by is then null); false for a manager''s Download or Send.';

-- ---------------------------------------------------------------------
-- 3 · event_document_autosends — at most one automatic send per event
--     and kind, with the claim a run holds while it draws the PDF
-- ---------------------------------------------------------------------
create table event_document_autosends (
  event_id    uuid not null references events(id),
  kind        text not null check (kind in ('allocation', 'signout')),
  claimed_at  timestamptz not null default now(),
  -- A run holds the claim until this; a run that died leaves it to lapse.
  lease_until timestamptz,
  attempts    int  not null default 0 check (attempts >= 0),
  last_error  text,
  document_id uuid references event_documents(id),
  outbox_key  text unique,
  -- Set once the email is queued. From then on the event is done for
  -- this kind: nothing clears it.
  queued_at   timestamptz,
  primary key (event_id, kind)
);

create index event_document_autosends_document_idx on event_document_autosends (document_id);

alter table event_document_autosends enable row level security;
-- Wrapped: evaluated once per statement, not per row (747, 20261001200700).
create policy admin_read on event_document_autosends for select using ((select current_app_role()) = 'admin');

-- ADR-0060: a viewer can change nothing (the job writes with no session,
-- which the guard lets through).
drop trigger if exists office_read_only on public.event_document_autosends;
create trigger office_read_only before insert or update or delete or truncate
  on public.event_document_autosends
  for each statement execute function public.office_read_only_guard();

revoke all on event_document_autosends from public, anon, authenticated;
grant select on event_document_autosends to authenticated;
grant all on event_document_autosends to service_role;

comment on table event_document_autosends is
  'ADR-0074: the automatic D1 (Allocation Timesheet) and D2 (Completed Allocation Timesheet) sends — one row per event and kind, claimed by the event-documents job, done once queued_at is set. Admin-read; written only by event_document_autosend_claim / record_event_document_autosend / queue_event_document_autosend / event_document_autosend_release (service role).';

-- ---------------------------------------------------------------------
-- 4 · Small helpers
-- ---------------------------------------------------------------------

-- "7h 30m", "45m", "8h" — packages/pdf's hoursMinutes(), for the payload.
create or replace function public.document_hours_label(p_min int)
returns text
language sql immutable set search_path = public, extensions as $$
  select case
    when p_min is null then ''
    when p_min / 60 = 0 then (p_min % 60)::text || 'm'
    when p_min % 60 = 0 then (p_min / 60)::text || 'h'
    else (p_min / 60)::text || 'h ' || (p_min % 60)::text || 'm'
  end
$$;

-- The line-up's numbers, as event_document_data() draws them: confirmed
-- and worked bookings; `undetermined` = rows whose Finish and Hours print
-- blank because the figure is not settled yet (an unresolved No check-out,
-- RULE-02, or a shift not yet under way); `worked_min` = the sheet's Total
-- Hours (settled rows only, no-shows excluded).
create or replace function public.event_document_tally(p_event uuid)
returns table (confirmed int, undetermined int, worked_min int)
language sql stable set search_path = public, extensions as $$
  select count(*)::int,
         (count(*) filter (where ps.booking_id is null
                              or (ps.kind <> 'no_show' and ps.pay->>'status' is distinct from 'settled')))::int,
         coalesce(sum((ps.pay->>'workedMin')::int)
                    filter (where ps.kind <> 'no_show' and ps.pay->>'status' = 'settled'), 0)::int
    from bookings b
    join shift_requirements sr on sr.id = b.shift_id
    left join payable_shifts_v ps on ps.booking_id = b.id
   where sr.event_id = p_event
     and b.status in ('confirmed', 'worked')
$$;

-- "Chef 07:00 – 15:00 · Waiting Staff 17:00 – 23:30": the role sections
-- with confirmed staff, in sheet order (their own start, RULE-18), UK time.
create or replace function public.event_document_schedule(p_event uuid)
returns text
language sql stable set search_path = public, extensions as $$
  select coalesce(string_agg(
           s.role_name || ' '
             || to_char(s.starts_at at time zone 'Europe/London', 'HH24:MI') || ' – '
             || to_char(s.ends_at   at time zone 'Europe/London', 'HH24:MI'),
           ' · ' order by s.starts_at, lower(s.role_name), s.ends_at), '')
    from (select distinct r.name as role_name, sr.starts_at, sr.ends_at
            from shift_requirements sr
            join roles r on r.id = sr.role_id
           where sr.event_id = p_event
             and exists (select 1 from bookings b
                          where b.shift_id = sr.id and b.status in ('confirmed', 'worked'))) s
$$;

-- The D1/D2 email payload for one stored copy. Every key 20260923130100
-- wrote is kept, with the same values; added: documentName, schedule,
-- and for D2 totalHours ('' while any row is still undetermined).
create or replace function public.event_document_email_payload(p_document uuid)
returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
  d  event_documents;
  ev events;
  v_client clients;
  t  record;
  v_payload jsonb;
begin
  select * into d from event_documents where id = p_document;
  select * into ev from events where id = d.event_id;
  select * into v_client from clients where id = ev.client_id;

  v_payload := jsonb_build_object(
    'event',      ev.title,
    'client',     v_client.name,
    'date',       trim(to_char(ev.event_date, 'FMDay FMDD FMMonth YYYY')),
    'poNumber',   coalesce(ev.po_number, ''),
    'poSuffix',   case when coalesce(ev.po_number, '') = '' then ''
                       else ' (PO ' || ev.po_number || ')' end,
    'staffCount', d.row_count::text,
    'attachments', jsonb_build_array(jsonb_build_object(
                     'bucket', 'timesheets', 'path', d.storage_path,
                     'filename', d.file_name))::text,
    'documentName', case d.kind when 'allocation' then 'Allocation Timesheet'
                                else 'Completed Allocation Timesheet' end,
    'schedule',   event_document_schedule(ev.id));

  if d.kind = 'signout' then
    select * into t from event_document_tally(ev.id);
    v_payload := v_payload || jsonb_build_object(
      'totalHours', case when t.undetermined > 0 then '' else document_hours_label(t.worked_min) end);
  end if;
  return v_payload;
end $$;

-- ---------------------------------------------------------------------
-- 5 · queue_event_document_email — the manual Send, restated
--
-- 20260923130100's body (its only one) with the payload built by
-- event_document_email_payload(). Caller check, key, recipients and the
-- document-row update are unchanged.
-- ---------------------------------------------------------------------
create or replace function public.queue_event_document_email(p_document uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  d  event_documents;
  ev events;
  v_client clients;
  v_key text;
begin
  perform assert_reports_caller();
  select * into d from event_documents where id = p_document;
  if d.id is null then raise exception 'document_not_found' using errcode = 'P0002'; end if;
  select * into ev from events where id = d.event_id;
  if ev.cancelled_at is not null then raise exception 'event_cancelled' using errcode = 'P0001'; end if;
  select * into v_client from clients where id = ev.client_id;
  if coalesce(array_length(v_client.contact_emails, 1), 0) = 0 then
    raise exception 'client_has_no_contact_email' using errcode = 'P0001';
  end if;

  v_key := case d.kind when 'allocation' then 'D1' else 'D2' end || ':document:' || d.id::text;

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values (v_key, 'email', case d.kind when 'allocation' then 'D1' else 'D2' end,
          v_client.contact_emails, event_document_email_payload(d.id))
  on conflict (key) do nothing;

  update event_documents
     set outbox_key = v_key, recipients = v_client.contact_emails, queued_at = coalesce(queued_at, now())
   where id = d.id;

  return jsonb_build_object('key', v_key, 'recipients', to_jsonb(v_client.contact_emails));
end $$;

comment on function public.queue_event_document_email(uuid) is
  '§11.4: queues one generated Allocation Timesheet (D1) or Completed Allocation Timesheet (D2) for email from timesheets@ to every contact email on the client card, with the PDF as a storage-path attachment. Keyed on the document, so it is idempotent per copy. Payload: event_document_email_payload() (ADR-0074 adds schedule, totalHours, documentName).';

-- ---------------------------------------------------------------------
-- 6 · The rule: is an automatic send due? (mirrors schedule.ts)
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
  p_auto_queued_at       timestamptz
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
    else 'due'
  end;
end $$;

comment on function public.document_autosend_verdict(text, timestamptz, jsonb, date, timestamptz, timestamptz, boolean, int, int, int, timestamptz, timestamptz, timestamptz) is
  'ADR-0074: due | disabled | already_sent | cancelled | not_yet | too_late | before_activation | hold_expired | no_confirmed_staff | no_contact_emails | manual_sent | held_no_checkout for one automatic D1/D2. Pure; mirrored by autosendVerdict() in apps/office/app/api/jobs/event-documents/_lib/schedule.ts.';

create or replace function public.document_autosend_config()
returns jsonb
language sql stable set search_path = public, extensions as $$
  -- A missing row is the defaults with the job switched OFF: without the
  -- migration's not_before a first run would reach back a fortnight.
  select coalesce((select value from settings where key = 'document_autosend'),
                  '{"allocation":{"enabled":false,"time":"14:00"},"completed":{"enabled":false,"time":"10:00","hold_days":14}}'::jsonb)
$$;

-- ---------------------------------------------------------------------
-- 7 · event_documents_due — every candidate, its facts and its verdict
--
-- Candidates: events dated from hold_days + 2 days ago to tomorrow (UK),
-- one row per kind. The route runs the TypeScript rule over the same
-- facts and acts only where both say `due`.
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
  manual_allocation_at timestamptz,
  signout_queued_at    timestamptz,
  auto_queued_at       timestamptz
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
           (select max(d.queued_at) from event_documents d
             where d.event_id = ev.id and d.kind = 'allocation' and not d.automatic) as manual_allocation_at,
           (select max(d.queued_at) from event_documents d
             where d.event_id = ev.id and d.kind = 'signout') as signout_queued_at,
           (select a.queued_at from event_document_autosends a
             where a.event_id = ev.id and a.kind = k.kind) as auto_queued_at
      from ev
      cross join (values ('allocation'::text), ('signout')) as k(kind)
      cross join lateral event_document_tally(ev.id) t
  )
  select f.id, f.kind,
         document_autosend_verdict(f.kind, p_now, v_cfg, f.event_date, f.first_start, f.last_end,
                                   f.cancelled, f.confirmed, f.contacts, f.undetermined,
                                   f.manual_allocation_at, f.signout_queued_at, f.auto_queued_at),
         f.event_date, f.first_start, f.last_end, f.cancelled, f.confirmed, f.contacts,
         f.undetermined, f.manual_allocation_at, f.signout_queued_at, f.auto_queued_at
    from facts f
   order by f.event_date, f.id, f.kind;
end $$;

comment on function public.event_documents_due(timestamptz, uuid) is
  'ADR-0074: the event-documents job''s candidates — events dated hold_days + 2 days ago to tomorrow (UK), or one event — with the facts document_autosend_verdict() reads and its verdict per kind. Service role only.';

-- ---------------------------------------------------------------------
-- 8 · Claim, record, queue, release — the route's four writes
-- ---------------------------------------------------------------------

-- Claim one (event, kind) for this run: re-checks the verdict under a
-- lock, then takes the row if nobody holds a live lease and it has not
-- been queued. False = someone else has it, or it is no longer due.
create or replace function public.event_document_autosend_claim(
  p_event         uuid,
  p_kind          text,
  p_now           timestamptz default now(),
  p_lease_seconds int default 600
) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_verdict text;
  v_lease   interval := make_interval(secs => least(greatest(coalesce(p_lease_seconds, 600), 60), 3600));
  v_taken   boolean;
begin
  if p_kind not in ('allocation', 'signout') then
    raise exception 'unknown_document_kind' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('document-autosend:' || p_event::text || ':' || p_kind));

  select d.verdict into v_verdict from event_documents_due(p_now, p_event) d where d.kind = p_kind;
  if v_verdict is distinct from 'due' then
    return false;
  end if;

  insert into event_document_autosends as a (event_id, kind, claimed_at, lease_until, attempts)
  values (p_event, p_kind, now(), p_now + v_lease, 1)
  on conflict (event_id, kind) do update
     set claimed_at = now(), lease_until = p_now + v_lease, attempts = a.attempts + 1
   where a.queued_at is null
     and (a.lease_until is null or a.lease_until <= p_now)
  returning true into v_taken;

  return coalesce(v_taken, false);
end $$;

-- Record the copy the job drew: event_documents with generated_by null
-- and automatic = true, linked to the claim. The same checks as
-- record_event_document().
create or replace function public.record_event_document_autosend(
  p_event        uuid,
  p_kind         text,
  p_storage_path text,
  p_file_name    text,
  p_rows         int,
  p_pages        int
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  ev events;
  v_id uuid;
begin
  select * into ev from events where id = p_event;
  if ev.id is null then raise exception 'event_not_found' using errcode = 'P0002'; end if;
  if ev.cancelled_at is not null then raise exception 'event_cancelled' using errcode = 'P0001'; end if;
  if p_kind not in ('allocation', 'signout') then
    raise exception 'unknown_document_kind' using errcode = '22023';
  end if;
  if p_storage_path is null or p_storage_path not like p_event::text || '/%' then
    raise exception 'storage_path_outside_event' using errcode = '22023';
  end if;
  if not exists (select 1 from event_document_autosends a
                  where a.event_id = p_event and a.kind = p_kind and a.queued_at is null) then
    raise exception 'autosend_not_claimed' using errcode = 'P0001';
  end if;

  insert into event_documents (event_id, kind, storage_path, file_name, row_count, page_count,
                               generated_by, automatic)
  values (p_event, p_kind, p_storage_path, p_file_name, p_rows, p_pages, null, true)
  returning id into v_id;

  update event_document_autosends set document_id = v_id
   where event_id = p_event and kind = p_kind and queued_at is null;
  return v_id;
end $$;

-- Queue the automatic email: key 'D1:auto:<event>' / 'D2:auto:<event>',
-- so a second automatic send for the same event and kind is impossible
-- even past the claim. The same recipients and payload as a manual Send.
create or replace function public.queue_event_document_autosend(p_document uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  d  event_documents;
  ev events;
  v_client clients;
  v_template text;
  v_key text;
  v_inserted int;
begin
  select * into d from event_documents where id = p_document;
  if d.id is null then raise exception 'document_not_found' using errcode = 'P0002'; end if;
  if not d.automatic then raise exception 'not_an_automatic_copy' using errcode = '22023'; end if;
  select * into ev from events where id = d.event_id;
  if ev.cancelled_at is not null then raise exception 'event_cancelled' using errcode = 'P0001'; end if;
  select * into v_client from clients where id = ev.client_id;
  if coalesce(array_length(v_client.contact_emails, 1), 0) = 0 then
    raise exception 'client_has_no_contact_email' using errcode = 'P0001';
  end if;

  v_template := case d.kind when 'allocation' then 'D1' else 'D2' end;
  v_key := v_template || ':auto:' || ev.id::text;

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values (v_key, 'email', v_template, v_client.contact_emails, event_document_email_payload(d.id))
  on conflict (key) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    update event_documents
       set outbox_key = v_key, recipients = v_client.contact_emails, queued_at = now()
     where id = d.id;
  end if;

  -- Done for this event and kind either way: an outbox row under this key
  -- exists, so an automatic email has been queued.
  update event_document_autosends
     set outbox_key = v_key, queued_at = coalesce(queued_at, now()), lease_until = null, last_error = null
   where event_id = ev.id and kind = d.kind;

  return jsonb_build_object('key', v_key, 'queued', v_inserted = 1,
                            'recipients', to_jsonb(v_client.contact_emails));
end $$;

-- A run that could not finish gives the claim back, with the reason; the
-- next run tries again while the verdict is still `due`.
create or replace function public.event_document_autosend_release(
  p_event uuid,
  p_kind  text,
  p_error text default null
) returns void
language sql security definer set search_path = public, extensions as $$
  update event_document_autosends
     set lease_until = null, last_error = left(p_error, 300)
   where event_id = p_event and kind = p_kind and queued_at is null;
$$;

-- ---------------------------------------------------------------------
-- 9 · Grants — the job's functions are the service role's alone
-- ---------------------------------------------------------------------
revoke execute on function
  public.document_hours_label(int),
  public.event_document_tally(uuid),
  public.event_document_schedule(uuid),
  public.event_document_email_payload(uuid),
  public.document_autosend_verdict(text, timestamptz, jsonb, date, timestamptz, timestamptz, boolean, int, int, int, timestamptz, timestamptz, timestamptz),
  public.document_autosend_config(),
  public.event_documents_due(timestamptz, uuid),
  public.event_document_autosend_claim(uuid, text, timestamptz, int),
  public.record_event_document_autosend(uuid, text, text, text, int, int),
  public.queue_event_document_autosend(uuid),
  public.event_document_autosend_release(uuid, text, text)
from public, anon, authenticated;

grant execute on function
  public.document_hours_label(int),
  public.event_document_tally(uuid),
  public.event_document_schedule(uuid),
  public.event_document_email_payload(uuid),
  public.document_autosend_verdict(text, timestamptz, jsonb, date, timestamptz, timestamptz, boolean, int, int, int, timestamptz, timestamptz, timestamptz),
  public.document_autosend_config(),
  public.event_documents_due(timestamptz, uuid),
  public.event_document_autosend_claim(uuid, text, timestamptz, int),
  public.record_event_document_autosend(uuid, text, text, text, int, int),
  public.queue_event_document_autosend(uuid),
  public.event_document_autosend_release(uuid, text, text)
to service_role;

-- The manual Send keeps its grants (20260923130100): create or replace
-- does not change them, restated here so the file reads whole.
revoke execute on function public.queue_event_document_email(uuid) from public, anon;
grant  execute on function public.queue_event_document_email(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 10 · The schedule: every 15 minutes, the Back Office route
--
-- Registered ENABLED (pgTAP 190's list changes with it). Like every row,
-- it reaches pg_cron when install_job_schedules() next runs (docs/16
-- §4.7); an environment without the vault's office_base_url and
-- rtw_job_secret skips it with a notice.
-- ---------------------------------------------------------------------
insert into job_schedules (job, cron_expression, edge_path, enabled, note, base_url_source, secret_name) values
  ('event-documents', '*/15 * * * *', 'api/jobs/event-documents', true,
   '§11.3/§11.4 automatic Allocation Timesheet (D1, the day before at 14:00 UK) and Completed Allocation Timesheet (D2, the morning after at 10:00 UK, held while a No check-out is unresolved, up to 14 days) — ADR-0074. A Back Office Node route (apps/office/app/api/jobs/event-documents): the PDF needs @react-pdf/renderer. Times in settings.document_autosend. Shares rtw-check''s bearer (vault rtw_job_secret, env RTW_JOB_SECRET).',
   'office_base_url', 'rtw_job_secret')
on conflict (job) do nothing;
