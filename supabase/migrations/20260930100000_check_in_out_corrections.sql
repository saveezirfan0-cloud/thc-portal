-- =====================================================================
-- Migration 20260930100000 · the day of the shift, corrected
--                            (§3.3, §5.1, §5.2, §5.2b, §6, §9.5, §9.6,
--                             RULE-01 / 02 / 14, ADR-0035)
--
-- Audit 25.09.2026, fix round WP-C, ported onto main after #65/#67/#68.
-- Each numbered block names the defect. D4 (Get back) and D7 (the
-- show-rate) are NOT here: main fixed both — get_back(uuid, text) in
-- 20260928110200 and staff_show_rate() in 20260928110100 — and this
-- migration builds on them rather than restating them differently.
--
--   D5  "Left early" was never raised, so RULE-14's four-hour floor paid a
--       worker who went home after an hour. check_out_decision() now says
--       whether the press was an early finish, and check_out() writes the
--       `left_early` violation (§9.5). ADR-0035: a press more than 15
--       minutes before the ROLE SECTION's end (RULE-18), on site or off.
--
--   D15 An off-site check-out whose last on-site fix is more than 30
--       minutes before the press AND more than 30 minutes before the
--       scheduled end raises `no_checkout` for a manager to review. With
--       screen-open pings only (ADR-0001 Option A), "the last on-site fix"
--       is often the ping sent right after check-in, and RULE-01 would
--       otherwise settle the shift there silently. The recorded finish
--       stays that fix until a manager resolves it (ADR-0035). The row is
--       marked `violations.stale_fix_review`, and staff_show_rate() (main,
--       20260928110100) is restated to leave it out: the worker DID press
--       Check out, so the review is not a mark against them.
--
--   D49 A break is only deducted where it overlaps the paid window:
--       unpaid_break_minutes() clips every break to
--       [max(check-in, start), min(finish, end)].
--
--   D16 attempt_check_in() refuses a worker whose staff.status is not
--       `compliant` (`staff_not_compliant`). check_out(), the breaks and
--       record_ping() deliberately do not: a shift already under way
--       still has to be closed.
--
--   D17 Resolving a No-show takes a manager-entered arrival time
--       ("Arrived at (UK time)"), validated: not before start − 30 min,
--       not in the future, and REQUIRED once the section has ended (the
--       moment of the press would then sit after the end and intersect
--       nothing). An optional finish closes the shift in the same action,
--       so it settles instead of staying Pending. main's get_back(uuid,
--       text) calls resolve_violation(v, note) and inherits all of it:
--       before the end it registers the press as before; after the end it
--       answers `arrived_at_required`, which the event board words as
--       "use Resolve in the violation log".
--
--   D37 The automatic client qualification (§9.6) is granted when the
--       shift CLOSES — a recorded or manager-entered finish — with no
--       unresolved violation, not when the booking becomes `worked` at
--       check-in (which is before any Late / Left early exists).
--
-- Restated from their latest definitions on main:
--   check_out_decision   0006
--   attempt_check_in     0006
--   check_out            20260921153000
--   unpaid_break_minutes 20260921153000
--   resolve_violation    20260923190000 (signature grows: dropped first)
--   grant_qualification_for_booking  20260924150000
--   staff_show_rate      20260928110100
-- payable_shifts_v and staff_earnings() read unpaid_break_minutes() and so
-- pick the clipping up without being restated.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0 · The stale-fix review mark (D15)
-- ---------------------------------------------------------------------
alter table violations
  add column if not exists stale_fix_review boolean not null default false;

comment on column violations.stale_fix_review is
  'D15 / ADR-0035. True on a no_checkout that check_out() raised only because the last on-site fix was more than 30 min before both the press and the scheduled end. The worker pressed Check out; a manager confirms the finish. Blocks RULE-14''s floor like any unresolved No check-out, but never counts against the show-rate (staff_show_rate).';

