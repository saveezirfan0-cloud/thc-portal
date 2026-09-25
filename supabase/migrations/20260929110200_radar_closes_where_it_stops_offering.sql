-- =====================================================================
-- Migration 20260929110200 · Radar stops offering, and applications close
--                            with N10c, at ONE threshold (§3.3, §8 N10c,
--                            §10.4; audit 25.09 D39)
--
-- Two numbers disagreed:
--   * staff_open_shifts() offered a section while confirmed < HEADCOUNT,
--     and apply_to_shift() answered `full` at headcount ("seats, not the
--     invitation target" — 20260922140000);
--   * close_filled_role_applications() closed the pending applications
--     and queued N10c only at confirmed >= headcount + BUFFER.
-- Between the two (headcount <= confirmed < headcount + buffer) the
-- worker's "Applied" card vanished from Radar — the section no longer
-- passed the filter — while the application stayed `applied` and no N10c
-- came. §10.4: "Once applied, the card does not disappear … until it
-- resolves one way or the other (moves to Shifts once confirmed, or
-- leaves Radar once closed) — either way the worker gets a push".
--
-- One threshold: HEADCOUNT, the one Radar already used and the one the
-- board's "K open of H" counts against (openSlots). §8 N10c fires "the
-- moment the role becomes fully confirmed and drops off the event board";
-- the board reads the role as having no open slot at confirmed =
-- headcount. So:
--   * close_filled_role_applications() closes and queues N10c at
--     confirmed (or checked in) >= headcount;
--   * accept_application() refuses `full` at the same point, closing what
--     is still pending, as it did at the old one;
--   * staff_open_shifts() keeps a worker's OWN pending application on
--     Radar until it resolves, whatever the fill, gate or wave does in
--     between — up to the section's end (RULE-16: a stale application
--     leaves Radar once the shift is over, and accept_application refuses
--     it from then too).
-- The buffer is still filled — by invitations (auto-assign and the
-- office) — and a closed applicant can still be invited by hand
-- (booking_reopenable_by: slot_taken is `anyone`). ADR-0031.
--
-- Radar also offers a section again to a worker whose earlier row on it
-- ended in a way the worker may reopen (20260929110100), not only a
-- `closed` one; a self-cancel is still gated `self_cancelled` and never
-- offered.
--
-- Bodies from 20260925100000 (close_filled_role_applications,
-- accept_application) and 20260922140000 (staff_open_shifts).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · Close at headcount
-- ---------------------------------------------------------------------
create or replace function public.close_filled_role_applications(p_shift uuid)
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_fill   record;
  v_closed int := 0;
  r        record;
begin
  select * into v_fill from shift_fill(p_shift);
  -- The point Radar stops offering the section (staff_open_shifts,
  -- apply_to_shift): no seat left against headcount.
  if v_fill.headcount is null or v_fill.confirmed < v_fill.headcount then
    return 0;
  end if;

  for r in
    update bookings
       set status = 'closed', cancelled_at = now(), cancel_cause = 'slot_taken'
     where shift_id = p_shift and status = 'applied'
    returning id
  loop
    perform queue_application_push('N10c', r.id);
    v_closed := v_closed + 1;
  end loop;
  return v_closed;
end $$;

comment on function public.close_filled_role_applications(uuid) is
  '§8 N10c: once a role section has no seat left (confirmed-or-worked >= headcount — the point Radar stops offering it, 20260929110200), every still-pending Radar application on it closes (closed / slot_taken) and its worker gets N10c. Called by accept_application and accept_invite after they confirm.';

-- ---------------------------------------------------------------------
-- 2 · accept_application: `full` at the same threshold
-- ---------------------------------------------------------------------
create or replace function public.accept_application(p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_shift     uuid;
  b           bookings;
  sr          shift_requirements;
  ev          events;
  v_gate      text;
  v_fill      record;
  v_withdrawn int := 0;
  v_closed    int := 0;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select shift_id into v_shift from bookings where id = p_booking;
  if v_shift is null then raise exception 'booking_not_found' using errcode = 'P0002'; end if;

  select * into sr from shift_requirements where id = v_shift for update;
  select * into b from bookings where id = p_booking for update;
  select * into ev from events where id = sr.event_id;

  if ev.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'event_cancelled');
  end if;
  if b.status <> 'applied' then
    return jsonb_build_object('ok', false, 'reason', 'not_applied', 'status', b.status::text);
  end if;
  -- RULE-16: a stale application is off the board already.
  if now() >= sr.ends_at then
    return jsonb_build_object('ok', false, 'reason', 'event_ended');
  end if;

  -- One threshold with Radar and N10c (20260929110200): an application
  -- is for a seat, and there is none left at confirmed >= headcount.
  select * into v_fill from shift_fill(sr.id);
  if v_fill.confirmed >= v_fill.headcount then
    v_closed := close_filled_role_applications(sr.id);
    return jsonb_build_object('ok', false, 'reason', 'full', 'closedApplications', v_closed);
  end if;

  select c.gate into v_gate from auto_assign_candidates(sr.id) c where c.staff_id = b.staff_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_bookable');
  end if;
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'reason', v_gate);
  end if;

  update bookings
     set status = 'confirmed', confirmed_at = now(), cancelled_at = null, cancel_cause = null
   where id = b.id;

  with overlapping as (
    update bookings o set status = 'cancelled', cancelled_at = now(),
                          cancel_cause = 'overlap_auto_withdraw'
      from shift_requirements sr3
     where sr3.id = o.shift_id
       and o.staff_id = b.staff_id and o.status = 'invited' and o.id <> b.id
       and sr.starts_at < sr3.ends_at and sr3.starts_at < sr.ends_at
    returning o.id
  ) select count(*)::int into v_withdrawn from overlapping;

  perform queue_application_push('N10', b.id);
  v_closed := close_filled_role_applications(sr.id);

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'booking.application_accepted', 'booking', b.id,
          jsonb_build_object('staffId', b.staff_id, 'shiftId', sr.id,
                             'withdrawn', v_withdrawn, 'closedApplications', v_closed));

  return jsonb_build_object('ok', true, 'withdrawn', v_withdrawn, 'closedApplications', v_closed);
