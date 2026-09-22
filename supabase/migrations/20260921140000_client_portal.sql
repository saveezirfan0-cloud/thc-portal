-- =====================================================================
-- Client Portal · §11.1 the event list, §11.2 the event page, §11.5 feedback
--
-- 0005_client_lineup gave the portal its data path and 0009 finished it:
-- three `client_*` views that run with their owner's rights and carry
-- client_portal_visible() in their own bodies (ADR-0004). The base tables
-- stay closed — the client role still holds a policy on `events` and
-- `feedback` and nothing else, which IS the money isolation (§11.1).
--
-- Building the two screens needs three things those views do not yet give:
--
--   1. The on-site contact. §11.2's header shows "Your on-site contact",
--      and it lives on events.onsite_contact. No money, no worker data.
--
--   2. Whether the customer has already left feedback for a worker on an
--      event. §11.2: once submitted the button becomes "✓ Feedback sent".
--      The client holds an INSERT policy on `feedback` and no SELECT, so
--      the flag is computed in the view rather than by opening the table —
--      the client learns one boolean about its own entry and nothing about
--      the office's (§9.10 keeps those internal).
--
--   3. A stable order. §11.3 orders the PDF by role section, then surname,
--      "so the same person is easy to find on a 60-name sheet", and §11.2
--      shows the same line-up. Ordering happens here so the screen and the
--      document cannot disagree. A removed worker sorts by their
--      anonymised label, never by the real surname the row no longer shows
--      (§1.7).
--
-- What this migration deliberately does NOT do: expose staff.id. The
-- feedback RPC takes the booking id the view already returns and resolves
-- the worker server-side, so the portal never learns a worker identifier
-- it has no use for.
-- =====================================================================

-- ---------------------------------------------------------------------
-- §11.2 · the event header gains the on-site contact
--
-- Replaced rather than altered: a view's column list cannot be extended
-- in place, and 0009 dropped and recreated this one for the same reason.
-- Everything else is 0009's body unchanged, including the owner rights
-- and the security_barrier that keeps a user-supplied qual from running
-- ahead of the tenancy predicate.
-- ---------------------------------------------------------------------
drop view if exists client_events_v;

create view client_events_v with (security_barrier = true) as
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
         event_status(e, w.starts_at, w.ends_at) as status
    from events e
    join event_windows w on w.event_id = e.id
   where client_portal_visible(e.client_id);

comment on view client_events_v is
  'The customer''s own events (§11.1). Owner rights + client_portal_visible() per ADR-0004, so it can read the event window without a policy on the money-bearing shift_requirements table. Event window = min role start -> max role end (§1.5); per-role timings come from client_role_sections_v (RULE-18). onsite_contact is the §11.2 header field; no rate, no charge, no margin.';

revoke all on client_events_v from public, anon, authenticated;
grant select on client_events_v to authenticated;

-- ---------------------------------------------------------------------
-- §11.2 · the line-up gains its feedback flag and its sort key
-- ---------------------------------------------------------------------
drop view if exists client_lineup_v;

create view client_lineup_v with (security_barrier = true) as
  select b.id as booking_id,
         sr.event_id,
         r.name as role,
         sr.starts_at,
         sr.ends_at,
         case when s.removed_at is null then s.first_name || ' ' || s.last_name
              else 'Deleted account #' || s.employee_id end as name,
         case when s.removed_at is null then s.photo_path end as photo_path,
         -- §11.3's order, so the screen and the PDF list the same people in
         -- the same sequence. A removed worker sorts under their anonymised
         -- label: surfacing the real surname as an order would undo §1.7.
         case when s.removed_at is null then lower(s.last_name)
              else 'zzzz-deleted-' || s.employee_id end as sort_key,
         -- §11.2 "✓ Feedback sent". One boolean about the customer's own
         -- entry; the office's feedback on the same worker stays invisible
         -- here (§9.10).
         exists (select 1
                   from feedback f
                  where f.event_id = sr.event_id
                    and f.staff_id = b.staff_id
                    and f.author_kind = 'client') as feedback_given
    from bookings b
    join shift_requirements sr on sr.id = b.shift_id
    join events e              on e.id  = sr.event_id
    join roles r               on r.id  = sr.role_id
    join staff s               on s.id  = b.staff_id
   where b.status in ('confirmed', 'worked')
     and client_portal_visible(e.client_id);

