-- =====================================================================
-- Migration 20260930110100 · offer up a shift
--   (ADR-0039; docs/18 §4, Phase 1 Agent A, part A2)
--
-- A confirmed worker releases a shift to other workers and STAYS
-- CONFIRMED until a replacement takes it. The data is Phase 0's
-- (20260930100100: shift_offers, shift_offer_notices, the state guard,
-- cancel cause 'handed_over'; 20260930100000: booking_source 'offer');
-- this is everything that acts on it.
--
--   Worker    offer_shift · withdraw_shift_offer · request_cover ·
--             take_offered_shift · staff_open_offers (Radar "Up for grabs",
--             never the offerer) · staff_booking_offers (the worker's own
--             bookings with their open offer and the auto-assign switch,
--             for /shifts and /shifts/:id)
--   Office    office_open_offer_to_pool · office_decline_cover
--   Service   lapse_shift_offers · offer_rounds_due · offer_candidates ·
--             notify_offer_candidates · offer_wave1_exhausted
--   Trigger   bookings_offer_lapse
--
-- The rules, and where each is held:
--
--   * A pool offer only while MORE than 72 h remain — self_cancel_booking's
--     own boundary (RULE-04; canOfferShift() = canCancelShift()) — and only
--     while auto-assign is ON for the event AND the role. It expires at
--     start − 72 h (offerExpiresAt()); OF3 tells the worker they are still
--     booked. Inside 72 h, or with auto-assign off, the worker can only ask
--     the office for cover (an `office` offer: not visible, not pushed; OF5
--     to admin@ at once). The office opens it to the pool until the
--     section's start, declines it (OF6), or withdraws the booking by hand.
--   * The offerer stays confirmed: fill, the buffer (6 (+1)), shift_fill,
--     accept_invite and the client line-up are untouched by an open offer.
--   * take_offered_shift() is ONE transaction under the section lock every
--     slot path takes (shift_requirements … for update). Its refusals, in
--     order, are shiftOffer.vectors.json's (takeOffer() in packages/domain):
--     event_cancelled › offer_not_open › offer_expired ›
--     original_not_confirmed › own_offer › section_started › the pool gate
--     by name (auto_assign_candidates: wrong_role, do_not_return, blocked,
--     self_cancelled, booked_elsewhere → overlap, rtw_expired, hours_limit;
--     no row → not_bookable) and accept_invite's overlap and cap re-reads ›
--     already_had_booking › not_yet (RULE-17: an unqualified taker waits
--     until offer_wave1_exhausted()). The calendar (ADR-0036) never refuses
--     a take. Then: the taker's row → confirmed (source 'offer'); the offer
--     → taken; the original → cancelled / handed_over / self_cancelled
--     (the offerer is barred from the event, Q15); the taker's overlapping
--     invitations are withdrawn as on Accept; OF2 + OF4 queued. The
--     confirmed count is net zero, so no N10c.
--   * OF1 rounds are hourly and additive: `allocation_per_hour` a round,
--     wave 1 first (selectOfferRecipients() in the Edge Function; RULE-17
--     is re-checked here, so a wave-2 push is refused while a wave-1
--     worker is still untold), never after expiry, never to a gated or
--     unavailable worker, never twice (shift_offer_notices).
--   * Any other exit from confirmed — Withdraw, the 12:05 cutoff, block,
--     leave, GDPR, event cancelled, self-cancel, check-in — lapses the
--     open offer silently (bookings_offer_lapse); that cause has its own
--     notification.
--
-- Every send is a notification_outbox row queued in the same transaction,
-- keyed as the register says (OFn:offer:<id>, OF1:offer:<offer>:<staff>),
-- with exactly the payload keys packages/notifications renders plus the
-- ids offerId / bookingId / shiftId / eventId for the office's tooling
-- (pgTAP 674, the 592 pattern). A blank note is written as `—`.
--
-- Peer-to-peer (`direct`) is designed, not built (Q17): a direct offer is
-- takeable only by its target and only while
-- settings.shift_offers_direct_enabled is true, which nothing sets.
--
-- Forward-only. References only 20260930100100 and earlier objects.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0 · The outbox writer for OF1–OF6
--
-- One function so the six payloads sit side by side and pgTAP 674 can
-- hold every one to its template. Push dates follow N5 (queue_booking_push);
-- OF5, an email, follows E10 (queue_self_cancel_email). The base rate
-- only, never the holiday element (§9.8). Never names the offerer to
-- anyone but the office.
-- ---------------------------------------------------------------------
create or replace function public.queue_offer_notice(
  p_code  text,
  p_offer uuid,
  p_staff uuid default null
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  o         shift_offers;
  sr        shift_requirements;
  ev        events;
  v_role    text;
  v_client  text;
  s         staff;
  v_fill    record;
  v_ids     jsonb;
  v_date    text;
  v_when    text;
begin
  select * into o from shift_offers where id = p_offer;
  if o.id is null then return; end if;
  select * into sr from shift_requirements where id = o.shift_id;
  select * into ev from events where id = sr.event_id;
  select r.name into v_role from roles r where r.id = sr.role_id;

  v_ids := jsonb_build_object('offerId', o.id::text, 'shiftId', sr.id::text, 'eventId', ev.id::text);
  -- The push dates, as N5 writes them (20260927160500).
  v_date := to_char(sr.starts_at at time zone 'Europe/London', 'Dy DD Mon');
  v_when := to_char(sr.starts_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI')
            || '–' || to_char(sr.ends_at at time zone 'Europe/London', 'HH24:MI');

  if p_code = 'OF1' then
    if p_staff is null then return; end if;
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    values ('OF1:offer:' || o.id || ':' || p_staff, 'push', 'OF1', p_staff,
            v_ids || jsonb_build_object(
              'role',     v_role,
              'event',    ev.title,
              'dateTime', v_when,
              'rate',     '£' || to_char(sr.pay_rate, 'FM990.00')))
    on conflict (key) do nothing;

  elsif p_code = 'OF2' then
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    values ('OF2:offer:' || o.id, 'push', 'OF2', o.offered_by_staff_id,
            v_ids || jsonb_build_object(
              'bookingId', o.booking_id::text,
              'event',     ev.title,
              'dateTime',  v_when))
    on conflict (key) do nothing;

  elsif p_code in ('OF3', 'OF6') then
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    values (p_code || ':offer:' || o.id, 'push', p_code, o.offered_by_staff_id,
            v_ids || jsonb_build_object(
              'bookingId', o.booking_id::text,
              'event',     ev.title,
              'date',      v_date))
    on conflict (key) do nothing;

  elsif p_code = 'OF4' then
    if o.taken_by_staff_id is null then return; end if;
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    values ('OF4:offer:' || o.id, 'push', 'OF4', o.taken_by_staff_id,
            v_ids || jsonb_build_object(
              'bookingId', o.taken_by_booking_id::text,
              'event',     ev.title,
              'date',      v_date))
    on conflict (key) do nothing;

  elsif p_code = 'OF5' then
    select * into s from staff where id = o.offered_by_staff_id;
    select c.name into v_client from clients c where c.id = ev.client_id;
    select * into v_fill from shift_fill(sr.id);
    insert into notification_outbox (key, channel, template, recipient_emails, payload)
    values ('OF5:offer:' || o.id, 'email', 'OF5',
            array['admin@thehospitalitycompany.co.uk'],
            v_ids || jsonb_build_object(
              'bookingId',  o.booking_id::text,
              'event',      ev.title,
              'role',       v_role,
              -- E10's email dates (20260927140200).
              'date',       to_char(sr.starts_at at time zone 'Europe/London', 'Dy DD Mon YYYY'),
              'dateTime',   to_char(sr.starts_at at time zone 'Europe/London', 'Dy DD Mon YYYY HH24:MI')
                            || '–' || to_char(sr.ends_at at time zone 'Europe/London', 'HH24:MI'),
              'name',       s.first_name || ' ' || s.last_name,
              'employeeId', coalesce(s.employee_id::text, '(not yet issued)'),
              'client',     v_client,
              'venue',      ev.venue_name,
              -- REGISTER-NOTES "Additions": a blank note is written as —,
              -- so the rendered line never carries a bare placeholder.
              'note',       coalesce(nullif(btrim(o.note), ''), '—'),
              'confirmed',  v_fill.confirmed::text,
              'headcount',  sr.headcount::text,
              'buffer',     sr.buffer::text,
              'autoAssign', case when ev.auto_assign and sr.auto_assign then 'on'
                                 else 'off — this slot will only be filled by hand' end))
    on conflict (key) do nothing;

  else
    raise exception 'unknown_offer_notice: %', p_code using errcode = '22023';
  end if;
end $$;

comment on function public.queue_offer_notice(text, uuid, uuid) is
  'ADR-0039: queues one of OF1–OF6 for an offer under its register key (OFn:offer:<id>; OF1:offer:<offer>:<staff>) with exactly the payload keys packages/notifications renders, plus offerId/shiftId/eventId (and bookingId) for tooling. Push dates as N5, OF5 as E10; the base rate only; a blank note is "—". Internal: called by the offer functions, never an RPC.';

-- ---------------------------------------------------------------------
-- 1 · RULE-17 for an offer
-- ---------------------------------------------------------------------
create or replace function public.offer_wave1_exhausted(p_offer uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  -- Wave 1 is everyone qualified at this client AND role who could take
  -- the shift: ungated, not the offerer, holding no booking here that
  -- rules them out, and not away (the calendar keeps the pushes from
  -- them, so waiting for them to be told would wait forever). Exhausted
  -- once every one of them has been told (shift_offer_notices).
  select not exists (
    select 1
      from shift_offers o
      join shift_requirements sr on sr.id = o.shift_id
      cross join lateral auto_assign_candidates(o.shift_id) c
     where o.id = p_offer
       and c.gate is null
       and c.qualified
       and c.staff_id <> o.offered_by_staff_id
       and (c.booking_status is null
            or c.booking_status not in ('confirmed', 'worked', 'turned_away', 'cancelled'))
       and not staff_unavailable(c.staff_id, sr.starts_at, sr.ends_at)
       and not exists (select 1 from shift_offer_notices n
                        where n.offer_id = o.id and n.staff_id = c.staff_id)
  )
$$;

comment on function public.offer_wave1_exhausted(uuid) is
  'ADR-0039, RULE-17: true once every wave-1 worker for this offer (qualified at client + role, ungated, not the offerer, no ruling-out booking on the section, not marked unavailable) has been pushed it. Until then an unqualified taker gets not_yet and Radar hides it from them. Service role; called inside the definer offer functions.';

-- ---------------------------------------------------------------------
-- 2 · The worker: offer, withdraw, ask for cover
-- ---------------------------------------------------------------------
create or replace function public.offer_shift(p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid;
  b     bookings;
  sr    shift_requirements;
  ev    events;
  v_id  uuid;
  v_exp timestamptz;
begin
  select id into v_me from staff where user_id = auth.uid();
  if v_me is null then raise exception 'not_a_worker' using errcode = '42501'; end if;

  select * into b from bookings where id = p_booking;
  if b.id is null then raise exception 'booking_not_found' using errcode = 'P0002'; end if;
  if b.staff_id <> v_me then raise exception 'not_your_booking' using errcode = '42501'; end if;

  -- The section lock every slot path takes, then the booking as it is now.
  select * into sr from shift_requirements where id = b.shift_id for update;
  select * into b from bookings where id = p_booking;
  select * into ev from events where id = sr.event_id;

  if ev.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'event_cancelled');
  end if;
  if b.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'reason', 'not_confirmed');
  end if;
  -- RULE-04's boundary, exactly as self_cancel_booking() draws it: strictly
  -- more than 72 hours (canOfferShift() = canCancelShift()).
  if sr.starts_at - now() <= interval '72 hours' then
    return jsonb_build_object('ok', false, 'reason', 'too_late');
  end if;
  if not (ev.auto_assign and sr.auto_assign) then
    return jsonb_build_object('ok', false, 'reason', 'auto_assign_off');
  end if;
  if exists (select 1 from shift_offers where booking_id = b.id and status = 'open') then
    return jsonb_build_object('ok', false, 'reason', 'already_offered');
  end if;

  v_exp := sr.starts_at - interval '72 hours';
  insert into shift_offers (booking_id, shift_id, offered_by_staff_id, mode, expires_at)
  values (b.id, sr.id, v_me, 'pool', v_exp)
  returning id into v_id;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'shift_offer.offered', 'shift_offer', v_id,
          jsonb_build_object('bookingId', b.id, 'shiftId', sr.id, 'mode', 'pool', 'expiresAt', v_exp));

  return jsonb_build_object('ok', true, 'offerId', v_id, 'expiresAt', v_exp);
end $$;

comment on function public.offer_shift(uuid) is
  'ADR-0039: the worker offers their own confirmed booking to the pool. Refuses event_cancelled / not_confirmed / too_late (72 h or less remain — RULE-04''s boundary) / auto_assign_off (event or role switch off: ask the office instead) / already_offered. The worker stays confirmed; the offer expires at start − 72 h.';

create or replace function public.withdraw_shift_offer(p_offer uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_me uuid;
  o    shift_offers;
begin
  select id into v_me from staff where user_id = auth.uid();
  if v_me is null then raise exception 'not_a_worker' using errcode = '42501'; end if;

  select * into o from shift_offers where id = p_offer;
  if o.id is null then raise exception 'offer_not_found' using errcode = 'P0002'; end if;
  if o.offered_by_staff_id <> v_me then raise exception 'not_your_offer' using errcode = '42501'; end if;

  perform 1 from shift_requirements where id = o.shift_id for update;
  select * into o from shift_offers where id = p_offer for update;
  if o.status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'offer_not_open', 'status', o.status);
  end if;

  update shift_offers set status = 'withdrawn', closed_reason = 'withdrawn_by_worker' where id = o.id;
  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'shift_offer.withdrawn', 'shift_offer', o.id,
          jsonb_build_object('bookingId', o.booking_id, 'mode', o.mode));
  return jsonb_build_object('ok', true);
