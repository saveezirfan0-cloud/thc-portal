-- =====================================================================
-- The rtw-check schedule: a job that is not an Edge Function (ADR-0025)
--
-- Every §7 job so far is an Edge Function: install_job_schedules()
-- (20260921130927) posts to settings.edge_base_url || edge_path with the
-- vault secret service_role_key. The automated right-to-work check cannot
-- be one — its gov.uk fallback drives a headless Chromium, which Supabase's
-- Deno runtime cannot run — so it is a Node route in the Back Office,
-- apps/office/app/api/jobs/rtw-check, on Vercel.
--
-- Two columns let a registry row name its own base URL setting and bearer
-- secret. Every existing row keeps edge_base_url / service_role_key, so
-- their pg_cron commands post to the same URL with the same key. The office
-- route is called with its OWN secret (vault rtw_job_secret, env
-- RTW_JOB_SECRET on the Vercel project), never the service key: the key
-- would otherwise have to leave Supabase to authenticate a Vercel route.
--
-- The row is registered DISABLED, like willo-invite, until THC has chosen
-- a provider and the keys exist (OWNER-TODO §8). Enabling it is a
-- migration plus pgTAP 190's list, in the same commit.
-- =====================================================================

alter table job_schedules
  add column if not exists base_url_setting text not null default 'edge_base_url',
  add column if not exists secret_name      text not null default 'service_role_key';

comment on column job_schedules.base_url_setting is
  'The settings key holding the base URL edge_path is appended to: edge_base_url (Supabase Edge Functions) or office_base_url (a Back Office route, ADR-0025).';
comment on column job_schedules.secret_name is
  'The vault secret sent as the bearer token: service_role_key for an Edge Function, a route''s own secret otherwise (rtw_job_secret, ADR-0025).';

insert into job_schedules (job, cron_expression, edge_path, enabled, note, base_url_setting, secret_name) values
  ('rtw-check', '*/10 * * * *', 'api/jobs/rtw-check', false,
   '§2.6 automated right-to-work check (ADR-0025): a Back Office Node route (apps/office/app/api/jobs/rtw-check), not an Edge Function — the gov.uk fallback needs Chromium. Every 10 min; share codes filed in between also nudge it. Enable once settings.rtw_check.enabled, office_base_url, the vault secret rtw_job_secret and the office''s RTW_* env are set (OWNER-TODO §8).',
   'office_base_url', 'rtw_job_secret')
on conflict (job) do nothing;

-- As 20260921130927, reading each row's base URL setting and secret. The
-- edge_base_url precondition is unchanged (checked once and loudly); a row
-- on another base is refused by name when that setting is missing and the
-- row is enabled, rather than scheduled to post to `null`.
create or replace function public.install_job_schedules() returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare
  r         record;
  n         integer := 0;
  v_command text;
  v_base    text;
begin
  select value #>> '{}' into v_base from public.settings where key = 'edge_base_url';
  if v_base is null or v_base = '' then
    raise exception 'settings.edge_base_url is not set; nothing can be scheduled'
      using errcode = '23502';
  end if;

  for r in select * from job_schedules order by job loop
    if exists (select 1 from cron.job j where j.jobname = r.job) then
      perform cron.unschedule(r.job);
    end if;

    continue when not r.enabled;

    if r.base_url_setting <> 'edge_base_url' then
      select value #>> '{}' into v_base from public.settings where key = r.base_url_setting;
      if v_base is null or v_base = '' then
        raise exception 'settings.% is not set; % cannot be scheduled', r.base_url_setting, r.job
          using errcode = '23502';
      end if;
    end if;

    -- Both values are read when the command RUNS, so nothing sensitive is
    -- stored in the pg_cron command string.
    v_command := format(
      $cmd$select net.http_post(
              url := rtrim((select value #>> '{}' from public.settings where key = %L), '/') || %L,
              headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = %L)
              ),
              body := jsonb_build_object('job', %L)
            );$cmd$, r.base_url_setting, '/' || r.edge_path, r.secret_name, r.job);

    perform cron.schedule(r.job, r.cron_expression, v_command);
    n := n + 1;
  end loop;
  return n;
end;
$$;

comment on function public.install_job_schedules() is
  'Applies job_schedules to pg_cron. Run once per deploy; needs settings.edge_base_url and vault secret service_role_key, and for a row on another base (rtw-check: office_base_url + rtw_job_secret) that setting and secret too.';

revoke execute on function public.install_job_schedules() from public, anon, authenticated;
grant  execute on function public.install_job_schedules() to service_role;
