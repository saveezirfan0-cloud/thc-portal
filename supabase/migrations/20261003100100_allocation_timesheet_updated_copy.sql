-- =====================================================================
-- Migration 20261003100100 · An updated Allocation Timesheet goes out when
--                            the line-up changes and is firm again
--                            (§3.5, §11.4; ADR-0084, owner 03.10.2026)
--
-- What changes
-- ------------
-- ADR-0074 sent the Allocation Timesheet (D1) at most once per event. A
-- change after that left the client holding a stale sheet. Now, once a D1
-- has gone (the automatic one, or a manager's Send since 00:00 UK the day
-- before), a CHANGE to what the sheet shows sends an updated copy — but
-- only when the change is 100% confirmed by the staff it affects:
--
--   changed  the sheet's fingerprint differs from the fingerprint of the
--            latest copy that was emailed. The fingerprint is a hash of
--            exactly what the Allocation Timesheet prints and nothing else:
--            title, date and PO, and per confirmed worker the employee
--            number, role and the role section's start and end. A change
--            the sheet does not show (headcount or buffer with nobody added
--            or removed, rates, venue, dress code) is no change to the
--            client, and sends nothing.
--   firm     unfilled = 0 (20261003100000): every section at its headcount
--            and nobody Awaiting re-confirmation (reconfirm_required, §3.5).
--            So a moved time holds the updated copy until every worker on
--            that role has pressed Confirm new time, a raised headcount
--            until the new slots are confirmed, and a dropout until a
--            replacement is.
--
-- The same gates as the first send apply — not cancelled, someone confirmed,
-- a contact email, and never once the first shift has started (`too_late`).
-- Unlike the first send there is no clock time to wait for: the client
-- already has a sheet. Each round of change is its own revision: key
-- 'D1:auto:<event>:<n>', its own claim and its own eight attempts, and a
-- fingerprint that has been sent is never sent twice. The email is the D1
-- template with "Updated" in the subject and a line saying it replaces the
-- earlier sheet (packages/notifications).
--
-- A copy emailed before this migration has no fingerprint; an event whose
-- latest copy has none is treated as unchanged, so switching this on never
-- emails every client who already holds a sheet. D2 is untouched.
--
-- Mirrored, verdict for verdict, by autosendVerdict() in
-- apps/office/app/api/jobs/event-documents/_lib/schedule.ts.
--
-- Restated from 20261002100000 / 20261003100000, one change each:
--   document_autosend_verdict  two trailing params, the changed/baseline
--                              logic in the allocation branch
--   event_documents_due        the two fingerprints as columns; the claim
--                              facts read the OPEN revision
--   event_document_autosend_claim   picks the revision
--   queue_event_document_autosend   key with the revision, "updated" payload
-- The job's other functions work on "the open row" (queued_at is null,
-- at most one per event and kind) and need no change.
--
-- Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · What the Allocation Timesheet shows, as a hash
-- ---------------------------------------------------------------------
create or replace function public.event_allocation_fingerprint(p_event uuid)
returns text
language sql stable security definer set search_path = public, extensions as $$
  select md5(
    coalesce((select e.title || '|' || e.event_date::text || '|' || coalesce(e.po_number, '')
                from events e where e.id = p_event), '')
    || '#' ||
    coalesce((select string_agg(
                       st.employee_id::text || '|' || r.name || '|'
                         || extract(epoch from sr.starts_at)::bigint::text || '|'
                         || extract(epoch from sr.ends_at)::bigint::text,
                       ';' order by sr.starts_at, r.name, st.employee_id)
                from bookings b
                join shift_requirements sr on sr.id = b.shift_id
                join roles r               on r.id = sr.role_id
                join staff st              on st.id = b.staff_id
               where sr.event_id = p_event
                 and b.status in ('confirmed', 'worked')), ''))
$$;

comment on function public.event_allocation_fingerprint(uuid) is
  'ADR-0084: md5 of what the Allocation Timesheet prints — event title, date, PO and, per confirmed or worked booking, employee number, role and the section''s start and end (epoch seconds, so the session zone cannot move it). Service role only; stored on each allocation copy by event_documents_fingerprint_trg.';

-- ---------------------------------------------------------------------
-- 2 · Every allocation copy records the fingerprint it was drawn at
-- ---------------------------------------------------------------------
alter table event_documents add column if not exists fingerprint text;