-- ---------------------------------------------------------------------
-- 1 · check_out_decision (D5, D15) — pure, mirrored by checkOutDecision()
--     in packages/domain/pay.ts and held to pay.vectors.json.
--
--   leftEarly   the press is more than 15 minutes before the scheduled end
--               and the check-out goes through (any recorded decision, and
--               the no-on-site-fix press too: the worker said they had
--               finished). Not for `not_started` / `locked`.
--   stale fix   off site, and the last on-site fix is more than 30 minutes
--               before the press AND more than 30 minutes before the end:
--               the fix is still what is recorded (§5.1's message quotes
--               it), but `violation` is `no_checkout` so a manager confirms
--               the finish (RULE-02, ADR-0035).
-- ---------------------------------------------------------------------
create or replace function check_out_decision(
  p_starts_at        timestamptz,
  p_ends_at          timestamptz,
  p_at               timestamptz,
  p_inside_geofence  boolean,
  p_check_in_at      timestamptz,
  p_last_on_site_at  timestamptz
) returns jsonb language sql immutable set search_path = public, extensions as $$
  select case
    when p_at < p_starts_at then
      jsonb_build_object('decision','not_started','recordedAt',null,
        'violation','none','messageKey','check_out_not_open','leftEarly',false)
    when p_at >= p_ends_at + interval '4 hours' then
      jsonb_build_object('decision','locked','recordedAt',null,
        'violation','no_checkout','messageKey','no_check_out_locked','leftEarly',false)
    when p_inside_geofence then
      jsonb_build_object('decision','recorded_on_site','recordedAt',to_jsonb(p_at),
        'violation','none','messageKey','checked_out',
        'leftEarly', p_at < p_ends_at - interval '15 minutes')
    when p_last_on_site_at is not null then
      jsonb_build_object('decision','recorded_last_on_site','recordedAt',to_jsonb(p_last_on_site_at),
        'violation',
          case when p_at - p_last_on_site_at > interval '30 minutes'
                and p_ends_at - p_last_on_site_at > interval '30 minutes'
               then 'no_checkout' else 'none' end,
        'messageKey','checked_out_off_site',
        'leftEarly', p_at < p_ends_at - interval '15 minutes')
    else
      jsonb_build_object('decision','no_on_site_fix','recordedAt',to_jsonb(p_check_in_at),
        'violation','no_checkout','messageKey','no_check_out_office_confirms',
        'leftEarly', p_at < p_ends_at - interval '15 minutes')
  end
$$;

comment on function check_out_decision is
  'Pure §5.1 check-out gate. Mirrored by checkOutDecision() in packages/domain/pay.ts; both are held to pay.vectors.json. leftEarly = pressed more than 15 min before the end (D5); an off-site fix more than 30 min before both the press and the end raises no_checkout for review (D15, ADR-0035).';

-- ---------------------------------------------------------------------
-- 2 · Breaks inside the paid window only (D49, §5.2b)
--
-- break_window_minutes() is the pure half, mirrored by breakWindowMinutes()
-- in packages/domain/pay.ts and held to the `breaks` vectors. A break that
-- is still running ends at the finish (the recorded check-out, or now).
-- ---------------------------------------------------------------------
create or replace function break_window_minutes(
  p_starts_at    timestamptz,
  p_ends_at      timestamptz,
  p_check_in_at  timestamptz,
  p_finish_at    timestamptz,
  p_break_start  timestamptz,
  p_break_end    timestamptz
) returns int language sql immutable set search_path = public, extensions as $$
  select greatest(0, round(extract(epoch from (
           least(coalesce(p_break_end, p_finish_at), p_finish_at, p_ends_at)
           - greatest(p_break_start, p_check_in_at, p_starts_at))) / 60))::int
$$;

comment on function break_window_minutes is
  '§5.2b / RULE-01. One break''s minutes inside [max(check-in, start), min(finish, end)] (D49). Pure; mirrored by breakWindowMinutes() in packages/domain/pay.ts.';

create or replace function unpaid_break_minutes(p_booking uuid)
returns int language sql stable set search_path = public, extensions as $$
  select coalesce(sum(
           break_window_minutes(sr.starts_at, sr.ends_at, cl.check_in_at,
                                coalesce(cl.manager_finish_at, cl.check_out_at, now()),
                                br.started_at, br.ended_at)
         ), 0)::int
    from breaks br
    join bookings b on b.id = br.booking_id
    join shift_requirements sr on sr.id = b.shift_id
    join events e on e.id = sr.event_id
    left join lateral (
      select * from check_logs c where c.booking_id = b.id and c.check_in_at is not null
       order by c.check_in_at limit 1
    ) cl on true
   where br.booking_id = p_booking and not e.pays_breaks
