-- =====================================================================
-- §2.5 pt 2 · a verified settled-status share code reads "no time limit"
--
-- 20260923200000 (ADR-0018) added compliance_docs.rtw_no_time_limit: the
-- reviewer's explicit confirmation that the gov.uk report shows settled
-- status, stored with a NULL right_to_work_until. staff_documents_v
-- (20260922094500) names its columns and did not carry the new one, so
-- /onboarding/:id and the /staff/:id Documents tab could only see a NULL
-- date and printed "—" — indistinguishable from a date nobody entered.
--
-- The column is appended at the end (create-or-replace cannot reorder).
-- Nothing else in the view changes; it stays security_invoker, so
-- compliance_docs' RLS still decides what a caller sees.
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
  c.rtw_no_time_limit
from compliance_docs c
join staff s on s.id = c.staff_id
left join profiles p on p.id = c.reviewed_by;

comment on view staff_documents_v is
  'The §9.6 Documents tab: every document on a worker with its status, expiry, AI confidence and the reviewer''s name for the UK-time audit stamp (§1.8). Superseded rows are flagged rather than filtered — §2.12 keeps them read-only as the record of the previous period. rtw_no_time_limit (20260924130300) is the settled-status confirmation on a share code report, so a screen can say "Settled — no time limit" instead of a blank date.';
