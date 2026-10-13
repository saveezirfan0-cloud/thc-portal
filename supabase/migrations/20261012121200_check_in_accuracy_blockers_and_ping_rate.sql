-- =====================================================================
-- Migration 20261012121200 · check-in hears the GPS accuracy and the
--                            worker's blockers; pings are rate-limited
--                            (§5.1, §5.2, §9.5, §10.1, RULE-20)
--
-- Staff App audit 12.10.2026:
--
--   M2 · A check-in fix was taken at face value. A spoofed location (a
--        browser devtools override, a mock-location app) lands exactly on
--        the venue's centre with no accuracy, or a coarse cell fix 2 km
--        wide is counted as "inside a 150 m fence". The apps already read
--        GeolocationCoordinates.accuracy and send it as p_accuracy
--        (apps/staff/app/shifts/[id]/actions.ts); the database dropped it.
--        Now:
--          · attempt_check_in, check_out and record_ping take a trailing
--            `p_accuracy double precision default null` (metres). The old
--            three-argument calls still resolve to the same function (the
--            default), so nothing calling them breaks. Dropped and
--            re-created, because a new argument cannot be added in place;
--            grants restated as 20260922183013 left them (authenticated,
--            service_role; never anon or PUBLIC).
--          · check_logs.accuracy_m (the check-in fix),
--            check_logs.check_out_accuracy_m, location_pings.accuracy_m.
--            A non-finite, negative or > 100 km value is stored as null.
--          · check_logs.location_suspect — FLAG ONLY, it never refuses a
--            check-in (§5.1 decides on the geofence as before): true when
--            the check-in fix has no accuracy, an accuracy wider than the
--            venue's geofence radius, or lands within 1 m of the venue's
--            centre (a pasted coordinate, not a phone); and set by an
--            on-site check-out fix that fails the same test.
--          · checkin_monitor_v.location_suspect (appended), so the §9.5
--            monitor can mark the row for the manager.
--
--   M2b · record_ping() accepted a fix as often as it was posted. A ping
--        less than 20 seconds after the booking's previous one is now
--        ignored: no row, no error, decision 'too_soon'.
--
--   18 · attempt_check_in() asked only staff.status = 'compliant'. The
--        Staff App's lock (profile/lock.ts locksCompliantWorker) closes
--        Shifts on a compliant worker with a `document_expired:*` or
--        `conviction_unreviewed` blocker — the window before the 05:00
--        sweep blocks the row — and canRoster() is a per-shift hard stop
--        on the right-to-work date (RULE-20). A worker calling the RPC
--        directly walked past both. Now either refuses with the existing
--        P0001 'staff_not_compliant' (the app already words it). A
--        `document_unverified:*` blocker does not lock (a replacement in
--        review; lock.ts says why), and a shift already under way is not
--        stopped — check_out, breaks and pings still do not ask (D16).
--
-- The three functions resolve the caller's own worker through
-- staff_caller() now (20261012120400: a live session, an unbanned login).
-- Everything else is the live body (20260930100000 / 20260927160600)
-- unchanged. 798_check_in_accuracy_blockers_and_ping_rate pins it; 240
-- and 650 age the trail between pings.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · Columns
-- ---------------------------------------------------------------------
alter table check_logs
  add column if not exists accuracy_m           numeric(9,1),
  add column if not exists check_out_accuracy_m numeric(9,1),
  add column if not exists location_suspect     boolean not null default false;
alter table location_pings
  add column if not exists accuracy_m numeric(9,1);

comment on column check_logs.accuracy_m is
  '20261012121200: the reported accuracy (metres) of the check-in fix, as the phone gave it; null when none was sent or it was not a sane number.';
comment on column check_logs.check_out_accuracy_m is
  '20261012121200: the reported accuracy (metres) of the check-out fix.';
