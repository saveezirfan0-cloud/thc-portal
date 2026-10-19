-- =====================================================================
-- Identity, bank and AI-review columns leave the API roles (ADR-0163)
--
-- Security review 17.10.2026, M1 and L3. A worker's own session could read
-- the raw values straight from PostgREST, whatever the screens mask:
--
--     GET /rest/v1/bank_details?select=account_number,sort_code
--     GET /rest/v1/staff?select=ni_number,share_code,dob,home_address
--     GET /rest/v1/compliance_docs?select=ai_extracted,ai_confidence,
--                                        needs_manual_review,manual_review_reason
--
-- so a stolen, signed-in phone was a complete identity-and-bank pack, and
-- a worker could watch the AI's read of a forged letter and tune it until
-- the flag cleared. `staff_self` / `staff_self_bank` / `staff_self_docs`
-- give the worker their own ROW; RLS never narrows columns.
--
-- The shape is #44's and ADR-0017's (20260923090000, 20260923220000), a
-- few columns wider:
--
--   1. the column privilege goes from anon and authenticated. Admin and
--      worker are both `authenticated`, so the office loses it too;
--   2. the office reads the values back through three owner-rights views
--      (ADR-0004), columns named, the gate in the body:
--        staff_identity_v        dob, home_address, share_code, ni_number
--                                (admin)
--        staff_bank_masked_v     the two bank masks, never the numbers
--                                (admin with office_can('finance'), the
--                                same test bank_details' restrictive
--                                office_finance_read applies)
--        compliance_doc_review_v share_code, claimed_dob, the AI's
--                                confidence and term-letter read,
--                                needs_manual_review, manual_review_reason,
--                                with the type, status and upload time the
--                                /compliance check monitor filters on
--                                (admin)
--   3. the six security_invoker office views that read those columns read
--      them through the three above instead. Names, types and order of
--      every output column are unchanged, so `create or replace` keeps
--      every office column list and every dependant;
--   4. the two invoker helpers every cap and onboarding path runs through
--      (weekly_cap_for, onboarding_documents_missing) branch on the
--      caller's own column privilege. The owner, a job or the service role
--      read the row as before — every definer chain that judges ANOTHER
--      worker (accept_invite, apply_to_shift, the auto-assign rounds)
--      runs there, so the under-18 cap cannot be dropped by an admin gate.
--      An API caller gets the two facts from staff_identity_facts(), a
--      definer that answers an admin or the worker themselves and nobody
--      else: exactly the rows staff's own RLS returns to each. A worker
--      learns their own date of birth, which their Profile shows anyway.
--      (Not a helper in `private`: 522 and 608 pin that schema shut to
--      both API roles, and an invoker caller would need USAGE on it.)
--
-- The worker's screens are untouched: staff_me(), onboarding_state() and
-- staff_documents() are definers and return what each wireframe shows
-- (wireframes/staff/profile.html and onboarding-3.html print the sort
-- code, account number and share code in full; NI is masked). The one
-- change there is L3: onboarding_state() stops carrying
-- `needsManualReview`, which no worker screen reads.
--
-- Payroll and new-starter exports are definers (new_starter_rows,
-- payroll_export_rows) or the service role, which keeps its table grants.
--
-- Every body below is re-created from the deployed definition, not from an
-- older migration file (docs/10 §3b): pg_get_viewdef / pg_get_functiondef
-- on dgxtqvalfiisfpbwodew, md5-checked against a local build on 19.10.2026
-- — except onboarding_candidates_v and weekly_cap_for, which the go-live
-- branch's 20261019192200 and 20261019192000 rewrite first; those two are
-- built on that branch's bodies, so this migration does not undo them.
-- Only the expressions named above change.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · staff_identity_facts(): the two facts an invoker path needs
--
-- Only what weekly_cap_for() (the under-18 cap) and
-- onboarding_documents_missing() ("dob" / "share_code" missing) read:
-- the date of birth and whether a share code was entered, never the code.
-- The gate matches staff's RLS for an API caller — admin_all, or the
-- worker's own row through staff_caller(), which also refuses a dead
-- session and a banned login — so calling it directly over /rpc teaches
-- nobody anything they could not already read on their own screen.
-- ---------------------------------------------------------------------
create or replace function public.staff_identity_facts(p_staff uuid)
returns table (dob date, has_share_code boolean)
language sql
stable
security definer
set search_path = public
as $$
  select s.dob, s.share_code is not null
    from public.staff s
   where s.id = p_staff
     and ((select current_app_role()) = 'admin' or s.id = (select staff_caller()))
$$;

comment on function public.staff_identity_facts(uuid) is
  'ADR-0163: the date of birth and "a share code was entered" for one worker, for the invoker helpers weekly_cap_for() and onboarding_documents_missing() when they run as an API caller, who no longer holds staff.dob or staff.share_code. Answers an admin or the worker themselves (staff_caller()), nobody else.';

