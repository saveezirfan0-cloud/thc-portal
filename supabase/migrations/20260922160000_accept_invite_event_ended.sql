-- =====================================================================
-- RULE-16 at the moment of Accept (§10.4, §7)
--
-- §10.4: "An open invitation also disappears on its own once the event it
-- belongs to has ended — even if the worker never accepted or declined it
-- (RULE-16, §7)."
--
-- Nothing enforced it. `accept_invite` checked the event was not cancelled,
-- the slot was not taken, the worker was not booked elsewhere and, since
-- 20260922153000, that they were inside their weekly cap — but not that the
-- shift was still in the future. An invitation to an event that finished
-- months ago stayed live and acceptable, and `apply_to_shift` was already
-- refusing the same case (`shift_started`) while this did not.
--
-- The Staff App filters ended invitations out of the list, which fixes what
-- a worker sees. It does not fix what a worker can DO: §10.4 is explicit
-- that the list's job is partly to catch "a worker tapping a stale,
-- already-superseded push notification afterwards", and a push survives the
-- list. The read filter alone leaves that button working.
--
-- Built on 20260922153000's body rather than replacing it, so the RULE-20
-- gate that migration added stays exactly as it wrote it. This adds one
-- branch, placed before the slot count: a shift that has ended has no slots
-- to take, so reporting `taken` for it — and CLOSING the invitation, which
-- the `taken` branch does — would be both wrong and destructive.
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

  -- RULE-16. Before the slot count, deliberately: `taken` closes the
  -- invitation, and an invitation that expired is not one somebody else won.
  if now() >= sr.ends_at then
    return jsonb_build_object('ok', false, 'reason', 'event_ended');
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

  -- RULE-20, re-read live at the moment of Accept (§10.4) — 20260922153000.
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
  'First-to-confirm (§3.4): event_ended / taken / overlap / hours_limit / ok. Re-checks RULE-16, the slot, the booked-elsewhere gap and the RULE-20 weekly cap, and withdraws the worker''s other intersecting invitations.';
