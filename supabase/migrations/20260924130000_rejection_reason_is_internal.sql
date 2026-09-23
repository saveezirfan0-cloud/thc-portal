-- =====================================================================
-- §2.3 / ADR-0017 · the office's reason for rejecting a candidate is
-- internal
--
-- The defect (docs/14 §4, ADR-0017 "Consequences")
-- ------------------------------------------------
-- 20260923210000 granted `staff.rejection_reason` to anon and
-- authenticated with the rest of the 23.09 columns, and said so: a worker
-- could read the office's free-text reason for rejecting them off their
-- own row through `staff_self` —
--
--     GET /rest/v1/staff?select=rejection_reason
--
-- — exactly as they could read block_reason before #44. No screen shows
-- it and no email carries it (E2/E2b are fixed THC wording), but the API
-- is the boundary and the API published it.
--
-- The fix is #44's, one column wider (20260923090000, ADR-0004):
--
--   1. The column privilege goes. `anon` and `authenticated` lose SELECT
--      on staff.rejection_reason. Every other column keeps its grant.
--   2. The office's route back is an owner-rights, security_barrier view,
--      `staff_rejection_reason_v`, whose gate — current_app_role() =
--      'admin' — is in its own body, with §1.7's suppression for a
--      removed record applied in the same expression.
--   3. Every security_invoker view that read the column off `staff` is
--      restated to read it through that view instead. pg_depend (the
--      query 445 runs) finds exactly one: onboarding_candidates_v
--      (20260923110000). Its column list, order, types and reloption are
--      unchanged, so /onboarding and /onboarding/:id need no change.
--
-- Functions: every function body that reads staff.rejection_reason is
-- security definer (onboarding_reject, staff_status_guard,
-- willo_record_event) or reachable only through one (onboarding_do_reject,
-- whose EXECUTE authenticated does not hold), so none of them loses the
-- column. The Staff App never selected it.
--
-- Writes are untouched: RLS already refuses a worker any UPDATE on staff.
-- Forward-only; nothing here edits an earlier migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The base-table privilege
-- ---------------------------------------------------------------------
revoke select (rejection_reason) on table public.staff from public, anon, authenticated;

comment on column public.staff.rejection_reason is
  'The office''s reason for rejecting a candidate (§2.3, §2.7). Internal: neither anon nor authenticated holds SELECT on this column — admin and worker are the same Postgres role, so the office reads it through the owner-rights staff_rejection_reason_v (ADR-0004, ADR-0017) and nobody reads it off the table.';

-- ---------------------------------------------------------------------
-- 2 · The office's route back to it (ADR-0004)
-- ---------------------------------------------------------------------
create or replace view public.staff_rejection_reason_v with (security_barrier = true) as
select
  s.id                                                        as staff_id,
  case when s.removed_at is null then s.rejection_reason end  as rejection_reason
from public.staff s
where current_app_role() = 'admin';

comment on view public.staff_rejection_reason_v is
  'The office''s reason for rejecting a candidate, and the only route to staff.rejection_reason for a PostgREST role. Owner rights + `current_app_role() = ''admin''` in the body per ADR-0004 (the pattern of staff_block_reason_v, 20260923090000). §1.7''s suppression for a removed record is applied here. The worker never sees it (ADR-0017).';

revoke all on table public.staff_rejection_reason_v from public, anon, authenticated;
grant select on table public.staff_rejection_reason_v to authenticated;

