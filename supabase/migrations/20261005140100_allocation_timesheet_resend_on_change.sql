-- =====================================================================
-- Migration 20261005140100 · A changed event gets a fresh Allocation
--                            Timesheet, once everyone has confirmed the
--                            change (§11.3, §11.4; ADR-0088, THC 04.10.2026)
--
-- 20261005140000 holds the FIRST automatic send until the event is 100%
-- confirmed. This is the other half of the same decision: once a sheet has
-- gone, a change to the event (a time, a role, a headcount that gets
-- filled, a worker swapped) sends an UPDATED sheet automatically — again
-- only when every place is firmly confirmed, so the client never receives
-- a half-confirmed one.
--
-- How a change is recognised
-- --------------------------
-- A "line-up fingerprint" (event_document_line_up_fp): an md5 of what the
-- sheet prints — the event's title, date and PO number, and for every
-- confirmed/worked booking the worker, role and the section's own start
-- and end (RULE-18). It is stamped on every event_documents row as it is
-- recorded (a BEFORE INSERT trigger, so a manager's Download or Send and
-- the job's copy are both covered). `changed` = the fingerprint of the
-- latest D1 that was actually queued (by anyone) differs from the current
-- one. A copy with no fingerprint (drawn before this migration) is never
-- "changed": nothing is resent for events sent before this went live.
--
--   headcount raised, never filled   → the sheet prints the same people:
--                                      nothing changed, nothing resent
--   headcount filled / worker swap   → the roster differs: resent when whole
--   time / role change               → section windows differ: bookings go
--                                      to reconfirm_required, so the line-up
--                                      is not whole until they re-confirm;
--                                      then resent
--
-- The rule (mirrored by autosendVerdict() in schedule.ts)
-- -------------------------------------------------------
--   already_sent   only when an automatic D1 went AND nothing has changed
--                  since. A change reopens the question; the gates after it
--                  are the first send's: the cut-off has passed (not_yet),
--                  the first shift has not started (too_late), someone is
--                  confirmed, the client has an email, and — the point of
--                  this ADR — the event is whole (not_fully_confirmed).
--   manual_sent    the "a manager already sent a fresh one" skip now needs
--                  that copy to still match the line-up; a manager's copy
--                  that a later change has outdated no longer suppresses
--                  the automatic one.
--
-- The job already runs every 15 minutes (job_schedules 'event-documents',
-- '*/15 * * * *') and re-judges every event dated from hold_days + 2 days
-- ago to tomorrow on every run, so a re-confirmation is picked up within
-- 15 minutes. It keeps checking until the first shift starts.
--
-- Mechanics: event_document_autosends stays one row per (event, kind) —
-- the claim, the lease and the retry ceiling work as before — and gains
-- `sends`, the number of automatic emails queued so far. The first keeps
-- its key 'D1:auto:<event>'; the n-th (n ≥ 2) is 'D1:auto:<event>:<n>', so
-- every automatic send still has a unique outbox key. A successful queue
-- resets `attempts`, so each send gets its own eight tries. The email says
-- it replaces the earlier sheet (payload.updateTag).
--
-- D2 (the Completed Allocation Timesheet) still goes once.
-- Restated here from 20261005140000 / 20261002100000 / 20261002112000.
-- Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The fingerprint, and where it is stamped
-- ---------------------------------------------------------------------
alter table event_documents add column if not exists line_up_fp text;
comment on column event_documents.line_up_fp is
  'ADR-0088: event_document_line_up_fp() at the moment the copy was recorded. Null for copies drawn before 20261005140100. The latest queued D1''s value against the current one is how the job knows the event has changed since.';

alter table event_document_autosends add column if not exists sends int not null default 0 check (sends >= 0);
comment on column event_document_autosends.sends is
  'ADR-0088: automatic emails queued so far for this event and kind. The first is keyed D1:auto:<event>; the n-th (n >= 2) D1:auto:<event>:<n>.';
update event_document_autosends set sends = 1 where queued_at is not null and sends = 0;

create or replace function public.event_document_line_up_fp(p_event uuid)
returns text
language sql stable set search_path = public, extensions as $$
  select md5(coalesce(string_agg(x.part, '|' order by x.part), ''))
    from (
      select 'event:' || e.title || ':' || to_char(e.event_date, 'YYYY-MM-DD') || ':'
             || coalesce(e.po_number, '') as part
        from events e
       where e.id = p_event
      union all
      -- Epoch seconds, not timestamptz::text: the text depends on the
      -- session's TimeZone, the fingerprint must not.
      select 'booking:' || b.staff_id::text || ':' || sr.role_id::text || ':'
             || extract(epoch from sr.starts_at)::bigint::text || ':'
             || extract(epoch from sr.ends_at)::bigint::text
        from bookings b
        join shift_requirements sr on sr.id = b.shift_id
       where sr.event_id = p_event
         and b.status in ('confirmed', 'worked')
    ) x
$$;

comment on function public.event_document_line_up_fp(uuid) is
  'ADR-0088: md5 of what the Allocation Timesheet prints — event title, date, PO number, and each confirmed/worked booking''s worker, role and section start/end. Service role only.';

create or replace function public.event_documents_stamp_line_up()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.line_up_fp is null then
    new.line_up_fp := event_document_line_up_fp(new.event_id);
  end if;
  return new;
end $$;

drop trigger if exists stamp_line_up on public.event_documents;
create trigger stamp_line_up before insert on public.event_documents
  for each row execute function public.event_documents_stamp_line_up();

-- ---------------------------------------------------------------------
-- 2 · The email says when it replaces an earlier sheet
--     (20261002112000's body, plus `updateTag`)
-- ---------------------------------------------------------------------
create or replace function public.event_document_email_payload(p_document uuid)
returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
  d  event_documents;
  ev events;
  v_client clients;
  t  record;
  v_files jsonb;
  v_payload jsonb;
  v_update boolean;
begin
  select * into d from event_documents where id = p_document;
  select * into ev from events where id = d.event_id;
  select * into v_client from clients where id = ev.client_id;

  v_files := jsonb_build_array(jsonb_build_object(
               'bucket', 'timesheets', 'path', d.storage_path, 'filename', d.file_name));
  if d.badges_storage_path is not null then
    v_files := v_files || jsonb_build_array(jsonb_build_object(
                 'bucket', 'timesheets', 'path', d.badges_storage_path,
                 'filename', d.badges_file_name,
                 -- Which file it is, not what to call it: the card's words
                 -- are packages/notifications' (the §8 register's home).
                 'role', 'badges'));
  end if;

  -- An automatic D1 that follows an earlier one that went out: it replaces it.
  v_update := d.kind = 'allocation' and d.automatic
              and exists (select 1 from event_documents o
                           where o.event_id = d.event_id and o.kind = 'allocation'
                             and o.queued_at is not null and o.id <> d.id);

  v_payload := jsonb_build_object(
    'event',      ev.title,
    'client',     v_client.name,
    'date',       trim(to_char(ev.event_date, 'FMDay FMDD FMMonth YYYY')),
    'poNumber',   coalesce(ev.po_number, ''),
    'poSuffix',   case when coalesce(ev.po_number, '') = '' then ''
                       else ' (PO ' || ev.po_number || ')' end,
    'staffCount', d.row_count::text,
    'attachments', v_files::text,
    'documentName', case d.kind when 'allocation' then 'Allocation Timesheet'
                                else 'Completed Allocation Timesheet' end,
    'schedule',   event_document_schedule(ev.id),
    'nameBadges', coalesce(d.badges_count::text, ''),
    'updateTag',  case when v_update then ' (updated)' else '' end);

  if d.kind = 'signout' then
    select * into t from event_document_tally(ev.id);
    v_payload := v_payload || jsonb_build_object(
      'totalHours', case when t.undetermined > 0 then '' else document_hours_label(t.worked_min) end);
  end if;
  return v_payload;
end $$;

-- ---------------------------------------------------------------------
-- 3 · The rule: `changed` reopens an already-sent D1
-- ---------------------------------------------------------------------
drop function if exists public.document_autosend_verdict(
  text, timestamptz, jsonb, date, timestamptz, timestamptz, boolean, int, int, int, timestamptz, timestamptz, timestamptz, int, int);

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
  p_unfilled             int default 0,
  -- D1 only: the line-up differs from the latest D1 that was sent (ADR-0088).
  p_changed              boolean default false
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
  v_changed boolean := coalesce(p_changed, false);
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
      -- Sent, and nothing has changed since. A change reopens it.
      when p_auto_queued_at is not null
           and not v_changed                then 'already_sent'
      when p_cancelled                      then 'cancelled'
      when p_now < v_due                    then 'not_yet'
      when p_first_start is not null
           and p_now >= p_first_start       then 'too_late'
      when coalesce(p_confirmed, 0) = 0     then 'no_confirmed_staff'
      when coalesce(p_contacts, 0) = 0      then 'no_contact_emails'
      -- A manager's fresh copy suppresses the first automatic one only
      -- while it still matches the line-up.
      when p_auto_queued_at is null
           and not v_changed
           and p_manual_allocation_at >= ((p_event_date - 1)::timestamp at time zone 'Europe/London')
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

comment on function public.document_autosend_verdict(text, timestamptz, jsonb, date, timestamptz, timestamptz, boolean, int, int, int, timestamptz, timestamptz, timestamptz, int, int, boolean) is
  'ADR-0074/0088: due | disabled | already_sent | cancelled | not_yet | too_late | before_activation | hold_expired | no_confirmed_staff | no_contact_emails | manual_sent | not_fully_confirmed | held_no_checkout | gave_up for one automatic D1/D2. D1 is reopened by p_changed (the line-up differs from the latest D1 sent) and waits for p_unfilled = 0. Pure; mirrored by autosendVerdict() in apps/office/app/api/jobs/event-documents/_lib/schedule.ts.';

-- ---------------------------------------------------------------------
-- 4 · event_documents_due — plus `changed`
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
  unfilled             int,
  changed              boolean
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
                      where a.event_id = ev.id and a.kind = k.kind), 0) as attempts,
           -- D1 only: the latest D1 actually queued (a manager's or the
           -- job's) was drawn from a different line-up. A copy with no
           -- fingerprint (older than 20261005140100) is never "changed".
           (k.kind = 'allocation' and coalesce(
              (select d.line_up_fp is not null
                      and d.line_up_fp is distinct from event_document_line_up_fp(ev.id)
                 from event_documents d
                where d.event_id = ev.id and d.kind = 'allocation' and d.queued_at is not null
                order by d.queued_at desc, d.id desc
                limit 1), false)) as changed
      from ev
      cross join (values ('allocation'::text), ('signout')) as k(kind)
      cross join lateral event_document_tally(ev.id) t
  )
  select f.id, f.kind,
         document_autosend_verdict(f.kind, p_now, v_cfg, f.event_date, f.first_start, f.last_end,
                                   f.cancelled, f.confirmed, f.contacts, f.undetermined,
                                   f.manual_allocation_at, f.signout_queued_at, f.auto_queued_at,
                                   f.attempts, f.unfilled, f.changed),
         f.event_date, f.first_start, f.last_end, f.cancelled, f.confirmed, f.contacts,
         f.undetermined, f.manual_allocation_at, f.signout_queued_at, f.auto_queued_at,
         f.attempts, f.unfilled, f.changed
    from facts f
   order by f.event_date, f.id, f.kind;
