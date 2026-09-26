-- =====================================================================
-- Migration 20260929160200 · "upcoming, 10 days ahead" is ten days (§9.1)
--
-- dashboard_upcoming_v (20260927160700) filtered
--   event_date between today and today + 10
-- which is inclusive at both ends: eleven calendar days. The panel is
-- titled "Upcoming events · next 10 days" and §9.1 says "upcoming events,
-- 10 days ahead", so the range is today and the nine days after it.
--
-- Restated from 20260927160700 with that one change. Same columns in the
-- same order, so `create or replace` is enough; security_invoker and
-- security_barrier are kept, and admin-only access is still inherited
-- from dashboard_sections_v.
-- =====================================================================

create or replace view dashboard_upcoming_v with (security_invoker = true, security_barrier = true) as
select
  s.*,
  min(s.starts_at) over (partition by s.event_id)      as event_starts_at,
  max(s.ends_at)   over (partition by s.event_id)      as event_ends_at,
  count(*)         over (partition by s.event_id)::int as role_count
from dashboard_sections_v s
where s.event_date between (now() at time zone 'Europe/London')::date
                       and (now() at time zone 'Europe/London')::date + 9;

comment on view dashboard_upcoming_v is
  'The §9.1 "upcoming events, 10 days ahead" list: today and the nine days after it (ten calendar days, Europe/London; 20260929160200). One row per role section with its own window, fill and margin per hour, plus the derived event window (min start, max end — RULE-18), the number of role sections on the event and cancelled_on_day. Cancelled events are included with cancelled_at set so the screen can grey them (§3.3). Admin-only, inherited from dashboard_sections_v.';

revoke all on dashboard_upcoming_v from public, anon;
grant select on dashboard_upcoming_v to authenticated;
