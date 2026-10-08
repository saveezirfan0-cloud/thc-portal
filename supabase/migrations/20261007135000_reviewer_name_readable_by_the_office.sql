-- =====================================================================
-- Migration 20261007135000 · who verified a document (§2.6, §4.1)
--
-- Numbered 20261007135000 here. It was first applied to the live project BY HAND as
-- 20261008100000 (08.10.2026), a number invite_roster then took on main. The live
-- history row was moved to 20261007135000 to match this file; the statements are
-- unchanged, so the comment strings below still say 20261008100000.
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
-- Back Office session, and only for a Back Office account (a reviewer is
-- always one): a worker's or client login's name stays out of reach. The
-- views call it; profiles keeps its policy.
--
-- A share code the automated gov.uk check verified (ADR-0025) has no
-- reviewer; it now reads "Automatic gov.uk check" instead of nothing.
--
-- The Criminal Record declaration is reviewed like a document and had the
-- same gap (the screens read criminal_declarations directly and never had a
-- name to show at all), so staff_declarations_v carries it too: the same
-- columns the two screens already select, plus reviewed_by_name.
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
   where (select public.current_app_role()) = 'admin'
     and p.id = p_profile
     and p.role = 'admin'
$$;

comment on function public.reviewer_name(uuid) is
  'The display name of the person who reviewed a document, for the Back Office audit line "Verified by <name>". One column, one id, admin sessions only and admin accounts only (NULL for anyone else, so a worker or client login cannot be looked up by uuid): profiles_self stays the only policy on profiles. 20261008100000.';

revoke execute on function public.reviewer_name(uuid) from public, anon;
grant  execute on function public.reviewer_name(uuid) to authenticated;

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

comment on view staff_documents_v is
  'The Documents tab of /staff/:id and /onboarding/:id: every document on a worker with its status, expiry, AI confidence and the reviewer''s name (reviewer_name(), 20261008100000) for the UK-time audit stamp "Verified by <name> · <stamp>". Superseded rows are flagged rather than filtered (kept read-only as the record of the previous period). rtw_no_time_limit is the settled-status confirmation on a share code report; ni_recheck marks NI evidence verified before the NI number was entered (20260930130500). ai_term_letter is what the AI read off a term letter besides its holidays, for the reviewer only: it never feeds the weekly cap (20261002103000).';

create or replace view staff_declarations_v with (security_invoker = true) as
select
  c.id,
  c.staff_id,
  c.source,
  c.answer,
  c.details,
  c.conviction_date,
  c.review_status,
  c.declared_at,
  c.reviewed_at,
  c.review_note,
  c.superseded,
  public.reviewer_name(c.reviewed_by)                        as reviewed_by_name
from criminal_declarations c;

comment on view staff_declarations_v is
  'criminal_declarations for the Back Office Documents tab and /onboarding/:id, with the reviewer''s name for "Verified by <name> · <stamp>" (20261008100000). security_invoker: the admin_all policy still decides the rows (a worker or client reads none). No reviewed_by uuid is exposed.';

-- Read-only: a single-table view is auto-updatable, and Supabase's default
-- privileges grant authenticated every right on a new view by name.
revoke all on staff_declarations_v from public, anon, authenticated;
grant select on staff_declarations_v to authenticated, service_role;
