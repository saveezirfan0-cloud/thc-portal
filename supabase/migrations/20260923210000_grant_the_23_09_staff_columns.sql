-- =====================================================================
-- Grant the staff columns the 23.09 build added (ADR-0004, O16)
--
-- 20260923090000 (#44) revoked the table-wide SELECT on staff and
-- re-granted every column but block_reason, BY NAME, as of that moment —
-- and said so: a column added later is not readable until a migration
-- grants it. The 23.09 build (onboarding pipeline, completion letter,
-- reports) added twenty columns after it, all read through
-- security_invoker views (onboarding_candidates_v, the Student-visa view,
-- the reports) and by the worker's own staff_self reads. Without this every
-- one of those answered 42501.
--
-- Named here one by one, as #44 asks, rather than "everything but
-- block_reason": the next column added to staff should have to make the
-- same decision.
--
-- Two of the build's security_invoker views also read staff.block_reason
-- directly, which since #44 no PostgREST role may — so they answered 42501
-- to the office as well. They are restated below reading it through
-- staff_block_reason_v, #44's owner-rights route, which carries the admin
-- gate and §1.7's removed-worker suppression itself. Nothing else changes
-- in either view.
--
-- rejection_reason is granted too, which keeps a gap ADR-0017 records: a
-- worker can read the office's reason for rejecting them off their own row,
-- as they could block_reason before #44. onboarding_candidates_v is
-- security_invoker and reads it, so closing it means routing it through an
-- owner-rights view the way #44 did block_reason — docs/14 §4.
-- =====================================================================
grant select (
  wtr_optout_signed_at, wtr_optout_notice_days, wtr_optout_copy_path,
  stage_entered_at, onboarding_started_at,
  rejected_at, rejected_from, rejection_cause, rejection_reason, rejected_by,
  willo_invited_at, willo_answers_done, willo_answers_total, willo_completed_at,
  willo_decision, willo_decided_at, willo_decided_via,
  gender, home_postcode, home_country
) on table public.staff to anon, authenticated;

-- compliance_review_queue_v: from 20260923100100_completion_letter.sql, block_reason now read through staff_block_reason_v.
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
  d.size_bytes
from compliance_docs d
join staff s on s.id = d.staff_id
where d.review_status = 'pending'
  and s.status not in ('rejected', 'removed')
  and s.removed_at is null
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
  null::bigint
from criminal_declarations c
join staff s on s.id = c.staff_id
where c.answer
  and c.review_status = 'pending'
  and not c.superseded
  and s.status not in ('rejected', 'removed')
  and s.removed_at is null;

-- onboarding_returning_v: from 20260923110000_onboarding_pipeline.sql, block_reason now read through staff_block_reason_v.
create or replace view onboarding_returning_v with (security_invoker = true) as
select
  a.id                                                         as application_id,
  a.created_at                                                 as applied_at,
  a.first_name || ' ' || a.last_name                           as applicant_name,
  a.matched_on,
  s.id                                                         as staff_id,
  s.first_name || ' ' || s.last_name                           as existing_name,
  s.employee_id,
  s.status,
  s.block_kind,
  (select r.block_reason from public.staff_block_reason_v r where r.staff_id = s.id) as block_reason,
  s.rating,
  s.reliability,
  (select count(*) from bookings b
    where b.staff_id = s.id and b.status in ('worked', 'closed'))::int as shifts_worked
from applications a
join staff s on s.id = a.staff_id
where a.outcome = 'returning_applicant'
  and a.resolved_at is null
  and s.removed_at is null;

-- Loud if anything else slipped through: after this, every staff column
-- but block_reason is selectable by authenticated, and block_reason is not.
do $$
declare v_missing text;
begin
  select string_agg(a.attname, ', ')
    into v_missing
    from pg_attribute a
   where a.attrelid = 'public.staff'::regclass
     and a.attnum > 0 and not a.attisdropped
     and a.attname <> 'block_reason'
     and not has_column_privilege('authenticated', 'public.staff', a.attname, 'select');
  if v_missing is not null then
    raise exception 'staff columns added without a grant: % (20260923090000 re-grants by name)', v_missing;
  end if;
  if has_column_privilege('authenticated', 'public.staff', 'block_reason', 'select') then
    raise exception 'staff.block_reason became selectable again (§10.1)';
  end if;
end $$;
