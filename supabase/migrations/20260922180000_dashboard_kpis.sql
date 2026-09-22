-- =====================================================================
-- Migration 20260922180000 · the Dashboard's numbers (§9.1)
--
-- What this exists for
-- --------------------
-- §9.1 is four counters "as of this minute", one financial snapshot of the
-- current Mon–Sun week, and the next ten days of events with the margin on
-- every role row. All of it is arithmetic over money, fill and time, and
-- all three of those have exactly one correct definition in this schema:
--
--   · fill counts CONFIRMED bookings against HEADCOUNT — never invited,
--     never against headcount + buffer (§3.2). The buffer is THC's own
--     cover and is reported beside the headcount, never added to it;
--   · final pay is final_rate(pay_rate), the one definition of the 12.07%
--     holiday element (§9.8, 0001_init.sql). It is never re-derived, and
--     base and holiday are carried as separate columns so a screen cannot
--     blend them (§1.5, §9.9);
--   · "this week" and "today" are Europe/London, not the session's zone.
--     `current_date` resolves against TimeZone, which is UTC on Supabase,
--     and 20260922100000 is the migration that had to go back and fix
--     exactly that mistake in submit_application(). The house expression
--     is `(now() at time zone 'Europe/London')::date`.
--
-- So the numbers live here rather than in the page. A screen that added
-- up charge_rate itself would be the second definition of the margin, and
-- the first one to drift.
--
-- Who may read them
-- -----------------
-- Every view below is `security_invoker`, so the admin policies on events,
-- shift_requirements, bookings, staff, roles and clients decide what the
-- caller sees — the shape clients_directory_v already uses for Back Office
-- views built on charge rates (§11.1, ADR-0004). That alone would leave a
-- worker counting the one `staff` row and the bookings their own self
-- policies grant them, so the base view carries an explicit
-- `current_app_role() = 'admin'` as well and the aggregates repeat it.
-- Money and fill are the office's, and §9.1 is an office screen.
--
-- The consequence is deliberate and worth stating: a caller with no
-- `profiles` row — the table owner in a psql session, or service_role —
-- reads NOTHING here, because current_app_role() is null for them. The
-- Dashboard has no machine caller; anything that ever needs one should get
-- a security definer function rather than a widened predicate here.
--
-- Nothing in this migration is client-reachable and no policy is added to
-- any table: `client_*` is the reserved prefix for views the Client Portal
-- reaches (050_client_views.sql), and these are the opposite of that.
-- =====================================================================

-- ---------------------------------------------------------------------
-- dashboard_sections_v — one row per role section, as built, with its fill
--
-- The spine of the screen. Everything §9.1 shows about work is a role
-- SECTION, not an event (RULE-18): the window, the headcount, the buffer,
-- the rates and therefore the margin all belong to the section, and an
-- event that runs 07:00–23:30 is only ever the min start and max end of
-- the sections under it.
--
-- Rates are read from `shift_requirements`, which §3.2 snapshots when the
-- event is built, so a later edit to a role's base rate or a client's rate
-- card never rewrites an event already in the diary.
--
-- Cancelled events are KEPT here, with `cancelled_at` exposed, because
-- §3.3 wants them still visible on the board — greyed, contributing
-- nothing. Every aggregate below filters them out itself; the list does
-- not. Putting the filter in this view would have made the cancelled row
-- impossible to render at all.
--
-- `worked` counts as filled alongside `confirmed`: it is the status a
-- confirmed booking moves to once the shift has run, and the client
-- portal, the event board and the calendar all already count the pair
-- (20260921140000_client_portal.sql). On an event still to come nothing is
-- `worked` yet, so on the §9.1 list the two readings are identical.
-- ---------------------------------------------------------------------
create or replace view dashboard_sections_v with (security_invoker = true, security_barrier = true) as
select
  sr.id                                               as shift_id,
  sr.event_id,
  e.client_id,
  e.title                                             as event_title,
  e.event_date,
  e.venue_name,
  e.po_number,
  e.cancelled_at,
  c.name                                              as client_name,
  r.name                                              as role_name,
  sr.starts_at,                                       -- the ROLE's window (RULE-18)
  sr.ends_at,
  sr.headcount,
  sr.buffer,
  sr.charge_rate,
  sr.pay_rate                                         as base_rate,
  final_rate(sr.pay_rate)                             as final_pay_rate,
  -- §9.1 "the margin +£X/h in green (charge − final pay)". Against the
  -- FINAL rate, so the 12.07% is inside the margin and never flattering it.
  sr.charge_rate - final_rate(sr.pay_rate)            as margin_per_hour,
  -- Cast to numeric explicitly: every total below is rounded to the penny
  -- with round(numeric, int), which has no double-precision sibling.
  (extract(epoch from (sr.ends_at - sr.starts_at)) / 3600)::numeric as section_hours,
  coalesce(f.confirmed, 0)                            as confirmed,
  -- Unfilled HEADCOUNT. An over-confirmed section has taken buffer seats,
  -- which is not a negative open position.
  greatest(sr.headcount - coalesce(f.confirmed, 0), 0)::int        as open_positions
