-- =====================================================================
-- The write paths behind the check-in monitor and the on-shift screen
-- (Scope of Work v1.6 §5.2b and §9.5)
--
-- Why this exists
-- ---------------
-- `0006_checkin_checkout.sql` shipped the pay maths and the two worker
-- buttons. Two of the inputs that maths reads had no way of ever being
-- written:
--
--   * `breaks` — payable_shifts_v deducts unpaid break minutes (§5.2b), but
--     nothing could create a break row. A worker holds no insert policy on
--     the table, by design.
--   * `check_logs.manager_finish_at` — RULE-02 leaves a shift's payable time
--     UNDETERMINED until a manager enters the actual finish, and RULE-14 puts
--     the four-hour floor back once they do. Nothing could enter it, so an
--     unresolved No check-out could never settle and payroll could never pay
--     that shift.
--
-- This migration adds the three functions that close those paths, plus the
-- one behaviour change they imply on check_out().
--
--   start_break(booking)                    §5.2b
--   finish_break(booking)                   §5.2b
--   resolve_violation(violation, note, …)   §9.5, RULE-02, RULE-14
--
-- Security posture, and the difference between the two halves
-- -----------------------------------------------------------
-- The break functions are `security definer`, for the same reason
-- attempt_check_in() is: they are pressed by the worker, and a worker holds
-- no insert policy on `breaks` (0004_rls_gaps.sql, and the note in
-- tests/030_rls_staff.sql). The day of the shift is written through these
-- functions or not at all.
--
-- resolve_violation() is deliberately `security invoker`. It is pressed by a
-- manager, and `admin_all` on violations and check_logs (0001) already
-- authorises every row it touches, so a definer would buy nothing and would
-- add to the debt docs/00 records under "no table sets FORCE ROW LEVEL
-- SECURITY": each definer routine is another owner that has to be given a
-- role of its own before RLS can be forced. It still checks the caller is an
-- admin, so the failure is a clear error rather than a silent zero-row update.
--
-- Every function pins its search_path, per 20260921130156.
-- =====================================================================

