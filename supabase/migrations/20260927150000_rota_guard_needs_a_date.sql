-- ---------------------------------------------------------------------
-- The rota guard refuses a non-UK worker whose verified right-to-work
-- evidence carries no date (ADR-0018's remaining gap, docs/14 §2 4c).
--
-- Why: CLAUDE.md, "Right-to-work expiry outranks all of it — cap 0, and
-- canRoster() is a per-shift hard stop". Since 20260923200000 every verify
-- records the date its branch needs, so the only way a verified non-UK
-- worker has none is the legacy case 20260923200000's header describes:
-- verified on a share code before the date was required. Until now
-- can_roster_staff() read that NULL as "no expiry recorded" (20260922093100)
-- and the office could book them on any date; the Needs review row
-- (20260926121000) surfaces them, and this makes the booking wait for
-- the office to confirm the date there.
--
-- Scope of the refusal, deliberately narrow: a worker on a branch that
-- needs a date (every branch but uk_irish), whose LATEST verified
-- right-to-work report or document has neither a date nor the settled
-- "no time limit" flag. A candidate with nothing verified yet is not
-- touched — they cannot be rostered for other reasons — and a UK/Irish
-- worker never needed a date. A verified date behaves as before
-- (inclusive expiry, can_roster()).
--
-- Held to: pgTAP 524 §B flips from "still rosterable" to refused, and
-- 524 §C already shows the refusal lifting the moment the office confirms
-- the date. 090/361/460 keep their existing cases.
-- ---------------------------------------------------------------------

create or replace function public.can_roster_staff(p_staff uuid, p_shift_date date)
returns boolean language sql stable
set search_path = public, extensions
as $$
  select case
    when s.id is null then can_roster(p_shift_date, null)
    when s.right_to_work_until is null
     and s.rtw_branch is distinct from 'uk_irish'::rtw_branch
     and (select d.right_to_work_until is null and not coalesce(d.rtw_no_time_limit, false)
            from compliance_docs d
           where d.staff_id = s.id
             and d.doc_type in ('share_code_report', 'visa_document', 'status_document')
             and d.review_status = 'verified'
           order by d.reviewed_at desc nulls last, d.uploaded_at desc
           limit 1)
      then false
    else can_roster(p_shift_date, s.right_to_work_until)
  end
    from (select p_staff as id) q
    left join staff s on s.id = q.id
$$;

comment on function public.can_roster_staff(uuid, date) is
  'can_roster() for a worker on a date, reading staff.right_to_work_until. True when no expiry is recorded — except a non-UK worker whose latest verified right-to-work evidence carries neither a date nor the settled no-time-limit flag (ADR-0018): refused until the office confirms the date from the Needs review row (20260926121000).';
