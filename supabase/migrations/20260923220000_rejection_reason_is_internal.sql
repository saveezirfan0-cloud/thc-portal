-- =====================================================================
-- staff.rejection_reason is the office's, not the candidate's
--
-- The sibling of #44, in the column next door. `0001_init.sql:482` gives a
-- worker their own row and every column on it:
--
--     create policy staff_self on staff for select using (user_id = auth.uid());
--
-- so a rejected candidate could read the office's free-text reason for
-- rejecting them:
--
--     GET /rest/v1/staff?select=rejection_reason
--
-- ADR-0017 settles that this is internal. E2 and E2b are the rejection
-- emails, both mandatory, and it says in terms: "E2b is mandatory, like
-- E2, and never carries the office's reason." §2.9's E4 is its own email
-- and likewise carries no free text. The Staff App agrees — a `rejected`
-- worker gets E4's wording for a failed quiz and a neutral screen
-- otherwise, never the office's note.
--
-- `20260923210000` granted the column along with the rest of the 23.09
-- additions and recorded the gap at its line 24, pointing here. This is
-- that gap closed.
--
-- NOT this column: `compliance_docs.rejection_reason` is a different
-- column with the opposite rule. §2.6 requires a rejected DOCUMENT to
-- carry its reason to the worker so they can re-upload, and N8 sends it.
-- `staff_documents_v`, `student_visa_v` and `compliance_review_queue_v`
-- read that one (`c.` / `p.`, not `s.`) and are untouched here.
--
-- ---------------------------------------------------------------------
-- The shape, and why it is #44's
--
-- RLS filters rows, never columns, so a policy cannot hide this. And a
-- plain `revoke select (rejection_reason) ... from authenticated` would
-- close the office's board with it: admin and candidate are both
-- `authenticated`, and `onboarding_candidates_v` is security_invoker.
--
-- So, ADR-0004 one column wide, exactly as 20260923090000 did:
--
--   1. the table-wide SELECT is revoked and re-granted by name for every
--      column EXCEPT block_reason and rejection_reason;
--   2. the office reads it back through `staff_rejection_reason_v`, owner
--      rights, columns named, `current_app_role() = 'admin'` in the body;
--   3. `onboarding_candidates_v` reads through that view, keeping its
--      security_invoker reloption and its column list, types and order
--      byte-for-byte, so no office column list moves and no dependent
--      view needs dropping.
--
-- The fail-closed consequence 20260923090000 introduced still holds and
-- now covers two columns: a column added to `staff` by a later migration
-- is not readable by anon or authenticated until that migration grants it.
-- That is correct for a table carrying date of birth, NI number, home
-- address and right-to-work branch, and 20260923210000 is what it looks
-- like when it fires — a loud 42501, not a quiet leak.
--
-- Scope refs: §2.9 (rejection), §2.6 + N8 (document rejection, which is
-- the opposite rule), §1.4 (roles), ADR-0004, ADR-0017.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The base-table privilege
--
-- Re-granted BY NAME so the statement means "everything except these
-- two". Writes are untouched: RLS already refuses insert/update/delete
-- for a worker, and narrowing them here would be a second change riding
-- a security fix.
-- ---------------------------------------------------------------------
revoke select on table public.staff from public, anon, authenticated;

do $$
declare
  v_columns text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
    into v_columns
    from pg_attribute a
   where a.attrelid = 'public.staff'::regclass
     and a.attnum > 0
     and not a.attisdropped
     and a.attname not in ('block_reason', 'rejection_reason');

  execute format('grant select (%s) on table public.staff to anon, authenticated', v_columns);
end $$;

comment on column public.staff.rejection_reason is
  'The office''s internal reason for rejecting a candidate (§2.9). Neither anon nor authenticated holds SELECT on it: the rejection emails E2/E2b/E4 never carry it (ADR-0017) and the Staff App never shows it, so the office reads it through the owner-rights staff_rejection_reason_v (ADR-0004). Not to be confused with compliance_docs.rejection_reason, which §2.6 and N8 require the worker to see.';

