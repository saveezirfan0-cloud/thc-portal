-- =====================================================================
-- Saved views follow the manager across devices (ADR-0059, updated)
--
-- Scheduling (/events) lets a manager name the current filters ("Client
-- A · Cancelled · Week") and get them back as a chip. Until now those
-- lived in the browser's localStorage, so they did not follow a manager
-- from the office PC to a laptop. This is the table ADR-0059 described
-- and did not build: one row per (owner, scope, name), the filters as
-- JSON, readable and writable by their owner only.
--
--   * Own rows only, Back Office logins only. Each of the four policies
--     asks `(select current_app_role()) = 'admin'` AND
--     `owner = (select auth.uid())`, both wrapped so they run once per
--     statement (747, 002 §4). A worker or a client session holds a
--     grant on the table and no policy that admits it; anon holds no
--     grant at all.
--   * A per-user preference, not operational data: saving your own view
--     is allowed to every office role, including a read-only one.
--   * `query` is validated here, not only in the app: only the four known
--     filter keys, every value a string, bounded, no control characters,
--     `view` / `status` from their fixed sets and `clientId` a UUID or
--     empty. It is turned back into a /events URL on every device, so
--     nothing that is not one of those four filters can ride along.
--   * At most 30 views per owner (MAX_SAVED_VIEWS in the app), enforced by
--     the guard trigger under a per-owner advisory lock so two tabs
--     saving at once cannot both take the 30th slot.
--   * `owner` and `scope` are fixed once written; `updated_at` is kept by
--     the trigger, not by the caller.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The query validator (pure; used by the CHECK constraint)
-- ---------------------------------------------------------------------
create or replace function public.office_saved_view_query_ok(p_scope text, p_query jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $fn$
declare
  v_key   text;
  v_value jsonb;
  v_text  text;
begin
  -- One scope today. A second screen adds its own branch and its own keys.
  if p_scope is distinct from 'events' then
    return false;
  end if;
  if p_query is null or jsonb_typeof(p_query) <> 'object' then
    return false;
  end if;

  for v_key, v_value in select e.key, e.value from jsonb_each(p_query) e loop
    if v_key not in ('view', 'q', 'clientId', 'status') then
      return false;
    end if;
    if jsonb_typeof(v_value) <> 'string' then
      return false;
    end if;
    v_text := v_value #>> '{}';
    if char_length(v_text) > 100 or v_text ~ '[[:cntrl:]]' then
      return false;
    end if;
  end loop;

  -- The view is what a saved view is for; the three filters may be absent.
  if not (p_query ? 'view')
     or (p_query ->> 'view') not in ('list', 'month', 'week', 'day') then
    return false;
  end if;
  if coalesce(p_query ->> 'status', '') not in ('', 'upcoming', 'ongoing', 'completed', 'cancelled') then
    return false;
  end if;
  if coalesce(p_query ->> 'clientId', '')
       !~* '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$' then
    return false;
  end if;
  return true;
end;
$fn$;

comment on function public.office_saved_view_query_ok(text, jsonb) is
  'ADR-0059: a saved /events view''s filters are exactly {view, q, clientId, status}, each a string of at most 100 characters with no control characters; view in list/month/week/day, status empty or an event status, clientId empty or a UUID. 20261001202000.';

-- A CHECK constraint runs its function as the caller, so the office needs
-- EXECUTE; anon has no business with it.
revoke execute on function public.office_saved_view_query_ok(text, jsonb) from public, anon;
grant execute on function public.office_saved_view_query_ok(text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. The table
-- ---------------------------------------------------------------------
create table public.office_saved_views (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  scope      text not null default 'events',
  name       text not null,
  query      jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint office_saved_views_scope_known check (scope in ('events')),
  constraint office_saved_views_name_shape check (
    char_length(name) between 1 and 60
    and name = btrim(name)
    and name !~ '[[:cntrl:]]'
  ),
  constraint office_saved_views_query_shape check (public.office_saved_view_query_ok(scope, query))
);

comment on table public.office_saved_views is
  'ADR-0059: a Back Office user''s named filter sets on Scheduling (/events), per owner, across devices. Own rows only; at most 30 per owner; query validated by office_saved_view_query_ok(). 20261001202000.';

-- "Weddings" and "weddings" are one view: re-saving the name updates it.
-- Leading column `owner` also covers the foreign key (002 §3).
create unique index office_saved_views_owner_scope_name_key
  on public.office_saved_views (owner, scope, lower(name));

-- ---------------------------------------------------------------------
-- 3. The guard: cap, fixed owner/scope, timestamps
-- ---------------------------------------------------------------------
create or replace function public.office_saved_views_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_count int;
begin
  if tg_op = 'UPDATE' then
    if new.owner is distinct from old.owner or new.scope is distinct from old.scope then
      raise exception 'saved_view_fixed'
        using errcode = '22023',
              detail = 'A saved view''s owner and scope are fixed once it is saved.';
    end if;
    new.created_at := old.created_at;
    new.updated_at := now();
    return new;
  end if;

  -- INSERT. Serialise per owner so two concurrent saves cannot both see 29.
  perform pg_advisory_xact_lock(hashtextextended('office_saved_views:' || new.owner::text, 0));
  -- Rows earlier in the same multi-row INSERT are visible here (VOLATILE
  -- row trigger), so a bulk move of 31 views is refused at the 31st.
  select count(*) into v_count from public.office_saved_views where owner = new.owner;
  if v_count >= 30 then
    raise exception 'saved_views_cap'
      using errcode = '23514',
            detail = 'At most 30 saved views per person.',
            hint = 'Delete a saved view first.';
  end if;
  new.created_at := now();
  new.updated_at := new.created_at;
  return new;
end;
$fn$;

comment on function public.office_saved_views_guard() is
  'ADR-0059: at most 30 saved views per owner (per-owner advisory lock), owner and scope fixed on update, created_at/updated_at kept here. 20261001202000.';

-- A trigger needs no EXECUTE to fire; a grant would only publish it as an
-- RPC (190 §3).
revoke execute on function public.office_saved_views_guard() from public, anon, authenticated;

create trigger office_saved_views_guard
  before insert or update on public.office_saved_views
  for each row execute function public.office_saved_views_guard();

-- ---------------------------------------------------------------------
-- 4. Row level security: own rows, Back Office logins only
-- ---------------------------------------------------------------------
alter table public.office_saved_views enable row level security;

revoke all on table public.office_saved_views from public, anon;
grant select, insert, update, delete on table public.office_saved_views to authenticated;
grant all on table public.office_saved_views to service_role;

create policy admin_own_select on public.office_saved_views
  for select to authenticated
  using ((select current_app_role()) = 'admin' and owner = (select auth.uid()));

create policy admin_own_insert on public.office_saved_views
  for insert to authenticated
  with check ((select current_app_role()) = 'admin' and owner = (select auth.uid()));

create policy admin_own_update on public.office_saved_views
  for update to authenticated
  using ((select current_app_role()) = 'admin' and owner = (select auth.uid()))
  with check ((select current_app_role()) = 'admin' and owner = (select auth.uid()));

create policy admin_own_delete on public.office_saved_views
  for delete to authenticated
  using ((select current_app_role()) = 'admin' and owner = (select auth.uid()));
