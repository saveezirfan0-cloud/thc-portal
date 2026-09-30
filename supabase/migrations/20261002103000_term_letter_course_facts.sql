-- =====================================================================
-- Migration 20261002103000 · what a term letter says besides its holidays
--                            (§2.3, §2.6, RULE-20, ADR-0033)
--
-- The extractor now also reads, off a University Term Dates Letter, the date
-- the course starts, the date it is expected to end, and any statement the
-- letter itself makes about working hours. They arrive in the row's
-- `ai_extracted` (record_document_extraction() stores the provider's answer
-- whole, so nothing about that function changes) under `termLetter`.
--
-- The office reads them beside the holiday periods on /onboarding/:id and
-- /staff/:id. This appends ONE column to staff_documents_v:
--
--   ai_term_letter  { courseStart, courseEnd, hoursStatement } — those three
--                   keys only, for a term letter only; null on every other
--                   document and on a term letter not read yet.
--
-- Informational. The weekly cap stays calculated from the verified holiday
-- dates (and, after graduation, a verified completion letter), never from
-- anything here: an expected end date lifts nothing, and a printed hours
-- statement is the letter's words, not a limit (RULE-20).
--
-- Restated from 20260930130500, every column in place; one appended.
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
  c.ni_recheck,
  -- Appended (20261002103000): the three keys, never the raw answer.
  case
    when c.doc_type = 'university_term_dates_letter'
     and jsonb_typeof(c.ai_extracted -> 'termLetter') = 'object'
    then jsonb_build_object(
           'courseStart',    c.ai_extracted #>> '{termLetter,courseStart}',
           'courseEnd',      c.ai_extracted #>> '{termLetter,courseEnd}',
           'hoursStatement', left(c.ai_extracted #>> '{termLetter,hoursStatement}', 250))
  end                                                        as ai_term_letter
from compliance_docs c
join staff s on s.id = c.staff_id
left join profiles p on p.id = c.reviewed_by;

comment on view staff_documents_v is
  'The Documents tab of /staff/:id and /onboarding/:id: every document on a worker with its status, expiry, AI confidence and the reviewer''s name for the UK-time audit stamp. Superseded rows are flagged rather than filtered (kept read-only as the record of the previous period). rtw_no_time_limit is the settled-status confirmation on a share code report; ni_recheck marks NI evidence verified before the NI number was entered (20260930130500). ai_term_letter is what the AI read off a term letter besides its holidays — course start, expected end, and any hours statement in the letter''s own words — for the reviewer only: it never feeds the weekly cap (20261002103000).';
