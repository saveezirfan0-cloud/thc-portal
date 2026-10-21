-- =====================================================================
-- 20261022200300 · ADR-0184 follow-ups, QA: the weekly overrun, set-based
--
-- 20261022200200 added each booking's paid overrun to the RULE-20 weekly
-- sums through booking_overrun_hours(booking, ends_at): one query per
-- already-finished booking in the week, run under RLS for an office
-- caller. With ~2,000 finished shifts in a week (scripts/bench/
-- radar_and_pool_at_scale.sql) the board's pool went from ~150 ms to
-- 1.7 s on a section of that week, the hourly round's from ~70 to ~700 ms,
-- staff_directory_v from ~0.65 to ~3.3 s and late_check_outs() from ~0.16
-- to ~1.2 s.
--
-- Now each sum reads the overrun ONCE, as a set: booking_overruns(ids)
-- returns the paid overrun of the given bookings in one statement — their
-- accepted check-in rows (the first check_logs row with a check-in, the
-- row booking_overrun_hours read), the unpaid breaks of those signed out
-- more than 15 minutes late, and cap_overrun_minutes() on those rows only.
-- Each caller passes only its bookings whose section ended on or after
-- ADR-0184's cutoff and at least 15 minutes ago, and LEFT JOINs the result.
-- Same figures as before (supabase/tests/922), no per-row function doing
-- its own queries. booking_overrun_hours() is dropped.
--
-- Also: the overrun invoice line (and CSV row) ends at the scheduled end
-- plus its own minutes — the rule the office's review uses — rather than
-- least(check-out, end + 4 h). The two differ only when breaks are longer
-- than the shift's main part; then the line now reads as its minutes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The overrun of a set of bookings, in one statement
-- ---------------------------------------------------------------------
create or replace function public.booking_overruns(p_bookings uuid[])
returns table (booking_id uuid, overrun_min int)
language plpgsql
stable
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  -- Most weekly sums have no finished booking to ask about (a future week,
  -- a worker who has not worked yet): answer those without a read, and
  -- keep the one query's plan for the session (ADR-0155).
  if coalesce(cardinality(p_bookings), 0) = 0 then
    return;
  end if;
  return query

  select cl.booking_id,
         cap_overrun_minutes(
           sr.starts_at, sr.ends_at, cl.check_in_at, cl.finish,
           -- unpaid_break_minutes(), for these rows: every break clipped to
           -- the paid window, nothing where the client pays breaks.
           case when e.pays_breaks then 0
                else coalesce((select sum(break_window_minutes(sr.starts_at, sr.ends_at, cl.check_in_at,
                                                               cl.finish, br.started_at, br.ended_at))
                                 from breaks br
                                where br.booking_id = cl.booking_id), 0)::int end,
           'none')
    from (select distinct on (c.booking_id)
                 c.booking_id, c.check_in_at, coalesce(c.manager_finish_at, c.check_out_at) as finish
            from check_logs c
           where c.booking_id = any (p_bookings) and c.check_in_at is not null
           order by c.booking_id, c.check_in_at) cl
    join bookings b            on b.id = cl.booking_id
    join shift_requirements sr on sr.id = b.shift_id
    join events e              on e.id = sr.event_id
   where sr.ends_at >= timestamptz '2026-10-20 23:00:00+00'      -- ADR-0184's cutoff
     and sr.ends_at <= now() - interval '15 minutes'
     and cl.finish > sr.ends_at + interval '15 minutes'
     -- Not settled while a No check-out is open: it counts once resolved.
     and not exists (select 1 from violations v
                      where v.booking_id = cl.booking_id
                        and v.type = 'no_checkout' and not v.resolved);
end $$;

comment on function public.booking_overruns(uuid[]) is
  'RULE-20 with ADR-0184: the paid overrun minutes (cap_overrun_minutes) of each given booking signed out more than 15 minutes late on a section ending on or after 21.10.2026 00:00 UK and at least 15 minutes ago, read in ONE statement. Bookings with none are not returned. Invoker: the caller''s RLS applies. Every weekly-hours sum LEFT JOINs it once.';

