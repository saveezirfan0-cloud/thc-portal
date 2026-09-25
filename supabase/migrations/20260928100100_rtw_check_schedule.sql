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

alter table job_schedules drop constraint if exists job_schedules_base_url_setting;
alter table job_schedules add constraint job_schedules_base_url_setting
  check (base_url_setting in ('edge_base_url', 'office_base_url'));
-- The service key only ever goes to an Edge Function (20260927160300).
alter table job_schedules drop constraint if exists job_schedules_service_key_to_edge_only;
alter table job_schedules add constraint job_schedules_service_key_to_edge_only
  check (secret_name <> 'service_role_key' or base_url_setting = 'edge_base_url');

comment on column job_schedules.base_url_setting is
  'The settings key holding the base URL edge_path is appended to: edge_base_url (Supabase Edge Functions) or office_base_url (a Back Office route, ADR-0025).';
comment on column job_schedules.secret_name is
  'The vault secret sent as the bearer token: service_role_key for an Edge Function, a route''s own secret otherwise (rtw_job_secret, ADR-0025).';

insert into job_schedules (job, cron_expression, edge_path, enabled, note, base_url_setting, secret_name) values
  ('rtw-check', '*/10 * * * *', 'api/jobs/rtw-check', false,
   '§2.6 automated right-to-work check (ADR-0025): a Back Office Node route (apps/office/app/api/jobs/rtw-check), not an Edge Function — the gov.uk fallback needs Chromium. Every 10 min; share codes filed in between also nudge it. Enable once settings.rtw_check.enabled, office_base_url, the vault secret rtw_job_secret and the office''s RTW_* env are set (OWNER-TODO §8).',
   'office_base_url', 'rtw_job_secret')
on conflict (job) do nothing;

-- Restated from its LATEST body, 20260927160300 (every Edge Function row
-- reads its base through edge_base_url(), re-checked on every firing),
-- with one change: a row names its base and its secret. The edge rows'
-- commands are exactly 20260927160300's; an office_base_url row reads
-- through office_base_url() (20260928100000), which re-checks the same
-- way. A row on any other base setting is refused by name — the bearer is
-- only ever posted to a base whose reader has a rule.
create or replace function public.install_job_schedules() returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare
  r         record;
  n         integer := 0;
  v_command text;
  v_base    text;
  v_reader  text;
begin
  -- The preconditions, checked once and loudly. edge_base_url() raises on
  -- a value that is not a Supabase Functions base.
  v_base := edge_base_url();
  if v_base is null then
    raise exception 'settings.edge_base_url is not set; nothing can be scheduled'
      using errcode = '23502';
  end if;

  for r in select * from job_schedules order by job loop
    if exists (select 1 from cron.job j where j.jobname = r.job) then
      perform cron.unschedule(r.job);
    end if;

    continue when not r.enabled;

    if r.base_url_setting = 'edge_base_url' then
      v_reader := 'public.edge_base_url()';
    elsif r.base_url_setting = 'office_base_url' then
      if office_base_url() is null then
        raise exception 'settings.office_base_url is not set; % cannot be scheduled', r.job
          using errcode = '23502';
      end if;
      v_reader := 'public.office_base_url()';
    else
      raise exception 'job % names base %, which has no guarded reader', r.job, r.base_url_setting
        using errcode = '22023';
    end if;

    -- The base and the secret are read when the command RUNS, so nothing
    -- sensitive is stored in the pg_cron command string — and the base is
    -- re-checked on every firing.
    v_command := format(
      $cmd$select net.http_post(
              url := %s || %s,
              headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = %L)
              ),
              body := jsonb_build_object('job', %L)
            );$cmd$, v_reader, quote_literal('/' || r.edge_path), r.secret_name, r.job);

    perform cron.schedule(r.job, r.cron_expression, v_command);
    n := n + 1;
  end loop;
  return n;
end;
$$;

comment on function public.install_job_schedules() is
  'Applies job_schedules to pg_cron. Run once per deploy; needs settings.edge_base_url (a Supabase Functions base — edge_base_url() refuses anything else) and vault secret service_role_key, and for an office_base_url row (rtw-check) settings.office_base_url (office_base_url() refuses anything but a Back Office origin) and that row''s secret (rtw_job_secret).';

revoke execute on function public.install_job_schedules() from public, anon, authenticated;
grant  execute on function public.install_job_schedules() to service_role;
