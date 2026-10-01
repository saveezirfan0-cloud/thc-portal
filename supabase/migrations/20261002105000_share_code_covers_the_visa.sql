-- =====================================================================
-- Migration 20261002105000 · the share code covers the visa; UK / Irish
--                            is passport only (ADR-0077; owner request,
--                            01.10.2026)
--
-- What changes at onboarding (§2.5 pts 1, 3, 5, 7):
--   · No National Insurance evidence is collected. The UK / Irish branch
--     offered "passport OR birth certificate + NI evidence"; a UK birth
--     certificate is right-to-work evidence only when it is paired with
--     an official document showing the NI number, so without the NI
--     evidence the branch is passport only.
--   · Where a share code is used, nothing about the visa is typed or
--     uploaded: no visa type, no typed expiry, no visa / status document.
--     The gov.uk check already returns the status, the conditions and the
--     right-to-work-until date — the reasoning §2.5 pt 4 already applied
--     to students (confirmed 04.09.2026). Work visa and Dependant / other
--     now upload a passport, like the student branch.
--
-- In the database:
--   1. onboarding_required_docs() returns the new sets. The p_uk_choice
--      argument stays (callers pass it) and no longer changes anything.
--   2. onboarding_save_right_to_work() keeps its seven-argument signature
--      (and its grants) but ignores p_visa_type, p_visa_expiry and
--      p_uk_doc_choice: it no longer raises visa_type_required,
--      expiry_required, expiry_past or doc_choice_required, stores
--      uk_doc_choice 'passport' for the UK branch, and null visa fields.
--   3. onboarding_documents_missing() asks for the new sets. A UK / Irish
--      worker who already supplied a birth certificate + NI evidence
--      before this change still counts as complete — the
--      Documents tab must not start asking an employed worker for a
--      passport they were never asked for.
--   4. Candidates who have not submitted step 4 yet are moved onto the new
--      sets: a birth-certificate choice becomes passport, and their
--      pending uploads that no set asks for any more are superseded — what
--      onboarding_save_right_to_work() already does when the branch moves.
--      Submitted sets and verified documents are left exactly as they are;
--      the office still reviews what it was sent.
--
-- Not changed: the doc_type enum, the review paths, the Needs review
-- filters and the NI check (D43) — documents already on file still have
-- to be reviewable, and the office can still upload them.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The document sets. packages/domain `requiredDocuments()`.
-- ---------------------------------------------------------------------
create or replace function public.onboarding_required_docs(p_branch rtw_branch, p_uk_choice text)
returns table (req_key text, accepts doc_type[])
language sql
immutable
set search_path = public, extensions
as $$
  select r.req_key, r.accepts from (values
    ('passport',          array['passport']::doc_type[],
       p_branch in ('uk_irish', 'work_visa', 'dependant_other')),
    ('identity',          array['passport', 'national_id']::doc_type[],
       p_branch = 'eu_settled'),
    ('passport',          array['passport']::doc_type[],
       p_branch = 'international_student'),
    ('university_term_dates_letter', array['university_term_dates_letter']::doc_type[],
       p_branch = 'international_student')
  ) r(req_key, accepts, applies)
  where r.applies
$$;

comment on function public.onboarding_required_docs(rtw_branch, text) is
  '§2.5 pts 1-5 as changed by ADR-0077: one row per document a branch asks for at onboarding; any ONE of accepts satisfies it. UK / Irish, Work visa and Dependant / other: passport. EU / EEA: passport or national ID. International student: passport + University Term Dates Letter. p_uk_choice is kept for callers and no longer changes the set.';

