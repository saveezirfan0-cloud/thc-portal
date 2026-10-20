-- =====================================================================
-- 20261022100000 · The reviewer sees when the AI says an upload is the
--                  wrong kind of document — ADR-0177
--
-- Live case, 20.10.2026: a student's CU London "Student Status
-- Confirmation" was uploaded twice — once as the University Term Dates
-- Letter, once as the Official University Completion Letter. The
-- extractor said so on the second ("This is a current enrolment/status
-- confirmation letter, not a completion letter"; matchesDocType false,
-- issue not_this_document_type) but the only thing the office saw was
-- "AI 0%", and the letter was approved as a completion letter on an
-- EXPECTED course finish date. Since ADR-0163 no API role may read
-- compliance_docs.ai_extracted, so the verdict has to come through the
-- reviewer's owner-rights view.
--
-- compliance_doc_review_v gains ONE column, appended so `create or
-- replace` keeps every existing column, name and order:
--
--   ai_wrong_type_note  text — null unless the extractor said the upload
--                       does not match the document type it was filed
--                       as; then the extractor's own note (at most 300
--                       characters), or a plain sentence when it left
--                       none.
--
-- The gate is unchanged: admin, or a non-API caller. The worker still sees
-- none of it (a worker who could watch the verdict could tune a forged
-- letter until it cleared — security review L3).
-- =====================================================================

create or replace view public.compliance_doc_review_v with (security_barrier = true) as
select
  d.id                    as document_id,
  d.staff_id,
  d.doc_type,
  d.review_status,
  d.uploaded_at,
  d.share_code,
  d.claimed_dob,
  d.ai_confidence,
  d.needs_manual_review,
  d.manual_review_reason,
  CASE
            WHEN d.doc_type = 'university_term_dates_letter'::doc_type AND jsonb_typeof(d.ai_extracted -> 'termLetter'::text) = 'object'::text THEN jsonb_build_object('courseStart', d.ai_extracted #>> '{termLetter,courseStart}'::text[], 'courseEnd', d.ai_extracted #>> '{termLetter,courseEnd}'::text[], 'hoursStatement', "left"(d.ai_extracted #>> '{termLetter,hoursStatement}'::text[], 250))
            ELSE NULL::jsonb
        END as ai_term_letter,
  case
    when d.ai_extracted #>> '{answer,matchesDocType}' = 'false'
      or coalesce(d.ai_extracted -> 'issues' ? 'not_this_document_type', false)
    then coalesce(nullif(btrim(left(d.ai_extracted #>> '{answer,notes}', 300)), ''),
                  'The AI read this upload as a different kind of document.')
  end as ai_wrong_type_note
from public.compliance_docs d
where (select current_app_role()) = 'admin'
   or current_user not in ('anon', 'authenticated');

comment on view public.compliance_doc_review_v is
  'ADR-0163 (security review L3): the reviewer''s columns of compliance_docs — the typed share code and date of birth, the AI''s confidence and term-letter read, the manual-review flag and reason, and (ADR-0177) the AI''s note when it says the upload is not the document type it was filed as. Owner rights + the admin gate in the body; the worker sees none of them (staff_documents() gives them the last three characters of the code).';

-- create or replace keeps the grants; restated so this file reads whole.
revoke all on table public.compliance_doc_review_v from public, anon, authenticated;
grant select on table public.compliance_doc_review_v to authenticated;