comment on column event_documents.fingerprint is
  'ADR-0084: event_allocation_fingerprint() when this Allocation Timesheet copy was recorded; null for a copy recorded before 20261003100100 and for a Completed Allocation Timesheet.';

create or replace function public.event_documents_fingerprint()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.kind = 'allocation' and new.fingerprint is null then
    new.fingerprint := event_allocation_fingerprint(new.event_id);
  end if;
  return new;
end $$;

drop trigger if exists event_documents_fingerprint_trg on public.event_documents;
create trigger event_documents_fingerprint_trg
  before insert on public.event_documents
  for each row execute function public.event_documents_fingerprint();

-- ---------------------------------------------------------------------
-- 3 · One automatic send per event, kind AND revision
-- ---------------------------------------------------------------------
alter table event_document_autosends add column if not exists revision int not null default 0
  check (revision >= 0);

alter table event_document_autosends drop constraint if exists event_document_autosends_pkey;
alter table event_document_autosends add primary key (event_id, kind, revision);

comment on column event_document_autosends.revision is
  'ADR-0084: 0 = the first automatic send; n = the n-th updated copy after a change. At most one row per event and kind is open (queued_at null) at a time.';

-- ---------------------------------------------------------------------
-- 4 · The rule
-- ---------------------------------------------------------------------
drop function if exists public.event_documents_due(timestamptz, uuid);
drop function if exists public.document_autosend_verdict(text, timestamptz, jsonb, date, timestamptz, timestamptz, boolean, int, int, int, timestamptz, timestamptz, timestamptz, int, int);

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
  -- Claims already spent on the open revision (a live one not counted).
  p_attempts             int default 0,
  -- Headcount slots not firmly confirmed over the role sections; 0 = firm.
  p_unfilled             int default 0,
  -- ADR-0084: the fingerprint of the latest Allocation Timesheet copy that
  -- was emailed, and of the sheet as it would print now. Either null = unknown.
  p_sent_fingerprint     text default null,
  p_current_fingerprint  text default null
) returns text
language plpgsql immutable set search_path = public, extensions as $$
declare
  v_cfg     jsonb := coalesce(p_config, '{}'::jsonb)
                       -> case p_kind when 'allocation' then 'allocation' else 'completed' end;
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
  v_day_before timestamptz;
  v_manual_fresh boolean;
  v_changed boolean;
begin
  if jsonb_typeof(v_cfg->'not_before') = 'string' then
    begin
      v_not_before := (v_cfg->>'not_before')::timestamptz;
    exception when others then
      v_not_before := null;
    end;
  end if;
  if p_kind = 'allocation' then
    v_due        := ((p_event_date - 1) + v_time) at time zone 'Europe/London';
    v_day_before := (p_event_date - 1)::timestamp at time zone 'Europe/London';
    -- A manager's copy since 00:00 UK the day before is as good as ours.
    v_manual_fresh := coalesce(p_manual_allocation_at >= v_day_before, false);
    -- Changed: a copy has gone (ours, or a fresh manual one), its fingerprint
    -- is known, and the sheet now prints something else.
    v_changed := (p_auto_queued_at is not null or v_manual_fresh)
                 and p_sent_fingerprint is not null
                 and p_current_fingerprint is not null
                 and p_sent_fingerprint <> p_current_fingerprint;
    return case
      when not v_enabled                                  then 'disabled'
      when p_auto_queued_at is not null and not v_changed then 'already_sent'
      when p_cancelled                                    then 'cancelled'
      -- The send time only gates the FIRST copy; the client already has one.
      when not v_changed and p_now < v_due                then 'not_yet'
      when p_first_start is not null
           and p_now >= p_first_start                     then 'too_late'
      when coalesce(p_confirmed, 0) = 0                   then 'no_confirmed_staff'
      when coalesce(p_contacts, 0) = 0                    then 'no_contact_emails'
      when not v_changed and v_manual_fresh               then 'manual_sent'
      when coalesce(p_unfilled, 0) > 0                    then 'not_filled'
      when coalesce(p_attempts, 0) >= 8                   then 'gave_up'
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

comment on function public.document_autosend_verdict(text, timestamptz, jsonb, date, timestamptz, timestamptz, boolean, int, int, int, timestamptz, timestamptz, timestamptz, int, int, text, text) is
  'ADR-0074/0084: due | disabled | already_sent | cancelled | not_yet | too_late | before_activation | hold_expired | no_confirmed_staff | no_contact_emails | manual_sent | not_filled | held_no_checkout | gave_up for one automatic D1/D2. D1 after a copy has gone: due again when the sheet''s fingerprint changed and the line-up is firm (the updated copy). Pure; mirrored by autosendVerdict() in apps/office/app/api/jobs/event-documents/_lib/schedule.ts.';

