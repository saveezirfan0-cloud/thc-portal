-- =====================================================================
-- Migration 20261013100000 · client feedback: none on a cancelled event,
--                            none on a removed worker (§11.2, §11.5, §1.7,
--                            §3.3; ADR-0026, ADR-0120)
--
-- 20261012120600 (security audit 12.10) gave submit_client_feedback() its
-- 2,000-character cap and the feedback_client_text_length check. The
-- Client Portal's own review of the same day found two more things the
-- function let through:
--
-- 1 · A cancelled event still took feedback once its start had passed.
--     The lookup now requires e.cancelled_at is null, so a cancelled event
--     answers with the same single refusal as an unknown, unconfirmed or
--     foreign booking — the answer does not say which it was.
--
-- 2 · A GDPR-removed worker (§1.7) could still be rated by the customer:
--     client_lineup_v keeps the confirmed row as "Deleted account #id",
--     and the function only checked the booking. The office refuses the
--     same thing with this sentence (20260923140000_feedback_inbox.sql,
--     add_office_feedback); the portal action maps it to its own words.
--     Checked after tenancy, so only the customer whose line-up it is
--     learns it.
--
-- The body is 20261012120600's verbatim — role first, the rating, the
-- length cap with its message, tenancy + confirmed status in one refusal,
-- the event having started, one entry per worker per event — with those
-- two additions. `create or replace` keeps the grants 20260927160100 set
-- (authenticated only; no anon, no PUBLIC); they are not restated.
-- 810_client_feedback_cancelled_and_removed pins it. Forward-only.
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
  -- cancelled event, or another customer's: the answer must not say which.
  if v_event_id is null or not client_portal_visible(v_client_id) then
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
  'Leave client feedback from the portal (§11.2, §11.5) — the client role''s ONLY write (ADR-0026). Takes the booking id the line-up returns, never a staff id. Role first; the rating; a comment of at most 2000 characters (20261012120600); then tenancy + confirmed status + event not cancelled in one refusal; a removed worker (§1.7) refused (20261013100000); the event having started; one entry per worker per event. read_at stays null: the entry feeds the score only after the office marks it read (§9.10, §6).';
