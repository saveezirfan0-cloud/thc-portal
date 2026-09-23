-- =====================================================================
-- Cancel event as one transaction (Scope §3.3) — docs/14 §4.
--
-- The office action did four writes from the browser session: mark the
-- event, cancel the bookings, then one outbox row per worker. It never read
-- the error from the bookings update, so a refused update (the state guard,
-- the cancel_cause check, a dropped connection) left a Cancelled event with
-- live confirmed bookings and no N12 — and told the manager it had worked.
-- Even with the error read, the event write had already committed by then.
--
-- cancel_event() does §3.3's points 1–3 in one statement's transaction:
--   1. the event is marked Cancelled with the manager's reason (kept, greyed
--      out — never deleted);
--   2. N12 to every confirmed and invited worker AND every pending Radar
--      applicant (confirmed 08.09.2026) — CANCEL_NOTIFIES in the domain;
--   3. all of those bookings → cancelled / event_cancelled, and auto-assign
--      stops for the event (event switch and every role switch).
-- A worked (checked-in) booking is left as it is: §3.6 has no edge out of
-- `worked`, and §3.3's on-the-day edge case pays the scheduled hours anyway
-- (point 4 is the finance reports' reading of cancelled_at, unchanged).
--
-- Anything that fails rolls the whole cancellation back.
-- =====================================================================

create or replace function public.cancel_event(p_event uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reason    text := nullif(btrim(coalesce(p_reason, '')), '');
  ev          events;
  v_cancelled int := 0;
  r           record;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select * into ev from events where id = p_event for update;
  if ev.id is null then raise exception 'event_not_found' using errcode = 'P0002'; end if;

  -- §3.3: "The manager must give a reason".
  if v_reason is null then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  if ev.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_cancelled');
  end if;

  update events
     set cancelled_at = now(), cancel_reason = v_reason, auto_assign = false
   where id = ev.id;
  update shift_requirements set auto_assign = false where event_id = ev.id;

  for r in
    update bookings b
       set status = 'cancelled', cancelled_at = now(), cancel_cause = 'event_cancelled'
      from shift_requirements sr
     where sr.id = b.shift_id and sr.event_id = ev.id
       and b.status in ('confirmed', 'invited', 'applied')
    returning b.id
  loop
    -- N12 carries no placeholders (§8); the key is the one the office
    -- action wrote, so a cancellation queued before this function is not
    -- sent twice.
    perform queue_booking_push('N12', r.id);
    v_cancelled := v_cancelled + 1;
  end loop;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'event.cancelled', 'event', ev.id,
          jsonb_build_object('reason', v_reason, 'bookingsCancelled', v_cancelled));

  return jsonb_build_object('ok', true, 'bookingsCancelled', v_cancelled);
end $$;

comment on function public.cancel_event(uuid, text) is
  '§3.3 Cancel event, atomically: reason required; the event is marked Cancelled (kept), auto-assign stops (event and roles), every confirmed / invited / applied booking → cancelled (event_cancelled) and N12 is queued to each. worked bookings are untouched (§3.6). Refusals: reason_required / already_cancelled. Admin only (20260925100100).';

revoke execute on function public.cancel_event(uuid, text) from public, anon;
grant execute on function public.cancel_event(uuid, text) to authenticated;
