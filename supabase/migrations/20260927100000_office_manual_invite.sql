-- =====================================================================
-- The manager's Invite on the event board's Potential pool (§3.3, §3.4)
--
-- Why this exists
-- ---------------
-- The board has always drawn the pool from `auto_assign_candidates`, but
-- the office had no way to act on it: the audit of 24.09.2026 found a
-- placeholder where the ranked pool and its Invite button belong. §3.4:
-- "an unqualified worker is still a valid, invitable candidate … the
-- manager can always invite them by hand at any point", and §3.3 lists
-- "search for manual selection" as part of the pool.
--
-- What it reuses, and what it adds
-- --------------------------------
-- The write itself is `invite_worker` (20260921192246), unchanged: it
-- locks the section, re-applies every hard gate at the insert through
-- `auto_assign_candidates` (wrong_role, do_not_return, blocked,
-- self_cancelled, booked_elsewhere, rtw_expired, hours_limit), refuses a
-- leaver or removed worker as not_bookable, refuses a second booking on
-- the same section, writes `invited` through the booking state machine
-- (bookings_state_guard, bookings_rota_guard) and queues N5 with
-- `queue_booking_push` — exactly as an auto-assign round does.
--
-- What differs for a MANUAL invitation is the target, and only that:
--
--   * An hourly round stops inviting once confirmed + invited reaches
--     headcount + buffer, because more invitations than slots is what the
--     additive rounds must not do on their own (§3.4). A manager who wants
--     a named person — "for example when the client asks for a specific
--     person" — must not be refused because auto-assign already has
--     invitations out. Those are never withdrawn (§3.6), so without this
--     the pool's Invite button would be dead on every role auto-assign
--     had touched. So the manual path invites past the open invitations.
--
--   * It still refuses once the role is fully CONFIRMED (confirmed >=
--     headcount + buffer): the invitation could only ever answer
--     "Sorry, this shift has been taken" (§3.4), and the board hides the
--     pool for a stable role anyway (§3.3).
--
--   * It refuses once the role section has ENDED (RULE-16): nothing may be
--     offered on a shift that is over. `invite_worker` has no such check
--     because no round ever reaches an ended section
--     (`auto_assign_due_shifts` stops at `ends_at`).
--
-- Both checks run under the same section row lock `invite_worker` takes,
-- so the fill read here cannot race a concurrent Accept.
--
-- Security
-- --------
-- Admin only, with no service-role door (the accept_application pattern,
-- 20260925100000): `auth.uid() is not null` is the predicate that once let
-- anon past invite_worker (20260921162758). Revoked from public and anon,
-- granted to authenticated; the check inside is the gate.
-- =====================================================================

create or replace function public.office_invite_worker(p_shift uuid, p_staff uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  sr      shift_requirements;
  ev      events;
  v_fill  record;
  v_result jsonb;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  -- The same lock invite_worker, accept_invite and accept_application
  -- take, so every path to the last slot queues on one row.
  select * into sr from shift_requirements where id = p_shift for update;
  if sr.id is null then raise exception 'shift_not_found' using errcode = 'P0002'; end if;
  select * into ev from events where id = sr.event_id;

  if ev.cancelled_at is not null then
    return jsonb_build_object('invited', false, 'reason', 'event_cancelled');
  end if;
  -- RULE-16: nothing is offered on a shift that is already over.
  if now() >= sr.ends_at then
    return jsonb_build_object('invited', false, 'reason', 'event_ended');
  end if;

  -- Fill counts ONLY confirmed; the buffer is absolute (target =
  -- headcount + buffer). Open invitations do not fill anything.
  select * into v_fill from shift_fill(sr.id);
  if v_fill.confirmed >= v_fill.target then
    return jsonb_build_object('invited', false, 'reason', 'full');
  end if;

  -- Every hard gate, the one-booking-per-section rule, the insert and N5.
  -- p_ignore_target: see the header — the manual path is not held to the
  -- rounds' confirmed + invited ceiling, only to the confirmed one above.
  v_result := invite_worker(p_shift, p_staff, 'manual', true);

  if coalesce((v_result ->> 'invited')::boolean, false) then
    insert into audit_log (at, actor, action, entity, entity_id, data)
    values (now(), auth.uid(), 'booking.manual_invite', 'booking',
            (v_result ->> 'bookingId')::uuid,
            jsonb_build_object('staffId', p_staff, 'shiftId', p_shift));
  end if;

  return v_result;
end $$;

comment on function public.office_invite_worker(uuid, uuid) is
  'The manager''s Invite from the event board''s Potential pool (§3.3, §3.4). Admin only. Refuses event_cancelled / event_ended (RULE-16) / full (confirmed >= headcount + buffer), then delegates to invite_worker(…, ''manual'', true): every hard gate by name, not_bookable, already_has_booking, the invited insert and N5. Not held to the rounds'' confirmed + invited ceiling (20260927100000).';

revoke execute on function public.office_invite_worker(uuid, uuid) from public, anon;
grant execute on function public.office_invite_worker(uuid, uuid) to authenticated;
