-- ADR-0150 · A client's quiz comes BEFORE the confirmation (amends ADR-0110)
--
-- Leonardo Hotel St Paul's M&E (18.10.2026): a worker on Bar Staff or Wine
-- Waiting Service was getting confirmed on a shift without having taken the
-- quiz, because ADR-0110 asked for it only AFTER the booking was confirmed.
-- It is now compulsory: a worker cannot confirm themselves onto such a shift,
-- or put themselves forward for one, until they have passed.
--
--   · client_quiz_gate(shift, worker) -> the quiz still to pass, or null.
--   · accept_invite, take_offered_shift (Radar offers), apply_to_shift and
--     accept_application return reason 'quiz_required' (with quizId) at that
--     point. Invitations are NOT withdrawn: the worker sits the quiz and
--     accepts. The office can still invite (an invitation is not a
--     confirmation) and nothing already confirmed is touched.
--   · A worker who holds a role that names a quiz may open and sit it before
--     they have any booking, or Radar and Apply would turn them away with no
--     way to the quiz (client_quiz_required_for).
--
-- Not a bookings trigger and not a pool gate (auto_assign_candidates_pool):
-- an invitation has to reach the worker for them to be asked, and fixtures
-- and the office's own tools write confirmed bookings directly.

-- ---------------------------------------------------------------------
-- 1 · The gate
-- ---------------------------------------------------------------------
create or replace function public.client_quiz_gate(p_shift uuid, p_staff uuid)
returns uuid
language sql
stable
set search_path = public, extensions
as $$
  select q.id
    from shift_requirements s
    join events e on e.id = s.event_id
    join client_role_requirements r on r.client_id = e.client_id and r.role_id = s.role_id
    join client_quizzes q on q.id = r.quiz_id and q.active
   where s.id = p_shift
     and not client_quiz_passed(q.id, p_staff)
   limit 1
$$;
comment on function public.client_quiz_gate(uuid, uuid) is
  'ADR-0150: the active quiz this shift''s (client, role) names that the worker has not passed, or null. Read by every path that confirms a worker or lets them put themselves forward.';
