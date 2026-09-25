-- =====================================================================
-- Fix round 29.09 · WP-F · the NI number beside its evidence, the
-- office's two uploads, and right-to-work changes in the audit export
-- (audit D43, D47, D31, AC7; ADR-0037;
--  docs/scope/university-completion-letter-requirement.pdf §2.1, §4, §6)
--
-- D43 · NI evidence is checked against the number
-- ------------------------------------------------
-- §2.5 pt 7: the NI evidence must match the NI number. The office saw the
-- number masked, and most candidates type it at the contract step, AFTER
-- their documents were verified, so there was nothing to compare with.
--   · compliance_review_queue_v carries the FULL number on an NI evidence
--     row (ni_number), for the admin only: the view is security_invoker
--     and `staff` is admin_all + the worker's own row.
--   · Verifying NI evidence while no number is on file flags the document
--     (compliance_docs.ni_recheck, set by a row trigger, so every Verify
--     path is covered). Once the number arrives the document is back in
--     Needs review as kind 'ni_check' — "NI number arrived — compare" —
--     with the number beside the evidence. compliance_resolve_ni_check()
--     confirms the match (audited) or, reason required, rejects the
--     evidence and asks the worker to re-upload (N8).
--   · Verified WITH the number on file: the reviewer compared them, so
--     the match is stamped at verification (ni_matched_at / _by).
--
-- D47 · The office uploads a completion letter
-- ---------------------------------------------
-- office_submit_completion_letter(): the admin variant of
-- submit_completion_letter() (20260927161100), for the staff profile and
-- the candidate profile. Same checks — Student visa branch, one of the
-- three forms, the completion date, the file as Storage recorded it under
-- <staff_id>/completion-letter/, one pending at a time — and it lands
-- PENDING like the worker's: the cap changes only on approval (AC2),
-- through the same Approve and its date confirmation. The upload is
-- audited by completion_letter_audit() with the admin as the actor. No
-- CL1 ("we received your upload" — the worker did not upload) and no CL3
-- (the office emailing itself about its own upload).
--
-- D31 · The gov.uk report on the manual path
-- -------------------------------------------
-- ADR-0025's automated check stores its report in gov_report_path. With
-- the check off (ADR-0018's manual Verify), nothing could. The office now
-- attaches the report it downloaded from gov.uk to the share code
-- document: compliance_attach_rtw_report(), <staff_id>/share-code-report/,
-- audited as rtw.report_attached. A report already on the document is not
-- replaced (the earlier one is evidence too, and would be orphaned).
--
-- AC7 · Right-to-work decisions in the export
-- --------------------------------------------
-- compliance_evidence_audit_v (20260923100100) exported the completion
-- letter and the opt-out only. It now also carries every right-to-work
-- change and decision: rtw.changed (record_right_to_work_change), rtw.
-- verified (the office's Verify and the automated check's), rtw.conditions
-- (course level, visa hours limit), rtw.report_attached, and the automated
-- check's own rtw_check.* rows (passed / rejected / needs_review / failed,
-- requested, reviewed). New columns are appended; the existing ones keep
-- their names, types and order.
--
-- Forward-only. Restated from their latest definitions:
--   compliance_review_queue_v    20260928100000
--   compliance_evidence_audit_v  20260923100100
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · D43 · The flag and the stamp
-- ---------------------------------------------------------------------
alter table compliance_docs
  add column if not exists ni_recheck    boolean not null default false,
  add column if not exists ni_matched_at timestamptz,
  add column if not exists ni_matched_by uuid references profiles(id);

create index if not exists compliance_docs_ni_matched_by_idx on compliance_docs (ni_matched_by);
create index if not exists compliance_docs_ni_recheck_idx on compliance_docs (staff_id) where ni_recheck;

comment on column compliance_docs.ni_recheck is
  'NI evidence verified while no NI number was on file (D43). Once the number arrives the document is back in Needs review as kind ni_check until compliance_resolve_ni_check() compares them.';
comment on column compliance_docs.ni_matched_at is
  'When a reviewer compared the NI evidence with the NI number on file (at verification, or on the ni_check row). UK-time audit stamp.';

