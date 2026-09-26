-- =====================================================================
-- Migration 20260930205000 · offer up a shift — review fixes
--   (ADR-0046 "Amendment · review fixes"; QA + security review of
--   20260930201100_shift_offers.sql)
--
-- Every function below is restated IN FULL from its latest definition
-- (20260930201100 — nothing later redefines any of them) with the one
-- change its section names, and keeps its grants and revokes.
--
--   1 · offer_wave1_exhausted()   RULE-17 deadlock (QA S1). With the event
--       or the role's auto-assign OFF no OF1 is ever pushed, so wave 1 was
--       never "told" and an unqualified worker could never see or take a
--       cover request the office had opened to the pool. Wave 1 now counts
--       as exhausted when NOT (event.auto_assign AND section.auto_assign):
--       the office opening it to the pool IS the release, as it is for
--       every hand-picked section. With both switches on the old order
--       holds unchanged. staff_open_offers() and take_offered_shift() read
--       this function, so both admit wave 2 without being restated for it.
--   2 · take_offered_shift()      lock order (QA S2). Every other exit from
--       confirmed locks the booking and THEN the offer (the lapse trigger);
--       the take locked the offer first — a cycle. It now reads the offer's
--       booking id without a lock (booking_id is immutable, the state
--       guard), then locks section → original booking → offer, and
--       re-checks the offer under its lock.
--   3 · offer_shift(), withdraw_shift_offer(), request_cover(),
--       take_offered_shift()      the caller (security #4). Resolved by
--       staff_caller(); a removed, inactive (leaver) or rejected caller is
--       refused with 20260930202000's shape: unknown_staff /
--       account_closed / not_editable, all P0001. (unknown_staff replaces
--       the old 42501 not_a_worker.)
--   4 · request_cover() + queue_offer_notice()   OF5 flood (security #1).
--       OF5 is keyed on the BOOKING ('OF5:booking:' || booking id), so
--       repeat requests on one booking never email admin@ twice; and a
--       request is refused `recently_requested` while a withdrawn cover
--       request on the same booking closed in the last 24 hours.
--   5 · office_decline_cover()    the audit row records only that a note
--       was written (has_note), never the office's free text (QA S4). The
--       note stays the office's record in shift_offers.closed_reason.
--   6 · lapse_shift_offers()      no OF3 once the section has started: by
--       then "you're still booked" is news to nobody, and the escalation
--       job owns the section.
--
-- Rebased when re-stamped after main's 20260930100000–20260930140100
-- (docs/10 §3b): take_offered_shift()'s overlap re-read follows
-- accept_invite()'s latest body (20260930110000, D2 "worked is staffed")
-- and counts a checked-in (worked) booking as well as a confirmed one.
-- shift_fill() and auto_assign_candidates() are called, not restated, so
-- main's versions of both apply here unchanged.
--
-- Forward-only. References only 20260930201100 and earlier objects.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 4 · The outbox writer — OF5 keyed on the booking
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
    -- Keyed on the BOOKING, not the offer: however many times a worker
    -- asks, withdraws and asks again, admin@ hears about one booking once.
    insert into notification_outbox (key, channel, template, recipient_emails, payload)
    values ('OF5:booking:' || o.booking_id, 'email', 'OF5',
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
  'ADR-0046: queues one of OF1–OF6 for an offer under its register key (OFn:offer:<id>; OF1:offer:<offer>:<staff>; OF5:booking:<booking> — once per booking however often cover is asked) with exactly the payload keys packages/notifications renders, plus offerId/shiftId/eventId (and bookingId) for tooling. Push dates as N5, OF5 as E10; the base rate only; a blank note is "—". Internal: called by the offer functions, never an RPC.';

-- ---------------------------------------------------------------------
-- 1 · RULE-17 for an offer — exhausted at once with auto-assign off
-- ---------------------------------------------------------------------
create or replace function public.offer_wave1_exhausted(p_offer uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  -- With the event or the role's auto-assign OFF nobody is ever pushed an
  -- offer (OF1 follows the switches), so waiting for wave 1 to be told
  -- would wait for ever: the office opening it to the pool is the release,
  -- and wave 2 may see and take it at once.
  select exists (
    select 1
      from shift_offers o
      join shift_requirements sr on sr.id = o.shift_id
      join events ev             on ev.id = sr.event_id
     where o.id = p_offer
       and not (ev.auto_assign and sr.auto_assign)
  )
  -- Otherwise wave 1 is everyone qualified at this client AND role who
  -- could take the shift: ungated, not the offerer, holding no booking
  -- here that rules them out, and not away (the calendar keeps the pushes
  -- from them, so waiting for them to be told would wait forever).
  -- Exhausted once every one of them has been told (shift_offer_notices).
  or not exists (
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
  'ADR-0046, RULE-17: true when auto-assign is off for the offer''s event or role (no OF1 is ever pushed, so the office opening it to the pool releases it to everyone), else once every wave-1 worker for this offer (qualified at client + role, ungated, not the offerer, no ruling-out booking on the section, not marked unavailable) has been pushed it. Until then an unqualified taker gets not_yet and Radar hides it from them. Service role; called inside the definer offer functions.';

-- ---------------------------------------------------------------------
-- 3 · The worker: offer, withdraw, ask for cover — caller refused by
--     status as 20260930202000 does
-- ---------------------------------------------------------------------
create or replace function public.offer_shift(p_booking uuid)
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
  v_exp    timestamptz;
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
  'ADR-0046: the worker offers their own confirmed booking to the pool. Caller by staff_caller(): unknown_staff / account_closed (removed) / not_editable (leaver, rejected) raise P0001. Refuses event_cancelled / not_confirmed / too_late (72 h or less remain — RULE-04''s boundary) / auto_assign_off (event or role switch off: ask the office instead) / already_offered. The worker stays confirmed; the offer expires at start − 72 h.';

create or replace function public.withdraw_shift_offer(p_offer uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_me     uuid := staff_caller();
  v_status staff_status;
  o        shift_offers;
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
  'ADR-0046: the worker withdraws their own open offer (a pool offer or a cover request). Caller by staff_caller(): unknown_staff / account_closed / not_editable raise P0001. Under the section lock, so it cannot race a take: offer_not_open once somebody has it.';

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
  'ADR-0046: "Ask the office for cover" — inside 72 h, or with auto-assign off. Creates an office offer (not visible to workers, not pushed) and queues OF5 to admin@ (keyed OF5:booking:<id>, so once per booking). Caller by staff_caller(): unknown_staff / account_closed / not_editable raise P0001. Refuses event_cancelled / not_confirmed / section_started / use_offer (more than 72 h out with auto-assign on) / note_too_long (> 300) / already_offered / recently_requested (a cover request on this booking withdrawn in the last 24 h).';

-- ---------------------------------------------------------------------
-- 2 + 3 · The take — section → original booking → offer
-- ---------------------------------------------------------------------
create or replace function public.take_offered_shift(p_offer uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_me        uuid := staff_caller();
  v_status    staff_status;
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

  -- Unlocked: only to learn the section and the booking. Both are
  -- immutable on an offer (shift_offers_state_guard), so the ids read here
  -- are the ids under the locks below.
  select * into o from shift_offers where id = p_offer;
  if o.id is null then
    -- Unknown and not-open read the same: an id says nothing about anybody.
    return jsonb_build_object('ok', false, 'reason', 'offer_not_open');
  end if;

  -- The same lock invite_worker, accept_invite and accept_application take,
  -- so every path to this slot queues on one row. Then the offerer's
  -- booking BEFORE the offer: every other exit from confirmed holds the
  -- booking and then lapses the offer (bookings_offer_lapse), so taking
  -- them the other way round could deadlock. The offer is re-read under
  -- its own lock, as it is now.
  select * into sr from shift_requirements where id = o.shift_id for update;
  select * into orig from bookings where id = o.booking_id for update;
  select * into o from shift_offers where id = p_offer for update;
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
  -- them for a take (ADR-0043): the worker has changed their mind.
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

  -- accept_invite()'s own re-reads, kept literally from its latest body
  -- (main's 20260930110000, D2): the overlap with the 2 h different-venue
  -- gap against confirmed OR worked bookings — a shift the worker has
  -- already checked in to is at least as confirmed — then RULE-20 with the
  -- right-to-work stop told apart.
  if exists (
    select 1 from bookings x
      join shift_requirements sr2 on sr2.id = x.shift_id
      join events ev2 on ev2.id = sr2.event_id
     where x.staff_id = v_me and x.status in ('confirmed', 'worked') and x.shift_id <> sr.id
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

  -- RULE-17: qualified at this client and role first, fully — which, with
  -- auto-assign off, offer_wave1_exhausted() counts as done at once.
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
  'ADR-0046: one transaction; locks section → offerer''s booking → offer (the order every other exit from confirmed takes). Caller by staff_caller(): unknown_staff / account_closed / not_editable raise P0001. Refuses, in takeOffer()''s order: event_cancelled › offer_not_open › offer_expired › original_not_confirmed › own_offer › section_started › the pool gate by name (booked_elsewhere → overlap; no row → not_bookable) and accept_invite''s overlap / cap re-reads › already_had_booking › not_yet (RULE-17; none with auto-assign off). Then the taker is confirmed (source offer), the offer taken, the original cancelled / handed_over / self_cancelled, the taker''s overlapping invitations withdrawn, OF2 + OF4 queued. Confirmed count net zero. Never refused for the calendar (ADR-0043).';

-- ---------------------------------------------------------------------
-- 5 · The office declines a cover request — the note is not audited
-- ---------------------------------------------------------------------
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

  -- The note is free text about a worker; its one home is closed_reason,
  -- which the GDPR removal can reach. The audit trail records only that
  -- one was written.
  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'shift_offer.cover_declined', 'shift_offer', o.id,
          jsonb_build_object('bookingId', o.booking_id, 'has_note', v_note is not null));
  return jsonb_build_object('ok', true);
end $$;

comment on function public.office_decline_cover(uuid, text) is
  'ADR-0046: the office closes a worker''s cover request (open → cancelled) and queues OF6; the worker stays booked. The note is the office''s own record (closed_reason), never sent to the worker and never copied into audit_log (has_note only). Admin only; audited.';

-- ---------------------------------------------------------------------
-- 6 · The lapse — no OF3 once the section has started
-- ---------------------------------------------------------------------
create or replace function public.lapse_shift_offers(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id    uuid;
  v_mode  text;
  v_shift uuid;
  v_start timestamptz;
  v_n     int := 0;
begin
  for v_id, v_mode, v_shift in
    update shift_offers
       set status = 'lapsed', closed_reason = 'expired', closed_at = p_now
     where status = 'open' and expires_at <= p_now
    returning id, mode, shift_id
  loop
    v_n := v_n + 1;
    select sr.starts_at into v_start from shift_requirements sr where sr.id = v_shift;
    -- OF3 is for an offer that went to other workers and found nobody. A
    -- cover request the office never opened lapses at the start silently:
    -- nobody was ever asked, and the office already had it (OF5). And once
    -- the section has started "you're still booked" tells nobody anything
    -- — the worker is on shift or a no-show, and the escalation job owns
    -- the section.
    if v_mode <> 'office' and p_now < v_start then
      perform queue_offer_notice('OF3', v_id);
    end if;
  end loop;
  return v_n;
end $$;

comment on function public.lapse_shift_offers(timestamptz) is
  'ADR-0046: closes every open offer past its expiry (open → lapsed, closed_reason expired) and queues OF3 — "you''re still booked" — for each that had gone to other workers, unless the section has already started. The worker stays confirmed. Service role; the auto-staffing hourly run calls it first.';

-- ---------------------------------------------------------------------
-- Grants, as 20260930201100 set them.
-- ---------------------------------------------------------------------
revoke execute on function public.offer_shift(uuid)                    from public, anon;
revoke execute on function public.withdraw_shift_offer(uuid)           from public, anon;
revoke execute on function public.request_cover(uuid, text)            from public, anon;
revoke execute on function public.take_offered_shift(uuid)             from public, anon;
revoke execute on function public.office_decline_cover(uuid, text)     from public, anon;
grant  execute on function public.offer_shift(uuid)                    to authenticated;
grant  execute on function public.withdraw_shift_offer(uuid)           to authenticated;
grant  execute on function public.request_cover(uuid, text)            to authenticated;
grant  execute on function public.take_offered_shift(uuid)             to authenticated;
grant  execute on function public.office_decline_cover(uuid, text)     to authenticated;

revoke execute on function public.lapse_shift_offers(timestamptz)      from public, anon, authenticated;
revoke execute on function public.offer_wave1_exhausted(uuid)          from public, anon, authenticated;
grant  execute on function public.lapse_shift_offers(timestamptz)      to service_role;
grant  execute on function public.offer_wave1_exhausted(uuid)          to service_role;

revoke execute on function public.queue_offer_notice(text, uuid, uuid) from public, anon, authenticated;
