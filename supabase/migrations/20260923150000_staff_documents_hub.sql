-- =====================================================================
-- The Staff App's Documents tab (§10.4, §4.2–4.5) and the in-employment
-- conviction declaration (§10.7) — the worker's side of compliance.
--
-- What this adds
-- --------------
--   staff_documents()        one read for the whole tab: every document
--                            row with its effective expiry, the declaration
--                            history WITHOUT the details, what the branch
--                            still needs, the weekly cap and the opt-out.
--   submit_document_upload() the worker's upload for every document that
--                            is not the completion letter: a replacement
--                            for one that is expiring or expired, a
--                            re-upload after a rejection (§4.1 "N8 with
--                            Re-upload"), a new share code. Lands PENDING.
--   declare_my_conviction()  §10.7 for the worker themselves — the grant
--                            docs/14 O10 (5) left open, closed the way
--                            request_my_p45() closed it for §10.6.
--
-- The same pattern as submit_completion_letter() (20260923100100), on
-- purpose: the `documents` bucket stays service-role only (320_storage
-- asserts it), the Staff App's server code authorises the worker from
-- their session and issues the upload with the service key, and THIS
-- function — called as the worker — checks the object Storage actually
-- recorded (evidence_upload_problem()) before a row exists.
--
-- What an upload deliberately does NOT do
-- ----------------------------------------
-- Change verification. It inserts a pending row and nothing else: the
-- worker's status, block and every earlier row are untouched. A pending
-- replacement is not a verified document, and current_verified_docs()
-- still measures expiry off the last one the office verified, so a
-- worker who uploads anything the day before their passport expires is
-- still blocked on the expiry day (§4.3) — and unblocked only when the
-- office verifies the new one and the full re-check passes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The whole Documents tab in one read.
--
-- Why a function and not the two select policies the worker already
-- holds on compliance_docs and criminal_declarations:
--
--   · the expiry the worker is shown must be the one §4.3 blocks on, and
--     that is doc_expires_on() — the term letter dies 31 December whatever
--     it prints, a share code dies with right_to_work_until. Re-deriving
--     that in TypeScript is a second copy of a rule that decides who is
--     blocked;
--   · "current" and "the verified one that counts" are
--     current_compliance_docs() / current_verified_docs(), with their
--     tie-break. The screen should mark the same row the job reads;
--   · the declaration DETAILS must not reach this screen at all (§10.7
--     step 5: "never displayed back to them"). A select policy hands the
--     whole row to anyone holding it; this names its columns.
-- ---------------------------------------------------------------------
create or replace function public.staff_documents(p_staff uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_me    uuid := staff_caller(p_staff);
  s       staff;
  v_today date := (now() at time zone 'Europe/London')::date;
  v_cap   cap_assessment;
  v_docs  jsonb;
  v_decl  jsonb;
begin
  if v_me is null then
    raise exception 'not_a_worker' using errcode = '42501';
  end if;
  select * into s from staff where id = v_me;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                    d.id::text,
           'docType',               d.doc_type::text,
           'label',                 doc_label(d.doc_type),
           'reviewStatus',          d.review_status::text,
           'uploadedAt',            d.uploaded_at,
           'reviewedAt',            d.reviewed_at,
           'expiresOn',             doc_expires_on(d.doc_type, d.expiry_date, d.right_to_work_until,
                                                   s.right_to_work_until, d.uploaded_at),
           'rejectionReason',       case when d.review_status = 'rejected' then d.rejection_reason end,
           'evidenceForm',          d.evidence_form,
           'completionDateClaimed', d.completion_date_claimed,
           'completionDate',        d.completion_date,
           -- The last three characters, which is what the worker needs to
           -- recognise the code they typed; the whole code is the office's.
           'shareCodeTail',         case when d.share_code is not null then right(d.share_code, 3) end,
           'hasFile',               d.file_path is not null,
           'isCurrent',             exists (select 1 from current_compliance_docs(v_me) c
                                             where c.doc_id = d.id),
           'isCountedVerified',     exists (select 1 from current_verified_docs(v_me) c
                                             where c.doc_id = d.id))
           order by d.doc_type, d.uploaded_at desc, d.id), '[]'::jsonb)
    into v_docs
    from compliance_docs d
   where d.staff_id = v_me;

  -- No `details`, no `conviction_date`, no `review_note`. §10.7.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',           c.id::text,
           'source',       c.source::text,
           'answer',       c.answer,
           'declaredAt',   c.declared_at,
           'reviewStatus', c.review_status::text,
           'superseded',   c.superseded)
           order by c.declared_at desc, c.id desc), '[]'::jsonb)
    into v_decl
    from criminal_declarations c
   where c.staff_id = v_me;

  v_cap := weekly_cap_for(v_me, v_today);

  return jsonb_build_object(
    'staffId',              v_me::text,
    'today',                v_today,
    'status',               s.status::text,
    'blockKind',            s.block_kind::text,
    'rtwBranch',            s.rtw_branch::text,
    'dob',                  s.dob,
    'rightToWorkUntil',     s.right_to_work_until,
    'graduatedAt',          s.graduated_at,
    'courseCompletionDate', s.course_completion_date,
    'termLetterApplies',    term_letter_applies(v_me, v_today),
    'missing',              to_jsonb(coalesce(onboarding_documents_missing(v_me), '{}'::text[])),
    'documents',            v_docs,
    'declarations',         v_decl,
    'cap', jsonb_build_object(
      'hours', v_cap.cap_hours,
      'band',  v_cap.band::text,
      'label', cap_band_label(v_cap.band),
      'until', case when v_cap.band in ('student_term_10', 'student_term_20', 'student_holiday_48')
                    then cap_band_until(s.term_dates, v_today) end),
    'optOut', jsonb_build_object(
      'signed',        coalesce(s.wtr_optout, false),
      'signedAt',      s.wtr_optout_signed_at,
      'noticeDays',    s.wtr_optout_notice_days,
      'cancelledFrom', s.wtr_optout_cancelled_from,
      'hasSignedCopy', s.wtr_optout_copy_path is not null));
