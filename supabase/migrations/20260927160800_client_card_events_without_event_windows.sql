-- =====================================================================
-- Migration 20260927160800 · the client card's event list works for an
--                            admin session (§9.7 block 4)
--
-- clients_event_list_v is `security_invoker` and joined event_windows,
-- which 0009 revoked from public, anon and authenticated so that no
-- invoker view could borrow its owner rights. The office reads with the
-- signed-in manager's session (role `authenticated`), so the view failed
-- with 42501 for every admin and §9.7's fourth block — and with it the
-- card — never rendered. dashboard_upcoming_v (20260922182000) already
-- avoids the same trap by deriving the window itself; this does the same
-- with a lateral min/max over shift_requirements, which an admin may read.
-- Same columns, same comment; only the join changes.
-- =====================================================================

create or replace view clients_event_list_v with (security_invoker = true) as
select
  e.id,
  e.client_id,
  e.title,
  e.po_number,
  e.event_date,
  w.starts_at,
  w.ends_at,
  e.venue_name,
  e.cancelled_at,
  event_status(e.*, w.starts_at, w.ends_at)                  as status,
  (select count(*) from shift_requirements s where s.event_id = e.id)::int as section_count,
  (select string_agg(r.name || ' ' || s.headcount || ' (+' || s.buffer || ')', ' · '
                     order by r.name)
     from shift_requirements s join roles r on r.id = s.role_id
    where s.event_id = e.id)                                 as roles_summary,
  case when e.cancelled_at is null then (
    select round(sum((s.charge_rate - final_rate(s.pay_rate)) * s.headcount
                     * extract(epoch from (s.ends_at - s.starts_at)) / 3600), 2)
      from shift_requirements s where s.event_id = e.id
  ) end                                                      as margin_gbp,
  case when e.cancelled_at is null then (
    select case when sum(s.charge_rate * s.headcount
                         * extract(epoch from (s.ends_at - s.starts_at)) / 3600) > 0
                then round((1 - sum(final_rate(s.pay_rate) * s.headcount
                                    * extract(epoch from (s.ends_at - s.starts_at)) / 3600)
                              / sum(s.charge_rate * s.headcount
                                    * extract(epoch from (s.ends_at - s.starts_at)) / 3600)) * 100, 1)
           end
      from shift_requirements s where s.event_id = e.id
  ) end                                                      as margin_pct
from events e
-- The DERIVED window (§3.2, RULE-18), computed here rather than read from
-- event_windows: 0009 revoked that view from the PostgREST roles, and an
-- invoker view may not borrow rights its caller does not hold.
join lateral (
  select min(s.starts_at) as starts_at, max(s.ends_at) as ends_at
    from shift_requirements s where s.event_id = e.id
) w on w.starts_at is not null;

comment on view clients_event_list_v is
  '§9.7 block 4: every event for a client with its PO, the DERIVED window (§3.2 — min start to max end across role sections, never a stored pair; computed inline because event_windows is not granted to the office''s session), its role sections and its margin. A cancelled event keeps its row but has a null margin, not a zero one: zero would pull an average down with money nobody ever expected.';
