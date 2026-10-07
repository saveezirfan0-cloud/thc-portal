-- =====================================================================
-- Switch on the automated right-to-work check against the SANDBOX
-- provider, for a demo of candidate onboarding (ADR-0063).
--
-- What it does, on the demo database only:
--   · settings.rtw_check: enabled, primary = provider, no fallback, and
--     admin_confirms kept ON (every result waits for the office, ADR-0041)
--   · the vault secrets office_base_url and rtw_job_secret, so a filed
--     share code nudges the runner at once and pg_cron sweeps every minute
--   · the rtw-check job enabled and installed
--
-- Before running it, on the Back Office's Vercel project (thc-portal-office),
-- Production, then redeploy:
--   RTW_PROVIDER_URL = sandbox:
--   RTW_JOB_SECRET   = the same value as <RTW_JOB_SECRET> below
--                      (generate it: openssl rand -base64 48)
-- Leave RTW_GOVUK_ENABLED unset: with no fallback, a code that is not a
-- demo code is retried and then goes to Needs review — never to gov.uk.
--
-- Replace the two placeholders, then paste into the SQL editor or run
--   psql "$DATABASE_URL" -f supabase/demo/rtw-check-sandbox-on.sql
-- It is idempotent. rtw-check-sandbox-off.sql undoes it.
--
-- Never run it against a database holding real workers.
-- =====================================================================
begin;

do $$
declare
  v_origin text := '<OFFICE_ORIGIN>';   -- e.g. https://thc-portal-office.vercel.app (no path)
  v_secret text := '<RTW_JOB_SECRET>';  -- at least 32 characters; the same as on Vercel
begin
  if not exists (select 1 from staff where id = '20000000-0000-4000-8000-000000000002'
                                       and email = 'tom.reid@example.com') then
    raise exception 'rtw-check-sandbox-on.sql: the seed.sql demo workers are not present — refusing to run';
  end if;
  if v_origin like '<%' or v_secret like '<%' then
    raise exception 'rtw-check-sandbox-on.sql: replace <OFFICE_ORIGIN> and <RTW_JOB_SECRET> first';
  end if;
  if not is_office_base_url(v_origin) then
    raise exception 'rtw-check-sandbox-on.sql: % is not a Back Office origin (https://host, no path)', v_origin;
  end if;
  if length(v_secret) < 32 then
    raise exception 'rtw-check-sandbox-on.sql: RTW_JOB_SECRET must be at least 32 characters';
  end if;

  -- The vault: update in place when the secret already exists.
  if exists (select 1 from vault.secrets where name = 'office_base_url') then
    perform vault.update_secret((select id from vault.secrets where name = 'office_base_url'), v_origin);
  else
    perform vault.create_secret(v_origin, 'office_base_url');
  end if;
  if exists (select 1 from vault.secrets where name = 'rtw_job_secret') then
    perform vault.update_secret((select id from vault.secrets where name = 'rtw_job_secret'), v_secret);
  else
    perform vault.create_secret(v_secret, 'rtw_job_secret');
  end if;
end $$;

insert into settings (key, value)
values ('rtw_check', jsonb_build_object('enabled', true, 'primary', 'provider', 'fallback', null,
                                        'admin_confirms', true))
on conflict (key) do update
  set value = settings.value || jsonb_build_object('enabled', true, 'primary', 'provider',
                                                   'fallback', null, 'admin_confirms', true);

update job_schedules set enabled = true where job = 'rtw-check';
select install_job_schedules() as jobs_installed;

select rtw_check_config() as rtw_check,
       (select jobname from cron.job where jobname = 'rtw-check') as cron_job;

commit;