end $$;

comment on function public.staff_documents(uuid) is
  '§10.4 Documents tab: every document row with its §4.2 effective expiry and whether it is the current / counted-verified one, the declaration history without its details (§10.7), missing branch items, the RULE-20 cap and the 48-hour opt-out. The caller''s own row (admin may name one).';

-- ---------------------------------------------------------------------
-- 2 · The worker's upload for every other document (§4.1, §4.2, §10.4).
--
-- Who may: a worker in employment with something to fix — compliant, or
-- blocked on documents or a declaration. NOT a manual hold: §10.1 case 2
-- "there is nothing for the worker to fix themselves", and an upload
-- cannot lift a manual block (unblock_if_compliant() never does). A
-- candidate uploads inside the onboarding wizard (§10.3), not here.
--
-- What may be uploaded: a document that is part of this worker's set —
-- one they already hold a current row of (a renewal, a re-upload after a
-- rejection), one the branch requires and is missing, or a new share
-- code for a branch that carries one. Anything else is refused rather
-- than stored: an unrequested type would sit in Needs review, and a
-- rejected one would be `document_unverified` in compliance_blockers()
-- until someone uploaded it again.
--
-- One pending row per type, as for the completion letter: a worker who
-- picked the wrong file is rejected and re-uploads, rather than stacking
-- files the office has to choose between.
--
-- Storage path: <staff_id>/<doc-type-with-hyphens>/<file-id>.<ext>,
-- checked against what Storage recorded by evidence_upload_problem().
-- ---------------------------------------------------------------------
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
  v_me     uuid := staff_caller(p_staff);
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
    -- A share code is typed (§2.5): nine letters and digits, shown by
    -- gov.uk in threes. The office fetches the report against it; a file
    -- is optional here.
    v_code := upper(regexp_replace(coalesce(p_share_code, ''), '[^A-Za-z0-9]', '', 'g'));
    if v_code !~ '^[A-Z0-9]{9}$' then
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
  '§10.4 Upload / Re-upload for every document except the completion letter. In employment only (compliant, or blocked on documents or a declaration — never a manual hold). A type the worker holds, the branch requires, or a share code; the file checked against Storage under <staff_id>/<doc-type>/. Lands pending and changes no verification, status or block.';

-- ---------------------------------------------------------------------
-- 3 · §10.7 for the worker themselves (docs/14 O10, point 5).
--
-- declare_conviction(uuid, …) stays service-role only, and
-- 190_job_function_grants keeps asserting it: granted to `authenticated`
-- as it stands, any signed-in worker could suspend a colleague on a
-- fabricated declaration. What `authenticated` gets is this, which takes
-- no staff id — the subject is auth.uid()'s own row and there is no
-- argument to forge. The request_my_p45() shape (20260922180000).
--
-- Who may: "Available to any compliant worker at any time" (§10.7) —
-- and a worker already locked to Documents (an expired document, or an
-- earlier declaration still in review) keeps the action, because the
-- wireframe draws it on the blocked screen too and a second declaration
-- is history, not an edit. NOT a manual hold: block_worker() would
-- rewrite a manual block as a conviction review, which the automatic
-- re-check CAN lift — a worker would have a route out of a block only a
-- manager may lift (§9.6). A candidate declares in the wizard (§10.3
-- step 4/11); a leaver or a removed worker has nothing to suspend.
--
-- The details are required and bounded; the date is optional and cannot
-- be in the future.
-- ---------------------------------------------------------------------
create or replace function public.declare_my_conviction(
  p_details         text,
  p_conviction_date date default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v       staff;
  v_text  text := btrim(coalesce(p_details, ''));
  v_today date := (now() at time zone 'Europe/London')::date;
begin
  select * into v from staff where user_id = auth.uid();
  if v.id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if v.removed_at is not null
     or v.status not in ('compliant', 'blocked')
     or (v.status = 'blocked' and v.block_kind = 'manual') then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible');
  end if;
  if v_text = '' then
    return jsonb_build_object('ok', false, 'reason', 'details_required');
  end if;
  if length(v_text) > 4000 then
    return jsonb_build_object('ok', false, 'reason', 'details_too_long');
  end if;
  if p_conviction_date is not null and p_conviction_date > v_today then
    return jsonb_build_object('ok', false, 'reason', 'conviction_date_in_future');
  end if;

  return jsonb_build_object('ok', true)
         || declare_conviction(v.id, v_text, p_conviction_date, now());
end $$;

comment on function public.declare_my_conviction(text, date) is
  '§10.7 Declare a criminal conviction, for the worker themselves. Takes no staff id. Compliant, or already locked to Documents; never a manual hold. Runs declare_conviction(): pending in-employment declaration, blocked "Criminal conviction declared — under review", future bookings released, invitations and Radar applications withdrawn, E9 without the details.';

-- ---------------------------------------------------------------------
-- Grants. All three check their caller; none is anon's.
-- ---------------------------------------------------------------------
revoke execute on function public.staff_documents(uuid)                         from public, anon;
revoke execute on function public.submit_document_upload(text, text, text, uuid) from public, anon;
revoke execute on function public.declare_my_conviction(text, date)             from public, anon;

grant execute on function public.staff_documents(uuid)                          to authenticated, service_role;
grant execute on function public.submit_document_upload(text, text, text, uuid) to authenticated, service_role;
grant execute on function public.declare_my_conviction(text, date)              to authenticated;
