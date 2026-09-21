-- =====================================================================
-- Staff directory and the Student visa view (§9.6, §4.5)
--
-- Why this exists
-- ---------------
-- The directory's row is a join of six things — the worker, their roles,
-- their calculated weekly cap, their unresolved violations, their
-- do-not-return marks and their right-to-work evidence. Assembling that in
-- the screen means six round trips per page, and three of the six carry
-- rules that already exist in SQL (RULE-20's cap, §1.7's anonymisation,
-- §4.5's graduation). So the row is assembled here.
--
-- Two things this deliberately does NOT do:
--   · No write functions. Block, Unblock and Reset to candidate are
--     compliance's (§4.3, §2.12), and GDPR removal is §1.7's; the
--     directory reads.
--   · No filtering by status. §9.6's filters are tabs over one list, and
--     a removed worker is shown rather than hidden — as "Deleted account
--     #id", with roles and rating intact (§1.7).
-- =====================================================================

create index if not exists violations_staff_unresolved_idx
  on violations (staff_id) where not resolved;
create index if not exists client_qualifications_dnr_idx
  on client_qualifications (staff_id) where do_not_return;

-- ---------------------------------------------------------------------
-- staff_directory_v — one row per worker, everything /staff renders
--
-- §1.7: a removed worker keeps their history. The anonymisation is applied
-- HERE rather than trusted to have been written over the columns, so a
-- screen cannot print a name that a GDPR removal was supposed to retire
-- even if the wipe failed halfway. `display_name` is the only name any
-- caller should print.
--
-- The cap is read from weekly_cap_hours/_band (0008, RULE-20) on today's
-- UK date. It is never stored: §4.4 is explicit that it is calculated, and
-- a stored copy would be wrong the morning a term ends.
-- ---------------------------------------------------------------------
create or replace view staff_directory_v with (security_invoker = true) as
select
  s.id,
  s.employee_id,
  s.status,
  s.removed_at is not null                                   as removed,
  case
    when s.removed_at is not null then 'Deleted account #' || coalesce(s.employee_id::text, left(s.id::text, 8))
    else s.first_name || ' ' || s.last_name
  end                                                        as display_name,
  case when s.removed_at is null then s.photo_path end       as photo_path,
  s.rating,
  s.reliability,
  s.block_kind,
  -- The reason for a manual block is internal and is never shown to the
  -- worker (§10.1), but the office sees it first when deciding to unblock.
  case when s.removed_at is null then s.block_reason end     as block_reason,
  s.rtw_branch,
  s.right_to_work_until,
  s.graduated_at,
  s.wtr_optout,
  s.left_at,
  case when s.removed_at is null then s.leave_reason end     as leave_reason,
  coalesce(
    (select array_agg(r.name order by r.name)
       from staff_roles sr join roles r on r.id = sr.role_id
      where sr.staff_id = s.id),
    '{}'::text[]
  )                                                          as role_names,
  (select count(*) from violations v
    where v.staff_id = s.id and not v.resolved)::int          as unresolved_violations,
  coalesce(
    (select array_agg(distinct c.name order by c.name)
       from client_qualifications q join clients c on c.id = q.client_id
      where q.staff_id = s.id and q.do_not_return),
    '{}'::text[]
  )                                                          as do_not_return_clients,
  -- RULE-20, on today's UK date. Null cap = no ceiling (the 48h opt-out
  -- with no visa limit); the band says which rule produced it.
  weekly_cap_hours(s.id, (now() at time zone 'Europe/London')::date)   as weekly_cap_hours,
  weekly_cap_band(s.id, (now() at time zone 'Europe/London')::date)    as weekly_cap_band,
  weekly_booked_hours(s.id, (now() at time zone 'Europe/London')::date) as weekly_booked_hours
from staff s;

comment on view staff_directory_v is
  'The /staff directory row (§9.6): the worker with their roles, rating, show-rate, unresolved violations, do-not-return clients and their calculated weekly cap for the current Mon-Sun week (RULE-20). display_name applies §1.7''s anonymisation in the view, so no caller can print a removed worker''s real name. security_invoker: staff carries personal data and admin_all is the only policy on it.';

-- ---------------------------------------------------------------------
-- student_visa_v — §4.5's whole student population in one place
--
-- The point of the screen is that a manager can see every International
-- student's cap and the evidence behind it without opening profiles one at
-- a time. The evidence set is the two documents RULE-20 reads: the term
-- dates letter that produces the 20/48 split, and the completion letter
-- that ends it (§4.5).
-- ---------------------------------------------------------------------
create or replace view student_visa_v with (security_invoker = true) as
select
  d.id,
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
  (select max(c.reviewed_at) from compliance_docs c
    where c.staff_id = d.id and c.doc_type = 'university_term_dates_letter'
      and c.review_status = 'verified')                      as term_letter_verified_at,
  (select max(c.expiry_date) from compliance_docs c
    where c.staff_id = d.id and c.doc_type = 'university_term_dates_letter'
      and c.review_status = 'verified')                      as term_letter_expires_at,
  (select max(c.reviewed_at) from compliance_docs c
    where c.staff_id = d.id and c.doc_type = 'university_completion_letter'
      and c.review_status = 'verified')                      as completion_letter_verified_at,
  exists (select 1 from compliance_docs c
           where c.staff_id = d.id and c.doc_type = 'university_completion_letter'
             and c.review_status = 'pending')                as completion_letter_in_review
from staff_directory_v d
where d.rtw_branch = 'international_student';

comment on view student_visa_v is
  'The §4.5 Student visa view: every worker on the International student branch with the cap RULE-20 calculates for them today and the evidence set that produced it. Reads through staff_directory_v, so §1.7''s anonymisation and the cap definition are not repeated.';
