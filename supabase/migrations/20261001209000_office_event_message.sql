-- =====================================================================
-- Message the line-up — ADR-0069 (an addition to scope v1.6, not §8)
--
-- Every push the platform sends has fixed copy from the §8 register. The
-- office had no way to tell the people working tonight that the staff
-- entrance has moved, or to bring black shoes after all, except by phoning
-- each of them. send_event_message() queues one OM1 push per worker on an
-- event, carrying the manager's own words.
--
-- Who receives it is decided HERE, from the bookings, never from a list of
-- ids the page sends: the page names the event, optionally one role
-- section, and whether invitees are included. Recipients:
--   · confirmed and worked (checked in) — the people on the shift;
--   · invited, only when asked — they have not said yes, but a changed
--     start time is something they need before they do.
-- Never applied, cancelled, closed or turned away: none of them is coming.
-- One push per worker even when they hold two sections of the same event.
--
-- The copy still comes from the register (packages/notifications, OM1):
-- `payload` is the values map — event, date, message, bookingId,
-- messageId — and the drain renders the title, the deep link and the tag.
-- `messageId` gives each message its own notification tag, so a second
-- message about the same shift does not replace the first on the phone.
--
-- The answer says who will NOT get it: a worker with no push subscription
-- on any device (not installed, or notifications refused) is queued like
-- everyone else — the drain records "no push subscription" and fails the
-- row — but the manager is told their names now, so they can phone them.
--
-- Refusals are answers, not exceptions, the cancel_event() shape:
--   message_required · message_too_long (over 300 characters — iOS shows
--   about 178 on the lock screen, the rest on a long press) ·
--   event_cancelled · event_over (every role has ended) ·
--   section_not_on_event · nobody_to_message.
-- =====================================================================

create or replace function public.send_event_message(
  p_event uuid,
  p_section uuid,
  p_include_invited boolean,
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
  -- A viewer (ADR-0060) changes nothing; the outbox trigger would refuse
  -- the insert anyway, but a push is a write the worker sees, so say so
  -- before anything else.
  perform assert_not_read_only();

  select * into ev from events where id = p_event;
  if ev.id is null then raise exception 'event_not_found' using errcode = 'P0002'; end if;

  if v_message is null then
    return jsonb_build_object('ok', false, 'reason', 'message_required');
  end if;
  if char_length(v_message) > 300 then
    return jsonb_build_object('ok', false, 'reason', 'message_too_long');
  end if;
  if ev.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'event_cancelled');
  end if;
  -- Over once every role section has ended — the board's Completed, and
  -- the same gate the page applies before it offers the button.
  if not exists (select 1 from shift_requirements where event_id = ev.id and ends_at > now()) then
    return jsonb_build_object('ok', false, 'reason', 'event_over');
  end if;
  if p_section is not null and not exists (
    select 1 from shift_requirements where id = p_section and event_id = ev.id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'section_not_on_event');
  end if;

  v_statuses := case when coalesce(p_include_invited, false)
                     then array['confirmed', 'worked', 'invited']::booking_status[]
                     else array['confirmed', 'worked']::booking_status[] end;

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
                             'section', p_section, 'includeInvited', coalesce(p_include_invited, false),
                             'sent', v_sent));

  return jsonb_build_object('ok', true, 'sent', v_sent, 'withoutPush', v_no_push,
                            'messageId', v_message_id);
end $$;

comment on function public.send_event_message(uuid, uuid, boolean, text) is
  'ADR-0069: the office messages an event''s line-up. Queues one OM1 push per worker — confirmed and worked, plus invited when asked; one role section or the whole event — with the manager''s text (1–300 characters) in the payload. Returns sent, and withoutPush: the names of recipients with no push subscription, for the manager to phone. Refusals: message_required / message_too_long / event_cancelled / event_over / section_not_on_event / nobody_to_message. Admin only, not a viewer (20261001209000).';

-- Supabase's default privileges grant EXECUTE to anon and authenticated by
-- name, so revoking from PUBLIC alone leaves anon open (docs/14 O7).
revoke execute on function public.send_event_message(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.send_event_message(uuid, uuid, boolean, text) to authenticated;
