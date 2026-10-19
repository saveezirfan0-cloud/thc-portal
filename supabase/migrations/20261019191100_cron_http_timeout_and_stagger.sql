-- =====================================================================
-- pg_cron → pg_net: a 30 s timeout, and fewer jobs on the same second
-- (ADR-0154)
--
-- Measured on the live project, 17.10.2026: 161 of 1,795 cron HTTP calls
-- in six hours (9%) were recorded as pg_net's default 5 s timeout, most of
-- them with "DNS time: 6000+ ms" and no request sent. At :00 and :05 up to
-- eleven net.http_post calls fire in the same second (four per-minute jobs,
-- four every-5-minute jobs, escalation, and the two every-15-minute Back
-- Office jobs). The responses are never read — every job records its own
-- outcome in job_runs — so a longer wait costs nothing and stops false
-- timeouts from hiding real 401s and 404s in net._http_response.
--
-- 1 · install_job_schedules(), restated from its LATEST body
--     (20260928100100 — every later migration only changes job_schedules
--     rows) with two changes:
--       · every command passes timeout_milliseconds := 30000;
--       · it ends by calling install_housekeeping_schedules()
--         (20261019191000), so the reinstall after a Postgres upgrade —
--         which drops and recreates pg_cron — brings back the SQL
--         housekeeping jobs too. Its return value still counts the
--         job_schedules rows only, as docs/16 §4.7 says.
--     Everything else — the edge_base_url() / office_base_url() readers,
--     the vault lookups at run time, the skip-with-notice — is unchanged.
--
-- 2 · Two jobs move off the :00/:05 grid. Only jobs whose minute no rule
--     fixes:
--       gdpr-purge                '*/5 * * * *'  → '3-59/5 * * * *'
--       auto-staffing-escalation  '*/10 * * * *' → '4-59/10 * * * *'
--                                  (still every 10 minutes, §7)
--     NOT moved, on purpose:
--       auto-staffing-cutoff  */5  — §3.5's 12:05 UK cutoff. is_uk_time's
--                                    window would accept 12:06, but the
--                                    release would then run a minute after
--                                    the time the scope names.
--       compliance-daily      */5  — §7's 05:00 UK sweep.
--       finance-reports       */5  — §9.9's Monday 09:00 UK send.
--       event-documents,
--       new-starter-report    */15 — ADR-0074's and ADR-0091's UK times.
--       the per-minute jobs        — pg_cron cannot offset within a minute.
--       auto-staffing-hourly :17, onboarding-chasers :07 — already off-grid.
--     UTC as ever; the offsets are minute-of-hour, so DST does not touch
--     them.
--
-- Takes effect on the next `select public.install_job_schedules();`
-- (docs/16 §4.7), as every job_schedules change does — this migration
-- does not call it, because it needs the Vault and edge_base_url.
-- =====================================================================

update job_schedules set cron_expression = '3-59/5 * * * *'
 where job = 'gdpr-purge' and cron_expression = '*/5 * * * *';

update job_schedules set cron_expression = '4-59/10 * * * *'
 where job = 'auto-staffing-escalation' and cron_expression = '*/10 * * * *';

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

    if r.base_url_source = 'edge_base_url' then
      v_reader := 'public.edge_base_url()';
    elsif r.base_url_source = 'office_base_url' then
      -- The office's two vault secrets. Missing either, the row is skipped
      -- (the rest still install); a malformed base raises in the reader.
      if office_base_url() is null
         or not exists (select 1 from vault.decrypted_secrets
                         where name = r.secret_name and coalesce(decrypted_secret, '') <> '') then
        raise notice 'job % skipped: vault secrets office_base_url and % are both needed', r.job, r.secret_name;
        continue;
      end if;
      v_reader := 'public.office_base_url()';
    else
      raise exception 'job % names base %, which has no guarded reader', r.job, r.base_url_source
        using errcode = '22023';
    end if;

    -- The base and the secret are read when the command RUNS, so nothing
    -- sensitive is stored in the pg_cron command string — and the base is
    -- re-checked on every firing. pg_net waits up to 30 s for the reply
    -- (its default is 5 s, which DNS alone exceeded; ADR-0154); nothing
    -- reads the reply, the job records its outcome in job_runs.
    v_command := format(
      $cmd$select net.http_post(
              url := %s || %s,
              headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = %L)
              ),
              body := jsonb_build_object('job', %L),
              timeout_milliseconds := 30000
            );$cmd$, v_reader, quote_literal('/' || r.edge_path), r.secret_name, r.job);

    perform cron.schedule(r.job, r.cron_expression, v_command);
    n := n + 1;
  end loop;

  -- The SQL housekeeping jobs (20261019191000) are not registry rows, but a
  -- reinstall after pg_cron is recreated must bring them back as well. Not
  -- counted: the return value is the registry's, as docs/16 §4.7 reads it.
  perform install_housekeeping_schedules();

  return n;
end;
$$;

comment on function public.install_job_schedules() is
  'Applies job_schedules to pg_cron, each POST with a 30 s pg_net timeout (ADR-0154), then reinstalls the SQL housekeeping jobs (install_housekeeping_schedules). Run once per deploy; needs settings.edge_base_url (a Supabase Functions base — edge_base_url() refuses anything else) and vault secret service_role_key, and for an office_base_url row (rtw-check) the vault secrets office_base_url (office_base_url() refuses anything but a Back Office origin) and rtw_job_secret — without them that row is skipped with a notice. Returns the number of job_schedules rows scheduled.';

revoke execute on function public.install_job_schedules() from public, anon, authenticated;
grant  execute on function public.install_job_schedules() to service_role;
