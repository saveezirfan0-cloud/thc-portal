-- =====================================================================
-- Migration 0006 · the day of the shift (Scope of Work v1.6 §5.1–5.2b)
--
-- What this adds
-- --------------
-- Four *pure* decision functions, one RPC per button, and the payroll view:
--
--   check_in_decision()    §5.1  the gate order behind "Check in — verify GPS"
--   check_out_decision()   §5.1  which timestamp a check-out records, and when
--                                RULE-02 takes over instead
--   payable_minutes()      RULE-01 / 02 / 14  the pay window
--   turned_away_minutes()  RULE-15  flat 4 h on time, nothing if late
--   attempt_check_in()     the RPC: locks the role section, counts the slots,
--                          writes the CheckLog and the Violations
--   check_out()            the RPC: geofence, last on-site fix, RULE-02
--   payable_shifts_v       one row per booking that reached the day, priced
--
-- The four decision functions are deliberately pure (`immutable`, no table
-- access, every input a parameter) for two reasons: they are the half of the
-- rules that `packages/domain/pay.ts` repeats in TypeScript, and pgTAP can
-- therefore drive them straight from the shared vectors in
-- `packages/domain/src/pay.vectors.json` — see supabase/tests/070_check_in_out.sql.
-- Neither implementation is allowed to be the exception; the vectors decide.
--
-- Both RPCs pin `search_path` to `public, extensions`: pinning it is what makes
-- a security-definer function safe, and PostGIS sits in `public` here but in
-- `extensions` on a stock Supabase project, so `st_distance` has to resolve in
-- either.
--
-- The RPCs are `security definer` because a worker holds no insert policy on
-- check_logs or violations (0004_rls_gaps.sql, and the KNOWN GAP note in
-- tests/030_rls_staff.sql): the day of the shift is written through these two
-- functions or not at all. Each one re-checks that the caller is an admin or
-- the booking's own worker before it writes anything.
--
-- Numbering: 0003 stays reserved for the pg_cron schedules (docs/01 §4).
-- =====================================================================

-- ---------------------------------------------------------------------
-- §5.1 · CHECK-IN — the gate order
--
-- 1 too early       check-in opens 30 minutes before the role section start
-- 2 out of radius   a check-in needs a GPS fix inside the geofence; the
--                   attempt is still logged
-- 3 turned away     strict buffer and the headcount is already met (RULE-15).
--                   This sits ABOVE the lock because RULE-15 prices "a worker
--                   turned away who was themselves late", which is unreachable
--                   if the lock fires first.
-- 4 locked          at start+30 the grace has elapsed: automatic No-show and
--                   the button locks. Exempt: a booking confirmed AFTER the
--                   shift had started (§3.4 escalation replacement), whose
--                   button stays open until the shift ends.
-- 5 checked in      Late when the press is after the scheduled start, with the
--                   minutes counted from the actual press.
--
-- The grace is [start, start+30): at start+30 exactly it has elapsed, which is
-- the same boundary the wireframe states ("Check-in window 16:30 – 17:30" for
-- a 17:00 start).
-- ---------------------------------------------------------------------
create or replace function check_in_decision(
  p_starts_at        timestamptz,
  p_ends_at          timestamptz,
  p_at               timestamptz,
  p_inside_geofence  boolean,
  p_confirmed_at     timestamptz,
  p_slots_filled     int,
  p_headcount        int,
  p_strict_buffer    boolean
) returns jsonb language plpgsql immutable as $$
declare
  v_late        boolean := p_at > p_starts_at;
  v_minutes     int     := greatest(0, floor(extract(epoch from (p_at - p_starts_at)) / 60)::int);
  v_grace_ends  timestamptz := p_starts_at + interval '30 minutes';
  v_turn_away   int;
  v_locks_at    timestamptz;
