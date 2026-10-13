-- =====================================================================
-- Migration 20261012120300 · booking_payroll_exported() answers the
--                            office only (RULE-06, ADR-0056)
--
-- 20261001200100 (5d) made booking_payroll_exported(uuid) SECURITY
-- DEFINER so a scheduler resolving a violation still sees RULE-06's
-- "already in payroll" flag. It kept EXECUTE for every signed-in role and
-- asked nothing of the caller, so a Client Portal login could ask, booking
-- by booking, whether its line-up had been exported to payroll — a fact
-- about the workers' pay the client is never shown (ADR-0004). Security
-- audit 12.10.2026, NOTE.
--
-- EXECUTE cannot simply be revoked from authenticated: its two callers,
-- resolve_violation() and office_mark_no_show(), are INVOKER functions
-- the office runs as `authenticated`. So the function now refuses any
-- caller with a login that is not a Back Office one (42501 admins_only).
-- A call with no login — the service role, a job, a migration — answers
-- as before. anon and PUBLIC lose EXECUTE outright.
--
-- 789_booking_payroll_exported_office_only pins it.
-- =====================================================================

create or replace function public.booking_payroll_exported(p_booking uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is not null and current_app_role() is distinct from 'admin' then
    raise exception 'admins_only' using errcode = '42501';
  end if;
  return exists (select 1 from payroll_export_lines
                  where booking_id = p_booking and state = 'exported');
end $$;

comment on function public.booking_payroll_exported(uuid) is
  'RULE-06: true when the booking is on an exported payroll line. Reads as its owner (20261001200100, so a scheduler sees it); since 20261012120300 a caller with a login must be a Back Office one (42501 admins_only). Called by resolve_violation() and office_mark_no_show().';

revoke execute on function public.booking_payroll_exported(uuid) from public, anon;
grant  execute on function public.booking_payroll_exported(uuid) to authenticated, service_role;