-- ---------------------------------------------------------------------
-- 5 · event_documents_due — with the fingerprints
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
  attempts             int,
  sent_fingerprint     text,
  current_fingerprint  text
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
           (select max(sr.ends_at)   from shift_requirements sr where sr.event_id = e.id) as last_end,
           event_allocation_fingerprint(e.id) as current_fingerprint
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
           -- The latest automatic send, of any revision.
           (select max(a.queued_at) from event_document_autosends a
             where a.event_id = ev.id and a.kind = k.kind) as auto_queued_at,
           -- Claims spent on the OPEN revision: a claim whose lease is still
           -- live is the run working on it now, and not yet spent.
           coalesce((select a.attempts - case when a.lease_until > p_now then 1 else 0 end
                       from event_document_autosends a
                      where a.event_id = ev.id and a.kind = k.kind and a.queued_at is null), 0) as attempts,
           -- The latest Allocation Timesheet copy that was EMAILED, by anyone.
           (select d.fingerprint from event_documents d
             where d.event_id = ev.id and d.kind = 'allocation' and d.queued_at is not null
             order by d.queued_at desc limit 1) as sent_fingerprint
      from ev
      cross join (values ('allocation'::text), ('signout')) as k(kind)
      cross join lateral event_document_tally(ev.id) t
      -- ADR-0084: headcount slots not firmly confirmed, per role section —
      -- empty, or held by a worker still Awaiting a change (reconfirm_required);
      -- confirmed or worked, buffer excluded.
      cross join lateral (
        select coalesce(sum(greatest(0, sr.headcount - f.n)), 0)::int as unfilled
          from shift_requirements sr
          cross join lateral (
            select count(*)::int as n from bookings b
             where b.shift_id = sr.id and b.status in ('confirmed', 'worked')
               and not b.reconfirm_required) f
         where sr.event_id = ev.id) u
  )
  select f.id, f.kind,
         document_autosend_verdict(f.kind, p_now, v_cfg, f.event_date, f.first_start, f.last_end,
                                   f.cancelled, f.confirmed, f.contacts, f.undetermined,
                                   f.manual_allocation_at, f.signout_queued_at, f.auto_queued_at,
                                   f.attempts, f.unfilled, f.sent_fingerprint, f.current_fingerprint),
         f.event_date, f.first_start, f.last_end, f.cancelled, f.confirmed, f.contacts,
         f.undetermined, f.unfilled, f.manual_allocation_at, f.signout_queued_at, f.auto_queued_at,
         f.attempts, f.sent_fingerprint, f.current_fingerprint
    from facts f
   order by f.event_date, f.id, f.kind;
end $$;

comment on function public.event_documents_due(timestamptz, uuid) is
  'ADR-0074/0084: the event-documents job''s candidates — events dated hold_days + 2 days ago to tomorrow (UK), or one event — with the facts document_autosend_verdict() reads (unfilled; the fingerprint of the latest emailed Allocation Timesheet and of the sheet now) and its verdict per kind. Service role only.';

-- ---------------------------------------------------------------------
-- 6 · Claim — takes the open revision, or opens the next one
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
  v_rev     int;
begin
  if p_kind not in ('allocation', 'signout') then
    raise exception 'unknown_document_kind' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('document-autosend:' || p_event::text || ':' || p_kind));

  select d.verdict into v_verdict from event_documents_due(v_now, p_event) d where d.kind = p_kind;
  if v_verdict is distinct from 'due' then
    return false;
  end if;

  -- The open revision (a retry, or a lapsed lease), else the next one: 0 for
  -- the first automatic send, n after n sent copies (ADR-0084).
  select a.revision into v_rev from event_document_autosends a
   where a.event_id = p_event and a.kind = p_kind and a.queued_at is null;
  if v_rev is null then
    select coalesce(max(a.revision) + 1, 0) into v_rev from event_document_autosends a
     where a.event_id = p_event and a.kind = p_kind;
  end if;

  insert into event_document_autosends as a (event_id, kind, revision, claimed_at, lease_until, attempts)
  values (p_event, p_kind, v_rev, now(), v_now + v_lease, 1)
  on conflict (event_id, kind, revision) do update
     set claimed_at = now(), lease_until = v_now + v_lease, attempts = a.attempts + 1
   where a.queued_at is null
     and (a.lease_until is null or a.lease_until <= v_now)
     and a.attempts < 8
  returning true into v_taken;

  return coalesce(v_taken, false);
