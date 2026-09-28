-- =====================================================================
-- The job secret (x-job-secret): how pg_cron proves itself to the Edge
-- Functions from now on
--
-- Every job function (_shared/job.ts) let a call in only when its bearer
-- equalled, byte for byte, the SUPABASE_SERVICE_ROLE_KEY the Functions
-- runtime injects. On the live project that never held: the jobs were
-- installed on 28.09 with the legacy service_role JWT in the vault (the
-- gateway's verify_jwt accepted it, so it is genuine), and every call
-- still came back 401 "service role required" — the value the runtime
-- injects is not that JWT. job_runs had no row at all.
--
-- The functions no longer depend on what the platform injects. A secret
-- of our own, JOB_SECRET (Edge Function secret) and job_secret (vault,
-- the same value), travels in an x-job-secret header; job.ts accepts it,
-- or, as before, a bearer equal to the injected key (local development
-- and tests, where the two do match). The Authorization bearer stays
-- (service_role_key) because verify_jwt on the job functions needs a
-- valid JWT at the gateway.
--
-- Three callers post to the Edge Functions, all restated from their
-- LATEST bodies with that one header added and nothing else changed:
--   install_job_schedules()   20260928100100 — edge rows only; the
--                             rtw-check row (a Back Office route) never
--                             receives the job secret
--   willo_invite_nudge()      20260927160300
--   auto_assign_first_round() 20261001204000
-- Read at the moment of the call, like the bearer, so the secret is never
-- stored in a cron command string. Without the vault secret the header is
-- empty and job.ts falls back to the bearer check.
--
-- Where the schedules are already installed (the live project, since
-- 28.09) this migration re-applies them at the end, so the cron commands
-- carry the header without anyone re-running install_job_schedules().
-- Where they are not (a fresh database, CI, pgTAP) nothing is scheduled.
-- =====================================================================

create or replace function public.install_job_schedules() returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare
  r         record;
  n         integer := 0;
  v_command text;
  v_base    text;
  v_reader  text;
  v_extra   text;
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
      -- The job secret goes to an Edge Function and nowhere else.
      v_extra := E',\n                ''x-job-secret'', coalesce((select decrypted_secret from vault.decrypted_secrets where name = ''job_secret''), '''')';
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
      v_extra := '';
    else
      raise exception 'job % names base %, which has no guarded reader', r.job, r.base_url_source
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
                'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = %L)%s
              ),
              body := jsonb_build_object('job', %L)
            );$cmd$, v_reader, quote_literal('/' || r.edge_path), r.secret_name, v_extra, r.job);

    perform cron.schedule(r.job, r.cron_expression, v_command);
    n := n + 1;
  end loop;
  return n;
end;
$$;

comment on function public.install_job_schedules() is
  'Applies job_schedules to pg_cron. Run once per deploy; needs settings.edge_base_url (a Supabase Functions base — edge_base_url() refuses anything else) and vault secrets service_role_key and job_secret (sent as x-job-secret to Edge Functions only, 20261001205000), and for an office_base_url row (rtw-check) the vault secrets office_base_url (office_base_url() refuses anything but a Back Office origin) and rtw_job_secret — without them that row is skipped with a notice.';

revoke execute on function public.install_job_schedules() from public, anon, authenticated;
grant  execute on function public.install_job_schedules() to service_role;

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
                                    'Authorization', 'Bearer ' || v_key,
                                    'x-job-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'job_secret'), '')));
  exception when others then
    raise warning 'willo_invite_nudge: %', sqlerrm;
  end;
  return null;
end $$;

revoke execute on function public.willo_invite_nudge() from public, anon, authenticated;

create or replace function public.auto_assign_first_round(p_event uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  ev        events;
  v_due     int;
  v_base    text;
  v_key     text;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'admins_only' using errcode = '42501';
  end if;
  -- ADR-0060: a viewer passes the admin check but may change nothing, and
  -- this posts a round to the Edge Function, which then invites workers
  -- with no user session — out of reach of the write-guard trigger.
  perform assert_not_read_only();

  select * into ev from events where id = p_event;
  if ev.id is null then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;
  if ev.cancelled_at is not null then
    return jsonb_build_object('queued', false, 'reason', 'event_cancelled');
  end if;

  -- The same selection the :17 round makes — both switches on, not
  -- started, confirmed below headcount + buffer — narrowed to this event.
  -- Nothing due means nothing to post: auto-assign off, or every section
  -- already under way (escalation's job, §3.4).
  select count(*)::int into v_due
    from auto_assign_due_shifts('hourly') d
   where d.event_id = p_event;
  if v_due = 0 then
    return jsonb_build_object('queued', false, 'reason', 'nothing_due');
  end if;

  -- Exactly what install_job_schedules() puts in the cron command: the
  -- guarded base URL and the service-role bearer from Vault, read at the
  -- moment of the call. Inside an exception block for the same reason as
  -- willo_invite_nudge(): a refused or missing base must never fail the
  -- event save that fired it — the hourly cron catches up at :17.
  begin
    v_base := edge_base_url();
    if coalesce(v_base, '') = '' then
      return jsonb_build_object('queued', false, 'reason', 'edge_base_url_not_set', 'due', v_due);
    end if;
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
    if coalesce(v_key, '') = '' then
      return jsonb_build_object('queued', false, 'reason', 'service_role_key_not_set', 'due', v_due);
    end if;
    perform net.http_post(
      url     := v_base || '/auto-staffing?mode=hourly&event=' || p_event::text,
      body    := jsonb_build_object('job', 'auto-staffing-first-round', 'eventId', p_event::text),
      params  := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || v_key,
                                    'x-job-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'job_secret'), '')));
  exception when others then
    raise warning 'auto_assign_first_round: %', sqlerrm;
    return jsonb_build_object('queued', false, 'reason', sqlerrm, 'due', v_due);
  end;

  return jsonb_build_object('queued', true, 'due', v_due);
end $$;

revoke execute on function public.auto_assign_first_round(uuid) from public, anon;
grant  execute on function public.auto_assign_first_round(uuid) to authenticated, service_role;

-- Already installed: re-apply, so the commands carry the header now.
do $$
begin
  if exists (select 1 from cron.job j join job_schedules s on s.job = j.jobname) then
    perform install_job_schedules();
  end if;
end $$;