end $$;

comment on function public.withdraw_shift_offer(uuid) is
  'ADR-0039: the worker withdraws their own open offer (a pool offer or a cover request). Under the section lock, so it cannot race a take: offer_not_open once somebody has it.';

create or replace function public.request_cover(p_booking uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_me   uuid;
  b      bookings;
  sr     shift_requirements;
  ev     events;
  v_id   uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select id into v_me from staff where user_id = auth.uid();
  if v_me is null then raise exception 'not_a_worker' using errcode = '42501'; end if;

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
  -- More than 72 h out with auto-assign on, the worker offers it themself.
  if sr.starts_at - now() > interval '72 hours' and ev.auto_assign and sr.auto_assign then
    return jsonb_build_object('ok', false, 'reason', 'use_offer');
  end if;
  if char_length(coalesce(v_note, '')) > 300 then
    return jsonb_build_object('ok', false, 'reason', 'note_too_long');
  end if;
  if exists (select 1 from shift_offers where booking_id = b.id and status = 'open') then
    return jsonb_build_object('ok', false, 'reason', 'already_offered');
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
  'ADR-0039: "Ask the office for cover" — inside 72 h, or with auto-assign off. Creates an office offer (not visible to workers, not pushed) and queues OF5 to admin@ at once; the worker stays confirmed. Refuses event_cancelled / not_confirmed / section_started / use_offer (more than 72 h out with auto-assign on) / note_too_long (> 300) / already_offered.';

-- ---------------------------------------------------------------------
-- 3 · The take
-- ---------------------------------------------------------------------
create or replace function public.take_offered_shift(p_offer uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_me        uuid;
  o           shift_offers;
  sr          shift_requirements;
  ev          events;
  orig        bookings;
  mine        bookings;
  v_gate      text;
  v_qualified boolean;
  v_direct    boolean;
  v_gap       int := booked_elsewhere_gap_minutes();
  v_taker     uuid;
  v_withdrawn int := 0;
begin
  select id into v_me from staff where user_id = auth.uid();
  if v_me is null then raise exception 'not_a_worker' using errcode = '42501'; end if;

  select * into o from shift_offers where id = p_offer;
  if o.id is null then
    -- Unknown and not-open read the same: an id says nothing about anybody.
    return jsonb_build_object('ok', false, 'reason', 'offer_not_open');
  end if;

  -- The same lock invite_worker, accept_invite and accept_application take,
  -- so every path to this slot queues on one row; then the offer and the
  -- offerer's booking as they are now.
  select * into sr from shift_requirements where id = o.shift_id for update;
  select * into o from shift_offers where id = p_offer for update;
  select * into orig from bookings where id = o.booking_id for update;
  select * into ev from events where id = sr.event_id;
  v_direct := coalesce((select s.value = 'true'::jsonb from settings s
                         where s.key = 'shift_offers_direct_enabled'), false);

  -- takeOffer()'s order (shiftOffer.vectors.json).
  if ev.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'event_cancelled');
  end if;
  if o.status <> 'open'
     or o.mode = 'office'
     or (o.mode = 'direct' and not (v_direct and o.target_staff_id = v_me)) then
    return jsonb_build_object('ok', false, 'reason', 'offer_not_open');
  end if;
  if now() >= o.expires_at then
    return jsonb_build_object('ok', false, 'reason', 'offer_expired');
  end if;
  if orig.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'reason', 'original_not_confirmed');
  end if;
  if o.offered_by_staff_id = v_me then
    return jsonb_build_object('ok', false, 'reason', 'own_offer');
  end if;
  if now() >= sr.starts_at then
    return jsonb_build_object('ok', false, 'reason', 'section_started');
  end if;

  -- Every hard gate the pool applies, by name. The calendar is not one of
  -- them for a take (ADR-0036): the worker has changed their mind.
  select c.gate, c.qualified into v_gate, v_qualified
    from auto_assign_candidates(sr.id) c
   where c.staff_id = v_me;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_bookable');
  end if;
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'reason',
      case v_gate
        when 'booked_elsewhere' then 'overlap'
        when 'wrong_role' then v_gate
        when 'do_not_return' then v_gate
        when 'blocked' then v_gate
        when 'self_cancelled' then v_gate
        when 'rtw_expired' then v_gate
        when 'hours_limit' then v_gate
        else 'not_bookable'
      end);
  end if;

  -- accept_invite()'s own re-reads (20260928110400), kept literally: the
  -- confirmed-only overlap with the 2 h different-venue gap, then RULE-20
  -- with the right-to-work stop told apart.
  if exists (
    select 1 from bookings x
      join shift_requirements sr2 on sr2.id = x.shift_id
      join events ev2 on ev2.id = sr2.event_id
     where x.staff_id = v_me and x.status = 'confirmed' and x.shift_id <> sr.id
       and booked_elsewhere_conflict(sr.starts_at, sr.ends_at, ev.venue_id,
                                     sr2.starts_at, sr2.ends_at, ev2.venue_id, v_gap) <> 'clear'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'overlap');
  end if;
  if weekly_cap_would_breach(v_me, sr.id) then
    if not (can_roster_staff(v_me, (sr.starts_at at time zone 'Europe/London')::date)
            and can_roster_staff(v_me, ((sr.ends_at - interval '1 second')
                                        at time zone 'Europe/London')::date)) then
      return jsonb_build_object('ok', false, 'reason', 'rtw_expired');
    end if;
    return jsonb_build_object('ok', false, 'reason', 'hours_limit');
  end if;

  select * into mine from bookings where shift_id = sr.id and staff_id = v_me for update;
  if mine.id is not null and mine.status in ('confirmed', 'worked', 'turned_away', 'cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'already_had_booking');
  end if;

  -- RULE-17: qualified at this client and role first, fully.
  if not v_qualified and o.mode = 'pool' and not offer_wave1_exhausted(o.id) then
    return jsonb_build_object('ok', false, 'reason', 'not_yet');
  end if;

  -- The hand-over. The taker is confirmed first, then the offer is taken,
  -- then the original is released — so bookings_offer_lapse finds no open
  -- offer to lapse, and at no point is the slot empty.
  if mine.id is null then
    insert into bookings (shift_id, staff_id, status, source, confirmed_at)
    values (sr.id, v_me, 'confirmed', 'offer', now())
    returning id into v_taker;
  else
    if mine.status = 'closed' then
      -- §3.6: a dead offer comes back through `applied` (closed → applied).
      update bookings
         set status = 'applied', applied_at = coalesce(applied_at, now()),
             cancelled_at = null, cancel_cause = null
       where id = mine.id;
    end if;
    update bookings
       set status = 'confirmed', source = 'offer', confirmed_at = now(),
           cancelled_at = null, cancel_cause = null
     where id = mine.id;
    v_taker := mine.id;
  end if;

  update shift_offers
     set status = 'taken', taken_by_booking_id = v_taker, taken_by_staff_id = v_me,
         closed_reason = 'taken'
   where id = o.id;

  -- RULE-04 / Q15: a completed hand-over bars the offerer from the event.
  update bookings
     set status = 'cancelled', cancelled_at = now(),
         cancel_cause = 'handed_over', self_cancelled = true
   where id = orig.id;

  -- §3.4, as on Accept: the taker's other intersecting invitations go.
  with overlapping as (
    update bookings x set status = 'cancelled', cancelled_at = now(),
                          cancel_cause = 'overlap_auto_withdraw'
      from shift_requirements sr3
     where sr3.id = x.shift_id
       and x.staff_id = v_me and x.status = 'invited' and x.id <> v_taker
       and sr.starts_at < sr3.ends_at and sr3.starts_at < sr.ends_at
    returning x.id
  ) select count(*)::int into v_withdrawn from overlapping;

  perform queue_offer_notice('OF2', o.id);
  perform queue_offer_notice('OF4', o.id);

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'shift_offer.taken', 'shift_offer', o.id,
          jsonb_build_object('shiftId', sr.id,
                             'fromStaffId', o.offered_by_staff_id, 'fromBookingId', orig.id,
                             'toStaffId', v_me, 'toBookingId', v_taker));

  return jsonb_build_object('ok', true, 'bookingId', v_taker, 'withdrawn', v_withdrawn);
