-- =====================================================================
-- Migration 20260923120000 · The onboarding wizard, steps 1–4
--                            (§10.3, §2.5, §2.6, §2.10, §2.12)
--
-- The worker's half of onboarding: right to work → home address →
-- profile selfie → documents + the criminal-conviction declaration. The
-- office's half (the kanban, Verify / Reject, the gov.uk check) is B5's
-- and is not here; what IS here is the one consequence of the office's
-- Verify that §2.3 makes automatic — "as soon as ALL documents —
-- including the Criminal Record declaration — are verified, the
-- candidate advances to the 'Quiz' stage by themselves" — because a rule
-- that only the Verify screen remembers is a rule a bulk import forgets.
--
-- Shape, and why
-- --------------
-- Every write is a `security definer` function that resolves the caller
-- through staff_caller() and takes no staff id, the pattern of
-- 20260922140000 and 20260922180000. A worker holds a SELECT policy on
-- their own `staff` row and nothing that writes it, and must not gain one:
-- the row carries status, block_kind and employee_id.
--
-- Every function checks the STAGE before it writes. The wizard's gating
-- (packages/domain/src/onboarding.ts, `stepAccess`) decides what the
-- screens offer; this decides what the database accepts, so a forged
-- call for step 4 from a candidate still in step 1 is refused here, not
-- merely hidden there. Status changes go through assert_staff_transition
-- (20260921180312) and nowhere else.
--
-- What this adds
-- --------------
--   onboarding_progress   one row per worker per period: when each of
--                         the eleven steps was completed, plus the three
--                         step-1 answers that have no column on `staff`
--                         (branch-1 document choice, visa type, typed
--                         visa expiry). Wiped by Reset to candidate, so
--                         a returning worker walks the whole wizard again
--                         (§2.12 "the full wizard again, not a partial
--                         document recheck").
--   quiz_questions        the H&S answer key. Admin only: a worker who
--                         could read it could pass by reading the page.
--                         Rows arrive in 20260923120100.
--   contract_versions     the zero-hours agreement, versioned and
--                         immutable once published (§2.11). Rows arrive
--                         in 20260923120200.
--   compliance_docs       + file_name, file_size, mime_type, so the
--                         Documents step can print "passport_amara.jpg ·
--                         2.1 MB" as the wireframe does.
--   quiz_attempts,        + a superseded flag, with the uniqueness moved
--   hmrc_checklists         to the current period. reset_to_candidate()
--                         sets staff.quiz_attempts = 0 and supersedes the
--                         checklist, but both tables were unique per
--                         WORKER, so a returning worker's first attempt
--                         collided with their old attempt 1 and their new
--                         checklist with their old one. §2.12 wants the
--                         old evidence kept read-only, not overwritten.
--
-- The AI seam (§2.6)
-- ------------------
-- record_document_extraction() is what the Gemini extractor calls, with
-- the service key, after an upload. It pre-fills dates and a confidence
-- and flags `needs_manual_review` below the threshold in settings; it
-- never touches review_status, because "the AI does not verify a
-- document". Until an extractor is configured, every upload arrives
-- flagged for manual review, which is the honest default: nothing was
-- pre-filled.
--
-- The gov.uk seam (§2.6, ADR-0002)
-- --------------------------------
-- Submitting step 4 in a share-code branch files a `share_code_report`
-- row, pending, carrying the code. ADR-0002's assisted check (the office
-- runs it and attaches the report) and any automated checker both finish
-- that row; neither is built here, and the worker's side does not wait
-- for either.
--
-- Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · onboarding_progress
-- ---------------------------------------------------------------------
create table if not exists onboarding_progress (
  staff_id      uuid primary key references staff(id) on delete cascade,
  -- Branch 1 only: "passport (photo) OR birth certificate + a document
  -- showing the NI number" (§2.5 pt 1).
  uk_doc_choice text check (uk_doc_choice in ('passport', 'birth_certificate')),
  -- Branch 3's dropdown (§2.5 pt 3).
  visa_type     text,
  -- Branches 3 and 5, typed by the worker (§2.5 pts 3, 5). Pre-fills the
  -- visa / status document's expiry; the office cross-checks it against
  -- the document and the gov.uk result. It is NOT right_to_work_until —
  -- nobody types that (§2.3).
  visa_expiry   date,
  rtw_at        timestamptz,
  address_at    timestamptz,
  selfie_at     timestamptz,
  documents_at  timestamptz,
  induction_at  timestamptz,
  hmrc_at       timestamptz,
  references_at timestamptz,
  bank_at       timestamptz,
  contract_at   timestamptz,
  tutorial_at   timestamptz,
  updated_at    timestamptz not null default now()
);

