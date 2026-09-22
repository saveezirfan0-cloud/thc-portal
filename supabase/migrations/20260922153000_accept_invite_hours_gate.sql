-- =====================================================================
-- accept_invite re-checks the weekly hours cap (§10.4, RULE-20)
--
-- Why this exists
-- ---------------
-- 20260921141500_auto_assign applied the RULE-20 hard gate in
-- `auto_assign_candidates`, so a worker over their cap is never invited
-- and never reachable by a manual invitation. It did NOT re-check the cap
-- at the moment of Accept, and that is a gap rather than an optimisation.
--
-- The invitation and the acceptance are separated by hours or days, and a
-- worker may hold several open invitations at once by design (§3.4). So
-- between the two, the same worker can accept OTHER shifts and cross the
-- line. `accept_invite` already re-checks the two other things that move
-- in that window — whether the slot has gone, and whether they have since
-- confirmed something that overlaps — and the weekly cap moves for exactly
-- the same reason.
--
-- §10.4 states it outright, for Invites and for Radar alike: "if accepting
-- would take the worker over their weekly limit for that Mon–Sun week,
-- Accept is blocked and shows 'Limit Reached' instead", with the worked
-- example of 18 hours held and a 4-hour shift against a 20-hour cap.
-- `hours_limit` is the reason code the Invites screen renders as that
-- label.
--
-- The invitation is left LIVE, like `overlap` and unlike `taken`. The
-- worker's hours can free up — a cancellation elsewhere in the same week,
-- or a term-to-holiday boundary that moves the band overnight (§4.4) — and
-- §10.4 says an open invitation disappears on its own only once its event
-- has ended (RULE-16). Closing it here would delete an invitation that may
-- become acceptable again without anyone touching it.
--
-- Checked AFTER the overlap test, so that a worker who is both booked
-- elsewhere and at their cap is told the specific, immediate thing rather
-- than the weekly aggregate.
--
-- `weekly_cap_would_breach` asks whether adding this section's hours would
-- exceed what is left, and `weekly_booked_hours` counts only confirmed,
-- worked and closed bookings — so the invitation being accepted is not
-- itself counted, and the question it answers is the right one.
-- =====================================================================
create or replace function accept_invite(p_booking uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  b           bookings;
  sr          shift_requirements;
  ev          events;
  v_fill      record;
  v_gap       int := booked_elsewhere_gap_minutes();
  v_withdrawn int := 0;
begin
  select * into b from bookings where id = p_booking;
  if b.id is null then raise exception 'booking_not_found' using errcode = 'P0002'; end if;

  if current_app_role() is distinct from 'admin'
     and b.staff_id is distinct from (select id from staff where user_id = auth.uid()) then
    raise exception 'not_your_booking' using errcode = '42501';
  end if;

  select * into sr from shift_requirements where id = b.shift_id for update;
  select * into ev from events where id = sr.event_id;
  if ev.cancelled_at is not null then raise exception 'event_cancelled' using errcode = 'P0001'; end if;
  if b.status <> 'invited' then
    return jsonb_build_object('ok', false, 'reason', 'not_invited', 'status', b.status::text);
  end if;

  select * into v_fill from shift_fill(b.shift_id);
  if v_fill.confirmed >= v_fill.target then
    update bookings set status = 'closed', cancelled_at = now(), cancel_cause = 'slot_taken'
     where id = b.id;
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end if;

  if exists (
    select 1 from bookings o
      join shift_requirements sr2 on sr2.id = o.shift_id
      join events ev2 on ev2.id = sr2.event_id
     where o.staff_id = b.staff_id and o.status = 'confirmed' and o.shift_id <> b.shift_id
       and booked_elsewhere_conflict(sr.starts_at, sr.ends_at, ev.venue_id,
                                     sr2.starts_at, sr2.ends_at, ev2.venue_id, v_gap) <> 'clear'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'overlap');
  end if;

  -- RULE-20, re-read live at the moment of Accept (§10.4).
  if weekly_cap_would_breach(b.staff_id, b.shift_id) then
    return jsonb_build_object('ok', false, 'reason', 'hours_limit');
  end if;

  update bookings set status = 'confirmed', confirmed_at = now() where id = b.id;

  with overlapping as (
    update bookings o set status = 'cancelled', cancelled_at = now(),
                          cancel_cause = 'overlap_auto_withdraw'
     from shift_requirements sr3
    where sr3.id = o.shift_id
      and o.staff_id = b.staff_id and o.status = 'invited' and o.id <> b.id
      and sr.starts_at < sr3.ends_at and sr3.starts_at < sr.ends_at
    returning o.id
  ) select count(*)::int into v_withdrawn from overlapping;

  return jsonb_build_object('ok', true, 'withdrawn', v_withdrawn);
end $$;

comment on function accept_invite(uuid) is
  'First-to-confirm (§3.4): taken / overlap / hours_limit / ok. Re-checks the slot, the booked-elsewhere gap and the RULE-20 weekly cap, and withdraws the worker''s other intersecting invitations.';