revoke all on function public.staff_identity_facts(uuid) from public, anon;
grant execute on function public.staff_identity_facts(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2 · The office's three routes back (ADR-0004, owner rights)
--
-- `(select current_app_role())` is an initplan: once per statement, not
-- once per row of the board that joins these. `current_user` is the
-- caller's role here (a view does not change it): a definer, a job or the
-- service role, which already read the base tables in full, read these in
-- full too — so a definer that later reads one of the six office views
-- does not lose the columns to the admin gate.
-- ---------------------------------------------------------------------
create or replace view public.staff_identity_v with (security_barrier = true) as
select
  s.id                                                     as staff_id,
  case when s.removed_at is null then s.dob end            as dob,
  case when s.removed_at is null then s.home_address end   as home_address,
  case when s.removed_at is null then s.share_code end     as share_code,
  case when s.removed_at is null then s.ni_number end      as ni_number
from public.staff s
where (select current_app_role()) = 'admin'
   or current_user not in ('anon', 'authenticated');

comment on view public.staff_identity_v is
  'ADR-0163: the only route to staff.dob, home_address, share_code and ni_number for a PostgREST role. Owner rights + the admin gate in the body (ADR-0004); a worker reads their own values through staff_me() / onboarding_state(), which show what the wireframes show.';

create or replace view public.staff_bank_masked_v with (security_barrier = true) as
select
  b.staff_id,
  case when b.sort_code is not null then "left"(b.sort_code, 2) || '-••-••' end as sort_code_masked,
  case when b.account_number is not null then '••••' || "right"(b.account_number, 4) end as account_masked
from public.bank_details b
where ((select current_app_role()) = 'admin' and (select office_can('finance')))
   or current_user not in ('anon', 'authenticated');

comment on view public.staff_bank_masked_v is
  'ADR-0163: the masked sort code and account number for the office''s profile and candidate screens — never the numbers, which leave the database only in the definer-built payroll and new-starter files. Gated like bank_details.office_finance_read: admin with the finance permission.';

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
        END as ai_term_letter
from public.compliance_docs d
where (select current_app_role()) = 'admin'
   or current_user not in ('anon', 'authenticated');

comment on view public.compliance_doc_review_v is
  'ADR-0163 (security review L3): the reviewer''s columns of compliance_docs — the typed share code and date of birth, the AI''s confidence and term-letter read, and the manual-review flag and reason. Owner rights + the admin gate in the body; the worker sees none of them (staff_documents() gives them the last three characters of the code).';

revoke all on table public.staff_identity_v, public.staff_bank_masked_v, public.compliance_doc_review_v
  from public, anon, authenticated;
grant select on table public.staff_identity_v, public.staff_bank_masked_v, public.compliance_doc_review_v
  to authenticated;

-- ---------------------------------------------------------------------
-- 3 · The six office views read through them
-- ---------------------------------------------------------------------
create or replace view public.staff_profile_v with (security_invoker = true) as
 SELECT d.id,
    d.employee_id,
    d.status,
    d.removed,
    d.display_name,
    d.photo_path,
    d.rating,
    d.reliability,
    d.block_kind,
    d.block_reason,
    d.rtw_branch,
    d.right_to_work_until,
    d.graduated_at,
    d.wtr_optout,
    d.left_at,
    d.leave_reason,
    d.role_names,
    d.unresolved_violations,
    d.do_not_return_clients,
    d.weekly_cap_hours,
    d.weekly_cap_band,
    d.weekly_booked_hours,
    d.weekly_cap_until,
    d.last_shift_at,
    d.released_shift_count,
    d.p45_requested_at,
    d.weekly_worked_hours,
        CASE
            WHEN s.removed_at IS NULL THEN s.email
            ELSE NULL::text
        END AS email,
        CASE
            WHEN s.removed_at IS NULL THEN s.phone
            ELSE NULL::text
        END AS phone,
        CASE
            WHEN s.removed_at IS NULL THEN si.dob
            ELSE NULL::date
        END AS dob,
        CASE
            WHEN s.removed_at IS NULL THEN si.home_address
            ELSE NULL::text
        END AS home_address,
        CASE
            WHEN s.removed_at IS NULL THEN si.share_code
            ELSE NULL::text
        END AS share_code,
        CASE
            WHEN s.removed_at IS NOT NULL OR si.ni_number IS NULL THEN NULL::text
            ELSE repeat('●'::text, GREATEST(length(si.ni_number) - 2, 0)) || "right"(si.ni_number, 2)
        END AS ni_number_masked,
    si.ni_number IS NOT NULL AS has_ni_number,
    s.term_dates,
    s.contract_signed_at,
    s.contract_version,
    s.created_at AS joined_at,
    s.quiz_attempts,
        CASE
            WHEN s.removed_at IS NULL THEN bd.account_holder
            ELSE NULL::text
        END AS bank_account_holder,
        CASE
            WHEN s.removed_at IS NOT NULL THEN NULL::text
            ELSE bm.sort_code_masked
        END AS bank_sort_code_masked,
        CASE
            WHEN s.removed_at IS NOT NULL THEN NULL::text
            ELSE bm.account_masked
        END AS bank_account_masked,
        CASE
            WHEN s.removed_at IS NULL THEN bd.updated_at
            ELSE NULL::timestamp with time zone
        END AS bank_updated_at,
        CASE
            WHEN s.removed_at IS NULL THEN h.statement
            ELSE NULL::hmrc_statement
        END AS hmrc_statement,
        CASE
            WHEN s.removed_at IS NULL THEN h.student_loan
            ELSE NULL::student_loan_plan
        END AS hmrc_student_loan,
        CASE
            WHEN s.removed_at IS NULL THEN h.postgraduate_loan
            ELSE NULL::boolean
        END AS hmrc_postgraduate_loan,
        CASE
            WHEN s.removed_at IS NULL THEN h.submitted_at
            ELSE NULL::timestamp with time zone
        END AS hmrc_declared_at,
    (( SELECT count(*) AS count
           FROM bookings b
          WHERE b.staff_id = s.id AND b.status = 'worked'::booking_status))::integer AS shifts_worked,
    (( SELECT count(*) AS count
           FROM violations v
          WHERE v.staff_id = s.id AND v.type = 'no_show'::violation_type AND NOT v.resolved))::integer AS no_shows,
    (( SELECT count(*) AS count
           FROM feedback f
          WHERE f.staff_id = s.id AND (f.author_kind = 'office'::feedback_author OR f.read_at IS NOT NULL)))::integer AS feedback_count,
    (( SELECT count(*) AS count
           FROM compliance_docs c
          WHERE c.staff_id = s.id AND c.review_status = 'pending'::review_status))::integer AS documents_pending,
    (( SELECT count(*) AS count
           FROM client_qualifications q
          WHERE q.staff_id = s.id))::integer AS qualification_count
   FROM staff_directory_v d
     JOIN staff s ON s.id = d.id
     LEFT JOIN bank_details bd ON bd.staff_id = s.id
     LEFT JOIN staff_bank_masked_v bm ON bm.staff_id = s.id
     LEFT JOIN staff_identity_v si ON si.staff_id = s.id
     LEFT JOIN hmrc_checklists h ON h.staff_id = s.id AND NOT h.superseded;

create or replace view public.onboarding_candidates_v with (security_invoker = true) as
 SELECT s.id,
    s.first_name,
    s.last_name,
    (s.first_name || ' '::text) || s.last_name AS display_name,
    s.email,
    s.phone,
    si.dob,
        CASE
            WHEN si.dob IS NOT NULL THEN EXTRACT(year FROM age((now() AT TIME ZONE 'Europe/London'::text)::date::timestamp with time zone, si.dob::timestamp with time zone))::integer
            ELSE NULL::integer
        END AS age,
    s.applied_age_band,
    s.photo_path,
    s.status,
    s.stage_entered_at,
    s.onboarding_started_at,
    s.created_at AS applied_at,
    s.gdpr_consent_at,
    s.employee_id,
    s.rtw_branch,
    s.right_to_work_until,
    si.share_code,
    COALESCE(staff_account_activated(s.id), false) AS activated,
    COALESCE(( SELECT array_agg(r.name ORDER BY r.name) AS array_agg
           FROM staff_roles sr
             JOIN roles r ON r.id = sr.role_id
          WHERE sr.staff_id = s.id), '{}'::text[]) AS role_names,
    COALESCE(( SELECT array_agg(sr.role_id) AS array_agg
           FROM staff_roles sr
          WHERE sr.staff_id = s.id), '{}'::uuid[]) AS role_ids,
    s.willo_candidate_id IS NOT NULL AS willo_linked,
        CASE
            WHEN s.willo_candidate_id IS NOT NULL AND jsonb_typeof(( SELECT settings.value
               FROM settings
              WHERE settings.key = 'willo_review_url_template'::text)) = 'string'::text THEN replace(( SELECT settings.value #>> '{}'::text[]
               FROM settings
              WHERE settings.key = 'willo_review_url_template'::text), '{id}'::text, s.willo_candidate_id)
            ELSE NULL::text
        END AS willo_review_url,
    s.willo_invited_at,
    s.willo_answers_done,
    s.willo_answers_total,
    s.willo_completed_at,
    s.willo_decision,
    s.willo_decided_at,
    s.willo_decided_via,
    docs.docs_total,
    docs.docs_verified,
    docs.docs_pending,
    docs.docs_rejected,
    ( SELECT max(c.reviewed_at) AS max
           FROM compliance_docs c
          WHERE c.staff_id = s.id AND c.review_status = 'rejected'::review_status) AS last_doc_rejected_at,
    onboarding_documents_missing(s.id) AS docs_missing,
    onboarding_quiz_blockers(s.id) AS quiz_blockers,
    ( SELECT c.answer
           FROM criminal_declarations c
          WHERE c.staff_id = s.id AND NOT c.superseded
          ORDER BY c.declared_at DESC
         LIMIT 1) AS declaration_answer,
    ( SELECT c.review_status
           FROM criminal_declarations c
          WHERE c.staff_id = s.id AND NOT c.superseded
          ORDER BY c.declared_at DESC
         LIMIT 1) AS declaration_status,
    quiz.quiz_attempts_used,
    quiz.quiz_best_score,
    quiz.quiz_passed_at,
    ( SELECT h.submitted_at
           FROM hmrc_checklists h
          WHERE h.staff_id = s.id AND NOT h.superseded) AS hmrc_submitted_at,
    (( SELECT count(*) AS count
           FROM staff_references r
          WHERE r.staff_id = s.id))::integer AS references_count,
    (EXISTS ( SELECT 1
           FROM bank_details b
          WHERE b.staff_id = s.id)) AS bank_saved,
    si.ni_number IS NOT NULL AS ni_entered,
    s.contract_signed_at,
    s.contract_version,
    s.rejected_at,
    s.rejected_from,
    s.rejection_cause,
    ( SELECT r.rejection_reason
           FROM staff_rejection_reason_v r
          WHERE r.staff_id = s.id) AS rejection_reason,
    p.full_name AS rejected_by_name,
    staff_account_activated_at(s.id) AS activated_at,
    ( SELECT
                CASE
                    WHEN p_1.hmrc_at IS NOT NULL AND p_1.references_at IS NOT NULL AND p_1.bank_at IS NOT NULL THEN GREATEST(p_1.hmrc_at, p_1.references_at, p_1.bank_at)
                    ELSE NULL::timestamp with time zone
                END AS "case"
           FROM onboarding_progress p_1
          WHERE p_1.staff_id = s.id) AS additional_info_done_at,
    COALESCE(quiz.quiz_scores, '{}'::integer[]) AS quiz_scores,
    s.spudbros_express,
    s.thc_shifts_enabled,
    s.payroll_id
   FROM staff s
     LEFT JOIN profiles p ON p.id = s.rejected_by
     LEFT JOIN staff_identity_v si ON si.staff_id = s.id
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS docs_total,
            count(*) FILTER (WHERE d.status = 'verified'::review_status)::integer AS docs_verified,
            count(*) FILTER (WHERE d.status = 'pending'::review_status)::integer AS docs_pending,
            count(*) FILTER (WHERE d.status = 'rejected'::review_status)::integer AS docs_rejected
           FROM current_compliance_docs(s.id) d(doc_id, doc_type, status)) docs ON true
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS quiz_attempts_used,
            max(q.score) AS quiz_best_score,
            min(q.taken_at) FILTER (WHERE q.passed) AS quiz_passed_at,
            array_agg(round(q.score)::integer ORDER BY q.attempt_no) AS quiz_scores
           FROM quiz_attempts q
          WHERE q.staff_id = s.id AND q.taken_at >= s.onboarding_started_at) quiz ON true
  WHERE s.removed_at IS NULL;

