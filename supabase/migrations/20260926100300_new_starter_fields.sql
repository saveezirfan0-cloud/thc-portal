-- =====================================================================
-- New Starter fields: the wizard collects gender, postcode and country
--
-- docs/14 §4 ("From the 23.09 build"): "New Starter report fields
-- (gender, postcode, country) are blank until collected; the wizard does
-- not ask for gender yet." 20260923130000 added staff.gender (M/F),
-- staff.home_postcode and staff.home_country and made the §9.9 Tab 3
-- report read them, but nothing wrote them: onboarding_save_address()
-- folded the typed postcode into home_address and threw the separate
-- value away, and no step asked for gender. This migration closes that:
--
--   1. home_postcode carries a format constraint — upper-case, one space
--      before the inward code, the shape the wizard already writes into
--      home_address — with format_uk_postcode() as the one normaliser;
--   2. onboarding_save_right_to_work() gains p_gender, required in every
--      branch like the date of birth (§9.9 Tab 3 "Gender (M/F)" — HMRC's
--      Starter Checklist takes exactly those two). The old seven-argument
--      signature stays only because pgTAP 390 calls it as the migration
--      role; it is revoked from every PostgREST role so no client can skip
--      the field, and it goes when 390 moves to the new form;
--   3. onboarding_save_address() stores the postcode separately and sets
--      home_country to 'United Kingdom' — not a guess: the same function
--      refuses a non-UK postcode and a pin outside the UK box;
--   4. onboarding_state() returns the three, so step 1 and step 2 re-open
--      with what was saved;
--   5. workers already past step 2 are backfilled by the same rule.
--
-- The report side (new_starter_rows, the CSV, the office tab) already
-- carries the three columns and is not restated. The columns were granted
-- by name in 20260923210000; no column is added here, so no grant is.
--
-- Bodies restated from their latest definitions (docs/14 §8):
--   onboarding_save_right_to_work · onboarding_state  ← 20260923200000
--   onboarding_save_address                          ← 20260923120000
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The postcode, in one shape
-- ---------------------------------------------------------------------
alter table staff add column if not exists gender text;
alter table staff add column if not exists home_postcode text;
alter table staff add column if not exists home_country text;