end $$;

comment on function public.event_documents_due(timestamptz, uuid) is
  'ADR-0074/0088: the event-documents job''s candidates — events dated hold_days + 2 days ago to tomorrow (UK), or one event — with the facts document_autosend_verdict() reads (unfilled: places short of the headcount; changed: the line-up differs from the latest D1 sent) and its verdict per kind. Service role only.';

-- ---------------------------------------------------------------------
-- 5 · Claim, record, queue, release — a sent row can be claimed again
--
-- "Done" used to be `queued_at is not null`, final. It is now the
-- VERDICT that says whether a send is due (already_sent while nothing has
-- changed), so none of these four guards on queued_at any more; the lease
-- and the attempts ceiling are what they were.
-- ---------------------------------------------------------------------
create or replace function public.event_document_autosend_claim(
  p_event         uuid,
  p_kind          text,
  p_now           timestamptz default now(),
  p_lease_seconds int default 600
) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_now     timestamptz := least(greatest(coalesce(p_now, now()), now() - interval '5 minutes'),
                                 now() + interval '5 minutes');
  v_verdict text;
  v_lease   interval := make_interval(secs => least(greatest(coalesce(p_lease_seconds, 600), 60), 3600));
  v_taken   boolean;
begin
  if p_kind not in ('allocation', 'signout') then
    raise exception 'unknown_document_kind' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('document-autosend:' || p_event::text || ':' || p_kind));

  select d.verdict into v_verdict from event_documents_due(v_now, p_event) d where d.kind = p_kind;
  if v_verdict is distinct from 'due' then
    return false;
  end if;

  insert into event_document_autosends as a (event_id, kind, claimed_at, lease_until, attempts)
  values (p_event, p_kind, now(), v_now + v_lease, 1)
  on conflict (event_id, kind) do update
     set claimed_at = now(), lease_until = v_now + v_lease, attempts = a.attempts + 1
   where (a.lease_until is null or a.lease_until <= v_now)
     and a.attempts < 8
  returning true into v_taken;

  return coalesce(v_taken, false);