from shift_requirements sr
join events  e on e.id = sr.event_id
join clients c on c.id = e.client_id
join roles   r on r.id = sr.role_id
left join lateral (
  select count(*)::int as confirmed
    from bookings b
   where b.shift_id = sr.id
     and b.status in ('confirmed', 'worked')
) f on true
where current_app_role() = 'admin';

comment on view dashboard_sections_v is
  'One row per role section with its fill, its rates and its margin per hour (§9.1, RULE-18). Fill counts confirmed (and worked) bookings against headcount only; the buffer is carried beside it and never added in. Cancelled events are present with cancelled_at set, because §3.3 keeps them visible; every aggregate excludes them. Admin-only: security_invoker plus current_app_role() = admin.';

-- ---------------------------------------------------------------------
-- dashboard_kpis_v — the four operational counters, as of this minute
--
-- One row, four numbers, each one a scalar subquery so that none of them
-- can be distorted by another's join. §9.1 in order:
--
--   open_positions    "how many positions across ALL events are still
--                      unfilled (even a year out)" — sold but not staffed.
--                      No upper bound on the date, deliberately. The lower
--                      bound is the only judgement here: a section that has
--                      already ended cannot be staffed any more, so it is
--                      not "sold but not staffed", it is history. Cancelled
--                      events are out — nothing was sold.
--   on_shift_now      checked in and working right now. Read from
--                      checkin_monitor_v so §9.5's seven states keep ONE
--                      definition; "working" is on_shift plus off_site,
--                      because off-site is a live status for a worker whose
--                      shift is still running (§5.1) and not an end state.
--                      Both stop counting at end + 4 h, where the monitor
--                      turns the row into the No check-out violation.
--   staff_available   compliant workers available. Compliant is the status
--                      (so blocked, inactive, candidates and rejected are
--                      all out by construction), and then: not removed
--                      (§1.7), not a leaver (§10.6), a right to work that
--                      has not lapsed — RULE-20's hard stop, which outranks
--                      every other cap — and not already committed to a
--                      shift that touches today in UK terms.
--   compliance_blocks "how many people are blocked over documents".
--                      block_kind = auto_document is precisely that: a
--                      manual block (§9.6) is a manager's decision about
--                      conduct and a conviction review is neither.
-- ---------------------------------------------------------------------
create or replace view dashboard_kpis_v with (security_invoker = true, security_barrier = true) as
select
  now()                                                            as as_of,
  (select coalesce(sum(s.open_positions), 0)::int
     from dashboard_sections_v s
    where s.cancelled_at is null
      and s.ends_at > now())                                       as open_positions,
  (select count(*)::int
     from checkin_monitor_v m
    where m.status in ('on_shift', 'off_site'))                    as on_shift_now,
  (select count(*)::int
     from staff st
    where st.status = 'compliant'
      and st.removed_at is null
      and st.left_at is null
      and (st.right_to_work_until is null
           or st.right_to_work_until >= (now() at time zone 'Europe/London')::date)
      and not exists (
        select 1
          from bookings b
          join shift_requirements sr on sr.id = b.shift_id
          join events ev             on ev.id = sr.event_id
         where b.staff_id = st.id
           and b.status in ('confirmed', 'worked')
           and ev.cancelled_at is null
           -- Overlaps today in Europe/London: a section that started last
           -- night and runs to 03:00 still books the person out of today.
           and sr.starts_at < (((now() at time zone 'Europe/London')::date + 1)
                                 at time zone 'Europe/London')
           and sr.ends_at   > (((now() at time zone 'Europe/London')::date)
                                 at time zone 'Europe/London')))   as staff_available,
  (select count(*)::int
     from staff st
    where st.status = 'blocked'
      and st.block_kind = 'auto_document'
      and st.removed_at is null)                                   as compliance_blocks