create or replace view public.student_visa_v with (security_invoker = true) as
 SELECT d.id,
    d.display_name,
    d.employee_id,
    d.photo_path,
    d.status,
    d.weekly_cap_hours,
    d.weekly_cap_band,
    d.weekly_booked_hours,
    d.right_to_work_until,
    d.graduated_at,
    d.wtr_optout,
    ( SELECT max(c.reviewed_at) AS max
           FROM compliance_docs c
          WHERE c.staff_id = d.id AND c.doc_type = 'university_term_dates_letter'::doc_type AND c.review_status = 'verified'::review_status) AS term_letter_verified_at,
    ( SELECT max(doc_expires_on(c.doc_type, c.expiry_date, c.right_to_work_until, d.right_to_work_until, c.uploaded_at, c.term_dates)) AS max
           FROM compliance_docs c
          WHERE c.staff_id = d.id AND c.doc_type = 'university_term_dates_letter'::doc_type AND c.review_status = 'verified'::review_status) AS term_letter_expires_at,
    ( SELECT max(c.reviewed_at) AS max
           FROM compliance_docs c
          WHERE c.staff_id = d.id AND c.doc_type = 'university_completion_letter'::doc_type AND c.review_status = 'verified'::review_status) AS completion_letter_verified_at,
    (EXISTS ( SELECT 1
           FROM compliance_docs c
          WHERE c.staff_id = d.id AND c.doc_type = 'university_completion_letter'::doc_type AND c.review_status = 'pending'::review_status)) AS completion_letter_in_review,
    s.below_degree_level,
    s.course_completion_date,
    ( SELECT c.review_status::text AS review_status
           FROM compliance_docs c
          WHERE c.staff_id = d.id AND c.doc_type = 'university_completion_letter'::doc_type AND c.review_status <> 'superseded'::review_status
          ORDER BY c.uploaded_at DESC, c.id DESC
         LIMIT 1) AS completion_letter_status,
    ( SELECT c.rejection_reason
           FROM compliance_docs c
          WHERE c.staff_id = d.id AND c.doc_type = 'university_completion_letter'::doc_type AND c.review_status <> 'superseded'::review_status
          ORDER BY c.uploaded_at DESC, c.id DESC
         LIMIT 1) AS completion_letter_rejection,
    ( SELECT c.completion_date_claimed
           FROM compliance_docs c
          WHERE c.staff_id = d.id AND c.doc_type = 'university_completion_letter'::doc_type AND c.review_status = 'pending'::review_status
          ORDER BY c.uploaded_at DESC
         LIMIT 1) AS completion_date_claimed,
        CASE
            WHEN s.course_completion_date IS NOT NULL AND s.graduated_at IS NOT NULL THEN completion_effective_from(s.course_completion_date, s.graduated_at)
            ELSE NULL::date
        END AS completion_effective_from,
    s.wtr_optout_cancelled_from,
    si.dob IS NOT NULL AND (si.dob + '18 years'::interval)::date <= (now() AT TIME ZONE 'Europe/London'::text)::date AS optout_eligible,
    d.right_to_work_until - (now() AT TIME ZONE 'Europe/London'::text)::date AS rtw_days_left
   FROM staff_directory_v d
     JOIN staff s ON s.id = d.id
     LEFT JOIN staff_identity_v si ON si.staff_id = s.id
  WHERE d.rtw_branch = 'international_student'::rtw_branch AND NOT d.removed;

