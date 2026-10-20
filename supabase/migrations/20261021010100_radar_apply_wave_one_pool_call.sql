-- =====================================================================
-- 20261021010100 · apply_to_shift's RULE-17 check reads the pool once
--
-- 20261021010000 asked auto_assign_candidates_pool() about each qualified
-- worker in turn until one was reachable. When none is -- every qualified
-- worker at the client is booked elsewhere, over their hours, or otherwise
-- gated -- it read the pool once per qualified worker, on the signed-in
-- path with its 8 s statement timeout. Measured at go-live scale (the
-- scripts/bench seed: 1,000 workers, 600 open sections) in that worst case:
--
--                                   194 qualified    979 qualified
--   per-worker walk (shipped)          545 ms          3,747 ms
--   one pool call over the set          17 ms             58 ms
--
-- Now one call, with the qualified set as p_only; the verdict is the same
-- rows filtered the same way (a gate, qualification and booking status are
-- per worker). `jit = off` as staff_open_shifts() has. Started from
-- 20261021010000's body; nothing else changes.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.apply_to_shift(p_shift uuid, p_staff uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET jit TO 'off'
AS $function$
declare
  v_me     uuid := case when p_staff is not null and current_app_role() = 'admin'
                        -- §3.3: the office lodges an application from the event
                        -- board on a worker's behalf (20260927100000); the row
                        -- still lands as applied, never confirmed, so nothing is
                        -- decided for the worker. Evidence uploads below stay
                        -- the worker's own (Invariant 4).
                        then p_staff else staff_writer(p_staff) end;
  sr       shift_requirements;
  ev       events;
  v_gate   text;
  v_qualified boolean;
  v_quiz   uuid;
  v_fill   record;
  v_old    bookings;
  v_reopen text;
  v_id     uuid;
begin
  if v_me is null then
    raise exception 'not_a_worker' using errcode = '42501';
  end if;
  select * into sr from shift_requirements where id = p_shift for update;
  if sr.id is null then raise exception 'shift_not_found' using errcode = 'P0002'; end if;
  select * into ev from events where id = sr.event_id;
  if ev.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'event_cancelled');
  end if;
  if now() >= sr.starts_at then
    return jsonb_build_object('ok', false, 'reason', 'shift_started');
  end if;

  select gate, qualified into v_gate, v_qualified from auto_assign_worker_gate(p_shift, v_me);
  -- No candidate row (20260930110100): not a worker (a candidate, a
  -- rejected applicant), left or removed. It must not read as "no gate
  -- applies".
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_bookable');
  end if;
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'reason', v_gate);
  end if;

  -- RULE-17 (20261021010000): a worker's own application waits for the
  -- qualified wave, as Radar does. staff_open_shifts() hides an unqualified
  -- worker's card while anyone qualified at this client and role is still
  -- reachable, but the RPC took the application anyway, so a direct call
  -- (or a stale screen) put a wave-2 worker forward ahead of wave 1 -- the
  -- "self-apply can't bypass the priority the invitations enforce" of
  -- wireframes/staff/radar.html. The same test, stopping at the first
  -- reachable qualified worker, one pool row each. The office lodging an
  -- application on a worker's behalf (p_staff, admin) is a manager's
  -- override, like Invite, and is not held to it.
  if not coalesce(v_qualified, false)
     and not (p_staff is not null and current_app_role() = 'admin')
     -- 20261021010100: ONE pool call over the whole qualified set, not one
     -- per qualified worker. Same rows, same verdict; the per-worker walk
     -- read the pool ~1,000 times when nobody qualified was reachable.
     and exists (
       select 1
         from auto_assign_candidates_pool(sr.id, false, array(
                select cq.staff_id
                  from client_qualifications cq
                  join staff qs on qs.id = cq.staff_id
                 where cq.client_id = ev.client_id and cq.role_id = sr.role_id
                   and not cq.do_not_return
                   and qs.status = 'compliant'
                   and exists (select 1 from staff_roles qr
                                where qr.staff_id = cq.staff_id and qr.role_id = sr.role_id)
                   and not exists (select 1 from bookings qb
                                    where qb.shift_id = sr.id and qb.staff_id = cq.staff_id))) w
        where w.gate is null and w.qualified and w.booking_status is null)
  then
    return jsonb_build_object('ok', false, 'reason', 'not_open_yet');
  end if;

  -- The live re-check. Seats, not the invitation target: Radar offers a
  -- shift while confirmed (or checked in) < headcount, and applications
  -- close at the same point (close_filled_role_applications,
  -- 20260930110200).
  select * into v_fill from shift_fill(p_shift);
  if v_fill.confirmed >= sr.headcount then
    return jsonb_build_object('ok', false, 'reason', 'full');
  end if;

  -- ADR-0150: a client's quiz comes before the application, as before the
  -- confirmation it asks for. After the fill check: a worker turned away
  -- because the shift is full is told that, not sent to a quiz for nothing.
  v_quiz := client_quiz_gate(p_shift, v_me);
  if v_quiz is not null then
    return jsonb_build_object('ok', false, 'reason', 'quiz_required', 'quizId', v_quiz);
  end if;

  -- A LIVE booking blocks a second one. An ended one is REOPENED rather
  -- than a second one inserted — (shift_id, staff_id) is unique — unless
  -- it is a self-cancel (RULE-04), an event cancellation or a GDPR
  -- removal, or carries history: §3.6 reserves the permanent bar for
  -- self-cancel, and §10.4 tells the worker "You can still apply for this
  -- shift on Radar later if it's open". 20260927161100 reopened `closed`
  -- rows only; an office withdrawal or a 12:05 release is reopened too
  -- since 20260930110100 (D33) — the worker's own application is a
  -- person's decision, which booking_reopenable_by() lets through.
  select * into v_old from bookings where shift_id = p_shift and staff_id = v_me for update;
  if v_old.id is not null then
    v_reopen := booking_reopenable_by(v_old.status, v_old.cancel_cause);
    if v_reopen is null
       or v_reopen = 'never'
       or v_old.self_cancelled
       or exists (select 1 from check_logs where booking_id = v_old.id)
       or exists (select 1 from breaks where booking_id = v_old.id)
       or exists (select 1 from violations where booking_id = v_old.id) then
      return jsonb_build_object('ok', false, 'reason', 'already_has_booking');
    end if;

    update bookings
       set status = 'applied', source = 'self', applied_at = now(),
           confirmed_at = null, day_before_confirmed_at = null, on_day_confirmed_at = null,
           reconfirm_required = false, reconfirm_reason = null,
           cancelled_at = null, cancel_cause = null
     where id = v_old.id
    returning id into v_id;
  else
    insert into bookings (shift_id, staff_id, status, source, applied_at)
    values (p_shift, v_me, 'applied', 'self', now())
    returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'bookingId', v_id);
end $function$;
