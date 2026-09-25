-- =====================================================================
-- Migration 20260929110300 · Withdraw is one database function, and N10b
--                            goes with it (§3.3, §3.6, §8 N10b; audit
--                            25.09 D38)
--
-- The office's Withdraw was a direct `update bookings` from the server
-- action, followed by a SECOND call queueing N10b — and only when the
-- browser said the booking had been confirmed (`wasConfirmed`, a flag the
-- client supplied). So: a stale page withdrew a worker who had confirmed
-- a minute earlier without telling them; a failed second call left the
-- worker removed and never told; and an invitation withdrawn by the office
-- sent nothing at all.
--
-- withdraw_booking(p_booking) decides from the row itself, under the same
-- section lock every path to a slot takes, and queues the push in the
-- same transaction as the cancel:
--
--   confirmed → cancelled / office_withdraw, N10b "You've been removed
--               from {event} · {dateTime}" (§8, verbatim)
--   invited   → cancelled / office_withdraw, N10d "Your invitation to
--               {event} · {dateTime} has been withdrawn by the office."
--
-- Why a second code for the invitation. §8 N10b's trigger is "Shift
-- cancelled by the office (manager presses Withdraw)" and does not limit
-- it to confirmed bookings, so an invited worker is told too. But its copy
-- — "You've been removed from …" — says the worker had the shift, which an
-- invitee never did; for them the card simply leaves Invites. N10d is an
-- extension (EXTENSION_CODES in packages/notifications, never SCOPE_CODES)
-- carrying the same values. ADR-0031.
--
-- Refusals, by name, writing nothing: checked_in (worked / turned_away:
-- §3.6 has no edge out, ADR-0022), not_withdrawable (an application —
-- §10.4 ends those by N10, N10c, the worker, or N12; ADR-0023 — or a row
-- already ended). Admin only, no service-role door.
--
-- The key carries the moment of the cancel: a reopened booking
-- (20260929110100) withdrawn a second time is told a second time.
-- =====================================================================

create or replace function public.withdraw_booking(p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_shift uuid;
  b       bookings;
  sr      shift_requirements;
  ev      events;
  v_code  text;
  -- The wall clock, not the transaction start: two withdrawals of one
  -- reopened row are two messages even inside one transaction.
  v_at    timestamptz := clock_timestamp();
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select shift_id into v_shift from bookings where id = p_booking;
  if v_shift is null then raise exception 'booking_not_found' using errcode = 'P0002'; end if;

  -- The section first, as invite_worker / accept_invite / accept_application
  -- lock it, so a Withdraw and an Accept on the same row serialise.
  select * into sr from shift_requirements where id = v_shift for update;
  select * into b  from bookings where id = p_booking for update;
  select * into ev from events where id = sr.event_id;

  if b.status in ('worked', 'turned_away') then
    return jsonb_build_object('ok', false, 'reason', 'checked_in', 'status', b.status::text);
  end if;
  if b.status not in ('confirmed', 'invited') then
    return jsonb_build_object('ok', false, 'reason', 'not_withdrawable', 'status', b.status::text);
  end if;

  v_code := case when b.status = 'confirmed' then 'N10b' else 'N10d' end;

  update bookings
     set status = 'cancelled', cancelled_at = v_at, cancel_cause = 'office_withdraw',
         reconfirm_required = false
   where id = b.id;

  insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
  values (
    v_code || ':booking:' || b.id::text || ':' || floor(extract(epoch from v_at) * 1000)::bigint::text,
    'push', v_code, b.staff_id,
    jsonb_build_object(
      'bookingId', b.id, 'shiftId', sr.id, 'eventId', ev.id,
      'event', ev.title,
      -- "Fri 19 Sep 17:00" — the ROLE's start in UK time (RULE-18, §1.8),
      -- as the wireframe's N10b line reads.
      'dateTime', to_char(sr.starts_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI'),
      'window', to_char(sr.starts_at at time zone 'Europe/London', 'HH24:MI')
                || '–' || to_char(sr.ends_at at time zone 'Europe/London', 'HH24:MI')))
  on conflict (key) do nothing;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (v_at, auth.uid(), 'booking.withdrawn', 'booking', b.id,
          jsonb_build_object('staffId', b.staff_id, 'shiftId', sr.id,
                             'was', b.status::text, 'notified', v_code));

  return jsonb_build_object('ok', true, 'was', b.status::text, 'notified', v_code);
end $$;

comment on function public.withdraw_booking(uuid) is
  'The office''s Withdraw (§3.3, §3.6), admin only: confirmed or invited → cancelled / office_withdraw, deciding from the row itself under the section lock, and queueing in the same transaction N10b (confirmed, §8 verbatim) or N10d (invited — extension, ADR-0031). Refuses checked_in (worked / turned_away) and not_withdrawable (applied or already ended). 20260929110300.';

revoke execute on function public.withdraw_booking(uuid) from public, anon;
grant execute on function public.withdraw_booking(uuid) to authenticated;
