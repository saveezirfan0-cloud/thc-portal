-- =====================================================================
-- Bar a worker from a client they have no entry at (ADR-0146, §9.6)
--
-- Do not return is stored on a client_qualifications row (0001_init), so
-- the switch only existed on a client the worker was already cleared at.
-- The office asked on 15.10.2026 how to keep somebody off a client, could
-- not find the switch, and found the work-round ("+ Add client" first,
-- then switch it on) reads as clearing them for the client they are being
-- kept away from.
--
-- bar_from_client(staff, client, reason) does it in one step:
--
--   · entries at the client already → every one is switched on, exactly
--     as set_do_not_return() does from any one of them;
--   · no entry → ONE row is written with bar_only = true. It exists only
--     to carry the bar: do_not_return on, the reason in its note. Every
--     gate already reads "any do_not_return row at this client"
--     (20260921141500), and Wave 1 reads "a row for this role WITHOUT
--     do_not_return", so the row bars and never qualifies. role_id is
--     NOT NULL and keyed, so it names one of the worker's roles (or any
--     role for a worker who holds none); the screens show "All roles".
--
-- What keeps a bar-only row from ever becoming a clearance nobody gave:
--
--   · set_do_not_return(off) DELETES the client's bar-only rows instead
--     of leaving an unflagged entry behind — lifting a bar puts the
--     worker back where they were, uncleared;
--   · grant_client_qualification() over a bar-only row turns that row
--     into the manager's entry (role, grantor, date), still barred and
--     still with the reason: "+ Add" has never lifted a bar
--     (20260922094500), and it does not here either;
--   · the automatic grant after a clean shift never runs at a barred
--     client (20260930100000), and Remove refuses any barred row.
--
-- So a bar-only row is only ever the worker's ONE row at that client.
-- =====================================================================

alter table client_qualifications
  add column if not exists bar_only boolean not null default false;

alter table client_qualifications
  drop constraint if exists client_qualifications_bar_only_is_barred;
alter table client_qualifications
  add constraint client_qualifications_bar_only_is_barred
  check (not bar_only or do_not_return);

comment on column client_qualifications.bar_only is
  'ADR-0146: the row exists only to carry Do not return (bar_from_client) — not a clearance. Always do_not_return; deleted when the bar is lifted; turned into a real entry by grant_client_qualification().';

-- ---------------------------------------------------------------------
-- The one-step bar.
-- ---------------------------------------------------------------------
create or replace function public.bar_from_client(
  p_staff  uuid,
  p_client uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reason text := nullif(btrim(p_reason), '');
  v_role   uuid;
  v_id     uuid;
  v_rows   int;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  -- Same wording as set_do_not_return(), so the screen's message map
  -- (apps/office … actions.ts) reads both.
  if v_reason is null then
    raise exception 'Do not return needs a reason — it is shown on this client''s events (§9.6)'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from staff where id = p_staff and removed_at is null) then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if not exists (select 1 from clients where id = p_client) then
    raise exception 'unknown_client' using errcode = 'P0001';
  end if;

  -- Entries already at the client: they all carry the bar, as from the
  -- switch on any one of them (20261014093100).
  update client_qualifications
     set do_not_return = true,
         note = v_reason
   where staff_id = p_staff and client_id = p_client;
  get diagnostics v_rows = row_count;

  if v_rows > 0 then
    select id into v_id from client_qualifications
     where staff_id = p_staff and client_id = p_client
     order by bar_only, granted_at
     limit 1;
  else
    select sr.role_id into v_role
      from staff_roles sr join roles r on r.id = sr.role_id
     where sr.staff_id = p_staff
     order by r.name limit 1;
    if v_role is null then
      select id into v_role from roles order by name limit 1;
    end if;
    if v_role is null then
      raise exception 'unknown_role' using errcode = 'P0001';
    end if;

    insert into client_qualifications
           (client_id, role_id, staff_id, granted_by, do_not_return, bar_only, note)
    values (p_client, v_role, p_staff, auth.uid(), true, true, v_reason)
    returning id into v_id;
  end if;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'do_not_return_on', 'client_qualification', v_id,
          jsonb_build_object('staffId', p_staff::text,
                             'clientId', p_client::text,
                             'barOnly', v_rows = 0,
                             'reason', v_reason));

  return jsonb_build_object('id', v_id::text, 'doNotReturn', true, 'barOnly', v_rows = 0);
end $$;

comment on function public.bar_from_client(uuid, uuid, text) is
  'ADR-0146 / §9.6: Do not return at a client in one step, whether or not the worker has an entry there. Bars every existing entry, or writes one bar_only row. Reason required; Back Office only; audited as do_not_return_on.';

