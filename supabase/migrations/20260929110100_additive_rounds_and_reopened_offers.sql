-- =====================================================================
-- Migration 20260929110100 · additive rounds that keep adding, offers
--                            that can be made again (§3.4, §3.6, §10.4;
--                            audit 25.09 D3, D33, D9)
--
-- D3 · the additive rounds stalled.
--   invite_worker() refused `target_met` once confirmed + INVITED reached
--   headcount + buffer. Round 1 invites `allocation` (default headcount +
--   buffer), so if nobody answered, every later round invited nobody and
--   the section sat on unanswered invitations until the start. §3.4:
--   "it adds allocation invites every hour … earlier invitations stay open
--   (they are not pulled or rejected); it keeps adding until headcount +
--   buffer is filled". Filled is CONFIRMED (§3.2/§3.3: invitations fill
--   nothing). The gate is now confirmed (confirmed-or-worked, see
--   20260929110000) < target, and nothing else: the hourly round adds
--   `allocation` more each hour while the section is short, and stops the
--   moment it is filled. The escalation still passes p_ignore_target.
--
-- D33 · any earlier row barred the worker from the section for good.
--   bookings is unique on (shift_id, staff_id), and invite_worker(),
--   office_invite_worker() (through invite_worker) and apply_to_shift()
--   answered `already_has_booking` for ANY existing row — a declined
--   invitation, an office withdrawal, a slot somebody else took. §3.6
--   reserves permanent exclusion for one trigger only: "Unlike the other
--   cancelled triggers above, self-cancel permanently excludes the worker
--   from that specific event". The row is now REOPENED (UPDATEd back to
--   invited / applied) rather than a second one inserted, and who may
--   reopen it depends on how it ended — booking_reopenable_by():
--
--     never    self_cancel (RULE-04) · event_cancelled · gdpr, gdpr_invite
--     anyone   closed/slot_taken — somebody else confirmed first
--              cancelled/overlap_auto_withdraw — they accepted a clashing
--                shift (booked_elsewhere gates them while that stands)
--              cancelled/blocked, blocked_invite, left, left_invite —
--                released by a cascade; the gates decide whether they are
--                bookable again
--     person   closed/declined, closed/withdrawn_by_worker — the worker's
--                own "no"
--              cancelled/office_withdraw — the office's own decision
--              cancelled/ready_cutoff — released at 12:05 for no "I'm
--                ready" (§3.5)
--
--   `person` rows are reopened by a PERSON only: the office's manual
--   invite ("the manager can always invite them by hand at any point",
--   §3.4) and the worker's own Radar application. An automatic round
--   reopens `anyone` rows only, because a round re-inviting a worker an
--   hour after they declined — or re-inviting at 12:05 the worker the
--   12:05 cutoff has just released — would be the machine arguing with a
--   decision a person made. ADR-0031.
--
--   A row that carries check-in history, a break or a violation is never
--   reopened: those belong to the booking that ended.
--
--   A reopened invitation is a new offer, so it gets its own N5: the N5
--   key is `N5:booking:<id>` and would otherwise dedupe against the first
--   one. booking_push_payload() is the N5 payload queue_booking_push()
--   writes (20260927160500), so the two cannot differ (pgTAP 616 holds
--   them equal).
--
--   The state machine gains the three edges a reopen takes:
--   cancelled → invited, cancelled → applied, closed → invited (closed →
--   applied existed). bookings_self_cancel_is_final makes the RULE-04 half
--   a database fact: a self-cancelled row can never leave `cancelled`.
--
-- D9 (nit) · invite_worker() now refuses an `auto` or `escalation`
--   invitation when either auto-assign switch is off at the moment of the
--   insert (`auto_assign_off`). auto_assign_due_shifts() reads the
--   switches when the round starts; a switch turned off mid-round now
--   takes effect at the next insert, not the next round (§3.4 "it can be
--   turned off at event or role level").
--
-- apply_to_shift() also refuses a caller with no candidate row
-- (`not_bookable`): since 20260929110000 a candidate or rejected
-- applicant has none, and an absent row must not read as "no gate".
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The three reopen edges (ADR-0022 → ADR-0031)
-- ---------------------------------------------------------------------
create or replace function public.booking_transitions()
returns table (from_status booking_status, to_status booking_status)
language sql
immutable
set search_path = public, extensions
as $$
  select f::booking_status, t::booking_status
    from (values
      ('invited',   'confirmed'),   -- §3.6 Accept
      ('invited',   'cancelled'),   -- §3.6 Withdraw/GDPR, §3.4 overlap, §4.3 cascade, §3.3
      ('invited',   'closed'),      -- §3.4 slot taken, §10.4 Decline
      ('applied',   'confirmed'),   -- §10.4 / N10 application taken forward
      ('applied',   'cancelled'),   -- §3.3 event cancelled, §4.3·§10.6·§1.7 cascade
      ('applied',   'closed'),      -- §10.4 withdrawn by the worker, N10c role filled
      ('closed',    'applied'),     -- §10.4 apply again on Radar
      ('closed',    'invited'),     -- §3.4 invited again (booking_reopenable_by)
      ('cancelled', 'invited'),     -- §3.6 only self-cancel is permanent: invited again
      ('cancelled', 'applied'),     -- §3.6 likewise: apply again on Radar
      ('confirmed', 'worked'),      -- §3.6 [shift + checklog]
      ('confirmed', 'turned_away'), -- RULE-15 strict buffer turn-away
      ('confirmed', 'cancelled')    -- §3.6 Withdraw/cutoff/GDPR/self-cancel, §3.3, §4.3
    ) as e(f, t)
$$;

comment on function public.booking_transitions() is
  'The §3.6 booking state machine as data: every legal status change. Mirrors BOOKING_TRANSITIONS in packages/domain/src/state.ts; both are held to bookingState.vectors.json (490_booking_state_machine.sql, state.test.ts). cancelled/closed → invited/applied are reopens (20260929110100, ADR-0031); a self-cancelled row never reopens (bookings_self_cancel_is_final).';

-- RULE-04 as a constraint: whatever else reopens, a self-cancel does not.
-- NOT VALID so the migration never stops on history; every write from now
-- on is checked.
alter table bookings drop constraint if exists bookings_self_cancel_is_final;
alter table bookings add constraint bookings_self_cancel_is_final
  check (not self_cancelled or status = 'cancelled') not valid;

-- ---------------------------------------------------------------------
-- 2 · Who may reopen an ended row
-- ---------------------------------------------------------------------
create or replace function public.booking_reopenable_by(p_status booking_status, p_cause text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select case
    when p_status = 'closed' then
      case coalesce(p_cause, '')
        when 'slot_taken' then 'anyone'
        else 'person'                     -- declined · withdrawn_by_worker · legacy null
      end
    when p_status = 'cancelled' then
      case coalesce(p_cause, '')
        when 'self_cancel'     then 'never'
        when 'event_cancelled' then 'never'
        when 'gdpr'            then 'never'
        when 'gdpr_invite'     then 'never'
        when 'overlap_auto_withdraw' then 'anyone'
        when 'blocked'         then 'anyone'
        when 'blocked_invite'  then 'anyone'
        when 'left'            then 'anyone'
        when 'left_invite'     then 'anyone'
        else 'person'                     -- office_withdraw · ready_cutoff · legacy null
      end
    else null                             -- a live row: invited, applied, confirmed, worked, turned_away
  end
$$;

comment on function public.booking_reopenable_by(booking_status, text) is
  'Who may reopen an ended booking row on the same section (§3.6, ADR-0031): ''never'' (self_cancel — RULE-04 — event_cancelled, gdpr), ''anyone'' (ended by circumstance: slot_taken, overlap_auto_withdraw, a block/leave cascade — an auto-assign round may re-invite), ''person'' (ended by a decision: declined, withdrawn_by_worker, office_withdraw, ready_cutoff — only the office''s manual invite or the worker''s own Radar application reopens it). Null for a live row. Mirrors bookingReopenableBy() in packages/domain/src/state.ts.';

revoke execute on function public.booking_reopenable_by(booking_status, text) from public, anon;
grant execute on function public.booking_reopenable_by(booking_status, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3 · The N5 payload, once
--
-- queue_booking_push() (20260927160500) builds the same object inline;
-- 616 holds the two equal for the same booking.
-- ---------------------------------------------------------------------
create or replace function public.booking_push_payload(p_booking uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object('bookingId', b.id, 'shiftId', sr.id, 'eventId', ev.id,
                            'invitationId', b.id, 'event', ev.title,
                            'role', r.name,
                            'date', to_char(sr.starts_at at time zone 'Europe/London', 'FMDay DD Mon'),
                            'dateTime', to_char(sr.starts_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI')
                                        || '–' || to_char(sr.ends_at at time zone 'Europe/London', 'HH24:MI'),
                            'rate', '£' || to_char(sr.pay_rate, 'FM990.00'),
                            'window', to_char(sr.starts_at at time zone 'Europe/London', 'HH24:MI')
                                      || '–' || to_char(sr.ends_at at time zone 'Europe/London', 'HH24:MI'))
  from bookings b
    join shift_requirements sr on sr.id = b.shift_id
    join events ev on ev.id = sr.event_id
    join roles r on r.id = sr.role_id
  where b.id = p_booking
$$;

comment on function public.booking_push_payload(uuid) is
  'The N5 values for one booking — exactly what queue_booking_push() writes (20260927160500): role, event, date, dateTime (Europe/London), the BASE rate, window. Used where an N5 needs its own key: a reopened invitation (20260929110100).';

revoke execute on function public.booking_push_payload(uuid) from public, anon, authenticated;
grant execute on function public.booking_push_payload(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 4 · invite_worker: confirmed < target only; reopen; switches at insert
--
-- From 20260927140100 but for the three marked changes.
-- ---------------------------------------------------------------------
create or replace function public.invite_worker(
  p_shift uuid, p_staff uuid,
  p_source booking_source default 'auto',
  -- Escalation only (§3.4): once the shift is under way the job invites
  -- "ignoring the event's original headcount + buffer cap". Never set by
  -- the hourly round, which is what keeps the cap meaningful before start.
  p_ignore_target boolean default false
)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  sr        shift_requirements;
  ev        events;
  v_gate    text;
  v_fill    record;
  v_booking uuid;
  v_old     bookings;
  v_reopen  text;
begin
  if current_app_role() is distinct from 'admin' and auth.uid() is not null then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  -- Lock the section: the fill check below and the insert must not race
  -- another round, or two workers take the last slot of the target.
  select * into sr from shift_requirements where id = p_shift for update;
  if sr.id is null then raise exception 'shift_not_found' using errcode = 'P0002'; end if;
  select * into ev from events where id = sr.event_id;
  if ev.cancelled_at is not null then
    return jsonb_build_object('invited', false, 'reason', 'event_cancelled');
  end if;

  -- D9: the switches are read at the insert, not only when the round
  -- began. A manager's manual invitation is not auto-assign and is never
  -- held to them (§3.4 "for example when the client asks for a specific
  -- person").
  if p_source in ('auto', 'escalation') and not (ev.auto_assign and sr.auto_assign) then
    return jsonb_build_object('invited', false, 'reason', 'auto_assign_off');
  end if;

  -- Gates before "do they already have one", so the REASON is the useful
  -- one (RULE-04 shows as self_cancelled, not as a bookkeeping detail).
  -- An escalation invitation is judged against the escalation pool.
  select gate into v_gate
    from auto_assign_candidates(p_shift, p_source = 'escalation')
   where staff_id = p_staff;
  -- No row: removed (§1.7), left (§10.6), or not a worker at all — a
  -- candidate or rejected applicant (20260929110000).
  if not found then
    return jsonb_build_object('invited', false, 'reason', 'not_bookable');
  end if;
  if v_gate is not null then
    return jsonb_build_object('invited', false, 'reason', v_gate);
  end if;

  -- D33: an ended row is reopened when booking_reopenable_by() lets this
  -- source do it; a live row, a self-cancel, or a decision an automatic
  -- round must not overturn is still `already_has_booking`.
  select * into v_old from bookings where shift_id = p_shift and staff_id = p_staff for update;
  if v_old.id is not null then
    v_reopen := booking_reopenable_by(v_old.status, v_old.cancel_cause);
    if v_reopen is null
       or v_reopen = 'never'
       or v_old.self_cancelled
       or (v_reopen = 'person' and p_source not in ('manual'))
       or exists (select 1 from check_logs where booking_id = v_old.id)
       or exists (select 1 from breaks where booking_id = v_old.id)
       or exists (select 1 from violations where booking_id = v_old.id) then
      return jsonb_build_object('invited', false, 'reason', 'already_has_booking');
    end if;
  end if;

  -- D3: additive up to CONFIRMED (confirmed-or-worked) = headcount +
  -- buffer. Open invitations do not count: they fill nothing, and §3.4
  -- keeps adding until the target is filled.
  select * into v_fill from shift_fill(p_shift);
  if not p_ignore_target and v_fill.confirmed >= v_fill.target then
    return jsonb_build_object('invited', false, 'reason', 'target_met');
  end if;

  if v_old.id is not null then
    -- A reopened offer is a new one: every stamp of the old booking goes.
    update bookings
       set status = 'invited', source = p_source, created_at = now(),
           confirmed_at = null, day_before_confirmed_at = null, on_day_confirmed_at = null,
           reconfirm_required = false, reconfirm_reason = null,
           cancelled_at = null, cancel_cause = null, applied_at = null
     where id = v_old.id
    returning id into v_booking;

    -- Its own N5: `N5:booking:<id>` is already taken by the first offer.
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select 'N5:booking:' || v_booking::text || ':'
             || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text,
           'push', 'N5', p_staff, booking_push_payload(v_booking)
    on conflict (key) do nothing;

    return jsonb_build_object('invited', true, 'bookingId', v_booking, 'reopened', true);
  end if;

  insert into bookings (shift_id, staff_id, status, source)
  values (p_shift, p_staff, 'invited', p_source)
  returning id into v_booking;

  perform queue_booking_push('N5', v_booking);
  return jsonb_build_object('invited', true, 'bookingId', v_booking);
end $$;

comment on function public.invite_worker(uuid, uuid, booking_source, boolean) is
  'Writes one invitation, re-applying every §3.3/§3.4 gate at the insert (the §3.4 radius too for p_source = escalation). Refuses: event_cancelled · auto_assign_off (an auto/escalation invitation with either switch off, D9) · not_bookable (no candidate row: removed, left, or not a worker) · the gate by name · already_has_booking (a live row, a self-cancel, or an ended row this source may not reopen — booking_reopenable_by) · target_met (confirmed-or-worked >= headcount + buffer; open invitations never count, D3). Reopens an ended row instead of inserting, with its own N5 (20260929110100).';

-- ---------------------------------------------------------------------
-- 5 · apply_to_shift: reopen; no candidate row is not_bookable
--
-- From 20260927161100 but for the marked changes.
-- ---------------------------------------------------------------------
create or replace function public.apply_to_shift(p_shift uuid, p_staff uuid default null)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_me     uuid := case when p_staff is not null and current_app_role() = 'admin'
                        -- §3.3: the office lodges an application from the event
                        -- board on a worker's behalf (20260927100000); the row
                        -- still lands as applied, never confirmed.
                        then p_staff else staff_writer(p_staff) end;
  sr       shift_requirements;
  ev       events;
  v_gate   text;
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

  select gate into v_gate from auto_assign_candidates(p_shift) where staff_id = v_me;
  -- No candidate row: not a worker (a candidate, a rejected applicant),
  -- left or removed. It must not read as "no gate applies".
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_bookable');
  end if;
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'reason', v_gate);
  end if;

  -- The live re-check. Seats: Radar offers a shift while confirmed (or
  -- checked in) < headcount, and applications close at the same point
  -- (close_filled_role_applications, 20260929110200).
  select * into v_fill from shift_fill(p_shift);
  if v_fill.confirmed >= sr.headcount then
    return jsonb_build_object('ok', false, 'reason', 'full');
  end if;

  -- A live booking blocks a second one. An ended one is reopened unless
  -- it is a self-cancel (RULE-04), an event cancellation or a GDPR
  -- removal: §3.6 reserves the permanent bar for self-cancel, and §10.4
  -- tells the worker "You can still apply for this shift on Radar later if
  -- it's open" (D33, 20260929110100).
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
end $$;

comment on function public.apply_to_shift(uuid, uuid) is
  '§10.4 Radar self-application. The caller''s OWN row (staff_writer), or a worker named by the office from the event board (§3.3). Refuses event_cancelled · shift_started · not_bookable (no candidate row) · the gate by name · full (confirmed-or-worked >= headcount) · already_has_booking (a live row, or a self-cancel / event-cancelled / GDPR row). Any other ended row is reopened as applied (20260929110100).';