-- ---------------------------------------------------------------------
-- 2 · The single-worker sums
-- ---------------------------------------------------------------------
create or replace function public.weekly_booked_hours(p_staff uuid, p_date date)
returns numeric
language plpgsql
stable
set search_path = public, extensions
as $$
begin
  -- 20261019192000: plpgsql so its plan is kept for the session (ADR-0155).
  return (
  with w as materialized (
    -- This worker's shifts that START in the week, whatever their booking.
    -- Materialized, so booking_counts_toward_cap() below is never moved
    -- back onto every booking the worker has ever had.
    select b.id as booking_id, sr.starts_at, sr.ends_at, b.status, b.cancelled_at, b.cancel_cause
      from bookings b
      join shift_requirements sr on sr.id = b.shift_id
     where b.staff_id = p_staff
       and (sr.starts_at at time zone 'Europe/London')::date
           between (select cap_week_start(p_date))
               and (select cap_week_start(p_date)) + 6
       -- 20261019192000: the same week, a day wider each side, as instants.
       and sr.starts_at >= ((select cap_week_start(p_date))::timestamp - interval '1 day') at time zone 'UTC'
       and sr.starts_at <  ((select cap_week_start(p_date))::timestamp + interval '8 days') at time zone 'UTC'
  )
  select coalesce(sum(extract(epoch from (w.ends_at - w.starts_at)) / 3600.0
                      + coalesce(ov.overrun_min, 0)::numeric / 60), 0)::numeric
    from w
    -- RULE-20 with ADR-0184: the paid overrun, read once for the week.
    left join booking_overruns(array(
                select w2.booking_id from w w2
                 where w2.ends_at >= timestamptz '2026-10-20 23:00:00+00'
                   and w2.ends_at <= now() - interval '15 minutes')) ov
           on ov.booking_id = w.booking_id
   where booking_counts_toward_cap(w.status, w.cancelled_at, w.cancel_cause)
  );
end $$;

create or replace function public.weekly_booked_hours_except(p_staff uuid, p_date date, p_shift uuid)
returns numeric
language plpgsql
stable
set search_path = public, extensions
as $$
begin
  -- 20261019192000: plpgsql so its plan is kept for the session (ADR-0155).
  return (
  with w as materialized (
    select b.id as booking_id, sr.starts_at, sr.ends_at
      from bookings b
      join shift_requirements sr on sr.id = b.shift_id
     where b.staff_id = p_staff
       and b.shift_id is distinct from p_shift
       and booking_counts_toward_cap(b.status, b.cancelled_at, b.cancel_cause)
       and (sr.starts_at at time zone 'Europe/London')::date
           between cap_week_start(p_date) and cap_week_start(p_date) + 6
       -- 20261019192000: the same week, a day wider each side, as instants.
       and sr.starts_at >= (cap_week_start(p_date)::timestamp - interval '1 day') at time zone 'UTC'
       and sr.starts_at <  (cap_week_start(p_date)::timestamp + interval '8 days') at time zone 'UTC'
  )
  select coalesce(sum(extract(epoch from (w.ends_at - w.starts_at)) / 3600.0
                      + coalesce(ov.overrun_min, 0)::numeric / 60), 0)::numeric
    from w
    left join booking_overruns(array(
                select w2.booking_id from w w2
                 where w2.ends_at >= timestamptz '2026-10-20 23:00:00+00'
                   and w2.ends_at <= now() - interval '15 minutes')) ov
           on ov.booking_id = w.booking_id
  );
end $$;