create or replace view public.share_code_dob_claims_v with (security_invoker = true) as
 SELECT d.id AS document_id,
    d.staff_id,
    dp.claimed_dob,
    si.dob AS profile_dob,
    COALESCE(s.wtr_optout, false) AND s.wtr_optout_signed_at IS NOT NULL AND (dp.claimed_dob + '18 years'::interval)::date > (s.wtr_optout_signed_at AT TIME ZONE 'Europe/London'::text)::date AS opt_out_signed_under_18
   FROM compliance_docs d
     JOIN staff s ON s.id = d.staff_id
     JOIN compliance_doc_review_v dp ON dp.document_id = d.id
     LEFT JOIN staff_identity_v si ON si.staff_id = s.id
  WHERE d.doc_type = 'share_code_report'::doc_type AND d.review_status = 'pending'::review_status AND dp.claimed_dob IS NOT NULL AND s.removed_at IS NULL;

create or replace view public.staff_documents_v with (security_invoker = true) as
 SELECT c.id,
    c.staff_id,
    c.doc_type,
    doc_label(c.doc_type) AS doc_label,
    c.review_status,
    c.review_status = 'superseded'::review_status AS superseded,
    c.file_path,
    c.uploaded_at,
    c.expiry_date,
    doc_expires_on(c.doc_type, c.expiry_date, c.right_to_work_until, s.right_to_work_until, c.uploaded_at, c.term_dates) AS expires_on,
    dp.ai_confidence,
    dp.needs_manual_review,
    c.rejection_reason,
    c.reviewed_at,
    COALESCE(reviewer_name(c.reviewed_by),
        CASE
            WHEN c.reviewed_by IS NULL AND c.reviewed_at IS NOT NULL AND c.doc_type = 'share_code_report'::doc_type THEN 'Automatic gov.uk check'::text
            ELSE NULL::text
        END) AS reviewed_by_name,
    dp.share_code,
    c.gov_report_path,
    c.right_to_work_until,
    c.term_dates,
    c.completion_date,
    c.awarding_institution,
    c.rtw_no_time_limit,
    c.ni_recheck,
    dp.ai_term_letter
   FROM compliance_docs c
     JOIN staff s ON s.id = c.staff_id
     LEFT JOIN compliance_doc_review_v dp ON dp.document_id = c.id;

create or replace view public.compliance_review_queue_v with (security_invoker = true) as
 SELECT 'document'::text AS kind,
    d.id AS item_id,
    s.id AS staff_id,
    (s.first_name || ' '::text) || s.last_name AS display_name,
    s.employee_id,
    s.status,
    s.status = ANY (ARRAY['interview_requested'::staff_status, 'interview_completed'::staff_status, 'documents'::staff_status, 'quiz'::staff_status, 'contract'::staff_status]) AS is_candidate,
    s.block_kind,
    ( SELECT r.block_reason
           FROM staff_block_reason_v r
          WHERE r.staff_id = s.id) AS block_reason,
    s.rtw_branch,
    s.photo_path,
    d.doc_type::text AS item_type,
    doc_label(d.doc_type) AS item_label,
    d.uploaded_at AS submitted_at,
    d.file_path,
    dp.ai_confidence,
    dp.needs_manual_review,
    d.expiry_date,
    d.term_dates,
    d.right_to_work_until AS doc_right_to_work_until,
    dp.share_code,
    d.awarding_institution,
    (EXISTS ( SELECT 1
           FROM compliance_docs p
          WHERE p.staff_id = d.staff_id AND p.doc_type = d.doc_type AND p.id <> d.id AND (p.review_status = ANY (ARRAY['verified'::review_status, 'rejected'::review_status])) AND p.uploaded_at <= d.uploaded_at)) AS is_reupload,
    ( SELECT p.rejection_reason
           FROM compliance_docs p
          WHERE p.staff_id = d.staff_id AND p.doc_type = d.doc_type AND p.id <> d.id AND p.review_status = 'rejected'::review_status AND p.uploaded_at <= d.uploaded_at
          ORDER BY p.uploaded_at DESC
         LIMIT 1) AS previous_rejection,
    NULL::text AS declaration_source,
    NULL::text AS declaration_details,
    NULL::date AS conviction_date,
    s.right_to_work_until AS staff_right_to_work_until,
    d.evidence_form,
    d.completion_date_claimed,
    d.mime_type,
    d.size_bytes,
    NULL::text AS review_reason,
    k.check_id AS rtw_check_id,
    k.status AS rtw_check_status,
    k.source AS rtw_check_source,
    k.outcome AS rtw_check_outcome,
    k.attempts AS rtw_check_attempts,
    COALESCE(k.finished_at, k.created_at) AS rtw_checked_at,
    COALESCE(k.review_reason,
        CASE
            WHEN k.stuck THEN format('The automatic gov.uk check has not run for over %s minutes — the schedule, its secret or the provider may be missing. Verify by hand from the report, and check job_runs.'::text, (EXTRACT(epoch FROM rtw_check_stale_after()) / 60::numeric)::integer)
            ELSE NULL::text
        END) AS rtw_check_reason,
    k.right_to_work_until AS rtw_check_until,
    k.no_time_limit AS rtw_check_no_time_limit,
    k.conditions AS rtw_check_conditions,
    k.report_path AS rtw_check_report_path,
        CASE
            WHEN d.doc_type = 'share_code_report'::doc_type THEN rtw_check_manual_allowed(d.id)
            ELSE NULL::boolean
        END AS rtw_manual_allowed,
    dp.manual_review_reason,
        CASE
            WHEN d.doc_type = 'ni_evidence'::doc_type THEN si.ni_number
            ELSE NULL::text
        END AS ni_number,
    s.below_degree_level,
    s.visa_weekly_hour_limit,
    k.term_time_limit_hours AS rtw_check_term_limit,
    d.gov_report_path
   FROM compliance_docs d
     JOIN staff s ON s.id = d.staff_id
     LEFT JOIN LATERAL ( SELECT l.check_id,
            l.document_id,
            l.staff_id,
            l.status,
            l.source,
            l.outcome,
            l.attempts,
            l.max_attempts,
            l.next_attempt_at,
            l.created_at,
            l.started_at,
            l.finished_at,
            l.right_to_work_until,
            l.no_time_limit,
            l.conditions,
            l.term_time_limit_hours,
            l.record_name,
            l.reference_number,
            l.review_reason,
            l.worker_reason,
            l.error,
            l.report_path,
            l.requested_by,
            l.reviewed_at,
            l.stuck
           FROM rtw_checks_latest_v l
          WHERE l.document_id = d.id) k ON true
     LEFT JOIN compliance_doc_review_v dp ON dp.document_id = d.id
     LEFT JOIN staff_identity_v si ON si.staff_id = s.id
  WHERE d.review_status = 'pending'::review_status AND (s.status <> ALL (ARRAY['rejected'::staff_status, 'removed'::staff_status])) AND s.removed_at IS NULL AND NOT COALESCE(d.doc_type = 'share_code_report'::doc_type AND (k.status = ANY (ARRAY['queued'::text, 'running'::text])) AND NOT k.stuck AND rtw_check_enabled(), false)