$$;

comment on function unpaid_break_minutes is
  '§5.2b. Total unpaid break minutes for a booking, each break clipped to the paid window [max(check-in, start), min(finish, end)] (D49). An unfinished break runs to the recorded finish.';

-- ---------------------------------------------------------------------
-- 3 · attempt_check_in (D16), from 0006
-- ---------------------------------------------------------------------
create or replace function attempt_check_in(
  p_booking uuid,
  p_lat     double precision,
  p_lng     double precision
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  b           bookings;
  sr          shift_requirements;
  ev          events;
  v_point     geography(point,4326);
  v_distance  numeric;
  v_inside    boolean;
  v_slots     int;
  v_now       timestamptz := now();
  v_status    staff_status;
  d           jsonb;
begin
  select * into b from bookings where id = p_booking;
  if b.id is null then raise exception 'booking_not_found' using errcode = 'P0002'; end if;

  if current_app_role() is distinct from 'admin'
     and b.staff_id is distinct from (select id from staff where user_id = auth.uid()) then
    raise exception 'not_your_booking' using errcode = '42501';
  end if;

  -- Lock the role section: the slot count below has to be read under it.
  select * into sr from shift_requirements where id = b.shift_id for update;
  select * into ev from events where id = sr.event_id;

  -- Idempotence first: a worker who is already on shift gets the same answer
  -- however many times the button is pressed.
  if exists (select 1 from check_logs where booking_id = b.id and check_in_at is not null) then
    return jsonb_build_object('decision','already_checked_in','accepted',false,'logOutcome',null,
      'late',false,'minutesLate',0,'turnAwayPayMin',null,'messageKey','already_checked_in');
  end if;
  if ev.cancelled_at is not null then
    raise exception 'event_cancelled' using errcode = 'P0001';
  end if;
  if b.status <> 'confirmed' then
    raise exception 'booking_not_confirmed' using errcode = 'P0001';
  end if;

  -- D16: only a compliant worker starts a shift. A block, a P45, a removal
  -- or an expired right to work (§4.3, §2.12) stops the check-in here, in
  -- the database, whatever the app believed about the lock. A shift that
  -- is already under way is not stopped: check_out(), the breaks and
  -- record_ping() do not ask.
  select s.status into v_status from staff s where s.id = b.staff_id;
  if v_status is distinct from 'compliant' then
    raise exception 'staff_not_compliant' using errcode = 'P0001';
  end if;

  v_point    := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  v_distance := round(st_distance(v_point, ev.venue_location)::numeric, 1);
  v_inside   := v_distance <= ev.geofence_radius_m;

  select count(*) into v_slots
    from check_logs cl join bookings b2 on b2.id = cl.booking_id
   where b2.shift_id = sr.id and cl.outcome = 'checked_in';

  d := check_in_decision(sr.starts_at, sr.ends_at, v_now, v_inside, b.confirmed_at,
                         v_slots, sr.headcount, not ev.pays_buffer);

  if d->>'logOutcome' is not null then
    insert into check_logs (booking_id, attempted_at, outcome, location, distance_m,
                            check_in_at, on_site_verified)
    values (b.id, v_now, (d->>'logOutcome')::checklog_outcome, v_point, v_distance,
            case when (d->>'accepted')::boolean then v_now end, v_inside);
  end if;

  if (d->>'accepted')::boolean then
    update bookings set status = 'worked' where id = b.id;
    if (d->>'late')::boolean then
      insert into violations (staff_id, booking_id, type, detected_at, minutes_late)
      select b.staff_id, b.id, 'late', v_now, (d->>'minutesLate')::int
       where not exists (select 1 from violations where booking_id = b.id and type = 'late');
    end if;
  elsif d->>'decision' = 'turned_away' then
    update bookings set status = 'turned_away' where id = b.id;
  elsif d->>'decision' = 'locked' then
    insert into violations (staff_id, booking_id, type, detected_at, minutes_late)
    select b.staff_id, b.id, 'no_show', sr.starts_at + interval '30 minutes', null
     where not exists (select 1 from violations where booking_id = b.id and type = 'no_show');
  end if;

  return d || jsonb_build_object('distanceM', v_distance, 'geofenceRadiusM', ev.geofence_radius_m);
end $$;

comment on function attempt_check_in is
  '§5.1 check-in RPC. Locks the role section, logs the attempt, applies the 30-minute grace, the No-show lock and the strict-buffer turn-away (RULE-15). Refuses a worker who is not compliant (staff_not_compliant, D16).';

-- ---------------------------------------------------------------------
-- 4 · check_out (D5, D15, D37), from 20260921153000
--
-- The violations are written BEFORE the check log is closed: closing it is
-- what grants the automatic client qualification (block 7), and that grant
-- must see a Left early / No check-out raised by this very press.
-- ---------------------------------------------------------------------
create or replace function check_out(
  p_booking uuid,
  p_lat     double precision,
  p_lng     double precision
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  b            bookings;
  sr           shift_requirements;
  ev           events;
  cl           check_logs;
  v_point      geography(point,4326);
  v_distance   numeric;
  v_inside     boolean;
  v_last_site  timestamptz;
  v_break_min  int;
  v_now        timestamptz := now();
  d            jsonb;
  v_recorded   timestamptz;
begin
  select * into b from bookings where id = p_booking;
  if b.id is null then raise exception 'booking_not_found' using errcode = 'P0002'; end if;

  if current_app_role() is distinct from 'admin'
     and b.staff_id is distinct from (select id from staff where user_id = auth.uid()) then
    raise exception 'not_your_booking' using errcode = '42501';
  end if;

  select * into sr from shift_requirements where id = b.shift_id;
  select * into ev from events where id = sr.event_id;

  select * into cl from check_logs
   where booking_id = b.id and check_in_at is not null
   order by check_in_at limit 1 for update;
  if cl.id is null then
    raise exception 'not_checked_in' using errcode = 'P0001';
  end if;
  if cl.check_out_at is not null then
    return jsonb_build_object('decision','already_checked_out','recordedAt',to_jsonb(cl.check_out_at),
      'violation','none','messageKey','already_checked_out');
  end if;

  v_point    := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  v_distance := round(st_distance(v_point, ev.venue_location)::numeric, 1);
  v_inside   := v_distance <= ev.geofence_radius_m;

  select max(at) into v_last_site from location_pings
   where booking_id = b.id and inside_geofence and at > cl.check_in_at;

  d := check_out_decision(sr.starts_at, sr.ends_at, v_now, v_inside, cl.check_in_at, v_last_site);
  v_recorded := nullif(d->>'recordedAt','')::timestamptz;

  -- RULE-02, either trigger, and D15's stale fix. A no_checkout on a
  -- recorded fix is the stale-fix review: marked, so the show-rate leaves
  -- it out (the worker did press Check out).
  if d->>'violation' = 'no_checkout' then
    insert into violations (staff_id, booking_id, type, detected_at, stale_fix_review)
    select b.staff_id, b.id, 'no_checkout', v_now, d->>'decision' = 'recorded_last_on_site'
     where not exists (select 1 from violations where booking_id = b.id and type = 'no_checkout');
  end if;

  -- D5 · §9.5 "Left early": the worker checked out before the scheduled end.
  if coalesce((d->>'leftEarly')::boolean, false) then
    insert into violations (staff_id, booking_id, type, detected_at)
    select b.staff_id, b.id, 'left_early', v_now
     where not exists (select 1 from violations where booking_id = b.id and type = 'left_early');
  end if;

  if v_recorded is not null then
    update check_logs
       set check_out_at        = v_recorded,
           check_out_pressed_at = v_now,
           check_out_on_site   = v_inside,
           last_on_site_at     = coalesce(v_last_site, last_on_site_at)
     where id = cl.id;

    -- §5.2b: a break the worker never finished ends when the shift does.
    update breaks set ended_at = greatest(v_recorded, started_at)
     where booking_id = b.id and ended_at is null;
  end if;

  v_break_min := unpaid_break_minutes(b.id);

  return d || jsonb_build_object(
    'distanceM', v_distance,
    'payRate',   sr.pay_rate,                      -- base rate only (§9.8)
    'unpaidBreakMin', v_break_min,
    'pay',       payable_minutes(sr.starts_at, sr.ends_at, cl.check_in_at, v_recorded, v_break_min,
                   exists (select 1 from violations where booking_id = b.id and type = 'left_early'),
                   case when exists (select 1 from violations
                                      where booking_id = b.id and type = 'no_checkout' and not resolved)
                        then 'unresolved' else 'none' end));
end $$;

comment on function check_out is
  '§5.1 check-out RPC. Open from the start until end+4h from anywhere; off site records the last on-site fix, no fix at all raises RULE-02 on the press, a stale fix raises it for review (D15), a press more than 15 min before the end raises Left early (D5), and an unfinished break is closed at the recorded finish (§5.2b).';

-- ---------------------------------------------------------------------
-- 5 · resolve_violation (D17), from 20260923190000
--
-- One new argument, p_arrived_at, so the old three-argument signature is
-- dropped first rather than left behind as an ambiguous overload.
--
--   no_show  the arrival is p_arrived_at, or the moment of the press. It
--            must not be before start − 30 min (check-in opens then, §5.1)
--            or in the future; once the ROLE SECTION has ended it is
--            required, because the press would sit after the end and
--            [check-in, check-out] ∩ [start, end] would be empty for
--            ever. p_actual_finish, when given, closes the shift in the
--            same action: it must not be before the arrival or in the
--            future, and it is written as the check-out (and as the
--            manager-entered finish, which is what it is), so the shift
--            settles and booking_tick() has nothing left to raise.
--   no_checkout  unchanged.
--
-- main's get_back(uuid, text) (20260928110200) calls this with two
-- arguments, so it keeps working through the defaults.
-- ---------------------------------------------------------------------
drop function if exists resolve_violation(uuid, text, timestamptz);

create function resolve_violation(
  p_violation     uuid,
  p_note          text,
  p_actual_finish timestamptz default null,
  p_arrived_at    timestamptz default null
) returns jsonb language plpgsql set search_path = public, extensions as $$
declare
  v          violations;
  b          bookings;
  sr         shift_requirements;
  ev         events;
  cl         check_logs;
  v_now      timestamptz := now();
  v_was      violation_type;
  v_arrival  timestamptz;
  v_exported boolean;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'admins_only' using errcode = '42501';
  end if;

  -- The note is mandatory for every type (§9.5, confirmed 31.07.2026).
  if p_note is null or btrim(p_note) = '' then
    raise exception 'note_required' using errcode = 'P0001';
  end if;

  select * into v from violations where id = p_violation for update;
  if v.id is null then raise exception 'violation_not_found' using errcode = 'P0002'; end if;
  if v.resolved then
    return jsonb_build_object('decision','already_resolved','messageKey','already_resolved');
  end if;

  select * into b  from bookings where id = v.booking_id;
  select * into sr from shift_requirements where id = b.shift_id;
  select * into ev from events where id = sr.event_id;
  select * into cl from check_logs
   where booking_id = b.id and check_in_at is not null
   order by check_in_at limit 1 for update;

  v_was := v.type;
  -- Per booking, not per event (20260923190000).
  v_exported := booking_payroll_exported(b.id);

  if v.type = 'no_checkout' then
    if p_actual_finish is null then
      raise exception 'actual_finish_required' using errcode = 'P0001';
    end if;
    if p_actual_finish > v_now then
      raise exception 'actual_finish_in_future' using errcode = 'P0001';
    end if;
    if cl.check_in_at is not null and p_actual_finish < cl.check_in_at then
      raise exception 'actual_finish_before_check_in' using errcode = 'P0001';
    end if;

    update check_logs set manager_finish_at = p_actual_finish where id = cl.id;
    v.actual_finish_at := p_actual_finish;

  elsif v.type = 'no_show' then
    -- "Get back" (§3.3): the worker is registered as arrived.
    if cl.id is not null then
      -- Already checked in (a manual No-show on a worker who did press):
      -- the recorded arrival stands.
      v_arrival := cl.check_in_at;
    else
      if p_arrived_at is null and v_now >= sr.ends_at then
        raise exception 'arrived_at_required' using errcode = 'P0001';
      end if;
      v_arrival := coalesce(p_arrived_at, v_now);
      if v_arrival > v_now then
        raise exception 'arrived_at_in_future' using errcode = 'P0001';
      end if;
      if v_arrival < sr.starts_at - interval '30 minutes' then
        raise exception 'arrived_at_too_early' using errcode = 'P0001';
      end if;
    end if;

    if p_actual_finish is not null then
      if p_actual_finish > v_now then
        raise exception 'actual_finish_in_future' using errcode = 'P0001';
      end if;
      if p_actual_finish < v_arrival then
        raise exception 'actual_finish_before_arrival' using errcode = 'P0001';
      end if;
      if cl.id is not null and coalesce(cl.manager_finish_at, cl.check_out_at) is not null then
        raise exception 'finish_already_recorded' using errcode = 'P0001';
      end if;
    end if;

    if cl.id is null then
      insert into check_logs (booking_id, attempted_at, outcome, check_in_at, on_site_verified,
                              check_out_at, check_out_pressed_at, check_out_on_site, manager_finish_at)
      values (b.id, v_now, 'checked_in', v_arrival, false,
              p_actual_finish, case when p_actual_finish is not null then v_now end,
              case when p_actual_finish is not null then false end, p_actual_finish);
    elsif p_actual_finish is not null then
      update check_logs
         set check_out_at = p_actual_finish, check_out_pressed_at = v_now,
             check_out_on_site = false, manager_finish_at = p_actual_finish
       where id = cl.id;
    end if;
    update bookings set status = 'worked' where id = b.id and status = 'confirmed';

    -- The entry becomes a Late violation, reviewed and closed in one action.
    v.type := 'late';
    v.minutes_late := greatest(0, floor(extract(epoch from (v_arrival - sr.starts_at)) / 60)::int);
    v.actual_finish_at := p_actual_finish;
  end if;

  update violations
     set resolved = true,
         resolved_by = auth.uid(),
         resolved_at = v_now,
         resolution_note = btrim(p_note),
         type = v.type,
         minutes_late = v.minutes_late,
         actual_finish_at = v.actual_finish_at
   where id = v.id;

  return jsonb_build_object(
    'decision','resolved',
    'wasType', v_was,
    'nowType', v.type,
    'reclassified', v_was is distinct from v.type,
    'minutesLate', v.minutes_late,
    'arrivedAt', to_jsonb(v_arrival),
    'actualFinishAt', to_jsonb(v.actual_finish_at),
    -- RULE-06: the export is never corrected retroactively, so the screen warns.
    'payrollExported', v_exported,
    'messageKey', case when v_exported then 'resolved_payroll_already_exported' else 'resolved' end,
    'pay', (select pay from payable_shifts_v where booking_id = b.id));
end $$;

comment on function resolve_violation(uuid, text, timestamptz, timestamptz) is
  '§9.5 Resolve, with its mandatory note. No-show = "Get back" (§3.3): registers the arrival (manager-entered, or the press; required once the section has ended), optionally the finish, and reclassifies to Late (D17). No check-out takes the manager-entered finish, which settles RULE-02 and restores RULE-14''s floor.';

revoke execute on function resolve_violation(uuid, text, timestamptz, timestamptz) from public, anon;
grant  execute on function resolve_violation(uuid, text, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- 6 · The automatic client qualification on a CLOSED clean shift (D37)
--
-- §9.6: "when a worker completes a shift at a client with no unresolved
-- Violation against them". Completing is the finish — a recorded check-out
-- or a manager-entered one — not the check-in, which is when the booking
-- becomes `worked` and before a Late / Left early / No check-out exists.
-- The grant is looked at again when a violation is resolved (the existing
-- violations_grant_qualification trigger), and now when the check log
-- closes; the booking-status trigger is gone.
-- ---------------------------------------------------------------------
create or replace function public.grant_qualification_for_booking(p_booking uuid)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  with clean as (
    select ev.client_id, sr.role_id, b.staff_id, ev.id as event_id
      from bookings b
      join shift_requirements sr on sr.id = b.shift_id
      join events ev on ev.id = sr.event_id
     where b.id = p_booking
       and b.status = 'worked'
       -- The shift has closed: the accepted check log carries a finish.
       and exists (select 1 from check_logs c
                    where c.booking_id = b.id and c.check_in_at is not null
                      and coalesce(c.manager_finish_at, c.check_out_at) is not null)
       and not exists (select 1 from violations v
                        where v.booking_id = b.id and not v.resolved)
       and not exists (select 1 from client_qualifications q
                        where q.staff_id = b.staff_id
                          and q.client_id = ev.client_id
                          and q.do_not_return)
  )
  insert into client_qualifications
         (client_id, role_id, staff_id, granted_by, granted_from_event, granted_at)
  select clean.client_id, clean.role_id, clean.staff_id, null::uuid, clean.event_id, now()
    from clean
  on conflict (client_id, role_id, staff_id) do nothing
  returning id into v_id;

  return v_id;
end $$;

comment on function public.grant_qualification_for_booking(uuid) is
  '§9.6''s automatic client qualification: grants client + THE ROLE ACTUALLY WORKED once the shift has CLOSED (a recorded or manager-entered finish) with no unresolved violation (D37). Never over a do-not-return, never over a manual entry.';

revoke execute on function public.grant_qualification_for_booking(uuid) from public, anon, authenticated;

drop trigger if exists bookings_grant_qualification_t on bookings;
drop function if exists public.bookings_grant_qualification();

create or replace function public.check_logs_grant_qualification()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.check_in_at is not null
     and coalesce(new.manager_finish_at, new.check_out_at) is not null then
    perform grant_qualification_for_booking(new.booking_id);
  end if;
  return null;
end $$;

revoke execute on function public.check_logs_grant_qualification() from public, anon, authenticated;

drop trigger if exists check_logs_grant_qualification_t on check_logs;
create trigger check_logs_grant_qualification_t
after insert or update of check_out_at, manager_finish_at on check_logs
for each row execute function public.check_logs_grant_qualification();

-- ---------------------------------------------------------------------
-- 7 · staff_show_rate (D15), from 20260928110100
--
-- Byte for byte but for one condition: a No check-out raised only for the
-- stale-fix review (`stale_fix_review`) does not count against. RULE-14's
-- floor still waits for the manager; the show-rate does not. TypeScript
-- twin: showRate() in packages/domain/src/pay.ts (`staleFixReview`).
-- ---------------------------------------------------------------------
create or replace function public.staff_show_rate(p_staff uuid)
returns numeric
language sql
stable
set search_path = public, extensions
as $$
  with sample as (
    select b.id,
           exists (select 1 from violations v
                    where v.booking_id = b.id
                      and not v.resolved
                      and v.type in ('no_show', 'no_checkout')
                      and not v.stale_fix_review) as against
      from bookings b
     where b.staff_id = p_staff
       and (b.status in ('worked', 'turned_away')
            or exists (select 1 from violations v
                        where v.booking_id = b.id
                          and v.type = 'no_show'
                          and not v.resolved))
  )
  select case when count(*) = 0 then null
              else round(100.0 * count(*) filter (where not against) / count(*), 2)
         end
    from sample
$$;

comment on function public.staff_show_rate(uuid) is
  '§6 show-rate (reliability), percent 0–100, derived: shifts worked or turned away plus unresolved No-shows form the sample; an unresolved No-show (BG-03) or No check-out (RULE-14) counts against, except a No check-out raised only to review a stale on-site fix (violations.stale_fix_review, D15, ADR-0035); resolving lifts it; Late / Left early / Left the geofence weigh nothing (§9.5 "no automatic consequence"). NULL with no history — callers default to 90, the §6 zero point (20260928110100). TypeScript twin: showRate() in packages/domain/src/pay.ts.';