create or replace function public.compliance_docs_ni_recheck()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_ni text;
begin
  select s.ni_number into v_ni from staff s where s.id = new.staff_id;
  if v_ni is null then
    new.ni_recheck := true;
    new.ni_matched_at := null;
    new.ni_matched_by := null;
  else
    new.ni_recheck := false;
    new.ni_matched_at := now();
    new.ni_matched_by := coalesce(new.reviewed_by, auth.uid());
  end if;
  return new;
end $$;

comment on function public.compliance_docs_ni_recheck() is
  'D43: NI evidence becoming verified is flagged for a re-check when no NI number is on file, and stamped as compared when one is.';

drop trigger if exists compliance_docs_ni_recheck on compliance_docs;
create trigger compliance_docs_ni_recheck
  before update of review_status on compliance_docs
  for each row
  when (new.doc_type = 'ni_evidence'
        and new.review_status = 'verified'
        and old.review_status is distinct from 'verified')
  execute function compliance_docs_ni_recheck();

revoke execute on function public.compliance_docs_ni_recheck() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2 · D43 · The office's answer on an ni_check row
-- ---------------------------------------------------------------------
create or replace function public.compliance_resolve_ni_check(
  p_doc     uuid,
  p_matches boolean,
  p_reason  text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reviewer uuid := assert_reviewer();
  d          compliance_docs;
  s          staff;
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_matches is null then
    raise exception 'answer_required' using errcode = '22023';
  end if;
  select * into d from compliance_docs where id = p_doc for update;
  if d.id is null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if d.doc_type <> 'ni_evidence' or d.review_status <> 'verified' or not d.ni_recheck then
    raise exception 'no_ni_check_due' using errcode = 'P0001';
  end if;
  select * into s from staff where id = d.staff_id;
  if s.status in ('rejected', 'removed') or s.removed_at is not null then
    raise exception 'not_reviewable: %', s.status using errcode = 'P0001';
  end if;
  if s.ni_number is null then
    raise exception 'ni_number_not_entered' using errcode = 'P0001';
  end if;

  if p_matches then
    update compliance_docs
       set ni_recheck = false, ni_matched_at = now(), ni_matched_by = v_reviewer
     where id = d.id;
  else
    if v_reason is null then
      raise exception 'reason_required' using errcode = 'P0001';
    end if;
    update compliance_docs
       set ni_recheck = false,
           review_status = 'rejected',
           rejection_reason = v_reason,
           reviewed_by = v_reviewer,
           reviewed_at = now()
     where id = d.id;
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    values ('N8:doc:' || d.id, 'push', 'N8', d.staff_id,
            jsonb_build_object('reason', v_reason,
                               'document', doc_label(d.doc_type),
                               'documentId', d.id::text,
                               'link', n8_link(s.status)))
    on conflict (key) do nothing;
  end if;

  -- The number itself never goes into the log: the log outlives a §1.7
  -- removal, the NI number must not.
  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), v_reviewer, case when p_matches then 'ni.matched' else 'ni.mismatch' end,
          'compliance_docs', d.id,
          jsonb_strip_nulls(jsonb_build_object(
            'staffId', s.id, 'employeeId', s.employee_id, 'reason', v_reason,
            'actorName', (select full_name from profiles where id = v_reviewer))));

  return jsonb_build_object('ok', true, 'documentId', d.id::text, 'matches', p_matches);
end $$;

comment on function public.compliance_resolve_ni_check(uuid, boolean, text) is
  'D43: the office compares NI evidence verified before the NI number was entered with the number now on file. Match → stamped; no match → the evidence is rejected with the reason and N8 asks for a re-upload. Admin only; audited without the number.';