-- Internal: the four definer functions below call it, so no signed-in caller
-- needs to, and none can read another worker's standing through it.
revoke execute on function public.client_quiz_gate(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2 · Who may open and sit a quiz: a live booking names it (ADR-0110), or
--     the worker holds a role that names it (ADR-0150).
-- ---------------------------------------------------------------------
create or replace function public.client_quiz_required_for(p_quiz uuid, p_staff uuid)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select exists (
    select 1
      from bookings b
      join shift_requirements s on s.id = b.shift_id
      join events e on e.id = s.event_id
      join client_role_requirements r on r.client_id = e.client_id and r.role_id = s.role_id
     where b.staff_id = p_staff
       and r.quiz_id = p_quiz
       and b.cancelled_at is null
       and e.cancelled_at is null
       and b.status in ('invited', 'confirmed', 'worked'))
  or exists (
    select 1
      from client_role_requirements r
      join staff_roles sr on sr.role_id = r.role_id
     where r.quiz_id = p_quiz
       and sr.staff_id = p_staff)
$$;
revoke execute on function public.client_quiz_required_for(uuid, uuid) from public, anon;

-- ---------------------------------------------------------------------
-- 3 · accept_invite — the quiz before the confirmation
--     (20260930110000's body, plus the gate after the worker gate.)
-- ---------------------------------------------------------------------
create or replace function public.accept_invite(p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  b           bookings;
  sr          shift_requirements;
  ev          events;
  v_fill      record;
  v_gate      text;
  v_quiz      uuid;
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

  -- First-to-confirm (§3.4). shift_fill counts confirmed-or-worked
  -- (20260930110000): a checked-in worker still holds their slot.
  select * into v_fill from shift_fill(b.shift_id);
  if v_fill.confirmed >= v_fill.target then
    update bookings set status = 'closed', cancelled_at = now(), cancel_cause = 'slot_taken'
     where id = b.id;
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end if;

  -- RULE-12, re-read at the moment of Accept (20260928110400) — the same
  -- read accept_application() makes, judged against the escalation pool
  -- for an escalation invitation so the §3.4 radius holds here too. An
  -- absent row is a leaver, a removed account, or — since 20260930110000 —
  -- someone who is not a worker (not_bookable). After the slot check on
  -- purpose: a slot that has gone closes the invitation whoever holds it
  -- (`taken`), and a dead invitation left "live" on a blocked worker's
  -- list is the lingering §3.4 forbids. The two gates the checks below
  -- already answer, with the labels the Staff App shows (overlap;
  -- hours_limit vs rtw_expired), are left to them.
  select c.gate into v_gate from auto_assign_worker_gate(sr.id, b.staff_id, b.source = 'escalation') c;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_bookable');
  end if;
  if v_gate is not null and v_gate not in ('booked_elsewhere', 'hours_limit') then
    return jsonb_build_object('ok', false, 'reason', v_gate);
  end if;

  -- ADR-0150: a client's quiz comes before the confirmation. The invitation
  -- is left live (never withdrawn): the worker sits the quiz, then accepts.
  v_quiz := client_quiz_gate(b.shift_id, b.staff_id);
  if v_quiz is not null then
    return jsonb_build_object('ok', false, 'reason', 'quiz_required', 'quizId', v_quiz);
  end if;

  -- §3.4 safety net: "blocks Accept on a shift that already overlaps a
  -- just-confirmed booking" — and a booking the worker has already
  -- checked in to is at least as confirmed (20260930110000, D2).
  if exists (
    select 1 from bookings o
      join shift_requirements sr2 on sr2.id = o.shift_id
      join events ev2 on ev2.id = sr2.event_id
     where o.staff_id = b.staff_id and o.status in ('confirmed', 'worked')
       and o.shift_id <> b.shift_id
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

-- ---------------------------------------------------------------------
-- 4 · apply_to_shift — a worker cannot put themselves forward unqualified
--     (20260930110100's body, plus the gate after the worker gate.)
-- ---------------------------------------------------------------------
create or replace function public.apply_to_shift(p_shift uuid, p_staff uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
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

  select gate into v_gate from auto_assign_worker_gate(p_shift, v_me);
  -- No candidate row (20260930110100): not a worker (a candidate, a
  -- rejected applicant), left or removed. It must not read as "no gate
  -- applies".
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_bookable');
  end if;
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'reason', v_gate);
  end if;

  -- ADR-0150: a client's quiz comes before the application, as before the
  -- confirmation it asks for.
  v_quiz := client_quiz_gate(p_shift, v_me);
  if v_quiz is not null then
    return jsonb_build_object('ok', false, 'reason', 'quiz_required', 'quizId', v_quiz);
  end if;

  -- The live re-check. Seats, not the invitation target: Radar offers a
  -- shift while confirmed (or checked in) < headcount, and applications
  -- close at the same point (close_filled_role_applications,
  -- 20260930110200).
  select * into v_fill from shift_fill(p_shift);
  if v_fill.confirmed >= sr.headcount then
    return jsonb_build_object('ok', false, 'reason', 'full');
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
end $$;

-- ---------------------------------------------------------------------
-- 5 · accept_application — the office cannot confirm an applicant who has
--     not passed (an application made before this, or on a role that
--     started asking after it).
--     (20260930110200's body, plus the gate after the worker gate.)
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
  v_quiz      uuid;
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

  -- One threshold with Radar and N10c (20260930110200): an application
  -- is for a seat, and there is none left at confirmed >= headcount.
  -- shift_fill counts confirmed-or-worked (20260930110000).
  select * into v_fill from shift_fill(sr.id);
  if v_fill.confirmed >= v_fill.headcount then
    v_closed := close_filled_role_applications(sr.id);
    return jsonb_build_object('ok', false, 'reason', 'full', 'closedApplications', v_closed);
  end if;

  select c.gate into v_gate from auto_assign_worker_gate(sr.id, b.staff_id) c;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_bookable');
  end if;
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'reason', v_gate);
  end if;

  -- ADR-0150: a client's quiz comes before the confirmation. The
  -- application stays; the worker sits the quiz and the office accepts again.
  v_quiz := client_quiz_gate(sr.id, b.staff_id);
  if v_quiz is not null then
    return jsonb_build_object('ok', false, 'reason', 'quiz_required', 'quizId', v_quiz);
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

-- ---------------------------------------------------------------------
-- 6 · take_offered_shift — a Radar hand-over is a confirmation
--     (the live body, plus the gate after the pool gates.)
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
  v_quiz      uuid;
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
  select c.gate, c.qualified into v_gate, v_qualified from auto_assign_worker_gate(sr.id, v_me) c;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_bookable');
  end if;
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'reason',
      case v_gate
        when 'booked_elsewhere' then 'overlap'
        when 'wrong_role' then v_gate
        -- ADR-0079: a gender-only section, by name (20261002107000).
        when 'male_only' then v_gate
        when 'female_only' then v_gate
        when 'gender_not_recorded' then v_gate
        -- ADR-0080: an event that needs another language, by name.
        when 'language_not_spoken' then v_gate
        when 'languages_not_recorded' then v_gate
        when 'do_not_return' then v_gate
        when 'blocked' then v_gate
        when 'self_cancelled' then v_gate
        when 'rtw_expired' then v_gate
        when 'hours_limit' then v_gate when 'not_available_all_days' then v_gate else 'not_bookable'
      end);
  end if;

  -- ADR-0150: a client's quiz comes before the confirmation a take is.
  v_quiz := client_quiz_gate(sr.id, v_me);
  if v_quiz is not null then
    return jsonb_build_object('ok', false, 'reason', 'quiz_required', 'quizId', v_quiz);
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
