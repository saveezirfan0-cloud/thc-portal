-- =====================================================================
-- Migration 20261014140000 · the customer's line-up stops at the
--                            headcount they booked (§11.1, §11.2, §3.2,
--                            RULE-15; ADR-0004, ADR-0026, ADR-0053,
--                            ADR-0134)
--
-- The product owner, 14.10.2026: "only up to headcount". An over-booked
-- role section showed every confirmed worker — six faces under "Waiting
-- Staff · 4 of 4" — so THC's buffer (§3.2: insurance on top of the
-- headcount, internal to THC) was in front of the customer. Round 2 held
-- the COUNTS to the headcount in the portal (rules.ts cappedConfirmed);
-- the rows and the raw counts still reached the browser. This moves the
-- rule into the views, so what the customer is not shown is not sent.
--
-- 1 · client_lineup_v returns at most `headcount` rows per role section.
--     Who fills the seats follows the strict buffer policy (RULE-15:
--     "the first headcount check-ins work; later ones are turned away"):
--       a. anyone who has checked in (a `checked_in` check-log with a
--          check-in time — a worker's own, on time or Late, or the
--          office's "Get back"), or whose booking is already `worked`,
--          first — by their first check-in time;
--       b. then everyone else by when their booking was confirmed
--          (bookings.confirmed_at; created_at where an old row has none);
--       c. then the booking id, so the order is total and a refresh never
--          swaps two people with the same timestamps.
--     Before the event nobody has checked in, so (b) decides: the people
--     confirmed first, who are the ones THC counts as the booking. On the
--     day the seats follow the doors, as RULE-15 does.
--     A worker the customer has already left feedback on stays visible
--     whatever their seat: the customer rated a person they saw, and the
--     line-up must not make that entry vanish (it is also what the
--     feedback history reads, ADR-0134 N4). That is the one way a section
--     can show more than its headcount, and only with a face the customer
--     has already seen and rated.
--
-- 2 · client_role_sections_v.confirmed is held to the headcount:
--     least(confirmed, headcount). "6 of 4" never leaves the database; a
--     full section reads N = M, a short one its true shortfall.
--
-- 3 · client_arrivals_v's two counts are held to the same seats:
--     confirmed = least(confirmed, headcount) (the figure above), and
--     arrived = least(arrived, headcount). Because checked-in workers take
--     the seats first, "arrived among the visible line-up" is exactly
--     least(arrived, headcount), so the pill and the faces agree.
--
-- What does not change: the booking rows, the office's own counts and
-- views, the PDF (§11.3 prints who worked), submit_client_feedback() (it
-- still takes a booking on the confirmed line-up; a booking id outside
-- the trimmed set never reaches the browser), and ADR-0004's shape —
-- owner rights, security_barrier, client_portal_visible() in each body,
-- named columns, SELECT to authenticated only. Every column keeps its
-- name, type and place; the bodies are the latest definitions
-- (client_lineup_v: 20261013100300; client_role_sections_v: 0005;
-- client_arrivals_v: 20261001100100) with the cap added.
--
-- Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · client_lineup_v · at most `headcount` per section
-- ---------------------------------------------------------------------
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
         l.feedback_sent_at
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
          select f.rating, f.created_at
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
  'The confirmed line-up a customer sees (§11.2), at most the headcount they booked per role section (20261014140000, ADR-0134): seats go first to whoever has checked in (or worked), by first check-in time, then by when the booking was confirmed, then by booking id (RULE-15); a worker the customer has already rated stays visible whatever their seat. THC''s buffer never reaches the customer. Owner rights + client_portal_visible() per ADR-0004; the client role holds no policy on bookings, shift_requirements, roles, staff, check_logs or feedback and must not be given one. Photo, name and role only: never a rate, never the selection process (Invited / Potential pool / Unavailable). shift_id names the role section (the key client_role_sections_v returns). feedback_given / feedback_rating / feedback_sent_at describe the customer''s OWN entry (author_kind = client) — never the office''s. photo_path''s first segment is staff.id (ADR-0026: it reaches nothing). A removed worker reads deleted_account_label() (§1.7).';

revoke all on client_lineup_v from public, anon, authenticated;
grant select on client_lineup_v to authenticated;

-- ---------------------------------------------------------------------
-- 2 · client_role_sections_v · confirmed never above the headcount
-- ---------------------------------------------------------------------
create or replace view client_role_sections_v with (security_barrier = true) as
  select sr.id as shift_id,
         sr.event_id,
         r.name as role,
         sr.starts_at,
         sr.ends_at,
         sr.headcount,
         least((select count(*)
                  from bookings b
                 where b.shift_id = sr.id
                   and b.status in ('confirmed', 'worked')), sr.headcount)::int as confirmed
    from shift_requirements sr
    join events e on e.id = sr.event_id
    join roles r  on r.id = sr.role_id
   where client_portal_visible(e.client_id);

comment on view client_role_sections_v is
  'Role sections as the customer sees them (§11.1 "N of M confirmed", §11.2 grouped by role). Owner rights + client_portal_visible() per ADR-0004. Carries the role-section window (RULE-18), the ordered headcount and the confirmed count HELD TO the headcount (20261014140000, ADR-0134), so an over-booked section reads "4 of 4", never "6 of 4" — no charge_rate, no pay_rate, no buffer.';

revoke all on client_role_sections_v from public, anon, authenticated;
grant select on client_role_sections_v to authenticated;

-- ---------------------------------------------------------------------
-- 3 · client_arrivals_v · both counts held to the same seats
-- ---------------------------------------------------------------------
create or replace view client_arrivals_v with (security_barrier = true) as
  select sr.id       as shift_id,
         sr.event_id,
         least((select count(*)
                  from bookings b
                 where b.shift_id = sr.id
                   and b.status in ('confirmed', 'worked')), sr.headcount)::int as confirmed,
         least((select count(*)
                  from bookings b
                 where b.shift_id = sr.id
                   and b.status in ('confirmed', 'worked')
                   and exists (select 1
                                 from check_logs cl
                                where cl.booking_id = b.id
                                  and cl.outcome = 'checked_in'
                                  and cl.check_in_at is not null)), sr.headcount)::int as arrived
    from shift_requirements sr
    join events e        on e.id = sr.event_id
    join event_windows w on w.event_id = e.id
   where e.cancelled_at is null
     and now() between w.starts_at and w.ends_at
     and client_portal_visible(e.client_id);

comment on view client_arrivals_v is
  'On-the-day arrival COUNTS per role section for the customer ("11 of 13 arrived", ADR-0053). Owner rights + client_portal_visible() per ADR-0004. confirmed = the confirmed line-up held to the headcount (matches client_role_sections_v.confirmed); arrived = those with a check-in recorded (worker check-in or the office''s "Get back"), held to the same headcount — the checked-in take the line-up''s seats first (20261014140000, ADR-0134), so it is the arrivals among the faces the customer sees. Turned-away (RULE-15) is in neither; a No-show is in confirmed only. Rows only while the event is ongoing, never for a cancelled event. No names, no times, no per-person status, no location, no money.';

revoke all on client_arrivals_v from public, anon, authenticated;
grant select on client_arrivals_v to authenticated;
