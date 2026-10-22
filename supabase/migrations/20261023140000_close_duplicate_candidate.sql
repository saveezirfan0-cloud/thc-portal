-- =====================================================================
-- Migration 20261023140000 · Close a duplicate candidate quietly
--                            (ADR-0191; owner request, 22.10.2026)
--
-- A person who applied twice (a mistyped address the first time; a second
-- application with another birth year) leaves two onboarding records. The
-- stale one keeps getting the daily interview email, holds the Payroll ID
-- from the invite list, and shares the live record's name, which stops
-- issue_employee_id() matching a payroll code. The office's Reject is the
-- wrong tool: it emails the candidate (E2/E2b), and for a shared address
-- that lands on the person who is progressing.
--
--   close_duplicate_candidate(stale, keep, actor) — service role only; no
--   signed-in RPC, so the pinned authenticated surface (892) is unchanged.
--   Refuses unless it is the same person (names compatible, and the same
--   email or the same date of birth), the stale record has no bookings and
--   no documents and has not signed a contract, and both are live. Then:
--     · the Payroll ID and the Employee ID move to the kept record, where
--       it has none (never replacing one it has);
--     · the stale record is rejected (cause 'manager', an internal reason)
--       WITHOUT the rejection email, so the chasers stop;
--     · its unsent outbox rows are dropped;
--     · audit_log staff.duplicate_closed says what moved.
--   Idempotent: a stale record already rejected returns alreadyClosed.
--   Nothing is anonymised and nothing is deleted; Reset to candidate would
--   reopen the stale record.
--
-- One-off: the two pairs found on 22.10.2026, each guarded so a database
-- without those rows (a fresh `db reset`) does nothing.
--   Sai Jillapelli   74fc8757 (mistyped first application) -> 17bb51c4
--   Bivek Oli        c77d4e46 (first application, birth year 2005)
--                                                          -> ff42c437
--     (the kept record's date of birth, 2004-09-06, is the one on his
--      verified passport; it is not touched).
-- pgTAP: supabase/tests/925_close_duplicate_candidate.sql.
-- =====================================================================

create or replace function public.close_duplicate_candidate(
  p_stale uuid,
  p_keep  uuid,
  p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  st          staff;
  kp          staff;
  v_pay       text;
  v_emp       integer;
  v_pay_moved boolean := false;
  v_emp_moved boolean := false;
  v_dropped   integer;
begin
  if p_stale is null or p_keep is null or p_stale = p_keep then
    raise exception 'same_record' using errcode = 'P0001';
  end if;

  -- Both rows, always in id order, so two callers cannot deadlock.
  perform 1 from staff where id in (p_stale, p_keep) order by id for update;
  select * into st from staff where id = p_stale;
  select * into kp from staff where id = p_keep;
  if st.id is null or kp.id is null or st.removed_at is not null or kp.removed_at is not null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;

  if st.status::text = 'rejected' then
    return jsonb_build_object('staffId', p_stale::text, 'alreadyClosed', true);
  end if;
  if st.status::text not in ('interview_requested', 'interview_completed', 'documents', 'quiz') then
    raise exception 'not_a_candidate: %', st.status using errcode = 'P0001';
  end if;
  if kp.status::text in ('rejected', 'removed') then
    raise exception 'keep_not_live: %', kp.status using errcode = 'P0001';
  end if;

  if not payroll_names_compatible(st.first_name, st.last_name, kp.first_name, kp.last_name)
     or not (lower(btrim(st.email)) = lower(btrim(kp.email)) or st.dob = kp.dob) then
    raise exception 'not_the_same_person' using errcode = 'P0001';
  end if;

  if st.contract_signed_at is not null
     or exists (select 1 from bookings b where b.staff_id = p_stale)
     or exists (select 1 from compliance_docs d where d.staff_id = p_stale) then
    raise exception 'stale_has_history' using errcode = 'P0001';
  end if;

  v_pay := st.payroll_id;
  v_emp := st.employee_id;
  if v_pay is not null and kp.payroll_id is null then
    update staff set payroll_id = null where id = p_stale;
    update staff set payroll_id = v_pay where id = p_keep;
    v_pay_moved := true;
  end if;
  if v_emp is not null and kp.employee_id is null then
    update staff set employee_id = null where id = p_stale;
    update staff set employee_id = v_emp where id = p_keep;
    v_emp_moved := true;
  end if;

  -- onboarding_do_reject() would queue E2/E2b; this is not a rejection of
  -- the person, so it only closes the record.
  update staff
     set status           = 'rejected',
         rejection_cause  = 'manager',
         rejection_reason = 'Duplicate record: the same person is onboarding under another record. No email was sent.',
         rejected_by      = p_actor
   where id = p_stale;

  delete from notification_outbox o
   where o.recipient_staff_id = p_stale
     and o.sent_at is null
     and o.failed_at is null;
  get diagnostics v_dropped = row_count;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (p_actor, 'staff.duplicate_closed', 'staff', p_stale,
          jsonb_build_object('staffId', p_stale::text,
                             'keptStaffId', p_keep::text,
                             'fromStatus', st.status::text,
                             'payrollIdMoved', v_pay_moved,
                             'payrollId', case when v_pay_moved then v_pay end,
                             'employeeIdMoved', v_emp_moved,
                             'employeeId', case when v_emp_moved then v_emp end,
                             'unsentEmailsDropped', v_dropped));

  return jsonb_build_object('staffId', p_stale::text,
                            'keptStaffId', p_keep::text,
                            'payrollIdMoved', v_pay_moved,
                            'employeeIdMoved', v_emp_moved,
                            'unsentEmailsDropped', v_dropped);
end $$;

comment on function public.close_duplicate_candidate(uuid, uuid, uuid) is
  '20261023140000 (ADR-0191): closes a stale duplicate onboarding record without emailing anyone: moves its Payroll ID and Employee ID to the kept record, rejects it quietly, drops its unsent emails, audits. Same person only (names compatible and the same email or date of birth); refused when the stale record has bookings, documents or a signed contract. Service role only.';

revoke all on function public.close_duplicate_candidate(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.close_duplicate_candidate(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------
-- One-off: the two pairs found on 22.10.2026
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('74fc8757-38e2-426d-ba1e-a7477e5240ce'::uuid, '17bb51c4-8f5d-4480-9d27-ad4155bc7958'::uuid),
      ('c77d4e46-0972-4803-a243-ca0bf843d63f'::uuid, 'ff42c437-8967-4af5-8371-eda68be155cf'::uuid)
    ) as v(stale, keep)
  loop
    if exists (select 1 from staff where id = r.stale and removed_at is null)
       and exists (select 1 from staff where id = r.keep and removed_at is null) then
      perform public.close_duplicate_candidate(r.stale, r.keep, null);
    end if;
  end loop;
end $$;
