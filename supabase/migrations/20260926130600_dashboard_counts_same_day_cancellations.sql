-- =====================================================================
-- Migration 20260926130600 · the §9.1 week forecast counts an event
--                            cancelled on its day (§3.3 edge case)
--
-- §3.3: "if the client cancels on the day of the event, or after some
-- staff have already checked in / started the shift, the scheduled hours
-- — not the actual worked hours — are billed to the client in full, and
-- every affected worker is paid for their full scheduled hours … This
-- overrides the 'no margin/revenue/payroll' rule above (point 4), which
-- still applies only to events cancelled before the day."
--
-- dashboard_week_finance_v excluded EVERY cancelled event from
-- Chargeable · Payable · Margin, same-day ones included, while the
-- payroll export (20260923130000, kind 'cancelled_on_day') already prices
-- them at scheduled hours. The two now agree: a section is in the week's
-- money when its event stands OR was cancelled on/after its date
-- (Europe/London, §1.8). dashboard_sections_v carries the flag
-- (`cancelled_on_day`) so the ten-day list can say "cancelled on the day ·
-- billed at scheduled hours" instead of "excluded from financials".
--
-- dashboard_sections_v gains one trailing column, which `create or
-- replace view` allows under its dependents; dashboard_upcoming_v selects
-- `s.*` so it is dropped and recreated to pick the column up, with its
-- grants restated. dashboard_kpis_v is untouched.
-- =====================================================================

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
  greatest(sr.headcount - coalesce(f.confirmed, 0), 0)::int        as open_positions,
  -- §3.3 edge case: cancelled on or after its own date (Europe/London) —
  -- billed and paid at scheduled hours, so still in the money.
  (e.cancelled_at is not null
   and (e.cancelled_at at time zone 'Europe/London')::date >= e.event_date) as cancelled_on_day
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
  'One row per role section with its fill, its rates and its margin per hour (§9.1, RULE-18). Fill counts confirmed (and worked) bookings against headcount only; the buffer is carried beside it and never added in. Cancelled events are present with cancelled_at set, because §3.3 keeps them visible; cancelled_on_day marks the §3.3 edge case that is still billed and paid at scheduled hours. Admin-only: security_invoker plus current_app_role() = admin.';

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
       on (s.cancelled_at is null or s.cancelled_on_day)
      and s.event_date between w.week_start and w.week_end
where current_app_role() = 'admin'
group by w.week_start, w.week_end;

comment on view dashboard_week_finance_v is
  'The §9.1 financial snapshot of the current Mon–Sun week in Europe/London: chargeable, payable with base and holiday broken out (+12.07% via final_rate(), never blended), margin and margin percentage. A forecast of the week as built — headcount x section hours at the section''s own rates, buffer excluded. Events cancelled BEFORE their day are excluded (§3.3 point 4); an event cancelled on or after its day is billed and paid at scheduled hours and stays in (§3.3 edge case). Actual payable time is RULE-01''s and belongs to the §9.9 Payroll tab. Admin-only.';

drop view if exists dashboard_upcoming_v;
create view dashboard_upcoming_v with (security_invoker = true, security_barrier = true) as
select
  s.*,
  min(s.starts_at) over (partition by s.event_id)      as event_starts_at,
  max(s.ends_at)   over (partition by s.event_id)      as event_ends_at,
  count(*)         over (partition by s.event_id)::int as role_count
from dashboard_sections_v s
where s.event_date between (now() at time zone 'Europe/London')::date
                       and (now() at time zone 'Europe/London')::date + 10;

comment on view dashboard_upcoming_v is
  'The §9.1 "upcoming events, 10 days ahead" list: one row per role section with its own window, fill and margin per hour, plus the derived event window (min start, max end — RULE-18), the number of role sections on the event and cancelled_on_day. Cancelled events are included with cancelled_at set so the screen can grey them (§3.3). Admin-only, inherited from dashboard_sections_v.';

revoke all on dashboard_upcoming_v from public, anon;
grant select on dashboard_upcoming_v to authenticated;
