-- =====================================================================
-- Migration 20261012120100 · two definer helpers the 12.10 security
--                            review found too generous
--
-- 1 · booking_payroll_exported(uuid) is the office's flag.
--
--     20261001200100 (5d) made it security definer so a scheduler, who
--     reads no payroll_export_lines, still sees RULE-06's "already in
--     payroll" warning. It kept the grant to `authenticated` and had no
--     caller check, so any signed-in account — a Client Portal contact, a
--     worker — could ask, for any booking id, whether that booking has
--     been exported to payroll: a fact about a worker's pay (§11.1 "no
--     money anywhere" for the client role).
--
--     Its real callers, all checked: resolve_violation (20260930100000),
--     get_back and office_mark_no_show (20260928110200) — each refuses
--     anybody but current_app_role() = 'admin' first — and 741_office_roles
--     (a scheduler, who is an admin). No Edge Function and no app calls it
--     over the API. So the gate is: an office login (any office role:
--     the scheduler case above is the reason the function is definer at
--     all), the service role, or a connection with no API JWT at all (jobs
--     and psql, where auth.uid() and the role claim are both absent).
--     Everybody else gets 42501 rather than an answer. It stays definer
--     and keeps its signature, so the three callers are unchanged.
--
-- 2 · current_app_role() ends a CLIENT token with its sign-in session.
--
--     20261001204000 made a Back Office token useless the moment its
--     auth.sessions row is gone (sign out everywhere, switch off, reset
--     two-step). A Client Portal token kept working until its exp — up to
--     an hour — after "sign out every other device", a password change or
--     an office switch-off had removed the session, and every client_*
--     view answers through this function (client_portal_visible). The
--     same session-exists check now applies to `client`.
--
--     Cost: one primary-key probe of auth.sessions, the probe an admin
--     token has paid since 20261001204000; client_portal_visible() already
--     joins profiles and auth.users per call. The worker (`staff`) role is
--     unchanged: the Staff App's offline check-in queue replays requests
--     on reconnect, and that behaviour is not part of this review.
--
--     A token with no session_id claim (jobs, tests, a service key) is
--     judged as before, exactly as for the admin.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · booking_payroll_exported: office, service role and jobs only
-- ---------------------------------------------------------------------
create or replace function public.booking_payroll_exported(p_booking uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_claim_role text := nullif(auth.jwt() ->> 'role', '');
begin
  if not (current_app_role() is not distinct from 'admin'
          or v_claim_role is not distinct from 'service_role'
          or (auth.uid() is null and v_claim_role is null)) then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  return exists (select 1 from payroll_export_lines
                  where booking_id = p_booking and state = 'exported');
end $$;

comment on function public.booking_payroll_exported(uuid) is
  'RULE-06 "already in payroll" for one booking. Definer so a scheduler (who reads no payroll_export_lines) still sees it; refuses (42501) anybody but an office login, the service role, or a connection with no API JWT (jobs). Called by resolve_violation, get_back and office_mark_no_show. 20261012120100.';

revoke all on function public.booking_payroll_exported(uuid) from public, anon;
grant execute on function public.booking_payroll_exported(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2 · current_app_role: a client token dies with its session too
--
-- 20261001204000's body; the only change is `p.role <> 'admin'` becoming
-- `p.role not in ('admin', 'client')` in the session clause.
-- ---------------------------------------------------------------------
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
     and (p.role not in ('admin', 'client')
          or nullif(auth.jwt() ->> 'session_id', '') is null
          or exists (select 1 from auth.sessions s
                      where s.id = (auth.jwt() ->> 'session_id')::uuid))
$$;

comment on function public.current_app_role() is
  'The caller''s app role for RLS and every admin RPC. NULL — no access — with no session; for a switched-off login; for a Back Office login with a verified two-step factor below aal2; and for a Back Office or Client Portal token whose sign-in session has been ended (sign out other devices, password change, switch off, reset two-step). A worker token is not held to the session rule. 20261012120100.';
