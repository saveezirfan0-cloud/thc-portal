-- =====================================================================
-- Migration 20260930110500 · the profile's "Hours this week" is worked
--                            hours (§9.6, RULE-20; WP-G)
--
-- §9.6: "Hours this week (worked / calculated weekly limit)". The
-- /staff/:id tile printed BOOKED hours over the cap, because no view
-- carried worked ones. staff_directory_v gains weekly_worked_hours; the
-- tile reads worked / cap with the booked figure underneath (the cap
-- gates on booked, so the amber highlight still follows booked).
--
-- What is restated, and from where
--
--   • staff_directory_v — 20260928110700's body byte for byte (the
--     derived staff_show_rate(), the 20260928110000 columns and their
--     weekly_cap_until semantics all stay), with ONE column appended after
--     its last one. `create or replace` keeps every existing column in
--     place, so student_visa_v and clients_qualified_staff_v, which name
--     their columns, are untouched.
--   • staff_profile_v — 20260924150000's body (the latest), dropped and
--     created. It is the one view built on `d.*`, and Postgres expands `*`
--     when a view is created: the profile never received the four columns
--     20260928110000 appended to the directory, and a `create or replace`
--     that re-expanded `d.*` now would both move every column after it and
--     name weekly_cap_until twice — the directory has carried one since
--     20260928110000. So the profile's own weekly_cap_until is dropped and
--     the directory's arrives through `d.*`. Both are cap_band_until() for
--     a student in one of the three bands the term calendar moves (term
--     20/10, holiday 48). They differ only for a student in a band nothing
--     on the calendar ends — graduated or uncapped — where the profile
--     printed a term date with no rule behind it and the directory, rightly,
--     has null (the ProfileScreen's capReason() then says no "until").
--     Nothing depends on the view.
--
-- No client policy is added anywhere (ADR-0004). The profile view was
-- created without explicit grants; recreated, it is select-only for
-- authenticated and service_role and revoked from public and anon by
-- name (the default privileges are revoked first, so nothing else
-- survives). Both views keep security_invoker, so `staff`'s own RLS
-- decides which rows a caller sees.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · staff_directory_v — 20260928110700, weekly_worked_hours appended
-- ---------------------------------------------------------------------
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
  -- §6 show-rate, derived from the worker's history (20260928110100):
  -- the figure auto-assign ranks by, never the stored column. NULL with
  -- no history — the screen draws "—" (20260928110700).
  staff_show_rate(s.id)::numeric(5,2)                        as reliability,
  s.block_kind,
  -- The reason for a manual block is internal and is never shown to the
  -- worker (§10.1), but the office sees it first when deciding to
  -- unblock. It is read through staff_block_reason_v rather than off
  -- `s`, because this view runs with the caller's privileges and the
  -- caller — admin or worker, both `authenticated` — no longer holds the
  -- column. The sub-view carries the admin gate and §1.7's suppression.
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
  -- ---- appended 20260928110000 ----------------------------------------
  -- §9.6 / §4.4: the Sunday the band holds until, for the three bands the
  -- term calendar moves (N14 asks the same question, 20260924130200).
  -- graduated_48, standard_48 and uncapped have no end: null.
  case
    when weekly_cap_band(s.id, (now() at time zone 'Europe/London')::date)
         in ('student_term_10', 'student_term_20', 'student_holiday_48')
      then cap_band_until(s.term_dates, (now() at time zone 'Europe/London')::date)
  end                                                        as weekly_cap_until,
  -- §10.6: the end of the last shift actually worked — E8's lastShiftDate.
  (select max(sr.ends_at)
     from bookings b join shift_requirements sr on sr.id = b.shift_id
    where b.staff_id = s.id and b.status = 'worked')          as last_shift_at,
  -- Confirmed shifts the system released from this worker (header).
  (select count(*) from bookings b
    where b.staff_id = s.id
      and b.status = 'cancelled'
      and b.cancel_cause in ('ready_cutoff', 'left', 'blocked', 'gdpr'))::int as released_shift_count,
  -- §10.6: when the P45 was asked for, while the row is a leaver's.
  case when s.status = 'inactive' then s.left_at end         as p45_requested_at,
  -- ---- appended 20260930110500 ----------------------------------------
  -- §9.6 "Hours this week (worked / calculated weekly limit)": the hours
  -- of this Mon–Sun Europe/London week's shifts that reached `worked`,
  -- each at its role section's SCHEDULED window (RULE-18) — the same unit
  -- and the same week as weekly_booked_hours(), so the two sit side by
  -- side. Booked stays: it is what the cap gates on (ADR-0038).
  (select coalesce(sum(extract(epoch from (sr.ends_at - sr.starts_at)) / 3600.0), 0)::numeric
     from bookings b
     join shift_requirements sr on sr.id = b.shift_id
    where b.staff_id = s.id
      and b.status = 'worked'
      and (sr.starts_at at time zone 'Europe/London')::date
          between cap_week_start((now() at time zone 'Europe/London')::date)
              and cap_week_start((now() at time zone 'Europe/London')::date) + 6)
                                                             as weekly_worked_hours
from staff s
left join staff_block_reason_v br on br.staff_id = s.id;

comment on view public.staff_directory_v is
  '§9.6 directory row. security_invoker; §1.7 anonymisation applied here; block_reason through the owner-rights staff_block_reason_v (§10.1). weekly_cap_until, last_shift_at, released_shift_count and p45_requested_at appended 20260928110000 for the Inactive tab and the "Limit reached … until" line; weekly_worked_hours appended 20260930110500 for §9.6 "Hours this week (worked / limit)". reliability is staff_show_rate() since 20260928110700 — the derived §6 figure, null with no history — never the stored column; staff_profile_v, clients_qualified_staff_v and student_visa_v read it from here.';

revoke all on public.staff_directory_v from public, anon;
grant select on public.staff_directory_v to authenticated;

-- ---------------------------------------------------------------------
-- 2 · staff_profile_v — 20260924150000, recreated so d.* is expanded
--     against today's directory
-- ---------------------------------------------------------------------
drop view if exists public.staff_profile_v;

create view public.staff_profile_v with (security_invoker = true) as
select
  d.*,
  case when s.removed_at is null then s.email end            as email,
  case when s.removed_at is null then s.phone end            as phone,
  case when s.removed_at is null then s.dob end              as dob,
  case when s.removed_at is null then s.home_address end     as home_address,
  case when s.removed_at is null then s.share_code end       as share_code,
  case
    when s.removed_at is not null or s.ni_number is null then null
    else repeat('●', greatest(length(s.ni_number) - 2, 0)) || right(s.ni_number, 2)
  end                                                        as ni_number_masked,
  s.ni_number is not null                                    as has_ni_number,
  s.term_dates,
  -- weekly_cap_until is no longer stated here: staff_directory_v carries
  -- it since 20260928110000 and it arrives through d.* (20260930110500).
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

comment on view public.staff_profile_v is
  'The /staff/:id header, Overview tab and KPI row (§9.6). Extends staff_directory_v (d.*), so §1.7''s anonymisation, RULE-20''s cap and its until date, the derived show-rate and the week''s worked hours are not redefined. Every personal column is masked for a removed worker in the view itself, and the NI number, sort code and account number are masked for every worker — the office needs the last characters to confirm a record, never the whole value. Recreated 20260930110500.';

-- Supabase's default privileges grant every new view to anon, authenticated
-- and service_role by name, so all three are revoked before SELECT is given
-- back: nothing is ever written through this view.
revoke all on public.staff_profile_v from public, anon, authenticated, service_role;
grant select on public.staff_profile_v to authenticated, service_role;
