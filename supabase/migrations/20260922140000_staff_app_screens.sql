-- =====================================================================
-- The Staff App's three working screens · §10.4
--
-- Shifts (My shifts / Open shifts), Invites and Radar. The engine that
-- fills events landed in 20260921141500_auto_assign; this is the worker's
-- half of it — what they can see and the five things they can press.
--
-- Why functions rather than `staff_*` views
-- -----------------------------------------
-- The Client Portal's data path (ADR-0004) is a view running with its
-- owner's rights, because everything it needs is a plain table read. The
-- worker's screens are not: Radar has to ask the SAME question auto-assign
-- asks — is this worker gated, are they qualified at this client, has the
-- qualified pool been exhausted — and that question already has exactly one
-- implementation, `auto_assign_candidates()`.
--
-- A `stable sql` function called from inside a view body still executes as
-- the CALLER, so `auto_assign_candidates` inside a view would be filtered by
-- the worker's own RLS and would silently see one booking: their own. Every
-- count it computes would be wrong, and wrong quietly. `security definer`
-- functions that check the caller themselves — the pattern accept_invite,
-- mark_ready and self_cancel_booking already use — are what let Radar reuse
-- the engine's rules instead of writing a second copy of them.
--
-- The staff role holds a SELECT policy on `bookings` and nothing else. It
-- must not gain one on shift_requirements, events or staff: those carry the
-- charge rate, the client's margin and every other worker's record.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Who is asking. Admin may look at a worker's screens (for support), a
-- worker only ever at their own, and anyone else at nothing.
-- ---------------------------------------------------------------------
create or replace function staff_caller(p_staff uuid default null)
returns uuid language plpgsql stable security definer
set search_path = public, extensions as $$
declare v_self uuid;
begin
  select id into v_self from staff where user_id = auth.uid();
  if p_staff is null then return v_self; end if;
  if current_app_role() = 'admin' or p_staff = v_self then return p_staff; end if;
  raise exception 'not_your_worker' using errcode = '42501';
end $$;

comment on function staff_caller(uuid) is
  'Resolves the staff row behind the current session (§10.4). Admin may name another worker; a worker may not.';

