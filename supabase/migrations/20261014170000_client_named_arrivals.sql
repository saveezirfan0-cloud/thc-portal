-- =====================================================================
-- Migration 20261014170000 · named arrivals on the day (§11.2, §9.5,
--                            §1.8, RULE-15; ADR-0004, ADR-0026,
--                            ADR-0053, ADR-0134, ADR-0135 §1)
--
-- The product owner, 14.10.2026 ("Named arrivals on the day", proposal
-- P2 in docs/20 Part B): during the event the customer's line-up says,
-- per person, "Arrived 08:52" or "Not here yet". ADR-0053 kept arrivals
-- to counts and said named attendance needs its own ADR; ADR-0135 §1 is
-- that ADR, with its privacy section.
--
-- client_lineup_v gains two columns, appended (no existing column moves):
--
--   arrival_status  'arrived' | 'expected' | 'not_arrived', or NULL.
--     'arrived'      a `checked_in` check-log with a check-in time (the
--                    worker's own, on time or Late, or the office's
--                    "Get back", §9.5), or a booking already `worked` —
--                    exactly what takes a seat first in 20261014140000
--                    and what client_arrivals_v counts.
--     'not_arrived'  not arrived 30 minutes after the ROLE SECTION's own
--                    start (RULE-18): the moment §9.5 marks a No-show and
--                    locks the check-in button. The customer is told the
--                    fact ("Not arrived"), never the office's violation.
--                    A booking confirmed after the section started is
--                    exempt from that lock (§9.5, confirmed 01.09.2026),
--                    so it stays 'expected' until the end.
--     'expected'     everyone else on the visible line-up.
--   arrived_at      the first check-in time of an 'arrived' row (null for
--                   a `worked` booking with no check-in), else NULL. The
--                   portal shows it viewer-local, an actual stamp (§1.8).
--
-- Both are NULL unless ALL of these hold, so nothing is said before or
-- after the event, or about anyone the customer is not shown:
--   · the event is live: now() between its window's start and end — the
--     same test client_arrivals_v and event_status() use (ADR-0053 §4);
--   · the event is not cancelled;
--   · the row holds a seat (seat <= headcount): a worker kept visible only
--     because the customer already rated them (ADR-0134 §1) is not in the
--     trimmed line-up and gets no arrival state.
-- After the end the columns go back to NULL, so the view never becomes a
-- per-person attendance record (the signed timesheet is the record of the
-- day, §11.3).
--
-- Nothing else is exposed: no location, no distance, no accuracy, no
-- check-out, no Late or No-show label, no violation, no attempt count.
-- The list page does not ask for the columns (it keeps counts only).
--
-- Body restated from 20261014140200 (feedback_text) with the two columns
-- appended; ADR-0004's shape is unchanged: owner rights, security_barrier,
-- client_portal_visible(e.client_id) in its own body, named columns,
-- SELECT to authenticated only. 831_client_named_arrivals pins it.
--
-- Forward-only.
-- =====================================================================

