-- =====================================================================
-- Migration 20261008100000 · who verified a document (§2.6, §4.1)
--
-- /staff/:id and /onboarding/:id both print "Verified by <name> · <UK stamp>"
-- under a document, but the name was blank for every document the READING
-- admin had not verified themselves. staff_documents_v is security_invoker
-- and joined profiles directly; profiles_self lets a user read only their
-- own row (010_rls_admin pins that, 001_rls_guard names profiles as the
-- one table admin has no wider policy on), so the join returned NULL for
-- anyone else's verification and the screens fell back to a bare "Verified".
--
-- Widening profiles for admin would hand every office user every account's
-- name, role and client link. Instead one narrow security-definer lookup
-- returns ONE column — full_name — for ONE id, and only to a signed-in
-- Back Office session. The view calls it; profiles keeps its policy.
--
-- A share code the automated gov.uk check verified (ADR-0025) has no
-- reviewer; it now reads "Automatic gov.uk check" instead of nothing.
-- GDPR removal already rewrites profiles.full_name to "Deleted account #id".
--
-- staff_documents_v is restated from 20261007130000, every column in
-- place and in order. Privileges are unchanged (create or replace keeps them).
-- =====================================================================

create or replace function public.reviewer_name(p_profile uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.full_name
    from profiles p
   where p.id = p_profile
     and public.current_app_role() = 'admin'
$$;

comment on function public.reviewer_name(uuid) is
  'The display name of the person who reviewed a document, for the Back Office audit line "Verified by <name>". One column, one id, admin sessions only (NULL for anyone else): profiles_self stays the only policy on profiles. 20261008100000.';

revoke execute on function public.reviewer_name(uuid) from public, anon;
grant  execute on function public.reviewer_name(uuid) to authenticated, service_role;

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
                 s.right_to_work_until, c.uploaded_at, c.term_dates) as expires_on,
  c.ai_confidence,
  c.needs_manual_review,
  c.rejection_reason,
  c.reviewed_at,
  coalesce(public.reviewer_name(c.reviewed_by),
           case when c.reviewed_by is null and c.reviewed_at is not null
                 and c.doc_type = 'share_code_report'
                then 'Automatic gov.uk check' end)       as reviewed_by_name,
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