create or replace function public.series_hours_blocked(p_staff uuid, p_shift uuid)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  with days as (
    select sr.id as shift_id, sr.starts_at, sr.ends_at
      from shift_requirements sr
     where sr.id = p_shift
    union all
    select s.shift_id, s.starts_at, s.ends_at
      from series_siblings(p_shift) s
  ),
  wk as (
    select cap_week_start((d.starts_at at time zone 'Europe/London')::date)  as week_start,
           min((d.starts_at at time zone 'Europe/London')::date)             as first_day,
           sum(extract(epoch from (d.ends_at - d.starts_at)) / 3600.0)::numeric as hours,
           bool_and(can_roster_staff(p_staff, (d.starts_at at time zone 'Europe/London')::date)
                and can_roster_staff(p_staff, ((d.ends_at - interval '1 second')
                                               at time zone 'Europe/London')::date)) as can_roster
      from days d
     group by 1
  ),
  -- This worker's counted bookings in those weeks, outside the series,
  -- and their paid overrun read once (RULE-20 with ADR-0184).
  booked as (
    select wk.week_start, b.id as booking_id, sr.starts_at, sr.ends_at
      from wk
      join bookings b on b.staff_id = p_staff
      join shift_requirements sr on sr.id = b.shift_id
     where booking_counts_toward_cap(b.status, b.cancelled_at, b.cancel_cause)
       and sr.id not in (select shift_id from days)
       and (sr.starts_at at time zone 'Europe/London')::date
           between wk.week_start and wk.week_start + 6
  ),
  ov as (
    select o.booking_id, o.overrun_min
      from booking_overruns(array(
             select bk.booking_id from booked bk
              where bk.ends_at >= timestamptz '2026-10-20 23:00:00+00'
                and bk.ends_at <= now() - interval '15 minutes')) o
  )
  select coalesce(bool_or(g.verdict = 'block'), false)
    from wk
    cross join lateral weekly_cap_for(p_staff, wk.first_day) c
    cross join lateral (
      select coalesce(sum(extract(epoch from (bk.ends_at - bk.starts_at)) / 3600.0
                          + coalesce(ov.overrun_min, 0)::numeric / 60), 0)::numeric as booked
        from booked bk
        left join ov on ov.booking_id = bk.booking_id
       where bk.week_start = wk.week_start
    ) bk
    cross join lateral rota_guard_decide(wk.can_roster, c.cap_hours, c.band, bk.booked, wk.hours,
                                         rota_guard_mode()) g
$$;

-- ---------------------------------------------------------------------
-- 3 · The auto-assign pool: one read for every week it sums
-- ---------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('public.auto_assign_candidates_pool_pairs(uuid[], uuid[], boolean)'::regprocedure);
  a1 text := '  week as (
    select w.for_shift, w.staff_id,
           coalesce(sum(extract(epoch from (w.ends_at - w.starts_at)) / 3600.0
                    + booking_overrun_hours(w.booking_id, w.ends_at)), 0)::numeric as booked
      from week_src w
     where';
  b1 text := '  -- RULE-20 with ADR-0184: the paid overrun of the weeks'' finished
  -- bookings, read once for the whole call (20261022200300).
  week_ov as (
    select o.booking_id, o.overrun_min
      from booking_overruns(array(
             select distinct w.booking_id from week_src w
              where w.ends_at >= timestamptz ''2026-10-20 23:00:00+00''
                and w.ends_at <= now() - interval ''15 minutes'')) o
  ),
  week as (
    select w.for_shift, w.staff_id,
           coalesce(sum(extract(epoch from (w.ends_at - w.starts_at)) / 3600.0
                    + coalesce(ov.overrun_min, 0)::numeric / 60), 0)::numeric as booked
      from week_src w
      left join week_ov ov on ov.booking_id = w.booking_id
     where';
begin
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1 then
    raise exception '20261022200300: auto_assign_candidates_pool_pairs - expected one match of the week sum';
  end if;
  execute replace(v_def, a1, b1);
end $$;

-- ---------------------------------------------------------------------
-- 4 · staff_directory_v: the week's two sums, one read each
-- ---------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_viewdef('public.staff_directory_v'::regclass, true);
  v_n   int;
  p1 constant text := $re$ \+ booking_overrun_hours\(b\.id, sr\.ends_at\)\)$re$;
  r1 constant text := $sql$ + COALESCE(ov.overrun_min, 0)::numeric / 60::numeric)$sql$;
  -- The lateral over the week's bookings, in both sums (booked, worked).
  p2 constant text := $re$OFFSET 0\) b(\s+)WHERE \(sr\.starts_at AT TIME ZONE 'Europe/London'::text\)::date >= cap_week_start$re$;
  r2 constant text := $sql$OFFSET 0) b
                     LEFT JOIN booking_overruns(ARRAY( SELECT bo.id
                           FROM bookings bo
                             JOIN shift_requirements so ON so.id = bo.shift_id
                          WHERE so.ends_at >= GREATEST('2026-10-20 23:00:00+00'::timestamp with time zone, (cap_week_start((now() AT TIME ZONE 'Europe/London'::text)::date)::timestamp without time zone - '1 day'::interval) AT TIME ZONE 'UTC'::text) AND so.ends_at <= (now() - '00:15:00'::interval))) ov ON ov.booking_id = b.id\1WHERE (sr.starts_at AT TIME ZONE 'Europe/London'::text)::date >= cap_week_start$sql$;
