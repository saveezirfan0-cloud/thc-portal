-- =====================================================================
-- ADR-0188 · nudge_check_in_out(), deployed again (follow-up to 20261023130000)
--
-- The Check In / Out monitor's "Remind to check in" button answered every
-- press with the generic "That could not be saved" (23.10.2026). Its function
-- was not on the live database: 20261023130000 was renumbered on 22.10 (#321)
-- and sorts BELOW migrations that had already been applied, so
-- `supabase db push` (no --include-all, .github/workflows/ci.yml) skipped it
-- and PostgREST could not find the function.
--
-- This restates the function, byte for byte, at a version above the
-- high-water mark. `create or replace` plus the grants make it a no-op where
-- 20261023130000 did apply and the fix where it did not. 20261023130000 is left
-- as it is: a remote that recorded it would refuse a push that no longer
-- carried it.
--
-- Forward-only; nothing here edits an earlier migration.
-- =====================================================================
create or replace function public.nudge_check_in_out(p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  m         record;
  v_now     timestamptz := now();
  v_code    text;
  v_variant text;
  v_payload jsonb;
  v_key     text;
begin
  if current_app_role() is distinct from 'admin'::app_role then
    raise exception 'admins_only' using errcode = '42501';
  end if;
  if not office_can('write') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'write';
  end if;

  -- The monitor's own status, so the screen and the door cannot disagree.
  select v.staff_id, v.event_title, v.starts_at, v.ends_at, v.status
    into m
    from public.checkin_monitor_v v
   where v.booking_id = p_booking;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;

  if m.status in ('due', 'not_confirmed_today', 'not_checked_in') then
    if v_now < m.starts_at - interval '30 minutes' then
      raise exception 'check_in_not_open' using errcode = 'P0001';
    end if;
    if v_now >= m.ends_at then
      raise exception 'shift_ended' using errcode = 'P0001';
    end if;
    v_code    := 'N9';
    v_variant := 'check-in';
    v_payload := jsonb_build_object('variant', 'check-in', 'bookingId', p_booking::text);
  elsif m.status in ('on_shift', 'off_site') then
    if v_now >= m.ends_at then
      v_code    := 'N9b';
      v_payload := jsonb_build_object('event', m.event_title, 'bookingId', p_booking::text);
    elsif v_now >= m.ends_at - interval '30 minutes' then
      v_code    := 'N9';
      v_variant := 'check-out';
      v_payload := jsonb_build_object('variant', 'check-out', 'bookingId', p_booking::text);
    else
      raise exception 'check_out_not_due' using errcode = 'P0001';
    end if;
  else
    -- checked_out: nothing to ask for. no_check_out: the button is locked,
    -- a push cannot fix it; the office resolves the violation (§9.5).
    raise exception 'nothing_to_send' using errcode = 'P0001', detail = m.status;
  end if;

  if not public.notification_switched_on(v_code) then
    raise exception 'switched_off' using errcode = 'P0001', detail = v_code;
  end if;

  if not exists (select 1 from push_subscriptions ps where ps.staff_id = m.staff_id) then
    raise exception 'no_push_device' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from audit_log a
     where a.action = 'booking.check_in_out_nudged'
       and a.entity = 'booking'
       and a.entity_id = p_booking
       and a.at > v_now - interval '5 minutes'
  ) then
    raise exception 'sent_recently' using errcode = 'P0001';
  end if;

  v_key := v_code || ':manual:booking:' || p_booking::text
        || case when v_variant is null then '' else ':' || v_variant end
        || ':' || to_char(v_now at time zone 'utc', 'YYYYMMDDHH24MISSUS');

  insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
  values (v_key, 'push', v_code, m.staff_id, v_payload);

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (v_now, auth.uid(), 'booking.check_in_out_nudged', 'booking', p_booking,
          jsonb_build_object('template', v_code,
                             'variant', v_variant,
                             'status', m.status,
                             'key', v_key));

  return jsonb_build_object('queued', true, 'template', v_code, 'variant', v_variant);
end $$;

comment on function public.nudge_check_in_out(uuid) is
  'ADR-0188: the office pushes one worker to check in or out from the Check In / Out monitor, with the register''s own copy — N9 "Time to check in" (Due / Not confirmed today / Not checked in, from 30 min before the start), N9 "Don''t forget to check out" (on shift, last 30 min) or N9b (on shift past the end). Admin + office_can(''write''). Refuses with no_push_device, switched_off, sent_recently (5 min), check_in_not_open, check_out_not_due, shift_ended, nothing_to_send. Own key family ''<code>:manual:booking:…'', so it never uses up the clock''s once-only send. Audited as booking.check_in_out_nudged.';

revoke execute on function public.nudge_check_in_out(uuid) from public, anon;
grant execute on function public.nudge_check_in_out(uuid) to authenticated;
