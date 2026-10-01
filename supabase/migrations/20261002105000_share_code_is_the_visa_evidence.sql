-- =====================================================================
-- Migration 20261002105000 · the share-code check is the visa evidence:
--                            no visa / status upload, no typed expiry,
--                            no NI evidence at onboarding (ADR-0077)
--
-- THC's decision, 01.10.2026, a deliberate change from scope §2.5:
--
--   "share code is covering this bit, so we won't need them to upload the
--    visa etc, and we will need NI number but not the other stuff at step
--    4 documents."
--
-- (The owner later confirmed the NI number at step 7 stays optional, as
-- §2.8 has it, and the visa type dropdown on step 1 stays as it is.)
--
-- The gov.uk share-code check (rtw_check, ADR-0025, 20260928100000)
-- already returns the right-to-work-until date, and that date — on the
-- verified share_code_report — drives staff.right_to_work_until, the
-- N1–N4 reminders, CL4 and the rota guard. A visa copy, a status document
-- and a worker-typed expiry add nothing to it. So, for a worker who
-- onboards from now on:
--
--   1 · onboarding_required_docs() — the step 4 set per branch:
--         uk_irish         passport, OR birth certificate (alone: no NI
--                          evidence beside it any more)
--         eu_settled       passport or national ID            (unchanged)
--         work_visa        passport                 (no visa_document)
--         int. student     passport + University Term Dates Letter
--                                                             (unchanged)
--         dependant_other  passport                 (no status_document)
--       onboarding_accepted_docs(), onboarding_attach_document(),
--       onboarding_submit_documents() and step 1's "uploads the new branch
--       does not ask for leave the queue" all read this function, so they
--       follow without being redefined: a visa_document, status_document
--       or ni_evidence upload in the wizard is now `doc_not_for_branch`.
--
--   2 · onboarding_save_right_to_work() — no expiry in any branch. The
--       visa type stays required for the work visa branch with the same
--       list (§2.5 pt 3, kept by the owner). p_visa_expiry stays in the
--       signature so the RPC, its grants and every caller keep their
--       shape, and is IGNORED: onboarding_progress.visa_expiry is written
--       null. Nothing else changes from 20260923200000.
--
--   3 · onboarding_documents_missing() — the "documents missing" tokens
--       the Back Office board, the candidate profile, the quiz gate and
--       the Staff App Documents hub all read. A work visa, dependant /
--       other or UK birth-certificate worker is no longer missing a
--       visa_document, status_document or ni_evidence. Same body as
--       20261001208000 otherwise: named columns, STABLE, INVOKER.
--
-- Kept, deliberately (no data is deleted):
--   · the doc_type values visa_document, status_document and ni_evidence,
--     and the onboarding_progress.visa_type / visa_expiry columns;
--   · every row already uploaded: a pending one is still verified or
--     rejected in Compliance and on the candidate profile, a verified one
--     still counts towards right_to_work_until (rtw_evidence_until) and
--     still gets its expiry reminders, and a worker who holds one can
--     still renew it from the Documents hub (submit_document_upload
--     accepts a type the worker already has on file);
--   · the GDPR scrub lists, the NI re-check on ni_evidence (ADR-0040),
--     the RTW evidence retention (ADR-0065) — they name types, not
--     requirements, and keep working on the rows that exist.
--
-- RLS, grants and signatures are untouched: each function is replaced
-- with the same arguments, return type, volatility and rights.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The step 4 set per branch. packages/domain `requiredDocuments()`;
--     onboarding.sql.test.ts parses the VALUES list below and holds it to
--     the TypeScript, row for row.
-- ---------------------------------------------------------------------
create or replace function public.onboarding_required_docs(p_branch rtw_branch, p_uk_choice text)
returns table (req_key text, accepts doc_type[])
language sql
immutable
set search_path = public, extensions
as $$
  select r.req_key, r.accepts from (values
    ('passport',          array['passport']::doc_type[],
       p_branch = 'uk_irish' and coalesce(p_uk_choice, 'passport') = 'passport'),
    ('birth_certificate', array['birth_certificate']::doc_type[],
       p_branch = 'uk_irish' and p_uk_choice = 'birth_certificate'),
    ('identity',          array['passport', 'national_id']::doc_type[],
       p_branch = 'eu_settled'),
    ('passport',          array['passport']::doc_type[],
       p_branch in ('work_visa', 'international_student', 'dependant_other')),
    ('university_term_dates_letter', array['university_term_dates_letter']::doc_type[],
       p_branch = 'international_student')
  ) r(req_key, accepts, applies)
  where r.applies
