-- =====================================================================
-- Migration 20261002110000 · a worker cannot offer their shift to other
--                            workers (ADR-0046, amended)
--
-- THC's decision, 02.10.2026: "A worker shouldn't be able to offer their
-- shift to other staff members."
--
-- ADR-0046 (proposed — awaiting THC) built "Offer this shift": more than
-- 72 h out, with auto-assign on, the worker put their own confirmed
-- booking up for other workers and stayed booked until one took it. That
-- half is withdrawn. What stays is the office's:
--
--   · "Ask the office for cover" (request_cover) — inside 72 h, or with
--     auto-assign off — is a request TO THE OFFICE, never seen by other
--     workers. The office decides: open it to the pool, decline it, or
--     withdraw the booking by hand. Opening it to the pool is the office's
--     act (office_open_offer_to_pool sets decided_by), so the Radar "Up for
--     grabs" group, take_offered_shift() and the OF1 rounds stay for it.
--   · More than 72 h out with auto-assign on, the worker's tool is Cancel
--     shift (RULE-04), exactly as Scope v1.6 has it: auto-assign refills
--     the slot. request_cover() refuses that case as `use_cancel` (was
--     `use_offer`, which pointed at the button that is gone).
--   · Peer-to-peer (`direct`) offers and swaps were designed but never
--     built (nothing creates a `direct` row; settings.shift_offers_direct_
--     enabled is unset). They stay unbuilt: they are a worker offering a
--     shift to another worker.
--
-- So:
--   1 · offer_shift(uuid) is dropped — the only path by which a worker
--       created a pool offer. The staff role holds no policy on
--       shift_offers (700 holds that), so no other path exists.
--   2 · request_cover() refuses `use_cancel` instead of `use_offer`.
--   3 · Any worker pool offer still open (mode pool, never opened by the
--       office — decided_by null) is closed: open → lapsed, closed_reason
--       `worker_offers_removed`. The worker was never unbooked, so they
--       stay confirmed; while the section has not started they get OF3
--       ("Nobody took your … shift — you're still booked"), as for an
--       offer that ran out. A `direct` offer cannot exist, but the same
--       update would close one.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 3 first, while queue_offer_notice() and the rows are as they were.
-- ---------------------------------------------------------------------
do $$
declare
  v_id    uuid;
  v_shift uuid;
  v_start timestamptz;
begin
  for v_id, v_shift in
    update shift_offers
       set status = 'lapsed', closed_reason = 'worker_offers_removed', closed_at = now()
     where status = 'open'
       and mode in ('pool', 'direct')
       and decided_by is null
    returning id, shift_id
  loop
    select sr.starts_at into v_start from shift_requirements sr where sr.id = v_shift;
    if now() < v_start then
      perform queue_offer_notice('OF3', v_id);
    end if;
    insert into audit_log (at, actor, action, entity, entity_id, data)
    values (now(), null, 'shift_offer.closed_worker_offers_removed', 'shift_offer', v_id,
            jsonb_build_object('reason', 'worker_offers_removed'));
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 1 · the worker's "Offer this shift" is gone
-- ---------------------------------------------------------------------
drop function public.offer_shift(uuid);

-- ---------------------------------------------------------------------
-- 2 · request_cover(): `use_cancel`
-- ---------------------------------------------------------------------
create or replace function public.request_cover(p_booking uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_me     uuid := staff_caller();
  v_status staff_status;
  b        bookings;
  sr       shift_requirements;
  ev       events;
  v_id     uuid;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_me is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select s.status into v_status from staff s where s.id = v_me;
  if v_status = 'removed' then
    raise exception 'account_closed' using errcode = 'P0001';
  end if;
  if v_status in ('inactive', 'rejected') then
    raise exception 'not_editable' using errcode = 'P0001';
  end if;

  select * into b from bookings where id = p_booking;
  if b.id is null then raise exception 'booking_not_found' using errcode = 'P0002'; end if;
  if b.staff_id <> v_me then raise exception 'not_your_booking' using errcode = '42501'; end if;

  select * into sr from shift_requirements where id = b.shift_id for update;
  select * into b from bookings where id = p_booking;
  select * into ev from events where id = sr.event_id;

  if ev.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'event_cancelled');
  end if;
  if b.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'reason', 'not_confirmed');
  end if;
  if now() >= sr.starts_at then
    return jsonb_build_object('ok', false, 'reason', 'section_started');
  end if;
  -- More than 72 h out with auto-assign on, Cancel shift is the worker's
  -- tool (RULE-04): auto-assign refills the slot. A worker never offers a
  -- shift to other workers (THC, 02.10.2026).
  if sr.starts_at - now() > interval '72 hours' and ev.auto_assign and sr.auto_assign then
    return jsonb_build_object('ok', false, 'reason', 'use_cancel');
  end if;
  if char_length(coalesce(v_note, '')) > 300 then
    return jsonb_build_object('ok', false, 'reason', 'note_too_long');
  end if;
  if exists (select 1 from shift_offers where booking_id = b.id and status = 'open') then
    return jsonb_build_object('ok', false, 'reason', 'already_offered');
  end if;
  -- Ask, withdraw, ask again is not a way to page the office: a cover
  -- request withdrawn in the last 24 hours holds the next one off. (OF5
  -- is keyed on the booking besides, so admin@ is emailed once anyway.)
  if exists (select 1 from shift_offers
              where booking_id = b.id and mode = 'office' and status = 'withdrawn'
                and coalesce(closed_at, created_at) > now() - interval '24 hours') then
    return jsonb_build_object('ok', false, 'reason', 'recently_requested');
  end if;

  -- Not visible, not pushed: the office decides. Expires at the section's
  -- start; after it the escalation job owns the section.
  insert into shift_offers (booking_id, shift_id, offered_by_staff_id, mode, note, expires_at)
  values (b.id, sr.id, v_me, 'office', v_note, sr.starts_at)
  returning id into v_id;

  perform queue_offer_notice('OF5', v_id);

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'shift_offer.cover_requested', 'shift_offer', v_id,
          jsonb_build_object('bookingId', b.id, 'shiftId', sr.id, 'mode', 'office'));

  return jsonb_build_object('ok', true, 'offerId', v_id);
end $$;

comment on function public.request_cover(uuid, text) is
  'ADR-0046: "Ask the office for cover" — inside 72 h, or with auto-assign off. Creates an office offer (not visible to workers, not pushed) and queues OF5 to admin@ (keyed OF5:booking:<id>, so once per booking). Caller by staff_caller(): unknown_staff / account_closed / not_editable raise P0001. Refuses event_cancelled / not_confirmed / section_started / use_cancel (more than 72 h out with auto-assign on: Cancel shift instead, RULE-04) / note_too_long (> 300) / already_offered / recently_requested (a cover request on this booking withdrawn in the last 24 h).';