-- ---------------------------------------------------------------------
-- 3 · D47 · The office's completion-letter upload
-- ---------------------------------------------------------------------
create or replace function public.office_submit_completion_letter(
  p_staff                uuid,
  p_file_path            text,
  p_completion_date      date,
  p_evidence_form        text,
  p_awarding_institution text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reviewer uuid := assert_reviewer();
  s          staff;
  v_check    record;
  v_doc      uuid;
  v_today    date := (now() at time zone 'Europe/London')::date;
begin
  select * into s from staff where id = p_staff for update;
  if s.id is null then
    raise exception 'unknown_staff' using errcode = 'P0002';
  end if;
  if s.status in ('rejected', 'removed', 'inactive') or s.removed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible');
  end if;
  if s.rtw_branch is distinct from 'international_student' then
    return jsonb_build_object('ok', false, 'reason', 'not_student_visa');
  end if;
  if p_evidence_form is null
     or p_evidence_form not in ('letter', 'transcript', 'university_email') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_form');
  end if;
  if p_completion_date is null then
    return jsonb_build_object('ok', false, 'reason', 'completion_date_required');
  end if;
  if p_completion_date < date '2000-01-01' or p_completion_date > v_today + interval '5 years' then
    return jsonb_build_object('ok', false, 'reason', 'completion_date_implausible');
  end if;

  select * into v_check from evidence_upload_problem(s.id, 'completion-letter', p_file_path);
  if v_check.problem is not null then
    return jsonb_build_object('ok', false, 'reason', v_check.problem);
  end if;

  if exists (select 1 from compliance_docs d
              where d.staff_id = s.id
                and d.doc_type = 'university_completion_letter'
                and d.review_status = 'pending') then
    return jsonb_build_object('ok', false, 'reason', 'already_pending');
  end if;

  insert into compliance_docs (staff_id, doc_type, file_path, review_status,
                               evidence_form, completion_date_claimed,
                               awarding_institution, mime_type, size_bytes)
  values (s.id, 'university_completion_letter', p_file_path, 'pending',
          p_evidence_form, p_completion_date,
          nullif(trim(coalesce(p_awarding_institution, '')), ''),
          v_check.mime, v_check.size_bytes)
  returning id into v_doc;

  return jsonb_build_object('ok', true, 'documentId', v_doc::text, 'status', 'pending');
end $$;

comment on function public.office_submit_completion_letter(uuid, text, date, text, text) is
  'D47: the Back Office uploads a completion letter for a Student-visa worker or candidate (requirement §2.1 "the reviewer must capture"). The worker''s submit_completion_letter() checks, admin only; lands PENDING and changes no cap until approved (AC2); audited with the admin as the uploader. No CL1/CL3.';

-- ---------------------------------------------------------------------
-- 4 · D31 · The gov.uk report on the manual path
-- ---------------------------------------------------------------------
create or replace function public.compliance_attach_rtw_report(
  p_doc  uuid,
  p_path text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reviewer uuid := assert_reviewer();
  d          compliance_docs;
  s          staff;
  v_check    record;
begin
  select * into d from compliance_docs where id = p_doc for update;
  if d.id is null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if d.doc_type <> 'share_code_report' or d.review_status = 'superseded' then
    raise exception 'not_a_share_code_document' using errcode = 'P0001';
  end if;
  select * into s from staff where id = d.staff_id;
  if s.status = 'removed' or s.removed_at is not null then
    raise exception 'not_reviewable: removed' using errcode = 'P0001';
  end if;
  if d.gov_report_path is not null then
    return jsonb_build_object('ok', false, 'reason', 'report_already_attached');
  end if;

  select * into v_check from evidence_upload_problem(s.id, 'share-code-report', p_path);
  if v_check.problem is not null then
    return jsonb_build_object('ok', false, 'reason', v_check.problem);
  end if;

  update compliance_docs set gov_report_path = p_path where id = d.id;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), v_reviewer, 'rtw.report_attached', 'compliance_docs', d.id,
          jsonb_strip_nulls(jsonb_build_object(
            'staffId', s.id, 'employeeId', s.employee_id, 'branch', s.rtw_branch,
            'docType', d.doc_type::text, 'filePath', p_path,
            'actorName', (select full_name from profiles where id = v_reviewer))));

  return jsonb_build_object('ok', true, 'documentId', d.id::text, 'path', p_path);
end $$;