$$;

comment on function public.onboarding_required_docs(rtw_branch, text) is
  '§2.5 pts 1–5 as narrowed by THC on 01.10.2026 (ADR-0077): the step 4 documents a branch asks for, one row per requirement, any ONE of accepts satisfies it. UK/Irish passport OR birth certificate; EU passport or national ID; work visa and dependant/other passport; student passport + University Term Dates Letter. No visa_document, status_document or ni_evidence: the gov.uk share-code check is the right-to-work evidence (20261002105000).';

-- ---------------------------------------------------------------------
-- 2 · Step 1: the visa type stays, the typed expiry goes.
--
-- As 20260923200000 §9, except: no `expiry_required` / `expiry_past`,
-- p_visa_expiry ignored, visa_expiry written null.
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
  v_visa_type text;
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
    v_code := null;
    v_choice := coalesce(p_uk_doc_choice, '');
    if v_choice not in ('passport', 'birth_certificate') then
      raise exception 'doc_choice_required' using errcode = 'P0001';
    end if;
  else
    -- Validated before anything goes near gov.uk (§2.5).
    if not is_valid_share_code(p_share_code) then
      raise exception 'bad_share_code' using errcode = 'P0001';
    end if;
    v_code := normalise_share_code(p_share_code);
    v_choice := null;
  end if;

  -- §2.5 pt 3's dropdown, kept by the owner (ADR-0077).
  if v_branch = 'work_visa' then
    v_visa_type := nullif(btrim(coalesce(p_visa_type, '')), '');
    if v_visa_type is null
       or v_visa_type not in ('Skilled Worker', 'Youth Mobility Scheme', 'Graduate', 'Other work visa') then
      raise exception 'visa_type_required' using errcode = 'P0001';
    end if;
  end if;

  -- No typed expiry in any branch (ADR-0077): the gov.uk share-code check
  -- returns the right-to-work-until date. p_visa_expiry is not read.

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
  values (s.id, v_choice, v_visa_type, null, now(), now())
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
  '§2.5 step 1 of the wizard: branch, DOB (18+), share code, visa type (work visa), UK document choice. No typed expiry in any branch — p_visa_expiry is ignored and visa_expiry stored null, because the gov.uk share-code check supplies the right-to-work-until date (ADR-0077, 20261002105000). The 48-hour opt-out tick signs through wtr_optout_do_sign() and an untick gives notice through wtr_optout_do_cancel() — never a bare write to the flag (20260923200000).';

comment on column public.onboarding_progress.visa_expiry is
  'The visa / status expiry a worker typed on step 1 before ADR-0077 (01.10.2026). No longer written (null from 20261002105000): the gov.uk share-code check supplies the right-to-work-until date. Kept for rows already on file; it was never right_to_work_until.';

comment on column public.onboarding_progress.visa_type is
  'Branch 3''s visa type dropdown (§2.5 pt 3) — Skilled Worker, Youth Mobility Scheme, Graduate or Other work visa. Still required on step 1 for the work visa branch (ADR-0077 kept it).';

-- ---------------------------------------------------------------------
-- 3 · What is missing, per branch.
--
-- As 20261001208000, except the branch sets: no ni_evidence beside a UK
-- birth certificate, no visa_document (work visa), no status_document
-- (dependant / other).
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
        -- passport OR birth certificate (ADR-0077: no NI evidence beside it)
        if not ('passport' = any(have) or 'birth_certificate' = any(have)) then
          missing := missing || 'passport'::text;
        end if;
      when 'eu_settled' then
        if not ('passport' = any(have) or 'national_id' = any(have)) then
          missing := missing || 'passport'::text;
        end if;
      when 'international_student' then
        if not ('passport' = any(have)) then missing := missing || 'passport'::text; end if;
        if not ('university_term_dates_letter' = any(have)) then
          missing := missing || 'university_term_dates_letter'::text;
        end if;
      when 'work_visa', 'dependant_other' then
        -- The share code below is the visa evidence (ADR-0077).
        if not ('passport' = any(have)) then missing := missing || 'passport'::text; end if;
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
  '§2.5 points 1–5 as narrowed by ADR-0077: which of the branch''s required items have not been supplied at all (tokens: dob, rtw_branch, passport, university_term_dates_letter, share_code, criminal_declaration). No visa_document, status_document or ni_evidence token for any branch: the gov.uk share-code check is the evidence. Empty = everything is in; whether it is verified is compliance_blockers() (20261002105000).';