comment on table onboarding_progress is
  'Where a worker is in the §10.3 wizard this period: one stamp per step, plus the step-1 answers with no column on staff. Cleared by Reset to candidate. Written only by the onboarding_* definer functions.';

alter table onboarding_progress enable row level security;
drop policy if exists admin_all on onboarding_progress;
drop policy if exists staff_self_progress on onboarding_progress;
create policy admin_all on onboarding_progress for all using (current_app_role() = 'admin');
-- Read only. Every write is a stage-checked RPC below.
create policy staff_self_progress on onboarding_progress for select
  using (staff_id = (select s.id from staff s where s.user_id = (select auth.uid())));

-- ---------------------------------------------------------------------
-- 2 · quiz_questions — the answer key (§2.9)
--
-- "The questions and the correct answers are taken from [THC's 'Health
-- and Safety Presentation Questions']". That file is an input we do not
-- have (Appendix B); the placeholder rows in 20260923120100 are marked
-- is_placeholder and must be replaced before go-live.
-- ---------------------------------------------------------------------
create table if not exists quiz_questions (
  id             uuid primary key default gen_random_uuid(),
  position       int not null check (position >= 1),
  prompt         text not null check (btrim(prompt) <> ''),
  options        text[] not null check (array_length(options, 1) between 2 and 6),
  -- Zero-based index into options.
  correct_index  int not null,
  active         boolean not null default true,
  is_placeholder boolean not null default false,
  created_at     timestamptz not null default now(),
  constraint quiz_questions_correct_in_range
    check (correct_index >= 0 and correct_index < array_length(options, 1))
);
create unique index if not exists quiz_questions_active_position
  on quiz_questions (position) where active;

comment on table quiz_questions is
  'The §2.9 H&S quiz and its answer key. Admin only — the worker receives the questions without correct_index through onboarding_quiz_questions(), and is marked by submit_quiz_attempt().';

alter table quiz_questions enable row level security;
drop policy if exists admin_all on quiz_questions;
create policy admin_all on quiz_questions for all using (current_app_role() = 'admin');

-- ---------------------------------------------------------------------
-- 3 · contract_versions — the zero-hours agreement (§2.11)
--
-- Versioned because the signature is only evidence of anything if the
-- text signed can be produced later exactly as it was. A published
-- version is therefore immutable: a change is a NEW version, and the
-- worker who signed the old one still points at the old one
-- (staff.contract_version, audit_log 'contract_signed').
--
-- The CHECK is §2.11's second bullet, enforced: "The agreement includes
-- an ongoing duty to disclose … any unspent criminal conviction". A
-- version without it cannot be published, which is what lets §10.7's
-- copy point back at the contract.
-- ---------------------------------------------------------------------
create table if not exists contract_versions (
  version        text primary key check (version ~ '^[A-Za-z0-9._-]+$'),
  title          text not null check (btrim(title) <> ''),
  body           text not null,
  published_at   timestamptz not null default now(),
  is_placeholder boolean not null default false,
  created_at     timestamptz not null default now(),
  constraint contract_versions_duty_to_disclose
    check (body ~* 'unspent criminal conviction')
);

comment on table contract_versions is
  'The §2.11 zero-hours agreement, one row per published version. Immutable once published; every version must carry the ongoing duty to disclose convictions (§10.7).';

