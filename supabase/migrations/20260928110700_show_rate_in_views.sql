-- =====================================================================
-- Migration 20260928110700 · the views show the show-rate the engine
--                            uses (§6, §9.6, §9.7, §10.1, §2.12)
--
-- 20260928110100 made the §6 show-rate a derived figure,
-- staff_show_rate(uuid), and pointed auto_assign_candidates at it.
-- `staff.reliability` became a seed-only column that scoring ignores —
-- but every screen that draws a show-rate to a person still read the
-- column, so the directory, the profile, the client card, the returning
-- applicant row and the worker's own profile sheet all showed a number
-- the engine no longer uses. This migration repoints them.
--
-- What is restated, and what is not
--
--   • staff_directory_v — 20260928110000's body byte for byte, with ONE
--     term changed: `s.reliability` → `staff_show_rate(s.id)::numeric(5,2)`.
--     The cast keeps the column's declared type exactly what the stored
--     column had (numeric(5,2)); `create or replace view` refuses a typmod
--     change, and staff_profile_v, clients_qualified_staff_v and
--     student_visa_v all hold stored references to this view. The column
--     NAME stays `reliability`: apps/office/app/staff/data.ts and
--     staff/[id]/data.ts select it by that name.
--   • staff_profile_v (latest 20260924150000) reads `d.*` from
--     staff_directory_v, and clients_qualified_staff_v (20260922095200)
--     reads `d.reliability` from it. Both therefore carry the derived
--     figure from this migration on, with nothing restated: their own
--     bodies never touched `staff.reliability`. 600 asserts both.
--   • onboarding_candidates_v (latest 20260928110000) was named in
--     20260928110100's header, but it has never carried a show-rate.
--     The onboarding view that does is onboarding_returning_v — the
--     §2.12 "Matches existing record … History: 41 shifts · show-rate
--     96%" line on wireframes/backoffice/onboarding.html — so that one
--     (latest 20260924150000) is restated instead, with the same single
--     term changed and the same cast.
--   • staff_me() — 20260928110000's body byte for byte, with
--     `'reliability', s.reliability` → `'reliability', staff_show_rate(v_id)`.
--     The key stays `reliability`: apps/staff/app/profile/data.ts reads it.
--
-- The default for a worker with no history: NULL, not 90
--
--   staff_show_rate() returns NULL with no history, and
--   auto_assign_candidates coalesces that to 90 because 90 is the §6
--   formula's zero point ((90 − 90)/10 = 0) — a scoring constant, not a
--   fact about the worker. None of the views coalesced before (each
--   carried the nullable column raw), so passing NULL through matches
--   every view's existing null handling, and every screen already draws
--   it: apps/office/app/staff/staff.ts formatShowRate() renders null as
--   "—" (directory, client card, returning-applicant line), and the
--   worker's ProfileSheet hides the "Show-rate 97%" pill when the value
--   is null. Drawing "90%" on wireframes/backoffice/staff.html's
--   Show-rate column for a new starter would state that they missed one
--   shift in ten, which nobody recorded; staff-profile.html's "98%" KPI is
--   a figure with history behind it, and "—" is the honest reading of
--   none. The 90 stays where it means something: inside the engine.
--
-- Grants, security_invoker and search_path are exactly as before. No
-- client policy is added anywhere (ADR-0004): the client role could not
-- read these views before and still cannot.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · staff_directory_v — 20260928110000 verbatim but for the
--     reliability term
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
  case when s.status = 'inactive' then s.left_at end         as p45_requested_at
from staff s
left join staff_block_reason_v br on br.staff_id = s.id;

comment on view public.staff_directory_v is
  '§9.6 directory row. security_invoker; §1.7 anonymisation applied here; block_reason through the owner-rights staff_block_reason_v (§10.1). weekly_cap_until, last_shift_at, released_shift_count and p45_requested_at appended 20260928110000 for the Inactive tab and the "Limit reached … until" line. reliability is staff_show_rate() since 20260928110700 — the derived §6 figure, null with no history — never the stored column; staff_profile_v, clients_qualified_staff_v and student_visa_v read it from here.';

revoke all on public.staff_directory_v from public, anon;
grant select on public.staff_directory_v to authenticated;