-- ---------------------------------------------------------------------
-- 2 · Step 1 of the wizard. Same body as 20260923200000 without the visa
--     fields and the UK document choice.
-- ---------------------------------------------------------------------
create or replace function public.onboarding_save_right_to_work(
  p_branch        text,
  p_dob           date,
  p_share_code    text,
  p_visa_type     text,
  p_visa_expiry   date,
  p_uk_doc_choice text,
  p_wtr_optout    boolean
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s staff := onboarding_me();
  p onboarding_progress;
  v_branch rtw_branch;
  v_today date := onboarding_uk_today();
  v_code text;
  v_choice text;
  v_dropped int := 0;
  v_standing boolean;
  v_optout jsonb;
begin
  if s.status <> 'documents' then
    raise exception 'wrong_stage' using errcode = 'P0001';
  end if;
  select * into p from onboarding_progress where staff_id = s.id;
  if p.documents_at is not null then
    -- The office reviews the set as one (§2.10); the branch that decided
    -- the set cannot move under it.
    raise exception 'documents_submitted' using errcode = 'P0001';
  end if;

  begin
    v_branch := p_branch::rtw_branch;
  exception when invalid_text_representation then
    raise exception 'bad_branch' using errcode = 'P0001';
  end;
  if v_branch is null then
    raise exception 'bad_branch' using errcode = 'P0001';
  end if;

  -- "Date of birth is mandatory in every branch" (§2.5); 18+ (§2.1).
  if p_dob is null then
    raise exception 'dob_required' using errcode = 'P0001';
  end if;
  if p_dob > (v_today - interval '18 years')::date then
    raise exception 'under_18' using errcode = 'P0001';
  end if;

  if v_branch = 'uk_irish' then
    -- Passport only (ADR-0077): there is no choice left to make.
    v_code := null;
    v_choice := 'passport';
  else
    -- Validated before anything goes near gov.uk (§2.5). The gov.uk check
    -- returns the visa or status and its expiry (ADR-0077), so nothing
    -- about the visa is asked for here.
    if not is_valid_share_code(p_share_code) then
      raise exception 'bad_share_code' using errcode = 'P0001';
    end if;
    v_code := normalise_share_code(p_share_code);
    v_choice := null;
  end if;

  update staff
     set rtw_branch = v_branch,
         dob = p_dob,
         share_code = v_code
   where id = s.id;

  -- The 48-hour opt-out, through the same body as the Documents tab.
  v_standing := coalesce(s.wtr_optout, false) and s.wtr_optout_cancelled_from is null;
  if p_wtr_optout and not v_standing then
    v_optout := wtr_optout_do_sign(s.id, null, 7);
  elsif p_wtr_optout = false and v_standing then
    v_optout := wtr_optout_do_cancel(s.id);
  end if;
  if v_optout is not null and not (v_optout ->> 'ok')::boolean then
    raise exception '%', v_optout ->> 'reason' using errcode = 'P0001';
  end if;

  insert into onboarding_progress (staff_id, uk_doc_choice, visa_type, visa_expiry, rtw_at, updated_at)
  values (s.id, v_choice, null, null, now(), now())
  on conflict (staff_id) do update
    set uk_doc_choice = excluded.uk_doc_choice,
        visa_type     = excluded.visa_type,
        visa_expiry   = excluded.visa_expiry,
        rtw_at        = excluded.rtw_at,
        updated_at    = excluded.updated_at;

  -- A changed branch changes the set (§2.5 pt 8: nothing beyond it is
  -- collected). Uploads the new branch does not ask for leave the queue.
  with d as (
    update compliance_docs
       set review_status = 'superseded'
     where staff_id = s.id
       and review_status = 'pending'
       and doc_type <> 'share_code_report'
       and doc_type <> all (onboarding_accepted_docs(v_branch, v_choice))
    returning 1
  ) select count(*)::int into v_dropped from d;

  return jsonb_build_object('ok', true, 'branch', v_branch::text,
                            'shareCode', v_code, 'uploadsDropped', v_dropped,
                            'wtrOptOut', v_optout);
end $$;

comment on function public.onboarding_save_right_to_work(text, date, text, text, date, text, boolean) is
  '§2.5 step 1 of the wizard: branch, DOB (18+), share code. Since ADR-0077 (20261002105000) p_visa_type, p_visa_expiry and p_uk_doc_choice are ignored: the share code covers the visa and its expiry, and UK / Irish is passport only. The 48-hour opt-out tick signs through wtr_optout_do_sign() and an untick gives notice through wtr_optout_do_cancel() — never a bare write to the flag.';

-- ---------------------------------------------------------------------
-- 3 · What is missing. Same body as 20261001208000 with the new sets.
-- ---------------------------------------------------------------------
create or replace function public.onboarding_documents_missing(p_staff uuid)
returns text[]
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  s_id         uuid;
  s_dob        date;
  s_rtw_branch rtw_branch;
  s_share_code text;
  have doc_type[];
  missing text[] := '{}';
begin
  -- Named columns only: `authenticated` may not read staff.block_reason or
  -- staff.rejection_reason, so `select *` fails under the caller's rights.
  select id, dob, rtw_branch, share_code
    into s_id, s_dob, s_rtw_branch, s_share_code
    from staff where id = p_staff;
  if s_id is null then
    return null;
  end if;

  select coalesce(array_agg(d.doc_type), '{}') into have
    from current_compliance_docs(p_staff) d;

  if s_dob is null then
    missing := missing || 'dob'::text;             -- §2.5: mandatory in every branch
  end if;

  if s_rtw_branch is null then
    missing := missing || 'rtw_branch'::text;
  else
    case s_rtw_branch
      when 'uk_irish' then
        -- Passport only (ADR-0077). A birth certificate + NI evidence
        -- supplied before the change still stands for the worker who has
        -- them; nobody can supply that pair any more.
        if not ('passport' = any(have))
           and not ('birth_certificate' = any(have) and 'ni_evidence' = any(have)) then
          missing := missing || 'passport'::text;
        end if;
      when 'eu_settled' then
        if not ('passport' = any(have) or 'national_id' = any(have)) then
          missing := missing || 'passport'::text;
        end if;
      when 'work_visa', 'dependant_other' then
        -- The share code covers the visa or status (ADR-0077).
        if not ('passport' = any(have)) then missing := missing || 'passport'::text; end if;
      when 'international_student' then
        if not ('passport' = any(have)) then missing := missing || 'passport'::text; end if;
        if not ('university_term_dates_letter' = any(have)) then
          missing := missing || 'university_term_dates_letter'::text;
        end if;
    end case;

    -- The share code is typed, never uploaded (§2.5), and every branch
    -- but the first carries one.
    if s_rtw_branch <> 'uk_irish' and s_share_code is null then
      missing := missing || 'share_code'::text;
    end if;
  end if;

  -- The declaration sits on the same step (4/11) and is part of the same
  -- single blocker (§2.10).
  if not exists (select 1 from criminal_declarations c
                  where c.staff_id = p_staff and not c.superseded) then
    missing := missing || 'criminal_declaration'::text;
  end if;

  return missing;
end $$;

comment on function public.onboarding_documents_missing(uuid) is
  '§2.5 points 1-5 as changed by ADR-0077: which of the branch''s required items have not been supplied at all (tokens: dob, rtw_branch, passport, university_term_dates_letter, share_code, criminal_declaration). A UK / Irish worker who supplied a birth certificate + NI evidence before the change is complete. Empty = everything is in; whether it is verified is compliance_blockers().';

-- ---------------------------------------------------------------------
-- 4 · Candidates part-way through step 1–4 move onto the new sets.
-- ---------------------------------------------------------------------
update onboarding_progress p
   set uk_doc_choice = 'passport',
       updated_at = now()
 where p.uk_doc_choice = 'birth_certificate'
   and p.documents_at is null;

update compliance_docs d
   set review_status = 'superseded'
  from staff s
  left join onboarding_progress p on p.staff_id = s.id
 where d.staff_id = s.id
   and s.status = 'documents'
   and s.rtw_branch is not null
   and p.documents_at is null
   and d.review_status = 'pending'
   and d.doc_type <> 'share_code_report'
   and d.doc_type <> all (onboarding_accepted_docs(s.rtw_branch, 'passport'));
