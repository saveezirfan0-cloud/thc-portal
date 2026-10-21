-- =====================================================================
-- Migration 20261023110000 · One-off clients (ADR-0186, THC 23.10.2026)
--
-- Why
-- ---
-- Private and one-off events each created a client, and the directory has
-- filled with names that will not book again. Every list the office works
-- from to qualify a worker (§9.6) — the candidate's Client qualification
-- panel, the staff profile's "+ Add client" — offers every one of them, so
-- clearing a new worker means ticking past hundreds of dead clients.
--
-- What changes
-- ------------
--   1 · clients.one_off: "this client is not expected to order again".
--       Off by default. A flag, not a delete (§9.7: a client record cannot
--       be removed) and not a gate: events can still be built for the
--       client, qualifications still exist and are still granted after a
--       clean shift, and auto-assign (RULE-17) ignores the flag entirely.
--       It only decides which clients the office's lists lead with.
--   2 · set_clients_one_off(uuid[], boolean): the client card's switch and
--       the directory's "mark these as one-off" in one function. Audited
--       per client as client.one_off on the client's History.
--   3 · clients_directory_v gains one_off (appended; every existing column
--       keeps its position and every grant on the view is kept).
--
-- Nothing here reaches the client role: it holds no table policy
-- (ADR-0026) and no client_* view names the new column.
--
-- Forward-only.
-- =====================================================================

alter table clients add column if not exists one_off boolean not null default false;

comment on column clients.one_off is
  'ADR-0186: true when the office has marked this client as a one-off (a private event that is not expected to order again). Only changes which clients the qualification pickers and the directory lead with; it gates nothing and auto-assign ignores it. Set through set_clients_one_off().';

create or replace function public.set_clients_one_off(p_clients uuid[], p_one_off boolean)
returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id      uuid;
  v_was     boolean;
  v_changed int := 0;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'admins_only' using errcode = '42501';
  end if;
  if p_one_off is null then
    raise exception 'one_off_must_be_on_or_off' using errcode = '22004';
  end if;
  if p_clients is null or coalesce(array_length(p_clients, 1), 0) = 0 then
    return 0;
  end if;
  if array_length(p_clients, 1) > 1000 then
    raise exception 'too_many_clients' using errcode = '22023';
  end if;

  -- In id order so two managers marking overlapping lists cannot deadlock.
  for v_id in select distinct u from unnest(p_clients) as u order by u loop
    select one_off into v_was from clients where id = v_id for update;
    if not found then
      raise exception 'No client %', v_id using errcode = 'no_data_found';
    end if;
    if v_was = p_one_off then continue; end if;

    -- A viewer (ADR-0060) is refused here by the office_read_only trigger
    -- on clients, before the audit row is written.
    update clients set one_off = p_one_off where id = v_id;

    insert into audit_log (actor, action, entity, entity_id, data)
    values (auth.uid(), 'client.one_off', 'client', v_id,
            jsonb_build_object('from', v_was, 'to', p_one_off));
    v_changed := v_changed + 1;
  end loop;

  return v_changed;
end $$;

comment on function public.set_clients_one_off(uuid[], boolean) is
  'ADR-0186: marks clients as one-off (or back to regular). Office only; a viewer is refused by the read-only guard. Returns how many actually changed; audited per client as client.one_off on the client''s History.';

revoke all on function public.set_clients_one_off(uuid[], boolean) from public, anon;
grant execute on function public.set_clients_one_off(uuid[], boolean) to authenticated;

-- ---------------------------------------------------------------------
-- The directory view gains one_off, last (create or replace can only
-- append). The body is the live one from 20261004100000.
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
  c.one_off
from clients c;