-- ---------------------------------------------------------------------
-- Every booking the Staff App can put on a screen — Invites, My shifts,
-- Radar's Applied section, and the three static-message cases (§10.4).
--
-- Two field-visibility rules live here rather than in the screen, because
-- a screen that forgets one leaks; a view that never selects the column
-- cannot:
--
--   · on-site contact and the event's notes / specific instructions appear
--     only once the worker has ACCEPTED (§10.4, §3.2). The invite card is
--     explicit that they are withheld — "Shown after you accept".
--   · the break policy likewise: it reaches the worker through the Breaks
--     block on the shift screen (§5.2b), never on an invitation.
--
-- The times are the ROLE SECTION's own start and end, never the event
-- window (RULE-18). An event whose kitchen starts at 07:00 and whose floor
-- starts at 17:00 shows each worker only their own hours, and their
-- check-in, check-out and reminder windows run off those.
--
-- Cancelled and closed rows are returned rather than filtered. Their cards
-- vanish from the lists the moment the push arrives, but §10.4 needs them
-- reachable by id afterwards: a worker who taps a stale push must get the
-- static message screen, not a 404.
-- ---------------------------------------------------------------------
create or replace function staff_bookings(p_staff uuid default null)
returns table (
  booking_id            uuid,
  status                text,
  source                text,
  created_at            timestamptz,
  confirmed_at          timestamptz,
  day_before_confirmed_at timestamptz,
  on_day_confirmed_at   timestamptz,
  reconfirm_required    boolean,
  reconfirm_reason      text,
  applied_at            timestamptz,
  cancelled_at          timestamptz,
  cancel_cause          text,
  shift_id              uuid,
  starts_at             timestamptz,
  ends_at               timestamptz,
  pay_rate              numeric,
  dress_code            text,
  headcount             int,
  buffer                int,
  confirmed_count       int,
  role                  text,
  event_id              uuid,
  event_title           text,
  event_date            date,
  venue_name            text,
  venue_address         text,
  event_cancelled_at    timestamptz,
  distance_km           numeric,
  onsite_contact        text,
  notes                 text,
  pays_breaks           boolean,
  no_checkout_open      boolean
) language sql stable security definer
set search_path = public, extensions as $$
  with me as (select staff_caller(p_staff) as id)
  select
    b.id, b.status::text, b.source::text, b.created_at, b.confirmed_at,
    b.day_before_confirmed_at, b.on_day_confirmed_at,
    b.reconfirm_required, b.reconfirm_reason, b.applied_at,
    b.cancelled_at, b.cancel_cause,
    sr.id, sr.starts_at, sr.ends_at, sr.pay_rate, sr.dress_code,
    sr.headcount, sr.buffer,
    (select count(*) filter (where o.status = 'confirmed')::int
       from bookings o where o.shift_id = sr.id),
    r.name, ev.id, ev.title, ev.event_date, ev.venue_name, ev.venue_address,
    ev.cancelled_at,
    round((st_distance(s.home_location, ev.venue_location) / 1000.0)::numeric, 1),
    -- Withheld until the shift is accepted (§10.4, §3.2, §5.2b).
    case when b.status in ('confirmed', 'worked') then ev.onsite_contact end,
    case when b.status in ('confirmed', 'worked') then ev.notes end,
    case when b.status in ('confirmed', 'worked') then ev.pays_breaks end,
    -- RULE-02: check-out never pressed, 4 hours after the scheduled end.
    -- The booking stays `worked`, so the card does NOT disappear — it shows
    -- the static screen in place of the check-out controls until a manager
    -- resolves the violation (§5.2, §9.5).
    exists (select 1 from violations v
             where v.booking_id = b.id and v.type = 'no_checkout' and not v.resolved)
  from me
    join staff s                on s.id = me.id
    join bookings b             on b.staff_id = me.id
    join shift_requirements sr  on sr.id = b.shift_id
    join events ev              on ev.id = sr.event_id
    join roles r                on r.id = sr.role_id
  order by sr.starts_at
$$;

comment on function staff_bookings(uuid) is
  'Every booking the Staff App renders (§10.4): Invites, My shifts, Radar''s Applied section and the three static-message cases. On-site contact, notes and the break policy are null until the booking is accepted.';

-- ---------------------------------------------------------------------
-- RULE-17, asked of one role section: is Wave 1 done?
--
-- "Shifts at clients they are not qualified at appear only once the
-- qualified pool for that role has been exhausted." Exhausted means nobody
-- qualified at this client AND this role is left who could still be
-- invited — ungated, and not already holding a booking here. Self-apply
-- cannot bypass the priority the invitations enforce.
--
-- Read straight off auto_assign_candidates so Radar and the engine cannot
-- disagree about who counts as qualified or who counts as gated.
-- ---------------------------------------------------------------------
create or replace function radar_wave1_exhausted(p_shift uuid)
returns boolean language sql stable security definer
set search_path = public, extensions as $$
  select not exists (
    select 1 from auto_assign_candidates(p_shift) c
     where c.gate is null and c.qualified and c.booking_status is null
  )
$$;

comment on function radar_wave1_exhausted(uuid) is
  'RULE-17 for one role section: true once no ungated, un-booked worker qualified at this client and role is left. Gates Radar''s "Other clients" group (§3.4, §10.4).';