begin
  select count(*) into v_n from regexp_matches(v_def, p1, 'g');
  if v_n <> 2 then raise exception '20261022200300: staff_directory_v - pattern 1 matched % times', v_n; end if;
  select count(*) into v_n from regexp_matches(v_def, p2, 'g');
  if v_n <> 2 then raise exception '20261022200300: staff_directory_v - pattern 2 matched % times', v_n; end if;
  execute 'create or replace view public.staff_directory_v with (security_invoker = true) as '
          || regexp_replace(regexp_replace(v_def, p1, r1, 'g'), p2, r2, 'g');
end $$;

-- Nothing reads it any more.
drop function public.booking_overrun_hours(uuid, timestamptz);

-- ---------------------------------------------------------------------
-- 5 · The overrun line ends at the end plus its own minutes
-- ---------------------------------------------------------------------
do $$
declare
  a text := 'least(l.check_out_at, l.ends_at + interval ''4 hours'')';
  b text := 'l.ends_at + make_interval(mins => l.overrun_min)';
  f regprocedure;
  v_def text;
begin
  foreach f in array array['public.invoice_claim(text, timestamptz)'::regprocedure,
                           'public.invoice_export_rows(date, date, uuid)'::regprocedure] loop
    v_def := pg_get_functiondef(f);
    if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then
      raise exception '20261022200300: % - expected one overrun line end', f;
    end if;
    execute replace(v_def, a, b);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6 · "Over weekly limit": the week of a set of late bookings, in one read
