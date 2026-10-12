-- =====================================================================
-- Migration 20261012120000 · client feedback: a length cap, no feedback
--                            on a removed worker, none on a cancelled
--                            event (§11.2, §11.5, §9.10, §1.7; ADR-0026)
--
-- submit_client_feedback() is the Client Portal's only write. The
-- security / QA review of 12.10 found three things it let through:
--
-- 1 · No length cap on the comment. A customer (or anybody holding a
--     client session and the anon key) could store megabytes of text in
--     one feedback row, which the office inbox (§9.10) then renders.
--     Capped at 2000 characters, in the function (22023, the shape every
--     other input refusal here has) and on the table for client entries.
--
--     The table constraint is scoped to author_kind = 'client' on purpose.
--     The office's own notes (add_office_feedback / update_office_feedback,
--     apps/office/app/feedback) have never had a limit and their form has
--     no maxLength; an unscoped check would turn a long office note into a
--     raw "violates check constraint" error on its next edit. Client rows
--     are read-only after insert apart from read_at (feedback_guard), and
--     the portal's modal is the only writer, so the scoped check is the
--     whole of the new rule.
--
-- 2 · A GDPR-removed worker (§1.7) could still be rated by the customer:
--     client_lineup_v keeps the confirmed row as "Deleted account #id",
--     and the function only checked the booking. The office refuses the
--     same thing with this sentence (20260923140000_feedback_inbox.sql,
--     add_office_feedback); the portal action maps it to its own words.
--
-- 3 · A cancelled event still took feedback once its start had passed.
--     The lookup now requires e.cancelled_at is null, so a cancelled event
--     answers with the same single refusal as an unknown or foreign
--     booking — the answer does not say which of the three it was.
--
-- The body is otherwise 20260927160100's verbatim: the role check first,
-- tenancy + confirmed status in one refusal, the event having started,
-- one entry per worker per event. Grants are restated unchanged.
-- Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · the table: client entries are at most 2000 characters
-- ---------------------------------------------------------------------
alter table feedback drop constraint if exists feedback_text_len;
alter table feedback add constraint feedback_text_len
  check (author_kind <> 'client' or char_length(text) <= 2000);

comment on constraint feedback_text_len on feedback is
  'A client entry''s comment is at most 2000 characters (submit_client_feedback refuses longer with 22023 first). Office notes are not capped: their form never was, and a cap here would break editing an existing long note. 20261012120000.';

-- ---------------------------------------------------------------------
-- 2 · the function
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
  v_text      text := nullif(btrim(coalesce(p_text, '')), '');
  v_id        uuid;
begin
  -- The caller check first, so a non-client learns nothing about the row.
  if current_app_role() is distinct from 'client' then
    raise exception 'Only the Client Portal leaves client feedback (§9.10)' using errcode = '42501';
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5' using errcode = '22023';
  end if;

  -- Before the lookup: the length says nothing about any booking.
  if v_text is not null and char_length(v_text) > 2000 then
    raise exception 'Comment must be 2000 characters or fewer' using errcode = '22023';
  end if;

  select sr.event_id, b.staff_id, e.client_id, w.starts_at
    into v_event_id, v_staff_id, v_client_id, v_starts_at
    from bookings b
    join shift_requirements sr on sr.id = b.shift_id
    join events e              on e.id  = sr.event_id
    join event_windows w       on w.event_id = e.id
   where b.id = p_booking_id
     and b.status in ('confirmed', 'worked')
     and e.cancelled_at is null;

  -- One sentence whether the booking is unknown, not confirmed, on a
  -- cancelled event, or another customer's: the answer must not say which.
  if v_event_id is null or not client_portal_visible(v_client_id) then
    raise exception 'That booking is not on your line-up' using errcode = '42501';
  end if;

  -- After tenancy, so only the customer whose line-up it is learns it.
  -- The office's sentence (add_office_feedback, 20260923140000).
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
  'Leave client feedback from the portal (§11.2, §11.5) — the client role''s ONLY write (ADR-0026). Takes the booking id the line-up returns, never a staff id. Role first; the rating; a comment of at most 2000 characters; then tenancy + confirmed status + event not cancelled in one refusal; a removed worker (§1.7) refused; the event having started; one entry per worker per event. read_at stays null: the entry feeds the score only after the office marks it read (§9.10, §6). 20261012120000.';

revoke all on function public.submit_client_feedback(uuid, int, text) from public, anon;
grant execute on function public.submit_client_feedback(uuid, int, text) to authenticated;
