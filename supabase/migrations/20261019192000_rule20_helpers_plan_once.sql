-- =====================================================================
-- RULE-20's helpers are planned once, not on every call (ADR-0155)
--
-- Audit 17.10.2026 F3. Every helper in the weekly-cap chain was a SQL
-- function with `SET search_path`. Postgres never inlines a SQL function
-- that carries a SET clause, and on 16/17 a SQL function that is not
-- inlined keeps its plan only as long as the FmgrInfo of the expression
-- calling it. Called from inside ANOTHER function's query, that FmgrInfo
-- is rebuilt every time the outer query starts, so the inner body was
-- parsed and planned again on every call, all the way down the chain:
-- weekly_cap_would_breach() → rota_guard_verdict() → weekly_cap_for() →
-- weekly_cap() → cap_term_state() → cap_week_start() … Measured locally
-- (scripts/bench/rule20_staff_bookings_candidates.sql, 1,000 workers,
-- 114k bookings): weekly_cap_would_breach 4.8 ms a call, of which about
-- 1.5 ms is work.
--
-- Two changes, no rule changes:
--
--   1. The PURE helpers — expressions over their arguments, reading no
--      table and calling nothing of ours that could be swapped —
--      lose `SET search_path`, so the planner inlines them into their
--      callers: cap_week_start, can_roster, booking_counts_toward_cap,
--      cap_under_18, booked_elsewhere_conflict, booking_reopenable_by and
--      the three weekly_cap overloads. Every name in
--      their bodies is schema-qualified (public. / pg_catalog.), so a
--      caller's search_path cannot redirect them; operators resolve in
--      pg_catalog, which every search_path searches first. All are
--      SECURITY INVOKER: an inlined body runs with the caller's rights, as
--      it did. pgTAP 002 proves each one still answers under an empty
--      search_path. Two bodies change shape, both proved equal to the old
--      ones in pgTAP 853:
--        * cap_week_start: date_trunc('week', p_date) resolved to the
--          timestamptz overload (STABLE, session time zone), so an
--          IMMUTABLE function could never be inlined. It now truncates a
--          timestamp without time zone — the same Monday for every date,
--          infinity included, whatever the session's zone.
--        * weekly_cap (12 arguments): the `in_force` CTE is folded into
--          the CASE, because a body with a FROM clause is never inlined.
--          The two expressions are moved verbatim, not rewritten.
--
--   2. The helpers that READ TABLES (or that cannot be inlined: a CTE, an
--      aggregate, a security definer) become plpgsql and keep their pinned
--      search_path. A plpgsql function keeps its plans for the session,
--      however it is called. The body is the live SQL body, unchanged,
--      wrapped as `return ( … );` (`return query …;` for the one that
--      returns a table): weekly_cap_for, weekly_cap_hours,
--      weekly_cap_would_breach, rota_guard_verdict, rota_guard_mode,
--      rota_guard_decide, can_roster_staff, weekly_booked_hours,
--      weekly_booked_hours_except, cap_term_state.
--      rota_guard_decide is pure but is NOT inlined on purpose: inlined,
--      the planner pasted its CASE — and the can_roster_staff() and
--      weekly_booked_hours_except() calls in its arguments — into every
--      place that reads its two columns, running them two or three times.
--      Two bodies also change, each only by adding (see section 2 below):
--      the booked-hours readers bound the week as instants so an index can
--      find it, and rota_guard_verdict computes its `x` subquery once.
--
-- Re-created from the LIVE bodies (docs/10 §3b; the pattern of
-- 20261017180000): every definition is read with pg_get_functiondef() and
-- changed by named patterns, each of which must match the expected number
-- of times or the migration stops. Owners, grants and comments stay with
-- the function (same oid); volatility, strictness and security are not
-- touched.
-- =====================================================================

-- Substitute a pattern, insisting on how many times it matches.
create function pg_temp.r20_sub(p_def text, p_pattern text, p_replacement text, p_expect int, p_label text)
returns text language plpgsql as $f$
declare v_n int;
begin
  select count(*) into v_n from regexp_matches(p_def, p_pattern, 'g');
  if v_n <> p_expect then
    raise exception '20261019192000: % - expected % match(es) of %, found %', p_label, p_expect, p_pattern, v_n;
  end if;
  return regexp_replace(p_def, p_pattern, p_replacement, 'g');
end $f$;

-- Replace a definition's body, keeping its header byte for byte.
create function pg_temp.r20_body(p_def text, p_body text, p_label text)
returns text language plpgsql as $f$
declare v_at int := position('AS $function$' in p_def);
begin
  if v_at = 0 or right(rtrim(p_def, E' \n'), 10) <> '$function$' then
    raise exception '20261019192000: % - unexpected definition shape', p_label;
  end if;
  return left(p_def, v_at - 1) || 'AS $function$' || p_body || '$function$';
end $f$;

-- ---------------------------------------------------------------------
-- 1. The pure helpers: unpinned, qualified, inlined.
-- ---------------------------------------------------------------------
do $$
declare
  f     record;
  v_def text;
  v_src text;
  v_completion text;
  v_optout     text;
  v_main       text;
  i int; j int; k int;