alter table contract_versions enable row level security;
drop policy if exists admin_all on contract_versions;
drop policy if exists contract_versions_read on contract_versions;
create policy admin_all on contract_versions for all using (current_app_role() = 'admin');
-- The text of a contract is not personal data; any signed-in role may
-- read it (same shape as venue_types / staff_transitions: null for anon).
create policy contract_versions_read on contract_versions for select
  using (current_app_role() is not null);

create or replace function public.contract_version_immutable()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if old.published_at <= now() then
    raise exception 'contract_version_immutable: publish a new version instead of changing %',
      old.version using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists contract_version_immutable on contract_versions;
create trigger contract_version_immutable
  before update or delete on contract_versions
  for each row execute function contract_version_immutable();

-- The version a worker signs today: the latest one already published.
create or replace function public.current_contract_version(p_at timestamptz default now())
returns text
language sql
stable
set search_path = public, extensions
as $$
  select version from contract_versions
   where published_at <= p_at
   order by published_at desc, version desc
   limit 1
$$;

-- ---------------------------------------------------------------------
-- 4 · compliance_docs: what the worker uploaded, as they named it
-- ---------------------------------------------------------------------
alter table compliance_docs add column if not exists file_name text;
alter table compliance_docs add column if not exists file_size int
  check (file_size is null or file_size between 1 and 10485760);
alter table compliance_docs add column if not exists mime_type text;

-- ---------------------------------------------------------------------
-- 5 · quiz_attempts and hmrc_checklists keep the previous period
-- ---------------------------------------------------------------------
alter table quiz_attempts add column if not exists superseded boolean not null default false;

do $$
declare v_name text;
begin
  select c.conname into v_name
    from pg_constraint c
   where c.conrelid = 'public.quiz_attempts'::regclass
     and c.contype = 'u'
     and c.conkey = array[
       (select attnum from pg_attribute where attrelid = 'public.quiz_attempts'::regclass and attname = 'staff_id'),
       (select attnum from pg_attribute where attrelid = 'public.quiz_attempts'::regclass and attname = 'attempt_no')
     ]::int2[];
  if v_name is not null then
    execute format('alter table quiz_attempts drop constraint %I', v_name);
  end if;
end $$;

create unique index if not exists quiz_attempts_current_attempt
  on quiz_attempts (staff_id, attempt_no) where not superseded;

alter table hmrc_checklists add column if not exists id uuid not null default gen_random_uuid();

do $$
declare v_pk text;
begin
  select c.conname into v_pk
    from pg_constraint c
   where c.conrelid = 'public.hmrc_checklists'::regclass and c.contype = 'p';
  if v_pk is not null and v_pk <> 'hmrc_checklists_id_pkey' then
    execute format('alter table hmrc_checklists drop constraint %I', v_pk);
    alter table hmrc_checklists add constraint hmrc_checklists_id_pkey primary key (id);
  end if;
end $$;

-- One CURRENT checklist per worker; superseded ones are the record of
-- earlier periods (§2.12 point 3). Also the index covering the FK.
create unique index if not exists hmrc_checklists_current
  on hmrc_checklists (staff_id) where not superseded;
create index if not exists hmrc_checklists_staff_id_idx on hmrc_checklists (staff_id);

-- ---------------------------------------------------------------------
-- 6 · Reset to candidate and GDPR removal reach the new state
--
-- A trigger rather than an edit to reset_to_candidate() or
-- remove_worker(): both belong to other domains, both are already
-- covered by their own tests, and this has to hold for every path that
-- moves a worker back to the start — not only the one that exists today.
-- ---------------------------------------------------------------------
create or replace function public.onboarding_on_staff_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  -- §2.12: back to interview_requested = the full wizard again. The step
  -- stamps go; the quiz attempts are kept, read-only, as the record of the
  -- previous period and stop counting towards the three.
  if new.status = 'interview_requested' and old.status is distinct from 'interview_requested' then
    delete from onboarding_progress where staff_id = new.id;
    update quiz_attempts set superseded = true where staff_id = new.id and not superseded;
  end if;

  -- §1.7: visa type and typed expiry are personal data.
  if new.removed_at is not null and old.removed_at is null then
    delete from onboarding_progress where staff_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists onboarding_on_staff_change on staff;