-- ---------------------------------------------------------------------
-- late_check_outs() and the monitor used to call weekly_booked_hours()
-- and weekly_cap_hours() per late row (inside checkin_monitor_v for every
-- late row of the day). /checkin now asks this once for the list's rows
-- and the monitor's late rows together; it answers for the set at once: the
-- distinct (worker, Mon–Sun week) pairs, their counted bookings read once,
-- the overrun read once — the same figure weekly_booked_hours() gives.
create or replace function public.late_check_out_weeks(p_bookings uuid[])
returns table (booking_id uuid, week_hours numeric, week_cap_hours int)
language sql
stable
set search_path = public, extensions
as $$
  with lb as (
    select b.id as booking_id, b.staff_id, (sr.starts_at at time zone 'Europe/London')::date as day
      from bookings b
      join shift_requirements sr on sr.id = b.shift_id
     where b.id = any (p_bookings)
  ),
  pairs as (
    select distinct lb.staff_id, cap_week_start(lb.day) as week_start from lb
  ),
  weeks as materialized (
    select distinct p.week_start from pairs p
  ),
  -- The weeks' sections (starts_at index), then their bookings (shift_id
  -- index) kept for the workers asked about — not every booking those
  -- workers have ever had.
  secs as materialized (
    select sr.id, sr.starts_at, sr.ends_at, w.week_start
      from weeks w
      join shift_requirements sr
        on sr.starts_at >= (w.week_start::timestamp - interval '1 day') at time zone 'UTC'
       and sr.starts_at <  (w.week_start::timestamp + interval '8 days') at time zone 'UTC'
     where (sr.starts_at at time zone 'Europe/London')::date between w.week_start and w.week_start + 6
  ),
  bw as materialized (
    select b.staff_id, s.week_start, b.id as booking_id, s.starts_at, s.ends_at,
           b.status, b.cancelled_at, b.cancel_cause
      from secs s
      join bookings b on b.shift_id = s.id
     where (b.staff_id, s.week_start) in (select p.staff_id, p.week_start from pairs p)
  ),
  ov as (
    select o.booking_id, o.overrun_min
      from booking_overruns(array(
             select bw.booking_id from bw
              where bw.ends_at >= timestamptz '2026-10-20 23:00:00+00'
                and bw.ends_at <= now() - interval '15 minutes')) o
  ),
  -- Materialized: summed once, then joined, not re-summed per booking.
  hrs as materialized (
    select bw.staff_id, bw.week_start,
           coalesce(sum(extract(epoch from (bw.ends_at - bw.starts_at)) / 3600.0
                        + coalesce(ov.overrun_min, 0)::numeric / 60), 0)::numeric as hours
      from bw
      left join ov on ov.booking_id = bw.booking_id
     where booking_counts_toward_cap(bw.status, bw.cancelled_at, bw.cancel_cause)
     group by bw.staff_id, bw.week_start
  )
  select lb.booking_id,
         round(coalesce(h.hours, 0), 2),
         weekly_cap_hours(lb.staff_id, lb.day)
    from lb
    left join hrs h on h.staff_id = lb.staff_id and h.week_start = cap_week_start(lb.day)
$$;

comment on function public.late_check_out_weeks(uuid[]) is
  'RULE-20 with ADR-0184: for each given booking, the hours counted against its worker''s weekly cap for the Mon–Sun week its section starts in (weekly_booked_hours(), overrun included) and the cap (weekly_cap_hours()), read as one set. For the "Over weekly limit" warning on /checkin (the monitor''s late rows, late_check_outs()). Invoker: the caller''s RLS applies.';

revoke execute on function public.late_check_out_weeks(uuid[]) from public, anon;
grant execute on function public.late_check_out_weeks(uuid[]) to authenticated, service_role;

-- late_check_outs() goes back to its 20261022200100 shape: the list, with
-- no week figures. Computed per listed row they doubled its cost; /checkin
-- reads late_check_out_weeks() ONCE for the list's rows and the monitor's
-- late rows together.
drop function public.late_check_outs(int, boolean);

