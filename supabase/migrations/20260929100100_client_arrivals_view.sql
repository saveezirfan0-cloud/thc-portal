-- =====================================================================
-- Migration 20260929100100 · "11 of 13 arrived" for the customer
--                            (§11.1, §11.2 addition; ADR-0038)
--
-- A client-approved addition to §11: on the day, the Client Portal shows
-- how many of the confirmed line-up have arrived. COUNTS ONLY. No name, no
-- check-in time, no Late / No-show label per person, no location — the
-- customer learns "11 of 13", never "who" or "when".
--
-- What an arrival is
-- ------------------
-- A booking the customer can already see on client_lineup_v (status
-- confirmed or worked) that has a check-in recorded for this shift: a
-- check_logs row with outcome 'checked_in' and a check_in_at. That row is
-- written by attempt_check_in() on an accepted check-in (on time or Late,
-- §9.5) and by resolve_violation()'s "Get back", which "registers the
-- worker as arrived" (§9.5). So:
--
--   · confirmed = the same count client_role_sections_v shows for the
--     section — the denominator is the confirmed line-up, never the
--     headcount and never the buffer.
--   · a worker turned away under the strict buffer policy (RULE-15) is
--     `turned_away`: not on the line-up, so in neither number.
--   · a No-show has no check_in_at: counted in `confirmed`, not `arrived`.
--   · an out-of-radius press has no check_in_at either: not an arrival.
--   · several attempts by one worker count once (exists, not a join).
--
-- When it has rows
-- ----------------
-- Only once the event has started (the earliest role start, event_windows,
-- is at or before now()), and never for a cancelled event. The gate lives
-- here rather than in the UI: before the day starts there is nothing to
-- count, and a view that hands "0 of 13 arrived" to anyone who asks is a
-- weaker rule than one that hands back no row. Every role section of a
-- started event has a row, including a later section that has not begun
-- yet (it reads 0 of N): per-role windows are the section's own (RULE-18)
-- and the screen already shows them.
--
-- Shape (ADR-0004, ADR-0026)
-- --------------------------
-- The same as client_role_sections_v: owner rights (no security_invoker),
-- security_barrier, client_portal_visible(e.client_id) in its own body,
-- named columns, SELECT to authenticated and nothing else to anybody.
-- check_logs, bookings and shift_requirements stay closed to the client
-- role — no policy is added anywhere, and 001_rls_guard's empty set holds.
-- =====================================================================

create view client_arrivals_v with (security_barrier = true) as
  select sr.id       as shift_id,
         sr.event_id,
         (select count(*)
            from bookings b
           where b.shift_id = sr.id
             and b.status in ('confirmed', 'worked'))::int as confirmed,
         (select count(*)
            from bookings b
           where b.shift_id = sr.id
             and b.status in ('confirmed', 'worked')
             and exists (select 1
                           from check_logs cl
                          where cl.booking_id = b.id
                            and cl.outcome = 'checked_in'
                            and cl.check_in_at is not null))::int as arrived
    from shift_requirements sr
    join events e        on e.id = sr.event_id
    join event_windows w on w.event_id = e.id
   where e.cancelled_at is null
     and w.starts_at <= now()
     and client_portal_visible(e.client_id);

comment on view client_arrivals_v is
  'On-the-day arrival COUNTS per role section for the customer ("11 of 13 arrived", ADR-0038). Owner rights + client_portal_visible() per ADR-0004. confirmed = the confirmed line-up (matches client_role_sections_v.confirmed); arrived = those of them with a check-in recorded (worker check-in or the office''s "Get back"). Turned-away (RULE-15) is in neither; a No-show is in confirmed only. Rows only once the event''s earliest role start has passed, never for a cancelled event. No names, no times, no per-person status, no location, no money.';

revoke all on client_arrivals_v from public, anon, authenticated;
grant select on client_arrivals_v to authenticated;
