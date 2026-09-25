-- =====================================================================
-- Migration 20260929160000 · the client line-up carries its role section
--                            (§11.2, §11.3, RULE-18)
--
-- The event page grouped the confirmed line-up by role NAME and took the
-- first section's window for the panel header, so an event with two
-- sections of one role (Waiting Staff 07:00–15:00 and Waiting Staff
-- 17:00–23:30) showed one "Waiting Staff" panel under the morning
-- window with the evening staff inside it. The §11.3 PDF keys its
-- sections by shift id (packages/pdf/src/sheet.ts `sectionKey`), so the
-- screen and the document disagreed.
--
-- client_lineup_v now names the section each booking is on. The shift id
-- is an opaque key that client_role_sections_v already returns to the
-- same caller: no money, no worker data, nothing new is reachable with it.
--
-- `create or replace` appends the column at the end, which keeps every
-- existing column in place. The body is otherwise the 20260921192246
-- definition verbatim: owner rights, security barrier, tenancy predicate
-- in the body (ADR-0004), confirmed and worked bookings only.
-- =====================================================================

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
         sr.id as shift_id
    from bookings b
    join shift_requirements sr on sr.id = b.shift_id
    join events e              on e.id  = sr.event_id
    join roles r               on r.id  = sr.role_id
    join staff s               on s.id  = b.staff_id
   where b.status in ('confirmed', 'worked')
     and client_portal_visible(e.client_id);

comment on view client_lineup_v is
  'The confirmed line-up a customer sees (§11.2). Owner rights + client_portal_visible() per ADR-0004; the client role holds no policy on bookings, shift_requirements, roles or staff and must not be given one. Photo, name and role only: never a rate, never the selection process (Invited / Potential pool / Unavailable). shift_id names the role section (the same key client_role_sections_v returns) so two sections of one role stay two groups, as on the §11.3 PDF. photo_path is the worker''s Storage path and its first segment is staff.id (the photos bucket keys objects by owner); it reaches nothing — staff_caller() refuses it and feedback is keyed on booking_id, which is why submit_client_feedback() takes the booking (ADR-0026). A removed worker reads deleted_account_label(), which never returns null (§1.7).';

-- ADR-0004 rule (d): a client_* view is granted SELECT to authenticated
-- and nothing else, to anybody.
revoke all on client_lineup_v from public, anon, authenticated;
grant select on client_lineup_v to authenticated;