comment on function public.compliance_attach_rtw_report(uuid, text) is
  'D31: the office attaches the gov.uk right-to-work report (PDF, JPG or PNG under <staff_id>/share-code-report/) to a share code document when it verified by hand (ADR-0018) — the automated check (ADR-0025) stores its own. Never replaces a report already attached. Admin only; audited as rtw.report_attached.';

-- ---------------------------------------------------------------------
-- 5 · Needs review, with the NI number and the conditions the reviewer sets
--
-- Restated from 20260928100000, every column and predicate carried. Added:
--   · ni_number: the full number, on NI evidence rows and ni_check rows;
--   · below_degree_level, visa_weekly_hour_limit: what the reviewer's two
--     fields are set to now (D32, D36);
--   · rtw_check_term_limit: the hours limit the automated check parsed, the
--     pre-filled value for those fields (ADR-0025);
--   · gov_report_path: whether a report is already attached (D31);
--   · kind 'ni_check': NI evidence verified before the number was on file,
--     now that it is (D43).
-- Appended AFTER rtw_manual_allowed, so every existing column keeps its
-- place.
-- ---------------------------------------------------------------------
create or replace view compliance_review_queue_v with (security_invoker = true) as
select
  'document'::text                                           as kind,
  d.id                                                       as item_id,
  s.id                                                       as staff_id,
  s.first_name || ' ' || s.last_name                         as display_name,
  s.employee_id,
  s.status,
  s.status in ('interview_requested', 'interview_completed', 'documents', 'quiz', 'contract')
                                                             as is_candidate,
  s.block_kind,
  (select r.block_reason from public.staff_block_reason_v r where r.staff_id = s.id) as block_reason,
  s.rtw_branch,
  s.photo_path,
  d.doc_type::text                                           as item_type,
  doc_label(d.doc_type)                                      as item_label,
  d.uploaded_at                                              as submitted_at,
  d.file_path,
  d.ai_confidence,
  d.needs_manual_review,
  d.expiry_date,
  d.term_dates,
  d.right_to_work_until                                      as doc_right_to_work_until,
  d.share_code,
  d.awarding_institution,
  exists (select 1 from compliance_docs p
           where p.staff_id = d.staff_id and p.doc_type = d.doc_type and p.id <> d.id
             and p.review_status in ('verified', 'rejected')
             and p.uploaded_at <= d.uploaded_at)             as is_reupload,
  (select p.rejection_reason from compliance_docs p
    where p.staff_id = d.staff_id and p.doc_type = d.doc_type and p.id <> d.id
      and p.review_status = 'rejected' and p.uploaded_at <= d.uploaded_at
    order by p.uploaded_at desc limit 1)                     as previous_rejection,
  null::text                                                 as declaration_source,
  null::text                                                 as declaration_details,
  null::date                                                 as conviction_date,
  s.right_to_work_until                                      as staff_right_to_work_until,
  d.evidence_form,
  d.completion_date_claimed,
  d.mime_type,
  d.size_bytes,
  null::text                                                 as review_reason,
  k.check_id                                                 as rtw_check_id,
  k.status                                                   as rtw_check_status,
  k.source                                                   as rtw_check_source,
  k.outcome                                                  as rtw_check_outcome,
  k.attempts                                                 as rtw_check_attempts,
  coalesce(k.finished_at, k.created_at)                      as rtw_checked_at,
  coalesce(k.review_reason,
           case when k.stuck then format(
             'The automatic gov.uk check has not run for over %s minutes — the schedule, its secret or the provider may be missing. Verify by hand from the report, and check job_runs.',
             (extract(epoch from rtw_check_stale_after()) / 60)::int) end)
                                                             as rtw_check_reason,
  k.right_to_work_until                                      as rtw_check_until,
  k.no_time_limit                                            as rtw_check_no_time_limit,
  k.conditions                                               as rtw_check_conditions,
  k.report_path                                              as rtw_check_report_path,
  case when d.doc_type = 'share_code_report' then rtw_check_manual_allowed(d.id) end
                                                             as rtw_manual_allowed,
  -- 20260929150400
  case when d.doc_type = 'ni_evidence' then s.ni_number end  as ni_number,
  s.below_degree_level,
  s.visa_weekly_hour_limit,
  k.term_time_limit_hours                                    as rtw_check_term_limit,
  d.gov_report_path
