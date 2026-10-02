-- =====================================================================
-- ADR-0084 · The Allocation Timesheet is re-sent automatically when the
-- line-up or times change — at most once an hour
--
-- THC, 02.10.2026, choosing between a warning and an automatic re-send:
-- "the system to re-send automatically after changes, at most once an
-- hour so the client isn't flooded with emails."
--
-- What counts as a change is what the sheet PRINTS (event_document_data,
-- the same rows the PDF is drawn from): who is on it, in which role, with
-- which start and finish times, and the event's title, client, date and
-- PO number. A headcount change with nobody added or removed prints the
-- same sheet, so it sends nothing. A new selfie or a client-card email
-- change sends nothing either.
--
-- The rule (the SQL twin of autosendVerdict()'s `allocation_update`
-- branch in apps/office/app/api/jobs/event-documents/_lib/schedule.ts):
--
--   disabled           settings.document_autosend.update.enabled is false
--   cancelled          the event is cancelled (§3.3)
--   too_late           its first shift has started — the sheet is on site
--   not_sent_yet       no Allocation Timesheet has been queued since 00:00
--                      UK the day before (the 16:00 D1 handles a first
--                      send; this only ever FOLLOWS one, so the two never
--                      go in the same run)
--   no_baseline        the last copy predates this migration: nothing to
--                      compare against, so nothing is sent
--   unchanged          the sheet would print the same as the last copy
--   no_confirmed_staff everyone has dropped off: an empty sheet is not sent
--   no_contact_emails  the client card has nobody to send to
--   too_soon           the last copy (automatic, update or a manager's
--                      Send) was queued less than gap_minutes (60) ago —
--                      changes inside the hour go together in one email
--   gave_up            eight claims spent on this change without success
--   due
--
-- 1 · event_documents.content_signature — md5 of what the sheet prints,
--     set on every Allocation Timesheet copy as it is recorded.
-- 2 · settings.document_autosend.update = {enabled: true, gap_minutes: 60}.
-- 3 · document_update_verdict() — the rule above, pure.
-- 4 · event_documents_due() gains the update rows and two facts
--     (allocation_sent_at, changed). Its result changes shape, so it is
--     dropped and recreated with the same grants.
-- 5 · event_document_autosends takes kind 'allocation_update' (one row
--     per event, reused for each change: baseline_document_id is the copy
--     the change is measured against, and attempts restart with it).
-- 6 · claim / record / queue for an update. Release is the existing
--     event_document_autosend_release(). All take the same advisory lock
--     as the 16:00 send and the manager's Send, and the queue re-checks
--     the verdict under it: a manager who sent it by hand while the PDF
--     was drawn makes it `unchanged`, and the job stands down.
-- 7 · The email is template D1U, "Updated Allocation Timesheet", key
--     D1U:update:<document> — one per copy.
--
-- Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · What the sheet prints, as one value
-- ---------------------------------------------------------------------
alter table event_documents add column if not exists content_signature text;

comment on column event_documents.content_signature is
  'ADR-0084: md5 of what an Allocation Timesheet prints (event_document_signature) at the moment this copy was recorded. The automatic re-send compares it with the line-up now. Null for a Completed Timesheet and for copies older than 20261002115000.';

-- The rows event_document_data() draws, reduced to what is printed and
-- does not move on its own: name (or "Deleted account #id"), Employee ID,
-- role, the role's start and finish (RULE-18), and the header. Ordered
-- the sheet's way, with the staff id last so a cancel-and-rebook of the
-- same person is no change.
create or replace function public.event_document_signature(p_event uuid)
returns text
language sql stable security definer set search_path = public, extensions as $$
  select md5(jsonb_build_object(
           'title',  e.title,
           'client', c.name,
           'date',   e.event_date,
           'po',     coalesce(e.po_number, ''),
           'rows',   coalesce((
             select jsonb_agg(jsonb_build_array(
                      st.employee_id,
                      case when st.removed_at is null then st.first_name || ' ' || st.last_name
                           else deleted_account_label(st.employee_id) end,
                      r.name, sr.starts_at, sr.ends_at)
                    order by sr.starts_at, r.name, st.employee_id, st.id)
               from bookings b
               join shift_requirements sr on sr.id = b.shift_id
               join roles r               on r.id = sr.role_id
               join staff st              on st.id = b.staff_id
              where sr.event_id = e.id
                and b.status in ('confirmed', 'worked')), '[]'::jsonb))::text)
    from events e
    join clients c on c.id = e.client_id
   where e.id = p_event