where current_app_role() = 'admin';

comment on view dashboard_kpis_v is
  'The four §9.1 operational KPIs as of this minute: open positions across all events (unfilled headcount on sections not yet ended, cancelled events excluded), on shift now (checkin_monitor_v on_shift + off_site), staff available (compliant, with a live right to work, not booked on anything touching today in Europe/London) and compliance blocks (block_kind = auto_document). Admin-only.';

-- ---------------------------------------------------------------------
-- dashboard_week_finance_v — the current Mon–Sun week (§9.1)
--
-- Chargeable · Payable · Margin, "including holiday pay". Payable comes
-- back in three columns — base, holiday, total — and never as one, because
-- §1.5 and §9.9 both require the 12.07% to be shown broken out. The
-- holiday element is `final − base`, not `base × 0.1207`: final_rate()
-- rounds to the penny, and re-deriving the uplift would leave the three
-- columns not adding up.
--
-- This is a FORECAST of the week as sold, not a payroll figure: charge and
-- pay are both headcount × section hours at the section's own rates. Two
-- consequences, both deliberate:
--
--   · the buffer is not in it. The client is not charged for buffer cover,
--     and a buffer worker turned away at the door is RULE-15's fixed four
--     hours, which is not knowable in advance;
--   · nothing here is actual payable time. RULE-01's
--     [check-in, check-out] ∩ [start, end], the 15-minute grace, unpaid
--     breaks and the four-hour floor belong to the §9.9 Payroll tab, which
--     reports what happened. This one answers "what is this week worth",
--     which is why the panel is labelled a forecast on screen.
--
-- The week is Monday to Sunday in Europe/London. date_trunc('week') on a
-- Postgres timestamp gives Monday, and the value it is given here is the
-- London wall clock rather than the session's, so the boundary moves at
-- London midnight for every reader of the screen.
--
-- Cancelled events contribute nothing (§3.3).
-- ---------------------------------------------------------------------
create or replace view dashboard_week_finance_v with (security_invoker = true, security_barrier = true) as
with week as (
  select
    date_trunc('week', (now() at time zone 'Europe/London'))::date       as week_start,
    (date_trunc('week', (now() at time zone 'Europe/London'))::date + 6) as week_end
)
select
  w.week_start,
  w.week_end,
  count(distinct s.event_id)::int                                        as events,
  coalesce(sum(s.headcount * s.section_hours), 0)                        as forecast_hours,
  coalesce(round(sum(s.charge_rate    * s.headcount * s.section_hours), 2), 0) as charge_total,
  coalesce(round(sum(s.base_rate      * s.headcount * s.section_hours), 2), 0) as base_total,
  coalesce(round(sum(s.final_pay_rate * s.headcount * s.section_hours), 2), 0) as pay_total,
  coalesce(round(sum((s.final_pay_rate - s.base_rate)
                                      * s.headcount * s.section_hours), 2), 0) as holiday_total,
  coalesce(round(sum((s.charge_rate - s.final_pay_rate)
                                      * s.headcount * s.section_hours), 2), 0) as margin_total,
  -- Null, never 0%, when there is nothing in the week: an empty diary has
  -- no margin, and 0% would read as a week THC worked for free.
  case when coalesce(sum(s.charge_rate * s.headcount * s.section_hours), 0) > 0
       then round((1 - sum(s.final_pay_rate * s.headcount * s.section_hours)
                     / sum(s.charge_rate    * s.headcount * s.section_hours)) * 100, 1)
  end                                                                    as margin_pct
