-- =====================================================================
-- Migration 20261005100000 · Who receives the timesheet is chosen per event
--                            (§9.7, §11.4; ADR-0086, THC 05.10.2026)
--
-- Until now both documents went to every contact email on the client card.
-- THC: events on the same day for the same client sometimes need the sheet
-- to go to different people.
--
--   events.document_recipients  text[], null = "every contact email on the
--                               client card" (today's behaviour, and every
--                               existing event). Otherwise 1–5 addresses
--                               for THIS event only: a pick from the client's
--                               contacts and/or other addresses.
--   event_document_recipients(event)
--                               the one place that answers "who gets it":
--                               the override, else the client's contacts.
--   set_event_document_recipients(event, addresses)
--                               the write. Admin only (assert_reports_caller,
--                               as the Send itself). Trims, lower-cases and
--                               de-duplicates; refuses an invalid address, more
--                               than 5, a cancelled event. Null or an empty
--                               list puts the event back on the client's
--                               contacts. Audited, with the previous list.
--
-- The manual Send (queue_event_document_email), the automatic D1/D2
-- (queue_event_document_autosend) and the job's "no contact email" check
-- (event_documents_due.contacts) all read it, so the manager's choice
-- applies to both documents and to the automatic send alike. Changing the
-- recipients does not by itself resend: the next send uses the new list,
-- and the manager's Send button sends now.
--
-- The client role holds no policy on events (ADR-0026), so the column is
-- never visible to a client. Forward-only.
-- =====================================================================

alter table events add column if not exists document_recipients text[];

alter table events drop constraint if exists events_document_recipients_check;
alter table events add constraint events_document_recipients_check
  check (document_recipients is null
         or cardinality(document_recipients) between 1 and 5);

comment on column events.document_recipients is
  'ADR-0086: who the Allocation Timesheet and the Completed Allocation Timesheet go to for THIS event. Null = every contact email on the client card (§9.7). Written only by set_event_document_recipients().';

create or replace function public.event_document_recipients(p_event uuid)
returns text[]
language sql stable set search_path = public, extensions as $$
  select coalesce(e.document_recipients, c.contact_emails)
    from events e
    join clients c on c.id = e.client_id
   where e.id = p_event
$$;

comment on function public.event_document_recipients(uuid) is
  'ADR-0086: who a timesheet for this event goes to — the event''s own list, else the contact emails on the client card.';

create or replace function public.set_event_document_recipients(p_event uuid, p_recipients text[])
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  ev      events;
  v_clean text[];
  v_bad   text;
begin
  perform assert_reports_caller();
  select * into ev from events where id = p_event for update;
  if ev.id is null then raise exception 'event_not_found' using errcode = 'P0002'; end if;
  if ev.cancelled_at is not null then raise exception 'event_cancelled' using errcode = 'P0001'; end if;

  -- Trimmed, lower-cased, de-duplicated, in the order given.
  select coalesce(array_agg(a order by n), '{}') into v_clean
    from (select a, min(n) as n
            from (select lower(btrim(x)) as a, n
                    from unnest(coalesce(p_recipients, '{}')) with ordinality as t(x, n)
                   where btrim(x) <> '') s
           group by a) d;

  if coalesce(array_length(v_clean, 1), 0) = 0 then
    v_clean := null;                                  -- back to the client's contacts
  else
    if array_length(v_clean, 1) > 5 then
      raise exception 'too_many_recipients' using errcode = '22023';
    end if;
    select a into v_bad from unnest(v_clean) as a
     where a !~ '^[^@[:space:],;]+@[^@[:space:],;]+\.[^@[:space:],;]+$' or length(a) > 254
     limit 1;
    if v_bad is not null then
      raise exception 'invalid_recipient_email' using errcode = '22023', detail = v_bad;
    end if;
  end if;

  update events set document_recipients = v_clean where id = p_event;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'event.document_recipients_set', 'event', p_event,
          jsonb_build_object('recipients', to_jsonb(v_clean), 'previous', to_jsonb(ev.document_recipients)));

  return jsonb_build_object('recipients', to_jsonb(event_document_recipients(p_event)),
                            'custom', v_clean is not null);
end $$;