from compliance_docs d
join staff s on s.id = d.staff_id
left join lateral (select * from rtw_checks_latest_v l where l.document_id = d.id) k on true
where d.review_status = 'pending'
  and s.status not in ('rejected', 'removed')
  and s.removed_at is null
  and not coalesce(d.doc_type = 'share_code_report'
                   and k.status in ('queued', 'running')
                   and not k.stuck
                   and rtw_check_enabled(), false)
union all
select
  'declaration'::text,
  c.id,
  s.id,
  s.first_name || ' ' || s.last_name,
  s.employee_id,
  s.status,
  s.status in ('interview_requested', 'interview_completed', 'documents', 'quiz', 'contract'),
  s.block_kind,
  (select r.block_reason from public.staff_block_reason_v r where r.staff_id = s.id) as block_reason,
  s.rtw_branch,
  s.photo_path,
  'criminal_declaration'::text,
  'Criminal Record declaration'::text,
  c.declared_at,
  null::text,
  null::numeric,
  false,
  null::date,
  null::daterange[],
  null::date,
  null::text,
  null::text,
  false,
  null::text,
  c.source::text,
  c.details,
  c.conviction_date,
  s.right_to_work_until,
  null::text,
  null::date,
  null::text,
  null::bigint,
  null::text,
  null::uuid,
  null::text,
  null::text,
  null::text,
  null::int,
  null::timestamptz,
  null::text,
  null::date,
  null::boolean,
  null::jsonb,
  null::text,
  null::boolean,
  null::text,
  s.below_degree_level,
  s.visa_weekly_hour_limit,
  null::int,
  null::text
from criminal_declarations c
join staff s on s.id = c.staff_id
where c.answer
  and c.review_status = 'pending'
  and not c.superseded
  and s.status not in ('rejected', 'removed')
  and s.removed_at is null
union all
select
  'rtw_date'::text,
  d.id,
  s.id,
  s.first_name || ' ' || s.last_name,
  s.employee_id,
  s.status,
  s.status in ('interview_requested', 'interview_completed', 'documents', 'quiz', 'contract'),
  s.block_kind,
  (select r.block_reason from public.staff_block_reason_v r where r.staff_id = s.id) as block_reason,
  s.rtw_branch,
  s.photo_path,
  d.doc_type::text,
  doc_label(d.doc_type),
  coalesce(d.reviewed_at, d.uploaded_at),
  d.file_path,
  null::numeric,
  true,
  null::date,
  null::daterange[],
  d.right_to_work_until,
  coalesce(d.share_code, s.share_code),
  null::text,
  false,
  null::text,
  null::text,
  null::text,
  null::date,
  s.right_to_work_until,
  null::text,
  null::date,
  d.mime_type,
  d.size_bytes,
  'Right-to-work date missing — re-verify'::text,
  null::uuid,
  null::text,
  null::text,
  null::text,
  null::int,
  null::timestamptz,
  null::text,
  null::date,
  null::boolean,
  null::jsonb,
  null::text,
  null::boolean,
  null::text,
  s.below_degree_level,
  s.visa_weekly_hour_limit,
  null::int,
  d.gov_report_path
from compliance_docs d
join staff s on s.id = d.staff_id
where d.doc_type = 'share_code_report'
  and d.review_status = 'verified'
  and d.right_to_work_until is null
  and not d.rtw_no_time_limit
  and d.id = (select l.id from compliance_docs l
               where l.staff_id = d.staff_id
                 and l.doc_type = 'share_code_report'
                 and l.review_status = 'verified'
               order by l.uploaded_at desc, l.id
               limit 1)
  and s.rtw_branch is not null
  and s.rtw_branch <> 'uk_irish'
  and s.right_to_work_until is null
  and s.status in ('documents', 'quiz', 'contract', 'compliant', 'blocked')
  and s.removed_at is null
  and not exists (select 1 from compliance_docs p
                   where p.staff_id = d.staff_id
                     and p.doc_type = 'share_code_report'
                     and p.review_status = 'pending')
