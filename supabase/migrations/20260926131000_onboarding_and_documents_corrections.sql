-- =====================================================================
-- Migration 20260926131000 · five corrections on the worker's own
--                            writes (§2.6, §2.10, §8 E6/N15, §10.4,
--                            §10.7, §4.3; security brief Invariant 4)
--
-- 1 · A write is the worker's own, never "on behalf of". staff_caller()
--     lets an admin name another worker — justified in 20260922140000
--     for READS ("Admin may look at a worker's screens, for support").
--     Three writes reused it: apply_to_shift() (an admin could lodge a
--     Radar application in any worker's name, recorded as source 'self'),
--     submit_document_upload() and submit_completion_letter() (an admin
--     could file evidence under a worker's name, audited 'staff_app', or
--     queue CL3 attributing an upload to them). The office's routes onto
--     a shift are invite_worker() and accept_application(); the office
--     has no route to upload a worker's evidence for them. staff_writer()
--     resolves the SUBJECT of a write: the caller's own row, or p_staff
--     only for the service role. wtr_optout_subject() set the shape.
--
-- 2 · E6 "A worker who joined without an NI number has now entered one"
--     went to gisela@ and payroll for EVERY candidate who typed one at
--     wizard step 7/11, because submit_hmrc_checklist() routed the first
--     NI through staff_set_ni_number(), which queues E6 unconditionally.
--     §2.10 / §8: E6 is for an NI entered LATER, after joining without
--     one. The wizard now writes the number itself (same regex, same
--     lock); the Profile-details route (staff_set_ni_number) keeps E6.
--
-- 3 · Referee 1 / Referee 2 came back in name order. staff_references
--     had no position, and onboarding_state() ordered by name, so on
--     re-opening step 8 the person entered as Referee 2 could sit under
--     the Referee 1 pill. `seq` (an identity) records insertion order,
--     and the state orders by it.
--
-- 4 · N15 "your shifts are open again" was queued only when the
--     conviction review's own re-check passed at Verify. When it failed
--     then (another document had expired meanwhile — §4.3's own example)
--     the block was lifted later by compliance_docs_verified() with no
--     push at all. The trigger now queues N15, keyed on the verified
--     in-employment declaration, when the block it lifts was a
--     conviction review.
--
-- Bodies are restated from their latest definitions: apply_to_shift and
-- staff_caller (20260922140000), submit_document_upload
-- (20260923192000), submit_completion_letter (20260923100100),
-- submit_hmrc_checklist (20260923120200), onboarding_state
-- (20260926100300), compliance_docs_verified (20260921170411).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · Whose row a WRITE lands on
-- ---------------------------------------------------------------------
create or replace function public.staff_writer(p_staff uuid default null)
returns uuid
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare v_self uuid;
begin
  select id into v_self from staff where user_id = auth.uid();
  if p_staff is null or p_staff = v_self then
    return v_self;
  end if;
  -- Only the platform itself (a job, an Edge Function) may act for a
  -- named worker; an admin session may look (staff_caller) but not act.
  if coalesce(auth.role(), '') = 'service_role' then
    return p_staff;
  end if;
  raise exception 'not_your_worker' using errcode = '42501';
end $$;

comment on function public.staff_writer(uuid) is
  'The subject of a worker-initiated WRITE: the caller''s own staff row, or p_staff for the service role only. An admin may read a worker''s screens through staff_caller() but never act as them (Invariant 4).';

revoke execute on function public.staff_writer(uuid) from public, anon, authenticated;

create or replace function apply_to_shift(p_shift uuid, p_staff uuid default null)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_me     uuid := staff_writer(p_staff);
  sr       shift_requirements;
  ev       events;
  v_gate   text;
  v_fill   record;
  v_id     uuid;
  v_status text;
begin
  if v_me is null then
    raise exception 'not_a_worker' using errcode = '42501';
  end if;
  select * into sr from shift_requirements where id = p_shift for update;
  if sr.id is null then raise exception 'shift_not_found' using errcode = 'P0002'; end if;
  select * into ev from events where id = sr.event_id;
  if ev.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'event_cancelled');
  end if;
  if now() >= sr.starts_at then
    return jsonb_build_object('ok', false, 'reason', 'shift_started');
  end if;

  select gate into v_gate from auto_assign_candidates(p_shift) where staff_id = v_me;
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'reason', v_gate);
  end if;

  -- The live re-check. Seats, not the invitation target.
  select * into v_fill from shift_fill(p_shift);
  if v_fill.confirmed >= sr.headcount then
    return jsonb_build_object('ok', false, 'reason', 'full');
  end if;

  -- A LIVE booking blocks a second one. A `closed` row does not: that is a
  -- declined invitation, a withdrawn application, or a slot that went to
  -- somebody else, and §10.4 tells the worker in as many words that they
  -- can come back to it — "You can still apply for this shift on Radar
  -- later if it's open". The row survives only because (shift_id, staff_id)
  -- is unique, so it is REVIVED rather than a second one inserted.
  --
  -- `cancelled` is deliberately not in that set. RULE-04's self-cancel and
  -- the office's withdraw both land there, and neither is an invitation to
  -- try again; the self_cancelled gate in auto_assign_candidates catches
  -- the first of those before this line anyway.
  select id, status::text into v_id, v_status
    from bookings where shift_id = p_shift and staff_id = v_me;
  if v_id is not null and v_status <> 'closed' then
    return jsonb_build_object('ok', false, 'reason', 'already_has_booking');
  end if;

  if v_id is not null then
    update bookings
       set status = 'applied', source = 'self', applied_at = now(),
           cancelled_at = null, cancel_cause = null
     where id = v_id;
  else
    insert into bookings (shift_id, staff_id, status, source, applied_at)
    values (p_shift, v_me, 'applied', 'self', now())
    returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'bookingId', v_id);