create trigger onboarding_on_staff_change
  after update of status, removed_at on staff
  for each row execute function onboarding_on_staff_change();

-- ---------------------------------------------------------------------
-- 7 · Rules shared with packages/domain (onboarding.sql.test.ts holds
--     the literals to the TypeScript)
-- ---------------------------------------------------------------------
create or replace function public.normalise_share_code(p text)
returns text
language sql
immutable
set search_path = public, extensions
as $$ select upper(regexp_replace(coalesce(p, ''), '\s', '', 'g')) $$;

-- §2.5 (corrected 31.07.2026): 9 alphanumerics starting with W.
create or replace function public.is_valid_share_code(p text)
returns boolean
language sql
immutable
set search_path = public, extensions
as $$ select normalise_share_code(p) ~ '^W[A-Z0-9]{8}$' $$;

-- The documents a branch asks for, one row per requirement; any ONE of
-- `accepts` satisfies it. packages/domain `requiredDocuments()`.
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
    ('visa_document',     array['visa_document']::doc_type[],
       p_branch = 'work_visa'),
    ('university_term_dates_letter', array['university_term_dates_letter']::doc_type[],
       p_branch = 'international_student'),
    ('status_document',   array['status_document']::doc_type[],
       p_branch = 'dependant_other')
  ) r(req_key, accepts, applies)
  where r.applies
$$;

create or replace function public.onboarding_accepted_docs(p_branch rtw_branch, p_uk_choice text)
returns doc_type[]
language sql
immutable
set search_path = public, extensions
as $$
  select coalesce(array_agg(distinct t), '{}')
    from onboarding_required_docs(p_branch, p_uk_choice) r, unnest(r.accepts) t
$$;

create or replace function public.onboarding_uk_today()
returns date
language sql
stable
set search_path = public, extensions
as $$ select (now() at time zone 'Europe/London')::date $$;

-- The caller's staff row, locked, or a refusal. Every step RPC starts here.
create or replace function public.onboarding_me()
returns staff
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  s staff;
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select * into s from staff where id = v_id for update;
  return s;
end $$;

-- ---------------------------------------------------------------------
-- 8 · onboarding_state() — everything the eleven screens read, in one
--     round trip, for the caller only.
--
-- NOT returned, deliberately:
--   · the HMRC statement letter — "the worker never sees the resulting
--     letter" (§2.8); the worker's own three answers are returned so the
--     step can be shown again, never what they derive to;
--   · block_reason (§10.1), as staff_me();
--   · the declaration's details — the worker wrote them and the office
--     reads them; the app has no screen that shows them back;
--   · the quiz answer key, and which questions an attempt got wrong.
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
           'fileSize',          d.file_size,
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
    'rtwBranch',      s.rtw_branch::text,
    'shareCode',      s.share_code,
    'wtrOptOut',      s.wtr_optout,
    'homeAddress',    s.home_address,
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
  'The §10.3 wizard''s whole read, for the caller. Never returns the HMRC statement letter (§2.8), block_reason (§10.1), the declaration details or the quiz key.';

-- ---------------------------------------------------------------------
-- 9 · Step 1 — Right to work (§2.5)
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
  v_expiry date;
  v_dropped int := 0;
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
         share_code = v_code,
         wtr_optout = coalesce(p_wtr_optout, false)
   where id = s.id;

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
                            'shareCode', v_code, 'uploadsDropped', v_dropped);
end $$;

-- ---------------------------------------------------------------------
-- 10 · Step 2 — Home address, a pin on the map (§10.3 2/11)
--
-- The pin drives proximity in §6 scoring and Radar distances, so it is
-- the thing this step exists for; the typed lines are what the office and
-- payroll read. No E7: that is for a CHANGE after joining (§10.1), and
-- the profile screen already sends it.
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

  update staff
     set home_address = v_addr,
         home_location = st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography
   where id = s.id;
  update onboarding_progress set address_at = now(), updated_at = now() where staff_id = s.id;

  return jsonb_build_object('ok', true, 'homeAddress', v_addr);