comment on function public.set_event_document_recipients(uuid, text[]) is
  'ADR-0086: sets who the event''s timesheets go to (1–5 addresses, any valid email); null or empty = the client card''s contacts. Admin only; audited with the previous list. Refuses a cancelled event.';

-- ---------------------------------------------------------------------
-- The manual Send (20261002100000's body), the automatic send
-- (20261004110000's) and the job's candidates (20261004110000's) now ask
-- event_document_recipients(). Nothing else in them changes.
-- ---------------------------------------------------------------------
create or replace function public.queue_event_document_email(p_document uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  d  event_documents;
  ev events;
  v_recipients text[];
  v_key text;
begin
  perform assert_reports_caller();
  select * into d from event_documents where id = p_document;
  if d.id is null then raise exception 'document_not_found' using errcode = 'P0002'; end if;
  -- The job's lock for this event and kind (ADR-0074): a manual Send and
  -- an automatic one queue one after the other, and the job, re-checking
  -- after it, sees this copy and stands down (manual_sent).
  perform pg_advisory_xact_lock(hashtext('document-autosend:' || d.event_id::text || ':' || d.kind));
  select * into ev from events where id = d.event_id;
  if ev.cancelled_at is not null then raise exception 'event_cancelled' using errcode = 'P0001'; end if;
  v_recipients := event_document_recipients(ev.id);
  if coalesce(array_length(v_recipients, 1), 0) = 0 then
    raise exception 'client_has_no_contact_email' using errcode = 'P0001';
  end if;

  v_key := case d.kind when 'allocation' then 'D1' else 'D2' end || ':document:' || d.id::text;

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values (v_key, 'email', case d.kind when 'allocation' then 'D1' else 'D2' end,
          v_recipients, event_document_email_payload(d.id))
  on conflict (key) do nothing;

  update event_documents
     set outbox_key = v_key, recipients = v_recipients, queued_at = coalesce(queued_at, now())
   where id = d.id;

  return jsonb_build_object('key', v_key, 'recipients', to_jsonb(v_recipients));
end $$;

create or replace function public.queue_event_document_autosend(p_document uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  d  event_documents;
  ev events;
  v_recipients text[];
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
  v_recipients := event_document_recipients(ev.id);
  if coalesce(array_length(v_recipients, 1), 0) = 0 then
    raise exception 'client_has_no_contact_email' using errcode = 'P0001';
  end if;

  v_template := case d.kind when 'allocation' then 'D1' else 'D2' end;
  -- The first automatic send keeps its original key; the n-th (an updated
  -- sheet after a change) is keyed :n, so every one is unique.
  v_n := coalesce((select a.sends from event_document_autosends a
                    where a.event_id = ev.id and a.kind = d.kind), 0) + 1;
  v_key := v_template || ':auto:' || ev.id::text || case when v_n > 1 then ':' || v_n::text else '' end;

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values (v_key, 'email', v_template, v_recipients, event_document_email_payload(d.id))
  on conflict (key) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    update event_documents
       -- clock_timestamp(), not now(): "the latest D1 sent" is ordered by this
       -- stamp, and two sends must never tie (now() is the transaction's).
       set outbox_key = v_key, recipients = v_recipients, queued_at = clock_timestamp()
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
                            'recipients', to_jsonb(v_recipients));
end $$;

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
           coalesce(array_length(event_document_recipients(e.id), 1), 0) as contacts,
           (select min(sr.starts_at) from shift_requirements sr where sr.event_id = e.id) as first_start,
           (select max(sr.ends_at)   from shift_requirements sr where sr.event_id = e.id) as last_end
      from events e
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
           -- fingerprint (older than 20261004110000) is never "changed".
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

revoke execute on function
  public.event_document_recipients(uuid),
  public.set_event_document_recipients(uuid, text[])
from public, anon, authenticated;
grant execute on function public.event_document_recipients(uuid) to service_role;
-- The write checks the caller itself (assert_reports_caller): an admin session.
grant execute on function public.set_event_document_recipients(uuid, text[]) to authenticated, service_role;

-- Restated bodies keep their grants (create or replace); restated here so the
-- file reads whole.
revoke execute on function public.queue_event_document_email(uuid) from public, anon;
grant  execute on function public.queue_event_document_email(uuid) to authenticated, service_role;