from week w
left join dashboard_sections_v s
       on s.cancelled_at is null
      and s.event_date between w.week_start and w.week_end
where current_app_role() = 'admin'
group by w.week_start, w.week_end;

comment on view dashboard_week_finance_v is
  'The §9.1 financial snapshot of the current Mon–Sun week in Europe/London: chargeable, payable with base and holiday broken out (+12.07% via final_rate(), never blended), margin and margin percentage. A forecast of the week as built — headcount x section hours at the section''s own rates, buffer excluded, cancelled events excluded (§3.3). Actual payable time is RULE-01''s and belongs to the §9.9 Payroll tab. Admin-only.';

-- ---------------------------------------------------------------------
-- dashboard_upcoming_v — the next ten days, by date (§9.1)
--
-- One row per ROLE SECTION, because §9.1 puts the margin on the role's row
-- and §3.2 lets two roles on one event run different windows. The event's
-- own window travels on every row as event_starts_at / event_ends_at, the
-- min start and max end of its sections (RULE-18) — computed here as a
-- window function rather than read from `event_windows`, which 0009
-- revoked from the PostgREST roles precisely so that an invoker view could
-- not borrow its owner rights.
--
-- Ten days INCLUSIVE of today, on the event's own date: a Saturday event
-- is Saturday's whether its waiting staff finish at 22:00 or 00:30.
-- Cancelled events are in the list and greyed by the screen (§3.3); they
-- are absent from the money above.
-- ---------------------------------------------------------------------
create or replace view dashboard_upcoming_v with (security_invoker = true, security_barrier = true) as
select
  s.*,
  min(s.starts_at) over (partition by s.event_id)      as event_starts_at,
  max(s.ends_at)   over (partition by s.event_id)      as event_ends_at,
  count(*)         over (partition by s.event_id)::int as role_count
from dashboard_sections_v s
where s.event_date between (now() at time zone 'Europe/London')::date
                       and (now() at time zone 'Europe/London')::date + 10;

comment on view dashboard_upcoming_v is
  'The §9.1 "upcoming events, 10 days ahead" list: one row per role section with its own window, fill and margin per hour, plus the derived event window (min start, max end — RULE-18) and the number of role sections on the event. Cancelled events are included with cancelled_at set so the screen can grey them (§3.3). Admin-only, inherited from dashboard_sections_v.';

-- ---------------------------------------------------------------------
-- Privileges
--
-- Supabase grants anon and authenticated select on every new object in
-- `public`, which is how event_windows spent eight migrations published to
-- the open internet (0009). These views all carry charge_rate, so the
-- grant is written out rather than inherited: anon holds nothing, and a
-- signed-in caller holds select and then meets the predicate in the view
-- body and the RLS on the tables underneath.
--
-- Read-only in both directions. There is no write path through a view
-- whose every column is derived.
-- ---------------------------------------------------------------------
revoke all on dashboard_sections_v, dashboard_kpis_v,
               dashboard_week_finance_v, dashboard_upcoming_v
  from public, anon;

grant select on dashboard_sections_v, dashboard_kpis_v,
                dashboard_week_finance_v, dashboard_upcoming_v
  to authenticated;
