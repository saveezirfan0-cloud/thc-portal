-- =====================================================================
-- Migration 20261013210000 · spatial_ref_sys is read-only for every API
--                            role (ADR-0131; Supabase security email,
--                            11.10.2026)
--
-- ADR-0010 left PostGIS's EPSG lookup table as a recorded hole: Supabase
-- creates the extension as supabase_admin, which therefore owns the table
-- and granted anon, authenticated and service_role full DML on it. Only
-- the owner can enable RLS or revoke those grants, so the anon key can
-- still insert a forged projection, delete SRID 4326 (every geography
-- column here) or truncate the table. The owner's "Enable RLS" button in
-- the dashboard fails with 42501 "must be owner of table" for the same
-- reason.
--
-- What postgres DOES hold on that table is the TRIGGER privilege (checked
-- on the live project, 13.10.2026), and CREATE TRIGGER needs nothing more.
-- So the write is closed here by a statement trigger instead of a policy:
--
--   · BEFORE INSERT / UPDATE / DELETE / TRUNCATE, FOR EACH STATEMENT, so
--     it fires even when a DELETE matches no row and covers TRUNCATE,
--     which no row trigger and no RLS policy can.
--   · It refuses (42501) when the statement runs as anon, authenticated
--     or service_role, or arrives through PostgREST at all (session user
--     `authenticator`), so a definer function reached over the API cannot
--     write it either. Nothing in this system writes the table: postgres
--     and supabase_admin (a PostGIS upgrade, a restore) are let through.
--   · Reads are untouched. PostGIS reads this table as whoever is
--     connected, so a deny-all would break coordinate work (ADR-0010).
--
-- What this does NOT do: turn RLS on. The Supabase advisor's
-- rls_disabled_in_public lint reads relrowsecurity, so it keeps listing
-- this one table until Supabase support runs ADR-0131's three statements
-- as supabase_admin. The hole the lint is about is closed by this file.
--
-- One-way on Supabase: DROP TRIGGER and ALTER TABLE … DISABLE TRIGGER both
-- need the table's owner, so postgres can never remove this trigger. To
-- stand it down, `create or replace` the function below with a body that
-- only returns null. The DO block makes a re-run a no-op for the same
-- reason: there is no `drop trigger if exists` to put in front of it.
--
-- Locally (scripts/pgtest-local.sh) postgres owns PostGIS and
-- 20260921123503 already turned RLS on; the trigger goes on top and the
-- refusal is the same 42501 in every environment.
-- pgTAP: supabase/tests/002_schema_hardening.sql assertions 6–12.
-- =====================================================================

create or replace function public.spatial_ref_sys_read_only_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated', 'service_role')
     or session_user = 'authenticator' then
    raise exception 'spatial_ref_sys is read-only (ADR-0131)'
      using errcode = '42501';
  end if;
  return null;
end $$;

-- A trigger needs no EXECUTE grant to fire (190_job_function_grants §3).
revoke all on function public.spatial_ref_sys_read_only_guard()
  from public, anon, authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.spatial_ref_sys'::regclass
                    and tgname = 'spatial_ref_sys_read_only') then
    create trigger spatial_ref_sys_read_only
      before insert or update or delete or truncate on public.spatial_ref_sys
      for each statement execute function public.spatial_ref_sys_read_only_guard();
  end if;
end $$;