end $$;

-- ---------------------------------------------------------------------
-- 11 · Step 3 — Profile selfie (§10.3 3/11, §10.1)
--
-- The photo itself is written by staff_set_photo() (20260922180000),
-- which already refuses a second one: "set once during onboarding and
-- then locked". This records that the step was done, which a returning
-- worker (§2.12) does by confirming the photo they already have.
-- ---------------------------------------------------------------------
create or replace function public.onboarding_confirm_selfie()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s staff := onboarding_me();
  p onboarding_progress;
begin
  if s.status <> 'documents' then
    raise exception 'wrong_stage' using errcode = 'P0001';
  end if;
  select * into p from onboarding_progress where staff_id = s.id;
  if p.address_at is null then
    raise exception 'previous_step' using errcode = 'P0001';
  end if;
  if s.photo_path is null then
    raise exception 'photo_required' using errcode = 'P0001';
  end if;
  update onboarding_progress set selfie_at = coalesce(selfie_at, now()), updated_at = now()
   where staff_id = s.id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 12 · Step 4 — one upload (§2.5 pt 7)
--
-- The file is already in the private `documents` bucket: the Staff App's
-- server action puts it there with the service key after checking the
-- session, because that bucket carries no worker policy
-- (20260922183015). This records it, as the WORKER — so the path prefix,
-- the type, the size and the stage are all checked against the caller,
-- not against what the server action says.
--
-- Before "Submit documents", a new file for a requirement replaces the
-- pending one (it never reached the office as part of a set). After it,
-- only a REJECTED requirement can take a new file — "They upload a new
-- one and the document returns to review" (§2.3) — and the rejected row
-- stays, as history.
-- ---------------------------------------------------------------------
create or replace function public.onboarding_attach_document(
  p_doc_type  text,
  p_path      text,
  p_file_name text,
  p_file_size int,
  p_mime      text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s staff := onboarding_me();
  p onboarding_progress;
  v_type doc_type;
  v_req doc_type[];
  v_current review_status;
  v_expiry date;
  v_id uuid;
begin
  if s.status <> 'documents' then
    raise exception 'wrong_stage' using errcode = 'P0001';
  end if;
  select * into p from onboarding_progress where staff_id = s.id;
  if p.rtw_at is null or s.rtw_branch is null then
    raise exception 'previous_step' using errcode = 'P0001';
  end if;

  begin
    v_type := p_doc_type::doc_type;
  exception when invalid_text_representation then
    raise exception 'doc_not_for_branch' using errcode = 'P0001';
  end;

  select r.accepts into v_req
    from onboarding_required_docs(s.rtw_branch, p.uk_doc_choice) r
   where v_type = any (r.accepts)
   limit 1;
  if v_req is null then
    -- §2.5 pt 8: exactly the branch's set, nothing further.
    raise exception 'doc_not_for_branch' using errcode = 'P0001';
  end if;

  if p_path is null or p_path not like s.id::text || '/%' then
    raise exception 'wrong_path' using errcode = 'P0001';
  end if;
  if p_file_size is null or p_file_size < 1 then
    raise exception 'file_empty' using errcode = 'P0001';
  end if;
  if p_file_size > 10485760 then
    raise exception 'file_too_large' using errcode = 'P0001';
  end if;
  if coalesce(lower(p_mime), '') not in
     ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif') then
    raise exception 'file_type' using errcode = 'P0001';
  end if;

  -- Where this requirement stands now: the latest current row of any type
  -- that satisfies it.
  select c.status into v_current
    from current_compliance_docs(s.id) c
    join compliance_docs d on d.id = c.doc_id
   where c.doc_type = any (v_req)
   order by d.uploaded_at desc
   limit 1;

  if p.documents_at is null then
    if v_current = 'verified' then
      raise exception 'already_verified' using errcode = 'P0001';
    end if;
    update compliance_docs set review_status = 'superseded'
     where staff_id = s.id and doc_type = any (v_req) and review_status = 'pending';
  else
    if v_current is distinct from 'rejected' then
      raise exception 'not_rejected' using errcode = 'P0001';
    end if;
    -- A rejected passport answered with a national ID (EU branch): the
    -- passport row must stop counting, or its rejection blocks for ever.
    update compliance_docs set review_status = 'superseded'
     where staff_id = s.id and doc_type = any (v_req) and doc_type <> v_type
       and review_status in ('pending', 'rejected');
  end if;

  -- Pre-filled expiries. The term letter's is §4.2's 31 December however
  -- the letter reads (doc_expires_on, ADR-0011); a visa or status
  -- document starts from what the worker typed on step 1, for the AI and
  -- then the office to confirm.
  v_expiry := case
    when v_type = 'university_term_dates_letter'
      then doc_expires_on(v_type, null, null, null, now())
    when v_type in ('visa_document', 'status_document') then p.visa_expiry
    else null
  end;

  -- clock_timestamp(), not now(): "the latest upload" is how
  -- current_compliance_docs() tells a re-upload from the row it replaces,
  -- and two statements in one transaction share now().
  insert into compliance_docs (staff_id, doc_type, file_path, file_name, file_size, mime_type,
                               expiry_date, needs_manual_review, review_status, uploaded_at)
  values (s.id, v_type, p_path, left(coalesce(nullif(btrim(p_file_name), ''), 'upload'), 200),
          p_file_size, lower(p_mime), v_expiry, true, 'pending', clock_timestamp())
  returning id into v_id;

  return jsonb_build_object('ok', true, 'docId', v_id, 'docType', v_type::text,
                            'expiryDate', v_expiry);
end $$;

-- ---------------------------------------------------------------------
-- 13 · The AI extraction seam (§2.6) — service role only
--
-- Called by the extractor after an upload, never by a worker. Pre-fills;
-- does not verify. A term letter keeps its 31 December expiry whatever
-- the AI read (§4.2); the holiday ranges it read are pre-filled for the
-- manager, who may add a period the AI missed (§2.3 "+ Add period").
-- ---------------------------------------------------------------------
insert into settings (key, value) values ('ai_confidence_threshold', '0.8')
on conflict (key) do nothing;

create or replace function public.record_document_extraction(
  p_doc          uuid,
  p_expiry       date,
  p_term_dates   daterange[],
  p_completion   date,
  p_institution  text,
  p_confidence   numeric,
  p_raw          jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  d compliance_docs;
  v_threshold numeric;
  v_manual boolean;
begin
  select * into d from compliance_docs where id = p_doc for update;
  if d.id is null then
    raise exception 'unknown_document' using errcode = 'P0001';
  end if;
  if d.review_status <> 'pending' then
    -- A manager has already decided. The AI never overwrites a human.
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;
  if p_confidence is not null and (p_confidence < 0 or p_confidence > 1) then
    raise exception 'bad_confidence' using errcode = 'P0001';
  end if;

  select (value #>> '{}')::numeric into v_threshold
    from settings where key = 'ai_confidence_threshold';
  v_manual := p_confidence is null or p_confidence < coalesce(v_threshold, 0.8);

  update compliance_docs
     set expiry_date = case
                         when doc_type in ('university_term_dates_letter', 'share_code_report')
                           then expiry_date
                         else coalesce(p_expiry, expiry_date)
                       end,
         term_dates = case when doc_type = 'university_term_dates_letter'
                           then p_term_dates else term_dates end,
         completion_date = case when doc_type = 'university_completion_letter'
                                then p_completion else completion_date end,
         awarding_institution = case when doc_type = 'university_completion_letter'
                                     then nullif(btrim(p_institution), '') else awarding_institution end,
         ai_extracted = p_raw,
         ai_confidence = p_confidence,
         needs_manual_review = v_manual
   where id = p_doc;

  return jsonb_build_object('ok', true, 'needsManualReview', v_manual);
end $$;

-- ---------------------------------------------------------------------
-- 14 · The automatic move to the quiz (§2.3, §2.9)
--
-- "As soon as ALL documents — including the Criminal Record declaration
-- — are verified, the candidate advances to the 'Quiz' stage by
-- themselves." Called on submit and from the two triggers below, so it
-- holds whichever screen or import does the verifying.
--
-- compliance_blockers() is necessary and not sufficient: it lets a
-- REJECTED Yes declaration through (a manager's decision, carried by a
-- manual block for a working member of staff — 20260921192246), and a
-- candidate whose declaration was rejected must not walk into the quiz.
-- ---------------------------------------------------------------------
create or replace function public.onboarding_advance_to_quiz(p_staff uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s staff;
  p onboarding_progress;
begin
  select * into s from staff where id = p_staff for update;
  if s.id is null or s.status <> 'documents' then
    return false;
  end if;
  select * into p from onboarding_progress where staff_id = p_staff;
  if p.documents_at is null or s.rtw_branch is null then
    return false;
  end if;

  -- Every requirement of the branch satisfied by a VERIFIED current row.
  if exists (
    select 1 from onboarding_required_docs(s.rtw_branch, p.uk_doc_choice) r
     where not exists (
       select 1 from current_compliance_docs(p_staff) c
        where c.doc_type = any (r.accepts) and c.status = 'verified'))
  then
    return false;
  end if;

  -- The share-code check, in every branch that has one.
  if s.rtw_branch <> 'uk_irish' and not exists (
       select 1 from current_compliance_docs(p_staff) c
        where c.doc_type = 'share_code_report' and c.status = 'verified') then
    return false;
  end if;

  -- The declaration: No is verified on submission, Yes needs a manager.
  if not exists (
       select 1 from (
         select c.review_status from criminal_declarations c
          where c.staff_id = p_staff and not c.superseded
          order by c.declared_at desc, c.id desc limit 1) c
        where c.review_status = 'verified') then
    return false;
  end if;

  -- Nothing else outstanding, nothing already expired.
  if exists (select 1 from compliance_blockers(p_staff, onboarding_uk_today())) then
    return false;
  end if;

  perform assert_staff_transition(s.status, 'quiz'::staff_status);
  update staff set status = 'quiz' where id = p_staff;
  return true;
end $$;

create or replace function public.onboarding_doc_verified()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.review_status = 'verified' and old.review_status is distinct from 'verified' then
    perform onboarding_advance_to_quiz(new.staff_id);
  end if;
  return new;
end $$;

drop trigger if exists onboarding_doc_verified on compliance_docs;
create trigger onboarding_doc_verified
  after update of review_status on compliance_docs
  for each row execute function onboarding_doc_verified();

drop trigger if exists onboarding_declaration_verified on criminal_declarations;
create trigger onboarding_declaration_verified
  after update of review_status on criminal_declarations
  for each row execute function onboarding_doc_verified();

-- ---------------------------------------------------------------------
-- 15 · Step 4 — Submit documents, with the declaration (§2.10, §10.3)
-- ---------------------------------------------------------------------
create or replace function public.onboarding_submit_documents(
  p_has_conviction  boolean,
  p_details         text,
  p_conviction_date date
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s staff := onboarding_me();
  p onboarding_progress;
  v_missing text;
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_advanced boolean;
begin
  if s.status <> 'documents' then
    raise exception 'wrong_stage' using errcode = 'P0001';
  end if;
  select * into p from onboarding_progress where staff_id = s.id;
  if p.rtw_at is null or p.address_at is null or p.selfie_at is null then
    raise exception 'previous_step' using errcode = 'P0001';
  end if;
  if p.documents_at is not null then
    raise exception 'already_submitted' using errcode = 'P0001';
  end if;

  select r.req_key into v_missing
    from onboarding_required_docs(s.rtw_branch, p.uk_doc_choice) r
   where not exists (
     select 1 from current_compliance_docs(s.id) c
      where c.doc_type = any (r.accepts) and c.status in ('pending', 'verified'))
   limit 1;
  if v_missing is not null then
    raise exception 'missing_document:%', v_missing using errcode = 'P0001';
  end if;

  if p_has_conviction is null then
    raise exception 'declaration_required' using errcode = 'P0001';
  end if;
  if p_has_conviction and v_details is null then
    raise exception 'details_required' using errcode = 'P0001';
  end if;
  if p_conviction_date is not null and p_conviction_date > onboarding_uk_today() then
    raise exception 'bad_conviction_date' using errcode = 'P0001';
  end if;

  -- The share code goes to gov.uk with the DOB (§2.6, ADR-0002). The row
  -- is the check's place in the office's queue until it is run.
  if s.rtw_branch <> 'uk_irish' then
    update compliance_docs set review_status = 'superseded'
     where staff_id = s.id and doc_type = 'share_code_report' and review_status = 'pending';
    insert into compliance_docs (staff_id, doc_type, share_code, needs_manual_review, review_status,
                                 uploaded_at)
    values (s.id, 'share_code_report', s.share_code, true, 'pending', clock_timestamp());
  end if;

  -- §2.10: No is auto-verified the moment it is submitted and never enters
  -- the review queue; Yes is reviewed like a document.
  insert into criminal_declarations (staff_id, source, answer, details, conviction_date,
                                     review_status, reviewed_at, review_note)
  values (s.id, 'onboarding', p_has_conviction,
          case when p_has_conviction then v_details end,
          case when p_has_conviction then p_conviction_date end,
          case when p_has_conviction then 'pending'::review_status else 'verified'::review_status end,
          case when p_has_conviction then null else now() end,
          case when p_has_conviction then null
               else 'Answered No — verified automatically on submission (§2.10)' end);

  update onboarding_progress set documents_at = now(), updated_at = now() where staff_id = s.id;

  -- Nothing else is verified yet in the ordinary case, but an office that
  -- verified the uploads before the worker pressed Submit should not
  -- leave them waiting for a trigger that will never fire.
  v_advanced := onboarding_advance_to_quiz(s.id);

  return jsonb_build_object('ok', true, 'advanced', v_advanced,
                            'declarationStatus',
                            case when p_has_conviction then 'pending' else 'verified' end);
end $$;

-- ---------------------------------------------------------------------
-- Grants
--
-- Worker RPCs: authenticated only, each resolving its own caller.
-- Internal helpers and trigger functions: nobody but the owner and the
-- service role. record_document_extraction: service role only — the
-- extractor runs server-side with the service key (§2.6).
-- ---------------------------------------------------------------------
revoke execute on function public.onboarding_state()                                     from public, anon;
revoke execute on function public.onboarding_save_right_to_work(text, date, text, text, date, text, boolean) from public, anon;
revoke execute on function public.onboarding_save_address(text, text, text, double precision, double precision) from public, anon;
revoke execute on function public.onboarding_confirm_selfie()                            from public, anon;
revoke execute on function public.onboarding_attach_document(text, text, text, int, text) from public, anon;
revoke execute on function public.onboarding_submit_documents(boolean, text, date)       from public, anon;

grant execute on function public.onboarding_state()                                     to authenticated;
grant execute on function public.onboarding_save_right_to_work(text, date, text, text, date, text, boolean) to authenticated;
grant execute on function public.onboarding_save_address(text, text, text, double precision, double precision) to authenticated;
grant execute on function public.onboarding_confirm_selfie()                            to authenticated;
grant execute on function public.onboarding_attach_document(text, text, text, int, text) to authenticated;
grant execute on function public.onboarding_submit_documents(boolean, text, date)       to authenticated;

revoke execute on function public.onboarding_me()                     from public, anon, authenticated;
revoke execute on function public.onboarding_advance_to_quiz(uuid)    from public, anon, authenticated;
revoke execute on function public.onboarding_doc_verified()           from public, anon, authenticated;
revoke execute on function public.onboarding_on_staff_change()        from public, anon, authenticated;
revoke execute on function public.record_document_extraction(uuid, date, daterange[], date, text, numeric, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_document_extraction(uuid, date, daterange[], date, text, numeric, jsonb)
  to service_role;
grant execute on function public.onboarding_advance_to_quiz(uuid) to service_role;