-- ---------------------------------------------------------------------
-- 2 · onboarding_returning_v — 20260924150000 verbatim but for the
--     reliability term
-- ---------------------------------------------------------------------
create or replace view onboarding_returning_v with (security_invoker = true) as
select
  a.id                                                         as application_id,
  a.created_at                                                 as applied_at,
  a.first_name || ' ' || a.last_name                           as applicant_name,
  a.matched_on,
  s.id                                                         as staff_id,
  s.first_name || ' ' || s.last_name                           as existing_name,
  s.employee_id,
  s.status,
  s.block_kind,
  (select r.block_reason from public.staff_block_reason_v r where r.staff_id = s.id) as block_reason,
  s.rating,
  -- §2.12 "History: … show-rate 96%": the derived §6 figure
  -- (20260928110700), null with no history.
  staff_show_rate(s.id)::numeric(5,2)                          as reliability,
  (select count(*) from bookings b
    where b.staff_id = s.id and b.status = 'worked')::int as shifts_worked
from applications a
join staff s on s.id = a.staff_id
where a.outcome = 'returning_applicant'
  and a.resolved_at is null
  and s.removed_at is null;

revoke all on onboarding_returning_v from public, anon;
grant select on onboarding_returning_v to authenticated;

-- ---------------------------------------------------------------------
-- 3 · staff_me() — 20260928110000 verbatim but for the reliability term
-- ---------------------------------------------------------------------
create or replace function public.staff_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  s staff;
  v_blockers text[];
  v_checked_in boolean;
  v_roles text[];
  v_bank jsonb;
begin
  if v_id is null then
    return null;
  end if;

  select * into s from staff where id = v_id;
  if s.id is null then
    return null;
  end if;

  select coalesce(array_agg(reason), '{}') into v_blockers
    from compliance_blockers(v_id, (now() at time zone 'Europe/London')::date);

  select exists (
    select 1
      from bookings b
      join shift_requirements sr on sr.id = b.shift_id
      join check_logs cl         on cl.booking_id = b.id
     where b.staff_id = v_id
       and b.cancelled_at is null
       and cl.check_in_at is not null
       and cl.check_out_at is null
       and now() < sr.ends_at + interval '4 hours'
  ) into v_checked_in;

  select coalesce(array_agg(r.name order by r.name), '{}') into v_roles
    from staff_roles sr join roles r on r.id = sr.role_id
   where sr.staff_id = v_id;

  select jsonb_build_object(
           'accountHolder', b.account_holder,
           'sortCode',      b.sort_code,
           'accountNumber', b.account_number,
           'updatedAt',     b.updated_at)
    into v_bank
    from bank_details b where b.staff_id = v_id;

  return jsonb_build_object(
    'staffId',        s.id::text,
    'firstName',      s.first_name,
    'lastName',       s.last_name,
    'employeeId',     s.employee_id,
    'email',          s.email,
    'phone',          s.phone,
    'homeAddress',    s.home_address,
    'photoPath',      s.photo_path,
    'photoLocked',    s.photo_path is not null,
    'status',         s.status::text,
    -- The KIND of manual block, never its reason (§10.1).
    'blockKind',      s.block_kind::text,
    -- The CAUSE of a rejection, never the office's reason (ADR-0017).
    'rejectionCause', s.rejection_cause,
    'leftAt',         s.left_at,
    'rtwBranch',      s.rtw_branch::text,
    'niMasked',       case
                        when s.ni_number is null then null
                        else repeat('●', greatest(length(s.ni_number) - 2, 0))
                             || right(s.ni_number, 2)
                      end,
    'hasNiNumber',    s.ni_number is not null,
    'rating',         s.rating,
    -- §10.1 "Show-rate 97%" pill: the derived §6 figure (20260928110700);
    -- null with no history, and the sheet hides the pill.
    'reliability',    staff_show_rate(v_id),
    'quizAttempts',   s.quiz_attempts,
    'roles',          to_jsonb(v_roles),
    'blockers',       to_jsonb(v_blockers),
    'checkedIn',      v_checked_in,
    'bank',           v_bank);
end $$;

comment on function public.staff_me() is
  'The worker''s own profile for the §10.1 profile sheet, plus the app-lock inputs. Never returns block_reason or rejection_reason; rejectionCause (willo / manager / quiz_failed) decides which terminal screen shows. reliability is staff_show_rate() since 20260928110700, null with no history.';

revoke execute on function public.staff_me() from public, anon;
grant  execute on function public.staff_me() to authenticated;

-- ---------------------------------------------------------------------
-- 4 · The column stays; its comment now says nobody reads it
-- ---------------------------------------------------------------------
comment on column public.staff.reliability is
  'Stored show-rate %, written only by seed.sql. NOT read by auto-assign since 20260928110100, and not by any view or RPC since 20260928110700 — staff_show_rate(id) is the derived §6 figure everywhere a show-rate is shown. Kept so seed.sql and the fixtures that set it keep loading.';