end $$;

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
  -- A LIVE claim: a run whose lease lapsed has lost it to the next run.
  if not exists (select 1 from event_document_autosends a
                  where a.event_id = p_event and a.kind = p_kind and a.lease_until > now()) then
    raise exception 'autosend_not_claimed' using errcode = 'P0001';
  end if;

  insert into event_documents (event_id, kind, storage_path, file_name, row_count, page_count,
                               generated_by, automatic)
  values (p_event, p_kind, p_storage_path, p_file_name, p_rows, p_pages, null, true)
  returning id into v_id;

  update event_document_autosends set document_id = v_id
   where event_id = p_event and kind = p_kind;
  return v_id;
end $$;

create or replace function public.queue_event_document_autosend(p_document uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  d  event_documents;
  ev events;
  v_client clients;
  v_template text;
  v_key text;
  v_n int;
  v_inserted int;
  v_verdict text;
begin
  select * into d from event_documents where id = p_document;
  if d.id is null then raise exception 'document_not_found' using errcode = 'P0002'; end if;
  if not d.automatic then raise exception 'not_an_automatic_copy' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('document-autosend:' || d.event_id::text || ':' || d.kind));

  select x.verdict into v_verdict from event_documents_due(now(), d.event_id) x where x.kind = d.kind;
  if v_verdict is distinct from 'due' then
    -- already_sent is not a fault: a copy that went out keeps a clean row.
    update event_document_autosends
       set lease_until = null,
           last_error = case when v_verdict = 'already_sent' then last_error
                             else 'skipped: ' || coalesce(v_verdict, 'no verdict') end
     where event_id = d.event_id and kind = d.kind;
    return jsonb_build_object('key', null, 'queued', false, 'skipped', v_verdict);
  end if;

  select * into ev from events where id = d.event_id;
  if ev.cancelled_at is not null then raise exception 'event_cancelled' using errcode = 'P0001'; end if;
  select * into v_client from clients where id = ev.client_id;
  if coalesce(array_length(v_client.contact_emails, 1), 0) = 0 then
    raise exception 'client_has_no_contact_email' using errcode = 'P0001';
  end if;

  v_template := case d.kind when 'allocation' then 'D1' else 'D2' end;
  -- The first automatic send keeps its original key; the n-th (an updated
  -- sheet after a change) is keyed :n, so every one is unique.
  v_n := coalesce((select a.sends from event_document_autosends a
                    where a.event_id = ev.id and a.kind = d.kind), 0) + 1;
  v_key := v_template || ':auto:' || ev.id::text || case when v_n > 1 then ':' || v_n::text else '' end;

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values (v_key, 'email', v_template, v_client.contact_emails, event_document_email_payload(d.id))
  on conflict (key) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    update event_documents
       -- clock_timestamp(), not now(): "the latest D1 sent" is ordered by this
       -- stamp, and two sends must never tie (now() is the transaction's).
       set outbox_key = v_key, recipients = v_client.contact_emails, queued_at = clock_timestamp()
     where id = d.id;
  end if;

  -- Done for now either way: an outbox row under this key exists. A later
  -- change reopens it through the verdict, not through this row.
  update event_document_autosends
     set outbox_key = v_key,
         queued_at = case when v_inserted = 1 then clock_timestamp() else coalesce(queued_at, now()) end,
         sends = case when v_inserted = 1 then v_n else greatest(sends, 1) end,
         attempts = 0, lease_until = null, last_error = null
   where event_id = ev.id and kind = d.kind;

  return jsonb_build_object('key', v_key, 'queued', v_inserted = 1,
                            'recipients', to_jsonb(v_client.contact_emails));
end $$;

create or replace function public.event_document_autosend_release(
  p_event uuid,
  p_kind  text,
  p_error text default null
) returns void
language sql security definer set search_path = public, extensions as $$
  update event_document_autosends
     set lease_until = null, last_error = left(p_error, 300)
   where event_id = p_event and kind = p_kind;
$$;

-- ---------------------------------------------------------------------
-- 6 · Grants — still the service role's alone
-- ---------------------------------------------------------------------
revoke execute on function
  public.event_document_line_up_fp(uuid),
  public.event_documents_stamp_line_up(),
  public.document_autosend_verdict(text, timestamptz, jsonb, date, timestamptz, timestamptz, boolean, int, int, int, timestamptz, timestamptz, timestamptz, int, int, boolean),
  public.event_documents_due(timestamptz, uuid)
from public, anon, authenticated;

grant execute on function
  public.event_document_line_up_fp(uuid),
  public.document_autosend_verdict(text, timestamptz, jsonb, date, timestamptz, timestamptz, boolean, int, int, int, timestamptz, timestamptz, timestamptz, int, int, boolean),
  public.event_documents_due(timestamptz, uuid)
to service_role;
