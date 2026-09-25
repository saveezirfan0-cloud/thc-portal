-- =====================================================================
-- Migration 20260929160100 · the staff directory's Inactive tab, the
--                            "Limit reached" date and worked hours
--                            (§9.6, §10.6, RULE-20)
--
-- Four things /staff and /staff/:id print that no view carried.
--
--   1. The Inactive tab (§9.6: "everyone who has left through the app,
--      newest first, showing the date they left and the reason they gave
--      — so the office has a single place to work through outstanding
--      P45s and final pay"). wireframes/backoffice/staff.html draws it
--      with three more columns: Last completed shift, Released shifts and
--      P45. They come from:
--        last_worked_*       the latest `worked` booking;
--        released_shifts     the confirmed bookings request_p45() released,
--                            i.e. cancel_cause 'left' stamped at left_at —
--                            the same rows E8's list is read from
--                            (released_shift_lines); withdrawn invitations
--                            carry 'left_invite' and are not shifts lost;
--        p45_notice_*        the E8 row in notification_outbox, so the
--                            office sees whether the request reached it.
--      The system never produces or receives a P45 (§10.6 "What it does
--      not do"), so there is no "issued" fact to read: ADR-0038.
--      All four are computed for inactive workers only.
--
--   2. weekly_cap_until — §9.6's own hover example is "20 h — term time
--      until 13.12.2026". staff_profile_v has carried it since
--      20260922094500; the directory's "Limit reached" badge did not.
--      Same expression, students only.
--
--   3. weekly_worked_hours — §9.6: "Hours this week (worked / calculated
--      weekly limit)". The hours of the Mon–Sun week's shifts that reached
--      `worked`, each counted at its role section's scheduled window
--      (RULE-18), in the same unit and the same Europe/London week as
--      weekly_booked_hours(), so the two sit side by side. Booked stays:
--      it is what the cap gates on.
--
--   4. phone — the directory's search is "name, Employee ID, phone"
--      (wireframe). Masked for a removed worker exactly as staff_profile_v
--      masks it (§1.7).
--
-- staff_directory_v keeps security_invoker: `staff`'s own RLS decides
-- which workers a caller sees (290). The new columns are appended, so
-- `create or replace` keeps every existing column where it was and
-- student_visa_v / clients_qualified_staff_v, which name their columns,
-- are untouched.
--
-- staff_profile_v is the one view built on `d.*`. Postgres expands `*`
-- when a view is created, so appending to staff_directory_v leaves the
-- profile without the new columns — and the next `create or replace` of
-- the profile would fail, because a re-expanded `d.*` moves every column
-- after it. It is therefore dropped and recreated here (nothing depends
-- on it), restated from 20260924150000 with two columns moved into the
-- directory where they now live: `phone` and `weekly_cap_until` arrive
-- through `d.*` with the same values as before. The original never
-- carried an explicit grant; the recreated one is select-only for
-- authenticated and service_role, like student_visa_v.
--
-- student_visa_v is restated from 20260923100100 with weekly_cap_until
-- appended, for the same "until" line on the Student visa view.
-- =====================================================================

create or replace view public.staff_directory_v with (security_invoker = true) as
select
  s.id,
  s.employee_id,
  s.status,
  s.removed_at is not null                                   as removed,
  case
    when s.removed_at is not null then deleted_account_label(s.employee_id)
    else s.first_name || ' ' || s.last_name
  end                                                        as display_name,
  case when s.removed_at is null then s.photo_path end       as photo_path,
  s.rating,
  s.reliability,
  s.block_kind,
  -- Internal, never shown to the worker (§10.1): read through the
  -- owner-rights staff_block_reason_v, which carries the admin gate,
  -- because no PostgREST role holds the column on `staff` (20260923090000).
  br.block_reason                                            as block_reason,
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
  weekly_cap_hours(s.id, (now() at time zone 'Europe/London')::date)   as weekly_cap_hours,
  weekly_cap_band(s.id, (now() at time zone 'Europe/London')::date)    as weekly_cap_band,
  weekly_booked_hours(s.id, (now() at time zone 'Europe/London')::date) as weekly_booked_hours,
  -- ---- appended by 20260929160100 ---------------------------------------
  case when s.removed_at is null then s.phone end            as phone,
  -- §9.6 "20 h — term time until 13.12.2026". Asked only of a student:
  -- cap_band_until() assumes a visa condition.
  case
    when s.rtw_branch = 'international_student'
      then cap_band_until(s.term_dates, (now() at time zone 'Europe/London')::date)
  end                                                        as weekly_cap_until,
  (select coalesce(sum(extract(epoch from (sr.ends_at - sr.starts_at)) / 3600.0), 0)::numeric
     from bookings b
     join shift_requirements sr on sr.id = b.shift_id
    where b.staff_id = s.id
      and b.status = 'worked'
      and (sr.starts_at at time zone 'Europe/London')::date
          between cap_week_start((now() at time zone 'Europe/London')::date)
              and cap_week_start((now() at time zone 'Europe/London')::date) + 6)
                                                             as weekly_worked_hours,
  lw.event_title                                             as last_worked_event,
  lw.venue_name                                              as last_worked_venue,
  lw.starts_at                                               as last_worked_at,
  case when s.status = 'inactive' and s.left_at is not null then
    coalesce(
      (select jsonb_agg(jsonb_build_object('title', e.title, 'startsAt', sr.starts_at)
                        order by sr.starts_at)
         from bookings b
         join shift_requirements sr on sr.id = b.shift_id
         join events e              on e.id  = sr.event_id
        where b.staff_id = s.id
          and b.cancel_cause = 'left'
          and b.cancelled_at = s.left_at),
      '[]'::jsonb)
  end                                                        as released_shifts,
  e8.sent_at                                                 as p45_notice_sent_at,
  e8.failed_at                                               as p45_notice_failed_at
from staff s
left join staff_block_reason_v br on br.staff_id = s.id
left join lateral (
  select e.title as event_title, e.venue_name, sr.starts_at
    from bookings b
    join shift_requirements sr on sr.id = b.shift_id
    join events e              on e.id  = sr.event_id
   where b.staff_id = s.id
     and b.status = 'worked'
     and s.status = 'inactive'
   order by sr.starts_at desc
   limit 1
) lw on true
left join lateral (
  select o.sent_at, o.failed_at
    from notification_outbox o
   where o.template = 'E8'
     and o.key like 'E8:staff:' || s.id::text || ':%'
     and s.status = 'inactive'
   order by o.id desc
   limit 1
) e8 on true;

comment on view public.staff_directory_v is
  'The /staff directory row (§9.6): the worker with their roles, rating, show-rate, unresolved violations, do-not-return clients and their calculated weekly cap for the current Mon-Sun week (RULE-20) with the date a student''s band holds until, booked and worked hours for that week, and — for an inactive worker — the Inactive tab''s last completed shift, the shifts request_p45() released and the E8 notice (20260929160100). display_name and phone apply §1.7''s anonymisation in the view, so no caller can print a removed worker''s real name. security_invoker: staff carries personal data and admin_all is the only policy on it. block_reason comes from the owner-rights staff_block_reason_v (20260923090000), because no PostgREST role holds the column on the table — §10.1, the worker never sees it.';

-- ---------------------------------------------------------------------
-- staff_profile_v — dropped and recreated so `d.*` is expanded against
-- the directory as it now stands. Restated from 20260924150000; `phone`
-- and `weekly_cap_until` now come through `d.*` (same expressions).
-- ---------------------------------------------------------------------
drop view if exists public.staff_profile_v;
create view public.staff_profile_v with (security_invoker = true) as
select
  d.*,
  case when s.removed_at is null then s.email end            as email,
  case when s.removed_at is null then s.dob end              as dob,
  case when s.removed_at is null then s.home_address end     as home_address,
  case when s.removed_at is null then s.share_code end       as share_code,
  case
    when s.removed_at is not null or s.ni_number is null then null
    else repeat('●', greatest(length(s.ni_number) - 2, 0)) || right(s.ni_number, 2)
  end                                                        as ni_number_masked,
  s.ni_number is not null                                    as has_ni_number,
  s.term_dates,
  s.contract_signed_at,
  s.contract_version,
  s.created_at                                               as joined_at,
  s.quiz_attempts,
  -- Bank and HMRC are separate tables, and both are wholly personal data:
  -- the account number is masked to its last four for the same reason as
  -- the NI number, and the sort code to its first pair.
  case when s.removed_at is null then bd.account_holder end  as bank_account_holder,
  case
    when s.removed_at is not null or bd.sort_code is null then null
    else left(bd.sort_code, 2) || '-••-••'
  end                                                        as bank_sort_code_masked,
  case
    when s.removed_at is not null or bd.account_number is null then null
    else '••••' || right(bd.account_number, 4)
  end                                                        as bank_account_masked,
  case when s.removed_at is null then bd.updated_at end      as bank_updated_at,
  case when s.removed_at is null then h.statement end        as hmrc_statement,
  case when s.removed_at is null then h.student_loan end     as hmrc_student_loan,
  case when s.removed_at is null then h.postgraduate_loan end as hmrc_postgraduate_loan,
  case when s.removed_at is null then h.submitted_at end     as hmrc_declared_at,
  -- KPI row (§9.6). Shifts worked and no-shows are history and survive a
  -- removal; the scope keeps "roles and rating" visible on the anonymised
  -- row for the same reason.
  (select count(*) from bookings b
    where b.staff_id = s.id and b.status = 'worked')::int   as shifts_worked,
  (select count(*) from violations v
    where v.staff_id = s.id and v.type = 'no_show' and not v.resolved)::int as no_shows,
  (select count(*) from feedback f
    where f.staff_id = s.id
      and (f.author_kind = 'office' or f.read_at is not null))::int      as feedback_count,
  (select count(*) from compliance_docs c
    where c.staff_id = s.id and c.review_status = 'pending')::int        as documents_pending,
  (select count(*) from client_qualifications q
    where q.staff_id = s.id)::int                                        as qualification_count
from staff_directory_v d
join staff s on s.id = d.id
left join bank_details bd on bd.staff_id = s.id
-- §2.12 supersedes a checklist rather than deleting it, so the profile has
-- to name the live one explicitly — the superseded copy is the previous
-- period's record and is never the worker's current HMRC position.
left join hmrc_checklists h on h.staff_id = s.id and not h.superseded;

-- The original never carried a grant and took the schema defaults; a
-- signed-in office session is the only reader, so the recreated view says
-- so instead of inheriting anon's default.
revoke all on public.staff_profile_v from public, anon;
grant select on public.staff_profile_v to authenticated, service_role;

comment on view public.staff_profile_v is
  'The /staff/:id header, Overview tab and KPI row (§9.6). Extends staff_directory_v, so §1.7''s anonymisation and RULE-20''s cap (with its until-date and the week''s worked hours) are not redefined. Every personal column is masked for a removed worker in the view itself, and the NI number, sort code and account number are masked for every worker — the office needs the last characters to confirm a record, never the whole value.';

-- ---------------------------------------------------------------------
-- student_visa_v — restated from 20260923100100 with weekly_cap_until
-- appended.
-- ---------------------------------------------------------------------
create or replace view public.student_visa_v with (security_invoker = true) as
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
  (select max(doc_expires_on(c.doc_type, c.expiry_date, c.right_to_work_until,
                             d.right_to_work_until, c.uploaded_at))
     from compliance_docs c
    where c.staff_id = d.id and c.doc_type = 'university_term_dates_letter'
      and c.review_status = 'verified')                      as term_letter_expires_at,
  (select max(c.reviewed_at) from compliance_docs c
    where c.staff_id = d.id and c.doc_type = 'university_completion_letter'
      and c.review_status = 'verified')                      as completion_letter_verified_at,
  exists (select 1 from compliance_docs c
           where c.staff_id = d.id and c.doc_type = 'university_completion_letter'
             and c.review_status = 'pending')                as completion_letter_in_review,
  -- ---- appended by 20260923100100 --------------------------------------
  s.below_degree_level,
  s.course_completion_date,
  (select c.review_status::text from compliance_docs c
    where c.staff_id = d.id and c.doc_type = 'university_completion_letter'
      and c.review_status <> 'superseded'
    order by c.uploaded_at desc, c.id desc limit 1)          as completion_letter_status,
  (select c.rejection_reason from compliance_docs c
    where c.staff_id = d.id and c.doc_type = 'university_completion_letter'
      and c.review_status <> 'superseded'
    order by c.uploaded_at desc, c.id desc limit 1)          as completion_letter_rejection,
  (select c.completion_date_claimed from compliance_docs c
    where c.staff_id = d.id and c.doc_type = 'university_completion_letter'
      and c.review_status = 'pending'
    order by c.uploaded_at desc limit 1)                     as completion_date_claimed,
  case when s.course_completion_date is not null and s.graduated_at is not null
       then completion_effective_from(s.course_completion_date, s.graduated_at) end
                                                             as completion_effective_from,
  s.wtr_optout_cancelled_from,
  s.dob is not null
    and (s.dob + interval '18 years')::date <= (now() at time zone 'Europe/London')::date
                                                             as optout_eligible,
  (d.right_to_work_until - (now() at time zone 'Europe/London')::date)
                                                             as rtw_days_left,
  -- ---- appended by 20260929160100 --------------------------------------
  d.weekly_cap_until
from staff_directory_v d
join staff s on s.id = d.id
where d.rtw_branch = 'international_student'
  and not d.removed;

revoke all on public.student_visa_v from public, anon;
grant select on public.student_visa_v to authenticated, service_role;
