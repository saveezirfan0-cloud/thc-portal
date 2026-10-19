-- =====================================================================
-- staff_directory_v reads the booking history once, not once per worker
-- (ADR-0166)
--
-- /staff reads the directory whole, in pages of 1,000, every 60 s per
-- open tab (it and student_visa_v, which reads it). With 1,342 staff rows
-- and 114k bookings locally (scripts/bench/office_views_at_scale.sql) the
-- page's columns took 3.5 s for the first page and 5.2 s for the second;
-- `authenticated` stops at 8 s. Per worker the view ran:
--
--   * last_shift_at and weekly_worked_hours: a join of the worker's
--     bookings to shift_requirements. The RLS gate on shift_requirements
--     (`(select current_app_role()) = 'admin'`) is a parameter the planner
--     cannot see through, so it estimated the table at ~5 rows and, for
--     EVERY worker, scanned every section ever built and probed bookings
--     once per section — 1.4 million probes for last_shift_at alone, 2.9 s,
--     and growing with every event (~16k sections a year);
--   * staff_show_rate(): every booking of the worker with two violation
--     probes each, 0.4 s;
--   * weekly_booked_hours(): one plpgsql call, 0.2 s;
--   * cap_band_until() for a term-time student: 378 days, each an EXISTS
--     over the holiday array, 0.34 s.
--
-- Now, every column the value it was:
--
--   1. reliability, last_shift_at, weekly_booked_hours and
--      weekly_worked_hours are each worked out ONCE per statement, for
--      everyone, as a grouped query in an uncorrelated scalar subquery
--      (an InitPlan) that builds a jsonb object keyed by staff id; each
--      row reads its own value by key. Why that shape and not a join:
--      every table here carries the RLS gate `(select current_app_role())`,
--      which the planner can only guess at (0.5% of the rows), so it
--      believes `staff` holds ~8 rows and `bookings` a few hundred. A
--      grouped subquery LEFT JOINed to staff was planned as a nested loop
--      that recomputed the whole aggregate once per worker (student_visa_v
--      went from 0.17 s to 0.36 s on it), and a correlated subquery again
--      chose the every-section scan. An InitPlan has no join to get wrong:
--      it runs once, and only when a column that reads it is selected, so
--      the pickers and the feedback typeahead still read no history.
--        reliability   — staff_show_rate()'s sample and formula
--                        (20260928110100), its two violation tests as hashed
--                        semi-joins rather than two probes per booking;
--        last_shift_at — section by section, each section's worked bookings
--                        through bookings (shift_id, status) behind a
--                        LATERAL ... OFFSET 0, the one access path that
--                        does not depend on the estimate;
--        weekly_*      — this Mon–Sun UK week's sections only (the UK-date
--                        test decides; an instant bound a day wider each side
--                        lets the planner start from
--                        shift_requirements_starts_at_idx), booked hours
--                        filtered by booking_counts_toward_cap(), the rule.
--      jsonb keeps a numeric's scale and a timestamptz's instant, so each
--      value reads back exactly as it was computed. released_shift_count
--      stays a per-row count: one index lookup on bookings (staff_id,
--      status) that no estimate can turn into a scan.
--      The view stays security_invoker: every table is read under the
--      caller's RLS exactly as the correlated subqueries and the invoker
--      functions read it (a worker sees no section, so their last shift is
--      null; a client sees no booking at all).
--      A read of one worker (staff_profile_v by id) now builds the maps
--      for everyone, ~0.1 s locally at 114k bookings, instead of a few
--      milliseconds; /staff/[id] reads it once per visit, /staff every
--      60 s per open tab, which is the read this is for.
--   2. cap_band_until() asks whether each day is a holiday with one
--      operator against the holidays as a single datemultirange (built
--      once per call), instead of an EXISTS over the array per day. A day
--      is in the union of the ranges exactly when it is in one of them;
--      a null calendar or day answers false as EXISTS did. The 54 weeks,
--      their grouping and weekly_cap() for the bands are untouched.
--
-- The hours expression and the week test move verbatim from the live
-- body. The show-rate and booked-hours rules are
-- stated a second time here, so the migration first checks the CODE of
-- staff_show_rate() and weekly_booked_hours() on this database is the code
-- they restate (comments dropped and whitespace collapsed, so a comment
-- that differs on live does not stop it) and stops if either has moved.
-- pgTAP 885 compares the view, and the three views that read it, with the
-- old definitions as the office, a worker and a client, and holds the
-- functions' answers against the columns for every worker.
--
-- Re-created from the LIVE definitions (docs/10 §3b): pg_get_viewdef() and
-- pg_get_functiondef() changed by named patterns, each of which must match
-- exactly once or the migration stops. The view's options are read back
-- and restated, because CREATE OR REPLACE VIEW would otherwise reset them.
-- =====================================================================

