-- =====================================================================
-- Migration 20261022160000 · The office's hidden copy of every timesheet
--                            sent to a client (ADR-0179, THC 21.10.2026)
--
-- THC wants a colleague (Sam) to receive a copy of every Allocation
-- Timesheet (D1) and Completed Allocation Timesheet (D2) that goes to a
-- client — the automatic send at 16:00 the day before, its "(updated)"
-- resends, and the office's Send buttons — without the client seeing the
-- address. Until now a document email had To and Reply-To only.
--
-- 1 · settings.document_office_copy  {"emails": []} — 0 to 5 addresses,
--     seeded empty (= off). Owner-editable on /settings like every other
--     row: the admin_all policy and the restrictive office_settings_* ones
--     (office_can('settings')) apply, and settings_audit records the change.
--     settings_document_office_copy_guard trims, lower-cases and de-dupes
--     the list and refuses any other shape, so nothing the drain cannot
--     send is ever stored.
-- 2 · document_office_copy(to): the one reading of it — the addresses,
--     less anyone already in To (compared lower-case). Not a definer and
--     not callable by a session: the two queue functions below are its
--     only callers.
-- 3 · queue_event_document_email (the manual Send) and
--     queue_event_document_autosend (the job: D1 at 16:00, every
--     "(updated)" resend, and D2 should its automatic send be switched back
--     on), restated from 20261005140200 — their latest bodies — with one
--     change each: the outbox row's payload gains `bcc` (only when there is
--     someone to copy), and the answer names it. The drain sends
--     `payload.bcc` as Resend's `bcc`, never as To or CC (packages/
--     notifications, office-copy.ts). The row is the record of who was
--     copied; the outbox is admin-read only.
--
-- Not touched, on purpose: event_document_recipients(), events.document_
-- recipients, event_documents.recipients, client_events_v.timesheet_
-- recipients and client_account_v — everything the Client Portal reads
-- names the client's own recipients only. Invoices (INV1) carry no copy.
--
-- Forward-only. pgTAP 914 pins it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The setting and its guard
-- ---------------------------------------------------------------------
create or replace function public.settings_document_office_copy_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_clean text[];
  v_bad   text;
begin
  if new.key is distinct from 'document_office_copy' then
    return new;
  end if;
  if jsonb_typeof(new.value) is distinct from 'object'
     or jsonb_typeof(new.value->'emails') is distinct from 'array'
     or exists (select 1 from jsonb_object_keys(new.value) k where k <> 'emails')
     or exists (select 1 from jsonb_array_elements(new.value->'emails') e
                 where jsonb_typeof(e) <> 'string') then
    raise exception 'document_office_copy_invalid' using errcode = '22023',
      hint = 'settings.document_office_copy is {"emails": [...]} — a list of up to 5 email addresses (ADR-0179).';
  end if;

  -- Trimmed, lower-cased, de-duplicated, blanks dropped, in the order given.
  select coalesce(array_agg(a order by n), '{}') into v_clean
    from (select a, min(n) as n
            from (select lower(btrim(x)) as a, n
                    from jsonb_array_elements_text(new.value->'emails') with ordinality as t(x, n)
                   where btrim(x) <> '') s
           group by a) d;

  if cardinality(v_clean) > 5 then
    raise exception 'document_office_copy_too_many' using errcode = '22023',
      hint = 'At most 5 addresses get the office copy (ADR-0179).';
  end if;
  select a into v_bad from unnest(v_clean) as a
   where a !~ '^[^@[:space:],;]+@[^@[:space:],;]+\.[^@[:space:],;]+$' or length(a) > 254
   limit 1;
  if v_bad is not null then
    raise exception 'document_office_copy_invalid_email' using errcode = '22023', detail = v_bad;
  end if;

  new.value := jsonb_build_object('emails', to_jsonb(v_clean));
  return new;
end $$;

comment on function public.settings_document_office_copy_guard() is
  'ADR-0179: settings.document_office_copy must be {"emails": [...]} with up to 5 valid addresses; stored trimmed, lower-cased and de-duplicated. Anything else is refused (22023).';

drop trigger if exists settings_document_office_copy_guard on public.settings;
create trigger settings_document_office_copy_guard
  before insert or update on public.settings
  for each row execute function public.settings_document_office_copy_guard();