begin
  if p_at < p_starts_at - interval '30 minutes' then
    return jsonb_build_object('decision','too_early','accepted',false,'logOutcome',null,
      'late',v_late,'minutesLate',v_minutes,'turnAwayPayMin',null,'messageKey','check_in_not_open');
  end if;

  if not p_inside_geofence then
    return jsonb_build_object('decision','out_of_radius','accepted',false,'logOutcome','out_of_radius',
      'late',v_late,'minutesLate',v_minutes,'turnAwayPayMin',null,'messageKey','out_of_radius');
  end if;

  if p_strict_buffer and p_slots_filled >= p_headcount then
    v_turn_away := turned_away_minutes(p_starts_at, p_at);
    return jsonb_build_object('decision','turned_away','accepted',false,'logOutcome','turned_away',
      'late',v_late,'minutesLate',v_minutes,'turnAwayPayMin',v_turn_away,
      'messageKey', case when v_turn_away > 0 then 'turned_away_paid' else 'turned_away_unpaid' end);
  end if;

  v_locks_at := case when p_confirmed_at is not null and p_confirmed_at > p_starts_at
                     then p_ends_at else v_grace_ends end;
  if p_at >= v_locks_at then
    return jsonb_build_object('decision','locked','accepted',false,'logOutcome',null,
      'late',v_late,'minutesLate',v_minutes,'turnAwayPayMin',null,'messageKey','no_show_locked');
  end if;

  return jsonb_build_object(
    'decision', case when v_late then 'checked_in_late' else 'checked_in' end,
    'accepted', true, 'logOutcome','checked_in',
    'late', v_late, 'minutesLate', v_minutes, 'turnAwayPayMin', null,
    'messageKey', case when v_late then 'checked_in_late' else 'checked_in' end);
end $$;

comment on function check_in_decision is
  'Pure §5.1 check-in gate. Mirrored by checkInDecision() in packages/domain/pay.ts; both are held to pay.vectors.json.';

-- ---------------------------------------------------------------------
-- RULE-15 · buffer turn-away pay
-- A flat four hours when the logged attempt is inside the grace, nothing once
-- it has elapsed. Never half the shift, never tied to the shift's length.
-- ---------------------------------------------------------------------
create or replace function turned_away_minutes(p_starts_at timestamptz, p_attempt_at timestamptz)
returns int language sql immutable as $$
  select case when p_attempt_at < p_starts_at + interval '30 minutes' then 240 else 0 end
$$;

comment on function turned_away_minutes is
  'RULE-15. Flat 4 h for a turn-away whose attempt was on time, nothing if late.';

-- ---------------------------------------------------------------------
-- §5.1 · CHECK-OUT
-- Open from the scheduled start until four hours after the scheduled end,
-- FROM ANYWHERE. The geofence decides only which timestamp is recorded:
-- on site, the press; off site, the last on-site fix from background tracking.
-- With no on-site fix after check-in the only candidate would be the check-in
-- itself — a zero-length shift — so the No check-out violation is raised on
-- the press instead (RULE-02, second trigger).
-- ---------------------------------------------------------------------
create or replace function check_out_decision(
  p_starts_at        timestamptz,
  p_ends_at          timestamptz,
  p_at               timestamptz,
  p_inside_geofence  boolean,
  p_check_in_at      timestamptz,
  p_last_on_site_at  timestamptz
) returns jsonb language sql immutable as $$
  select case
    when p_at < p_starts_at then
      jsonb_build_object('decision','not_started','recordedAt',null,
        'violation','none','messageKey','check_out_not_open')
    when p_at >= p_ends_at + interval '4 hours' then
      jsonb_build_object('decision','locked','recordedAt',null,
        'violation','no_checkout','messageKey','no_check_out_locked')
    when p_inside_geofence then
      jsonb_build_object('decision','recorded_on_site','recordedAt',to_jsonb(p_at),
        'violation','none','messageKey','checked_out')
    when p_last_on_site_at is not null then
      jsonb_build_object('decision','recorded_last_on_site','recordedAt',to_jsonb(p_last_on_site_at),
        'violation','none','messageKey','checked_out_off_site')
    else
      jsonb_build_object('decision','no_on_site_fix','recordedAt',to_jsonb(p_check_in_at),
        'violation','no_checkout','messageKey','no_check_out_office_confirms')
  end
$$;

comment on function check_out_decision is
  'Pure §5.1 check-out gate. Mirrored by checkOutDecision() in packages/domain/pay.ts; both are held to pay.vectors.json.';

-- ---------------------------------------------------------------------
-- RULE-01 / 02 / 14 · the pay window
--
-- Payable time = [check-in, check-out] ∩ [start, end], with the check-in grace
-- paying from the scheduled start, a check-out never paid past the scheduled
-- end, unpaid breaks deducted and the four-hour floor on top. The floor is
-- blocked by a Left early violation (resolved or not) and by a No check-out
-- violation for as long as it stays unresolved.
--
-- p_check_out_at null = no recorded finish and no manager-entered one: the
-- payable time is UNDETERMINED. There is no silent default (RULE-02).
-- ---------------------------------------------------------------------
create or replace function payable_minutes(
  p_starts_at         timestamptz,
  p_ends_at           timestamptz,
  p_check_in_at       timestamptz,
  p_check_out_at      timestamptz,
  p_unpaid_break_min  int     default 0,
  p_left_early        boolean default false,
  p_no_check_out      text    default 'none'      -- none | unresolved | resolved
) returns jsonb language plpgsql immutable as $$
declare
  v_from    timestamptz;
  v_to      timestamptz;
  v_worked  int;
  v_floor   boolean;
  v_payable int;