end $$;

comment on function apply_to_shift(uuid, uuid) is
  '§10.4 Radar self-application. The caller''s OWN row (staff_writer): an admin cannot apply in a worker''s name — the office invites (§3.4) or accepts an application (ADR-0023). Full is measured against headcount; every refusal is a reason, never an exception.';

create or replace function public.submit_document_upload(
  p_doc_type   text,
  p_file_path  text default null,
  p_share_code text default null,
  p_staff      uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_me     uuid := staff_writer(p_staff);
  s        staff;
  v_type   doc_type;
  v_folder text;
  v_code   text;
  v_check  record;
  v_mime   text;
  v_size   bigint;
  v_doc    uuid;
begin
  if v_me is null then
    raise exception 'not_a_worker' using errcode = '42501';
  end if;
  select * into s from staff where id = v_me for update;
  if s.removed_at is not null
     or s.status not in ('compliant', 'blocked')
     or (s.status = 'blocked' and s.block_kind = 'manual') then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible');
  end if;

  if p_doc_type is null
     or not exists (select 1 from unnest(enum_range(null::doc_type)) t where t::text = p_doc_type) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_doc_type');
  end if;
  v_type := p_doc_type::doc_type;

  -- The completion letter has its own RPC, because the requirement makes
  -- the worker state its form and course completion date (§2.1).
  if v_type = 'university_completion_letter' then
    return jsonb_build_object('ok', false, 'reason', 'use_completion_letter');
  end if;

  if not exists (select 1 from current_compliance_docs(v_me) c where c.doc_type = v_type)
     and not (v_type::text = any(coalesce(onboarding_documents_missing(v_me), '{}'::text[])))
     and not (v_type = 'share_code_report'
              and s.rtw_branch is not null and s.rtw_branch <> 'uk_irish') then
    return jsonb_build_object('ok', false, 'reason', 'not_required');
  end if;

  if exists (select 1 from compliance_docs d
              where d.staff_id = v_me and d.doc_type = v_type and d.review_status = 'pending') then
    return jsonb_build_object('ok', false, 'reason', 'already_pending');
  end if;

  if v_type = 'share_code_report' then
    -- A share code is typed (§2.5): nine letters and digits starting with
    -- W, shown by gov.uk in threes — the wizard's is_valid_share_code(). The office fetches the report against it; a file
    -- is optional here.
    v_code := normalise_share_code(p_share_code);
    if not is_valid_share_code(v_code) then
      return jsonb_build_object('ok', false, 'reason', 'share_code_invalid');
    end if;
  elsif p_file_path is null then
    return jsonb_build_object('ok', false, 'reason', 'file_required');
  end if;

  if p_file_path is not null then
    v_folder := replace(v_type::text, '_', '-');
    select * into v_check from evidence_upload_problem(v_me, v_folder, p_file_path);
    if v_check.problem is not null then
      return jsonb_build_object('ok', false, 'reason', v_check.problem);
    end if;
    v_mime := v_check.mime;
    v_size := v_check.size_bytes;
    -- One object, one row. A replayed path would put the same scan in
    -- front of the office twice under two ids.
    if exists (select 1 from compliance_docs d where d.file_path = p_file_path) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_path');
    end if;
  end if;

  insert into compliance_docs (staff_id, doc_type, file_path, review_status,
                               share_code, mime_type, size_bytes)
  values (v_me, v_type, p_file_path, 'pending',
          v_code, v_mime, v_size)
  returning id into v_doc;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'document.uploaded', 'compliance_docs', v_doc,
          jsonb_strip_nulls(jsonb_build_object(
            'staffId',  v_me,
            'docType',  v_type::text,
            'filePath', p_file_path,
            'source',   'staff_app')));

  return jsonb_build_object('ok', true, 'documentId', v_doc::text, 'status', 'pending');