create function public.late_check_outs(p_days int default 14, p_include_verified boolean default false)
returns table (
  booking_id        uuid,
  staff_id          uuid,
  staff_name        text,
  photo_path        text,
  event_id          uuid,
  event_title       text,
  venue_name        text,
  role_name         text,
  starts_at         timestamptz,
  ends_at           timestamptz,
  check_in_at       timestamptz,
  check_out_at      timestamptz,
  finish_by_office  boolean,
  minutes_past_end  int,
  verified_at       timestamptz,
  verified_by_name  text,
  note              text
)
language plpgsql
stable
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  if current_app_role() is distinct from 'admin'::app_role then
    raise exception 'admins_only' using errcode = '42501';
  end if;
  return query
  select b.id, b.staff_id,
         case when s.removed_at is null then s.first_name || ' ' || s.last_name
              else deleted_account_label(s.employee_id) end,
         case when s.removed_at is null then s.photo_path end,
         e.id, e.title, e.venue_name, r.name, sr.starts_at, sr.ends_at,
         cl.check_in_at, coalesce(cl.manager_finish_at, cl.check_out_at),
         cl.manager_finish_at is not null,
         round(extract(epoch from (coalesce(cl.manager_finish_at, cl.check_out_at) - sr.ends_at)) / 60)::int,
         cl.late_check_out_verified_at, p.full_name, cl.late_check_out_note
    from bookings b
    join shift_requirements sr on sr.id = b.shift_id
    join events e              on e.id = sr.event_id
    join roles r               on r.id = sr.role_id
    join staff s               on s.id = b.staff_id
    join lateral (
      select c.* from check_logs c
       where c.booking_id = b.id and c.check_in_at is not null
       order by c.check_in_at limit 1
    ) cl on true
    left join profiles p on p.id = cl.late_check_out_verified_by
   where sr.ends_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 92))
     and sr.ends_at <= now()
     and e.cancelled_at is null
     -- ADR-0184's effective date: earlier sections were paid to their end.
     and sr.ends_at >= timestamptz '2026-10-20 23:00:00+00'
     and coalesce(cl.manager_finish_at, cl.check_out_at) > sr.ends_at + interval '15 minutes'
     and (p_include_verified or cl.late_check_out_verified_at is null)
     -- A No check-out still open is the violation log's to settle first.
     and not exists (select 1 from violations v
                      where v.booking_id = b.id and v.type = 'no_checkout' and not v.resolved)
   order by coalesce(cl.manager_finish_at, cl.check_out_at) desc, b.id
   limit 200;
end $$;

comment on function public.late_check_outs(int, boolean) is
  'ADR-0184: shifts signed out more than 15 minutes past their section end, on sections ended in the last p_days days (1–92, default 14) and on or after 21.10.2026 00:00 UK, newest first, unverified only unless p_include_verified. Their week against the cap is late_check_out_weeks(), read once by /checkin. No money. Office only.';

revoke execute on function public.late_check_outs(int, boolean) from public, anon;
grant execute on function public.late_check_outs(int, boolean) to authenticated, service_role;

-- The monitor no longer computes the week per late row: the office reads
-- late_check_out_weeks() for the day's late rows instead. Removing two
-- columns means re-creating the view, and dashboard_kpis_v, which reads
-- it — both from their live definitions, with their options, grants and
-- comments as they were.
do $$
declare
  v_mon   text := pg_get_viewdef('public.checkin_monitor_v'::regclass, true);
  v_dash  text := pg_get_viewdef('public.dashboard_kpis_v'::regclass, true);
  c_mon   text := obj_description('public.checkin_monitor_v'::regclass, 'pg_class');
  c_dash  text := obj_description('public.dashboard_kpis_v'::regclass, 'pg_class');
  v_n     int;
  p constant text := $re$cl\.late_check_out_note,\s+CASE\s+WHEN [^\n]*weekly_booked_hours[^\n]*\s+ELSE NULL::numeric\s+END AS week_hours,\s+CASE\s+WHEN [^\n]*weekly_cap_hours[^\n]*\s+ELSE NULL::integer\s+END AS week_cap_hours(\s+)FROM bookings b$re$;
begin
  select count(*) into v_n from regexp_matches(v_mon, p, 'g');
  if v_n <> 1 then
    raise exception '20261022200300: checkin_monitor_v - expected one match of the week columns, found %', v_n;
  end if;
  drop view public.dashboard_kpis_v;
  drop view public.checkin_monitor_v;
  execute 'create view public.checkin_monitor_v with (security_invoker = true) as '
          || regexp_replace(v_mon, p, 'cl.late_check_out_note\1FROM bookings b');
  execute 'create view public.dashboard_kpis_v with (security_invoker = true, security_barrier = true) as '
          || v_dash;
  revoke all on public.checkin_monitor_v, public.dashboard_kpis_v from public, anon, authenticated, service_role;
  grant all on public.checkin_monitor_v, public.dashboard_kpis_v to authenticated, service_role;
  if c_mon is not null then
    execute format('comment on view public.checkin_monitor_v is %L', c_mon);
  end if;
  if c_dash is not null then
    execute format('comment on view public.dashboard_kpis_v is %L', c_dash);
  end if;
end $$;