begin
  if p_check_out_at is null then
    return jsonb_build_object('status','undetermined','payableMin',null,'workedMin',null,
      'floorApplied',false,'lateCheckOutFlag',false);
  end if;

  v_from := case
    when p_check_in_at <= p_starts_at then p_starts_at                       -- early is not paid
    when p_check_in_at <  p_starts_at + interval '30 minutes' then p_starts_at -- grace pays from the start
    else p_check_in_at end;                                                  -- past it, the actual arrival
  v_to := least(p_check_out_at, p_ends_at);                                  -- never past the scheduled end

  -- Whole minutes, so a timesheet, the app and the payroll export cannot
  -- disagree in the seconds (and so SQL and TypeScript round identically).
  v_worked := round(greatest(0, greatest(0, extract(epoch from (v_to - v_from)) / 60)
                                - coalesce(p_unpaid_break_min, 0)))::int;

  v_floor   := not p_left_early and coalesce(p_no_check_out,'none') <> 'unresolved';
  v_payable := case when v_floor then greatest(v_worked, 240) else v_worked end;

  return jsonb_build_object(
    'status','settled',
    'payableMin', v_payable,
    'workedMin',  v_worked,
    'floorApplied', v_floor and v_payable > v_worked,
    'lateCheckOutFlag', extract(epoch from (p_check_out_at - p_ends_at)) / 60 > 15);
end $$;

comment on function payable_minutes is
  'RULE-01/02/14 pay window. Mirrored by payableMinutes() in packages/domain/pay.ts; both are held to pay.vectors.json.';

-- ---------------------------------------------------------------------
-- RPC · attempt_check_in(booking, lat, lng)
--
-- Every press of "Check in — verify GPS" lands here. It row-locks the role
-- section so two workers racing for the last slot under a strict buffer
-- cannot both win it (RULE-15), asks check_in_decision() what happens, and
-- then writes exactly what that decision implies:
--
--   logged attempt  every decision that produces a checklog_outcome (§1.5:
--                   CheckLog is one row per attempt). A press that never
--                   reached the button — too early, or locked — writes none.
--   booking status  accepted → worked · turned away → turned_away
--   violations      late check-in → `late` with the minutes
--                   locked out    → `no_show`, recorded once
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
  -- however many times the button is pressed, even though their booking has
  -- moved to `worked` by then.
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
  '§5.1 check-in RPC. Locks the role section, logs the attempt, applies the 30-minute grace, the No-show lock and the strict-buffer turn-away (RULE-15).';

-- ---------------------------------------------------------------------
-- RPC · check_out(booking, lat, lng)
--
-- The last on-site fix comes from background tracking (location_pings) and
-- can never be empty by construction: check-in is itself a GPS-verified
-- on-site fix (§5.1). When tracking produced nothing at all after check-in,
-- recording the check-in time would mean a zero-length shift, so RULE-02 is
-- raised on the press instead and a manager confirms the finish time.
--
-- Returns the decision plus what the confirmation screen shows (§5.1): worked
-- and payable minutes and the BASE hourly rate. Never holiday pay — the worker
-- sees the base rate only (§9.8).
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

  if v_recorded is not null then
    update check_logs
       set check_out_at        = v_recorded,
           check_out_pressed_at = v_now,
           check_out_on_site   = v_inside,
           last_on_site_at     = coalesce(v_last_site, last_on_site_at)
     where id = cl.id;
  end if;

  if d->>'violation' = 'no_checkout' then
    insert into violations (staff_id, booking_id, type, detected_at)
    select b.staff_id, b.id, 'no_checkout', v_now
     where not exists (select 1 from violations where booking_id = b.id and type = 'no_checkout');
  end if;

  -- Unpaid breaks only exist where the client does not pay for them (§5.2b).
  select coalesce(sum(extract(epoch from (coalesce(br.ended_at, v_recorded, v_now) - br.started_at)) / 60), 0)::int
    into v_break_min
    from breaks br where br.booking_id = b.id and not ev.pays_breaks;

  return d || jsonb_build_object(
    'distanceM', v_distance,
    'payRate',   sr.pay_rate,                      -- base rate only (§9.8)
    'pay',       payable_minutes(sr.starts_at, sr.ends_at, cl.check_in_at, v_recorded, v_break_min,
                   exists (select 1 from violations where booking_id = b.id and type = 'left_early'),
                   case when d->>'violation' = 'no_checkout' then 'unresolved' else 'none' end));