union all
select
  'rtw_check'::text,
  k.check_id,
  s.id,
  s.first_name || ' ' || s.last_name,
  s.employee_id,
  s.status,
  s.status in ('interview_requested', 'interview_completed', 'documents', 'quiz', 'contract'),
  s.block_kind,
  (select r.block_reason from public.staff_block_reason_v r where r.staff_id = s.id) as block_reason,
  s.rtw_branch,
  s.photo_path,
  'share_code_report'::text,
  'gov.uk right-to-work check'::text,
  coalesce(k.finished_at, k.created_at),
  null::text,
  null::numeric,
  false,
  null::date,
  null::daterange[],
  null::date,
  d.share_code,
  null::text,
  false,
  null::text,
  null::text,
  null::text,
  null::date,
  s.right_to_work_until,
  null::text,
  null::date,
  null::text,
  null::bigint,
  k.review_reason,
  k.check_id,
  k.status,
  k.source,
  k.outcome,
  k.attempts,
  coalesce(k.finished_at, k.created_at),
  k.review_reason,
  k.right_to_work_until,
  k.no_time_limit,
  k.conditions,
  k.report_path,
  false,
  null::text,
  s.below_degree_level,
  s.visa_weekly_hour_limit,
  k.term_time_limit_hours,
  d.gov_report_path
from rtw_checks_latest_v k
join compliance_docs d on d.id = k.document_id
join staff s on s.id = k.staff_id
where k.status = 'needs_review'
  and k.outcome = 'no_right_to_work'
  and k.reviewed_at is null
  and d.review_status <> 'pending'
  and s.status not in ('rejected', 'removed')
  and s.removed_at is null
union all
-- 20260929150400 (D43): NI evidence verified before the number existed.
-- Keyed on the verified document, so the office's answer has something to
-- land on (compliance_resolve_ni_check).
select
  'ni_check'::text,
  d.id,
  s.id,
  s.first_name || ' ' || s.last_name,
  s.employee_id,
  s.status,
  s.status in ('interview_requested', 'interview_completed', 'documents', 'quiz', 'contract'),
  s.block_kind,
  (select r.block_reason from public.staff_block_reason_v r where r.staff_id = s.id) as block_reason,
  s.rtw_branch,
  s.photo_path,
  d.doc_type::text,
  doc_label(d.doc_type),
  coalesce(d.reviewed_at, d.uploaded_at),
  d.file_path,
  null::numeric,
  true,
  null::date,
  null::daterange[],
  null::date,
  null::text,
  null::text,
  false,
  null::text,
  null::text,
  null::text,
  null::date,
  s.right_to_work_until,
  null::text,
  null::date,
  d.mime_type,
  d.size_bytes,
  'NI number entered after the NI evidence was verified — compare them'::text,
  null::uuid,
  null::text,
  null::text,
  null::text,
  null::int,
  null::timestamptz,
  null::text,
  null::date,
  null::boolean,
  null::jsonb,
  null::text,
  null::boolean,
  s.ni_number,
  s.below_degree_level,
  s.visa_weekly_hour_limit,
  null::int,
  null::text
from compliance_docs d
join staff s on s.id = d.staff_id
where d.doc_type = 'ni_evidence'
  and d.review_status = 'verified'
  and d.ni_recheck
  and s.ni_number is not null
  and s.status not in ('rejected', 'removed')
  and s.removed_at is null;

comment on view compliance_review_queue_v is
  '§4.1 Needs review: every pending document and every pending Yes declaration on a live profile (Rejected and Removed drop out); kind ''rtw_date'' (20260927160000); with the automated right-to-work check on, not a share code whose check is still running, plus kind ''rtw_check'' (ADR-0025); and kind ''ni_check'', NI evidence verified before the NI number was entered, once it has been (D43). NI evidence rows carry the full NI number for the reviewer. security_invoker.';

