-- =====================================================================
-- Background tracking, the off-site violation, and the monitor's data path
-- (Scope of Work v1.6 §5.1, §9.5, §7 BG-06/07)
--
-- Why this exists
-- ---------------
-- `location_pings` has existed since 0001 and nothing has ever written a
-- row to it. Two things downstream were quietly degraded as a result:
--
--   * `check_out()` reads the last on-site fix from that table when the
--     button is pressed off site. With the table always empty, EVERY
--     off-site check-out fell through to RULE-02's second trigger and
--     raised a No check-out violation. Correct behaviour for "tracking
--     produced nothing", but it was the only behaviour available.
--   * `violation_type` has carried `left_geofence` since 0001 and nothing
--     could raise it, so §5.1's "the system records any exit from the
--     geofence during the shift" and §9.5's live Off-site status had no
--     source at all.
--
-- record_ping() closes both. It is the one write path into the table:
-- 0009 deliberately reduced even the admin policy to `admin_read`, because
-- `inside_geofence` is the last on-site fix behind RULE-01 pay and nobody
-- should be able to move a worker's money by hand.
--
-- An exit is recorded on the TRANSITION from inside to outside, not on
-- every outside ping. A phone sampling every minute from a café across the
-- road would otherwise write one violation per minute for the rest of the
-- shift, and §9.5 is explicit that a manager reviews each one by hand.
-- One row per exit is what "records any exit" can usefully mean.
--
-- checkin_monitor_v is the §9.5 table as a view, so the Status column's
-- rules live in SQL where pgTAP can hold them, and the screen renders what
-- it is given rather than re-deriving six states in TypeScript.
-- =====================================================================

-- ---------------------------------------------------------------------
-- §5.1 · record_ping(booking, lat, lng)
--
-- Called by the Staff App for the duration of the shift. `security
-- definer` for the same reason attempt_check_in is: nobody holds an insert
-- policy on location_pings, by design.
--
-- Tracking runs between check-in and check-out. Before check-in there is
-- no shift to track, and after check-out the worker's location is no
-- longer any of the system's business — §5.1 asks for proof the person was
-- on site for the shift, not a trail of where they went afterwards.
-- ---------------------------------------------------------------------
create or replace function record_ping(
  p_booking uuid,
  p_lat     double precision,
  p_lng     double precision
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  b           bookings;
  sr          shift_requirements;
  ev          events;
  cl          check_logs;
  v_point     geography(point,4326);
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
  else
    -- An exit is a transition. Check-in is itself a GPS-verified on-site
    -- fix (§5.1), so the first ping of a shift counts as coming from
    -- inside and a worker who walks off immediately still registers one.
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
  '§5.1 background tracking. The only write path into location_pings; raises left_geofence on the transition out of the venue (BG-06/07).';

grant execute on function record_ping(uuid, double precision, double precision) to authenticated;

-- ---------------------------------------------------------------------
-- §9.5 · checkin_monitor_v — the live monitor, as a view
--
-- One row per booking that is on today's board. The Status column is the
-- whole point of the screen, so its rules are here rather than in the
-- page:
--
--   checked_out          the shift closed normally; late_check_out marks the
--                        recorded finish more than 15 minutes past the end,
--                        which turns the pill red (§5.2 leaves the money
--                        alone — RULE-01 caps it at the scheduled end)
--   no_check_out         end + 4 h with nothing recorded: RULE-02 took over,
--                        the button locked, and this row stays here until a
--                        manager resolves the violation
--   off_site             checked in, and the last fix is outside the fence
--   on_shift             checked in and on site
--   not_checked_in       30 minutes BEFORE the start with no check-in — the
--                        red alert, and it keeps this label through the
--                        automatic No-show at start+30. §9.5 is explicit
--                        that there is no separate No-show pill
--   not_confirmed_today  a variant of Due for a worker who has not pressed
--                        the on-the-day confirmation (§3.5). They can still
--                        check in exactly like Due; it is visibility only
--   due                  waiting, amber
--
-- `breaks_count` and `last_break_at` are NULL — not 0 — where the client
-- pays for breaks, because the app holds no break data at all in that case
-- and §9.5 requires a dash rather than a zero: "no data" and "took no
-- breaks" must not look the same to a manager.
--
-- security_invoker, so the admin policies decide. No client holds a policy
-- on shift_requirements (0002), so no rate can leave through this view.
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
                                                                    as late_check_out,
  case
    when coalesce(cl.manager_finish_at, cl.check_out_at) is not null then 'checked_out'
    when cl.check_in_at is not null and now() >= sr.ends_at + interval '4 hours' then 'no_check_out'
    when cl.check_in_at is not null and ping.inside_geofence is false then 'off_site'
    when cl.check_in_at is not null then 'on_shift'
    when now() >= sr.starts_at - interval '30 minutes' then 'not_checked_in'
    when b.on_day_confirmed_at is null and sr.starts_at::date = (now() at time zone 'Europe/London')::date
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
  '§9.5 live monitor. One row per booking with the Status column resolved in SQL; breaks read NULL, never 0, where the client pays for them.';