create or replace view client_lineup_v with (security_barrier = true) as
  select l.booking_id,
         l.event_id,
         l.role,
         l.starts_at,
         l.ends_at,
         l.name,
         l.photo_path,
         l.sort_key,
         l.feedback_given,
         l.shift_id,
         l.feedback_rating,
         l.feedback_sent_at,
         l.feedback_text,
         -- ADR-0135 §1: only for a seated row of a live, uncancelled event.
         case when l.seat <= l.headcount then l.arrival_status end as arrival_status,
         case when l.seat <= l.headcount and l.arrival_status = 'arrived' then l.first_in end as arrived_at
    from (
      select b.id as booking_id,
             sr.event_id,
             r.name as role,
             sr.starts_at,
             sr.ends_at,
             case when s.removed_at is null then s.first_name || ' ' || s.last_name
                  else deleted_account_label(s.employee_id) end as name,
             case when s.removed_at is null then s.photo_path end as photo_path,
             -- §11.3's order. A removed worker sorts under their anonymised
             -- label: surfacing the real surname as an order would undo §1.7.
             case when s.removed_at is null then lower(s.last_name)
                  else 'zzzz-deleted-' || coalesce(s.employee_id::text, 'unknown') end as sort_key,
             -- §11.2 "✓ Feedback sent": the customer's own entry only.
             exists (select 1
                       from feedback f
                      where f.event_id = sr.event_id
                        and f.staff_id = b.staff_id
                        and f.author_kind = 'client') as feedback_given,
             sr.id as shift_id,
             cf.rating     as feedback_rating,
             cf.created_at as feedback_sent_at,
             -- The customer's own words on that entry (ADR-0134 N4); withheld
             -- once the worker is removed (§1.7).
             case when s.removed_at is null then cf.text end as feedback_text,
             sr.headcount,
             ci.first_in,
             -- ADR-0135 §1: what the door would tell the customer, only
             -- while the event is live and never for a cancelled one.
             case
               when e.cancelled_at is not null
                 or w.starts_at is null
                 or not (now() between w.starts_at and w.ends_at) then null
               when ci.first_in is not null or b.status = 'worked' then 'arrived'
               when now() >= sr.starts_at + interval '30 minutes'
                and coalesce(b.confirmed_at, b.created_at) <= sr.starts_at then 'not_arrived'
               else 'expected'
             end as arrival_status,
             -- The seat this booking takes in its section (RULE-15). The
             -- event id leads the partition so a caller's event filter can
             -- be applied before the ranking rather than after it.
             row_number() over (
               partition by sr.event_id, sr.id
               order by (ci.first_in is not null or b.status = 'worked') desc,
                        ci.first_in asc nulls last,
                        coalesce(b.confirmed_at, b.created_at) asc,
                        b.id asc
             ) as seat
        from bookings b
        join shift_requirements sr on sr.id = b.shift_id
        join events e              on e.id  = sr.event_id
        join roles r               on r.id  = sr.role_id
        join staff s               on s.id  = b.staff_id
        left join event_windows w  on w.event_id = e.id
        left join lateral (
          select min(cl.check_in_at) as first_in
            from check_logs cl
           where cl.booking_id = b.id
             and cl.outcome = 'checked_in'
             and cl.check_in_at is not null
        ) ci on true
        left join lateral (
          select f.rating, f.created_at, f.text
            from feedback f
           where f.event_id = sr.event_id
             and f.staff_id = b.staff_id
             and f.author_kind = 'client'
           order by f.created_at desc
           limit 1
        ) cf on true
       where b.status in ('confirmed', 'worked')
         and client_portal_visible(e.client_id)
    ) l
   where l.seat <= l.headcount
      or l.feedback_given;

comment on view client_lineup_v is
  'The confirmed line-up a customer sees (§11.2), at most the headcount they booked per role section (20261014140000, ADR-0134): seats go first to whoever has checked in (or worked), by first check-in time, then by when the booking was confirmed, then by booking id (RULE-15); a worker the customer has already rated stays visible whatever their seat. THC''s buffer never reaches the customer. Owner rights + client_portal_visible() per ADR-0004; the client role holds no policy on bookings, shift_requirements, roles, staff, check_logs or feedback and must not be given one. Photo, name and role only: never a rate, never the selection process (Invited / Potential pool / Unavailable). shift_id names the role section (the key client_role_sections_v returns). feedback_given / feedback_rating / feedback_sent_at / feedback_text describe the customer''s OWN entry (author_kind = client) — its stars, when it was sent and the customer''s own comment, withheld once the worker is removed (20261014140200, ADR-0134 N4) — never the office''s entries or words. arrival_status (arrived / expected / not_arrived) and arrived_at (first check-in) are set only for a seated row while the event is live and not cancelled, and NULL before, after and otherwise (20261014170000, ADR-0135 §1): no location, no check-out, no Late / No-show label. photo_path''s first segment is staff.id (ADR-0026: it reaches nothing). A removed worker reads deleted_account_label() (§1.7).';

revoke all on client_lineup_v from public, anon, authenticated;
grant select on client_lineup_v to authenticated;