end $$;

comment on function public.submit_document_upload(text, text, text, uuid) is
  '§10.4 Documents hub re-upload / §2.6: the worker''s OWN evidence (staff_writer — an admin cannot file evidence in a worker''s name). Lands pending; the share code is validated by the wizard''s one rule.';

create or replace function public.submit_completion_letter(
  p_file_path            text,
  p_completion_date      date,
  p_evidence_form        text,
  p_awarding_institution text default null,
  p_staff                uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_me    uuid := staff_writer(p_staff);
  s       staff;
  v_check record;
  v_doc   uuid;
  v_today date := (now() at time zone 'Europe/London')::date;
begin
  if v_me is null then
    raise exception 'not_a_worker' using errcode = '42501';
  end if;
  select * into s from staff where id = v_me for update;
  if s.status in ('rejected', 'removed', 'inactive') or s.removed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible');
  end if;
  -- §2.1: "Any worker whose visa type is Student / Tier 4".
  if s.rtw_branch is distinct from 'international_student' then
    return jsonb_build_object('ok', false, 'reason', 'not_student_visa');
  end if;
  if p_evidence_form is null
     or p_evidence_form not in ('letter', 'transcript', 'university_email') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_form');
  end if;
  -- §2.1: "the worker must enter … the course completion date stated on
  -- the document". A date in the future is allowed — a letter issued
  -- before the final exam (§7) — and simply lifts nothing until it passes.
  if p_completion_date is null then
    return jsonb_build_object('ok', false, 'reason', 'completion_date_required');
  end if;
  if p_completion_date < date '2000-01-01' or p_completion_date > v_today + interval '5 years' then
    return jsonb_build_object('ok', false, 'reason', 'completion_date_implausible');
  end if;

  select * into v_check from evidence_upload_problem(v_me, 'completion-letter', p_file_path);
  if v_check.problem is not null then
    return jsonb_build_object('ok', false, 'reason', v_check.problem);
  end if;

  if exists (select 1 from compliance_docs d
              where d.staff_id = v_me
                and d.doc_type = 'university_completion_letter'
                and d.review_status = 'pending') then
    return jsonb_build_object('ok', false, 'reason', 'already_pending');
  end if;

  insert into compliance_docs (staff_id, doc_type, file_path, review_status,
                               evidence_form, completion_date_claimed,
                               awarding_institution, mime_type, size_bytes)
  values (v_me, 'university_completion_letter', p_file_path, 'pending',
          p_evidence_form, p_completion_date,
          nullif(trim(coalesce(p_awarding_institution, '')), ''),
          v_check.mime, v_check.size_bytes)
  returning id into v_doc;

  -- §5 · worker: upload received. admin: awaiting review.
  insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
  values ('CL1:doc:' || v_doc, 'push', 'CL1', v_me,
          jsonb_build_object('documentId', v_doc::text))
  on conflict (key) do nothing;

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values ('CL3:doc:' || v_doc, 'email', 'CL3',
          array['admin@thehospitalitycompany.co.uk'],
          jsonb_build_object(
            'name',           s.first_name || ' ' || s.last_name,
            'employeeId',     coalesce(s.employee_id::text, '(not yet issued)'),
            'uploadedAt',     to_char(now() at time zone 'Europe/London', 'DD Mon YYYY HH24:MI'),
            'form',           case p_evidence_form
                                when 'letter' then 'Official university completion letter'
                                when 'transcript' then 'Final / completers transcript'
                                else 'Official university email' end,
            'completionDate', to_char(p_completion_date, 'DD Mon YYYY')))
  on conflict (key) do nothing;

  return jsonb_build_object('ok', true, 'documentId', v_doc::text, 'status', 'pending');
end $$;

comment on function public.submit_completion_letter(text, date, text, text, uuid) is
  'Completion letter requirement §2.1, the worker''s OWN upload (staff_writer). Student visa only; one of three forms; the completion date the worker read off it; the file checked against Storage (PDF/JPG/PNG, ≤10 MB, under <staff_id>/completion-letter/). Lands pending, queues CL1 and CL3, and changes NO cap (acceptance criterion 2).';

-- ---------------------------------------------------------------------
-- 2 · The wizard writes the NI number itself; E6 is the profile's
-- ---------------------------------------------------------------------
create or replace function public.submit_hmrc_checklist(
  p_q1_other_job   boolean,
  p_q2_pension     boolean,
  p_q3_since_april boolean,
  p_student_loan   text,
  p_postgraduate   boolean,
  p_ni_number      text,
  p_declared       boolean
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s staff := onboarding_me();
  v_q2 boolean;
  v_q3 boolean;
  v_statement hmrc_statement;
  v_loan student_loan_plan;
  v_ni text := upper(regexp_replace(coalesce(p_ni_number, ''), '\s', '', 'g'));
  v_masked text;
begin
  perform onboarding_assert_contract_stage(s);

  if p_q1_other_job is null then
    raise exception 'answer_required' using errcode = 'P0001';
  end if;
  -- Q2 only if Q1 = No; Q3 only if Q1 = No and Q2 = No. A hidden answer
  -- is stored as null, never as whatever the form last held.
  v_q2 := case when not p_q1_other_job then p_q2_pension end;
  v_q3 := case when not p_q1_other_job and v_q2 is false then p_q3_since_april end;
  v_statement := hmrc_statement_for(p_q1_other_job, v_q2, v_q3);
  if v_statement is null then
    raise exception 'answer_required' using errcode = 'P0001';
  end if;

  begin
    v_loan := coalesce(p_student_loan, '')::student_loan_plan;
  exception when invalid_text_representation then
    raise exception 'bad_student_loan' using errcode = 'P0001';
  end;

  if p_declared is not true then
    raise exception 'declaration_required' using errcode = 'P0001';
  end if;

  -- NI: optional, and once on file it is locked (§2.8). The same regex
  -- and lock as staff_set_ni_number(), WITHOUT its E6: E6 is for a number
  -- entered on the profile after joining without one (§2.10, §8), not for
  -- a candidate who simply has one.
  if v_ni <> '' then
    if s.ni_number is null then
      if v_ni !~ '^[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z][0-9]{6}[A-D]$' then
        raise exception 'invalid_ni' using errcode = 'P0001';
      end if;
      update staff set ni_number = v_ni where id = s.id;
      v_masked := repeat('●', greatest(length(v_ni) - 2, 0)) || right(v_ni, 2);
    elsif s.ni_number <> v_ni then
      raise exception 'ni_locked' using errcode = 'P0001';
    end if;
  end if;

  insert into hmrc_checklists (staff_id, q1_other_job, q2_pension, q3_since_6_april, statement,
                               student_loan, postgraduate_loan, declared, submitted_at)
  values (s.id, p_q1_other_job, v_q2, v_q3, v_statement, v_loan, coalesce(p_postgraduate, false),
          true, now())
  on conflict (staff_id) where not superseded do update
    set q1_other_job      = excluded.q1_other_job,
        q2_pension        = excluded.q2_pension,
        q3_since_6_april  = excluded.q3_since_6_april,
        statement         = excluded.statement,
        student_loan      = excluded.student_loan,
        postgraduate_loan = excluded.postgraduate_loan,
        declared          = excluded.declared,
        submitted_at      = excluded.submitted_at;

  insert into onboarding_progress (staff_id, hmrc_at, updated_at)
  values (s.id, now(), now())
  on conflict (staff_id) do update set hmrc_at = excluded.hmrc_at, updated_at = excluded.updated_at;

  -- Deliberately NOT returned: the statement. "The worker never sees the
  -- resulting letter" (§2.8).
  return jsonb_build_object('ok', true,
    'niMasked', coalesce(v_masked,
                         case when s.ni_number is not null
                              then repeat('●', greatest(length(s.ni_number) - 2, 0)) || right(s.ni_number, 2) end));
end $$;

comment on function public.submit_hmrc_checklist(boolean, boolean, boolean, text, boolean, text, boolean) is
  '§2.8 HMRC New Starter Checklist for the caller. Derives A/B/C from the three questions and never returns it; NI set-once with the same rule as staff_set_ni_number() but WITHOUT E6 (that email is for a number entered later on the profile, §2.10); declaration mandatory.';

-- ---------------------------------------------------------------------
-- 3 · Referees keep the order they were entered in
-- ---------------------------------------------------------------------
alter table staff_references add column if not exists seq bigint generated by default as identity;

comment on column staff_references.seq is
  'Insertion order: Referee 1 is the lower seq (§2.10). onboarding_state() orders by it.';

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

  -- Referee 1, then Referee 2: the order they were entered in (§2.10).
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', r.name, 'relationship', r.relationship,
           'phone', r.phone, 'email', r.email) order by r.seq, r.name), '[]'::jsonb)
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