-- ---------------------------------------------------------------------
-- Radar, and the Shifts tab's "Open shifts" segment — the same rows, read
-- twice (§10.4).
--
-- What is deliberately NOT here:
--
--   · sections the worker is not signed off for. `wrong_role` is most of
--     an agency of a thousand.
--   · everything the worker could never take: `blocked` (§4.3 — a blocked
--     worker does not see Radar at all), `do_not_return`, `self_cancelled`
--     (RULE-04 — never sees that EVENT again) and `booked_elsewhere`.
--     Applying would be refused, so offering it is a false promise.
--   · sections that have started, and cancelled events.
--
-- `hours_limit` is the one gate that IS returned, because the wireframe
-- shows it: a muted card reading "Limit reached" with the arithmetic that
-- produced it. The others say nothing useful to a worker; this one does.
--
-- A section the worker already holds an invitation or a confirmation for
-- is theirs on another tab, so it drops out — except an `applied` row,
-- which §10.4 requires to stay visible under its own Applied section until
-- it resolves one way or the other.
-- ---------------------------------------------------------------------
create or replace function staff_open_shifts(p_staff uuid default null)
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
  applied_at      timestamptz
) language sql stable security definer
set search_path = public, extensions as $$
  with me as (select staff_caller(p_staff) as id)
  select
    sr.id, ev.id, ev.title, ev.event_date, r.name, sr.starts_at, sr.ends_at,
    sr.pay_rate, sr.dress_code, ev.venue_name, ev.venue_address,
    round((st_distance(s.home_location, ev.venue_location) / 1000.0)::numeric, 1),
    sr.headcount, sr.buffer, f.confirmed,
    c.qualified,
    coalesce(c.gate = 'hours_limit', false),
    (select o.applied_at from bookings o
      where o.shift_id = sr.id and o.staff_id = me.id and o.status = 'applied')
  from me
    join staff s               on s.id = me.id
    join shift_requirements sr on sr.starts_at > now()
    join events ev             on ev.id = sr.event_id and ev.cancelled_at is null
    join roles r               on r.id = sr.role_id
    cross join lateral shift_fill(sr.id) f
    cross join lateral (select * from auto_assign_candidates(sr.id) a
                         where a.staff_id = me.id) c
  where f.confirmed < sr.headcount
    and (c.gate is null or c.gate = 'hours_limit')
    -- RULE-17: a client the worker is not qualified at surfaces only once
    -- every qualified worker for the role has been reached.
    and (c.qualified or radar_wave1_exhausted(sr.id))
    -- Already invited or confirmed here: that lives on Invites or My
    -- shifts. An `applied` row stays, which is what c.booking_status
    -- being 'applied' means.
    and (c.booking_status is null or c.booking_status = 'applied')
  order by c.qualified desc,
           round((st_distance(s.home_location, ev.venue_location) / 1000.0)::numeric, 1),
           sr.starts_at
$$;

comment on function staff_open_shifts(uuid) is
  'Radar and the Shifts tab''s Open shifts (§10.4): open sections for the worker''s own roles, qualified clients first (RULE-17), closest first, with the RULE-20 cap state per row.';

-- ---------------------------------------------------------------------
-- Decline an invitation (§10.4).
--
-- "Decline is always possible, at any time, with no show-rate impact."
-- Always means always: no deadline, no gate, no state in which the button
-- is taken away. It moves the invitation to `closed` — the same state a
-- slot-taken Accept writes — because §3.4 says a dead invitation must not
-- "linger as if it were live", and `cancelled` is the cancel of a BOOKING,
-- which this never was.
--
-- Nothing touches `reliability`. That is the whole point of the sentence.
-- ---------------------------------------------------------------------
create or replace function decline_invite(p_booking uuid)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare b bookings;
begin
  select * into b from bookings where id = p_booking;
  if b.id is null then raise exception 'booking_not_found' using errcode = 'P0002'; end if;
  if current_app_role() is distinct from 'admin'
     and b.staff_id is distinct from (select id from staff where user_id = auth.uid()) then
    raise exception 'not_your_booking' using errcode = '42501';
  end if;
  if b.status <> 'invited' then
    return jsonb_build_object('ok', false, 'reason', 'not_invited', 'status', b.status::text);
  end if;
  update bookings set status = 'closed', cancelled_at = now(), cancel_cause = 'declined'
   where id = b.id;
  return jsonb_build_object('ok', true);
end $$;

comment on function decline_invite(uuid) is
  'Decline an invitation (§10.4). Always available, no show-rate impact; the invitation moves to closed so it does not linger as if it were live (§3.4).';

