-- =====================================================================
-- Documents: name the manager who verified, for every manager
--
-- Why this exists
-- ---------------
-- The Documents tab of /staff/:id and /onboarding/:id prints
-- "Verified by <name> · <UK time>" when staff_documents_v returns
-- reviewed_by_name, and "Verified · <UK time>" when it is NULL. It was
-- NULL for everyone but the manager who did the verifying: the view reads
-- the name through `left join profiles`, the view is security_invoker, and
-- profiles' only policy is profiles_self — so Gisela sees her own name and
-- a colleague's verification comes back anonymous.
--
-- office_user_name(uuid) (20261004100000) is the narrow answer the
-- directory views already use: one question — "what is this office user
-- called?" — for an admin asking about an admin, NULL to anyone else. The
-- view stays security_invoker; only the name goes through the definer
-- function, so no new policy is added to profiles.
--
-- Restated from 20261002103000, every column in place and in position; the
-- only change is how reviewed_by_name is produced (and the join it no
-- longer needs). Privileges are unchanged (create or replace keeps them).
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
  office_user_name(c.reviewed_by)                            as reviewed_by_name,
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
join staff s on s.id = c.staff_id;

comment on view staff_documents_v is
  'The Documents tab of /staff/:id and /onboarding/:id: every document on a worker with its status, expiry, AI confidence and the reviewer''s name for the UK-time audit stamp. Superseded rows are flagged rather than filtered (kept read-only as the record of the previous period). rtw_no_time_limit is the settled-status confirmation on a share code report; ni_recheck marks NI evidence verified before the NI number was entered (20260930130500). ai_term_letter is what the AI read off a term letter besides its holidays — course start, expected end, and any hours statement in the letter''s own words — for the reviewer only: it never feeds the weekly cap (20261002103000).';