UNION ALL
 SELECT 'declaration'::text AS kind,
    c.id AS item_id,
    s.id AS staff_id,
    (s.first_name || ' '::text) || s.last_name AS display_name,
    s.employee_id,
    s.status,
    s.status = ANY (ARRAY['interview_requested'::staff_status, 'interview_completed'::staff_status, 'documents'::staff_status, 'quiz'::staff_status, 'contract'::staff_status]) AS is_candidate,
    s.block_kind,
    ( SELECT r.block_reason
           FROM staff_block_reason_v r
          WHERE r.staff_id = s.id) AS block_reason,
    s.rtw_branch,
    s.photo_path,
    'criminal_declaration'::text AS item_type,
    'Criminal Record declaration'::text AS item_label,
    c.declared_at AS submitted_at,
    NULL::text AS file_path,
    NULL::numeric AS ai_confidence,
    false AS needs_manual_review,
    NULL::date AS expiry_date,
    NULL::daterange[] AS term_dates,
    NULL::date AS doc_right_to_work_until,
    NULL::text AS share_code,
    NULL::text AS awarding_institution,
    false AS is_reupload,
    NULL::text AS previous_rejection,
    c.source::text AS declaration_source,
    c.details AS declaration_details,
    c.conviction_date,
    s.right_to_work_until AS staff_right_to_work_until,
    NULL::text AS evidence_form,
    NULL::date AS completion_date_claimed,
    NULL::text AS mime_type,
    NULL::bigint AS size_bytes,
    NULL::text AS review_reason,
    NULL::uuid AS rtw_check_id,
    NULL::text AS rtw_check_status,
    NULL::text AS rtw_check_source,
    NULL::text AS rtw_check_outcome,
    NULL::integer AS rtw_check_attempts,
    NULL::timestamp with time zone AS rtw_checked_at,
    NULL::text AS rtw_check_reason,
    NULL::date AS rtw_check_until,
    NULL::boolean AS rtw_check_no_time_limit,
    NULL::jsonb AS rtw_check_conditions,
    NULL::text AS rtw_check_report_path,
    NULL::boolean AS rtw_manual_allowed,
    NULL::text AS manual_review_reason,
    NULL::text AS ni_number,
    s.below_degree_level,
    s.visa_weekly_hour_limit,
    NULL::integer AS rtw_check_term_limit,
    NULL::text AS gov_report_path
   FROM criminal_declarations c
     JOIN staff s ON s.id = c.staff_id
  WHERE c.answer AND c.review_status = 'pending'::review_status AND NOT c.superseded AND (s.status <> ALL (ARRAY['rejected'::staff_status, 'removed'::staff_status])) AND s.removed_at IS NULL
UNION ALL
 SELECT 'rtw_date'::text AS kind,
    d.id AS item_id,
    s.id AS staff_id,
    (s.first_name || ' '::text) || s.last_name AS display_name,
    s.employee_id,
    s.status,
    s.status = ANY (ARRAY['interview_requested'::staff_status, 'interview_completed'::staff_status, 'documents'::staff_status, 'quiz'::staff_status, 'contract'::staff_status]) AS is_candidate,
    s.block_kind,
    ( SELECT r.block_reason
           FROM staff_block_reason_v r
          WHERE r.staff_id = s.id) AS block_reason,
    s.rtw_branch,
    s.photo_path,
    d.doc_type::text AS item_type,
    doc_label(d.doc_type) AS item_label,
    COALESCE(d.reviewed_at, d.uploaded_at) AS submitted_at,
    d.file_path,
    NULL::numeric AS ai_confidence,
    true AS needs_manual_review,
    NULL::date AS expiry_date,
    NULL::daterange[] AS term_dates,
    d.right_to_work_until AS doc_right_to_work_until,
    COALESCE(dp.share_code, si.share_code) AS share_code,
    NULL::text AS awarding_institution,
    false AS is_reupload,
    NULL::text AS previous_rejection,
    NULL::text AS declaration_source,
    NULL::text AS declaration_details,
    NULL::date AS conviction_date,
    s.right_to_work_until AS staff_right_to_work_until,
    NULL::text AS evidence_form,
    NULL::date AS completion_date_claimed,
    d.mime_type,
    d.size_bytes,
    'Right-to-work date missing — re-verify'::text AS review_reason,
    NULL::uuid AS rtw_check_id,
    NULL::text AS rtw_check_status,
    NULL::text AS rtw_check_source,
    NULL::text AS rtw_check_outcome,
    NULL::integer AS rtw_check_attempts,
    NULL::timestamp with time zone AS rtw_checked_at,
    NULL::text AS rtw_check_reason,
    NULL::date AS rtw_check_until,
    NULL::boolean AS rtw_check_no_time_limit,
    NULL::jsonb AS rtw_check_conditions,
    NULL::text AS rtw_check_report_path,
    NULL::boolean AS rtw_manual_allowed,
    NULL::text AS manual_review_reason,
    NULL::text AS ni_number,
    s.below_degree_level,
    s.visa_weekly_hour_limit,
    NULL::integer AS rtw_check_term_limit,
    d.gov_report_path
   FROM compliance_docs d
     JOIN staff s ON s.id = d.staff_id
     LEFT JOIN compliance_doc_review_v dp ON dp.document_id = d.id
     LEFT JOIN staff_identity_v si ON si.staff_id = s.id
  WHERE d.doc_type = 'share_code_report'::doc_type AND d.review_status = 'verified'::review_status AND d.right_to_work_until IS NULL AND NOT d.rtw_no_time_limit AND d.id = (( SELECT l.id
           FROM compliance_docs l
          WHERE l.staff_id = d.staff_id AND l.doc_type = 'share_code_report'::doc_type AND l.review_status = 'verified'::review_status
          ORDER BY l.uploaded_at DESC, l.id
         LIMIT 1)) AND s.rtw_branch IS NOT NULL AND s.rtw_branch <> 'uk_irish'::rtw_branch AND s.right_to_work_until IS NULL AND (s.status = ANY (ARRAY['documents'::staff_status, 'quiz'::staff_status, 'contract'::staff_status, 'compliant'::staff_status, 'blocked'::staff_status])) AND s.removed_at IS NULL AND NOT (EXISTS ( SELECT 1
           FROM compliance_docs p
          WHERE p.staff_id = d.staff_id AND p.doc_type = 'share_code_report'::doc_type AND p.review_status = 'pending'::review_status))