-- ---------------------------------------------------------------------
-- Radar self-apply (§10.4).
--
-- "Applying re-checks live availability first, the same defensive pattern
-- already used for Invites (§3.4): if the shift filled since the screen
-- loaded, the app shows 'Sorry, this shift is now full' and does not record
-- the application."
--
-- Full is measured against HEADCOUNT, not headcount + buffer. The buffer is
-- an over-invitation allowance the office spends on invitations; a worker
-- reading "2 open" is reading seats. Applying is not a booking, so it does
-- not consume one — the office or auto-assign still has to confirm it.
--
-- Every other refusal is the candidate gate, reported by its own name so
-- the screen can render "Limit Reached" rather than a generic failure.
-- ---------------------------------------------------------------------
create or replace function apply_to_shift(p_shift uuid, p_staff uuid default null)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_me   uuid := staff_caller(p_staff);
  sr     shift_requirements;
  ev     events;
  v_gate text;
  v_fill record;
  v_id   uuid;
begin
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
  if v_gate is not null then
    return jsonb_build_object('ok', false, 'reason', v_gate);
  end if;

  -- The live re-check. Seats, not the invitation target.
  select * into v_fill from shift_fill(p_shift);
  if v_fill.confirmed >= sr.headcount then
    return jsonb_build_object('ok', false, 'reason', 'full');
  end if;

  if exists (select 1 from bookings where shift_id = p_shift and staff_id = v_me) then
    return jsonb_build_object('ok', false, 'reason', 'already_has_booking');
  end if;

  insert into bookings (shift_id, staff_id, status, source, applied_at)
  values (p_shift, v_me, 'applied', 'self', now())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'bookingId', v_id);
end $$;

comment on function apply_to_shift(uuid, uuid) is
  'Radar self-application (§10.4). Re-checks live availability against headcount, then the §3.4 hard gates; records an `applied` booking, never a confirmation.';

-- ---------------------------------------------------------------------
-- Withdraw a pending self-application (§10.4, Radar's Applied section).
--
-- `closed`, not `cancelled`, and emphatically not `self_cancelled`: RULE-04
-- bars a worker from an EVENT for pulling out of a booking they had. They
-- never had one here. Taking the bar back off is impossible, so it must not
-- be applied to a withdrawal that costs the office nothing.
-- ---------------------------------------------------------------------
create or replace function withdraw_application(p_booking uuid)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare b bookings;
begin
  select * into b from bookings where id = p_booking;
  if b.id is null then raise exception 'booking_not_found' using errcode = 'P0002'; end if;
  if current_app_role() is distinct from 'admin'
     and b.staff_id is distinct from (select id from staff where user_id = auth.uid()) then
    raise exception 'not_your_booking' using errcode = '42501';
  end if;
  if b.status <> 'applied' then
    return jsonb_build_object('ok', false, 'reason', 'not_applied', 'status', b.status::text);
  end if;
  update bookings set status = 'closed', cancelled_at = now(), cancel_cause = 'withdrawn_by_worker'
   where id = b.id;
  return jsonb_build_object('ok', true);
end $$;

comment on function withdraw_application(uuid) is
  'Withdraw a pending Radar application (§10.4). Closes it without setting self_cancelled — RULE-04''s permanent bar is for abandoning a booking, which an application is not.';

-- ---------------------------------------------------------------------
-- Stage 3 of the three-stage confirmation (§3.5): the on-the-day confirm.
--
-- A REMINDER, never a deadline. It records that the worker said they were
-- on their way and nothing else; no job reads it to release a slot, and
-- §3.5 is explicit that on the day itself a replacement is unrealistic —
-- that is what the buffer is for. The contrast with `mark_ready`, whose
-- 12:05 cutoff does release, is the whole point of the stage.
-- ---------------------------------------------------------------------
create or replace function confirm_on_day(p_booking uuid)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare b bookings; sr shift_requirements;
begin
  select * into b from bookings where id = p_booking;
  if b.id is null then raise exception 'booking_not_found' using errcode = 'P0002'; end if;
  if current_app_role() is distinct from 'admin'
     and b.staff_id is distinct from (select id from staff where user_id = auth.uid()) then
    raise exception 'not_your_booking' using errcode = '42501';
  end if;
  if b.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'reason', 'not_confirmed');
  end if;
  select * into sr from shift_requirements where id = b.shift_id;
  if (sr.starts_at at time zone 'Europe/London')::date
     <> (now() at time zone 'Europe/London')::date then
    return jsonb_build_object('ok', false, 'reason', 'not_today');
  end if;
  update bookings set on_day_confirmed_at = coalesce(on_day_confirmed_at, now())
   where id = b.id;
  return jsonb_build_object('ok', true);