comment on column check_logs.location_suspect is
  '20261012121200 (§9.5): a flag for the manager, never a refusal — the check-in fix had no accuracy, one wider than the geofence radius, or sat within 1 m of the venue centre; or an on-site check-out fix failed the same test.';
comment on column location_pings.accuracy_m is
  '20261012121200: the reported accuracy (metres) of this fix.';

-- ---------------------------------------------------------------------
-- 2 · Helpers
-- ---------------------------------------------------------------------
create or replace function public.location_accuracy_m(p_accuracy double precision)
returns numeric
language sql
immutable
set search_path = public, extensions
as $$
  select case when p_accuracy >= 0 and p_accuracy <= 100000 and p_accuracy <> 'NaN'::double precision
              then round(p_accuracy::numeric, 1) end
$$;

create or replace function public.location_fix_suspect(p_accuracy_m numeric, p_radius_m int, p_distance_m numeric)
returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  select p_accuracy_m is null
      or p_accuracy_m > p_radius_m
      or coalesce(p_distance_m <= 1, false)
$$;

comment on function public.location_accuracy_m(double precision) is
  '20261012121200: a reported GPS accuracy in metres, rounded to 0.1, or null when it is not a finite number between 0 and 100 km.';
comment on function public.location_fix_suspect(numeric, int, numeric) is
  '20261012121200 (§9.5): true for a fix with no accuracy, an accuracy wider than the geofence radius, or one within 1 m of the venue centre. A flag, never a refusal.';

revoke execute on function public.location_accuracy_m(double precision)       from public, anon;
revoke execute on function public.location_fix_suspect(numeric, int, numeric) from public, anon;
grant  execute on function public.location_accuracy_m(double precision)       to authenticated, service_role;
grant  execute on function public.location_fix_suspect(numeric, int, numeric) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3 · The three on-shift RPCs, with p_accuracy
-- ---------------------------------------------------------------------
drop function if exists public.attempt_check_in(uuid, double precision, double precision);
drop function if exists public.check_out(uuid, double precision, double precision);
drop function if exists public.record_ping(uuid, double precision, double precision);

