-- =====================================================================
-- Migration 20261023150000 · Close a duplicate candidate quietly
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
--   Refuses unless it is the same person (a name on both sides, names
--   compatible, and the same email or the same date of birth), the stale
--   record has no bookings, no documents, no login and no signed contract,
--   and both are live. Then:
--     · the Payroll ID and the Employee ID move to the kept record, where
--       it has none (never replacing one it has);
--     · SpudBros Express marking (never the THC-shifts switch) follows, so
--       a SpudBros person is not left open to THC shifts (ADR-0126);
--     · the stale record is rejected (cause 'manager', an internal reason)
--       WITHOUT the rejection email, so the chasers stop. One the office
--       already rejected by hand is left as it is, and its IDs still move;
--     · its unsent outbox rows (by recipient or by the staff id in the
--       key, and not one the drain has just claimed) are tombstoned, as
--       elsewhere, not deleted;
--     · audit_log: staff.duplicate_closed on the stale record and
--       staff.duplicate_merged_in on the kept one.
--   Idempotent: a second run with nothing left to move changes nothing.
--   Nothing is anonymised and nothing is deleted; Reset to candidate would
--   reopen the stale record.
--
-- One-off: the two pairs found on 22.10.2026, each guarded so a database
-- without those rows (a fresh `db reset`) does nothing, and a pair that has
-- moved on since (the stale record uploaded a document, the kept one was
-- rejected) is skipped, audited and warned about rather than stopping the
-- deploy.
--   Pair 1: a mistyped first application, then a second with the right
--           address; the second one progressed.
--   Pair 2: the same address twice with two birth years; the kept record's
--           is the one on its verified passport, and is not touched.
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
  st            staff;
  kp            staff;
  v_pay         text;
  v_emp         integer;
  v_pay_moved   boolean := false;
  v_emp_moved   boolean := false;
  v_group       boolean := false;
  v_group_held  boolean := false;
  v_already     boolean;
  v_dropped     integer;
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

  -- Already rejected (by this function, or by the office's Reject): there is
  -- nothing to reject again, but its IDs may still be waiting to move.
  v_already := st.status::text = 'rejected';
  if not v_already
     and st.status::text not in ('interview_requested', 'interview_completed', 'documents', 'quiz') then
    raise exception 'not_a_candidate: %', st.status using errcode = 'P0001';
  end if;
  if kp.status::text in ('rejected', 'removed') then
    raise exception 'keep_not_live: %', kp.status using errcode = 'P0001';
  end if;

  -- payroll_names_compatible() is true when a name is blank, and a NULL in
  -- the email/date test would read as "not false": both are made definite.
  if payroll_name_key(st.first_name, st.last_name) is null
     or payroll_name_key(kp.first_name, kp.last_name) is null
     or not coalesce(payroll_names_compatible(st.first_name, st.last_name, kp.first_name, kp.last_name), false)
     or not (coalesce(lower(btrim(st.email)) = lower(btrim(kp.email)), false)
             or coalesce(st.dob = kp.dob, false)) then
    raise exception 'not_the_same_person' using errcode = 'P0001';
  end if;

  if st.contract_signed_at is not null
     or st.user_id is not null
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

  -- The restrictive half of the group only (ADR-0126): a SpudBros person
  -- stays closed to THC shifts. Not applied where it would strand an
  -- upcoming invitation or shift (the office's set_staff_scheduling rule).
  if st.spudbros_express and not kp.spudbros_express then
    if exists (select 1 from bookings b join shift_requirements sr on sr.id = b.shift_id
                where b.staff_id = p_keep
                  and b.status in ('invited', 'applied', 'confirmed')
                  and sr.starts_at > now()) then
      v_group_held := true;
    else
      update staff set spudbros_express = true, thc_shifts_enabled = false where id = p_keep;
      v_group := true;
    end if;
  end if;

  -- onboarding_do_reject() would queue E2/E2b; this is not a rejection of
  -- the person, so it only closes the record.
  if not v_already then
    update staff
       set status           = 'rejected',
           rejection_cause  = 'manager',
           rejection_reason = 'Duplicate record: the same person is onboarding under another record. No email was sent.',
           rejected_by      = p_actor
     where id = p_stale;
  end if;

  -- Tombstoned the way the other cancellations are (a deleted key could be
  -- queued again). Matched by recipient and by the id in the key, because
  -- E3 and E2 rows carry only an address. A row the drain claimed in the
  -- last ten minutes (its lease is five) is left to finish.
  update notification_outbox o
     set failed_at = now(),
         error = 'Not sent: duplicate record closed'
   where (o.recipient_staff_id = p_stale or o.key like '%:staff:' || p_stale::text || ':%')
     and o.sent_at is null
     and o.failed_at is null
     and (o.last_attempt_at is null or o.last_attempt_at < now() - interval '10 minutes');
  get diagnostics v_dropped = row_count;

  if not v_already or v_pay_moved or v_emp_moved or v_group then
    insert into audit_log (actor, action, entity, entity_id, data)
    values (p_actor, 'staff.duplicate_closed', 'staff', p_stale,
            jsonb_build_object('staffId', p_stale::text,
                               'keptStaffId', p_keep::text,
                               'fromStatus', st.status::text,
                               'alreadyRejected', v_already,
                               'payrollIdMoved', v_pay_moved,
                               'payrollId', case when v_pay_moved then v_pay end,
                               'employeeIdMoved', v_emp_moved,
                               'employeeId', case when v_emp_moved then v_emp end,
                               'spudbrosCopied', v_group,
                               'spudbrosHeld', v_group_held,
                               'unsentEmailsStopped', v_dropped));
  end if;

  if v_pay_moved or v_emp_moved or v_group then
    insert into audit_log (actor, action, entity, entity_id, data)
    values (p_actor, 'staff.duplicate_merged_in', 'staff', p_keep,
            jsonb_build_object('staffId', p_keep::text,
                               'fromStaffId', p_stale::text,
                               'payrollId', case when v_pay_moved then v_pay end,
                               'employeeId', case when v_emp_moved then v_emp end,
                               'spudbrosCopied', v_group));
  end if;

  return jsonb_build_object('staffId', p_stale::text,
                            'keptStaffId', p_keep::text,
                            'alreadyClosed', v_already,
                            'payrollIdMoved', v_pay_moved,
                            'employeeIdMoved', v_emp_moved,
                            'spudbrosCopied', v_group,
                            'spudbrosHeld', v_group_held,
                            'unsentEmailsStopped', v_dropped);
end $$;

comment on function public.close_duplicate_candidate(uuid, uuid, uuid) is
  '20261023150000 (ADR-0191): closes a stale duplicate onboarding record without emailing anyone: moves its Payroll ID and Employee ID to the kept record (and SpudBros marking, never the THC-shifts switch), rejects it quietly, tombstones its unsent emails, audits. Same person only (a name on both sides, names compatible, and the same email or date of birth); refused when the stale record has bookings, documents, a login or a signed contract. Service role only.';

revoke all on function public.close_duplicate_candidate(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.close_duplicate_candidate(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------
-- One-off: the two pairs found on 22.10.2026
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  v jsonb;
begin
  for r in
    select * from (values
      ('74fc8757-38e2-426d-ba1e-a7477e5240ce'::uuid, '17bb51c4-8f5d-4480-9d27-ad4155bc7958'::uuid),
      ('c77d4e46-0972-4803-a243-ca0bf843d63f'::uuid, 'ff42c437-8967-4af5-8371-eda68be155cf'::uuid)
    ) as p(stale, keep)
  loop
    if exists (select 1 from staff where id = r.stale and removed_at is null)
       and exists (select 1 from staff where id = r.keep and removed_at is null) then
      begin
        v := public.close_duplicate_candidate(r.stale, r.keep, null);
        -- Something that did not move (the kept record has its own ID, or the
        -- group was held) is said, not silent.
        if exists (select 1 from staff s where s.id = r.stale and (s.payroll_id is not null or s.employee_id is not null)) then
          raise warning 'close_duplicate_candidate %: an ID stayed on the stale record (the kept one has its own): %', r.stale, v;
        end if;
      exception when others then
        raise warning 'close_duplicate_candidate % skipped: %', r.stale, sqlerrm;
        insert into audit_log (actor, action, entity, entity_id, data)
        values (null, 'staff.duplicate_close_skipped', 'staff', r.stale,
                jsonb_build_object('staffId', r.stale::text, 'keptStaffId', r.keep::text, 'reason', sqlerrm));
      end;
    end if;
  end loop;
end $$;
