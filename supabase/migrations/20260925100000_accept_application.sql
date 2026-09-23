-- =====================================================================
-- Taking a Radar application forward (Scope §3.3, §10.4, §8 N10 / N10c)
-- and `accept_invite` naming an expired right to work — docs/14 §4.
--
-- 1 · accept_application(p_booking)
--     `applied → confirmed` has been a legal edge since 20260924120000
--     (ADR-0022) but nothing performed it, so the office could not take a
--     Radar application forward. §3.3: the manager picks the applicant
--     "manually from the Potential pool"; N10 goes to the worker "on the
--     booking's transition to Confirmed for a Radar self-application".
--
--     Admin only. The same gates as accept_invite and invite_worker, in
--     the same words, read at the moment of the press with the section
--     row locked (the lock accept_invite and invite_worker take, so the
--     three serialise on the last slot):
--       event_cancelled · event_ended (RULE-16) · not_applied ·
--       not_bookable (removed §1.7 / left §10.6) · the auto-assign hard
--       gates by name — wrong_role, do_not_return, blocked,
--       self_cancelled, booked_elsewhere (only CONFIRMED bookings, the
--       2 h different-venue gap), rtw_expired, hours_limit (RULE-20) ·
--       full (confirmed ≥ headcount + buffer: fill counts only confirmed,
--       the buffer is absolute).
--     The rota guard trigger stays the backstop underneath.
--
--     There is no "Decline application". §10.4 and §8 give an application
--     exactly three ends: taken forward (N10), not taken forward because
--     the role filled (N10c), withdrawn by the worker — plus N12 when the
--     event is cancelled. A manager passing over an applicant is not an
--     event the scope names or notifies (ADR-0023).
--
-- 2 · N10c, the moment a role becomes fully confirmed
--     §8: "the moment the role becomes fully confirmed and drops off the
--     event board (§3.3) — one trigger covers both a manual office pick of
--     someone else and an automatic auto-assign/first-to-confirm fill".
--     close_filled_role_applications() is that one trigger: called by
--     accept_application AND accept_invite after their confirmation, it
--     closes every still-pending application on a section whose confirmed
--     count has reached headcount + buffer (`closed`, cause `slot_taken`
--     — the §3.4 cause for an offer somebody else's confirmation ended,
--     ADR-0022) and queues N10c to each. `closed` keeps §10.4's door open:
--     if the role reopens, the worker can apply again (closed → applied).
--
-- 3 · accept_invite answers `rtw_expired`
--     It asked weekly_cap_would_breach() directly and called everything it
--     caught `hours_limit`, while auto_assign_candidates() (20260924130100)
--     already told the two apart. The same split, the same test the rota
--     guard makes: the shift's start AND end UK day must be inside the
--     right to work. Otherwise byte-for-byte 20260922160000.
--
-- Forward-only; nothing here edits an earlier migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The two Radar pushes carry {event} and {date} (§8 N10, N10c).
-- queue_booking_push() writes `window` but no date, so the register's
-- "{date}" would reach the worker literally.
--
-- N10c is keyed per APPLICATION, not per booking row: a closed row can be
-- applied for again (§10.4) and close again, and the second close is a new
-- message. The variant is the application's own timestamp, so a repeated
-- call for the same application is still a no-op.
-- ---------------------------------------------------------------------
create or replace function public.queue_application_push(p_code text, p_booking uuid)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
  select case when p_code = 'N10c'
              then p_code || ':booking:' || b.id::text || ':'
                   || coalesce(floor(extract(epoch from b.applied_at))::bigint::text, '0')
              else p_code || ':booking:' || b.id::text end,
         'push', p_code, b.staff_id,
         jsonb_build_object('bookingId', b.id, 'shiftId', sr.id, 'eventId', ev.id,
                            'event', ev.title,
                            'date', to_char(sr.starts_at at time zone 'Europe/London', 'DD Mon YYYY'),
                            'window', to_char(sr.starts_at at time zone 'Europe/London', 'HH24:MI')
                                      || '–' || to_char(sr.ends_at at time zone 'Europe/London', 'HH24:MI'))
    from bookings b
    join shift_requirements sr on sr.id = b.shift_id
    join events ev on ev.id = sr.event_id
   where b.id = p_booking
      and p_code in ('N10', 'N10c')
  on conflict (key) do nothing
$$;

comment on function public.queue_application_push(text, uuid) is
  'Queues N10 (application accepted) or N10c (role filled without it) for one Radar application, with the {event} and {date} values the §8 register renders. N10c is keyed per application (applied_at), so a re-application that closes again is told again.';