end $$;

-- ---------------------------------------------------------------------
-- 7 · Queue — the key carries the revision; an updated copy says so
-- ---------------------------------------------------------------------
create or replace function public.queue_event_document_autosend(p_document uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  d  event_documents;
  ev events;
  v_client clients;
  v_template text;
  v_key text;
  v_rev int;
  v_payload jsonb;
  v_inserted int;
  v_verdict text;
begin
  select * into d from event_documents where id = p_document;
  if d.id is null then raise exception 'document_not_found' using errcode = 'P0002'; end if;
  if not d.automatic then raise exception 'not_an_automatic_copy' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('document-autosend:' || d.event_id::text || ':' || d.kind));

  select x.verdict into v_verdict from event_documents_due(now(), d.event_id) x where x.kind = d.kind;
  if v_verdict is distinct from 'due' then
    update event_document_autosends
       set lease_until = null, last_error = 'skipped: ' || coalesce(v_verdict, 'no verdict')
     where event_id = d.event_id and kind = d.kind and queued_at is null;
    return jsonb_build_object('key', null, 'queued', false, 'skipped', v_verdict);
  end if;

  select * into ev from events where id = d.event_id;
  if ev.cancelled_at is not null then raise exception 'event_cancelled' using errcode = 'P0001'; end if;
  select * into v_client from clients where id = ev.client_id;
  if coalesce(array_length(v_client.contact_emails, 1), 0) = 0 then
    raise exception 'client_has_no_contact_email' using errcode = 'P0001';
  end if;

  select a.revision into v_rev from event_document_autosends a
   where a.event_id = ev.id and a.kind = d.kind and a.queued_at is null;
  v_rev := coalesce(v_rev, 0);

  v_template := case d.kind when 'allocation' then 'D1' else 'D2' end;
  v_key := v_template || ':auto:' || ev.id::text || case when v_rev > 0 then ':' || v_rev::text else '' end;

  v_payload := event_document_email_payload(d.id);
  if d.kind = 'allocation' and v_rev > 0 then
    -- Read by packages/notifications: "Updated" in the subject and the line
    -- saying this replaces the earlier sheet.
    v_payload := v_payload || jsonb_build_object('updated', 'true');
  end if;

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values (v_key, 'email', v_template, v_client.contact_emails, v_payload)
  on conflict (key) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    update event_documents
       set outbox_key = v_key, recipients = v_client.contact_emails, queued_at = now()
     where id = d.id;
  end if;

  -- Done for this revision either way: an outbox row under this key exists.
  update event_document_autosends
     set outbox_key = v_key, queued_at = coalesce(queued_at, now()), lease_until = null, last_error = null
   where event_id = ev.id and kind = d.kind and revision = v_rev and queued_at is null;

  return jsonb_build_object('key', v_key, 'queued', v_inserted = 1, 'revision', v_rev,
                            'recipients', to_jsonb(v_client.contact_emails));
end $$;

-- ---------------------------------------------------------------------
-- 8 · Grants — the job's functions are the service role's alone
-- ---------------------------------------------------------------------
revoke execute on function
  public.event_allocation_fingerprint(uuid),
  public.event_documents_fingerprint(),
  public.document_autosend_verdict(text, timestamptz, jsonb, date, timestamptz, timestamptz, boolean, int, int, int, timestamptz, timestamptz, timestamptz, int, int, text, text),
  public.event_documents_due(timestamptz, uuid),
  public.event_document_autosend_claim(uuid, text, timestamptz, int),
  public.queue_event_document_autosend(uuid)
from public, anon, authenticated;

grant execute on function
  public.event_allocation_fingerprint(uuid),
  public.document_autosend_verdict(text, timestamptz, jsonb, date, timestamptz, timestamptz, boolean, int, int, int, timestamptz, timestamptz, timestamptz, int, int, text, text),
  public.event_documents_due(timestamptz, uuid),
  public.event_document_autosend_claim(uuid, text, timestamptz, int),
  public.queue_event_document_autosend(uuid)
to service_role;
