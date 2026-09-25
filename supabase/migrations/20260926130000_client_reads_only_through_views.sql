-- =====================================================================
-- Migration 20260926130000 · the client role reads and writes ONLY
--                            through the ADR-0004 views and RPC
--                            (§11.1, §11.2, §9.7, §11.5; ADR-0026)
--
-- Two policies from 0001 outlived the design that replaced them.
--
--   client_events on events. Row-wide, and `authenticated` holds every
--   column of `events`, so a customer session could
--   `GET /rest/v1/events?select=auto_assign,pays_buffer,pays_breaks,notes,
--   cancel_reason,payroll_exported_at` and read the Auto Invite toggle
--   (§11.2: the selection process "stays internal to THC and is not
--   shown in the portal"), whether they are charged for buffer staff
--   (§9.7) and the office's private notes. The portal itself has read
--   client_events_v — eleven named columns, owner rights, filtered by
--   client_portal_visible() — since 0009, so the policy was a second,
--   wider door nobody walked through on purpose.
--
--   client_feedback_insert on feedback. It checked role, author and
--   tenancy, and nothing else: a customer could rate a worker before the
--   event started (§11.2 "Feedback only unlocks after the event has
--   started") or rate a worker who is not on that event's confirmed
--   line-up ("We show ONLY the confirmed staff"), with a staff id read
--   off client_lineup_v.photo_path. submit_client_feedback() already
--   enforces both; the policy let a direct POST skip it.
--
-- Both go. The client role now holds NO policy on any table: every read
-- is a client_* view and the one write is submit_client_feedback().
-- 001_rls_guard assertion 5 pins the empty set.
--
-- While here, three smaller things on the same path:
--   · submit_client_feedback() checked the caller's role LAST, after two
--     differently-worded row refusals, so a worker session (or another
--     customer) could learn whether a booking id was real and confirmed
--     from the message. The role check is now the first statement and
--     the two row refusals collapse into one sentence.
--   · client_event_documents_v was revoked from public and anon only;
--     Supabase's default grant left INSERT/UPDATE/DELETE with
--     authenticated. Not exploitable (distinct on makes it
--     non-updatable) but it is not the shape ADR-0004 rule (d) names.
--   · client_lineup_v's comment claimed "staff.id is deliberately
--     absent" while photo_path is `<staff_id>/selfie-….jpg`. The
--     comment now says what the column carries; ADR-0026 records the
--     trade-off (the id reaches nothing: staff_caller() refuses it, and
--     feedback is keyed on booking_id).
-- =====================================================================

drop policy if exists client_events on events;
drop policy if exists client_feedback_insert on feedback;

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
  -- The caller check first, so a non-client learns nothing about the row.
  if current_app_role() is distinct from 'client' then
    raise exception 'Only the Client Portal leaves client feedback (§9.10)' using errcode = '42501';
  end if;

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

  -- One sentence whether the booking is unknown, not confirmed, or
  -- another customer's: the answer must not say which.
  if v_event_id is null or not client_portal_visible(v_client_id) then
    raise exception 'That booking is not on your line-up' using errcode = '42501';
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
  'Leave client feedback from the portal (§11.2, §11.5) — the client role''s ONLY write (ADR-0026). Takes the booking id the line-up returns, never a staff id. Role first, then tenancy + confirmed status in one refusal, the event having started, and one-entry-per-worker-per-event. read_at stays null: the entry feeds the score only after the office marks it read (§9.10, §6).';

revoke all on function public.submit_client_feedback(uuid, int, text) from public, anon;
grant execute on function public.submit_client_feedback(uuid, int, text) to authenticated;

-- ADR-0004 rule (d): a client_* view is granted SELECT to authenticated
-- and nothing else, to anybody.
revoke all on client_event_documents_v from public, anon, authenticated;
grant select on client_event_documents_v to authenticated;

comment on view client_lineup_v is
  'The confirmed line-up a customer sees (§11.2). Owner rights + client_portal_visible() per ADR-0004; the client role holds no policy on bookings, shift_requirements, roles or staff and must not be given one. Photo, name and role only: never a rate, never the selection process (Invited / Potential pool / Unavailable). photo_path is the worker''s Storage path and its first segment is staff.id (the photos bucket keys objects by owner); it reaches nothing — staff_caller() refuses it and feedback is keyed on booking_id, which is why submit_client_feedback() takes the booking (ADR-0026). A removed worker reads deleted_account_label(), which never returns null (§1.7).';
