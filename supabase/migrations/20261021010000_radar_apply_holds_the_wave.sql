-- =====================================================================
-- 20261021010000 · Radar self-apply holds RULE-17's qualified wave
--
-- staff_open_shifts() shows a worker a section at a client they are not
-- qualified at only once every reachable worker qualified there for that
-- role has been invited (RULE-17, §3.4, §10.4). apply_to_shift() did not
-- ask: an unqualified worker who called it directly -- or pressed Apply on
-- a screen loaded before a qualified worker became reachable -- was put
-- forward ahead of the first wave. Found by the 19.10.2026 scheduling
-- sweep (tom.reid applied to a section Radar was hiding from him).
--
-- apply_to_shift() now answers 'not_open_yet' in that case, with the same
-- test staff_open_shifts() makes (20261019193100). Started from the live
-- body (20261018120000_quiz_before_confirm); nothing else changes.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.apply_to_shift(p_shift uuid, p_staff uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
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
     and exists (
       select 1
         from (select cq.staff_id
                 from client_qualifications cq
                 join staff qs on qs.id = cq.staff_id
                where cq.client_id = ev.client_id and cq.role_id = sr.role_id
                  and not cq.do_not_return
                  and qs.status = 'compliant'
                  and exists (select 1 from staff_roles qr
                               where qr.staff_id = cq.staff_id and qr.role_id = sr.role_id)
                  and not exists (select 1 from bookings qb
                                   where qb.shift_id = sr.id and qb.staff_id = cq.staff_id)
               offset 0) q
        where exists (select 1
                        from auto_assign_candidates_pool(sr.id, false, array[q.staff_id]) w
                       where w.gate is null and w.qualified and w.booking_status is null))
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

comment on function public.apply_to_shift(uuid, uuid) is
  '§10.4 Radar self-application. The caller''s OWN row (staff_writer), or a worker named by the office from the event board (§3.3); any other caller naming another worker is refused. Refuses event_cancelled · shift_started · not_bookable (no candidate row) · the gate by name · full (confirmed-or-worked >= headcount) · already_has_booking (a live row, or a self-cancel / event-cancelled / GDPR row, or one with history). Any other ended row is reopened as applied (20260930110100). Every refusal is a reason, never an exception. SUPERSEDED FOR SERIES SIBLINGS by 20261012140000 (ADR-0117): on a section marked "Same staff on all days", a worker who fails a hard gate, has a calendar entry or exceeds the projected weekly hours on another day of the job is refused not_available_all_days, for every source (a manual invite, an Accept, an apply and a take included). ADR-0150 (20261018120000): refuses with reason quiz_required (and quizId) while the client''s quiz for this (client, role) is not passed, after the hard gates; nothing is withdrawn. RULE-17 (20261021010000): a worker''s OWN application to a section at a client where they are not qualified for the role is refused not_open_yet while anyone qualified there is still reachable -- the test staff_open_shifts() makes; the office applying on a worker''s behalf is not held to it.';
