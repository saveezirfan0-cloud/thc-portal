-- =====================================================================
-- Migration 20261016100000 · the Staff directory fits inside the
--                            statement limit again (ADR-0147)
--
-- Reported 16.10.2026: /staff showed "canceling statement due to statement
-- timeout" and an empty directory ("0 workers"). `authenticated` — the
-- office's session — runs under statement_timeout = 8 s (20261012120000),
-- and `staff_directory_v`, which the page reads whole, no longer fitted:
-- 6.5 s on a local 1,040-worker cluster with no booking history at all,
-- over 8 s once there is some.
--
-- Three things, all pure cost — no rule changes, every value identical:
--
--   1. cap_band_until() (§4.4, N14's "until [date]"). It walked 53 weeks
--      and, for EACH week, recomputed this week's band as well: 106
--      cap_term_state() + weekly_cap() runs per call, ~18 ms, and the view
--      calls it once per student-visa worker. 4.2 s of the 6.5. It now
--      reads every day of the 54 weeks in one pass, groups them into weeks,
--      and works out each of the three possible term states' band once.
--      Same answer — 595 and 200 pin the dates, and the old and new
--      functions agreed on 3,000 random calendars (and on null inputs).
--
--   2. The view asked weekly_cap_for() three times for the same worker
--      (hours, band, and the band again inside weekly_cap_until's CASE) —
--      1.6 s. It is now asked once, in a lateral subquery, and the three
--      columns read from that. A caller that selects only a few columns
--      (the feedback typeahead, a client's qualified-staff picker) still
--      pays nothing for it: the planner drops the join when none of its
--      columns is read.
--
--   3. weekly_booked_hours() ran booking_counts_toward_cap() — a function
--      the planner cannot inline — on EVERY booking a worker has ever had,
--      then threw all but one week's away on the date test, and re-derived
--      the week's Monday for each row it kept. With 150 bookings a worker
--      that was 1.7 s for the page. The date test now comes first (OFFSET 0
--      holds the order), the Monday is worked out once, and the rule —
--      booking_counts_toward_cap() — is untouched and still the one place
--      that says what counts. Every caller (the rota guard, Accept, the
--      Radar meter) gets the same number it always did, sooner.
--
-- Columns, order, types, security_invoker, comment and grants are exactly
-- 20261008130000's; this only changes how three of them are computed.
-- =====================================================================

create or replace function public.cap_band_until(p_holidays daterange[], p_date date)
returns date
language sql
immutable
set search_path = public, extensions
as $$
  with this_week as (select cap_week_start(p_date) as w),
       -- Every day of this Mon-Sun week (n = 0) and of the 53 after it.
       days as (
         select t.w + g.i as d, g.i / 7 as n
           from this_week t, generate_series(0, 54 * 7 - 1) as g(i)
       ),
       marked as (
         select days.n,
                exists (select 1
                          from unnest(coalesce(p_holidays, '{}'::daterange[])) r
                         where days.d <@ r) as in_holiday
           from days
       ),
       -- cap_term_state(), week by week, from those days.
       states as (
         select n,
                case when bool_and(in_holiday) then 'holiday'
                     when bool_or(in_holiday)  then 'straddle'
                     else 'term' end as state
           from marked
          group by n
       ),
       -- The band of each state, worked out once: the cap rule is still
       -- weekly_cap(), not a copy of it. `term` and `straddle` give the same
       -- band (§4.4: a straddling week takes the lower cap).
       bands as materialized (
         select v.state, (weekly_cap(true, v.state, false, false)).band as band
           from (values ('term'), ('straddle'), ('holiday')) as v(state)
       ),
       weeks as (
         select s.n, t.w + s.n * 7 as w, b.band
           from states s
           join bands b on b.state = s.state
          cross join this_week t
       )
  select min(w) - 1
    from weeks
   where n >= 1
     and band is distinct from (select band from weeks where n = 0)
$$;

comment on function public.cap_band_until(daterange[], date) is
  'The Sunday the current cap band holds until (§4.4). Always a Sunday: the Mon-Sun week is the unit, so a band never changes mid-week. Null = nothing on the calendar ends it. One pass over 54 weeks of days (20261016100000, ADR-0147); the earlier form re-derived this week''s band for every week it walked and was ~18 ms a call.';

create or replace function public.weekly_booked_hours(p_staff uuid, p_date date)
returns numeric
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(sum(extract(epoch from (w.ends_at - w.starts_at)) / 3600.0), 0)::numeric
    from (
      -- This worker's shifts that START in the week, whatever their booking.
      -- OFFSET 0 keeps the planner from moving the rule below back onto
      -- every booking the worker has ever had.
      select sr.starts_at, sr.ends_at, b.status, b.cancelled_at, b.cancel_cause
        from bookings b
        join shift_requirements sr on sr.id = b.shift_id
       where b.staff_id = p_staff
         and (sr.starts_at at time zone 'Europe/London')::date
             between (select cap_week_start(p_date))
                 and (select cap_week_start(p_date)) + 6
      offset 0
    ) w
   where booking_counts_toward_cap(w.status, w.cancelled_at, w.cancel_cause)
$$;

comment on function public.weekly_booked_hours(uuid, date) is
  'RULE-20: hours committed in the Mon-Sun week containing p_date, from the scheduled role-section window (RULE-18), by the week the shift STARTS in (Europe/London). Counts what booking_counts_toward_cap() says is committed — never a declined, withdrawn or slot-taken `closed` row (20260924130100). Reads the week first and applies the rule to that handful (20261016100000, ADR-0147).';

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
  -- RULE-20: the cap is asked once per worker (`cap`, below) and these
  -- three columns read the answer.
  cap.cap_hours                                              as weekly_cap_hours,
  cap.band                                                   as weekly_cap_band,
  weekly_booked_hours(s.id, (now() at time zone 'Europe/London')::date) as weekly_booked_hours,
  -- ---- appended 20260928110000 ----------------------------------------
  -- §9.6 / §4.4: the Sunday the band holds until, for the three bands the
  -- term calendar moves (N14 asks the same question, 20260924130200).
  -- graduated_48, standard_48 and uncapped have no end: null.
  case
    when cap.band in ('student_term_10', 'student_term_20', 'student_holiday_48')
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
                                                             as weekly_worked_hours,
  -- ---- appended 20261008130000 (ADR-0107) ------------------------------
  s.spudbros_express,
  s.thc_shifts_enabled,
  s.payroll_id
from staff s
left join staff_block_reason_v br on br.staff_id = s.id
-- The cap, asked once for the worker. weekly_cap_for() returns one row, so
-- max() hands its two values back unchanged (nulls included) — and an
-- aggregate with no GROUP BY is exactly the shape the planner can prove
-- yields one row, which lets it drop this join altogether when a caller
-- reads none of the three columns it feeds. A plain function call here, or
-- `(weekly_cap_for(...)).*`, runs the function once per column or once per
-- row whatever is selected.
left join lateral (
  select max(c.cap_hours) as cap_hours,
         max(c.band)      as band
    from weekly_cap_for(s.id, (now() at time zone 'Europe/London')::date) c
) cap on true;
