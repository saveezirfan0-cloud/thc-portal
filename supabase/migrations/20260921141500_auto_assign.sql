-- =====================================================================
-- Auto-assign (§3.4), three-stage confirmation (§3.5) and the booking
-- state machine (§3.6).
--
-- Why this exists
-- ---------------
-- The Shift Builder stores the switches and the per-role allocation, and
-- job_schedules already reserves auto-staffing?mode=hourly|escalation|
-- cutoff, but no round has ever run: a saved event fills nobody. This is
-- the engine behind those three modes.
--
-- Where the scoring lives, and why it is NOT here
-- ----------------------------------------------
-- §6's five factors are pure maths and already exist, tested, in
-- packages/domain/src/scoring.ts. Writing them again in SQL would give the
-- rule two implementations and no shared vectors — exactly the split that
-- had the weekly cap disagreeing with itself until 0008. So the division
-- is by KIND of work rather than by layer:
--
--   SQL computes the FACTS. Who is gated and why, who is qualified at this
--   client and role, and the five raw factor inputs (show rate, rating,
--   distance, future shifts, venue history). These need row-level access,
--   PostGIS and the weekly cap, so they can only be done here.
--
--   TypeScript computes the SCORE, with rankPool() — one implementation,
--   already under test. The Edge Function ranks, and the event board (§3.3)
--   calls the same function and ranks the same way, which is also what
--   makes the board's "calculated fresh every time the page is opened"
--   honest rather than a cached scoring snapshot.
--
-- The one piece of §3.4 arithmetic that IS repeated here is
-- booked_elsewhere_conflict, because the gate has to be applied inside the
-- candidate query. It is held to packages/domain/src/overlap.vectors.json
-- by supabase/tests/130_auto_assign.sql, in the same shape as the cap and
-- pay vectors.
--
-- Security
-- --------
-- The RPCs are `security definer` for the same reason the check-in ones
-- are: a worker holds no insert or update policy on bookings, and must not
-- (they would be able to confirm themselves into someone else's slot).
-- Each one therefore checks the caller itself, admin or the booking's own
-- worker, before it touches a row.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Booked elsewhere (§3.4, the 14.07.2026 decision).
--
-- Mirrors overlapVerdict() in packages/domain/src/overlap.ts:
--   intersects     the two windows overlap; unworkable at any venue
--   gap_too_short  different venues, gap under the required minimum
--   clear          no conflict
--
-- Same venue back-to-back is always fine and needs no gap. A NULL venue is
-- never "the same venue" — an unknown location does not earn the
-- exemption. The gap is a parameter because it is a setting, and it is a
-- fixed figure rather than a travel-time calculation for v1.
-- ---------------------------------------------------------------------
create or replace function booked_elsewhere_conflict(
  p_cand_starts_at timestamptz, p_cand_ends_at timestamptz, p_cand_venue uuid,
  p_held_starts_at timestamptz, p_held_ends_at timestamptz, p_held_venue uuid,
  p_gap_minutes int
) returns text language sql immutable as $$
  select case
    when p_cand_starts_at < p_held_ends_at and p_held_starts_at < p_cand_ends_at
      then 'intersects'
    when p_cand_venue is not null and p_held_venue is not null and p_cand_venue = p_held_venue
      then 'clear'
    when least(p_cand_starts_at, p_held_starts_at) = p_cand_starts_at
      then case when p_held_starts_at - p_cand_ends_at < make_interval(mins => p_gap_minutes)
                then 'gap_too_short' else 'clear' end
    else case when p_cand_starts_at - p_held_ends_at < make_interval(mins => p_gap_minutes)
              then 'gap_too_short' else 'clear' end
  end
$$;

-- settings.booked_elsewhere_gap_minutes (0001_init.sql), default 120.
create or replace function booked_elsewhere_gap_minutes() returns int
language sql stable as $$
  select coalesce((select value::text::int from settings where key = 'booked_elsewhere_gap_minutes'), 120)
$$;

-- ---------------------------------------------------------------------
-- Fill for one role section (§3.2, §3.3).
--
-- The target is headcount + buffer: the buffer is part of the CONFIRMATION
-- target, not the working headcount (§3.2, RULE-15). Fill counts ONLY
-- confirmed — an invitation is not a fill — but `invited` is returned too,
-- because a round must not re-invite people who are already holding one.
-- ---------------------------------------------------------------------
create or replace function shift_fill(p_shift uuid)
returns table (confirmed int, invited int, headcount int, buffer int, target int, still_short int)
language sql stable as $$
  select
    c.confirmed, c.invited, sr.headcount, sr.buffer,
    sr.headcount + sr.buffer as target,
    greatest(0, sr.headcount + sr.buffer - c.confirmed) as still_short
  from shift_requirements sr
  cross join lateral (
    select
      count(*) filter (where b.status = 'confirmed')::int as confirmed,
      count(*) filter (where b.status = 'invited')::int   as invited
    from bookings b where b.shift_id = sr.id
  ) c
  where sr.id = p_shift
$$;

-- ---------------------------------------------------------------------
-- The candidate pool for one role section, computed fresh (§3.3, §3.4).
--
-- One row per worker who qualifies for the ROLE in general. `gate` is null
-- for everyone in the pool and names the bar for everyone else, so this one
-- function feeds both the engine (skip gated, rank the rest) and the event
-- board (Confirmed / Invited / Potential / Unavailable with a reason).
--
-- Gate precedence, most structural first, because the board shows one
-- reason per person and the manager needs the one that will not change:
--   wrong_role      not qualified for the role at all — §6 says this one
--                   produces NO row on the board, so it is returned for
--                   the engine's benefit and filtered by the screen
--   do_not_return   the client-level bar (§9.6)
--   blocked         not `compliant` (§2.12)
--   self_cancelled  RULE-04: off this EVENT permanently, shown as Rejected
--   booked_elsewhere §3.4 against CONFIRMED bookings only
--   hours_limit     RULE-20, read live at the moment the round runs
--
-- do_not_return is read per CLIENT, not per client+role. The table is keyed
-- on both, but a client who has asked not to see someone again has not
-- asked role by role, and §9.6 states the bar in client terms.
--
-- The three history counts and the two ratings are the raw §6 factor
-- inputs. A worker with no history yet gets the zero point of each factor
-- (90% show rate, 4.0 rating) rather than a credit, so an unknown worker
-- scores 0 on those two factors instead of out-ranking a known good one.
-- The scope does not decide this; it is the conservative reading and the
-- additive rounds still reach them once better-scored workers are
-- exhausted. Flagged here because it is a judgement, not a rule.
-- ---------------------------------------------------------------------
create or replace function auto_assign_candidates(p_shift uuid)
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
) language sql stable as $$
  with sec as (
    select sr.id as shift_id, sr.role_id, sr.starts_at, sr.ends_at,
           ev.id as event_id, ev.client_id, ev.venue_id, ev.venue_location
    from shift_requirements sr join events ev on ev.id = sr.event_id
    where sr.id = p_shift
  ),
  gap as (select booked_elsewhere_gap_minutes() as mins)
  select
    s.id,
    case
      when not exists (select 1 from staff_roles sro
                        where sro.staff_id = s.id and sro.role_id = sec.role_id) then 'wrong_role'
      when exists (select 1 from client_qualifications cq
                    where cq.staff_id = s.id and cq.client_id = sec.client_id
                      and cq.do_not_return)                                     then 'do_not_return'
      when s.status <> 'compliant'                                              then 'blocked'
      when exists (select 1 from bookings b
                     join shift_requirements sr2 on sr2.id = b.shift_id
                    where b.staff_id = s.id and sr2.event_id = sec.event_id
                      and b.self_cancelled)                                     then 'self_cancelled'
      when exists (
             select 1 from bookings b
               join shift_requirements sr2 on sr2.id = b.shift_id
               join events ev2 on ev2.id = sr2.event_id
              where b.staff_id = s.id and b.status = 'confirmed' and b.shift_id <> sec.shift_id
                and booked_elsewhere_conflict(sec.starts_at, sec.ends_at, sec.venue_id,
                                              sr2.starts_at, sr2.ends_at, ev2.venue_id,
                                              gap.mins) <> 'clear')             then 'booked_elsewhere'
      when weekly_cap_would_breach(s.id, sec.shift_id)                          then 'hours_limit'
      else null
    end as gate,
    exists (select 1 from client_qualifications cq
             where cq.staff_id = s.id and cq.client_id = sec.client_id
               and cq.role_id = sec.role_id and not cq.do_not_return) as qualified,
    (select b.status::text from bookings b
      where b.shift_id = sec.shift_id and b.staff_id = s.id) as booking_status,
    coalesce(s.reliability, 90)::numeric,
    coalesce(s.rating, 4.0)::numeric,
    coalesce(st_distance(s.home_location, sec.venue_location) / 1000.0, 9999)::numeric,
    (select count(*) from bookings b join shift_requirements sr3 on sr3.id = b.shift_id
      where b.staff_id = s.id and b.status = 'confirmed' and sr3.starts_at > now())::int,
    (select count(*) from bookings b
       join shift_requirements sr4 on sr4.id = b.shift_id
       join events ev4 on ev4.id = sr4.event_id
      where b.staff_id = s.id and b.status = 'worked' and ev4.venue_id = sec.venue_id)::int
  from staff s cross join sec cross join gap
  where s.removed_at is null and s.left_at is null