-- "e2 0ry" → "E2 0RY"; anything that is not a UK postcode → null. The
-- pattern is the one onboarding_save_address() refuses on
-- (packages/domain POSTCODE_SQL_PATTERN), applied after the spaces go.
create or replace function public.format_uk_postcode(p text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select case when t.v ~ '^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$'
              then left(t.v, length(t.v) - 3) || ' ' || right(t.v, 3) end
    from (select upper(regexp_replace(coalesce(p, ''), '\s', '', 'g'))) t(v)
$$;

comment on function public.format_uk_postcode(text) is
  'A UK postcode normalised to upper case with the single space before the inward code, or null when it is not one. The one shape staff.home_postcode holds (staff_home_postcode_format).';

-- Nothing has written the column yet (that is the gap), but a value typed
-- into it by hand is normalised rather than left to fail the constraint.
update staff
   set home_postcode = format_uk_postcode(home_postcode)
 where home_postcode is not null
   and home_postcode is distinct from format_uk_postcode(home_postcode);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_home_postcode_format') then
    alter table staff add constraint staff_home_postcode_format
      check (home_postcode is null or home_postcode ~ '^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$');
  end if;
end $$;

comment on column staff.home_postcode is
  'HMRC New Starter report (§9.9 Tab 3). Written by onboarding_save_address() as format_uk_postcode() shapes it (upper case, one space); null on a worker who has not reached step 2, when the report falls back to the postcode at the end of home_address.';
comment on column staff.home_country is
  'HMRC New Starter report (§9.9 Tab 3). ''United Kingdom'' once onboarding_save_address() has accepted a UK postcode and a pin inside the UK; null before that prints blank, never a guessed country.';
comment on column staff.gender is
  'HMRC New Starter report (§9.9 Tab 3): M or F, as the Starter Checklist takes it. Required on step 1 of the wizard with the date of birth (onboarding_save_right_to_work).';

-- ---------------------------------------------------------------------
-- 2 · Step 1 of the wizard asks for gender
--
-- Identical to 20260923200000 except for p_gender: checked after the
-- date of birth, written in the same update. A worker re-opening step 1
-- (editable until the documents are submitted) may change it.
-- ---------------------------------------------------------------------
create or replace function public.onboarding_save_right_to_work(
  p_branch        text,
  p_dob           date,
  p_share_code    text,
  p_visa_type     text,
  p_visa_expiry   date,
  p_uk_doc_choice text,
  p_wtr_optout    boolean,
  p_gender        text
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
  v_expiry date;
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

  -- Gender, as HMRC's Starter Checklist takes it: M or F, and required in
  -- every branch like the date of birth (§9.9 Tab 3 "Gender (M/F)").
  if p_gender is null then
    raise exception 'gender_required' using errcode = 'P0001';
  end if;
  if p_gender not in ('M', 'F') then
    raise exception 'bad_gender' using errcode = 'P0001';
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

  if v_branch = 'work_visa' then
    v_visa_type := nullif(btrim(coalesce(p_visa_type, '')), '');
    if v_visa_type is null
       or v_visa_type not in ('Skilled Worker', 'Youth Mobility Scheme', 'Graduate', 'Other work visa') then
      raise exception 'visa_type_required' using errcode = 'P0001';
    end if;
  end if;

  if v_branch in ('work_visa', 'dependant_other') then
    if p_visa_expiry is null then
      raise exception 'expiry_required' using errcode = 'P0001';
    end if;
    if p_visa_expiry <= v_today then
      raise exception 'expiry_past' using errcode = 'P0001';
    end if;
    v_expiry := p_visa_expiry;
  end if;

  update staff
     set rtw_branch = v_branch,
         dob = p_dob,
         gender = p_gender,
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
  values (s.id, v_choice, v_visa_type, v_expiry, now(), now())
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

comment on function public.onboarding_save_right_to_work(text, date, text, text, date, text, boolean, text) is
  '§2.5 step 1 of the wizard: branch, DOB (18+), gender (M/F, for the §9.9 New Starter report), share code, visa type and typed expiry, UK document choice. The 48-hour opt-out tick signs through wtr_optout_do_sign() and an untick gives notice through wtr_optout_do_cancel() — never a bare write to the flag (20260923200000). Gender added 20260926100300.';

-- The seven-argument form predates gender. pgTAP 390 still calls it as
-- the migration role, so it is kept for that file alone: revoked from
-- every role PostgREST serves, so a client that leaves p_gender out is
-- refused (42501) rather than let through without the field. Drop it once
-- 390 calls the eight-argument form.
revoke execute on function public.onboarding_save_right_to_work(text, date, text, text, date, text, boolean)
  from public, anon, authenticated;
comment on function public.onboarding_save_right_to_work(text, date, text, text, date, text, boolean) is
  'Superseded by the eight-argument form (p_gender, 20260926100300). Not executable by any PostgREST role; kept while pgTAP 390 calls it as the migration role.';

-- ---------------------------------------------------------------------
-- 3 · Step 2 stores the postcode on its own and the country
--
-- Identical to 20260923120000 except the update: home_postcode gets the
-- formatted postcode the address line already ends with, and home_country
-- 'United Kingdom' — which the two refusals above it guarantee.
-- ---------------------------------------------------------------------
create or replace function public.onboarding_save_address(
  p_line     text,
  p_town     text,
  p_postcode text,
  p_lat      double precision,
  p_lng      double precision
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s staff := onboarding_me();
  p onboarding_progress;
  v_line text := nullif(btrim(coalesce(p_line, '')), '');
  v_town text := nullif(btrim(coalesce(p_town, '')), '');
  v_pc   text := upper(regexp_replace(coalesce(p_postcode, ''), '\s', '', 'g'));
  v_addr text;
begin
  if s.status <> 'documents' then
    raise exception 'wrong_stage' using errcode = 'P0001';
  end if;
  select * into p from onboarding_progress where staff_id = s.id;
  if p.rtw_at is null then
    raise exception 'previous_step' using errcode = 'P0001';
  end if;
  if p.documents_at is not null then
    raise exception 'documents_submitted' using errcode = 'P0001';
  end if;
  if v_line is null or v_town is null then
    raise exception 'address_required' using errcode = 'P0001';
  end if;
  if v_pc !~ '^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$' then
    raise exception 'bad_postcode' using errcode = 'P0001';
  end if;
  -- Great Britain and Northern Ireland, generously. A pin in the Atlantic
  -- is a slipped finger, and it would rank every venue as far away.
  if p_lat is null or p_lng is null
     or p_lat not between 49.0 and 61.0 or p_lng not between -9.0 and 2.5 then
    raise exception 'pin_outside_uk' using errcode = 'P0001';
  end if;

  v_pc := left(v_pc, length(v_pc) - 3) || ' ' || right(v_pc, 3);
  v_addr := v_line || ', ' || v_town || ' ' || v_pc;

  -- The postcode separately, in the shape staff_home_postcode_format
  -- holds, and the country the two checks above have just established
  -- (§9.9 Tab 3 Postcode · Country).
  update staff
     set home_address = v_addr,
         home_postcode = v_pc,
         home_country = 'United Kingdom',
         home_location = st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography
   where id = s.id;
  update onboarding_progress set address_at = now(), updated_at = now() where staff_id = s.id;

  return jsonb_build_object('ok', true, 'homeAddress', v_addr,
                            'homePostcode', v_pc, 'homeCountry', 'United Kingdom');
end $$;

comment on function public.onboarding_save_address(text, text, text, double precision, double precision) is
  '§10.3 2/11: the pin (proximity, §6) and the typed address. Since 20260926100300 the postcode is also stored in staff.home_postcode, formatted, and home_country is ''United Kingdom'' — the function refuses anything else — so the §9.9 New Starter report reads real values.';

-- ---------------------------------------------------------------------
-- 4 · onboarding_state(): gender, homePostcode, homeCountry
--
-- As 20260923200000 but for three fields on the worker, so step 1
-- re-opens with the gender chosen and step 2 with the postcode as
-- stored rather than as parsed back out of the address line.
-- ---------------------------------------------------------------------
create or replace function public.onboarding_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  s staff;
  p onboarding_progress;
  v_docs jsonb;
  v_decl jsonb;
  v_quiz jsonb;
  v_hmrc jsonb;
  v_refs jsonb;
  v_bank jsonb;
  v_contract jsonb;
  v_version text := current_contract_version();
begin
  if v_id is null then
    return null;
  end if;
  select * into s from staff where id = v_id;
  select * into p from onboarding_progress where staff_id = v_id;

  -- The latest non-superseded row per type: what the office is looking at.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                d.id,
           'docType',           d.doc_type::text,
           'status',            d.review_status::text,
           'fileName',          d.file_name,
           'fileSize',          coalesce(d.size_bytes, d.file_size),
           'uploadedAt',        d.uploaded_at,
           'expiryDate',        d.expiry_date,
           'rightToWorkUntil',  d.right_to_work_until,
           'rejectionReason',   d.rejection_reason,
           'reviewedAt',        d.reviewed_at,
           'needsManualReview', d.needs_manual_review,
           'termDates',         case when d.term_dates is null then null
                                     else (select jsonb_agg(jsonb_build_object(
                                             'from', lower(r), 'to', upper(r) - 1))
                                             from unnest(d.term_dates) r) end,
           'shareCode',         d.share_code)
           order by d.uploaded_at), '[]'::jsonb)
    into v_docs
    from compliance_docs d
    join current_compliance_docs(v_id) c on c.doc_id = d.id;

  select jsonb_build_object(
           'answer',       c.answer,
           'status',       c.review_status::text,
           'declaredAt',   c.declared_at,
           'reviewedAt',   c.reviewed_at)
    into v_decl
    from criminal_declarations c
   where c.staff_id = v_id and not c.superseded and c.source = 'onboarding'
   order by c.declared_at desc, c.id desc
   limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'attemptNo', q.attempt_no,
           'percent',   q.score,
           'passed',    q.passed,
           'correct',   (q.answers->>'correct')::int,
           'total',     (q.answers->>'total')::int,
           'takenAt',   q.taken_at)
           order by q.attempt_no), '[]'::jsonb)
    into v_quiz
    from quiz_attempts q
   where q.staff_id = v_id and not q.superseded;

  select jsonb_build_object(
           'q1OtherJob',       h.q1_other_job,
           'q2Pension',        h.q2_pension,
           'q3Since6April',    h.q3_since_6_april,
           'studentLoan',      h.student_loan::text,
           'postgraduateLoan', h.postgraduate_loan,
           'submittedAt',      h.submitted_at)
    into v_hmrc
    from hmrc_checklists h
   where h.staff_id = v_id and not h.superseded;

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', r.name, 'relationship', r.relationship,
           'phone', r.phone, 'email', r.email) order by r.name), '[]'::jsonb)
    into v_refs
    from staff_references r where r.staff_id = v_id;

  select jsonb_build_object(
           'accountHolder', b.account_holder,
           'sortCode',      b.sort_code,
           'accountNumber', b.account_number)
    into v_bank
    from bank_details b where b.staff_id = v_id;

  select jsonb_build_object(
           'version',       cv.version,
           'title',         cv.title,
           'body',          cv.body,
           'isPlaceholder', cv.is_placeholder)
    into v_contract
    from contract_versions cv where cv.version = v_version;

  return jsonb_build_object(
    'staffId',        s.id,
    'firstName',      s.first_name,
    'lastName',       s.last_name,
    'status',         s.status::text,
    'employeeId',     s.employee_id,
    'dob',            s.dob,
    'gender',         s.gender,
    'rtwBranch',      s.rtw_branch::text,
    'shareCode',      s.share_code,
    'wtrOptOut',      coalesce(s.wtr_optout, false) and s.wtr_optout_cancelled_from is null,
    'homeAddress',    s.home_address,
    'homePostcode',   s.home_postcode,
    'homeCountry',    s.home_country,
    'homeLat',        case when s.home_location is null then null
                           else st_y(s.home_location::geometry) end,
    'homeLng',        case when s.home_location is null then null
                           else st_x(s.home_location::geometry) end,
    'photoPath',      s.photo_path,
    'niMasked',       case when s.ni_number is null then null
                           else repeat('●', greatest(length(s.ni_number) - 2, 0))
                                || right(s.ni_number, 2) end,
    'quizAttempts',   s.quiz_attempts,
    'contractSignedAt', s.contract_signed_at,
    'contractVersion',  s.contract_version,
    'contractStamp',  case when s.contract_signed_at is null then null
                           else to_char(s.contract_signed_at at time zone 'Europe/London',
                                        'DD.MM.YYYY HH24:MI') || ' UK time' end,
    'progress', jsonb_build_object(
      'ukDocChoice',  p.uk_doc_choice,
      'visaType',     p.visa_type,
      'visaExpiry',   p.visa_expiry,
      'rtwAt',        p.rtw_at,
      'addressAt',    p.address_at,
      'selfieAt',     p.selfie_at,
      'documentsAt',  p.documents_at,
      'inductionAt',  p.induction_at,
      'hmrcAt',       p.hmrc_at,
      'referencesAt', p.references_at,
      'bankAt',       p.bank_at,
      'contractAt',   p.contract_at,
      'tutorialAt',   p.tutorial_at),
    'documents',   v_docs,
    'declaration', v_decl,
    'quiz',        v_quiz,
    'hmrc',        v_hmrc,
    'references',  v_refs,
    'bank',        v_bank,
    'contract',    v_contract);