revoke execute on function public.settings_document_office_copy_guard() from public, anon, authenticated;

insert into public.settings (key, value)
values ('document_office_copy', '{"emails": []}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2 · The one reading of it
-- ---------------------------------------------------------------------
create or replace function public.document_office_copy(p_to text[] default '{}')
returns text[]
language sql stable set search_path = public, extensions as $$
  select coalesce(array_agg(d.a order by d.n), '{}')
    from (select lower(btrim(x)) as a, min(n) as n
            from settings s
           cross join lateral jsonb_array_elements_text(
                   case when jsonb_typeof(s.value) = 'object'
                         and jsonb_typeof(s.value->'emails') = 'array'
                        then s.value->'emails' else '[]'::jsonb end) with ordinality as t(x, n)
           where s.key = 'document_office_copy' and btrim(x) <> ''
           group by 1) d
   where not exists (select 1 from unnest(coalesce(p_to, '{}')) r
                      where lower(btrim(r)) = d.a)
$$;

comment on function public.document_office_copy(text[]) is
  'ADR-0179: who gets a hidden copy (BCC) of a timesheet email — settings.document_office_copy, less anyone already in To. Read by queue_event_document_email() and queue_event_document_autosend() only.';

revoke execute on function public.document_office_copy(text[]) from public, anon, authenticated;
grant  execute on function public.document_office_copy(text[]) to service_role;

-- ---------------------------------------------------------------------
-- 3 · The manual Send and the automatic send carry it
--     (20261005140200's bodies; the bcc lines are the only change)
-- ---------------------------------------------------------------------
create or replace function public.queue_event_document_email(p_document uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  d  event_documents;
  ev events;
  v_recipients text[];
  v_bcc text[];
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
  -- ADR-0179: the office's hidden copy, never in To.
  v_bcc := document_office_copy(v_recipients);

  v_key := case d.kind when 'allocation' then 'D1' else 'D2' end || ':document:' || d.id::text;

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values (v_key, 'email', case d.kind when 'allocation' then 'D1' else 'D2' end,
          v_recipients,
          event_document_email_payload(d.id)
            || case when cardinality(v_bcc) > 0 then jsonb_build_object('bcc', to_jsonb(v_bcc))
                    else '{}'::jsonb end)
  on conflict (key) do nothing;

  update event_documents
     set outbox_key = v_key, recipients = v_recipients, queued_at = coalesce(queued_at, now())
   where id = d.id;

  return jsonb_build_object('key', v_key, 'recipients', to_jsonb(v_recipients),
                            'bcc', to_jsonb(v_bcc));
end $$;

create or replace function public.queue_event_document_autosend(p_document uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  d  event_documents;
  ev events;
  v_recipients text[];
  v_bcc text[];
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
  -- ADR-0179: the office's hidden copy, never in To.
  v_bcc := document_office_copy(v_recipients);

  v_template := case d.kind when 'allocation' then 'D1' else 'D2' end;
  -- The first automatic send keeps its original key; the n-th (an updated
  -- sheet after a change) is keyed :n, so every one is unique.
  v_n := coalesce((select a.sends from event_document_autosends a
                    where a.event_id = ev.id and a.kind = d.kind), 0) + 1;
  v_key := v_template || ':auto:' || ev.id::text || case when v_n > 1 then ':' || v_n::text else '' end;

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values (v_key, 'email', v_template, v_recipients,
          event_document_email_payload(d.id)
            || case when cardinality(v_bcc) > 0 then jsonb_build_object('bcc', to_jsonb(v_bcc))
                    else '{}'::jsonb end)
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
                            'recipients', to_jsonb(v_recipients), 'bcc', to_jsonb(v_bcc));
end $$;

-- Restated bodies keep their grants (create or replace); restated here so the
-- file reads whole.
revoke execute on function public.queue_event_document_email(uuid) from public, anon;
grant  execute on function public.queue_event_document_email(uuid) to authenticated, service_role;
revoke execute on function public.queue_event_document_autosend(uuid) from public, anon, authenticated;
grant  execute on function public.queue_event_document_autosend(uuid) to service_role;