end $$;

comment on function public.take_offered_shift(uuid) is
  'ADR-0039: one transaction under the section lock. Refuses, in takeOffer()''s order: event_cancelled › offer_not_open › offer_expired › original_not_confirmed › own_offer › section_started › the pool gate by name (booked_elsewhere → overlap; no row → not_bookable) and accept_invite''s overlap / cap re-reads › already_had_booking › not_yet (RULE-17). Then the taker is confirmed (source offer), the offer taken, the original cancelled / handed_over / self_cancelled, the taker''s overlapping invitations withdrawn, OF2 + OF4 queued. Confirmed count net zero. Never refused for the calendar (ADR-0036).';

-- ---------------------------------------------------------------------
-- 4 · What the worker reads
-- ---------------------------------------------------------------------
create or replace function public.staff_open_offers(p_offer uuid default null)
returns table (
  offer_id          uuid,
  shift_id          uuid,
  event_id          uuid,
  event_title       text,
  event_date        date,
  role              text,
  starts_at         timestamptz,
  ends_at           timestamptz,
  pay_rate          numeric,
  dress_code        text,
  venue_name        text,
  venue_address     text,
  distance_km       numeric,
  expires_at        timestamptz,
  qualified         boolean,
  venue_lat         double precision,
  venue_lng         double precision,
  geofence_radius_m int,
  home_lat          double precision,
  home_lng          double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  -- offerVisibleTo() in packages/domain: open, not expired, never the
  -- worker's own, never an office cover request, a direct offer only to
  -- its one colleague, and a pool offer to wave 1 at once and to everyone
  -- else once wave 1 is exhausted. A gated worker never sees it; the
  -- calendar is not a gate here. The offerer is never returned.
  with me as (select staff_caller(null) as id),
       direct as (select coalesce((select s.value = 'true'::jsonb from settings s
                                    where s.key = 'shift_offers_direct_enabled'), false) as on_)
  select
    o.id, sr.id, ev.id, ev.title, ev.event_date, r.name, sr.starts_at, sr.ends_at,
    sr.pay_rate, sr.dress_code, ev.venue_name, ev.venue_address,
    round((st_distance(st.home_location, ev.venue_location) / 1000.0)::numeric, 1),
    o.expires_at, c.qualified,
    st_y(ev.venue_location::geometry), st_x(ev.venue_location::geometry), ev.geofence_radius_m,
    st_y(st.home_location::geometry), st_x(st.home_location::geometry)
  from me
    cross join direct
    join staff st              on st.id = me.id
    join shift_offers o        on o.status = 'open'
                              and o.expires_at > now()
                              and o.offered_by_staff_id <> me.id
                              and (p_offer is null or o.id = p_offer)
                              and (o.mode = 'pool'
                                   or (o.mode = 'direct' and direct.on_ and o.target_staff_id = me.id))
    join bookings ob           on ob.id = o.booking_id and ob.status = 'confirmed'
    join shift_requirements sr on sr.id = o.shift_id and sr.starts_at > now()
    join events ev             on ev.id = sr.event_id and ev.cancelled_at is null
    join roles r               on r.id = sr.role_id
    cross join lateral (
      select a.gate, a.qualified, a.booking_status
        from auto_assign_candidates(sr.id) a
       where a.staff_id = me.id
    ) c
  where c.gate is null
    and (c.booking_status is null or c.booking_status in ('invited', 'applied', 'closed'))
    and (c.qualified or o.mode = 'direct' or offer_wave1_exhausted(o.id))
  order by c.qualified desc,
           round((st_distance(st.home_location, ev.venue_location) / 1000.0)::numeric, 1),
           sr.starts_at
$$;

comment on function public.staff_open_offers(uuid) is
  'ADR-0039: Radar''s "Up for grabs" (and /radar/offers/:id with p_offer) — the open offers this worker may take, RULE-17 visibility (offerVisibleTo()). Role, event, venue, the section''s window, the BASE rate, dress code, km, expiry; never the offerer, never the holiday element.';

create or replace function public.staff_booking_offers()
returns table (
  booking_id       uuid,
  auto_assign      boolean,
  offer_id         uuid,
  offer_mode       text,
  offer_expires_at timestamptz,
  offer_note       text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  -- The caller's own confirmed bookings that have not ended, each with
  -- whether auto-assign is on for its event AND role (Offer this shift
  -- shows only then) and the open offer on it, if any.
  with me as (select staff_caller(null) as id)
  select b.id, (ev.auto_assign and sr.auto_assign), o.id, o.mode, o.expires_at, o.note
    from me
    join bookings b            on b.staff_id = me.id and b.status = 'confirmed'
    join shift_requirements sr on sr.id = b.shift_id and sr.ends_at > now()
    join events ev             on ev.id = sr.event_id
    left join shift_offers o   on o.booking_id = b.id and o.status = 'open'
   order by sr.starts_at
$$;

comment on function public.staff_booking_offers() is
  'ADR-0039: the worker''s own live confirmed bookings with the auto-assign switch (event AND role) and their open offer (mode pool = "Offered · open until …", office = "Cover requested"). For /shifts and /shifts/:id; staff_bookings() is left as it is.';

-- ---------------------------------------------------------------------
-- 5 · The office
-- ---------------------------------------------------------------------
create or replace function public.office_open_offer_to_pool(p_offer uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  o    shift_offers;
  sr   shift_requirements;
  ev   events;
  orig bookings;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select * into o from shift_offers where id = p_offer;
  if o.id is null then raise exception 'offer_not_found' using errcode = 'P0002'; end if;
  select * into sr from shift_requirements where id = o.shift_id for update;
  select * into o from shift_offers where id = p_offer for update;
  select * into orig from bookings where id = o.booking_id;
  select * into ev from events where id = sr.event_id;

  if ev.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'event_cancelled');
  end if;
  if o.status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'offer_not_open');
  end if;
  if o.mode <> 'office' then
    return jsonb_build_object('ok', false, 'reason', 'not_a_cover_request');
  end if;
  if now() >= sr.starts_at then
    return jsonb_build_object('ok', false, 'reason', 'section_started');
  end if;
  if orig.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'reason', 'original_not_confirmed');
  end if;

  -- office → pool is the one mode edge (shift_offer_mode_transitions()).
  -- It runs to the section's start (offerExpiresAt(…, true)); after that
  -- the escalation job owns the section.
  update shift_offers
     set mode = 'pool', expires_at = sr.starts_at, decided_by = auth.uid()
   where id = o.id;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'shift_offer.opened_to_pool', 'shift_offer', o.id,
          jsonb_build_object('bookingId', o.booking_id, 'shiftId', sr.id, 'expiresAt', sr.starts_at));
  return jsonb_build_object('ok', true, 'expiresAt', sr.starts_at);
