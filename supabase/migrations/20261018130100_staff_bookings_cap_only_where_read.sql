-- =====================================================================
-- staff_bookings(): the weekly cap only on the rows that show it (ADR-0153)
--
-- Audit 17.10.2026 F4. Every Staff App shift screen reads staff_bookings()
-- (Shifts, Invites, an invitation, a shift, the profile, a quiz), most
-- of them under AutoRefresh, and it ran RULE-20's whole chain — the
-- Accept verdict, the week's booked hours and the cap — on EVERY booking
-- the worker has ever had: 590 ms for a worker with ~115 bookings locally
-- (scripts/bench/rule20_staff_bookings_candidates.sql), growing every
-- week they work.
--
-- What reads those three columns: the invitation card and the invitation
-- screen ("Limit Reached", explainLimit()), for a booking whose status is
-- `invited` — /invites/[id] shows any invited row, an ended one included.
-- Nothing reads them on a booking that has ended. So they are computed for
-- an invitation, whenever it is, and for any booking whose section has not
-- ended yet (a confirmed or applied shift still ahead), and are null on
-- the history behind them. `week_start` costs nothing and stays on every
-- row. Each value that IS computed is the one it was.
--
-- History is NOT bounded. My shifts' collapsed "Past shifts" section
-- (ADR-0048) lists every past booking, and a stale push must still find
-- its row (apps/staff/app/shifts/model.ts), so every row still comes back.
-- With 20261018130000 the per-row work left on a past row is a handful
-- of index lookups; the fill count now reads the section's confirmed
-- bookings through (shift_id, status) instead of all of them.
--
-- Re-created from the LIVE body (docs/10 §3b); each pattern must match
-- once or the migration stops. Security, search_path and grants are
-- untouched.
-- =====================================================================
do $$
declare
  p     record;
  v_def text := pg_get_functiondef('public.staff_bookings(uuid)'::regprocedure);
  v_n   int;
begin
  for p in
    select * from (values
      -- The fill count read every booking of the section and kept the
      -- confirmed ones; the (shift_id, status) index reads only those.
      -- The same number: fill counts ONLY confirmed.
      ('\(select count\(\*\) filter \(where o\.status = ''confirmed''\)::int\s+from bookings o where o\.shift_id = sr\.id\)',
       '(select count(*)::int from bookings o where o.shift_id = sr.id and o.status = ''confirmed'')'),
      ('(\n)(\s+)weekly_cap_would_breach\(b\.staff_id, b\.shift_id\),\n',
       E'\\1\\2-- 20261018130100: only where a screen reads it — an invitation, or a\n'
       || E'\\2-- booking whose section has not ended (ADR-0153). Null on history.\n'
       || E'\\2case when b.status = ''invited'' or sr.ends_at > now()\n'
       || E'\\2     then weekly_cap_would_breach(b.staff_id, b.shift_id) end,\n'),
      ('(\n)(\s+)weekly_booked_hours\(b\.staff_id, \(sr\.starts_at at time zone ''Europe/London''\)::date\),\n',
       E'\\1\\2case when b.status = ''invited'' or sr.ends_at > now()\n'
       || E'\\2     then weekly_booked_hours(b.staff_id, (sr.starts_at at time zone ''Europe/London'')::date) end,\n'),
      ('(\n)(\s+)weekly_cap_hours\(b\.staff_id, \(sr\.starts_at at time zone ''Europe/London''\)::date\)\n',
       E'\\1\\2case when b.status = ''invited'' or sr.ends_at > now()\n'
       || E'\\2     then weekly_cap_hours(b.staff_id, (sr.starts_at at time zone ''Europe/London'')::date) end\n')
    ) as x(pattern, replacement)
  loop
    select count(*) into v_n from regexp_matches(v_def, p.pattern, 'g');
    if v_n <> 1 then
      raise exception '20261018130100: staff_bookings - expected one match of %, found %', p.pattern, v_n;
    end if;
    v_def := regexp_replace(v_def, p.pattern, p.replacement);
  end loop;
  execute v_def;

  execute format('comment on function public.staff_bookings(uuid) is %L',
    coalesce(obj_description('public.staff_bookings(uuid)'::regprocedure::oid, 'pg_proc'), '')
    || ' Since 20261018130100 hours_limit, booked_hours and cap_hours are computed for an invitation or a booking whose section has not ended, and are null on the history behind them (ADR-0153); every row is still returned.');
end;
$$;