-- ---------------------------------------------------------------------
-- §5.2b · BREAKS
--
-- Breaks exist only where the client does NOT pay for them. Where the client
-- pays, the worker logs nothing and the app shows no buttons at all, so a
-- call here is a programming error rather than a state to report.
--
-- Start break unlocks at check-in ("you cannot be on a break you never
-- started a shift for") and stays available right through until the worker
-- actually checks out — it is not tied to the scheduled end and does not
-- disappear when the shift runs long. Several breaks per shift are allowed,
-- but only one at a time.
-- ---------------------------------------------------------------------
create or replace function start_break(p_booking uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  b        bookings;
  ev       events;
  cl       check_logs;
  v_now    timestamptz := now();
  v_break  uuid;
begin
  select * into b from bookings where id = p_booking;
  if b.id is null then raise exception 'booking_not_found' using errcode = 'P0002'; end if;

  if current_app_role() is distinct from 'admin'
     and b.staff_id is distinct from (select id from staff where user_id = auth.uid()) then
    raise exception 'not_your_booking' using errcode = '42501';
  end if;

  select e.* into ev from events e
    join shift_requirements sr on sr.event_id = e.id
   where sr.id = b.shift_id;
  if ev.pays_breaks then
    -- §3.2 / §5.2b: this client pays for breaks, so there is nothing to log.
    raise exception 'breaks_paid_by_client' using errcode = 'P0001';
  end if;

  select * into cl from check_logs
   where booking_id = b.id and check_in_at is not null
   order by check_in_at limit 1 for update;
  if cl.id is null then
    raise exception 'not_checked_in' using errcode = 'P0001';   -- "Unlocks after check-in"
  end if;
  if cl.check_out_at is not null then
    raise exception 'already_checked_out' using errcode = 'P0001';
  end if;

  if exists (select 1 from breaks where booking_id = b.id and ended_at is null) then
    return jsonb_build_object('decision','already_on_break','messageKey','already_on_break');
  end if;

  insert into breaks (booking_id, started_at) values (b.id, v_now) returning id into v_break;

  return jsonb_build_object(
    'decision','on_break', 'breakId', v_break, 'startedAt', to_jsonb(v_now),
    'breakCount', (select count(*)::int from breaks where booking_id = b.id),
    'messageKey','on_break');
end $$;

comment on function start_break is
  '§5.2b. Opens a break. Unlocks at check-in, stays available until check-out, one open break at a time, and only where the client does not pay for breaks.';

-- ---------------------------------------------------------------------
-- Finish break — "Finish break — back to work".
-- Returns the total unpaid break minutes so the on-shift screen and the
-- monitor's Breaks column read the same number the pay window deducts.
-- ---------------------------------------------------------------------
create or replace function finish_break(p_booking uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  b       bookings;
  br      breaks;
  v_now   timestamptz := now();
begin
  select * into b from bookings where id = p_booking;
  if b.id is null then raise exception 'booking_not_found' using errcode = 'P0002'; end if;

  if current_app_role() is distinct from 'admin'
     and b.staff_id is distinct from (select id from staff where user_id = auth.uid()) then
    raise exception 'not_your_booking' using errcode = '42501';
  end if;

  select * into br from breaks
   where booking_id = b.id and ended_at is null
   order by started_at desc limit 1 for update;
  if br.id is null then
    return jsonb_build_object('decision','not_on_break','messageKey','not_on_break');
  end if;

  update breaks set ended_at = v_now where id = br.id;

  return jsonb_build_object(
    'decision','break_finished', 'breakId', br.id,
    'startedAt', to_jsonb(br.started_at), 'endedAt', to_jsonb(v_now),
    'breakMin', round(extract(epoch from (v_now - br.started_at)) / 60)::int,
    'totalUnpaidBreakMin', unpaid_break_minutes(b.id),
    'messageKey','break_finished');
end $$;

comment on function finish_break is
  '§5.2b. Closes the open break. The total it returns is the same figure payable_shifts_v deducts.';

-- ---------------------------------------------------------------------
-- The one figure both the screens and the pay window read.
--
-- An OPEN break — the worker pressed Start break and never pressed Finish —
-- runs to the recorded check-out, so the time still counts against pay. The
-- alternative, ignoring it, pays for a break that was taken. Neither reading
-- is written down in §5.2b; this is the conservative one and it is recorded
-- as an open question in docs/14-open-questions.md.
-- ---------------------------------------------------------------------
create or replace function unpaid_break_minutes(p_booking uuid)
returns int language sql stable set search_path = public, extensions as $$
  select coalesce(sum(
           round(extract(epoch from (
             coalesce(br.ended_at, cl.manager_finish_at, cl.check_out_at, now()) - br.started_at
           )) / 60)
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
  '§5.2b. Total unpaid break minutes for a booking. An unfinished break runs to the recorded check-out.';

-- ---------------------------------------------------------------------
-- §9.5 · RESOLVE A VIOLATION
--
-- Every one of the five types carries Resolve with a MANDATORY note. The note
-- is never write-only: resolving cancels a show-rate penalty, so the reasoning
-- and its author stay on the entry afterwards.
--
-- Two types resolve to more than a note:
--
--   no_show      Resolve is the same action as "Get back" on the event roster
--                (§3.3): it registers the worker as arrived and reclassifies
--                the entry from No-show to Late, with the minutes-late figure
--                taken from the moment the manager pressed it. The arrival is
--                recorded as a CheckLog with on_site_verified false — a
--                manager vouched for it, GPS did not.
--
--   no_checkout  Resolve additionally requires the actual finish date and
--                time. That value becomes the shift's check-out for RULE-01,
--                replacing the old behaviour of silently defaulting to the
--                scheduled finish, and restores RULE-14's four-hour floor.
--                Validated here and rejected if it falls before the worker's
--                check-in or in the future, so the dialog can stay open with
--                the reason. NO upper bound against the scheduled end: a
--                worker may genuinely have finished later, and RULE-01 caps
--                the payable amount there regardless.
--
-- Already-exported payroll is never corrected retroactively (RULE-06). The
-- change still goes through — the money is owed — but the result says so, so
-- the screen can show "please notify Finance to pay it" rather than implying
-- the export moved.
-- ---------------------------------------------------------------------
create or replace function resolve_violation(
  p_violation     uuid,
  p_note          text,
  p_actual_finish timestamptz default null
) returns jsonb language plpgsql set search_path = public, extensions as $$
declare
  v         violations;
  b         bookings;
  sr        shift_requirements;
  ev        events;
  cl        check_logs;
  v_now     timestamptz := now();
  v_was     violation_type;
  v_minutes int;
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
  v_exported := ev.payroll_exported_at is not null;

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
    -- "Get back": the worker is registered as arrived at the moment of the press.
    v_minutes := greatest(0, floor(extract(epoch from (v_now - sr.starts_at)) / 60)::int);

    if cl.id is null then
      insert into check_logs (booking_id, attempted_at, outcome, check_in_at, on_site_verified)
      values (b.id, v_now, 'checked_in', v_now, false);
    end if;
    update bookings set status = 'worked' where id = b.id and status = 'confirmed';

    -- The entry becomes a Late violation, reviewed and closed in one action.
    v.type := 'late';
    v.minutes_late := v_minutes;
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
    'actualFinishAt', to_jsonb(v.actual_finish_at),
    -- RULE-06: the export is never corrected retroactively, so the screen warns.
    'payrollExported', v_exported,
    'messageKey', case when v_exported then 'resolved_payroll_already_exported' else 'resolved' end,
    'pay', (select pay from payable_shifts_v where booking_id = b.id));
end $$;

comment on function resolve_violation is
  '§9.5 Resolve, with its mandatory note. No-show reclassifies to Late and registers the arrival (§3.3); No check-out takes the manager-entered finish, which settles RULE-02 and restores RULE-14''s floor.';

grant execute on function start_break(uuid)  to authenticated;
grant execute on function finish_break(uuid) to authenticated;
grant execute on function resolve_violation(uuid, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- check_out() — close an open break on the way out
--
-- Forward-only replacement of the 0006 body. Everything about the decision is
-- unchanged; the only difference is that a break the worker never finished is
-- closed at the recorded finish, so `breaks` stops carrying an open row for a
-- shift that has ended and the monitor's Breaks column reads true. The pay
-- figure does not move: unpaid_break_minutes() already ran an open break to
-- the check-out.
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

    -- §5.2b: a break the worker never finished ends when the shift does.
    update breaks set ended_at = greatest(v_recorded, started_at)
     where booking_id = b.id and ended_at is null;
  end if;

  if d->>'violation' = 'no_checkout' then
    insert into violations (staff_id, booking_id, type, detected_at)
    select b.staff_id, b.id, 'no_checkout', v_now
     where not exists (select 1 from violations where booking_id = b.id and type = 'no_checkout');
  end if;

  v_break_min := unpaid_break_minutes(b.id);

  return d || jsonb_build_object(
    'distanceM', v_distance,
    'payRate',   sr.pay_rate,                      -- base rate only (§9.8)
    'unpaidBreakMin', v_break_min,
    'pay',       payable_minutes(sr.starts_at, sr.ends_at, cl.check_in_at, v_recorded, v_break_min,
                   exists (select 1 from violations where booking_id = b.id and type = 'left_early'),
                   case when d->>'violation' = 'no_checkout' then 'unresolved' else 'none' end));
end $$;

comment on function check_out is
  '§5.1 check-out RPC. Open from the start until end+4h from anywhere; off site records the last on-site fix, no fix at all raises RULE-02 on the press, and an unfinished break is closed at the recorded finish (§5.2b).';

-- ---------------------------------------------------------------------
-- payable_shifts_v — read the break total through the one function
--
-- Same shape and same columns as 0006; the inline break sum is replaced by
-- unpaid_break_minutes() so the screens, the RPCs and the payroll view can
-- never disagree about what a break cost.
-- ---------------------------------------------------------------------
create or replace view payable_shifts_v with (security_invoker = true) as
with logs as (
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
  sr.pay_rate,
  sr.charge_rate,
  cl.check_in_at,
  coalesce(cl.manager_finish_at, cl.check_out_at) as check_out_at,
  cl.attempted_at,
  case when b.status = 'turned_away' then 'turned_away'
       when cl.check_in_at is not null then 'worked'
       else 'no_show' end                         as kind,
  unpaid_break_minutes(b.id)                      as unpaid_break_min,
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
           unpaid_break_minutes(b.id),
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
where e.cancelled_at is null
  and (b.status in ('worked','turned_away')
       or (b.status = 'confirmed' and sr.starts_at + interval '30 minutes' <= now()));

comment on view payable_shifts_v is
  'Priced shifts (§5.2, RULE-01/02/14/15). Payable time is calculated, never stored; a no check-out reads status=undetermined until a manager resolves it.';