UNION ALL
 SELECT 'rtw_check'::text AS kind,
    k.check_id AS item_id,
    s.id AS staff_id,
    (s.first_name || ' '::text) || s.last_name AS display_name,
    s.employee_id,
    s.status,
    s.status = ANY (ARRAY['interview_requested'::staff_status, 'interview_completed'::staff_status, 'documents'::staff_status, 'quiz'::staff_status, 'contract'::staff_status]) AS is_candidate,
    s.block_kind,
    ( SELECT r.block_reason
           FROM staff_block_reason_v r
          WHERE r.staff_id = s.id) AS block_reason,
    s.rtw_branch,
    s.photo_path,
    'share_code_report'::text AS item_type,
    'gov.uk right-to-work check'::text AS item_label,
    COALESCE(k.finished_at, k.created_at) AS submitted_at,
    NULL::text AS file_path,
    NULL::numeric AS ai_confidence,
    false AS needs_manual_review,
    NULL::date AS expiry_date,
    NULL::daterange[] AS term_dates,
    NULL::date AS doc_right_to_work_until,
    dp.share_code,
    NULL::text AS awarding_institution,
    false AS is_reupload,
    NULL::text AS previous_rejection,
    NULL::text AS declaration_source,
    NULL::text AS declaration_details,
    NULL::date AS conviction_date,
    s.right_to_work_until AS staff_right_to_work_until,
    NULL::text AS evidence_form,
    NULL::date AS completion_date_claimed,
    NULL::text AS mime_type,
    NULL::bigint AS size_bytes,
    k.review_reason,
    k.check_id AS rtw_check_id,
    k.status AS rtw_check_status,
    k.source AS rtw_check_source,
    k.outcome AS rtw_check_outcome,
    k.attempts AS rtw_check_attempts,
    COALESCE(k.finished_at, k.created_at) AS rtw_checked_at,
    k.review_reason AS rtw_check_reason,
    k.right_to_work_until AS rtw_check_until,
    k.no_time_limit AS rtw_check_no_time_limit,
    k.conditions AS rtw_check_conditions,
    k.report_path AS rtw_check_report_path,
    false AS rtw_manual_allowed,
    NULL::text AS manual_review_reason,
    NULL::text AS ni_number,
    s.below_degree_level,
    s.visa_weekly_hour_limit,
    k.term_time_limit_hours AS rtw_check_term_limit,
    d.gov_report_path
   FROM rtw_checks_latest_v k
     JOIN compliance_docs d ON d.id = k.document_id
     JOIN staff s ON s.id = k.staff_id
     LEFT JOIN compliance_doc_review_v dp ON dp.document_id = d.id
  WHERE k.status = 'needs_review'::text AND k.outcome = 'no_right_to_work'::text AND k.reviewed_at IS NULL AND d.review_status <> 'pending'::review_status AND (s.status <> ALL (ARRAY['rejected'::staff_status, 'removed'::staff_status])) AND s.removed_at IS NULL
UNION ALL
 SELECT 'ni_check'::text AS kind,
    d.id AS item_id,
    s.id AS staff_id,
    (s.first_name || ' '::text) || s.last_name AS display_name,
    s.employee_id,
    s.status,
    s.status = ANY (ARRAY['interview_requested'::staff_status, 'interview_completed'::staff_status, 'documents'::staff_status, 'quiz'::staff_status, 'contract'::staff_status]) AS is_candidate,
    s.block_kind,
    ( SELECT r.block_reason
           FROM staff_block_reason_v r
          WHERE r.staff_id = s.id) AS block_reason,
    s.rtw_branch,
    s.photo_path,
    d.doc_type::text AS item_type,
    doc_label(d.doc_type) AS item_label,
    COALESCE(d.reviewed_at, d.uploaded_at) AS submitted_at,
    d.file_path,
    NULL::numeric AS ai_confidence,
    true AS needs_manual_review,
    NULL::date AS expiry_date,
    NULL::daterange[] AS term_dates,
    NULL::date AS doc_right_to_work_until,
    NULL::text AS share_code,
    NULL::text AS awarding_institution,
    false AS is_reupload,
    NULL::text AS previous_rejection,
    NULL::text AS declaration_source,
    NULL::text AS declaration_details,
    NULL::date AS conviction_date,
    s.right_to_work_until AS staff_right_to_work_until,
    NULL::text AS evidence_form,
    NULL::date AS completion_date_claimed,
    d.mime_type,
    d.size_bytes,
    'NI number entered after the NI evidence was verified — compare them'::text AS review_reason,
    NULL::uuid AS rtw_check_id,
    NULL::text AS rtw_check_status,
    NULL::text AS rtw_check_source,
    NULL::text AS rtw_check_outcome,
    NULL::integer AS rtw_check_attempts,
    NULL::timestamp with time zone AS rtw_checked_at,
    NULL::text AS rtw_check_reason,
    NULL::date AS rtw_check_until,
    NULL::boolean AS rtw_check_no_time_limit,
    NULL::jsonb AS rtw_check_conditions,
    NULL::text AS rtw_check_report_path,
    NULL::boolean AS rtw_manual_allowed,
    NULL::text AS manual_review_reason,
    si.ni_number,
    s.below_degree_level,
    s.visa_weekly_hour_limit,
    NULL::integer AS rtw_check_term_limit,
    NULL::text AS gov_report_path
   FROM compliance_docs d
     JOIN staff s ON s.id = d.staff_id
     LEFT JOIN staff_identity_v si ON si.staff_id = s.id
  WHERE d.doc_type = 'ni_evidence'::doc_type AND d.review_status = 'verified'::review_status AND d.ni_recheck AND si.ni_number IS NOT NULL AND (s.status <> ALL (ARRAY['rejected'::staff_status, 'removed'::staff_status])) AND s.removed_at IS NULL;

