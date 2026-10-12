-- =====================================================================
-- Migration 20261012120100 · staff.payroll_id and staff.status move only
--                            through their audited RPCs (ADR-0076,
--                            ADR-0056, §2.12)
--
-- `staff` carries admin_all (0001) and no column-level narrowing, so any
-- Back Office login — a scheduler included — could PATCH a worker's row
-- through PostgREST and skip the checks the RPCs exist for. Security
-- audit 12.10.2026 found two (HIGH):
--
--   1 · payroll_id. set_staff_payroll_id() (20261008140000) asks
--       assert_finance_caller() — owner or manager, never a scheduler —
--       checks the shape and uniqueness, and writes
--       `staff.payroll_id_set` to audit_log. A direct
--       `PATCH /rest/v1/staff?id=eq.<id> {"payroll_id": "…"}` did none of
--       that: a scheduler could re-key any worker's pay, unaudited.
--
--   2 · status. interview_requested → interview_completed is
--       onboarding_mark_interview_complete() (owner/manager + a reason,
--       20261002105000) or the Willo receiver (service role). A direct
--       PATCH of status passed staff_status_guard — the edge is legal —
--       with no reason, no role check and no audit.
--
-- The scan of every other §2.12 edge (staff_transitions) found the SAME
-- gap on all of them, because each has its own door and none of those
-- doors is a direct UPDATE:
--
--     interview_completed → documents      onboarding_accept[_with_account]
--     * → rejected                          onboarding_reject / the wizard / quiz
--     documents → quiz                      onboarding_advance_if_ready
--     quiz → contract                       submit_quiz_attempt
--     contract → compliant                  sign_contract (Employee ID issued)
--     compliant → blocked                   block_worker (service role, audited)
--     blocked → compliant                   unblock_worker / unblock_if_compliant
--                                           (which re-check compliance_blockers —
--                                           a direct PATCH unblocked a worker
--                                           with an expired passport)
--     rejected|blocked|inactive → interview_requested   reset_to_candidate
--     * → inactive, * → removed            request_p45 path / remove_worker
--
-- Every writer of staff.status is a SECURITY DEFINER function
-- (pg_proc scan: block_worker, criminal_declaration_reviewed,
-- onboarding_advance_if_ready, onboarding_mark_interview_complete,
-- reset_to_candidate, sign_contract, submit_quiz_attempt,
-- unblock_if_compliant, unblock_worker, willo_link_candidate,
-- willo_record_event; and the invoker onboarding_do_accept/_do_reject,
-- reached only from definers), and no app writes `staff` directly (grep
-- apps/ packages/: reads only). So the rule is the simplest one that
-- closes every edge at once: an API session (current_user anon or
-- authenticated) may not change staff.status or staff.payroll_id at all,
-- nor insert a staff row already past interview_requested or already
-- carrying a Payroll ID. Inside a definer RPC current_user is the
-- function's owner, so every door above keeps working; the service role
-- and migrations are untouched.
--
-- Both guards are invoker trigger functions on purpose (the
-- staff_dob_guard pattern, 20261001210000): a SECURITY DEFINER trigger
-- would see its owner as current_user and refuse nothing.
-- staff_status_rpc_only is named to fire AFTER staff_status_guard (same
-- timing, alphabetical order), so an illegal edge still answers
-- illegal_staff_transition (P0001) as every existing test expects, and
-- only a legal edge taken by the wrong door meets 42501.
--
-- 787_staff_columns_only_through_rpcs pins both.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · payroll_id
-- ---------------------------------------------------------------------
create or replace function public.staff_payroll_id_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if current_user in ('anon', 'authenticated')
     and ((tg_op = 'INSERT' and new.payroll_id is not null)
       or (tg_op = 'UPDATE' and new.payroll_id is distinct from old.payroll_id)) then
    raise exception 'payroll_id_rpc_only' using errcode = '42501',
      hint = 'ADR-0076: a Payroll ID is set with set_staff_payroll_id() (owner or manager, audited).';
  end if;
  return new;
end $$;

comment on function public.staff_payroll_id_guard() is
  '20261012120100: refuses a change to staff.payroll_id (or an insert carrying one) from any API session (anon, authenticated); set_staff_payroll_id() and the invite-roster paths (definers) write it. A trigger function: not an RPC.';

revoke execute on function public.staff_payroll_id_guard() from public, anon, authenticated;

drop trigger if exists staff_payroll_id_guard on staff;
create trigger staff_payroll_id_guard
  before insert or update of payroll_id on staff
  for each row execute function public.staff_payroll_id_guard();

-- ---------------------------------------------------------------------
-- 2 · status
-- ---------------------------------------------------------------------
create or replace function public.staff_status_rpc_only()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' and new.status is distinct from 'interview_requested' then
      raise exception 'staff_status_rpc_only' using errcode = '42501',
        hint = '§2.12: a new person starts at interview_requested; every later stage is reached through its own RPC.';
    end if;
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      raise exception 'staff_status_rpc_only' using errcode = '42501',
        hint = '§2.12: every stage change has its own audited RPC (onboarding_mark_interview_complete, onboarding_accept, block/unblock, reset_to_candidate, …).';
    end if;
  end if;
  return new;
end $$;

comment on function public.staff_status_rpc_only() is
  '20261012120100: refuses any change to staff.status (and an insert past interview_requested) from an API session (anon, authenticated) with 42501 staff_status_rpc_only. Fires after staff_status_guard, so an illegal edge still raises illegal_staff_transition first. The definer RPCs and the service role are the only writers. A trigger function: not an RPC.';

revoke execute on function public.staff_status_rpc_only() from public, anon, authenticated;

drop trigger if exists staff_status_rpc_only on staff;
create trigger staff_status_rpc_only
  before insert or update of status on staff
  for each row execute function public.staff_status_rpc_only();
