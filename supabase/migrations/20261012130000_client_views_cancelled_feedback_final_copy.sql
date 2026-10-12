-- =====================================================================
-- Migration 20261012130000 · what the Client Portal still could not show,
--                            and a "Completed" copy served too early
--                            (§11.1, §11.2, §11.5, §11.3; ADR-0004,
--                            ADR-0026, ADR-0114)
--
-- 1 · client_events_v gains cancelled_at.
--     wireframes/client/events.html draws "cancelled <date>" under a
--     cancelled row, greyed, with no document. The view returned the
--     status and nothing about when. events.cancelled_at is a timestamp:
--     no money, no worker data. cancel_reason stays out — it is the
--     office's own note (ADR-0026 removed the row-wide events policy for
--     exactly that column among others).
--
-- 2 · client_lineup_v gains feedback_rating and feedback_sent_at.
--     §11.2: after submit the button reads "✓ Feedback sent"; the portal
--     shows the customer what it sent (the stars and when). The client
--     role holds no policy on feedback (ADR-0026), so the view carries the
--     customer's OWN entry for that booking: the same predicate
--     feedback_given has used since 20260921140000 — this event, this
--     worker, author_kind = 'client'. One row at most: the partial unique
--     index feedback_one_client_entry_per_event_staff, and an event has
--     one client, so the only client entry on it is that client's. The
--     office's entries (author_kind = 'office') never match, and the
--     comment text is not carried (§9.10 keeps feedback internal beyond
--     the customer's own stars).
--
-- 3 · client_event_documents_v serves a sign-out copy only once it is
--     final: sent, or drawn at or after the last role's end + 4 h.
--     20260923193100 used `generated_at >= ends_at`, but check-out stays
--     open until end + 4 h (RULE-02, §9.5), so a copy drawn at end + 1 h
--     could still print blank Finish Time / Hours Worked cells and became
--     the customer's "Completed Timesheet". end + 4 h is the moment the
--     last check-out window closes — the same floor D2 waits for
--     (ADR-0074). ADR-0114 records why "no booking still unsettled" was
--     not chosen as the view's rule: it is a fact about now, not about the
--     copy, so it would serve a copy drawn while a No check-out was open
--     once that violation was later resolved.
--
-- Every view keeps ADR-0004's shape: owner rights (no security_invoker),
-- security_barrier, client_portal_visible() in its own body, named
-- columns, SELECT to authenticated and nothing else to anybody.
-- `create or replace` appends the new columns after the existing ones;
-- no existing column moves, so the bodies are otherwise the latest
-- definitions verbatim (client_events_v: 20260921140000; client_lineup_v:
-- 20260930110400; client_event_documents_v: 20260923193100).
--
-- Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · client_events_v + cancelled_at
-- ---------------------------------------------------------------------
create or replace view client_events_v with (security_barrier = true) as
  select e.id,
         e.client_id,
         e.title,
         e.venue_name,
         e.venue_address,
         e.event_date,
         e.po_number,
         e.onsite_contact,
         w.starts_at,
         w.ends_at,
         event_status(e, w.starts_at, w.ends_at) as status,
         -- "cancelled <date>" under a greyed row (§11.1). Null unless the
         -- event is cancelled; the reason is not carried.
         e.cancelled_at
    from events e
    join event_windows w on w.event_id = e.id
   where client_portal_visible(e.client_id);

comment on view client_events_v is
  'The customer''s own events (§11.1). Owner rights + client_portal_visible() per ADR-0004, so it can read the event window without a policy on the money-bearing shift_requirements table. Event window = min role start -> max role end (§1.5); per-role timings come from client_role_sections_v (RULE-18). onsite_contact is the §11.2 header field; cancelled_at dates a cancelled row (20261012130000) — never the reason. No rate, no charge, no margin.';

revoke all on client_events_v from public, anon, authenticated;
grant select on client_events_v to authenticated;

-- ---------------------------------------------------------------------
-- 2 · client_lineup_v + the customer's own feedback entry
-- ---------------------------------------------------------------------
create or replace view client_lineup_v with (security_barrier = true) as
  select b.id as booking_id,
         sr.event_id,
         r.name as role,
         sr.starts_at,
         sr.ends_at,
         case when s.removed_at is null then s.first_name || ' ' || s.last_name
              else deleted_account_label(s.employee_id) end as name,
         case when s.removed_at is null then s.photo_path end as photo_path,
         -- §11.3's order, so the screen and the PDF list the same people in
         -- the same sequence. A removed worker sorts under their anonymised
         -- label: surfacing the real surname as an order would undo §1.7.
         case when s.removed_at is null then lower(s.last_name)
              else 'zzzz-deleted-' || coalesce(s.employee_id::text, 'unknown') end as sort_key,
         -- §11.2 "✓ Feedback sent". One boolean about the customer's own
         -- entry; the office's feedback on the same worker stays invisible
         -- here (§9.10).
         exists (select 1
                   from feedback f
                  where f.event_id = sr.event_id
                    and f.staff_id = b.staff_id
                    and f.author_kind = 'client') as feedback_given,
         -- The role section, so two sections of one role stay two groups.
         sr.id as shift_id,
         -- The customer's own entry: its stars and when it was sent. Same
         -- predicate as feedback_given, so the three always agree.
         cf.rating     as feedback_rating,
         cf.created_at as feedback_sent_at
    from bookings b
    join shift_requirements sr on sr.id = b.shift_id
    join events e              on e.id  = sr.event_id
    join roles r               on r.id  = sr.role_id
    join staff s               on s.id  = b.staff_id
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
     and client_portal_visible(e.client_id);

comment on view client_lineup_v is
  'The confirmed line-up a customer sees (§11.2). Owner rights + client_portal_visible() per ADR-0004; the client role holds no policy on bookings, shift_requirements, roles, staff or feedback and must not be given one. Photo, name and role only: never a rate, never the selection process (Invited / Potential pool / Unavailable). shift_id names the role section (the same key client_role_sections_v returns) so two sections of one role stay two groups, as on the §11.3 PDF. feedback_given / feedback_rating / feedback_sent_at describe the customer''s OWN entry for that worker on that event (author_kind = client; one per event and worker) — never the office''s entries, never the comment (20261012130000). photo_path is the worker''s Storage path and its first segment is staff.id (the photos bucket keys objects by owner); it reaches nothing — staff_caller() refuses it and feedback is keyed on booking_id, which is why submit_client_feedback() takes the booking (ADR-0026). A removed worker reads deleted_account_label(), which never returns null (§1.7).';

revoke all on client_lineup_v from public, anon, authenticated;
grant select on client_lineup_v to authenticated;

-- ---------------------------------------------------------------------
-- 3 · client_event_documents_v · a final copy waits for end + 4 h
-- ---------------------------------------------------------------------
create or replace view client_event_documents_v with (security_barrier = true) as
select distinct on (d.event_id, d.kind)
       d.id,
       d.event_id,
       d.kind,
       d.file_name,
       d.storage_path,
       d.generated_at as issued_at
  from event_documents d
  join events e on e.id = d.event_id
  left join event_windows w on w.event_id = e.id
 where client_portal_visible(e.client_id)
   and e.cancelled_at is null
   and (d.kind = 'allocation'
        or d.sent_at is not null
        -- Check-out stays open until the last role's end + 4 h (RULE-02),
        -- so only a copy drawn after that can have every finish time.
        or (w.ends_at is not null and d.generated_at >= w.ends_at + interval '4 hours'))
 order by d.event_id, d.kind, d.generated_at desc;

comment on view client_event_documents_v is
  '§11.1/§11.2 downloads for the client whose event it is (client_portal_visible, ADR-0004): the latest Allocation Timesheet the office stored, and the latest FINAL Completed Timesheet (code: signout) — one that was sent, or drawn at or after the event''s last role end + 4 h, when the last check-out window closes (20261012130000, ADR-0114) — never a copy with blank finish times. Nothing for a cancelled event. No money column. Signed URLs are made server-side from storage_path.';

revoke all on client_event_documents_v from public, anon, authenticated;
grant select on client_event_documents_v to authenticated;