begin
  for f in
    select * from (values
      ('public.cap_week_start(date)',
       array[['(?<![.\w])date_trunc\(''week'', p_date\)::date',
              'pg_catalog.date_trunc(''week'', p_date::pg_catalog.timestamp)::pg_catalog.date', '1']]),
      ('public.can_roster(date,date)', array[]::text[]),
      ('public.booking_counts_toward_cap(booking_status,timestamp with time zone,text)', array[]::text[]),
      ('public.cap_under_18(date,date)',
       array[['\)::date', ')::pg_catalog.date', '1']]),
      ('public.booked_elsewhere_conflict(timestamp with time zone,timestamp with time zone,uuid,timestamp with time zone,timestamp with time zone,uuid,integer)',
       array[['(?<![.\w])make_interval\(', 'pg_catalog.make_interval(', '2']]),
      ('public.booking_reopenable_by(booking_status,text)', array[]::text[]),
      ('public.weekly_cap(boolean,text,boolean,boolean)',
       array[['(?<![.\w])weekly_cap\(', 'public.weekly_cap(', '1'],
             ['null::date', 'null::pg_catalog.date', '4']]),
      ('public.weekly_cap(boolean,text,boolean,boolean,date,boolean,date,date,date,boolean)',
       array[['(?<![.\w])weekly_cap\(', 'public.weekly_cap(', '1'],
             ['null::date', 'null::pg_catalog.date', '1']]),
      ('public.weekly_cap(boolean,text,boolean,boolean,date,boolean,date,date,date,boolean,date,integer)',
       array[['\)::cap_assessment', ')::public.cap_assessment', '8']])
    ) as x(fn, subs)
  loop
    v_def := pg_get_functiondef(f.fn::regprocedure);

    -- The pin goes; nothing else in the header moves.
    v_def := pg_temp.r20_sub(v_def, E'\n SET search_path TO ''public'', ''extensions''\n', E'\n', 1, f.fn || ' pin');
    if v_def !~ E'\n LANGUAGE sql\n' or v_def ~ 'SECURITY DEFINER' or v_def ~ E'\n VOLATILE' then
      raise exception '20261019192000: % is not a plain invoker SQL helper; it must keep its pin', f.fn;
    end if;

    for i in 1 .. coalesce(array_length(f.subs, 1), 0) loop
      v_def := pg_temp.r20_sub(v_def, f.subs[i][1], f.subs[i][2], f.subs[i][3]::int, f.fn);
    end loop;

    -- weekly_cap(12): fold the in_force CTE into the CASE so the body has
    -- no FROM clause. The two expressions move verbatim.
    if f.fn like 'public.weekly_cap(%,integer)' then
      v_src := substr(v_def, position('AS $function$' in v_def) + length('AS $function$'));
      v_src := left(v_src, length(rtrim(v_src, E' \n')) - length('$function$'));
      i := position('with in_force as (' in v_src);
      j := position('as completion,' in v_src);
      k := position('as optout' in v_src);
      if i = 0 or j = 0 or k = 0 or position('from in_force' in v_src) = 0 then
        raise exception '20261019192000: weekly_cap(12) - in_force CTE not where it was';
      end if;
      v_completion := substr(v_src, i + length('with in_force as ('), j - i - length('with in_force as ('));
      v_completion := regexp_replace(v_completion, '^\s*select\s', '');
      v_optout     := substr(v_src, j + length('as completion,'), k - j - length('as completion,'));
      v_main       := substr(v_src, position('select case' in v_src));
      v_main       := left(v_main, position('from in_force' in v_main) - 1);
      if (length(v_main) - length(replace(v_main, 'in_force.completion', ''))) / length('in_force.completion') <> 2
         or (length(v_main) - length(replace(v_main, 'in_force.optout', ''))) / length('in_force.optout') <> 1
         or regexp_replace(v_main, 'is (not )?distinct from', '', 'gi') ~* '\mfrom\M' then
        raise exception '20261019192000: weekly_cap(12) - in_force is not used the way it was';
      end if;
      v_main := replace(v_main, 'in_force.completion', '(' || v_completion || E'\n         )');
      v_main := replace(v_main, 'in_force.optout',     '(' || v_optout     || E'\n         )');
      v_def := pg_temp.r20_body(v_def,
        E'\n  -- 20261019192000: the in_force CTE folded in, so the planner inlines\n'
        || E'  -- this into its callers. completionInForce() / optOutInForce() in\n'
        || E'  -- cap.ts are the two parenthesised expressions, as they were.\n  '
        || rtrim(v_main, E' \n') || E'\n', f.fn);
    end if;

    execute v_def;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. The table readers: plpgsql around the live body, still pinned.
