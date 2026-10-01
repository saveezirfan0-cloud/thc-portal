-- =====================================================================
-- Migration 20261002105000 · the share-code check is the visa evidence:
--                            no visa / status upload and no typed expiry
--                            at onboarding (ADR-0077)
--
-- THC's decision, 01.10.2026, a deliberate change from scope §2.5:
--
--   "share code is covering this bit, so we won't need them to upload the
--    visa etc, and we will need NI number but not the other stuff at step
--    4 documents."
--
-- The owner then settled three points:
--   · the visa type dropdown on step 1 stays as it is;
--   · the NI number at step 7 stays optional, as §2.8 has it;
--   · the NI document STAYS on the UK / Irish birth-certificate route: the
--     Home Office's List A takes a UK birth certificate only together with
--     an official document showing the NI number (ADR-0065), so the pair is
--     the right-to-work evidence there and the share code cannot replace
--     it (that branch has none).
--
-- The gov.uk share-code check (rtw_check, ADR-0025, 20260928100000)
-- already returns the right-to-work-until date, and that date — on the
-- verified share_code_report — drives staff.right_to_work_until, the
-- N1–N4 reminders, CL4 and the rota guard. A visa copy, a status document
-- and a worker-typed expiry add nothing to it. So, for a worker who
-- onboards from now on:
--
--   1 · onboarding_required_docs() — the step 4 set per branch:
--         uk_irish         passport, OR birth certificate + NI evidence
--                                                             (unchanged)
--         eu_settled       passport or national ID            (unchanged)
--         work_visa        passport                 (no visa_document)
--         int. student     passport + University Term Dates Letter
--                                                             (unchanged)
--         dependant_other  passport                 (no status_document)
--       onboarding_accepted_docs(), onboarding_attach_document(),
--       onboarding_submit_documents() and step 1's "uploads the new branch
--       does not ask for leave the queue" all read this function, so they
--       follow without being redefined: a visa_document or status_document
--       upload in the wizard is now `doc_not_for_branch`, and so is
--       ni_evidence anywhere but the UK birth-certificate route (as before).
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
--       the Staff App Documents hub all read. A work visa or dependant /
--       other worker is no longer missing a visa_document or
--       status_document. Same body as 20261001208000 otherwise (the UK
--       birth-certificate route still owes its ni_evidence): named
--       columns, STABLE, INVOKER.
--
--   4 · One-off: candidates already in the wizard. A visa_document or
--       status_document — and an ni_evidence anywhere but the UK
--       birth-certificate route — that is still pending or was rejected,
--       for a worker still in onboarding (interview_requested,
--       interview_completed or documents), is marked `superseded`. Without
--       it, a rejected one would block the quiz for ever: the wizard no
--       longer offers its re-upload. Superseded rows are kept, read-only,
--       like any other (§2.12); nothing is deleted, and verified rows and
--       every worker past the documents stage are not touched. The §2.3
--       gate (onboarding_advance_if_ready) is then run for each candidate
--       touched — the row trigger only reacts to a Verify — so one whose
--       last blocker this was moves to Quiz and is sent E12 (ADR-0075),
--       exactly as a Verify would have done.
--
-- Kept, deliberately (no data is deleted):
--   · the doc_type values visa_document, status_document and ni_evidence,
--     and the onboarding_progress.visa_type / visa_expiry columns;
--   · every row already uploaded: a pending one of a worker past the
--     documents stage is still verified or rejected in Compliance (an
--     in-wizard candidate's pending visa / status row is superseded by
--     step 4 below, and stays on the profile read-only), a verified one
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
    ('ni_evidence',       array['ni_evidence']::doc_type[],
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
  '§2.5 pts 1–5 as narrowed by THC on 01.10.2026 (ADR-0077): the step 4 documents a branch asks for, one row per requirement, any ONE of accepts satisfies it. UK/Irish passport OR birth certificate + NI evidence (List A); EU passport or national ID; work visa and dependant/other passport; student passport + University Term Dates Letter. No visa_document or status_document: the gov.uk share-code check is the right-to-work evidence (20261002105000).';

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
-- As 20261001208000, except the branch sets: no visa_document (work
-- visa), no status_document (dependant / other). The UK birth-certificate
-- route still owes its ni_evidence.
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
        -- passport OR birth certificate + a document showing the NI number
        -- (List A; kept by ADR-0077)
        if not ('passport' = any(have)) then
          if 'birth_certificate' = any(have) then
            if not ('ni_evidence' = any(have)) then
              missing := missing || 'ni_evidence'::text;
            end if;
          else
            missing := missing || 'passport'::text;
          end if;
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
  '§2.5 points 1–5 as narrowed by ADR-0077: which of the branch''s required items have not been supplied at all (tokens: dob, rtw_branch, passport, ni_evidence — UK birth-certificate route only —, university_term_dates_letter, share_code, criminal_declaration). No visa_document or status_document token for any branch: the gov.uk share-code check is the evidence. Empty = everything is in; whether it is verified is compliance_blockers() (20261002105000).';

-- ---------------------------------------------------------------------
-- 4 · One-off: candidates already in the wizard (see the header).
--
-- Pending or rejected only; superseded, never deleted; only workers still
-- in onboarding up to and including the documents stage. Then the §2.3
-- gate for each candidate touched: onboarding_docs_advance fires on a
-- Verify only, so a superseded last blocker would otherwise leave the
-- candidate in Documents with nothing outstanding. The gate does nothing
-- unless they are in `documents` with no blocker left.
-- ---------------------------------------------------------------------
create or replace function public.onboarding_supersede_legacy_rtw_docs()
returns int
language plpgsql
set search_path = public, extensions
as $$
declare
  v_staff uuid[];
  v_count int;
begin
  with d as (
    update compliance_docs d
       set review_status = 'superseded'
      from staff s
      left join onboarding_progress p on p.staff_id = s.id
     where d.staff_id = s.id
       and s.status in ('interview_requested', 'interview_completed', 'documents')
       and d.review_status in ('pending', 'rejected')
       and (d.doc_type in ('visa_document', 'status_document')
            or (d.doc_type = 'ni_evidence'
                and not (s.rtw_branch is not distinct from 'uk_irish'
                         and p.uk_doc_choice is not distinct from 'birth_certificate')))
    returning d.staff_id
  )
  select coalesce(array_agg(distinct d.staff_id), '{}'), count(*)::int into v_staff, v_count from d;

  perform onboarding_advance_if_ready(x) from unnest(v_staff) x;
  return v_count;
end $$;

comment on function public.onboarding_supersede_legacy_rtw_docs() is
  'ADR-0077 one-off, run once by 20261002105000: supersedes (never deletes) pending or rejected visa_document / status_document rows, and ni_evidence off the UK birth-certificate route, for candidates up to and including Documents, then runs the §2.3 gate for each one touched. Returns the number of rows superseded. Idempotent; kept as a function so 765 can exercise it.';

revoke execute on function public.onboarding_supersede_legacy_rtw_docs() from public, anon, authenticated;

select public.onboarding_supersede_legacy_rtw_docs();