-- ---------------------------------------------------------------------
-- N10c: a section that has just become fully confirmed closes its
-- pending applications. Returns how many it closed.
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
  if v_fill.target is null or v_fill.confirmed < v_fill.target then
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
  '§8 N10c: once a role section is fully confirmed (confirmed ≥ headcount + buffer), every still-pending Radar application on it closes (closed / slot_taken) and its worker gets N10c. Called by accept_application and accept_invite after they confirm — the one trigger for a manual pick and a first-to-confirm fill alike.';

-- ---------------------------------------------------------------------
-- 1 · The office takes an application forward.
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
  -- Admin only, with no service-role door: the office presses this, and
  -- `auth.uid() is not null` is the predicate that once let anon past
  -- invite_worker (20260921162758).
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select shift_id into v_shift from bookings where id = p_booking;
  if v_shift is null then raise exception 'booking_not_found' using errcode = 'P0002'; end if;

  -- The section first, as accept_invite and invite_worker lock it: all
  -- three then queue on the same row for the last slot.
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

  -- Fill counts ONLY confirmed; the buffer is absolute (target =
  -- headcount + buffer). A full role should already have closed this
  -- application; if it had not (a fill before 20260925100000), it is
  -- closed now with N10c — exactly what §8 says happens at the fill.
  select * into v_fill from shift_fill(sr.id);
  if v_fill.confirmed >= v_fill.target then
    v_closed := close_filled_role_applications(sr.id);
    return jsonb_build_object('ok', false, 'reason', 'full', 'closedApplications', v_closed);
  end if;

  -- The §3.3/§3.4 hard gates, by the names the board already shows.
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

  -- §3.4: confirming a shift removes the worker's other overlapping open
  -- invitations, however it was confirmed.
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
  'The office takes a Radar application forward (§3.3, §10.4): applied → confirmed, admin only. Refusals: event_cancelled / not_applied / event_ended / full / not_bookable / the auto-assign hard gates by name (incl. booked_elsewhere, rtw_expired, hours_limit). Queues N10, withdraws the worker''s overlapping invitations and, if the role is now fully confirmed, closes the other applications with N10c (20260925100000).';

-- ---------------------------------------------------------------------
-- 3 · accept_invite: rtw_expired, and the N10c fill.
-- ---------------------------------------------------------------------
create or replace function accept_invite(p_booking uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  b           bookings;
  sr          shift_requirements;
  ev          events;
  v_fill      record;
  v_gap       int := booked_elsewhere_gap_minutes();
  v_withdrawn int := 0;
  v_closed    int := 0;
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
  -- The right-to-work stop shares the gate but not the label: a worker
  -- past their right to work is not over their hours (20260924130100).
  if weekly_cap_would_breach(b.staff_id, b.shift_id) then
    if not (can_roster_staff(b.staff_id, (sr.starts_at at time zone 'Europe/London')::date)
            and can_roster_staff(b.staff_id, ((sr.ends_at - interval '1 second')
                                              at time zone 'Europe/London')::date)) then
      return jsonb_build_object('ok', false, 'reason', 'rtw_expired');
    end if;
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

  -- §8 N10c: a first-to-confirm fill closes the pending applications too.
  v_closed := close_filled_role_applications(sr.id);

  return jsonb_build_object('ok', true, 'withdrawn', v_withdrawn, 'closedApplications', v_closed);
end $$;

comment on function accept_invite(uuid) is
  'First-to-confirm (§3.4): event_ended / taken / overlap / rtw_expired / hours_limit / ok. Re-checks RULE-16, the slot, the booked-elsewhere gap, the right to work and the RULE-20 weekly cap; withdraws the worker''s other intersecting invitations; closes the role''s pending applications with N10c once it is fully confirmed (20260925100000).';

-- ---------------------------------------------------------------------
-- Grants. Postgres grants EXECUTE to PUBLIC and Supabase's defaults grant
-- anon and authenticated by name, so each is revoked by name (docs/14 O7).
-- ---------------------------------------------------------------------
revoke execute on function public.queue_application_push(text, uuid) from public, anon, authenticated;
revoke execute on function public.close_filled_role_applications(uuid) from public, anon, authenticated;
grant execute on function public.queue_application_push(text, uuid) to service_role;
grant execute on function public.close_filled_role_applications(uuid) to service_role;

revoke execute on function public.accept_application(uuid) from public, anon;
grant execute on function public.accept_application(uuid) to authenticated;