-- ---------------------------------------------------------------------
-- 4 · The two invoker helpers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.weekly_cap_for(p_staff uuid, p_date date)
 RETURNS cap_assessment
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_dob date;
begin
  -- 20261020120000 (ADR-0163): an API caller no longer holds staff.dob.
  -- The owner, a job and the service role run 20261019192000's body
  -- unchanged — every definer chain that judges ANOTHER worker
  -- (accept_invite, apply_to_shift, the rounds) runs here, so no gate can
  -- drop the under-18 cap. An API caller (the office's invoker views, a
  -- worker's own invoker read) gets the date of birth from
  -- staff_identity_facts(), which answers an admin or the worker
  -- themselves and nobody else: exactly the rows staff's RLS returns to
  -- each. The branch not taken is never executed, so its column
  -- reference is never permission-checked.
  if has_column_privilege('public.staff', 'dob', 'select') then
    -- 20261019192000: the SQL body as it was, in plpgsql so its plan is
    -- kept for the session instead of rebuilt on every call (ADR-0155).
    return (

    select weekly_cap(
      s.rtw_branch is not distinct from 'international_student'::rtw_branch,
      cap_term_state(s.term_dates, p_date),
      s.graduated_at is not null,
      s.wtr_optout,
      cap_week_start(p_date),
      s.below_degree_level,
      s.course_completion_date,
      s.right_to_work_until,
      s.wtr_optout_cancelled_from,
      cap_under_18(s.dob, cap_week_start(p_date)),
      s.graduated_at,
      case when s.rtw_branch in ('work_visa'::rtw_branch, 'dependant_other'::rtw_branch)
           then s.visa_weekly_hour_limit end
    )
    from staff s where s.id = p_staff
    );
  end if;

  select f.dob into v_dob from staff_identity_facts(p_staff) f;
  return (

  select weekly_cap(
    s.rtw_branch is not distinct from 'international_student'::rtw_branch,
    cap_term_state(s.term_dates, p_date),
    s.graduated_at is not null,
    s.wtr_optout,
    cap_week_start(p_date),
    s.below_degree_level,
    s.course_completion_date,
    s.right_to_work_until,
    s.wtr_optout_cancelled_from,
    cap_under_18(v_dob, cap_week_start(p_date)),
    s.graduated_at,
    case when s.rtw_branch in ('work_visa'::rtw_branch, 'dependant_other'::rtw_branch)
         then s.visa_weekly_hour_limit end
  )
  from staff s where s.id = p_staff
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.onboarding_documents_missing(p_staff uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  s_id         uuid;
  s_dob        date;
  s_rtw_branch rtw_branch;
  s_has_share_code boolean;
  have doc_type[];
  missing text[] := '{}';
begin
  -- Named columns only: `authenticated` may not read staff.block_reason,
  -- rejection_reason, dob or share_code (20261020120000, ADR-0163), so
  -- `select *` fails under the caller's rights. The owner, a job and the
  -- service role read the two facts off the row; an API caller finds the
  -- row under its own RLS first and gets them from staff_identity_facts()
  -- (an admin, or the worker themselves). The branch not taken is never
  -- executed, so its column references are never permission-checked.
  if has_column_privilege('public.staff', 'dob', 'select')
     and has_column_privilege('public.staff', 'share_code', 'select') then
    select id, dob, rtw_branch, share_code is not null
      into s_id, s_dob, s_rtw_branch, s_has_share_code
      from staff where id = p_staff;
  else
    select id, rtw_branch
      into s_id, s_rtw_branch
      from staff where id = p_staff;
    if s_id is not null then
      select f.dob, f.has_share_code
        into s_dob, s_has_share_code
        from staff_identity_facts(s_id) f;
    end if;
  end if;
  if s_id is null then
    return null;
  end if;

  select coalesce(array_agg(d.doc_type), '{}') into have
    from current_compliance_docs(p_staff) d;

  if s_dob is null then
    missing := missing || 'dob'::text;             -- §2.5: mandatory in every branch
  end if;

  if s_rtw_branch is null then
    missing := missing || 'rtw_branch'::text;
  else
    case s_rtw_branch
      when 'uk_irish' then
        -- passport OR birth certificate + a document showing the NI number
        -- (List A; kept by ADR-0078)
        if not ('passport' = any(have)) then
          if 'birth_certificate' = any(have) then
            if not ('ni_evidence' = any(have)) then
              missing := missing || 'ni_evidence'::text;
            end if;
          else
            missing := missing || 'passport'::text;
          end if;
        end if;
      when 'eu_settled' then
        if not ('passport' = any(have) or 'national_id' = any(have)) then
          missing := missing || 'passport'::text;
        end if;
      when 'international_student' then
        if not ('passport' = any(have)) then missing := missing || 'passport'::text; end if;
        -- ADR-0112: a graduate uploads the completion letter INSTEAD. A
        -- rejected one answers nothing, so the term letter is owed again.
        if not ('university_term_dates_letter' = any(have))
           and not exists (select 1 from current_compliance_docs(p_staff) c
                            where c.doc_type = 'university_completion_letter'
                              and c.status <> 'rejected') then
          missing := missing || 'university_term_dates_letter'::text;
        end if;
      when 'work_visa', 'dependant_other' then
        -- The share code below is the visa evidence (ADR-0078).
        if not ('passport' = any(have)) then missing := missing || 'passport'::text; end if;
    end case;

    -- The share code is typed, never uploaded (§2.5), and every branch
    -- but the first carries one.
    if s_rtw_branch <> 'uk_irish' and not coalesce(s_has_share_code, false) then
      missing := missing || 'share_code'::text;
    end if;
  end if;

  -- The declaration sits on the same step (4/11) and is part of the same
  -- single blocker (§2.10).
  if not exists (select 1 from criminal_declarations c
                  where c.staff_id = p_staff and not c.superseded) then
    missing := missing || 'criminal_declaration'::text;
  end if;

  return missing;
end $function$;

-- ---------------------------------------------------------------------
-- 5 · L3: onboarding_state() stops handing the worker the review flag.
--     Live body, one line removed.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.onboarding_state()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_id uuid := staff_caller();
  s staff;
  p onboarding_progress;
  v_docs jsonb;
  v_decl jsonb;
  v_quiz jsonb;
  v_hmrc jsonb;
  v_refs jsonb;
  v_bank jsonb;
  v_contract jsonb;
  v_version text := current_contract_version();
begin
  if v_id is null then
    return null;
  end if;
  select * into s from staff where id = v_id;
  select * into p from onboarding_progress where staff_id = v_id;

  -- The latest non-superseded row per type: what the office is looking at.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                d.id,
           'docType',           d.doc_type::text,
           'status',            d.review_status::text,
           'fileName',          d.file_name,
           'fileSize',          coalesce(d.size_bytes, d.file_size),
           'uploadedAt',        d.uploaded_at,
           'expiryDate',        d.expiry_date,
           'rightToWorkUntil',  d.right_to_work_until,
           'rejectionReason',   d.rejection_reason,
           'reviewedAt',        d.reviewed_at,
           'termDates',         case when d.term_dates is null then null
                                     else (select jsonb_agg(jsonb_build_object(
                                             'from', lower(r), 'to', upper(r) - 1))
                                             from unnest(d.term_dates) r) end,
           'shareCode',         d.share_code)
           order by d.uploaded_at), '[]'::jsonb)
    into v_docs
    from compliance_docs d
    join current_compliance_docs(v_id) c on c.doc_id = d.id;

  select jsonb_build_object(
           'answer',       c.answer,
           'status',       c.review_status::text,
           'declaredAt',   c.declared_at,
           'reviewedAt',   c.reviewed_at)
    into v_decl
    from criminal_declarations c
   where c.staff_id = v_id and not c.superseded and c.source = 'onboarding'
   order by c.declared_at desc, c.id desc
   limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'attemptNo', q.attempt_no,
           'percent',   q.score,
           'passed',    q.passed,
           'correct',   (q.answers->>'correct')::int,
           'total',     (q.answers->>'total')::int,
           'takenAt',   q.taken_at)
           order by q.attempt_no), '[]'::jsonb)
    into v_quiz
    from quiz_attempts q
   where q.staff_id = v_id and not q.superseded;

  select jsonb_build_object(
           'q1OtherJob',       h.q1_other_job,
           'q2Pension',        h.q2_pension,
           'q3Since6April',    h.q3_since_6_april,
           'studentLoan',      h.student_loan::text,
           'postgraduateLoan', h.postgraduate_loan,
           'submittedAt',      h.submitted_at)
    into v_hmrc
    from hmrc_checklists h
   where h.staff_id = v_id and not h.superseded;

  -- Referee 1, then Referee 2: the order they were entered in (§2.10).
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', r.name, 'relationship', r.relationship,
           'phone', r.phone, 'email', r.email) order by r.seq, r.name), '[]'::jsonb)
    into v_refs
    from staff_references r where r.staff_id = v_id;

  select jsonb_build_object(
           'accountHolder', b.account_holder,
           'sortCode',      b.sort_code,
           'accountNumber', b.account_number)
    into v_bank
    from bank_details b where b.staff_id = v_id;

  select jsonb_build_object(
           'version',       cv.version,
           'title',         cv.title,
           'body',          cv.body,
           'isPlaceholder', cv.is_placeholder)
    into v_contract
    from contract_versions cv where cv.version = v_version;

  return jsonb_build_object(
    'staffId',        s.id,
    'firstName',      s.first_name,
    'lastName',       s.last_name,
    'status',         s.status::text,
    'employeeId',     s.employee_id,
    'dob',            s.dob,
    'gender',         s.gender,
    'rtwBranch',      s.rtw_branch::text,
    'shareCode',      s.share_code,
    'wtrOptOut',      coalesce(s.wtr_optout, false) and s.wtr_optout_cancelled_from is null,
    'homeAddress',    s.home_address,
    'homePostcode',   s.home_postcode,
    'homeCountry',    s.home_country,
    'homeLat',        case when s.home_location is null then null
                           else st_y(s.home_location::geometry) end,
    'homeLng',        case when s.home_location is null then null
                           else st_x(s.home_location::geometry) end,
    'photoPath',      s.photo_path,
    'niMasked',       case when s.ni_number is null then null
                           else repeat('●', greatest(length(s.ni_number) - 2, 0))
                                || right(s.ni_number, 2) end,
    'quizAttempts',   s.quiz_attempts,
    'contractSignedAt', s.contract_signed_at,
    'contractVersion',  s.contract_version,
    'contractStamp',  case when s.contract_signed_at is null then null
                           else to_char(s.contract_signed_at at time zone 'Europe/London',
                                        'DD.MM.YYYY HH24:MI') || ' UK time' end,
    'progress', jsonb_build_object(
      'ukDocChoice',  p.uk_doc_choice,
      'visaType',     p.visa_type,
      'visaExpiry',   p.visa_expiry,
      'rtwAt',        p.rtw_at,
      'addressAt',    p.address_at,
      'selfieAt',     p.selfie_at,
      'documentsAt',  p.documents_at,
      'inductionAt',  p.induction_at,
      'hmrcAt',       p.hmrc_at,
      'referencesAt', p.references_at,
      'bankAt',       p.bank_at,
      'contractAt',   p.contract_at,
      'tutorialAt',   p.tutorial_at),
    'documents',   v_docs,
    'declaration', v_decl,
    'quiz',        v_quiz,
    'hmrc',        v_hmrc,
    'references',  v_refs,
    'bank',        v_bank,
    'contract',    v_contract);
