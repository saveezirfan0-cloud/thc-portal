-- =====================================================================
-- The manager's three buttons on a profile (§9.6, §2.12)
--
--   Block              human-triggered, always means something went
--                      wrong, and requires a reason
--   Unblock            runs the SAME full compliance check the automatic
--                      path runs, before the block is actually lifted
--   Reset to candidate the only route back for a worker who left, was
--                      blocked or was rejected — one person, one record,
--                      one Employee ID
--
-- All three were waiting on pieces that now exist: block_worker() and the
-- §4.3 cascade (20260921170411), compliance_blockers() for the re-check,
-- and the staff_transitions table (20260921180312) so a reset from an
-- impossible state is refused rather than applied.
--
-- §9.6 draws the line these functions have to hold: "A manual Block is
-- not the route for someone who has simply left — a worker who resigns
-- leaves through the app and lands in the Inactive state instead (§10.6),
-- which is a neutral record rather than one that reads as a problem when
-- the profile is reopened." Block and request_p45 therefore stay separate
-- functions with separate terminal states, however similar the cascade.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Block (§9.6).
--
-- The reason is not optional and not defaulted. §4.3 distinguishes the
-- two kinds by exactly this: "Auto-block (expired document) —
-- system-triggered, a temporary suspension, not a penalty. No reason
-- needed. Manual block (manager presses Block) — human-triggered, always
-- means something went wrong. Requires a reason." A manual block with an
-- empty reason is an auto-block wearing the wrong label, and the manager
-- who opens the profile later sees nothing to decide on.
-- ---------------------------------------------------------------------
create or replace function public.block_worker_manually(
  p_staff  uuid,
  p_reason text,
  p_now    timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  return block_worker(p_staff, 'manual', trim(p_reason), p_now);
end $$;

comment on function public.block_worker_manually(uuid, text, timestamptz) is
  '§9.6 Block. The §4.3 cascade with block_kind = manual and a mandatory reason, shown on the profile as "Blocked — <reason>".';

-- ---------------------------------------------------------------------
-- Unblock (§9.6).
--
-- §4.3: "since a manual block is not caused by documents, the manager
-- must press Unblock explicitly on the profile. Pressing it runs the same
-- full compliance check described above before the block is actually
-- lifted."
--
-- So this is not "set status = compliant". It returns the reasons when it
-- refuses, because a manager who presses Unblock and sees nothing happen
-- has been told nothing: the answer they need is WHICH document is still
-- expired or unverified. The worker's app stays locked to Documents in
-- that case, exactly as it does on the automatic path.
--
-- It lifts any kind, manual included — that is what distinguishes it from
-- unblock_if_compliant(), which deliberately refuses a manual block
-- because no automatic caller should ever undo a human decision.
-- ---------------------------------------------------------------------
create or replace function public.unblock_worker(
  p_staff uuid,
  p_on    date default current_date
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v staff;
  v_reasons text[];
begin
  select * into v from staff where id = p_staff for update;
  if v.id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if v.status <> 'blocked' then
    raise exception 'not_blocked' using errcode = 'P0001';
  end if;

  select array_agg(reason order by reason) into v_reasons
    from compliance_blockers(p_staff, p_on);

  if v_reasons is not null then
    return jsonb_build_object('unblocked', false, 'blockers', to_jsonb(v_reasons));
  end if;

  perform assert_staff_transition(v.status, 'compliant'::staff_status);
  update staff set status = 'compliant', block_kind = null, block_reason = null
   where id = p_staff;
  return jsonb_build_object('unblocked', true, 'blockers', '[]'::jsonb);
end $$;

comment on function public.unblock_worker(uuid, date) is
  '§9.6 Unblock. Runs the §4.3 full compliance check first and reports what is still outstanding when it refuses. Lifts any block_kind, manual included — unlike unblock_if_compliant(), which no automatic caller may use on a human decision.';

-- ---------------------------------------------------------------------
-- Reset to candidate (§9.6, §2.12).
--
-- "One person keeps one Employee ID across every period of employment, so
-- payroll and every historical timesheet continue to reconcile."
--
-- The five steps §2.12 numbers, and which of them is a write here:
--
--   1. status → interview_requested, re-entering the kanban       yes
--   2. the Employee ID is RETAINED                                by not touching it
--   3. compliance evidence marked superseded, retained read-only  yes
--   4. history retained and visible — shifts, show-rate, rating,
--      feedback, violations                                       by not touching it
--   5. bookings unaffected: a blocked or rejected worker holds
--      none                                                       nothing to do
--
-- Step 3 is the one worth being careful about. "Superseded documents are
-- retained, read-only, on the profile as the record of what was held
-- during the previous period — they are not deleted and they are never
-- used to satisfy the new compliance check." `review_status =
-- 'superseded'` is exactly that, and current_verified_docs() already
-- ignores it, so the new compliance check cannot see the old evidence
-- even though the office still can.
--
-- The term dates and graduation on the staff row go with them. A term
-- letter that is now superseded must not keep driving a cap (RULE-20),
-- and §4.5's "graduated" state is evidence-backed: the evidence has just
-- been superseded, so the state goes too.
-- ---------------------------------------------------------------------
create or replace function public.reset_to_candidate(
  p_staff  uuid,
  p_reason text,
  p_now    timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v staff;
  v_docs int := 0;
  v_decl int := 0;
  v_hmrc int := 0;
begin
  select * into v from staff where id = p_staff for update;
  if v.id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  -- "available on a blocked, rejected or inactive profile" (§9.6). The
  -- transition table says the same thing from the other side, and is the
  -- thing that actually refuses: a compliant worker cannot be reset, and
  -- a removed one cannot be brought back (§1.7).
  perform assert_staff_transition(v.status, 'interview_requested'::staff_status);

  -- 3 · compliance evidence superseded, and retained.
  with d as (
    update compliance_docs set review_status = 'superseded'
     where staff_id = p_staff and review_status <> 'superseded'
    returning 1
  ) select count(*)::int into v_docs from d;

  with c as (
    update criminal_declarations set superseded = true
     where staff_id = p_staff and not superseded
    returning 1
  ) select count(*)::int into v_decl from c;

  with h as (
    update hmrc_checklists set superseded = true
     where staff_id = p_staff and not superseded
    returning 1
  ) select count(*)::int into v_hmrc from h;

  -- The quiz result and the signed contract go the same way. quiz_attempts
  -- is history and stays; what is cleared is the pass that would otherwise
  -- satisfy §2.9 without a new attempt.
  update staff
     set status = 'interview_requested',
         block_kind = null,
         block_reason = null,
         -- 2 · the Employee ID is NOT in this list, deliberately.
         contract_signed_at = null,
         contract_version = null,
         quiz_attempts = 0,
         share_code = null,
         right_to_work_until = null,
         rtw_branch = null,
         term_dates = '{}',
         graduated_at = null,
         wtr_optout = false,
         -- A reset is a return, not a leaving: the leaver's stamps are
         -- cleared so the Inactive tab (§9.6) stops listing someone who
         -- is now a candidate again.
         left_at = null,
         leave_reason = null
   where id = p_staff;

  -- The reason the manager gave, kept where the next manager will look.
  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (p_now, auth.uid(), 'reset_to_candidate', 'staff', p_staff,
          jsonb_build_object('reason', trim(p_reason),
                             'fromStatus', v.status::text,
                             'employeeId', v.employee_id));

  return jsonb_build_object(
    'staffId', p_staff::text,
    'fromStatus', v.status::text,
    'employeeId', v.employee_id,
    'docsSuperseded', v_docs,
    'declarationsSuperseded', v_decl,
    'checklistsSuperseded', v_hmrc);
end $$;

comment on function public.reset_to_candidate(uuid, text, timestamptz) is
  '§9.6 / §2.12 Reset to candidate. Back to interview_requested with the Employee ID and all history retained, every piece of compliance evidence superseded but kept read-only, and the manager''s reason in audit_log.';

-- ---------------------------------------------------------------------
-- Same lockdown as every other definer function in public (docs/14 O7).
-- These are Back Office actions: an open reset_to_candidate would let
-- anyone holding the anon key wipe a compliant worker's evidence.
-- ---------------------------------------------------------------------
revoke execute on function public.block_worker_manually(uuid, text, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.unblock_worker(uuid, date)
  from public, anon, authenticated;
revoke execute on function public.reset_to_candidate(uuid, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.block_worker_manually(uuid, text, timestamptz) to service_role;
grant execute on function public.unblock_worker(uuid, date)                     to service_role;
grant execute on function public.reset_to_candidate(uuid, text, timestamptz)    to service_role;
