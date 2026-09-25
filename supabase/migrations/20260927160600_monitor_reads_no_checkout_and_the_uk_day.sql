-- =====================================================================
-- Migration 20260927160600 · the live monitor and background tracking,
--                            three corrections (§9.5, §5.1, BG-07,
--                            RULE-02, RULE-18, §1.8)
--
-- 1 · "Left the geofence DURING the shift" (BG-07, §9.5). record_ping()
--     raised left_geofence on any inside→outside transition while no
--     check-out was recorded — with no test against the section's end.
--     ShiftScreen sends a fix on mount, so a worker who left at the
--     scheduled end and opened the app on the bus to check out was
--     flagged for walking off site mid-shift, and then carried RULE-02's
--     no-on-site-fix violation as well. The ping is still stored (it is
--     the last-on-site trail RULE-01 reads); the violation is raised only
--     while v_now < sr.ends_at (the ROLE section's end, RULE-18).
--
-- 2 · "No check-out (red — … the row stays in this state until a manager
--     resolves that violation)". RULE-02's second trigger — check-out
--     pressed off-site with no on-site fix after check-in — raises the
--     violation immediately and check_out() records check_out_at = the
--     check-in stamp, so checkin_monitor_v's first arm resolved the row
--     as a neutral 'checked_out' at the check-in time. An unresolved
--     no_checkout violation now wins, ahead of that arm, whichever
--     trigger raised it; end + 4 h with nothing recorded stays as the
--     fallback.
--
-- 3 · "Not confirmed today" was decided in the SESSION zone.
--     `sr.starts_at::date` casts in TimeZone (UTC on Supabase) and was
--     compared with the Europe/London date, so during BST a section
--     starting 00:00–00:59 London read as the previous day: the evening
--     before it showed 'not_confirmed_today' for tomorrow's shift, and on
--     the day it showed 'due' although nobody had pressed the on-the-day
--     confirmation. Both sides are now Europe/London (§1.8).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · record_ping, from 20260922090000
-- ---------------------------------------------------------------------
create or replace function record_ping(p_booking uuid, p_lat double precision, p_lng double precision)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
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
    return jsonb_build_object('decision','tracking_finished','messageKey','tracking_finished');
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

  insert into location_pings (booking_id, at, location, inside_geofence)
  values (b.id, v_now, v_point, v_inside);

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
end $$;

comment on function record_ping is
  '§5.1 background tracking. The only write path into location_pings; raises left_geofence on the transition out of the venue while the ROLE section is still running (BG-06/07, RULE-18) — an exit after the section''s end is going home, not a violation.';

-- ---------------------------------------------------------------------
-- 2 + 3 · checkin_monitor_v, from 20260922090000
-- ---------------------------------------------------------------------
create or replace view checkin_monitor_v with (security_invoker = true) as
with logs as (
  select cl.*, row_number() over (
           partition by cl.booking_id
           order by cl.check_in_at nulls last, cl.attempted_at) as rn
    from check_logs cl
)
select
  b.id                                   as booking_id,
  b.staff_id,
  sr.event_id,
  sr.id                                  as shift_id,
  e.title                                as event_title,
  r.name                                 as role_name,
  case when s.removed_at is null then s.first_name || ' ' || s.last_name
       else 'Deleted account #' || s.employee_id end                as staff_name,
  case when s.removed_at is null then s.photo_path end              as photo_path,
  sr.starts_at,                                                     -- the ROLE section's own window (RULE-18)
  sr.ends_at,
  cl.check_in_at,
  coalesce(cl.manager_finish_at, cl.check_out_at)                   as check_out_at,
  b.on_day_confirmed_at,
  ping.inside_geofence                                              as last_fix_inside,
  ping.at                                                           as last_fix_at,
  case when e.pays_breaks then null else brk.n end                  as breaks_count,
  case when e.pays_breaks then null else brk.last_at end            as last_break_at,
  coalesce(cl.manager_finish_at, cl.check_out_at) is not null
    and coalesce(cl.manager_finish_at, cl.check_out_at) > sr.ends_at + interval '15 minutes'
    and not exists (select 1 from violations v
                     where v.booking_id = b.id and v.type = 'no_checkout' and not v.resolved)
                                                                    as late_check_out,
  case
    -- RULE-02, either trigger: an open No check-out holds the row red until
    -- a manager resolves it, whatever check_out() recorded.
    when exists (select 1 from violations v
                  where v.booking_id = b.id and v.type = 'no_checkout' and not v.resolved)
      then 'no_check_out'
    when coalesce(cl.manager_finish_at, cl.check_out_at) is not null then 'checked_out'
    when cl.check_in_at is not null and now() >= sr.ends_at + interval '4 hours' then 'no_check_out'
    when cl.check_in_at is not null and ping.inside_geofence is false then 'off_site'
    when cl.check_in_at is not null then 'on_shift'
    when now() >= sr.starts_at - interval '30 minutes' then 'not_checked_in'
    when b.on_day_confirmed_at is null
     and (sr.starts_at at time zone 'Europe/London')::date = (now() at time zone 'Europe/London')::date
      then 'not_confirmed_today'
    else 'due'
  end                                                               as status
from bookings b
join shift_requirements sr on sr.id = b.shift_id
join events e on e.id = sr.event_id
join roles r on r.id = sr.role_id
join staff s on s.id = b.staff_id
left join logs cl on cl.booking_id = b.id and cl.rn = 1
left join lateral (
  select p.inside_geofence, p.at from location_pings p
   where p.booking_id = b.id and (cl.check_in_at is null or p.at > cl.check_in_at)
   order by p.at desc, p.id desc limit 1
) ping on true
left join lateral (
  select count(*)::int as n, max(bk.started_at) as last_at
    from breaks bk where bk.booking_id = b.id
) brk on true
where e.cancelled_at is null
  and b.status in ('confirmed', 'worked');

comment on view checkin_monitor_v is
  '§9.5 live monitor. One row per booking with the Status column resolved in SQL: an unresolved No check-out violation (RULE-02, either trigger) reads no_check_out ahead of anything check_out() recorded; "today" is Europe/London on both sides (§1.8); breaks read NULL, never 0, where the client pays for them.';