-- ---------------------------------------------------------------------
-- 4 · N15 when the conviction-review block is lifted LATER (§10.7, §4.3)
-- ---------------------------------------------------------------------
create or replace function public.compliance_docs_verified()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_kind block_kind;
  v_decl uuid;
begin
  if new.review_status = 'verified' and old.review_status is distinct from 'verified' then
    select block_kind into v_kind from staff where id = new.staff_id;
    if unblock_if_compliant(new.staff_id) and v_kind = 'conviction_review' then
      -- The accepted declaration whose re-check has only now passed:
      -- "your shifts are open again" was owed since Verify (§10.7).
      select c.id into v_decl
        from criminal_declarations c
       where c.staff_id = new.staff_id
         and c.source = 'in_employment'
         and c.review_status = 'verified'
         and not c.superseded
       order by c.reviewed_at desc nulls last, c.declared_at desc
       limit 1;
      if v_decl is not null then
        insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
        values ('N15:declaration:' || v_decl, 'push', 'N15', new.staff_id, '{}'::jsonb)
        on conflict (key) do nothing;
      end if;
    end if;
  end if;
  return new;
end $$;

comment on function public.compliance_docs_verified() is
  '§4.3 automatic unblock on a verified document, and — when the block being lifted was an accepted conviction review whose full re-check failed at Verify — the N15 that review still owes (§10.7).';

revoke execute on function public.compliance_docs_verified() from public, anon, authenticated;
