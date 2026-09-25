-- =====================================================================
-- Migration 20260927160300 · where the service-role bearer may be posted
--                            (docs/01-architecture.md §4, security
--                            Invariant 8)
--
-- Every §7 job is a pg_cron command that POSTs to
-- `settings.edge_base_url || '/<function>'` with the service-role key
-- from Vault as its bearer. The key half of that pair is out of
-- PostgREST's reach; the URL half was an admin-writable `settings` row
-- with no check of any kind, so whoever held an admin session (or a
-- stolen one) could `PATCH /rest/v1/settings?key=eq.edge_base_url` to
-- `https://attacker.example` and, within the minute, receive the
-- service-role key in an Authorization header.
--
-- The URL stays in settings — it is not a secret and the owner guide
-- (docs/16 §4.7) sets it there — but it can now only be a Supabase
-- Functions base (the project's own `https://<ref>.supabase.co/
-- functions/v1`) or a local development one. Three layers:
--
--   1. is_edge_base_url(text) — the rule, one place.
--   2. A BEFORE trigger on settings refuses any other value at write
--      time, from PostgREST or from SQL.
--   3. edge_base_url() — the READER every command uses, re-checks at run
--      time, so a value that reached the row some other way (a restore,
--      a superuser) posts nothing rather than posting the key.
--
-- install_job_schedules() and willo_invite_nudge() are restated from
-- their latest bodies to read through edge_base_url(); the cron command
-- string calls it too, so the check runs on every firing.
-- =====================================================================

create or replace function public.is_edge_base_url(p_url text)
returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  select p_url is not null and (
       p_url ~ '^https://[a-z0-9-]+\.supabase\.(co|in|red)/functions/v1$'
    or p_url ~ '^http://(127\.0\.0\.1|localhost|host\.docker\.internal|kong|supabase_edge_runtime[a-z0-9_-]*)(:[0-9]+)?/functions/v1$'
  )
$$;

comment on function public.is_edge_base_url(text) is
  'True for a Supabase Functions base URL (https://<ref>.supabase.co/functions/v1) or a local development one. The only destinations the service-role bearer may be posted to (docs/01 §4, Invariant 8).';

create or replace function public.settings_edge_base_url_guard()
returns trigger
language plpgsql
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

drop trigger if exists settings_edge_base_url_guard on settings;
create trigger settings_edge_base_url_guard
  before insert or update on settings
  for each row execute function public.settings_edge_base_url_guard();

-- The reader. Null when unset (nothing scheduled, nothing nudged); an
-- exception when set to anything the rule refuses, so a bad value can
-- never be the destination of a bearer.
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
  return v_base;
end $$;

comment on function public.edge_base_url() is
  'settings.edge_base_url, or null when unset; raises edge_base_url_not_supabase when the row holds anything but a Supabase Functions base. Every pg_cron command and the Willo nudge read the base through this.';

revoke execute on function public.is_edge_base_url(text) from public, anon, authenticated;
revoke execute on function public.edge_base_url() from public, anon, authenticated;
revoke execute on function public.settings_edge_base_url_guard() from public, anon, authenticated;
grant  execute on function public.edge_base_url() to service_role;

-- ---------------------------------------------------------------------
-- install_job_schedules(), from 20260921130927, reading through the guard.
-- ---------------------------------------------------------------------
create or replace function public.install_job_schedules() returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare
  r         record;
  n         integer := 0;
  v_command text;
  v_base    text;
begin
  -- The preconditions, checked once and loudly. Without the base URL every
  -- command below builds `url := null` and fails at cron time with nothing
  -- pointing at the cause. edge_base_url() raises on a value that is not a
  -- Supabase Functions base.
  v_base := edge_base_url();
  if v_base is null then
    raise exception 'settings.edge_base_url is not set; nothing can be scheduled'
      using errcode = '23502';
  end if;

  for r in select * from job_schedules loop
    -- cron.unschedule throws if the job is absent, which is the normal
    -- first-install case. Checking the catalogue instead of swallowing every
    -- error keeps a permission failure visible.
    if exists (select 1 from cron.job j where j.jobname = r.job) then
      perform cron.unschedule(r.job);
    end if;

    continue when not r.enabled;

    -- Both secrets are read when the command RUNS, not now, so nothing
    -- sensitive is stored in the pg_cron command string — and the base URL
    -- is re-checked on every firing.
    v_command := format(
      $cmd$select net.http_post(
              url := public.edge_base_url() || %s,
              headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
              ),
              body := jsonb_build_object('job', %L)
            );$cmd$, quote_literal('/' || r.edge_path), r.job);

    perform cron.schedule(r.job, r.cron_expression, v_command);
    n := n + 1;
  end loop;
  return n;
end;
$$;

comment on function public.install_job_schedules() is
  'Applies job_schedules to pg_cron. Run once per deploy; needs settings.edge_base_url (a Supabase Functions base — edge_base_url() refuses anything else) and vault secret service_role_key.';

-- ---------------------------------------------------------------------
-- willo_invite_nudge(), from 20260924110000, reading through the guard.
-- Inside its own exception block, as before: a refused base URL warns
-- and never fails the application write that fired it.
-- ---------------------------------------------------------------------
create or replace function public.willo_invite_nudge()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_base text;
  v_key  text;
begin
  if new.willo_candidate_id is not null or new.removed_at is not null then
    return null;
  end if;
  begin
    v_base := edge_base_url();
    if coalesce(v_base, '') = '' then
      return null;
    end if;
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
    if coalesce(v_key, '') = '' then
      return null;
    end if;
    perform net.http_post(
      url     := v_base || '/willo-webhook/invite',
      body    := jsonb_build_object('job', 'willo-invite', 'staffId', new.id::text),
      params  := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || v_key));
  exception when others then
    raise warning 'willo_invite_nudge: %', sqlerrm;
  end;
  return null;
end $$;
