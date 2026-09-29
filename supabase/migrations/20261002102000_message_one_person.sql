-- =====================================================================
-- Message one person — ADR-0069, amended again 29.09.2026
--
-- The owner, on the live Message staff dialog: "We also need to be able to
-- message individual staff, for example one of the Waiting Staff who is
-- booked on — not all of them."
--
-- send_event_message() gains p_booking (default null, so every existing
-- call is unchanged): the booking the manager picked from the "To" list.
-- The database still decides: the booking must be on this event (and in
-- p_section, if one is also named) and live — confirmed, checked in or
-- invited. A person named on purpose is messaged whatever the audience
-- says. Everything else — the refusals, the OM1 payload, the
-- "notifications off" answer, the audit row — is 20261001211000's.
--
-- New refusals: booking_not_on_event · person_not_booked.
-- audit_log records audience 'person' and the booking for a one-person send.
--
-- The four-argument version is dropped rather than overloaded: with a
-- defaulted fifth argument, a four-argument call would be ambiguous.
-- =====================================================================

drop function if exists public.send_event_message(uuid, uuid, text, text);

create or replace function public.send_event_message(
  p_event uuid,
  p_section uuid,
  p_audience text,
  p_message text,
  p_booking uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_message    text := nullif(btrim(coalesce(p_message, '')), '');
  v_message_id uuid := gen_random_uuid();
  ev           events;
  v_statuses   booking_status[];
  v_sent       int := 0;
  v_no_push    jsonb := '[]'::jsonb;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  -- A viewer (ADR-0060) changes nothing; a push is a write the worker sees.
  perform assert_not_read_only();

  select * into ev from events where id = p_event;
  if ev.id is null then raise exception 'event_not_found' using errcode = 'P0002'; end if;

  v_statuses := case coalesce(p_audience, 'booked')
                  when 'booked'             then array['confirmed', 'worked']::booking_status[]
                  when 'invited'            then array['invited']::booking_status[]
                  when 'booked_and_invited' then array['confirmed', 'worked', 'invited']::booking_status[]
                end;
  if v_statuses is null then
    return jsonb_build_object('ok', false, 'reason', 'audience_unknown');
  end if;

  if v_message is null then
    return jsonb_build_object('ok', false, 'reason', 'message_required');
  end if;
  if char_length(v_message) > 300 then
    return jsonb_build_object('ok', false, 'reason', 'message_too_long');
  end if;
  if ev.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'event_cancelled');
  end if;
  -- Over once every role section has ended — the board's Completed.
  if not exists (select 1 from shift_requirements where event_id = ev.id and ends_at > now()) then
    return jsonb_build_object('ok', false, 'reason', 'event_over');
  end if;
  if p_section is not null and not exists (
    select 1 from shift_requirements where id = p_section and event_id = ev.id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'section_not_on_event');
  end if;

  -- One person: the booking the manager picked from the To list. It must be
  -- on this event (and in p_section, if one is also named) and live —
  -- confirmed, checked in or invited. Named on purpose, the person is
  -- messaged whatever the audience says.
  if p_booking is not null then
    if not exists (
      select 1 from bookings b join shift_requirements sr on sr.id = b.shift_id
       where b.id = p_booking and sr.event_id = ev.id
         and (p_section is null or sr.id = p_section)
    ) then
      return jsonb_build_object('ok', false, 'reason', 'booking_not_on_event');
    end if;
    if not exists (
      select 1 from bookings b
       where b.id = p_booking and b.status in ('confirmed', 'worked', 'invited')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'person_not_booked');
    end if;
    v_statuses := array['confirmed', 'worked', 'invited']::booking_status[];
  end if;

  if not exists (
    select 1 from bookings b join shift_requirements sr on sr.id = b.shift_id
     where sr.event_id = ev.id
       and (p_section is null or sr.id = p_section)
       and (p_booking is null or b.id = p_booking)
       and b.status = any (v_statuses)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'nobody_to_message');
  end if;

  -- One row per worker: the booking with the earliest section start, so the
  -- deep link opens the shift they arrive for first. The key is new per
  -- message, so nothing here can collide with an earlier send.
  with recipients as (
    select distinct on (b.staff_id)
           b.id as booking_id, b.staff_id,
           btrim(s.first_name || ' ' || s.last_name) as name
      from bookings b
      join shift_requirements sr on sr.id = b.shift_id
      join staff s on s.id = b.staff_id
     where sr.event_id = ev.id
       and (p_section is null or sr.id = p_section)
       and (p_booking is null or b.id = p_booking)
       and b.status = any (v_statuses)
     order by b.staff_id, sr.starts_at, b.id
  ), inserted as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select 'OM1:' || v_message_id || ':' || r.booking_id,
           'push', 'OM1', r.staff_id,
           jsonb_build_object(
             'event',     ev.title,
             'date',      to_char(ev.event_date, 'Dy DD Mon'),
             'message',   v_message,
             'bookingId', r.booking_id::text,
             'messageId', v_message_id::text)
      from recipients r
    returning 1
  )
  select (select count(*)::int from inserted),
         coalesce((select jsonb_agg(r.name order by r.name)
                     from recipients r
                    where not exists (select 1 from push_subscriptions p
                                       where p.staff_id = r.staff_id)), '[]'::jsonb)
    into v_sent, v_no_push;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'event.message_sent', 'event', ev.id,
          jsonb_build_object('messageId', v_message_id, 'message', v_message,
                             'section', p_section, 'booking', p_booking,
                             'audience', case when p_booking is null then coalesce(p_audience, 'booked') else 'person' end,
                             'sent', v_sent));

  return jsonb_build_object('ok', true, 'sent', v_sent, 'withoutPush', v_no_push,
                            'messageId', v_message_id);
end $$;

comment on function public.send_event_message(uuid, uuid, text, text, uuid) is
  'ADR-0069: the office messages an event''s line-up. Queues one OM1 push per worker — audience booked (confirmed and worked), invited (not yet accepted) or booked_and_invited; the whole event, one role section, or one booked person (p_booking) — with the manager''s text (1–300 characters) in the payload. Returns sent, and withoutPush: the names of recipients with no push subscription, for the manager to phone. Refusals: audience_unknown / message_required / message_too_long / event_cancelled / event_over / section_not_on_event / booking_not_on_event / person_not_booked / nobody_to_message. Admin only, not a viewer (20261001211000; one person 20261002102000).';

-- Supabase's default privileges grant EXECUTE to anon and authenticated by
-- name, so revoking from PUBLIC alone leaves anon open (docs/14 O7).
revoke execute on function public.send_event_message(uuid, uuid, text, text, uuid) from public, anon;
grant execute on function public.send_event_message(uuid, uuid, text, text, uuid) to authenticated;