create function public.attempt_check_in(p_booking uuid, p_lat double precision, p_lng double precision, p_accuracy double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
  v_accuracy  numeric := location_accuracy_m(p_accuracy);
  v_suspect   boolean;
begin
  select * into b from bookings where id = p_booking;
  if b.id is null then raise exception 'booking_not_found' using errcode = 'P0002'; end if;

  if current_app_role() is distinct from 'admin'
     and b.staff_id is distinct from staff_caller() then
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
  -- 20261012121200: compliant on the row is not enough. The Staff App's
  -- lock (apps/staff/app/profile/lock.ts, §10.1 case 1) closes Shifts on
  -- an expired document or an unreviewed conviction before the 05:00
  -- sweep blocks the row, and canRoster() is a per-shift hard stop on the
  -- right-to-work date (RULE-20, CLAUDE.md). The database now agrees.
  if exists (select 1 from compliance_blockers(b.staff_id, (v_now at time zone 'Europe/London')::date) x
              where x.reason like 'document_expired:%' or x.reason = 'conviction_unreviewed')
     or not can_roster_staff(b.staff_id, (sr.starts_at at time zone 'Europe/London')::date) then
    raise exception 'staff_not_compliant' using errcode = 'P0001';
  end if;

  v_point    := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  v_distance := round(st_distance(v_point, ev.venue_location)::numeric, 1);
  v_inside   := v_distance <= ev.geofence_radius_m;
  v_suspect  := location_fix_suspect(v_accuracy, ev.geofence_radius_m, v_distance);

  select count(*) into v_slots
    from check_logs cl join bookings b2 on b2.id = cl.booking_id
   where b2.shift_id = sr.id and cl.outcome = 'checked_in';

  d := check_in_decision(sr.starts_at, sr.ends_at, v_now, v_inside, b.confirmed_at,
                         v_slots, sr.headcount, not ev.pays_buffer);

  if d->>'logOutcome' is not null then
    insert into check_logs (booking_id, attempted_at, outcome, location, distance_m,
                            check_in_at, on_site_verified, accuracy_m, location_suspect)
    values (b.id, v_now, (d->>'logOutcome')::checklog_outcome, v_point, v_distance,
            case when (d->>'accepted')::boolean then v_now end, v_inside, v_accuracy, v_suspect);
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
end $function$;

create function public.check_out(p_booking uuid, p_lat double precision, p_lng double precision, p_accuracy double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
  v_accuracy   numeric := location_accuracy_m(p_accuracy);
begin
  select * into b from bookings where id = p_booking;
  if b.id is null then raise exception 'booking_not_found' using errcode = 'P0002'; end if;

  if current_app_role() is distinct from 'admin'
     and b.staff_id is distinct from staff_caller() then
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
           last_on_site_at     = coalesce(v_last_site, last_on_site_at),
           check_out_accuracy_m = v_accuracy,
           -- 20261012121200: an on-site check-out fix is held to the same
           -- test as the check-in one. Flag only.
           location_suspect    = location_suspect
                                 or (coalesce(v_inside, false)
                                     and location_fix_suspect(v_accuracy, ev.geofence_radius_m, v_distance))
     where id = cl.id;

    -- §5.2b: a break the worker never finished ends when the shift does.
    update breaks set ended_at = greatest(v_recorded, started_at)
     where booking_id = b.id and ended_at is null;
  end if;

  v_break_min := unpaid_break_minutes(b.id);

  return d || jsonb_build_object(
    'distanceM', v_distance,
    'payRate',   case when (select current_app_role() is distinct from 'admin'::app_role or office_can('finance')) then effective_pay_rate(b.staff_id, sr.pay_rate) end,                      -- base rate only (§9.8)
    'unpaidBreakMin', v_break_min,
    'pay',       payable_minutes(sr.starts_at, sr.ends_at, cl.check_in_at, v_recorded, v_break_min,
                   exists (select 1 from violations where booking_id = b.id and type = 'left_early'),
                   case when exists (select 1 from violations
                                      where booking_id = b.id and type = 'no_checkout' and not resolved)
                        then 'unresolved' else 'none' end));
end $function$;

create function public.record_ping(p_booking uuid, p_lat double precision, p_lng double precision, p_accuracy double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  b           bookings;
  sr          shift_requirements;
  ev          events;
  cl          check_logs;
  v_point     geography;
  v_distance  numeric;
  v_inside    boolean;
  v_was_inside boolean;
  v_now       timestamptz := now();
  v_exit      boolean := false;
  v_last_at   timestamptz;
begin
  select * into b from bookings where id = p_booking;
  if b.id is null then raise exception 'booking_not_found' using errcode = 'P0002'; end if;

  if current_app_role() is distinct from 'admin'
     and b.staff_id is distinct from staff_caller() then
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
    return jsonb_build_object('decision','tracking_finished','messageKey','tracking_finished');
  end if;

  -- 20261012121200: one fix per booking per 20 seconds. A faster stream
  -- is ignored — no row, no error — so a script cannot fill the trail
  -- (or bury a real exit) by posting as fast as it likes. The check-log
  -- row is locked above, so two concurrent pings queue here.
  select max(p.at) into v_last_at from location_pings p where p.booking_id = b.id;
  if v_last_at is not null and v_now < v_last_at + interval '20 seconds' then
    return jsonb_build_object('decision','too_soon','messageKey','too_soon');
  end if;

  v_point    := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  v_distance := round(st_distance(v_point, ev.venue_location)::numeric, 1);
  v_inside   := v_distance <= ev.geofence_radius_m;

  -- The state before this fix, for the transition test below.
  --
  -- Ordered by id as well as time, and it matters: two fixes can share an
  -- instant (a phone flushing a queued batch, or anything running inside
  -- one transaction, where now() does not move). On `at` alone the "most
  -- recent" row is then whichever the planner happens to return, and the
  -- transition test silently becomes a coin toss that writes violations.
  -- location_pings.id is an identity column, so it is insertion order —
  -- exactly the tiebreak this needs.
  select p.inside_geofence into v_was_inside
    from location_pings p
   where p.booking_id = b.id and p.at >= cl.check_in_at
   order by p.at desc, p.id desc limit 1;

  insert into location_pings (booking_id, at, location, inside_geofence, accuracy_m)
  values (b.id, v_now, v_point, v_inside, location_accuracy_m(p_accuracy));

  if v_inside then
    -- Keeps RULE-01's fallback cheap: check_out() can read one column
    -- instead of scanning the trail.
    update check_logs set last_on_site_at = v_now where id = cl.id;
  elsif v_now < sr.ends_at then
    -- An exit is a transition, and only DURING the shift (BG-07, §9.5:
    -- "walks off site mid-shift without checking out"). Leaving after the
    -- section's own end is going home; check-out from anywhere is the
    -- ordinary case then (§5.2). Check-in is itself a GPS-verified
    -- on-site fix (§5.1), so the first ping of a shift counts as coming
    -- from inside and a worker who walks off immediately still registers.
    v_exit := coalesce(v_was_inside, true);
    if v_exit then
      insert into violations (staff_id, booking_id, type, detected_at)
      values (b.staff_id, b.id, 'left_geofence', v_now);
    end if;
  end if;

  return jsonb_build_object(
    'decision', case when v_inside then 'on_site' else 'off_site' end,
    'insideGeofence', v_inside,
    'distanceM', v_distance,
    'geofenceRadiusM', ev.geofence_radius_m,
    'exitRecorded', v_exit,
    'messageKey', case when v_inside then 'on_site' else 'off_site' end);
end $function$;

revoke execute on function public.attempt_check_in(uuid, double precision, double precision, double precision) from public, anon;
revoke execute on function public.check_out(uuid, double precision, double precision, double precision)        from public, anon;
revoke execute on function public.record_ping(uuid, double precision, double precision, double precision)      from public, anon;
grant  execute on function public.attempt_check_in(uuid, double precision, double precision, double precision) to authenticated, service_role;
grant  execute on function public.check_out(uuid, double precision, double precision, double precision)        to authenticated, service_role;
grant  execute on function public.record_ping(uuid, double precision, double precision, double precision)      to authenticated, service_role;

comment on function public.attempt_check_in(uuid, double precision, double precision, double precision) is
  '§5.1 check-in (RULE-15, D16). 20261012121200: p_accuracy (metres, optional) is stored and sets check_logs.location_suspect (flag only); a compliant worker with an expired document, an unreviewed conviction or no right to work on the shift day (can_roster_staff) is refused staff_not_compliant.';
comment on function public.check_out(uuid, double precision, double precision, double precision) is
  '§5.1/§5.2 check-out (RULE-01/02). 20261012121200: p_accuracy (metres, optional) is stored; an on-site check-out fix that fails location_fix_suspect() sets check_logs.location_suspect.';
comment on function public.record_ping(uuid, double precision, double precision, double precision) is
  '§5.1 tracking fix. 20261012121200: p_accuracy (metres, optional) is stored; a fix less than 20 seconds after the booking''s previous one is ignored (decision too_soon, no row, no error).';

-- ---------------------------------------------------------------------
-- 4 · The §9.5 monitor shows the flag (appended column)
-- ---------------------------------------------------------------------
create or replace view public.checkin_monitor_v with (security_invoker = true) as
 WITH logs AS (
         SELECT cl_1.id,
            cl_1.booking_id,
            cl_1.attempted_at,
            cl_1.outcome,
            cl_1.location,
            cl_1.distance_m,
            cl_1.check_in_at,
            cl_1.check_out_at,
            cl_1.check_out_pressed_at,
            cl_1.check_out_on_site,
            cl_1.last_on_site_at,
            cl_1.manager_finish_at,
            cl_1.on_site_verified,
            cl_1.location_suspect,
            row_number() OVER (PARTITION BY cl_1.booking_id ORDER BY cl_1.check_in_at, cl_1.attempted_at) AS rn
           FROM check_logs cl_1
        )
 SELECT b.id AS booking_id,
    b.staff_id,
    sr.event_id,
    sr.id AS shift_id,
    e.title AS event_title,
    r.name AS role_name,
        CASE
            WHEN s.removed_at IS NULL THEN (s.first_name || ' '::text) || s.last_name
            ELSE 'Deleted account #'::text || s.employee_id
        END AS staff_name,
        CASE
            WHEN s.removed_at IS NULL THEN s.photo_path
            ELSE NULL::text
        END AS photo_path,
    sr.starts_at,
    sr.ends_at,
    cl.check_in_at,
    COALESCE(cl.manager_finish_at, cl.check_out_at) AS check_out_at,
    b.on_day_confirmed_at,
    ping.inside_geofence AS last_fix_inside,
    ping.at AS last_fix_at,
        CASE
            WHEN e.pays_breaks THEN NULL::integer
            ELSE brk.n
        END AS breaks_count,
        CASE
            WHEN e.pays_breaks THEN NULL::timestamp with time zone
            ELSE brk.last_at
        END AS last_break_at,
    COALESCE(cl.manager_finish_at, cl.check_out_at) IS NOT NULL AND COALESCE(cl.manager_finish_at, cl.check_out_at) > (sr.ends_at + '00:15:00'::interval) AND NOT (EXISTS ( SELECT 1
           FROM violations v
          WHERE v.booking_id = b.id AND v.type = 'no_checkout'::violation_type AND NOT v.resolved)) AS late_check_out,
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM violations v
              WHERE v.booking_id = b.id AND v.type = 'no_checkout'::violation_type AND NOT v.resolved)) THEN 'no_check_out'::text
            WHEN COALESCE(cl.manager_finish_at, cl.check_out_at) IS NOT NULL THEN 'checked_out'::text
            WHEN cl.check_in_at IS NOT NULL AND now() >= (sr.ends_at + '04:00:00'::interval) THEN 'no_check_out'::text
            WHEN cl.check_in_at IS NOT NULL AND ping.inside_geofence IS FALSE AND now() < sr.ends_at THEN 'off_site'::text
            WHEN cl.check_in_at IS NOT NULL THEN 'on_shift'::text
            WHEN now() >= (sr.starts_at - '00:30:00'::interval) THEN 'not_checked_in'::text
            WHEN b.on_day_confirmed_at IS NULL AND (sr.starts_at AT TIME ZONE 'Europe/London'::text)::date = (now() AT TIME ZONE 'Europe/London'::text)::date THEN 'not_confirmed_today'::text
            ELSE 'due'::text
        END AS status,
    COALESCE(cl.location_suspect, false) AS location_suspect
   FROM bookings b
     JOIN shift_requirements sr ON sr.id = b.shift_id
     JOIN events e ON e.id = sr.event_id
     JOIN roles r ON r.id = sr.role_id
     JOIN staff s ON s.id = b.staff_id
     LEFT JOIN logs cl ON cl.booking_id = b.id AND cl.rn = 1
     LEFT JOIN LATERAL ( SELECT p.inside_geofence,
            p.at
           FROM location_pings p
          WHERE p.booking_id = b.id AND (cl.check_in_at IS NULL OR p.at > cl.check_in_at)
          ORDER BY p.at DESC, p.id DESC
         LIMIT 1) ping ON true
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS n,
            max(bk.started_at) AS last_at
           FROM breaks bk
          WHERE bk.booking_id = b.id) brk ON true
  WHERE e.cancelled_at IS NULL AND (b.status = ANY (ARRAY['confirmed'::booking_status, 'worked'::booking_status]));