-- ---------------------------------------------------------------------
-- 2 · The office's route back to it (ADR-0004)
--
-- Owner rights, so the column privilege above does not apply; the gate is
-- in the body, so the grant to `authenticated` does not decide who sees
-- what. §1.7's suppression for a removed worker is applied HERE, in the
-- same expression that reads the column, so a caller cannot lose it.
-- ---------------------------------------------------------------------
create or replace view public.staff_rejection_reason_v with (security_barrier = true) as
select
  s.id                                                        as staff_id,
  case when s.removed_at is null then s.rejection_reason end  as rejection_reason
from public.staff s
where current_app_role() = 'admin';

comment on view public.staff_rejection_reason_v is
  'The §2.9 rejection reason for the office, and the only route to staff.rejection_reason for a PostgREST role. Owner rights + `current_app_role() = ''admin''` in the body per ADR-0004, because a column privilege is held by a role and admin and candidate are both `authenticated`. ADR-0017: the candidate never sees this.';

revoke all on table public.staff_rejection_reason_v from public, anon, authenticated;
grant select on table public.staff_rejection_reason_v to authenticated;

-- ---------------------------------------------------------------------
-- 3 · onboarding_candidates_v reads it through the view
--
-- `create or replace`, not `drop`: the column names, types and order are
-- identical, so the office's column lists do not move and any dependent
-- keeps its stored reference. The reloption stays security_invoker —
-- `staff`'s own RLS still decides which candidates a caller sees, and the
-- sub-view decides only who sees this one column.
--
-- Everything below is byte-for-byte 20260923110000 apart from that one
-- expression.
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
  -- §2.9 / ADR-0017: the office's free-text reason for rejecting a
  -- candidate is internal. E2 and E2b never carry it, and this view runs
  -- with the caller's privileges, so it is read through the owner-rights
  -- sub-view rather than off `s` — the caller no longer holds the column.
  (select r.rejection_reason from public.staff_rejection_reason_v r
    where r.staff_id = s.id)                                   as rejection_reason,
  p.full_name                                                                      as rejected_by_name
from staff s
left join profiles p on p.id = s.rejected_by
where s.removed_at is null;

comment on view onboarding_candidates_v is
  'The §2.3 onboarding board row. security_invoker, so `staff`''s own RLS decides which candidates a caller sees. rejection_reason is read through the owner-rights staff_rejection_reason_v: §2.9''s reason is the office''s and ADR-0017 keeps it out of every rejection email.';

-- ---------------------------------------------------------------------
-- 4 · Prove the grants landed
--
-- A `revoke` that silently no-ops is how PostGIS's grants defeated
-- 20260921123503. Without this the deploy goes green with the leak open.
-- ---------------------------------------------------------------------
do $$
begin
  if has_column_privilege('authenticated', 'public.staff', 'rejection_reason', 'select')
     or has_column_privilege('anon', 'public.staff', 'rejection_reason', 'select') then
    raise exception
      'staff.rejection_reason is still selectable by a PostgREST role: the revoke did not take (§2.9, ADR-0017)';
  end if;

  if has_column_privilege('authenticated', 'public.staff', 'block_reason', 'select')
     or has_column_privilege('anon', 'public.staff', 'block_reason', 'select') then
    raise exception
      'staff.block_reason became selectable again: the re-grant above is too wide (§10.1)';
  end if;

  if not has_column_privilege('authenticated', 'public.staff', 'id', 'select')
     or not has_column_privilege('authenticated', 'public.staff', 'first_name', 'select')
     or not has_column_privilege('anon', 'public.staff', 'id', 'select') then
    raise exception
      'the re-grant did not take: staff_self (0001) and 030_rls_staff need every column but those two';
  end if;
end $$;
