-- =====================================================================
-- Migration 20260926110800 · every staff status change is an edge of
--                            staff_transitions (§2.12; CLAUDE.md
--                            "illegal transitions are rejected in the DB")
--
-- staff_status_guard() called assert_staff_transition() only when one
-- side of the change was an onboarding status. Every RPC on the stopped
-- states asserts for itself, but a plain row update — inactive →
-- compliant, removed → compliant, inactive → blocked — went through
-- unasserted, and §2.12 is explicit that "there is no 'reactivate' that
-- puts a leaver straight back to compliant" and that removed is
-- irreversible. The assertion now runs for every change; the evidence
-- checks stay inside the onboarding branch as before. Body otherwise
-- identical to 20260923110000.
--
-- The one fixture that relied on the gap (130_auto_assign, a worker
-- walked inactive → removed → compliant to be "put back") is rewritten
-- to reach compliant by a legal path.
-- =====================================================================

create or replace function public.staff_status_guard()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_onboarding constant staff_status[] := array[
    'interview_requested', 'interview_completed', 'documents', 'quiz',
    'additional_info', 'contract']::staff_status[];
  v_blockers text[];
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- §2.12: every change is an edge of the machine, stopped states included.
  perform assert_staff_transition(old.status, new.status);

  if old.status = any(v_onboarding) or new.status = any(v_onboarding) then
    if old.status = 'documents' and new.status = 'quiz' then
      v_blockers := onboarding_quiz_blockers(new.id);
      if cardinality(v_blockers) > 0 then
        raise exception 'quiz_locked: %', array_to_string(v_blockers, ', ')
          using errcode = 'P0001';
      end if;

    elsif old.status = 'quiz' and new.status = 'contract' then
      if not exists (select 1 from quiz_attempts q
                      where q.staff_id = new.id
                        and q.passed
                        and q.taken_at >= old.onboarding_started_at) then
        raise exception 'quiz_not_passed' using errcode = 'P0001';
      end if;

    elsif old.status = 'contract' and new.status = 'compliant' then
      if new.contract_signed_at is null then
        raise exception 'contract_not_signed' using errcode = 'P0001';
      end if;
      -- §2.7: generated at this exact moment. §2.12 step 2: one person
      -- keeps one Employee ID across every period, so an existing one is
      -- never replaced.
      new.employee_id := coalesce(new.employee_id, nextval('employee_id_seq'));
    end if;
  end if;

  new.stage_entered_at := now();

  if new.status = 'interview_requested' then
    -- A new onboarding period (§2.12, Reset to candidate): the previous
    -- rejection and interview belong to the previous period. They stay in
    -- audit_log; a fresh Willo interview is due.
    new.onboarding_started_at := now();
    new.rejected_at := null;
    new.rejected_from := null;
    new.rejection_cause := null;
    new.rejection_reason := null;
    new.rejected_by := null;
    new.willo_candidate_id := null;
    new.willo_invited_at := null;
    new.willo_answers_done := null;
    new.willo_answers_total := null;
    new.willo_completed_at := null;
    new.willo_decision := null;
    new.willo_decided_at := null;
    new.willo_decided_via := null;
  elsif new.status = 'rejected' then
    new.rejected_at := now();
    new.rejected_from := old.status;
    -- §2.9's rejection comes from the wizard, which has no reason to name
    -- itself; a rejection out of the quiz stage with no cause is that one.
    new.rejection_cause := coalesce(new.rejection_cause,
                                    case when old.status = 'quiz' then 'quiz_failed' end);
  end if;

  return new;
end $$;

-- The machine itself is reference data, not something an office session
-- edits: 20260921180312 gave the admin `admin_all` on staff_transitions,
-- which let a PostgREST session POST a new edge that this guard would
-- then honour. Read for everybody signed in (as before), written by
-- migrations only.
drop policy if exists admin_all on staff_transitions;
create policy admin_read on staff_transitions for select using (current_app_role() = 'admin');

comment on function public.staff_status_guard() is
  '§2.12 on the row. EVERY status change must be an edge of staff_transitions (a leaver or a removed worker cannot be put straight back to compliant), and documents→quiz, quiz→contract and contract→compliant must carry their evidence. Stamps stage_entered_at, the rejection column, and a new onboarding period on entry to interview_requested; issues the Employee ID at contract→compliant if the person has none.';