end $$;

comment on function public.office_open_offer_to_pool(uuid) is
  'ADR-0039: the office opens a worker''s cover request to the pool (office → pool), takeable until the section start and pushed in the hourly OF1 rounds while auto-assign is on. Admin only; audited. Refuses event_cancelled / offer_not_open / not_a_cover_request / section_started / original_not_confirmed.';

create or replace function public.office_decline_cover(p_offer uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  o      shift_offers;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select * into o from shift_offers where id = p_offer;
  if o.id is null then raise exception 'offer_not_found' using errcode = 'P0002'; end if;
  perform 1 from shift_requirements where id = o.shift_id for update;
  select * into o from shift_offers where id = p_offer for update;

  if o.status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'offer_not_open');
  end if;
  if o.mode <> 'office' then
    return jsonb_build_object('ok', false, 'reason', 'not_a_cover_request');
  end if;
  if char_length(coalesce(v_note, '')) > 300 then
    return jsonb_build_object('ok', false, 'reason', 'note_too_long');
  end if;

  update shift_offers
     set status = 'cancelled', decided_by = auth.uid(),
         closed_reason = coalesce(v_note, 'declined by the office')
   where id = o.id;

  perform queue_offer_notice('OF6', o.id);

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'shift_offer.cover_declined', 'shift_offer', o.id,
          jsonb_strip_nulls(jsonb_build_object('bookingId', o.booking_id, 'note', v_note)));
  return jsonb_build_object('ok', true);