--
-- The two booked-hours readers also say which instants the week can
-- start in, so the planner may begin from that week's sections
-- (shift_requirements_starts_at_idx) instead of every booking the worker
-- has ever had. The bound is a day wider on each side than the UK week
-- and the UK-date test stays as it was, so it can only ever let through
-- rows that test then decides on: the answer is the same, set for set.
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.weekly_booked_hours(uuid,date)'::regprocedure);
  v_def := pg_temp.r20_sub(v_def,
    E'(\n\\s+and \\(select cap_week_start\\(p_date\\)\\) \\+ 6\n)',
    E'\\1         -- 20261019192000: the same week, a day wider each side, as instants.\n'
    || E'         and sr.starts_at >= ((select cap_week_start(p_date))::timestamp - interval ''1 day'') at time zone ''UTC''\n'
    || E'         and sr.starts_at <  ((select cap_week_start(p_date))::timestamp + interval ''8 days'') at time zone ''UTC''\n',
    1, 'weekly_booked_hours week bound');
  execute v_def;

  v_def := pg_get_functiondef('public.weekly_booked_hours_except(uuid,date,uuid)'::regprocedure);
  v_def := pg_temp.r20_sub(v_def,
    E'(\n\\s+between cap_week_start\\(p_date\\) and cap_week_start\\(p_date\\) \\+ 6\n)',
    E'\\1    -- 20261019192000: the same week, a day wider each side, as instants.\n'
    || E'    and sr.starts_at >= (cap_week_start(p_date)::timestamp - interval ''1 day'') at time zone ''UTC''\n'
    || E'    and sr.starts_at <  (cap_week_start(p_date)::timestamp + interval ''8 days'') at time zone ''UTC''\n',
    1, 'weekly_booked_hours_except week bound');
  execute v_def;

  -- rota_guard_verdict: the planner pulled the `x` subquery up into the
  -- query and pasted weekly_booked_hours_except() in at both places that
  -- read x.booked (the verdict and the jsonb), so it ran twice a call.
  -- OFFSET 0 keeps x a subquery: the same values, computed once.
  v_def := pg_get_functiondef('public.rota_guard_verdict(uuid,uuid)'::regprocedure);
  v_def := pg_temp.r20_sub(v_def,
    E'(rota_guard_mode\\(\\)\\s+as mode)(\n\\s*\\) x\n)',
    E'\\1\n      offset 0  -- 20261019192000: x is computed once, not pasted in per reference\\2',
    1, 'rota_guard_verdict x once');
  execute v_def;
end;
$$;

do $$
declare
  f     text;
  v_def text;
  v_src text;
begin
  foreach f in array array[
    'public.cap_term_state(daterange[],date)',
    'public.rota_guard_mode()',
    'public.rota_guard_decide(boolean,integer,cap_band,numeric,numeric,text)',
    'public.can_roster_staff(uuid,date)',
    'public.weekly_booked_hours(uuid,date)',
    'public.weekly_booked_hours_except(uuid,date,uuid)',
    'public.weekly_cap_for(uuid,date)',
    'public.weekly_cap_hours(uuid,date)',
    'public.rota_guard_verdict(uuid,uuid)',
    'public.weekly_cap_would_breach(uuid,uuid)'
  ] loop
    v_def := pg_get_functiondef(f::regprocedure);
    select p.prosrc into v_src from pg_proc p where p.oid = f::regprocedure;
    if v_def !~ E'\n SET search_path TO ' then
      raise exception '20261019192000: % has lost its pinned search_path', f;
    end if;
    if v_src ~ ';\s*\S' then
      raise exception '20261019192000: % has more than one statement', f;
    end if;
    v_def := pg_temp.r20_sub(v_def, E'\n LANGUAGE sql\n', E'\n LANGUAGE plpgsql\n', 1, f || ' language');
    if (select p.proretset from pg_proc p where p.oid = f::regprocedure) then
      -- RETURNS TABLE: its column names become plpgsql variables, so the
      -- body must not use them as bare identifiers.
      if exists (select 1 from pg_proc p, unnest(p.proargnames, p.proargmodes) a(n, m)
                  where p.oid = f::regprocedure and a.m = 't' and v_src ~ ('\m' || a.n || '\M')) then
        raise exception '20261019192000: % - a result column is named in the body', f;
      end if;
      v_def := pg_temp.r20_body(v_def,
        E'\nbegin\n  -- 20261019192000: the SQL body as it was, in plpgsql so its plan is\n'
        || E'  -- kept for the session instead of rebuilt on every call (ADR-0155).\n'
        || E'  return query\n' || rtrim(v_src, E' \n;') || E';\nend\n', f);
    else
      v_def := pg_temp.r20_body(v_def,
        E'\nbegin\n  -- 20261019192000: the SQL body as it was, in plpgsql so its plan is\n'
        || E'  -- kept for the session instead of rebuilt on every call (ADR-0155).\n'
        || E'  return (\n' || rtrim(v_src, E' \n;') || E'\n  );\nend\n', f);
    end if;
    execute v_def;
    execute format('comment on function %s is %L', f,
      coalesce(obj_description(f::regprocedure::oid, 'pg_proc') || ' ', '')
      || 'Since 20261019192000 plpgsql around the same SQL body, so the plan is kept for the session (ADR-0155).');
  end loop;
end;
$$;

drop function pg_temp.r20_sub(text, text, text, int, text);
drop function pg_temp.r20_body(text, text, text);
