-- =====================================================================
-- Migration 20260930150100 · the office can save /settings again
--
-- 20260927160300 put a BEFORE INSERT OR UPDATE trigger on `settings`,
-- settings_edge_base_url_guard(), and in the same file revoked EXECUTE on
-- is_edge_base_url() from authenticated. The trigger function was NOT
-- security definer, so it runs as the signed-in admin — and PostgreSQL
-- checks EXECUTE on every function in a PL/pgSQL expression when the
-- expression is initialised, not when a branch is reached. The
-- `new.key = 'edge_base_url' and not is_edge_base_url(...)` test therefore
-- raised "permission denied for function is_edge_base_url" for EVERY row
-- written through PostgREST, whatever its key: every Save on /settings
-- (weights, limits, rota guard, radii, Willo map, senders) has failed on
-- the live project since 27.09. Found by e2e/tests/office.settings.spec.ts
-- (audit item 54); pgTAP never saw it because the suite writes settings
-- as the table owner.
--
-- The guard is restated as SECURITY DEFINER with a pinned search_path,
-- the same shape every other trigger function here takes, and its
-- EXECUTE stays revoked from the PostgREST roles (20260927161000: a
-- trigger fires regardless of EXECUTE, so no grant is needed and none is
-- given). is_edge_base_url() stays revoked from authenticated: the guard
-- is the only caller that needs it. The rule itself is unchanged.
-- 677_settings_writable_by_the_office pins both halves.
-- =====================================================================

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
  return new;
end $$;

revoke execute on function public.settings_edge_base_url_guard() from public, anon, authenticated;