comment on view client_lineup_v is
  'The confirmed line-up a customer sees (§11.2). Owner rights + client_portal_visible() per ADR-0004; the client role holds no policy on bookings, shift_requirements, roles or staff and must not be given one. Photo, name and role only: never a rate, never the selection process (Invited / Potential pool / Unavailable). staff.id is deliberately absent — submit_client_feedback() takes booking_id instead.';

revoke all on client_lineup_v from public, anon, authenticated;
grant select on client_lineup_v to authenticated;

-- ---------------------------------------------------------------------
-- §11.5 · one client entry per worker per event
--
-- The scope allows the office to leave its own feedback on the same
-- worker and event (§9.10, "because not every client uses the portal"),
-- so this is partial on author_kind: it constrains the portal without
-- constraining the office.
-- ---------------------------------------------------------------------
create unique index if not exists feedback_one_client_entry_per_event_staff
  on feedback (event_id, staff_id)
  where author_kind = 'client';

-- ---------------------------------------------------------------------
-- §11.2 / §11.5 · leaving feedback
--
-- `security definer` because the client holds no read on bookings,
-- shift_requirements or staff and so cannot be trusted — or even asked —
-- to supply a staff_id. It supplies the booking id the line-up gave it,
-- and every rule is re-checked here rather than in the screen:
--
--   * the caller is a client, and the booking's event is theirs. The
--     screen filters, but a forged booking id must get past nothing —
--     the same reasoning as RLS behind the routing middleware (§1.4).
--   * the worker is actually on the confirmed line-up. §11.2 shows only
--     confirmed staff, so only confirmed staff can be rated.
--   * the event has started. §11.2: "Feedback only unlocks after the
--     event has started", which is the event window's start — the
--     earliest role start (§1.5), not the role the worker is on.
--   * one entry per worker per event from the portal.
--
-- read_at stays null: client feedback feeds the worker's score only once
-- the office presses "Mark as read" (§9.10, §6).
-- ---------------------------------------------------------------------
create or replace function public.submit_client_feedback(
  p_booking_id uuid,
  p_rating     int,
  p_text       text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_event_id  uuid;
  v_staff_id  uuid;
  v_client_id uuid;
  v_starts_at timestamptz;
  v_id        uuid;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5' using errcode = '22023';
  end if;

  select sr.event_id, b.staff_id, e.client_id, w.starts_at
    into v_event_id, v_staff_id, v_client_id, v_starts_at
    from bookings b
    join shift_requirements sr on sr.id = b.shift_id
    join events e              on e.id  = sr.event_id
    join event_windows w       on w.event_id = e.id
   where b.id = p_booking_id
     and b.status in ('confirmed', 'worked');

  if v_event_id is null then
    raise exception 'That booking is not on a confirmed line-up' using errcode = '42501';
  end if;

  if not client_portal_visible(v_client_id) then
    raise exception 'That booking belongs to another customer' using errcode = '42501';
  end if;

  if current_app_role() <> 'client' then
    raise exception 'Only the Client Portal leaves client feedback (§9.10)' using errcode = '42501';
  end if;

  if now() < v_starts_at then
    raise exception 'Feedback opens once the event has started' using errcode = '22023';
  end if;

  insert into feedback (author_kind, author_id, staff_id, event_id, rating, text)
  values ('client', auth.uid(), v_staff_id, v_event_id, p_rating, nullif(btrim(coalesce(p_text, '')), ''))
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'Feedback has already been left for this person on this event'
      using errcode = '23505';
end $$;

comment on function public.submit_client_feedback(uuid, int, text) is
  'Leave client feedback from the portal (§11.2, §11.5). Takes the booking id the line-up returns, never a staff id. Re-checks tenancy, confirmed status, the event having started, and one-entry-per-worker-per-event. read_at stays null: the entry feeds the score only after the office marks it read (§9.10, §6).';

revoke all on function public.submit_client_feedback(uuid, int, text) from public, anon;
grant execute on function public.submit_client_feedback(uuid, int, text) to authenticated;
