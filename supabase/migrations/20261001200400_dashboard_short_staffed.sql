-- =====================================================================
-- Migration 20261001200400 · "Short-staffed — next 48 hours" (§9.1)
--
-- One row per ROLE SECTION (not per event, RULE-18) that starts within the
-- next 48 hours with fewer confirmed workers than its headcount. The
-- dashboard panel lists them by start so a manager sees what to chase
-- first.
--
-- Why a view of its own rather than a filter over dashboard_upcoming_v
-- ---------------------------------------------------------------------
--   · dashboard_upcoming_v selects by EVENT DATE (today .. today + 9). A
--     role that starts after midnight on an event dated yesterday — the
--     01:00 clean-down after a late bar — starts inside the next 48 hours
--     and is not on that list. This view selects by the section's own
--     starts_at, which is the only time that decides it (RULE-18).
--   · The panel carries no money. dashboard_sections_v carries charge,
--     pay and margin per hour; this view names its columns and none of
--     them is a rate, so it can be granted to an office role that must
--     not see margins without widening anything that does.
--
-- The rules it encodes
--   · fill counts ONLY confirmed (and `worked`, the status a confirmed
--     booking moves to once the shift has run — the pair
--     dashboard_sections_v and the event board count) against HEADCOUNT.
--     The buffer is THC's own cover: a section with headcount met and the
--     buffer empty is NOT short-staffed (§3.2). Invitations and Radar
--     applications count for nothing.
--   · "starts within the next 48 hours" is now() <= starts_at < now() + 48 h.
--     A section already running is the 10-minute escalation's business
--     (§7), not this panel's.
--   · Cancelled events are out entirely (§3.3): nothing is sold, so
--     nothing is short.
--
-- Access: security_invoker, so the admin policies on events,
-- shift_requirements, bookings, clients and roles decide, plus the same
-- explicit `current_app_role() = 'admin'` the other dashboard views carry
-- (a worker's own-row policies would otherwise let them count their own
-- bookings). security_barrier keeps any caller-supplied qual behind it.
-- No client policy and no `client_` prefix: this is an office view.
-- =====================================================================

create or replace view dashboard_short_staffed_v with (security_invoker = true, security_barrier = true) as
select
  sr.id                                                     as shift_id,
  sr.event_id,
  e.title                                                   as event_title,
  e.event_date,
  c.name                                                    as client_name,
  e.venue_name,
  r.name                                                    as role_name,
  sr.starts_at,                                             -- the ROLE's window (RULE-18)
  sr.ends_at,
  sr.headcount,
  coalesce(f.confirmed, 0)                                  as confirmed,
  (sr.headcount - coalesce(f.confirmed, 0))::int            as open_positions
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
where current_app_role() = 'admin'
  and e.cancelled_at is null
  and sr.starts_at >= now()
  and sr.starts_at <  now() + interval '48 hours'
  and coalesce(f.confirmed, 0) < sr.headcount;

comment on view dashboard_short_staffed_v is
  'The §9.1 "Short-staffed — next 48 hours" panel: one row per role section starting in [now, now + 48 h) whose confirmed (and worked) bookings are fewer than its headcount. Selected by the section''s own starts_at (RULE-18), never the event date. Buffer is not counted as a shortfall; cancelled events are excluded. Carries no money. Admin-only: security_invoker plus current_app_role() = admin (20261001200400).';

revoke all on dashboard_short_staffed_v from public, anon;
grant select on dashboard_short_staffed_v to authenticated;