end $$;

comment on function check_out is
  '§5.1 check-out RPC. Open from the start until end+4h from anywhere; off site records the last on-site fix, and no fix at all raises RULE-02 on the press.';

grant execute on function attempt_check_in(uuid, double precision, double precision) to authenticated;
grant execute on function check_out(uuid, double precision, double precision) to authenticated;

-- ---------------------------------------------------------------------
-- VIEW · payable_shifts_v
--
-- One row per booking that reached the day of the shift, priced by the same
-- rules. `kind` says which rule paid it:
--   worked       RULE-01/02/14 through payable_minutes()
--   turned_away  RULE-15, decided by the logged attempt
--   no_show      nothing (RULE-14 never lifts someone who did not work)
--
-- The check-out used is the manager-entered finish when there is one, then the
-- recorded check-out (RULE-01). Holiday pay is not in this view at all: it is
-- broken out at 12.07% where the money is presented (§9.8), never blended in.
-- Security-invoker so the caller's policies apply — no client role holds one
-- on shift_requirements (0002), so no charge or pay rate can leak.
-- ---------------------------------------------------------------------
create or replace view payable_shifts_v with (security_invoker = true) as
with logs as (
  -- One row per booking: the successful check-in if there is one, otherwise
  -- the attempt that was turned away (RULE-15 prices that attempt), otherwise
  -- the first attempt of the day.
  select cl.*, row_number() over (
           partition by cl.booking_id
           order by cl.check_in_at nulls last, (cl.outcome = 'turned_away') desc, cl.attempted_at) as rn
    from check_logs cl
)
select
  b.id                as booking_id,
  b.staff_id,
  sr.id               as shift_id,
  sr.event_id,
  sr.starts_at,
  sr.ends_at,
  sr.pay_rate,                                          -- base rate (§9.8)
  sr.charge_rate,
  cl.check_in_at,
  coalesce(cl.manager_finish_at, cl.check_out_at) as check_out_at,
  cl.attempted_at,
  case when b.status = 'turned_away' then 'turned_away'
       when cl.check_in_at is not null then 'worked'
       else 'no_show' end                         as kind,
  br.unpaid_break_min,
  case
    when b.status = 'turned_away'
      then jsonb_build_object('status','settled',
             'payableMin', turned_away_minutes(sr.starts_at, cl.attempted_at),
             'workedMin', 0, 'floorApplied', false, 'lateCheckOutFlag', false)
    when cl.check_in_at is null
      then jsonb_build_object('status','settled','payableMin',0,'workedMin',0,
             'floorApplied',false,'lateCheckOutFlag',false)
    else payable_minutes(
           sr.starts_at, sr.ends_at, cl.check_in_at,
           coalesce(cl.manager_finish_at, cl.check_out_at),
           br.unpaid_break_min,
           exists (select 1 from violations v where v.booking_id = b.id and v.type = 'left_early'),
           case when exists (select 1 from violations v
                              where v.booking_id = b.id and v.type = 'no_checkout' and not v.resolved)
                then 'unresolved'
                when exists (select 1 from violations v
                              where v.booking_id = b.id and v.type = 'no_checkout')
                then 'resolved' else 'none' end)
  end                                             as pay
from bookings b
join shift_requirements sr on sr.id = b.shift_id
join events e on e.id = sr.event_id
left join logs cl on cl.booking_id = b.id and cl.rn = 1
cross join lateral (
  select coalesce(sum(extract(epoch from (
           coalesce(brk.ended_at, cl.manager_finish_at, cl.check_out_at, brk.started_at)
           - brk.started_at)) / 60), 0)::int as unpaid_break_min
    from breaks brk where brk.booking_id = b.id and not e.pays_breaks
) br
where e.cancelled_at is null
  -- A booking only becomes a No-show row once the check-in lock has passed;
  -- until then it is simply a shift that has not happened yet.
  and (b.status in ('worked','turned_away')
       or (b.status = 'confirmed' and sr.starts_at + interval '30 minutes' <= now()));

comment on view payable_shifts_v is
  'Priced shifts (§5.2, RULE-01/02/14/15). Payable time is calculated, never stored; a no check-out reads status=undetermined until a manager resolves it.';