revoke execute on function public.bar_from_client(uuid, uuid, text) from public, anon;
grant execute on function public.bar_from_client(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- set_do_not_return — 20261014093100's body; switching OFF now deletes
-- the client's bar-only rows rather than leaving a clearance behind.
-- ---------------------------------------------------------------------
create or replace function public.set_do_not_return(
  p_id     uuid,
  p_on     boolean,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v client_qualifications;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if p_on is null then
    raise exception 'Do not return must be switched on or off' using errcode = '22004';
  end if;

  select * into v from client_qualifications where id = p_id for update;
  if v.id is null then
    raise exception 'unknown_qualification' using errcode = 'P0001';
  end if;

  if p_on and not v.do_not_return and coalesce(btrim(p_reason), '') = '' then
    raise exception 'Do not return needs a reason — it is shown on this client''s events (§9.6)'
      using errcode = 'check_violation';
  end if;

  if not p_on then
    -- ADR-0146: a row that only carried the bar goes with it.
    delete from client_qualifications
     where staff_id = v.staff_id and client_id = v.client_id and bar_only;
  end if;

  update client_qualifications
     set do_not_return = p_on,
         note = coalesce(nullif(btrim(p_reason), ''), note)
   where staff_id = v.staff_id and client_id = v.client_id;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(),
          case when p_on then 'do_not_return_on' else 'do_not_return_off' end,
          'client_qualification', p_id,
          jsonb_build_object('staffId', v.staff_id::text,
                             'clientId', v.client_id::text,
                             'roleId', v.role_id::text,
                             'barOnly', v.bar_only,
                             'reason', nullif(btrim(p_reason), '')));

  return jsonb_build_object('id', p_id::text, 'doNotReturn', p_on);
end $$;

revoke execute on function public.set_do_not_return(uuid, boolean, text) from public, anon;
grant execute on function public.set_do_not_return(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- grant_client_qualification — 20260922094500's body, plus: a bar-only
-- row at the client BECOMES this entry, still barred, reason kept.
-- ---------------------------------------------------------------------
create or replace function public.grant_client_qualification(
  p_staff  uuid,
  p_client uuid,
  p_role   uuid,
  p_note   text default null
) returns uuid
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from staff_roles where staff_id = p_staff and role_id = p_role) then
    raise exception 'A worker can only be qualified at a client for a role they already hold (§9.6)'
      using errcode = 'check_violation';
  end if;

  -- The note stays the bar's reason: it is what "Unavailable → Do not
  -- return" shows on this client's events.
  update client_qualifications
     set role_id = p_role,
         bar_only = false,
         granted_by = auth.uid(),
         granted_at = now()
   where staff_id = p_staff and client_id = p_client and bar_only
  returning id into v_id;
  if v_id is not null then
    return v_id;
  end if;

  insert into client_qualifications (client_id, role_id, staff_id, granted_by, note)
  values (p_client, p_role, p_staff, auth.uid(), nullif(btrim(p_note), ''))
  on conflict (client_id, role_id, staff_id) do update
    set note = coalesce(nullif(btrim(p_note), ''), client_qualifications.note),
        granted_by = auth.uid(),
        granted_at = now()
  returning id into v_id;

  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- The two lists carry the flag (appended, so create or replace holds).
-- ---------------------------------------------------------------------
create or replace view staff_client_qualifications_v with (security_invoker = true) as
select
  q.id,
  q.staff_id,
  q.client_id,
  cl.name                                                    as client_name,
  q.role_id,
  r.name                                                     as role_name,
  case when q.granted_from_event is not null then 'automatic' else 'manual' end as granted_how,
  q.granted_by,
  p.full_name                                                as granted_by_name,
  q.granted_from_event,
  ev.title                                                   as granted_from_event_title,
  ev.event_date                                              as granted_from_event_date,
  q.granted_at,
  q.do_not_return,
  q.note,
  q.bar_only
from client_qualifications q
join clients cl on cl.id = q.client_id
join roles r on r.id = q.role_id
left join profiles p on p.id = q.granted_by
left join events ev on ev.id = q.granted_from_event;

create or replace view clients_qualified_staff_v with (security_invoker = true) as
select
  q.client_id,
  d.id                                                       as staff_id,
  d.display_name,
  d.employee_id,
  d.photo_path,
  d.status,
  d.rating,
  d.reliability,
  array_agg(r.name order by r.name)                          as role_names,
  array_agg(q.role_id order by r.name)                       as role_ids,
  array_agg(q.id order by r.name)                            as qualification_ids,
  bool_or(q.do_not_return)                                   as do_not_return,
  min(q.granted_at)                                          as first_granted_at,
  max(q.granted_at)                                          as last_granted_at,
  case when bool_or(q.granted_by is not null) then 'manual' else 'automatic' end as granted_how,
  max(p.full_name)                                           as granted_by_name,
  max(ev.title)                                              as granted_from_event_title,
  max(ev.event_date)                                         as granted_from_event_date,
  string_agg(q.note, ' · ') filter (where q.note is not null) as notes,
  -- ADR-0146: barred here without being cleared here — no role group.
  bool_and(q.bar_only)                                       as bar_only
from client_qualifications q
join staff_directory_v d on d.id = q.staff_id
join roles r on r.id = q.role_id
left join profiles p on p.id = q.granted_by
left join events ev on ev.id = q.granted_from_event
group by q.client_id, d.id, d.display_name, d.employee_id, d.photo_path,
         d.status, d.rating, d.reliability;
