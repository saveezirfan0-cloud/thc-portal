-- =====================================================================
-- Migration 20261012120000 · settings.edge_base_url is written by the
--                            deploy, never by a signed-in session
--                            (docs/01 §4, security Invariant 8)
--
-- 20260927160300 pinned the shape of settings.edge_base_url to a Supabase
-- Functions base, `https://<ref>.supabase.co/functions/v1`. The shape is
-- not the destination: any Back Office owner (office_can('settings'),
-- 20261001200100) — or whoever holds a stolen owner session — could still
--
--     PATCH /rest/v1/settings?key=eq.edge_base_url
--       {"value": "https://<their-own-ref>.supabase.co/functions/v1"}
--
-- and within the minute every pg_cron command, the Willo nudge and
-- auto_assign_first_round() would POST `Bearer <vault service_role_key>`
-- to a project they own. Security audit 12.10.2026, HIGH.
--
-- Two layers, both new:
--
--   1 · settings_edge_base_url_lock — a BEFORE INSERT/UPDATE/DELETE row
--       trigger that refuses any write touching the edge_base_url row
--       (old key or new key) from an API session (current_user anon or
--       authenticated) with 42501 `edge_base_url_locked`. It is NOT
--       security definer on purpose, so current_user is the caller (the
--       staff_dob_guard pattern, 20261001210000). The deploy step
--       (docs/16 §4.7, the SQL editor or a migration, as postgres) and the
--       service role are untouched. Every other settings key stays
--       writable by an owner exactly as before.
--
--   2 · An optional pin. When the vault holds a secret named
--       `supabase_project_ref` (the project's own ref, e.g. `abcdefghij`),
--       the edge_base_url — at write time and at every firing — must be
--       exactly `https://<that ref>.supabase.co/functions/v1`. The vault
--       is out of PostgREST's reach, so even a value that reached the row
--       some other way (a restore, a superuser slip) cannot point the
--       bearer at another project. Without the secret the rule is
--       20260927160300's unchanged (OWNER-TODO §3 adds the secret).
--
-- No app writes edge_base_url: the office /settings page has no control
-- for it (grep apps/ — the key appears only in packages/db's generated
-- types and an e2e comment). 786_edge_base_url_locked pins all of it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The lock
-- ---------------------------------------------------------------------
create or replace function public.settings_edge_base_url_lock()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if current_user in ('anon', 'authenticated')
     and ((tg_op in ('UPDATE', 'DELETE') and old.key = 'edge_base_url')
       or (tg_op in ('INSERT', 'UPDATE') and new.key = 'edge_base_url')) then
    raise exception 'edge_base_url_locked' using errcode = '42501',
      hint = 'settings.edge_base_url is set by the deploy (docs/16 §4.7), never from a session: the service-role key is posted there.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

comment on function public.settings_edge_base_url_lock() is
  '20261012120000: refuses any insert, update or delete of the settings row edge_base_url from an API session (anon, authenticated) with 42501 edge_base_url_locked. Invoker on purpose, so current_user is the caller. A trigger function: not an RPC.';

revoke execute on function public.settings_edge_base_url_lock() from public, anon, authenticated;

drop trigger if exists settings_edge_base_url_lock on settings;
create trigger settings_edge_base_url_lock
  before insert or update or delete on settings
  for each row execute function public.settings_edge_base_url_lock();

-- ---------------------------------------------------------------------
-- 2 · The optional pin to the project's own ref (vault)
-- ---------------------------------------------------------------------
create or replace function public.edge_base_url_pinned(p_url text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_ref text;
begin
  select lower(btrim(decrypted_secret)) into v_ref
    from vault.decrypted_secrets where name = 'supabase_project_ref'
   limit 1;
  if coalesce(v_ref, '') = '' then
    return true;   -- no pin configured: the shape rule alone (20260927160300)
  end if;
  return p_url = 'https://' || v_ref || '.supabase.co/functions/v1';
end $$;

comment on function public.edge_base_url_pinned(text) is
  '20261012120000: true when no vault secret supabase_project_ref is set, else true only for https://<that ref>.supabase.co/functions/v1. Read by the settings guard and by edge_base_url().';

revoke execute on function public.edge_base_url_pinned(text) from public, anon, authenticated;

-- The write-time guard, 20260930150100's body plus the pin.
create or replace function public.settings_edge_base_url_guard()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.key = 'edge_base_url' and not is_edge_base_url(new.value #>> '{}') then
    raise exception 'edge_base_url_not_supabase: % — must be https://<ref>.supabase.co/functions/v1 (or a local functions base)',
      coalesce(new.value #>> '{}', 'null')
      using errcode = '22023';
  end if;
  if new.key = 'edge_base_url' and not edge_base_url_pinned(new.value #>> '{}') then
    raise exception 'edge_base_url_not_this_project: % — the vault secret supabase_project_ref names another project',
      new.value #>> '{}'
      using errcode = '22023';
  end if;
  return new;
end $$;

revoke execute on function public.settings_edge_base_url_guard() from public, anon, authenticated;

-- The run-time reader, 20260927160300's body plus the pin.
create or replace function public.edge_base_url()
returns text
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare v_base text;
begin
  select value #>> '{}' into v_base from public.settings where key = 'edge_base_url';
  if coalesce(v_base, '') = '' then
    return null;
  end if;
  if not is_edge_base_url(v_base) then
    raise exception 'edge_base_url_not_supabase: %', v_base using errcode = '22023';
  end if;
  if not edge_base_url_pinned(v_base) then
    raise exception 'edge_base_url_not_this_project: %', v_base using errcode = '22023';
  end if;
  return v_base;
end $$;

comment on function public.edge_base_url() is
  'settings.edge_base_url, or null when unset; raises edge_base_url_not_supabase when the row holds anything but a Supabase Functions base, and (20261012120000) edge_base_url_not_this_project when the vault secret supabase_project_ref names a different project. Every pg_cron command, the Willo nudge and auto_assign_first_round read the base through this.';

revoke execute on function public.edge_base_url() from public, anon, authenticated;
grant  execute on function public.edge_base_url() to service_role;
