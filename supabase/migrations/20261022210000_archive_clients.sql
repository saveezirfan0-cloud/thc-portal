-- =====================================================================
-- Migration 20261022210000 · Archive a client (ADR-0185)
--
-- What changes
-- ------------
-- §9.7 says a client record cannot be removed from the system, only
-- edited. The directory has no way to retire a client that THC no longer
-- works with, so every client ever added stays on the list as if it were
-- live. This adds an Archive / Restore pair. It removes nothing: the row,
-- its rate card, its qualified staff, its events, invoices and History all
-- stay exactly as they were, and Restore undoes it.
--
--   1 · clients.archived_at / archived_by — null while the client is live.
--   2 · archive_client() / restore_client() — office only, audited on the
--       client's History as client.archived / client.restored. A client
--       with an event today or later (not cancelled) cannot be archived:
--       the office finishes or cancels those first.
--   3 · events cannot be built for an archived client (the Shift Builder
--       does not offer one; this is the same line for any other caller).
--       Events that already exist are untouched.
--   4 · clients_directory_v gains archived_at, so /clients can hide
--       archived clients by default and show them on request.
--
-- Nothing here reaches the client role: it holds no table policy
-- (ADR-0026) and its views name their columns, so none gains the new ones.
-- A Client Portal login for an archived client keeps working.
--
-- Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The flag
-- ---------------------------------------------------------------------
alter table clients
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references profiles(id) on delete set null;

-- archived_at and archived_by are set and cleared together.
alter table clients drop constraint if exists clients_archived_whole;
alter table clients add constraint clients_archived_whole
  check (archived_at is not null or archived_by is null);

comment on column clients.archived_at is
  'ADR-0185: when the office archived this client; null while it is live. Archiving hides the client from the default directory list and from the Shift Builder and changes nothing else. Set through archive_client(), cleared through restore_client().';
comment on column clients.archived_by is
  'ADR-0185: the office user who archived the client. Null while live, and null for an archive whose login has since been removed.';

-- Every foreign key is indexed (20260921123503_db_hardening).
create index if not exists clients_archived_by_idx on clients (archived_by);

-- ---------------------------------------------------------------------
-- 2 · Archive and restore
-- ---------------------------------------------------------------------
create or replace function public.archive_client(p_client uuid)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_was timestamptz;
  v_upcoming int;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'admins_only' using errcode = '42501';
  end if;

  select archived_at into v_was from clients where id = p_client for update;
  if not found then
    raise exception 'No client %', p_client using errcode = 'no_data_found';
  end if;
  if v_was is not null then return; end if;

  -- Today (UK) counts as upcoming: the event may be under way.
  select count(*)::int into v_upcoming
    from events e
   where e.client_id = p_client
     and e.cancelled_at is null
     and e.event_date >= (now() at time zone 'Europe/London')::date;
  if v_upcoming > 0 then
    raise exception 'client_has_upcoming_events' using errcode = 'P0001', detail = v_upcoming::text;
  end if;

  -- A viewer (ADR-0060) is refused here by the office_read_only trigger on
  -- clients, before the audit row is written.
  update clients set archived_at = now(), archived_by = auth.uid() where id = p_client;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'client.archived', 'client', p_client, '{}'::jsonb);
end $$;

comment on function public.archive_client(uuid) is
  'ADR-0185: archives a client so it stops showing as active. Office only; refused with client_has_upcoming_events while the client has an event today or later that is not cancelled. Archiving again is a no-op. Audited as client.archived.';

create or replace function public.restore_client(p_client uuid)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_was timestamptz;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'admins_only' using errcode = '42501';
  end if;

  select archived_at into v_was from clients where id = p_client for update;
  if not found then
    raise exception 'No client %', p_client using errcode = 'no_data_found';
  end if;
  if v_was is null then return; end if;

  update clients set archived_at = null, archived_by = null where id = p_client;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'client.restored', 'client', p_client,
          jsonb_build_object('archived_at', v_was));
end $$;

comment on function public.restore_client(uuid) is
  'ADR-0185: brings an archived client back to the active list. Office only. Restoring a live client is a no-op. Audited as client.restored.';

revoke all on function public.archive_client(uuid) from public, anon;
revoke all on function public.restore_client(uuid) from public, anon;
grant execute on function public.archive_client(uuid) to authenticated;
grant execute on function public.restore_client(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3 · No new event for an archived client
--
-- Security invoker: the only callers that insert events are the office
-- (who reads clients) and the service role. Existing events keep their
-- client; only a new row, or an event moved to another client, is checked.
-- ---------------------------------------------------------------------
create or replace function public.events_client_not_archived()
returns trigger
language plpgsql set search_path = public, extensions as $$
begin
  -- An edit that leaves the client alone (PostgREST sends the whole row) is
  -- not "building an event for" it: past and under-way events stay editable.
  if tg_op = 'UPDATE' and new.client_id is not distinct from old.client_id then
    return new;
  end if;
  if exists (select 1 from clients c where c.id = new.client_id and c.archived_at is not null) then
    raise exception 'client_archived' using errcode = 'P0001';
  end if;
  return new;
end $$;

comment on function public.events_client_not_archived() is
  'ADR-0185: refuses an event built for an archived client. Restore the client first.';

revoke all on function public.events_client_not_archived() from public, anon, authenticated;

drop trigger if exists events_client_not_archived on events;
create trigger events_client_not_archived
  before insert or update of client_id on events
  for each row execute function public.events_client_not_archived();

-- ---------------------------------------------------------------------
-- 4 · The directory view gains archived_at
--
-- 20261004100000's body (its only one) with one column appended, which is
-- all `create or replace view` allows: every existing column keeps its
-- position and every grant on the view is kept.
-- ---------------------------------------------------------------------
create or replace view clients_directory_v with (security_invoker = true) as
select
  c.id,
  c.name,
  c.contact_name,
  c.phone,
  c.staff_contact_point,
  c.contact_emails,
  c.pays_breaks,
  c.pays_buffer,
  c.created_at,
  coalesce(
    (select array_agg(r.name order by r.name)
       from client_rate_cards rc join roles r on r.id = rc.role_id
      where rc.client_id = c.id),
    '{}'::text[]
  ) as rate_card_roles,
  (select count(*) from client_rate_cards rc where rc.client_id = c.id)::int as rate_card_count,
  (select count(*) from events e
     where e.client_id = c.id and e.cancelled_at is null)::int                as event_count,
  (select case when m.charge_total > 0 then round((1 - m.pay_total / m.charge_total) * 100, 1) end
     from clients_margins_v m where m.client_id = c.id)                        as avg_margin_pct,
  c.created_by,
  office_user_name(c.created_by)                                               as created_by_name,
  c.archived_at
from clients c;