-- ---------------------------------------------------------------------
-- 3 · onboarding_candidates_v reads it through the view
--
-- Byte-for-byte 20260923110000 §8 but for the one column. `create or
-- replace`: same names, types and order, same security_invoker reloption,
-- so staff RLS still decides which rows a caller reaches and nothing that
-- selects from the view moves.
-- ---------------------------------------------------------------------
create or replace view onboarding_candidates_v with (security_invoker = true) as
select
  s.id,
  s.first_name,
  s.last_name,
  s.first_name || ' ' || s.last_name                           as display_name,
  s.email,
  s.phone,
  s.dob,
  case when s.dob is not null
       then extract(year from age((now() at time zone 'Europe/London')::date, s.dob))::int end as age,
  s.applied_age_band,
  s.photo_path,
  s.status,
  s.stage_entered_at,
  s.onboarding_started_at,
  s.created_at                                                 as applied_at,
  s.gdpr_consent_at,
  s.employee_id,
  s.rtw_branch,
  s.right_to_work_until,
  s.share_code,
  s.user_id is not null                                        as activated,
  coalesce((select array_agg(r.name order by r.name)
              from staff_roles sr join roles r on r.id = sr.role_id
             where sr.staff_id = s.id), '{}'::text[])           as role_names,
  coalesce((select array_agg(sr.role_id)
              from staff_roles sr where sr.staff_id = s.id), '{}'::uuid[]) as role_ids,
  -- Willo (§2.4)
  s.willo_candidate_id is not null                             as willo_linked,
  case when s.willo_candidate_id is not null
        and jsonb_typeof((select value from settings where key = 'willo_review_url_template')) = 'string'
       then replace((select value #>> '{}' from settings where key = 'willo_review_url_template'),
                    '{id}', s.willo_candidate_id) end         as willo_review_url,
  s.willo_invited_at,
  s.willo_answers_done,
  s.willo_answers_total,
  s.willo_completed_at,
  s.willo_decision,
  s.willo_decided_at,
  s.willo_decided_via,
  -- Documents (§2.3): current rows only; superseded ones are the previous
  -- period's record and never count (§2.12).
  (select count(*) from current_compliance_docs(s.id))::int                        as docs_total,
  (select count(*) from current_compliance_docs(s.id) d where d.status = 'verified')::int as docs_verified,
  (select count(*) from current_compliance_docs(s.id) d where d.status = 'pending')::int  as docs_pending,
  (select count(*) from current_compliance_docs(s.id) d where d.status = 'rejected')::int as docs_rejected,
  (select max(c.reviewed_at) from compliance_docs c
    where c.staff_id = s.id and c.review_status = 'rejected')                      as last_doc_rejected_at,
  onboarding_documents_missing(s.id)                                               as docs_missing,
  onboarding_quiz_blockers(s.id)                                                   as quiz_blockers,
  (select c.answer from criminal_declarations c
    where c.staff_id = s.id and not c.superseded
    order by c.declared_at desc limit 1)                                           as declaration_answer,
  (select c.review_status from criminal_declarations c
    where c.staff_id = s.id and not c.superseded
    order by c.declared_at desc limit 1)                                           as declaration_status,
  -- Quiz (§2.9), this period only
  (select count(*) from quiz_attempts q
    where q.staff_id = s.id and q.taken_at >= s.onboarding_started_at)::int        as quiz_attempts_used,
  (select max(q.score) from quiz_attempts q
    where q.staff_id = s.id and q.taken_at >= s.onboarding_started_at)             as quiz_best_score,
  (select min(q.taken_at) from quiz_attempts q
    where q.staff_id = s.id and q.passed and q.taken_at >= s.onboarding_started_at) as quiz_passed_at,
  -- Additional info (§2.10), wizard steps 7-9
  (select h.submitted_at from hmrc_checklists h
    where h.staff_id = s.id and not h.superseded)                                  as hmrc_submitted_at,
  (select count(*) from staff_references r where r.staff_id = s.id)::int           as references_count,
  exists (select 1 from bank_details b where b.staff_id = s.id)                     as bank_saved,
  s.ni_number is not null                                                          as ni_entered,
  -- Contract (§2.11)
  s.contract_signed_at,
  s.contract_version,
  -- Rejection
  s.rejected_at,
  s.rejected_from,
  s.rejection_cause,
  -- ADR-0017 / O16: read through the owner-rights, admin-gated view; no
  -- PostgREST role holds the column on the table any more.
  (select r.rejection_reason from public.staff_rejection_reason_v r
    where r.staff_id = s.id)                                                      as rejection_reason,
  p.full_name                                                                      as rejected_by_name
from staff s
left join profiles p on p.id = s.rejected_by
where s.removed_at is null;

comment on view onboarding_candidates_v is
  'One row per non-removed person for /onboarding and /onboarding/:id (§2.2, §2.3): stage and days in it, Willo tracking, current-period document / declaration / quiz / additional-info progress, and the rejection record. security_invoker: staff is admin_all only, so a client sees nobody and a worker only themselves. rejection_reason comes from the owner-rights staff_rejection_reason_v (20260924130000): no PostgREST role holds the column on the table, and a worker reading their own row gets null.';

-- ---------------------------------------------------------------------
-- 4 · The migration checks its own outcome
-- ---------------------------------------------------------------------
do $$
declare v_readers text;
begin
  if has_column_privilege('authenticated', 'public.staff', 'rejection_reason', 'select')
     or has_column_privilege('anon', 'public.staff', 'rejection_reason', 'select') then
    raise exception 'staff.rejection_reason is still selectable by a PostgREST role: the revoke did not take (ADR-0017)';
  end if;
  if has_column_privilege('authenticated', 'public.staff', 'block_reason', 'select') then
    raise exception 'staff.block_reason became selectable again (§10.1)';
  end if;

  select string_agg(distinct c.relname::text, ', ')
    into v_readers
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
    join pg_class c on c.oid = r.ev_class
    join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
   where d.refobjid = 'public.staff'::regclass
     and a.attname = 'rejection_reason'
     and c.relname <> 'staff_rejection_reason_v';
  if v_readers is not null then
    raise exception 'views still read staff.rejection_reason directly and would answer 42501: %', v_readers;
  end if;
end $$;
