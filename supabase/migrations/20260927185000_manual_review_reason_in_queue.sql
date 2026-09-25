-- =====================================================================
-- Migration 20260927185000 · The Needs review queue carries WHY the
--                            extractor flagged a document (§4.1, §4.2)
--
-- 20260927181100 gave compliance_docs a manual_review_reason — "letter
-- expired" when every holiday range on a University Term Dates Letter is
-- already past — and made compliance_verify_document() refuse such a
-- letter (term_letter_expired, P0001). The flag reached the queue
-- (needs_manual_review), the reason did not: the reviewer saw "needs
-- manual review" on a 99 % read and had to open the file to learn that
-- the letter is last year's. §4.2: "an already-expired letter is not
-- accepted" — the queue should say so before Verify has to refuse.
--
-- What this does
-- --------------
--   compliance_review_queue_v gains manual_review_reason, APPENDED
--   (create-or-replace may only add columns at the end), restated
--   verbatim from its latest definition (20260927160000 — the 'rtw_date'
--   row): every column, predicate, the grants and security_invoker are
--   carried unchanged. The column is the document row's own
--   d.manual_review_reason; null on declaration and rtw_date rows, which
--   are not extractor uploads.
--
-- What this deliberately does not do
-- ----------------------------------
--   · No new policy, no new grant: security_invoker over compliance_docs
--     (admin_all) is still the gate, and the client role never reaches
--     this view (ADR-0004 unchanged).
--   · The rule itself is untouched — term_letter_expired() and both
--     functions of 20260927181100 stand as written.
--
-- Forward-only. Nothing here edits an earlier migration.
-- =====================================================================

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
  -- Appended (20260927160000): why a row that is not a pending upload is
  -- here. Null on document and declaration rows.
  null::text                                                 as review_reason,
  -- Appended (20260927185000): why the extractor sent this upload to a
  -- human beyond its confidence — "letter expired" for a term letter whose
  -- every holiday range is already past (§4.2, 20260927181100). Null when
  -- the flag is confidence only, and on the other two kinds of row.
  d.manual_review_reason
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
  null::bigint,
  null::text,
  null::text
from criminal_declarations c
join staff s on s.id = c.staff_id
where c.answer
  and c.review_status = 'pending'
  and not c.superseded
  and s.status not in ('rejected', 'removed')
  and s.removed_at is null
union all
-- A share code verified with no date (before 20260923200000). Keyed on
-- the report so the screen's Verify has something to confirm the date on;
-- the "uploaded" stamp is when it was verified without one, which is how
-- long the gap has stood. needs_manual_review is true because only a
-- human can close it: there is no upload for an extractor to read.
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
  null::text
from compliance_docs d
join staff s on s.id = d.staff_id
where d.doc_type = 'share_code_report'
  and d.review_status = 'verified'
  and d.right_to_work_until is null
  and not d.rtw_no_time_limit
  -- The latest verified report is the one rtw_evidence_until() reads
  -- (same order: newest upload first, id as the tie-break).
  and d.id = (select l.id from compliance_docs l
               where l.staff_id = d.staff_id
                 and l.doc_type = 'share_code_report'
                 and l.review_status = 'verified'
               order by l.uploaded_at desc, l.id
               limit 1)
  -- The header query of 20260923200000: non-UK, live, no date on the worker.
  and s.rtw_branch is not null
  and s.rtw_branch <> 'uk_irish'
  and s.right_to_work_until is null
  and s.status in ('documents', 'quiz', 'contract', 'compliant', 'blocked')
  and s.removed_at is null
  -- A new report already waiting in this queue closes the gap on its own Verify.
  and not exists (select 1 from compliance_docs p
                   where p.staff_id = d.staff_id
                     and p.doc_type = 'share_code_report'
                     and p.review_status = 'pending');

comment on view compliance_review_queue_v is
  '§4.1 Needs review: every pending document and every pending Yes declaration on a live profile (Rejected and Removed drop out), plus — kind ''rtw_date'' — every live non-UK worker whose latest verified share code report carries no right-to-work date and no settled-status confirmation while their own date is NULL (20260927160000, ADR-0018). Oldest first is the screen''s sort; review_reason says why a non-pending row is here; manual_review_reason says why the extractor flagged a document beyond its confidence — "letter expired" for a term letter whose dates are all past, which Verify refuses (§4.2, 20260927181100, 20260927185000). security_invoker: admin_all on the base tables is the gate.';

revoke all on compliance_review_queue_v from public, anon;
grant select on compliance_review_queue_v to authenticated, service_role;