end $$;

comment on function public.accept_application(uuid) is
  'The office takes a Radar application forward (§3.3, §10.4): applied → confirmed, admin only. Refusals: event_cancelled / not_applied / event_ended / full (confirmed-or-worked >= headcount, the Radar/N10c threshold, 20260929110200) / not_bookable / the auto-assign hard gates by name. Queues N10, withdraws the worker''s overlapping invitations and, once the role has no seat left, closes the other applications with N10c.';

-- ---------------------------------------------------------------------
-- 3 · staff_open_shifts: the worker's own application stays until it
--     resolves
-- ---------------------------------------------------------------------
create or replace function public.staff_open_shifts(p_staff uuid default null)
returns table (
  shift_id        uuid,
  event_id        uuid,
  event_title     text,
  event_date      date,
  role            text,
  starts_at       timestamptz,
  ends_at         timestamptz,
  pay_rate        numeric,
  dress_code      text,
  venue_name      text,
  venue_address   text,
  distance_km     numeric,
  headcount       int,
  buffer          int,
  confirmed_count int,
  qualified       boolean,
  hours_limit     boolean,
  applied_at      timestamptz,
  week_start      date,
  booked_hours    numeric,
  cap_hours       numeric
) language sql stable security definer
set search_path = public, extensions as $$
  with me as (select staff_caller(p_staff) as id)
  select
    sr.id, ev.id, ev.title, ev.event_date, r.name, sr.starts_at, sr.ends_at,
    sr.pay_rate, sr.dress_code, ev.venue_name, ev.venue_address,
    round((st_distance(s.home_location, ev.venue_location) / 1000.0)::numeric, 1),
    sr.headcount, sr.buffer, f.confirmed,
    coalesce(c.my_qualified, false),
    coalesce(c.my_gate = 'hours_limit', false),
    mine.applied_at,
    cap_week_start((sr.starts_at at time zone 'Europe/London')::date),
    weekly_booked_hours(me.id, (sr.starts_at at time zone 'Europe/London')::date),
    weekly_cap_hours(me.id, (sr.starts_at at time zone 'Europe/London')::date)
  from me
    join staff s               on s.id = me.id
    -- Not started — or started but not over with this worker's own
    -- application still pending on it (RULE-16 takes it off at the end).
    join shift_requirements sr on sr.ends_at > now()
                              and (sr.starts_at > now()
                                   or exists (select 1 from bookings o
                                               where o.shift_id = sr.id and o.staff_id = me.id
                                                 and o.status = 'applied'))
    join events ev            on ev.id = sr.event_id and ev.cancelled_at is null
    join roles r               on r.id = sr.role_id
    -- This worker's own pending application on the section, if any.
    left join lateral (
      select o.applied_at from bookings o
       where o.shift_id = sr.id and o.staff_id = me.id and o.status = 'applied'
    ) mine on true
    cross join lateral shift_fill(sr.id) f
    cross join lateral (
      select
        count(*) filter (where a.staff_id = me.id) > 0         as me_present,
        min(a.gate)           filter (where a.staff_id = me.id) as my_gate,
        bool_or(a.qualified)  filter (where a.staff_id = me.id) as my_qualified,
        min(a.booking_status) filter (where a.staff_id = me.id) as my_status,
        min(a.booking_cause)  filter (where a.staff_id = me.id) as my_cause,
        bool_or(a.gate is null and a.qualified and a.booking_status is null) as wave1_alive
      from auto_assign_candidates(sr.id) a
    ) c
  where
    -- §10.4: an applied card stays "until it resolves one way or the
    -- other" — confirmed (then it is on My shifts), closed with N10c at
    -- the fill, withdrawn, or the section ending (RULE-16).
    mine.applied_at is not null
    or (
          sr.starts_at > now()
      -- One threshold with apply_to_shift and close_filled_role_applications.
      and f.confirmed < sr.headcount
      and c.me_present
      and (c.my_gate is null or c.my_gate = 'hours_limit')
      and (c.my_qualified or not c.wave1_alive)
      -- Already invited or confirmed here: that lives on Invites or My
      -- shifts. An ended row the worker may reopen by applying is offered
      -- again (20260929110100); one they may not is not.
      and (c.my_status is null
           or booking_reopenable_by(c.my_status::booking_status, c.my_cause) in ('anyone', 'person'))
    )
  order by coalesce(c.my_qualified, false) desc,
           round((st_distance(s.home_location, ev.venue_location) / 1000.0)::numeric, 1),
           sr.starts_at
$$;

comment on function public.staff_open_shifts(uuid) is
  'Radar and the Shifts tab''s Open shifts (§10.4): open sections (confirmed-or-worked < headcount) for the worker''s own roles, qualified clients first (RULE-17), closest first, with the RULE-20 cap state per row. The worker''s own pending application stays listed until it resolves or the section ends (20260929110200).';