end $function$;

-- ---------------------------------------------------------------------
-- 6 · The privileges themselves
--
-- staff: the table-wide SELECT went in 20260923090000, so a column revoke
-- is enough. bank_details and compliance_docs still hold the table-wide
-- SELECT, which a column revoke cannot narrow, so it is revoked and
-- re-granted by name — fail-closed, as #44 made staff: a column a later
-- migration adds is not readable by an API role until that migration says
-- so. anon gets nothing back (20261020120200 takes its table grants).
-- Writes are untouched: RLS already refuses them to a worker.
-- ---------------------------------------------------------------------
revoke select (dob, home_address, ni_number, share_code) on table public.staff from public, anon, authenticated;

revoke select on table public.bank_details from public, anon, authenticated;
grant select (staff_id, account_holder, updated_at) on table public.bank_details to authenticated;

revoke select on table public.compliance_docs from public, anon, authenticated;
do $$
declare
  v_columns text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
    into v_columns
    from pg_attribute a
   where a.attrelid = 'public.compliance_docs'::regclass
     and a.attnum > 0
     and not a.attisdropped
     and a.attname not in ('share_code', 'claimed_dob', 'ai_extracted', 'ai_confidence',
                           'needs_manual_review', 'manual_review_reason');
  execute format('grant select (%s) on table public.compliance_docs to authenticated', v_columns);
end $$;

comment on column public.staff.ni_number is
  'ADR-0163: not selectable by anon or authenticated. The office reads it through staff_identity_v, the worker sees it masked through staff_me() / onboarding_state(), payroll and new-starter files are built by definers.';
comment on column public.bank_details.account_number is
  'ADR-0163: not selectable by anon or authenticated. The worker''s own Bank & payroll form reads it through staff_me(); the office sees only staff_bank_masked_v; payroll and new-starter files are built by definers.';
comment on column public.compliance_docs.manual_review_reason is
  'Why the extraction or a later check flagged the document for a person (20260928110300). ADR-0163 (security review L3): not selectable by anon or authenticated; the office reads it through compliance_doc_review_v.';

-- ---------------------------------------------------------------------
-- 7 · Prove it landed (a silent no-op revoke is how 20260921123503 went
--     green with the leak open)
-- ---------------------------------------------------------------------
do $$
declare
  v_leak text;
begin
  select string_agg(format('%s.%s/%s', t.tbl, t.col, r.rol), ', ')
    into v_leak
    from (values ('staff', 'dob'), ('staff', 'home_address'), ('staff', 'ni_number'),
                 ('staff', 'share_code'), ('staff', 'block_reason'), ('staff', 'rejection_reason'),
                 ('bank_details', 'sort_code'), ('bank_details', 'account_number'),
                 ('compliance_docs', 'share_code'), ('compliance_docs', 'claimed_dob'),
                 ('compliance_docs', 'ai_extracted'), ('compliance_docs', 'ai_confidence'),
                 ('compliance_docs', 'needs_manual_review'),
                 ('compliance_docs', 'manual_review_reason')) t(tbl, col)
    cross join (values ('anon'), ('authenticated')) r(rol)
   where has_column_privilege(r.rol, format('public.%I', t.tbl), t.col, 'select');
  if v_leak is not null then
    raise exception 'ADR-0163: still selectable by an API role: %', v_leak;
  end if;

  if not has_column_privilege('authenticated', 'public.compliance_docs', 'review_status', 'select')
     or not has_column_privilege('authenticated', 'public.compliance_docs', 'rejection_reason', 'select')
     or not has_column_privilege('authenticated', 'public.bank_details', 'account_holder', 'select')
     or not has_column_privilege('authenticated', 'public.staff', 'first_name', 'select') then
    raise exception 'ADR-0163: the re-grant by name did not take';
  end if;
end $$;