do $$
declare
  p          record;
  v_def      text;
  v_opts     text;
  v_n        int;
  v_wk       text;
  v_hours    text;
  v_week     text;
  v_today    constant text := '(now() AT TIME ZONE ''Europe/London''::text)::date';
  v_code     text;
  v_pat      text;
begin
  -- ---- the two rules restated below are still the live ones -------------
  select btrim(regexp_replace(regexp_replace(prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) into v_code
    from pg_proc where oid = 'public.staff_show_rate(uuid)'::regprocedure;
  if v_code is distinct from
     'with sample as ( select b.id, exists (select 1 from violations v where v.booking_id = b.id and not v.resolved and v.type in (''no_show'', ''no_checkout'') and not v.stale_fix_review) as against from bookings b where b.staff_id = p_staff and (b.status in (''worked'', ''turned_away'') or exists (select 1 from violations v where v.booking_id = b.id and v.type = ''no_show'' and not v.resolved)) ) select case when count(*) = 0 then null else round(100.0 * count(*) filter (where not against) / count(*), 2) end from sample'
  then
    raise exception '20261020150000: staff_show_rate() is not the code this migration restates; re-derive the shows subquery from it';
  end if;
  select btrim(regexp_replace(regexp_replace(prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) into v_code
    from pg_proc where oid = 'public.weekly_booked_hours(uuid,date)'::regprocedure;
  if v_code is distinct from
     'begin return ( select coalesce(sum(extract(epoch from (w.ends_at - w.starts_at)) / 3600.0), 0)::numeric from ( select sr.starts_at, sr.ends_at, b.status, b.cancelled_at, b.cancel_cause from bookings b join shift_requirements sr on sr.id = b.shift_id where b.staff_id = p_staff and (sr.starts_at at time zone ''Europe/London'')::date between (select cap_week_start(p_date)) and (select cap_week_start(p_date)) + 6 and sr.starts_at >= ((select cap_week_start(p_date))::timestamp - interval ''1 day'') at time zone ''UTC'' and sr.starts_at < ((select cap_week_start(p_date))::timestamp + interval ''8 days'') at time zone ''UTC'' offset 0 ) w where booking_counts_toward_cap(w.status, w.cancelled_at, w.cancel_cause) ); end'
  then
    raise exception '20261020150000: weekly_booked_hours() is not the code this migration restates; re-derive the wk subquery from it';
  end if;

  -- ---- 2. cap_band_until: one multirange, one operator per day ----------
  v_def := pg_get_functiondef('public.cap_band_until(daterange[],date)'::regprocedure);
  v_pat := 'exists \(select 1\s+from unnest\(coalesce\(p_holidays, ''\{\}''::daterange\[\]\)\) r\s+where days\.d <@ r\) as in_holiday';
  select count(*) into v_n from regexp_matches(v_def, v_pat, 'g');
  if v_n <> 1 then
    raise exception '20261020150000: cap_band_until - expected one match of %, found %', v_pat, v_n;
  end if;
  v_def := regexp_replace(v_def, v_pat,
    E'-- 20261020150000: one operator against the holidays as a single\n'
    || E'                -- multirange (built once a call), not an EXISTS per day.\n'
    || E'                coalesce(days.d <@ (select range_agg(r) from unnest(p_holidays) r), false) as in_holiday');
  execute v_def;

  -- ---- 1. staff_directory_v: the history read once -----------------------
  v_def := pg_get_viewdef('public.staff_directory_v'::regclass, true);
  select array_to_string(c.reloptions, ', ') into v_opts
    from pg_class c where c.oid = 'public.staff_directory_v'::regclass;

  -- What moves verbatim into the weekly maps: the hours expression and the
  -- UK week test of weekly_worked_hours.
  select count(*) into v_n from regexp_matches(v_def,
    '\(\s*SELECT COALESCE\((sum\(EXTRACT\(epoch FROM sr\.ends_at - sr\.starts_at\) / 3600\.0\)), 0::numeric\) AS "coalesce"\s+FROM bookings b\s+JOIN shift_requirements sr ON sr\.id = b\.shift_id\s+WHERE b\.staff_id = s\.id AND b\.status = ''worked''::booking_status AND (\(sr\.starts_at AT TIME ZONE ''Europe/London''::text\)::date >= cap_week_start\(\(now\(\) AT TIME ZONE ''Europe/London''::text\)::date\) AND \(sr\.starts_at AT TIME ZONE ''Europe/London''::text\)::date <= \(cap_week_start\(\(now\(\) AT TIME ZONE ''Europe/London''::text\)::date\) \+ 6\))\) AS weekly_worked_hours', 'g');
  if v_n <> 1 then
    raise exception '20261020150000: staff_directory_v - expected one weekly_worked_hours subquery, found %', v_n;
  end if;
  select m[1], m[2] into v_hours, v_week from regexp_match(v_def,
    '\(\s*SELECT COALESCE\((sum\(EXTRACT\(epoch FROM sr\.ends_at - sr\.starts_at\) / 3600\.0\)), 0::numeric\) AS "coalesce"\s+FROM bookings b\s+JOIN shift_requirements sr ON sr\.id = b\.shift_id\s+WHERE b\.staff_id = s\.id AND b\.status = ''worked''::booking_status AND (\(sr\.starts_at AT TIME ZONE ''Europe/London''::text\)::date >= cap_week_start\(\(now\(\) AT TIME ZONE ''Europe/London''::text\)::date\) AND \(sr\.starts_at AT TIME ZONE ''Europe/London''::text\)::date <= \(cap_week_start\(\(now\(\) AT TIME ZONE ''Europe/London''::text\)::date\) \+ 6\))\) AS weekly_worked_hours') m;

  -- This Mon-Sun UK week's sections, each with its bookings (the UK-date
  -- test decides; the instant bound, a day wider each side, lets the
  -- planner start from shift_requirements_starts_at_idx).
  v_wk := E'FROM shift_requirements sr,\n'
       || E'                    LATERAL ( SELECT bb.staff_id, bb.status, bb.cancelled_at, bb.cancel_cause\n'
       || E'                           FROM bookings bb\n'
       || E'                          WHERE bb.shift_id = sr.id\n'
       || E'                         OFFSET 0) b\n'
       || E'                  WHERE ' || v_week || E'\n'
       || E'                    AND sr.starts_at >= ((cap_week_start(' || v_today || E')::timestamp without time zone - ''1 day''::interval) AT TIME ZONE ''UTC''::text)\n'
       || E'                    AND sr.starts_at < ((cap_week_start(' || v_today || E')::timestamp without time zone + ''8 days''::interval) AT TIME ZONE ''UTC''::text)\n'
       || E'                  GROUP BY b.staff_id';

  for p in
    select * from (values
      -- reliability: staff_show_rate()'s sample and formula (20260928110100),
      -- for everyone at once; the violation tests are two hashed semi-joins.
      ('staff_show_rate\(s\.id\)::numeric\(5,2\) AS reliability',
       E'((( SELECT jsonb_object_agg(x.staff_id, x.show_rate) AS jsonb_object_agg\n'
       || E'           FROM ( SELECT b.staff_id,\n'
       || E'                    round(100.0 * count(*) FILTER (WHERE NOT (b.id IN ( SELECT v.booking_id\n'
       || E'                           FROM violations v\n'
       || E'                          WHERE NOT v.resolved AND (v.type = ANY (ARRAY[''no_show''::violation_type, ''no_checkout''::violation_type])) AND NOT v.stale_fix_review))) / count(*), 2) AS show_rate\n'
       || E'                   FROM bookings b\n'
       || E'                  WHERE (b.status = ANY (ARRAY[''worked''::booking_status, ''turned_away''::booking_status])) OR (b.id IN ( SELECT v.booking_id\n'
       || E'                           FROM violations v\n'
       || E'                          WHERE v.type = ''no_show''::violation_type AND NOT v.resolved))\n'
       || E'                  GROUP BY b.staff_id) x) ->> s.id::text)::numeric)::numeric(5,2) AS reliability'),
      -- weekly_booked_hours: what weekly_booked_hours() counts, for everyone
      -- at once; booking_counts_toward_cap() decides, as there.
      ('weekly_booked_hours\(s\.id, \(now\(\) AT TIME ZONE ''Europe/London''::text\)::date\) AS weekly_booked_hours',
       E'COALESCE((( SELECT jsonb_object_agg(w.staff_id, w.booked_hours) AS jsonb_object_agg\n'
       || E'           FROM ( SELECT b.staff_id,\n'
       || E'                    ' || v_hours || E' FILTER (WHERE booking_counts_toward_cap(b.status, b.cancelled_at, b.cancel_cause)) AS booked_hours\n'
       || E'                   ' || v_wk || E') w) ->> s.id::text)::numeric, 0::numeric) AS weekly_booked_hours'),
      -- last_shift_at: section by section, each section's worked bookings
      -- through bookings (shift_id, status).
      ('\(\s*SELECT max\(sr\.ends_at\) AS max\s+FROM bookings b\s+JOIN shift_requirements sr ON sr\.id = b\.shift_id\s+WHERE b\.staff_id = s\.id AND b\.status = ''worked''::booking_status\) AS last_shift_at',
       E'(( SELECT jsonb_object_agg(h.staff_id, h.last_shift_at) AS jsonb_object_agg\n'
       || E'           FROM ( SELECT bw.staff_id,\n'
       || E'                    max(sr.ends_at) AS last_shift_at\n'
       || E'                   FROM shift_requirements sr,\n'
       || E'                    LATERAL ( SELECT bb.staff_id\n'
       || E'                           FROM bookings bb\n'
       || E'                          WHERE bb.shift_id = sr.id AND bb.status = ''worked''::booking_status\n'
       || E'                         OFFSET 0) bw\n'
       || E'                  GROUP BY bw.staff_id) h) ->> s.id::text)::timestamp with time zone AS last_shift_at'),
      -- weekly_worked_hours: the same week's worked hours.
      ('\(\s*SELECT COALESCE\(sum\(EXTRACT\(epoch FROM sr\.ends_at - sr\.starts_at\) / 3600\.0\), 0::numeric\) AS "coalesce"\s+FROM bookings b\s+JOIN shift_requirements sr ON sr\.id = b\.shift_id\s+WHERE b\.staff_id = s\.id AND b\.status = ''worked''::booking_status AND \(sr\.starts_at AT TIME ZONE ''Europe/London''::text\)::date >= cap_week_start\(\(now\(\) AT TIME ZONE ''Europe/London''::text\)::date\) AND \(sr\.starts_at AT TIME ZONE ''Europe/London''::text\)::date <= \(cap_week_start\(\(now\(\) AT TIME ZONE ''Europe/London''::text\)::date\) \+ 6\)\) AS weekly_worked_hours',
       E'COALESCE((( SELECT jsonb_object_agg(w.staff_id, w.worked_hours) AS jsonb_object_agg\n'
       || E'           FROM ( SELECT b.staff_id,\n'
       || E'                    ' || v_hours || E' FILTER (WHERE b.status = ''worked''::booking_status) AS worked_hours\n'
       || E'                   ' || v_wk || E') w) ->> s.id::text)::numeric, 0::numeric) AS weekly_worked_hours')
    ) as x(pattern, replacement)
  loop
    select count(*) into v_n from regexp_matches(v_def, p.pattern, 'g');
    if v_n <> 1 then
      raise exception '20261020150000: staff_directory_v - expected one match of %, found %', p.pattern, v_n;
    end if;
    v_def := regexp_replace(v_def, p.pattern, p.replacement);
  end loop;
  execute 'create or replace view public.staff_directory_v'
          || case when v_opts is not null then ' with (' || v_opts || ')' else '' end
          || ' as ' || v_def;
end;
$$;
