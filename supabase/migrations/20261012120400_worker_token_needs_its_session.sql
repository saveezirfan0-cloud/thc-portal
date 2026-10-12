-- =====================================================================
-- Migration 20261012120400 · a worker's token counts only while its
--                            sign-in session exists (§1.4, §10.1)
--
-- 20261001204000 made current_app_role() ask auth.sessions for the
-- token's session_id — for Back Office logins only. The Staff App's
-- doors do not go through current_app_role() at all: staff_caller() and
-- staff_writer() (and the RPCs that call them) resolve the worker from
-- auth.uid() alone. So a worker who pressed "Sign out other devices"
-- (Profile, or the reset flow, which both call signOut({scope:'others'})
-- and delete the other sessions) — the phone was lost or stolen — left
-- every access token already issued working for up to an hour: check in,
-- change bank details, request a P45. The same held for a banned login.
-- Security audit 12.10.2026, LOW.
--
-- Now:
--
--   · auth_session_live() — true when the token carries no session_id
--     (the service role, jobs, and test fixtures that set only `sub`,
--     exactly as 20261001204000 treats them) or when that session still
--     exists in auth.sessions. One primary-key probe.
--   · staff_caller() and staff_writer() resolve the caller's own worker
--     only when the session is live and the login is not banned
--     (banned_until in the future); otherwise the caller is nobody, and
--     every RPC built on them answers as it does for no worker
--     (unknown_staff / not_your_worker). Acting FOR a named worker as the
--     office (staff_caller) or the platform (staff_writer) is unchanged.
--   · current_app_role() holds a staff login to the same session rule as
--     an admin one, so the worker policies and helpers that read the role
--     agree. Client logins are still not held to it (756 pins that).
--
-- 790_worker_token_needs_its_session pins it.
-- =====================================================================

create or replace function public.auth_session_live()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select nullif(auth.jwt() ->> 'session_id', '') is null
      or exists (select 1 from auth.sessions s
                  where s.id = (auth.jwt() ->> 'session_id')::uuid)
$$;

comment on function public.auth_session_live() is
  '20261012120400: true when the request''s token has no session_id (service role, jobs, fixtures) or its sign-in session still exists in auth.sessions. Used by staff_caller(), staff_writer() and current_app_role().';

revoke execute on function public.auth_session_live() from public, anon, authenticated;

-- current_app_role(), 20261001204000's body as 20261012120000 left it
-- (plpgsql, so its plan is cached per session: the /onboarding timeout fix,
-- pinned by 786); the session rule now covers staff as well as admin.
create or replace function public.current_app_role() returns app_role
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return (
    select p.role
      from profiles p
      join auth.users u on u.id = p.id
     where p.id = auth.uid()
       and (u.banned_until is null or u.banned_until <= now())
       and (p.role <> 'admin'
            or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
            or not exists (select 1 from auth.mfa_factors f
                            where f.user_id = p.id and f.status::text = 'verified'))
       and (p.role not in ('admin', 'staff')
            or nullif(auth.jwt() ->> 'session_id', '') is null
            or exists (select 1 from auth.sessions s
                        where s.id = (auth.jwt() ->> 'session_id')::uuid))
  );
end $$;

comment on function public.current_app_role() is
  'The caller''s app role for RLS and every admin RPC. NULL — no access — with no session; for a switched-off login; for a Back Office login with a verified two-step factor below aal2; and for a Back Office or Staff App token whose sign-in session has been ended (reset two-step, switch off, sign out other devices). 20261001204000, plpgsql so the plan is cached per session (20261012120000), staff added 20261012120400.';

-- The definer convention for this one is deliberate and old (0001): the
-- policies of every role call it, anon included.
grant execute on function public.current_app_role() to anon, authenticated, service_role;

-- staff_caller(), 20260922140000's body; the caller's own worker needs a
-- live session and an unbanned login.
create or replace function public.staff_caller(p_staff uuid default null)
returns uuid
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare v_self uuid;
begin
  select s.id into v_self
    from staff s
   where s.user_id = auth.uid()
     and auth_session_live()
     and not exists (select 1 from auth.users u
                      where u.id = s.user_id and u.banned_until > now());
  if p_staff is null then return v_self; end if;
  if current_app_role() = 'admin' or p_staff = v_self then return p_staff; end if;
  raise exception 'not_your_worker' using errcode = '42501';
end $$;

-- staff_writer(), 20260927161100's body; the same rule for the self case.
create or replace function public.staff_writer(p_staff uuid default null)
returns uuid
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare v_self uuid;
begin
  select s.id into v_self
    from staff s
   where s.user_id = auth.uid()
     and auth_session_live()
     and not exists (select 1 from auth.users u
                      where u.id = s.user_id and u.banned_until > now());
  if p_staff is null or p_staff = v_self then
    return v_self;
  end if;
  -- Only the platform itself may act for a named worker: a job or an Edge
  -- Function (the service role), or a direct database connection with no
  -- PostgREST role at all (a migration, a fixture, an operator at psql).
  -- An admin session may look (staff_caller) but not act.
  if coalesce(auth.role(), '') = 'service_role' or auth.role() is null then
    return p_staff;
  end if;
  raise exception 'not_your_worker' using errcode = '42501';
end $$;