end $$;

comment on function public.office_decline_cover(uuid, text) is
  'ADR-0039: the office closes a worker''s cover request (open → cancelled) and queues OF6; the worker stays booked. The note is the office''s own record (closed_reason), never sent to the worker. Admin only; audited.';

-- ---------------------------------------------------------------------
-- 6 · The service role: the hourly offer rounds and the lapse
-- ---------------------------------------------------------------------
create or replace function public.lapse_shift_offers(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id   uuid;
  v_mode text;
  v_n    int := 0;
begin
  for v_id, v_mode in
    update shift_offers
       set status = 'lapsed', closed_reason = 'expired', closed_at = p_now
     where status = 'open' and expires_at <= p_now
    returning id, mode
  loop
    v_n := v_n + 1;
    -- OF3 is for an offer that went to other workers and found nobody. A
    -- cover request the office never opened lapses at the start silently:
    -- nobody was ever asked, and the office already had it (OF5).
    if v_mode <> 'office' then
      perform queue_offer_notice('OF3', v_id);
    end if;
  end loop;
  return v_n;
end $$;

comment on function public.lapse_shift_offers(timestamptz) is
  'ADR-0039: closes every open offer past its expiry (open → lapsed, closed_reason expired) and queues OF3 — "you''re still booked" — for each that had gone to other workers. The worker stays confirmed. Service role; the auto-staffing hourly run calls it first.';

create or replace function public.offer_rounds_due(p_now timestamptz default now())
returns table (offer_id uuid, shift_id uuid, event_id uuid, allocation int, expires_at timestamptz)
language sql
stable
security definer
set search_path = public, extensions
as $$
  -- Pushes are something the machine does, so they follow the auto-assign
  -- switches like every other round (§3.4): both on, or no OF1.
  select o.id, sr.id, ev.id, sr.allocation_per_hour, o.expires_at
    from shift_offers o
    join shift_requirements sr on sr.id = o.shift_id
    join events ev             on ev.id = sr.event_id
   where o.status = 'open' and o.mode = 'pool'
     and o.expires_at > p_now and sr.starts_at > p_now
     and ev.cancelled_at is null
     and ev.auto_assign and sr.auto_assign
   order by o.expires_at
$$;

comment on function public.offer_rounds_due(timestamptz) is
  'ADR-0039: the open pool offers an hourly OF1 round serves — not expired, section not started, event live, auto-assign on for the event and role — with the section''s allocation_per_hour. Service role.';

create or replace function public.offer_candidates(p_offer uuid)
returns table (
  staff_id       uuid,
  gate           text,
  qualified      boolean,
  booking_status text,
  reliability    numeric,
  rating         numeric,
  distance_km    numeric,
  future_shifts  int,
  venue_times    int
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  -- The pool auto-assign reads for the offer's section, less the offerer.
  -- selectOfferRecipients() ranks it exactly as an invitation round.
  select c.staff_id, c.gate, c.qualified, c.booking_status, c.reliability, c.rating,
         c.distance_km, c.future_shifts, c.venue_times
    from shift_offers o
    cross join lateral auto_assign_candidates(o.shift_id) c
   where o.id = p_offer
     and c.staff_id <> o.offered_by_staff_id
$$;

comment on function public.offer_candidates(uuid) is
  'ADR-0039: auto_assign_candidates for the offer''s section without the offerer — the rows selectOfferRecipients() ranks (RULE-17 waves, §6 score). Service role.';

create or replace function public.notify_offer_candidates(p_offer uuid, p_staff uuid[])
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  o       shift_offers;
  sr      shift_requirements;
  ev      events;
  v_staff uuid;
  v_qual  boolean;
  v_n     int := 0;
begin
  select * into o from shift_offers where id = p_offer for update;
  if o.id is null or o.status <> 'open' or o.mode <> 'pool' or now() >= o.expires_at then
    return 0;
  end if;
  select * into sr from shift_requirements where id = o.shift_id;
  select * into ev from events where id = sr.event_id;
  if ev.cancelled_at is not null or now() >= sr.starts_at
     or not (ev.auto_assign and sr.auto_assign) then
    return 0;
  end if;

  -- Wave 1 first, whatever order the list came in; a wave-2 worker only
  -- once wave 1 has been told in full (RULE-17, re-checked here so the
  -- job cannot get it wrong).
  for v_staff, v_qual in
    select c.staff_id, c.qualified
      from auto_assign_candidates(sr.id) c
     where c.staff_id = any(p_staff)
       and c.staff_id <> o.offered_by_staff_id
       and c.gate is null
       and (c.booking_status is null
            or c.booking_status not in ('confirmed', 'worked', 'turned_away', 'cancelled'))
       -- ADR-0036: the calendar gates the pushes too.
       and not staff_unavailable(c.staff_id, sr.starts_at, sr.ends_at)
       and not exists (select 1 from shift_offer_notices n
                        where n.offer_id = o.id and n.staff_id = c.staff_id)
     order by c.qualified desc
  loop
    if not v_qual and not offer_wave1_exhausted(o.id) then
      continue;
    end if;
    insert into shift_offer_notices (offer_id, staff_id, notified_at)
    values (o.id, v_staff, now())
    on conflict do nothing;
    perform queue_offer_notice('OF1', o.id, v_staff);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

comment on function public.notify_offer_candidates(uuid, uuid[]) is
  'ADR-0039: one OF1 round for an open pool offer — records a shift_offer_notices row and queues OF1 (OF1:offer:<offer>:<staff>) for each named worker who is ungated, not the offerer, not ruled out by a booking here, not marked unavailable (ADR-0036) and not already told. Wave 1 first; a wave-2 worker only once wave 1 is exhausted (RULE-17). Nothing after expiry, after the start, on a cancelled event or with auto-assign off. Service role.';

-- ---------------------------------------------------------------------
-- 7 · bookings_offer_lapse: any other exit from confirmed closes the offer
-- ---------------------------------------------------------------------
create or replace function public.bookings_offer_lapse()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  -- Silent: the cause (N10b, N6b, N12, the block, the self-cancel …) has
  -- its own notification, and OF3 is for an expiry only.
  update shift_offers
     set status = 'lapsed', closed_reason = coalesce(new.cancel_cause, new.status::text)
   where booking_id = new.id and status = 'open';
  return null;
end $$;

drop trigger if exists bookings_offer_lapse on bookings;
create trigger bookings_offer_lapse
  after update of status on bookings
  for each row
  when (old.status = 'confirmed' and new.status is distinct from 'confirmed')
  execute function bookings_offer_lapse();

comment on function public.bookings_offer_lapse() is
  'ADR-0039: when a booking leaves confirmed by any cause but a take (Withdraw, 12:05 cutoff, block, leave, GDPR, event cancelled, self-cancel, check-in), its open offer lapses with that cause as closed_reason. A take closes the offer first, so it never fires for one. A trigger function: not an RPC.';

-- ---------------------------------------------------------------------
-- Grants. Worker and office RPCs: authenticated, with the check inside.
-- The service functions and the internal writer: never a signed-in caller.
-- The trigger function: no one (20260927161000).
-- ---------------------------------------------------------------------
revoke execute on function public.offer_shift(uuid)                    from public, anon;
revoke execute on function public.withdraw_shift_offer(uuid)           from public, anon;
revoke execute on function public.request_cover(uuid, text)            from public, anon;
revoke execute on function public.take_offered_shift(uuid)             from public, anon;
revoke execute on function public.staff_open_offers(uuid)              from public, anon;
revoke execute on function public.staff_booking_offers()               from public, anon;
revoke execute on function public.office_open_offer_to_pool(uuid)      from public, anon;
revoke execute on function public.office_decline_cover(uuid, text)     from public, anon;
grant  execute on function public.offer_shift(uuid)                    to authenticated;
grant  execute on function public.withdraw_shift_offer(uuid)           to authenticated;
grant  execute on function public.request_cover(uuid, text)            to authenticated;
grant  execute on function public.take_offered_shift(uuid)             to authenticated;
grant  execute on function public.staff_open_offers(uuid)              to authenticated;
grant  execute on function public.staff_booking_offers()               to authenticated;
grant  execute on function public.office_open_offer_to_pool(uuid)      to authenticated;
grant  execute on function public.office_decline_cover(uuid, text)     to authenticated;

revoke execute on function public.lapse_shift_offers(timestamptz)      from public, anon, authenticated;
revoke execute on function public.offer_rounds_due(timestamptz)        from public, anon, authenticated;
revoke execute on function public.offer_candidates(uuid)               from public, anon, authenticated;
revoke execute on function public.notify_offer_candidates(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.offer_wave1_exhausted(uuid)          from public, anon, authenticated;
grant  execute on function public.lapse_shift_offers(timestamptz)      to service_role;
grant  execute on function public.offer_rounds_due(timestamptz)        to service_role;
grant  execute on function public.offer_candidates(uuid)               to service_role;
grant  execute on function public.notify_offer_candidates(uuid, uuid[]) to service_role;
grant  execute on function public.offer_wave1_exhausted(uuid)          to service_role;

revoke execute on function public.queue_offer_notice(text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.bookings_offer_lapse()               from public, anon, authenticated;
