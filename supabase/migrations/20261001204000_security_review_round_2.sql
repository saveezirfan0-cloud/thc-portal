-- =====================================================================
-- Security review of the second round (ADR-0060, ADR-0057)
--
-- 1 · auto_assign_first_round() let a read-only viewer start auto-assign
--     rounds: it passes the admin check, and the round it posts runs in
--     the auto-staffing Edge Function with no user session, where the
--     viewer write-guard (office_read_only_guard) cannot see it. Each call
--     sent another additive round of invitations and notifications. It now
--     asks assert_not_read_only() first. The body is 20260928110200's,
--     unchanged otherwise (docs/10 §3b; nothing redefined it since).
--
-- 2 · A Back Office login's token now counts only while its sign-in
--     session exists. admin_reset_two_step (and switch off, and "sign out
--     other devices") delete the sessions, but a token already issued
--     carried on for up to an hour — and once the factors were gone it
--     no longer needed aal2 — so whoever held a lost phone kept the Back
--     Office until expiry. current_app_role() now also asks auth.sessions
--     for the token's session_id. Every token GoTrue issues to a user
--     carries session_id; one without it is not a user sign-in and keeps
--     the previous behaviour (so do jobs and tests that set only `sub`).
--     Client and staff logins are unchanged.
-- =====================================================================

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
                                    'Authorization', 'Bearer ' || v_key));
  exception when others then
    raise warning 'auto_assign_first_round: %', sqlerrm;
    return jsonb_build_object('queued', false, 'reason', sqlerrm, 'due', v_due);
  end;

  return jsonb_build_object('queued', true, 'due', v_due);
end $$;

revoke execute on function public.auto_assign_first_round(uuid) from public, anon;
grant  execute on function public.auto_assign_first_round(uuid) to authenticated, service_role;

create or replace function public.current_app_role() returns app_role
language sql
stable
security definer
set search_path = public
as $$
  select p.role
    from profiles p
    join auth.users u on u.id = p.id
   where p.id = auth.uid()
     and (u.banned_until is null or u.banned_until <= now())
     and (p.role <> 'admin'
          or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
          or not exists (select 1 from auth.mfa_factors f
                          where f.user_id = p.id and f.status::text = 'verified'))
     and (p.role <> 'admin'
          or nullif(auth.jwt() ->> 'session_id', '') is null
          or exists (select 1 from auth.sessions s
                      where s.id = (auth.jwt() ->> 'session_id')::uuid))
$$;

comment on function public.current_app_role() is
  'The caller''s app role for RLS and every admin RPC. NULL — no access — with no session; for a switched-off login; for a Back Office login with a verified two-step factor below aal2; and for a Back Office token whose sign-in session has been ended (reset two-step, switch off, sign out other devices). 20261001204000.';
