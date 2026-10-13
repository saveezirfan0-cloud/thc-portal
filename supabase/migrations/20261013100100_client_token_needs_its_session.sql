-- =====================================================================
-- Migration 20261013100100 · a client's token counts only while its
--                            sign-in session exists (§1.4, §11.1;
--                            ADR-0120)
--
-- 20261001204000 made current_app_role() ask auth.sessions for the
-- token's session_id for a Back Office login; 20261012120400 (security
-- audit 12.10) extended it to the Staff App's logins and said, on
-- purpose, that client logins were "still not held to it". The Client
-- Portal's review of the same day asks for exactly that: a Client Portal
-- token kept working until its exp — up to an hour — after "sign out
-- every other device" (the Change password action sends it), a password
-- reset (which signs the other devices out) or an office switch-off had
-- removed the session. Every client_* view answers through this function
-- (client_portal_visible), so a stolen client cookie kept reading the
-- customer's line-ups for that hour.
--
-- The body is 20261012120400's verbatim (plpgsql, so its plan is cached
-- per session — 20261012120000, pinned by 786), with one change: the
-- session clause, which named ('admin', 'staff'), now applies to every
-- role — the three app_role values are admin, client and staff. A token
-- with no session_id claim (the service role, jobs, fixtures that set
-- only `sub`) is judged as before, exactly as for the other two roles.
--
-- Cost: the one primary-key probe of auth.sessions an admin or staff
-- token already pays; client_portal_visible() already joins profiles and
-- auth.users per call.
--
-- Grants: 20261012121500 made current_app_role()'s anon / authenticated /
-- service_role EXECUTE explicit; `create or replace` keeps them and they
-- are restated below for the same reason that migration gives.
-- 756 (round 2) is updated with it and 807_client_token_needs_its_session
-- pins it.
-- =====================================================================

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
       -- 20261013100100: every role (admin since 20261001204000, staff since
       -- 20261012120400, client since this file).
       and (nullif(auth.jwt() ->> 'session_id', '') is null
            or exists (select 1 from auth.sessions s
                        where s.id = (auth.jwt() ->> 'session_id')::uuid))
  );
end $$;

comment on function public.current_app_role() is
  'The caller''s app role for RLS and every admin RPC. NULL — no access — with no session; for a switched-off login; for a Back Office login with a verified two-step factor below aal2; and for any token (Back Office, Staff App or Client Portal) whose sign-in session has been ended (reset two-step, switch off, sign out other devices, a password reset). 20261001204000, plpgsql so the plan is cached per session (20261012120000), staff added 20261012120400, client added 20261013100100.';

-- The definer convention for this one is deliberate and old (0001): the
-- policies of every role call it, anon included.
grant execute on function public.current_app_role() to anon, authenticated, service_role;