$$;

-- ---------------------------------------------------------------------
-- Queue a push for one booking (§8). `on conflict do nothing` on the
-- idempotency key is what makes every job below safe to re-run: a round
-- that fires twice writes one row, not two pushes.
-- ---------------------------------------------------------------------
create or replace function queue_booking_push(p_code text, p_booking uuid)
returns void language sql security definer set search_path = public as $$
  insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
  select p_code || ':booking:' || p_booking::text, 'push', p_code, b.staff_id,
         jsonb_build_object('bookingId', b.id, 'shiftId', sr.id, 'eventId', ev.id,
                            'invitationId', b.id, 'event', ev.title,
                            'window', to_char(sr.starts_at at time zone 'Europe/London', 'HH24:MI')
                                      || '–' || to_char(sr.ends_at at time zone 'Europe/London', 'HH24:MI'))
  from bookings b
    join shift_requirements sr on sr.id = b.shift_id
    join events ev on ev.id = sr.event_id
  where b.id = p_booking
  on conflict (key) do nothing
$$;

-- ---------------------------------------------------------------------
-- Invite one worker to one role section.
--
-- Additive only (§3.4): it never withdraws or re-orders an existing
-- invitation, it only adds. Every refusal is a return value rather than an
-- exception, because a round walks a ranked list and a worker who became
-- ineligible between the query and the insert is ordinary, not an error.
-- ---------------------------------------------------------------------
create or replace function invite_worker(
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

  -- Gates before "do they already have one", so the REASON is the useful
  -- one. A worker who self-cancelled off this event still holds the
  -- cancelled row, and reporting `already_has_booking` for them would hide
  -- RULE-04 behind a bookkeeping detail on the manager's screen.
  select gate into v_gate from auto_assign_candidates(p_shift) where staff_id = p_staff;
  if v_gate is not null then
    return jsonb_build_object('invited', false, 'reason', v_gate);
  end if;

  -- `bookings` is unique on (shift, staff), so any existing row blocks a
  -- second one — including a cancelled row. A slot released by the 12:00
  -- cutoff therefore cannot be re-offered to the same worker by a later
  -- round; it goes to someone else, which is what §3.5 intends anyway.
  if exists (select 1 from bookings where shift_id = p_shift and staff_id = p_staff) then
    return jsonb_build_object('invited', false, 'reason', 'already_has_booking');
  end if;

  -- Invitations are additive up to the target, counting the ones already
  -- open: without this a role whose target is met on paper keeps inviting.
  select * into v_fill from shift_fill(p_shift);
  if not p_ignore_target and v_fill.confirmed + v_fill.invited >= v_fill.target then
    return jsonb_build_object('invited', false, 'reason', 'target_met');
  end if;

  insert into bookings (shift_id, staff_id, status, source)
  values (p_shift, p_staff, 'invited', p_source)
  returning id into v_booking;

  perform queue_booking_push('N5', v_booking);
  return jsonb_build_object('invited', true, 'bookingId', v_booking);
end $$;

-- ---------------------------------------------------------------------
-- Accept an invitation — first-to-confirm (§3.4, §3.6).
--
-- Three answers, and the difference between the last two matters on screen:
--   taken    the slot went while the invitation sat there. §3.4 says the
--            invitation then "moves to Closed and disappears from the list
--            of active invites (it does not linger as if it were live)",
--            so this WRITES that state rather than just reporting it.
--   overlap  the worker is already confirmed on something that clashes.
--            The invitation stays live: the office may move one of them,
--            and the popup tells the worker why (§3.4 safety net).
--   ok       confirmed, and every other open invitation of theirs whose
--            window intersects this one is withdrawn automatically.
--
-- The withdrawal is keyed on the windows INTERSECTING, not on the
-- booked-elsewhere travel gap — see the note in packages/domain/overlap.ts.
-- ---------------------------------------------------------------------
create or replace function accept_invite(p_booking uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  b          bookings;
  sr         shift_requirements;
  ev         events;
  v_fill     record;
  v_gap      int := booked_elsewhere_gap_minutes();
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

-- ---------------------------------------------------------------------
-- Stage 2 of the three-stage confirmation (§3.5): the day-before "I'm
-- ready". The ONLY hard deadline in the flow.
-- ---------------------------------------------------------------------
create or replace function mark_ready(p_booking uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
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
  if now() >= sr.starts_at then
    return jsonb_build_object('ok', false, 'reason', 'shift_started');
  end if;
  update bookings set day_before_confirmed_at = coalesce(day_before_confirmed_at, now())
   where id = b.id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- The 12:00 cutoff (§3.5, RULE-05). Not pressed by noon the day before →
-- the slot is released, N6b goes to the worker, and the next ordinary
-- round tops the section back up.
--
-- The deadline is built in Europe/London and then cast back, so it is
-- 12:00 UK across both BST and GMT rather than a fixed UTC offset. The
-- cron fires every five minutes and this decides whether the moment has
-- passed, which is why it takes `p_now` rather than reading the clock: a
-- test can put the clock anywhere, and the job stays idempotent because a
-- released booking is no longer `confirmed` on the next pass.
--
-- Bookings whose shift has already started are left alone. Stage 3, the
-- on-the-day confirmation, is a reminder and NEVER releases a slot (§3.5):
-- on the day itself a replacement is unrealistic, and that is what the
-- buffer is for.
-- ---------------------------------------------------------------------
create or replace function ready_deadline(p_starts_at timestamptz) returns timestamptz
language sql immutable as $$
  select (((p_starts_at at time zone 'Europe/London')::date - 1) + time '12:00')
         at time zone 'Europe/London'
$$;

create or replace function release_unready_bookings(p_now timestamptz default now())
returns int language plpgsql security definer set search_path = public, extensions as $$
declare r record; n int := 0;
begin
  for r in
    select b.id
    from bookings b
      join shift_requirements sr on sr.id = b.shift_id
      join events ev on ev.id = sr.event_id
    where b.status = 'confirmed'
      and b.day_before_confirmed_at is null
      and ev.cancelled_at is null
      and p_now >= ready_deadline(sr.starts_at)
      and p_now < sr.starts_at
    for update of b
  loop
    update bookings set status = 'cancelled', cancelled_at = p_now, cancel_cause = 'ready_cutoff'
     where id = r.id;
    perform queue_booking_push('N6b', r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Worker-initiated cancel (RULE-04, §3.6). Available only while more than
-- 72 hours remain. Unlike every other cancel it sets `self_cancelled`,
-- which bars the worker from this EVENT permanently — auto-assign, Radar
-- self-apply and manual invitation alike — and shows them on the board as
-- Unavailable → Rejected. auto_assign_candidates reads that flag across
-- the whole event, not just this section, which is what makes the bar
-- event-wide rather than section-wide.
-- ---------------------------------------------------------------------
create or replace function self_cancel_booking(p_booking uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
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
  if sr.starts_at - now() <= interval '72 hours' then
    return jsonb_build_object('ok', false, 'reason', 'too_late');
  end if;
  update bookings
     set status = 'cancelled', cancelled_at = now(),
         cancel_cause = 'self_cancel', self_cancelled = true
   where id = b.id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- Which role sections need a round, per mode (§3.4).
--
-- The handover at the shift's start is EXCLUSIVE, not parallel: `hourly`
-- takes sections that have not started, `escalation` takes sections that
-- are under way, and no section is ever in both. That is the whole point
-- of the split — before the start an hour between rounds is fine, once
-- people are working short-handed it is useless.
--
-- They also measure shortness differently, and the difference is the
-- buffer. `hourly` fills to headcount + buffer, because the buffer is part
-- of the confirmation target. `escalation` is chasing bodies on the floor,
-- so it counts against `headcount` alone and invites past the cap.
--
-- Both switches must be on: the event-level one and the role-level one
-- (§3.4). Either turned off means the manager is filling this by hand.
-- ---------------------------------------------------------------------
create or replace function auto_assign_due_shifts(p_mode text, p_now timestamptz default now())
returns table (shift_id uuid, event_id uuid, allocation int, still_short int, starts_at timestamptz)
language sql stable as $$
  select sr.id, ev.id, sr.allocation_per_hour,
         case when p_mode = 'escalation'
              then greatest(0, sr.headcount - f.confirmed)
              else f.still_short end,
         sr.starts_at
  from shift_requirements sr
    join events ev on ev.id = sr.event_id
    cross join lateral shift_fill(sr.id) f
  where ev.cancelled_at is null
    and ev.auto_assign and sr.auto_assign
    and case p_mode
          when 'hourly'     then p_now < sr.starts_at and f.confirmed < f.target
          when 'escalation' then p_now >= sr.starts_at and p_now < sr.ends_at
                                 and f.confirmed < sr.headcount
          else false
        end
  order by sr.starts_at
$$;

-- ---------------------------------------------------------------------
-- Every function above is `security definer` in `public`, which Postgres
-- grants EXECUTE to PUBLIC by default. The same lockdown 0009 applied to
-- the jobs layer: take the default grant back, then hand execute to the
-- callers that should have it. The worker-facing three are reachable by a
-- signed-in user because each checks the caller itself; the engine's are
-- service-role only.
-- ---------------------------------------------------------------------
revoke execute on function invite_worker(uuid, uuid, booking_source, boolean) from public;
revoke execute on function accept_invite(uuid) from public;
revoke execute on function mark_ready(uuid) from public;
revoke execute on function self_cancel_booking(uuid) from public;
revoke execute on function release_unready_bookings(timestamptz) from public;
revoke execute on function queue_booking_push(text, uuid) from public;

grant execute on function accept_invite(uuid)         to authenticated;
grant execute on function mark_ready(uuid)            to authenticated;
grant execute on function self_cancel_booking(uuid)   to authenticated;
grant execute on function invite_worker(uuid, uuid, booking_source, boolean) to authenticated;

comment on function auto_assign_candidates(uuid) is
  'The §3.3/§3.4 pool for one role section, computed fresh: gate, wave and the five §6 factor inputs. Scoring itself is packages/domain/scoring.ts.';
comment on function accept_invite(uuid) is
  'First-to-confirm (§3.4): taken / overlap / ok, and withdraws the worker''s other intersecting invitations.';
comment on function release_unready_bookings(timestamptz) is
  'The 12:00 day-before cutoff (§3.5, RULE-05). Releases the slot and queues N6b.';
