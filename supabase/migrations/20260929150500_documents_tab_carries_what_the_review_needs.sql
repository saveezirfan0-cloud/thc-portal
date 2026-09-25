-- =====================================================================
-- Fix round 29.09 · WP-F · the profile's Documents list carries what its
-- Verify / Reject needs (audit item 8, D47, D43)
--
-- /staff/:id Documents now verifies and rejects pending documents with the
-- same windows and RPCs as Compliance → Needs review. Approving a
-- completion letter there confirms the completion date entered with the
-- upload and names the form it came in, which staff_documents_v did not
-- carry; and an NI evidence document flagged for a re-check (D43) says so
-- on the profile.
--
-- Restated from 20260924130300, every column in place; three appended.
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
  c.rtw_no_time_limit,
  -- 20260929150500
  c.completion_date_claimed,
  c.evidence_form,
  c.ni_recheck
from compliance_docs c
join staff s on s.id = c.staff_id
left join profiles p on p.id = c.reviewed_by;

comment on view staff_documents_v is
  'The Documents tab of /staff/:id and /onboarding/:id: every document on a worker with its status, expiry, AI confidence and the reviewer''s name for the UK-time audit stamp. Superseded rows are flagged rather than filtered (kept read-only as the record of the previous period). rtw_no_time_limit is the settled-status confirmation on a share code report; completion_date_claimed and evidence_form are what a pending completion letter was uploaded with, for its Approve; ni_recheck marks NI evidence verified before the NI number was entered (20260929150500).';

revoke all on staff_documents_v from public, anon;
grant select on staff_documents_v to authenticated, service_role;
