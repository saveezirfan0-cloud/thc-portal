-- =====================================================================
-- Migration 20261014170300 · client feedback only on the line-up the
--                            customer is shown (§11.2, §11.5, RULE-15;
--                            ADR-0004, ADR-0026, ADR-0134 §1, ADR-0135 §4)
--
-- ADR-0134 held client_lineup_v to the headcount: THC's buffer workers
-- never reach the customer. submit_client_feedback() was left as it was —
-- "a booking id outside the trimmed set never reaches the browser" — but
-- the function still ACCEPTED one: a booking id learned some other way
-- (a stale tab from before the trim, a guessed id) let the customer rate
-- a buffer worker they were never shown.
--
-- Now the booking must be on the caller's line-up as client_lineup_v
-- returns it — the view's own rules (tenancy, confirmed or worked, the
-- headcount seats of RULE-15, a worker already rated kept). Read with the
-- event filter, so the view ranks one event's sections only. A booking
-- beyond the headcount and not already rated is refused with the SAME
-- sentence as an unknown, unconfirmed, cancelled or foreign one: the
-- answer must not say which. A worker the customer already rated stays
-- in the view, so a second entry still answers "already left" (23505).
--
-- The body is 20261013100000's verbatim with that one check added after
-- tenancy; the grants it set (authenticated only) are kept by
-- `create or replace`. 834_client_feedback_within_lineup pins it.
-- Forward-only.
-- =====================================================================

create or replace function public.submit_client_feedback(p_booking_id uuid, p_rating integer, p_text text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id  uuid;
  v_staff_id  uuid;
  v_client_id uuid;
  v_starts_at timestamptz;
  v_id        uuid;
  v_text      text := nullif(btrim(coalesce(p_text, '')), '');
begin
  -- The caller check first, so a non-client learns nothing about the row.
  if current_app_role() is distinct from 'client' then
    raise exception 'Only the Client Portal leaves client feedback (§9.10)' using errcode = '42501';
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5' using errcode = '22023';
  end if;

  if char_length(v_text) > 2000 then
    raise exception 'Feedback text must be at most 2000 characters' using errcode = '22023';
  end if;

  select sr.event_id, b.staff_id, e.client_id, w.starts_at
    into v_event_id, v_staff_id, v_client_id, v_starts_at
    from bookings b
    join shift_requirements sr on sr.id = b.shift_id
    join events e              on e.id  = sr.event_id
    join event_windows w       on w.event_id = e.id
   where b.id = p_booking_id
     and b.status in ('confirmed', 'worked')
     -- 20261013100000: a cancelled event takes no feedback (§3.3).
     and e.cancelled_at is null;

  -- One sentence whether the booking is unknown, not confirmed, on a
  -- cancelled event, another customer's, or — 20261014170300 — past the
  -- headcount the customer is shown (ADR-0134): the answer must not say
  -- which.
  if v_event_id is null
     or not client_portal_visible(v_client_id)
     or not exists (select 1 from client_lineup_v l
                     where l.event_id = v_event_id and l.booking_id = p_booking_id) then
    raise exception 'That booking is not on your line-up' using errcode = '42501';
  end if;

  -- 20261013100000: after tenancy, so only the customer whose line-up it
  -- is learns it. The office's sentence (add_office_feedback, 20260923140000).
  if exists (select 1 from staff s where s.id = v_staff_id and s.removed_at is not null) then
    raise exception 'This worker has been removed (§1.7); no new feedback can be added'
      using errcode = '22023';
  end if;

  if now() < v_starts_at then
    raise exception 'Feedback opens once the event has started' using errcode = '22023';
  end if;

  insert into feedback (author_kind, author_id, staff_id, event_id, rating, text)
  values ('client', auth.uid(), v_staff_id, v_event_id, p_rating, v_text)
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'Feedback has already been left for this person on this event'
      using errcode = '23505';
end $$;

comment on function public.submit_client_feedback(uuid, int, text) is
  'Leave client feedback from the portal (§11.2, §11.5) — the client role''s feedback write (ADR-0026). Takes the booking id the line-up returns, never a staff id. Role first; the rating; a comment of at most 2000 characters (20261012120600); then tenancy + confirmed status + event not cancelled + the booking on the line-up the customer is shown (client_lineup_v: the headcount seats of ADR-0134, 20261014170300) in one refusal; a removed worker (§1.7) refused (20261013100000); the event having started; one entry per worker per event. read_at stays null: the entry feeds the score only after the office marks it read (§9.10, §6).';
