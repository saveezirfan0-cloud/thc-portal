-- =====================================================================
-- Migration 20261014140200 · the customer's own words come back to them
--                            (§11.2, §11.5, §9.10; ADR-0004, ADR-0026,
--                            ADR-0134 N4)
--
-- "Feedback you've given" (/client/feedback, approved 14.10.2026) lists
-- every entry the customer has left: worker · event · date · their stars ·
-- when they sent it — and, approved with it, the comment they wrote.
-- client_lineup_v already carries the stars and the time of the
-- customer's OWN entry (20261013100300); this appends feedback_text, the
-- same row's text. Same predicate, same lateral row: author_kind =
-- 'client' on this event and this worker, of which there is at most one
-- (feedback_one_client_entry_per_event_staff) and only this customer can
-- have written it (an event has one client). The office's entries
-- (author_kind = 'office') and their words never match, so §9.10's "the
-- office's feedback stays internal" holds.
--
-- A removed worker's entry keeps its stars and time but not its text:
-- §1.7 keeps feedback text verbatim for the office to redact by hand
-- (20260921190118), and a comment naming the person would undo the
-- "Deleted account #id" the line-up shows.
--
-- The portal asks for the column only on the feedback history page; the
-- list and the event page keep their column lists, so a comment is never
-- shipped where it is not shown.
--
-- Body restated from 20261014140000 (the headcount trim) with the column
-- appended; no existing column moves. ADR-0004's shape is unchanged.
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
         l.feedback_text
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
             -- The customer's own words on that entry, for "Feedback you've
             -- given" (ADR-0134 N4). Never the office's. Withheld once the
             -- worker is removed (§1.7): the text is kept verbatim for the
             -- office to redact by hand (20260921190118), and a comment that
             -- names the person must not undo "Deleted account #id" here.
             case when s.removed_at is null then cf.text end as feedback_text,
             sr.headcount,
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
  'The confirmed line-up a customer sees (§11.2), at most the headcount they booked per role section (20261014140000, ADR-0134): seats go first to whoever has checked in (or worked), by first check-in time, then by when the booking was confirmed, then by booking id (RULE-15); a worker the customer has already rated stays visible whatever their seat. THC''s buffer never reaches the customer. Owner rights + client_portal_visible() per ADR-0004; the client role holds no policy on bookings, shift_requirements, roles, staff, check_logs or feedback and must not be given one. Photo, name and role only: never a rate, never the selection process (Invited / Potential pool / Unavailable). shift_id names the role section (the key client_role_sections_v returns). feedback_given / feedback_rating / feedback_sent_at / feedback_text describe the customer''s OWN entry (author_kind = client) — its stars, when it was sent and the customer''s own comment, withheld once the worker is removed (20261014140200, ADR-0134 N4) — never the office''s entries or words. photo_path''s first segment is staff.id (ADR-0026: it reaches nothing). A removed worker reads deleted_account_label() (§1.7).';

revoke all on client_lineup_v from public, anon, authenticated;
grant select on client_lineup_v to authenticated;
