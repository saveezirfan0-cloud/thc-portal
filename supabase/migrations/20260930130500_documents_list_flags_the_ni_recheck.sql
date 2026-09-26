-- =====================================================================
-- Migration 20260930130500 · the Documents list says an NI evidence
--                            document is waiting to be compared (D43)
--
-- 20260930130400 flags NI evidence verified while no NI number was on
-- file (compliance_docs.ni_recheck); once the number arrives it is back
-- in Needs review as kind ni_check. The candidate profile's Documents
-- list (/onboarding/:id) reads staff_documents_v, which did not carry the
-- flag, so it could not say "waiting in Needs review to be compared".
--
-- Restated from 20260924130300, every column in place; one appended.
-- Privileges are unchanged (create or replace keeps them).
-- =====================================================================

create or replace view staff_documents_v with (security_invoker = true) as
select
  c.id,
  c.staff_id,
  c.doc_type,
  doc_label(c.doc_type)                                      as doc_label,
  c.review_status,
  c.review_status = 'superseded'                             as superseded,
  c.file_path,
  c.uploaded_at,
  c.expiry_date,
  doc_expires_on(c.doc_type, c.expiry_date, c.right_to_work_until,
                 s.right_to_work_until, c.uploaded_at)             as expires_on,
  c.ai_confidence,
  c.needs_manual_review,
  c.rejection_reason,
  c.reviewed_at,
  p.full_name                                                as reviewed_by_name,
  c.share_code,
  c.gov_report_path,
  c.right_to_work_until,
  c.term_dates,
  c.completion_date,
  c.awarding_institution,
  -- Appended (20260924130300): a create-or-replace view may only add
  -- columns at the end.
  c.rtw_no_time_limit,
  -- Appended (20260930130500).
  c.ni_recheck
from compliance_docs c
join staff s on s.id = c.staff_id
left join profiles p on p.id = c.reviewed_by;

comment on view staff_documents_v is
  'The Documents tab of /staff/:id and /onboarding/:id: every document on a worker with its status, expiry, AI confidence and the reviewer''s name for the UK-time audit stamp. Superseded rows are flagged rather than filtered (kept read-only as the record of the previous period). rtw_no_time_limit is the settled-status confirmation on a share code report; ni_recheck marks NI evidence verified before the NI number was entered (20260930130500).';