revoke all on compliance_review_queue_v from public, anon;
grant select on compliance_review_queue_v to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6 · AC7 · The export, with right-to-work changes and decisions
-- ---------------------------------------------------------------------
create or replace view compliance_evidence_audit_v with (security_invoker = true) as
select
  a.id,
  a.at,
  split_part(a.action, '.', 1)                                as record_type,
  split_part(a.action, '.', 2)                                as event,
  case when a.entity in ('compliance_doc', 'compliance_docs') then a.entity_id end
                                                              as document_id,
  (a.data ->> 'staffId')::uuid                                as staff_id,
  coalesce(s.employee_id, (a.data ->> 'employeeId')::int)     as employee_id,
  case when s.removed_at is not null then deleted_account_label(s.employee_id)
       when s.id is not null then s.first_name || ' ' || s.last_name end
                                                              as worker,
  a.actor,
  coalesce(a.data ->> 'actorName', p.full_name)               as actor_name,
  a.data ->> 'evidenceForm'                                   as evidence_form,
  a.data ->> 'filePath'                                       as file_path,
  (a.data ->> 'uploadedAt')::timestamptz                      as uploaded_at,
  (a.data ->> 'completionDateClaimed')::date                  as completion_date_claimed,
  (a.data ->> 'completionDate')::date                         as completion_date,
  (a.data ->> 'visaExpiry')::date                             as visa_expiry,
  a.data ->> 'reason'                                         as reason,
  (a.data ->> 'noticeDays')::int                              as notice_days,
  (a.data ->> 'effectiveFrom')::date                          as effective_from,
  (a.data ->> 'retainUntil')::date                            as retain_until,
  -- 20260929150400 (AC7): right-to-work changes and decisions.
  a.data ->> 'docType'                                        as doc_type,
  a.data ->> 'fromBranch'                                     as branch_before,
  coalesce(a.data ->> 'toBranch', a.data ->> 'branch')        as branch,
  coalesce(a.data ->> 'fromUntil', a.data ->> 'staffUntilBefore')::date
                                                              as rtw_until_before,
  coalesce(a.data ->> 'toUntil', a.data ->> 'confirmedUntil',
           a.data ->> 'rightToWorkUntil')::date               as rtw_until,
  (a.data ->> 'noTimeLimit')::boolean                         as rtw_no_time_limit,
  a.data ->> 'field'                                          as condition,
  (a.data ->> 'belowDegreeLevelTo')::boolean                  as below_degree_level,
  (a.data ->> 'visaHourLimitTo')::int                         as visa_hour_limit,
  a.data ->> 'source'                                         as check_source,
  a.data ->> 'outcome'                                        as check_outcome
from audit_log a
left join staff s    on s.id = (a.data ->> 'staffId')::uuid
left join profiles p on p.id = a.actor
where a.action like 'completion\_letter.%'
   or a.action like 'wtr\_optout.%'
   or a.action like 'rtw.%'
   or a.action like 'rtw\_check.%';

comment on view compliance_evidence_audit_v is
  'Completion letter requirement §4 and acceptance criterion 7: every completion letter upload, approval, rejection, supersede and purge; every opt-out signed or cancelled; and every right-to-work change and decision — route changes, verifications (by the office or the automated check), the course level and visa hours limit the office sets, reports attached, and the automated check''s results — for the CSV export on /compliance. Reads audit_log, which is admin-read and append-only.';

revoke all on compliance_evidence_audit_v from public, anon;
grant select on compliance_evidence_audit_v to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7 · Privileges
-- ---------------------------------------------------------------------
revoke execute on function public.compliance_resolve_ni_check(uuid, boolean, text) from public, anon;
revoke execute on function public.office_submit_completion_letter(uuid, text, date, text, text) from public, anon;
revoke execute on function public.compliance_attach_rtw_report(uuid, text) from public, anon;
grant  execute on function public.compliance_resolve_ni_check(uuid, boolean, text) to authenticated, service_role;
grant  execute on function public.office_submit_completion_letter(uuid, text, date, text, text) to authenticated, service_role;
grant  execute on function public.compliance_attach_rtw_report(uuid, text) to authenticated, service_role;