end $$;

comment on function public.onboarding_state() is
  'The §10.3 wizard''s whole read, for the caller. Never returns the HMRC statement letter (§2.8), block_reason (§10.1), the declaration details or the quiz key. fileSize is size_bytes; wtrOptOut is a standing opt-out (no notice running) (20260923200000). gender, homePostcode and homeCountry since 20260926100300.';

-- ---------------------------------------------------------------------
-- 5 · Workers already past step 2
--
-- The same rule section 3 applies at save time, applied once to the rows
-- saved before it: onboarding_save_address() only ever accepted a UK
-- postcode and a pin inside the UK, so a worker whose address step is
-- stamped done has a UK address. Nobody else is touched — a worker with
-- no address_at still prints a blank country, and the postcode fallback
-- in new_starter_rows() (the end of home_address) stays as it was.
-- ---------------------------------------------------------------------
update staff s
   set home_postcode = coalesce(s.home_postcode, format_uk_postcode(new_starter_postcode(s.home_address))),
       home_country  = coalesce(s.home_country, 'United Kingdom')
  from onboarding_progress p
 where p.staff_id = s.id
   and p.address_at is not null
   and s.removed_at is null
   and (s.home_postcode is null or s.home_country is null);

-- ---------------------------------------------------------------------
-- 6 · Privileges (the pattern of 20260923120000 §14)
-- ---------------------------------------------------------------------
revoke execute on function public.onboarding_save_right_to_work(text, date, text, text, date, text, boolean, text) from public, anon;
grant  execute on function public.onboarding_save_right_to_work(text, date, text, text, date, text, boolean, text) to authenticated;
revoke execute on function public.onboarding_save_address(text, text, text, double precision, double precision) from public, anon;
grant  execute on function public.onboarding_save_address(text, text, text, double precision, double precision) to authenticated;
revoke execute on function public.onboarding_state() from public, anon;
grant  execute on function public.onboarding_state() to authenticated;
-- A pure formatter with nothing to protect; readable wherever a postcode is.
grant  execute on function public.format_uk_postcode(text) to anon, authenticated, service_role;
