-- =====================================================================
-- Message the line-up: choose who — ADR-0069 (amended)
--
-- send_event_message() (20261001209000) took an "also invited" switch,
-- so invitees could only ever be messaged together with the confirmed
-- line-up. The office asked to message the people who have not answered
-- an invitation on their own ("you still have an invite for tonight —
-- please reply"), for the whole event or one role.
--
-- The switch becomes an audience, still decided HERE from the bookings:
--   · booked              — confirmed and worked (checked in); the default;
--   · invited             — invited only, not yet accepted;
--   · booked_and_invited  — both, the old "also invited" ticked.
-- Never applied, cancelled, closed or turned away, whichever is chosen.
-- One push per worker, as before: a worker confirmed on one role and
-- invited to another is one recipient when both are asked for.
--
-- The boolean signature is dropped rather than overloaded: two functions
-- with the same name and a named-argument call from PostgREST would
-- resolve by argument name, and nothing else calls the old one.
--
-- A new refusal: audience_unknown. The others are unchanged.
-- =====================================================================

drop function if exists public.send_event_message(uuid, uuid, boolean, text);

create or replace function public.send_event_message(
  p_event uuid,
  p_section uuid,
  p_audience text,
  p_message text
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

  if not exists (
    select 1 from bookings b join shift_requirements sr on sr.id = b.shift_id
     where sr.event_id = ev.id
       and (p_section is null or sr.id = p_section)
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
                             'section', p_section, 'audience', coalesce(p_audience, 'booked'),
                             'sent', v_sent));

  return jsonb_build_object('ok', true, 'sent', v_sent, 'withoutPush', v_no_push,
                            'messageId', v_message_id);
end $$;

comment on function public.send_event_message(uuid, uuid, text, text) is
  'ADR-0069: the office messages an event''s line-up. Queues one OM1 push per worker — audience booked (confirmed and worked), invited (not yet accepted) or booked_and_invited; one role section or the whole event — with the manager''s text (1–300 characters) in the payload. Returns sent, and withoutPush: the names of recipients with no push subscription, for the manager to phone. Refusals: audience_unknown / message_required / message_too_long / event_cancelled / event_over / section_not_on_event / nobody_to_message. Admin only, not a viewer (20261001211000).';

-- Supabase's default privileges grant EXECUTE to anon and authenticated by
-- name, so revoking from PUBLIC alone leaves anon open (docs/14 O7).
revoke execute on function public.send_event_message(uuid, uuid, text, text) from public, anon;
grant execute on function public.send_event_message(uuid, uuid, text, text) to authenticated;