end $$;

comment on function confirm_on_day(uuid) is
  'Stage 3 of §3.5, the on-the-day confirmation. A reminder only: it never releases a slot, unlike the 12:00 mark_ready cutoff. "Today" is the UK day the shift starts on (§1.8).';

-- ---------------------------------------------------------------------
-- Re-confirm after the office moved the time, the venue or the dress code
-- (§3.5, N11).
--
-- The Shift Builder raises `reconfirm_required` on the booking and pushes
-- N11; the card then reads "Time changed · Awaiting" with one button. This
-- is that button. It clears the flag and RESETS the two later stages,
-- because a worker who pressed "I'm ready" for 12:00 has not agreed to an
-- 11:00 start — the day-before deadline has to be met again against the
-- shift they are actually being asked to work.
-- ---------------------------------------------------------------------
create or replace function reconfirm_booking(p_booking uuid)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare b bookings;
begin
  select * into b from bookings where id = p_booking;
  if b.id is null then raise exception 'booking_not_found' using errcode = 'P0002'; end if;
  if current_app_role() is distinct from 'admin'
     and b.staff_id is distinct from (select id from staff where user_id = auth.uid()) then
    raise exception 'not_your_booking' using errcode = '42501';
  end if;
  if b.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'reason', 'not_confirmed');
  end if;
  if not b.reconfirm_required then
    return jsonb_build_object('ok', false, 'reason', 'nothing_to_reconfirm');
  end if;
  update bookings
     set reconfirm_required = false, reconfirm_reason = null,
         confirmed_at = now(),
         day_before_confirmed_at = null, on_day_confirmed_at = null
   where id = b.id;
  return jsonb_build_object('ok', true);
end $$;

comment on function reconfirm_booking(uuid) is
  'Accept a changed time, venue or dress code (§3.5, N11). Clears the Awaiting flag and resets the day-before and on-the-day stages: agreement to the old shift is not agreement to this one.';

-- ---------------------------------------------------------------------
-- Grants. Postgres hands EXECUTE on a new function to PUBLIC, which for a
-- `security definer` function in `public` is the whole internet by way of
-- `anon`. Take it back first, then hand it to the signed-in role: every
-- function above identifies its own caller and refuses anyone else's row.
-- ---------------------------------------------------------------------
revoke execute on function staff_caller(uuid)            from public;
revoke execute on function staff_bookings(uuid)          from public;
revoke execute on function staff_open_shifts(uuid)       from public;
revoke execute on function radar_wave1_exhausted(uuid)   from public;
revoke execute on function decline_invite(uuid)          from public;
revoke execute on function apply_to_shift(uuid, uuid)    from public;
revoke execute on function withdraw_application(uuid)    from public;
revoke execute on function confirm_on_day(uuid)          from public;
revoke execute on function reconfirm_booking(uuid)       from public;

grant execute on function staff_caller(uuid)            to authenticated;
grant execute on function staff_bookings(uuid)          to authenticated;
grant execute on function staff_open_shifts(uuid)       to authenticated;
grant execute on function radar_wave1_exhausted(uuid)   to authenticated;
grant execute on function decline_invite(uuid)          to authenticated;
grant execute on function apply_to_shift(uuid, uuid)    to authenticated;
grant execute on function withdraw_application(uuid)    to authenticated;
grant execute on function confirm_on_day(uuid)          to authenticated;
grant execute on function reconfirm_booking(uuid)       to authenticated;