$$;

comment on function public.event_document_signature(uuid) is
  'ADR-0084: md5 of what the event''s Allocation Timesheet prints — header (title, client, date, PO) and each confirmed/worked row (Employee ID, name, role, the role''s start and finish). Headcount, photos and contact emails are not printed and not in it.';

create or replace function public.event_documents_sign()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.kind = 'allocation' then
    new.content_signature := event_document_signature(new.event_id);
  end if;
  return new;
end $$;

drop trigger if exists event_documents_sign on event_documents;
create trigger event_documents_sign
  before insert on event_documents
  for each row execute function public.event_documents_sign();

-- The trigger stamps the line-up as the copy is RECORDED, which is after
-- the PDF was drawn: a change made while it was being drawn would be
-- stamped as sent and never re-sent. So generateDocument() reads the
-- signature BEFORE it reads the rows, and puts that one on the copy once
-- it is recorded. Any race then errs towards one email too many, never a
-- change the client does not get. The trigger's value is the fallback.
create or replace function public.event_document_content_signature(p_event uuid)
returns text
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform assert_reports_caller();
  return event_document_signature(p_event);
end $$;

create or replace function public.set_event_document_signature(p_document uuid, p_signature text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform assert_reports_caller();
  if p_signature is null or p_signature !~ '^[0-9a-f]{32}$' then
    raise exception 'bad_signature' using errcode = '22023';
  end if;
  -- Only an Allocation Timesheet, only before its email is queued, and
  -- only by whoever drew it: the manager on their own copy, the job (no
  -- user) on an automatic one.
  update event_documents d
     set content_signature = p_signature
   where d.id = p_document and d.kind = 'allocation' and d.queued_at is null
     and ((auth.uid() is not null and d.generated_by = auth.uid())
          or (auth.uid() is null and d.automatic));
end $$;

comment on function public.set_event_document_signature(uuid, text) is
  'ADR-0084: puts the signature read before the PDF was drawn (event_document_content_signature) on the copy just recorded, while it is not yet queued. Office or service role (assert_reports_caller).';

-- ---------------------------------------------------------------------
-- 2 · The switch and the gap
-- ---------------------------------------------------------------------
update settings
   set value = value || jsonb_build_object('update', jsonb_build_object('enabled', true, 'gap_minutes', 60))
 where key = 'document_autosend'
   and not (value ? 'update');

-- A missing row is still "everything off", the update included.
create or replace function public.document_autosend_config()
returns jsonb
language sql stable set search_path = public, extensions as $$
  select coalesce((select value from settings where key = 'document_autosend'),
                  '{"allocation":{"enabled":false,"time":"16:00"},"completed":{"enabled":false,"time":"10:00","hold_days":14},"update":{"enabled":false,"gap_minutes":60}}'::jsonb)
$$;

-- ---------------------------------------------------------------------
-- 3 · The rule (mirrors autosendVerdict's allocation_update branch)
-- ---------------------------------------------------------------------
create or replace function public.document_update_verdict(
  p_now                timestamptz,
  p_config             jsonb,
  p_event_date         date,
  p_first_start        timestamptz,
  p_cancelled          boolean,
  p_confirmed          int,
  p_contacts           int,
  -- The latest Allocation Timesheet queued by anyone, and whether the
  -- sheet would print differently now (null: that copy has no signature).
  p_allocation_sent_at timestamptz,
  p_changed            boolean,
  p_attempts           int default 0
) returns text
language plpgsql immutable set search_path = public, extensions as $$
declare
  v_cfg     jsonb := coalesce(p_config, '{}'::jsonb) -> 'update';
  -- Read exactly as parseAutosendConfig() reads it.
  v_enabled boolean := case when jsonb_typeof(v_cfg->'enabled') = 'boolean'
                            then (v_cfg->>'enabled')::boolean else true end;
  -- A whole JSON number, 15–1440; "90.0" is 90, as JSON.parse reads it.
  v_gap     int := case when jsonb_typeof(v_cfg->'gap_minutes') = 'number'
                         and (v_cfg->>'gap_minutes') ~ '^[0-9]{1,4}(\.0+)?$'
                         and (v_cfg->>'gap_minutes')::numeric between 15 and 1440
                        then (v_cfg->>'gap_minutes')::numeric::int else 60 end;
  -- 00:00 UK on the day before: the same freshness line as manual_sent.
  v_fresh   timestamptz := (p_event_date - 1)::timestamp at time zone 'Europe/London';
begin
  return case
    when not v_enabled                              then 'disabled'
    when p_cancelled                                then 'cancelled'
    when p_first_start is not null
         and p_now >= p_first_start                 then 'too_late'
    when p_allocation_sent_at is null
         or p_allocation_sent_at < v_fresh          then 'not_sent_yet'
    when p_changed is null                          then 'no_baseline'
    when not p_changed                              then 'unchanged'
    when coalesce(p_confirmed, 0) = 0               then 'no_confirmed_staff'
    when coalesce(p_contacts, 0) = 0                then 'no_contact_emails'
    when p_now < p_allocation_sent_at + make_interval(mins => v_gap)
                                                    then 'too_soon'
    when coalesce(p_attempts, 0) >= 8               then 'gave_up'
    else 'due'
  end;
end $$;

comment on function public.document_update_verdict(timestamptz, jsonb, date, timestamptz, boolean, int, int, timestamptz, boolean, int) is
  'ADR-0084: due | disabled | cancelled | too_late | not_sent_yet | no_baseline | unchanged | no_confirmed_staff | no_contact_emails | too_soon | gave_up for the automatic re-send of a changed Allocation Timesheet. Pure; mirrored by autosendVerdict() (kind allocation_update) in apps/office/app/api/jobs/event-documents/_lib/schedule.ts.';

-- ---------------------------------------------------------------------
-- 5 · One update row per event in event_document_autosends
--     (before 4, which reads baseline_document_id)
-- ---------------------------------------------------------------------
alter table event_document_autosends drop constraint if exists event_document_autosends_kind_check;
alter table event_document_autosends
  add constraint event_document_autosends_kind_check
  check (kind in ('allocation', 'signout', 'allocation_update'));
alter table event_document_autosends
  add column if not exists baseline_document_id uuid references event_documents(id);
-- Every foreign key is indexed (002).
create index if not exists event_document_autosends_baseline_idx
  on event_document_autosends (baseline_document_id);

comment on column event_document_autosends.baseline_document_id is
  'ADR-0084, kind allocation_update only: the Allocation Timesheet copy the change was measured against when this claim was taken. A newer copy (an update, the 16:00 send or a manager''s Send) starts a new change, and attempts start again from it.';

-- ---------------------------------------------------------------------
-- 4 · event_documents_due — now with the update rows
--
-- 20261002100000's body with: a third kind, 'allocation_update'; two
-- facts, allocation_sent_at and changed; and the update's attempts,
-- counted against the current baseline only. The first two kinds read
-- exactly as before.
-- ---------------------------------------------------------------------
drop function if exists public.event_documents_due(timestamptz, uuid);
create function public.event_documents_due(
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
  allocation_sent_at   timestamptz,
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
  ), latest as (
    -- The latest Allocation Timesheet queued by anyone, per event, and —
    -- once per event, and only while an update could still go (before the
    -- first shift) — whether the sheet would print differently now.
    select ev.id as event_id, l.id as doc_id, l.queued_at,
           case when l.id is null or l.content_signature is null then null
                when ev.first_start is not null and p_now >= ev.first_start then null
                else l.content_signature is distinct from event_document_signature(ev.id) end as changed
      from ev
      left join lateral (
        select d.id, d.queued_at, d.content_signature
          from event_documents d
         where d.event_id = ev.id and d.kind = 'allocation' and d.queued_at is not null
         order by d.queued_at desc, d.generated_at desc
         limit 1) l on true
  ), facts as (
    select ev.*, k.kind, t.confirmed, t.undetermined,
           (select max(d.queued_at) from event_documents d
             where d.event_id = ev.id and d.kind = 'allocation' and not d.automatic) as manual_allocation_at,
           (select max(d.queued_at) from event_documents d
             where d.event_id = ev.id and d.kind = 'signout') as signout_queued_at,
           -- The update row is reused for every change: it is never "done".
           case when k.kind = 'allocation_update' then null
                else (select a.queued_at from event_document_autosends a
                       where a.event_id = ev.id and a.kind = k.kind) end as auto_queued_at,
           -- Claims spent: a claim whose lease is still live is the run
           -- working on it now, and not yet spent. An update's count
           -- belongs to the copy it was measured against.
           coalesce((select a.attempts - case when a.lease_until > p_now then 1 else 0 end
                       from event_document_autosends a
                      where a.event_id = ev.id and a.kind = k.kind
                        and (k.kind <> 'allocation_update'
                             or a.baseline_document_id is not distinct from lt.doc_id)), 0) as attempts,
           lt.queued_at as allocation_sent_at,
           lt.changed
      from ev
      join latest lt on lt.event_id = ev.id
      cross join (values ('allocation'::text), ('signout'), ('allocation_update')) as k(kind)
      cross join lateral event_document_tally(ev.id) t
  )
  select f.id, f.kind,
         case f.kind
           when 'allocation_update' then
             document_update_verdict(p_now, v_cfg, f.event_date, f.first_start, f.cancelled,
                                     f.confirmed, f.contacts, f.allocation_sent_at, f.changed,
                                     f.attempts)
           else
             document_autosend_verdict(f.kind, p_now, v_cfg, f.event_date, f.first_start, f.last_end,
                                       f.cancelled, f.confirmed, f.contacts, f.undetermined,
                                       f.manual_allocation_at, f.signout_queued_at, f.auto_queued_at,
                                       f.attempts)
         end,
         f.event_date, f.first_start, f.last_end, f.cancelled, f.confirmed, f.contacts,
         f.undetermined, f.manual_allocation_at, f.signout_queued_at, f.auto_queued_at,
         f.attempts, f.allocation_sent_at, f.changed
    from facts f
   order by f.event_date, f.id, f.kind;
end $$;

comment on function public.event_documents_due(timestamptz, uuid) is
  'ADR-0074, ADR-0084: the event-documents job''s candidates — events dated hold_days + 2 days ago to tomorrow (UK), or one event — with the facts the verdicts read and the verdict per kind: allocation and signout (document_autosend_verdict) and allocation_update (document_update_verdict, with allocation_sent_at and changed). Service role only.';

-- ---------------------------------------------------------------------
-- 6 · Claim, record, queue an update
-- ---------------------------------------------------------------------

-- Claim the event's update for this run: the verdict again under the
-- allocation lock, then the row if nobody holds a live lease and fewer
-- than eight claims were spent on THIS change (a newer baseline starts
-- again at one). queued_at and document_id are cleared: this is a new
-- attempt, and record / release read "not yet queued".
create or replace function public.event_document_update_claim(
  p_event         uuid,
  p_now           timestamptz default now(),
  p_lease_seconds int default 600
) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_now      timestamptz := least(greatest(coalesce(p_now, now()), now() - interval '5 minutes'),
                                  now() + interval '5 minutes');
  v_verdict  text;
  v_lease    interval := make_interval(secs => least(greatest(coalesce(p_lease_seconds, 600), 60), 3600));
  v_baseline uuid;
  v_taken    boolean;
begin
  perform pg_advisory_xact_lock(hashtext('document-autosend:' || p_event::text || ':allocation'));

  select d.verdict into v_verdict from event_documents_due(v_now, p_event) d where d.kind = 'allocation_update';
  if v_verdict is distinct from 'due' then
    return false;
  end if;

  select d.id into v_baseline
    from event_documents d
   where d.event_id = p_event and d.kind = 'allocation' and d.queued_at is not null
   order by d.queued_at desc, d.generated_at desc
   limit 1;

  insert into event_document_autosends as a
         (event_id, kind, claimed_at, lease_until, attempts, baseline_document_id)
  values (p_event, 'allocation_update', now(), v_now + v_lease, 1, v_baseline)
  on conflict (event_id, kind) do update
     set claimed_at = now(),
         lease_until = v_now + v_lease,
         attempts = case when a.baseline_document_id is not distinct from excluded.baseline_document_id
                         then a.attempts + 1 else 1 end,
         baseline_document_id = excluded.baseline_document_id,
         document_id = null,
         outbox_key = null,
         queued_at = null,
         last_error = null
   where (a.lease_until is null or a.lease_until <= v_now)
     and (a.baseline_document_id is distinct from excluded.baseline_document_id or a.attempts < 8)
  returning true into v_taken;

  return coalesce(v_taken, false);
end $$;

-- Record the update copy the job drew: an automatic Allocation Timesheet
-- (generated_by null), linked to the live claim. The signature trigger
-- stamps what it prints.
create or replace function public.record_event_document_update(
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
  if p_kind is distinct from 'allocation' then
    raise exception 'unknown_document_kind' using errcode = '22023';
  end if;
  if p_storage_path is null or p_storage_path not like p_event::text || '/%' then
    raise exception 'storage_path_outside_event' using errcode = '22023';
  end if;
  if not exists (select 1 from event_document_autosends a
                  where a.event_id = p_event and a.kind = 'allocation_update' and a.queued_at is null
                    and a.lease_until > now()) then
    raise exception 'autosend_not_claimed' using errcode = 'P0001';
  end if;

  insert into event_documents (event_id, kind, storage_path, file_name, row_count, page_count,
                               generated_by, automatic)
  values (p_event, 'allocation', p_storage_path, p_file_name, p_rows, p_pages, null, true)
  returning id into v_id;

  update event_document_autosends set document_id = v_id
   where event_id = p_event and kind = 'allocation_update' and queued_at is null;
  return v_id;
end $$;

-- Queue the update email, D1U, keyed on the copy. Under the allocation
-- lock the verdict is taken again: if a manager sent it by hand while the
-- PDF was drawn (the sheet is now `unchanged` or `too_soon`), or anything
-- else moved, the job stands down — the claim is released with the reason
-- and nothing is queued.
create or replace function public.queue_event_document_update(p_document uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  d  event_documents;
  ev events;
  v_client clients;
  v_key text;
  v_inserted int;
  v_verdict text;
begin
  select * into d from event_documents where id = p_document;
  if d.id is null then raise exception 'document_not_found' using errcode = 'P0002'; end if;
  if not d.automatic or d.kind <> 'allocation' then
    raise exception 'not_an_automatic_copy' using errcode = '22023';
  end if;
  if not exists (select 1 from event_document_autosends a
                  where a.event_id = d.event_id and a.kind = 'allocation_update'
                    and a.document_id = d.id and a.queued_at is null) then
    raise exception 'not_the_claimed_update' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('document-autosend:' || d.event_id::text || ':allocation'));

  select x.verdict into v_verdict from event_documents_due(now(), d.event_id) x where x.kind = 'allocation_update';
  if v_verdict is distinct from 'due' then
    update event_document_autosends
       set lease_until = null, last_error = 'skipped: ' || coalesce(v_verdict, 'no verdict')
     where event_id = d.event_id and kind = 'allocation_update' and queued_at is null;
    return jsonb_build_object('key', null, 'queued', false, 'skipped', v_verdict);
  end if;

  select * into ev from events where id = d.event_id;
  select * into v_client from clients where id = ev.client_id;

  v_key := 'D1U:update:' || d.id::text;
  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values (v_key, 'email', 'D1U', v_client.contact_emails, event_document_email_payload(d.id))
  on conflict (key) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    update event_documents
       set outbox_key = v_key, recipients = v_client.contact_emails, queued_at = now()
     where id = d.id;
  end if;

  update event_document_autosends
     set outbox_key = v_key, queued_at = coalesce(queued_at, now()), lease_until = null, last_error = null
   where event_id = ev.id and kind = 'allocation_update';

  return jsonb_build_object('key', v_key, 'queued', v_inserted = 1,
                            'recipients', to_jsonb(v_client.contact_emails));
end $$;

-- ---------------------------------------------------------------------
-- Grants — the job's functions are the service role's alone
-- ---------------------------------------------------------------------
revoke execute on function public.event_document_content_signature(uuid), public.set_event_document_signature(uuid, text)
  from public, anon;
grant execute on function public.event_document_content_signature(uuid), public.set_event_document_signature(uuid, text)
  to authenticated, service_role;

revoke execute on function
  public.event_document_signature(uuid),
  public.event_documents_sign(),
  public.document_update_verdict(timestamptz, jsonb, date, timestamptz, boolean, int, int, timestamptz, boolean, int),
  public.event_documents_due(timestamptz, uuid),
  public.event_document_update_claim(uuid, timestamptz, int),
  public.record_event_document_update(uuid, text, text, text, int, int),
  public.queue_event_document_update(uuid)
from public, anon, authenticated;

grant execute on function
  public.event_document_signature(uuid),
  public.document_update_verdict(timestamptz, jsonb, date, timestamptz, boolean, int, int, timestamptz, boolean, int),
  public.event_documents_due(timestamptz, uuid),
  public.event_document_update_claim(uuid, timestamptz, int),
  public.record_event_document_update(uuid, text, text, text, int, int),
  public.queue_event_document_update(uuid)
to service_role;

update job_schedules
   set note = note || ' ADR-0084: also re-sends a changed Allocation Timesheet (D1U), at most once an hour, until the first shift starts.'
 where job = 'event-documents' and note not like '%ADR-0084%';
