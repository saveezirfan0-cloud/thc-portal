-- =====================================================================
-- booking_tick: a bounded working set, no temp table, one run at a time,
-- and no No-show / No check-out beside a press that won
-- (ADR-0157; go-live database audit F6, concurrency audit M1, M5)
--
-- 1 · The working set was every confirmed or worked booking EVER (a
--     worked booking stays worked for good), rebuilt into a temporary
--     table every minute: ~110k rows a year with a check_logs probe each,
--     and 1,440 CREATE/DROPs a day churning pg_class / pg_attribute.
--     Locally, over 100,000 worked bookings with 1,700 inside the window:
--     570-960 ms a run before, 60 ms after, and flat as history grows.
--     It is now a CTE per statement — NOT MATERIALIZED, so the planner
--     folds each rule's own time bounds into it and reads only the rows
--     that rule can match — over only the sections a rule can still act
--     on:
--
--         s.starts_at < p_now + 3 days   and   s.ends_at > p_now - 7 days
--
--     Every rule in the function, by when it can fire (role window,
--     RULE-18; ends_at >= starts_at + 4 h by the min_4h constraint):
--       BG-01 N9 in    p_now in [start - 30 min, start)
--       BG-02 N9 out   p_now in [end - 30 min, end)
--       BG-02b N9b     p_now in [end + 30 min, end + 4 h)
--       BG-03 No-show  p_now >= start + 30 min, or >= end when confirmed
--                      after the start (§5.1)
--       BG-09 No c/o   p_now >= end + 4 h (RULE-02)
--       BG-10 N13      p_now in [check-in + 6 h, end + 4 h), check-in >=
--                      start - 30 min
--       N6             p_now in [08:00 UK the day before, 12:00 UK the day
--                      before): start - p_now < 41 h even across a clock
--                      change (the 12:05 cutoff itself is
--                      release_unready_bookings(), untouched)
--       N7             p_now in [00:00 UK on the day at the earliest,
--                      n7_closes_at <= start + 30 min)
--     So nothing fires for a section starting 3 days or more ahead, and
--     the latest any rule first fires is end + 4 h: a section that ended
--     more than 7 days ago has had 6 days 20 hours of minutely runs to
--     raise its No check-out or No-show. The bound is on the END, not the
--     start, so a section longer than a week is not dropped mid-way (no
--     rule limits a section's length). Re-runs stay idempotent as before:
--     outbox keys, NOT EXISTS and, since 20261019150100, the unique index.
--
-- 2 · One run at a time. Runs overlap (one has taken 70 s); the second
--     now returns at once with zero counts and `skipped: true`, and the
--     next minute picks up anything it would have done.
--
-- 3 · BG-03 / BG-09 against a press in flight. The No-show statement read
--     check_logs in its own snapshot, so a check-in committing during the
--     tick was invisible and the worker got a No-show beside a worked
--     booking. The tick now first locks the candidates' role sections FOR
--     NO KEY UPDATE — the lock attempt_check_in holds while it decides
--     (20261019150200) — in id order, and only then, in a fresh statement
--     and so a fresh snapshot, re-reads the working set and raises. A
--     press holding the lock is waited for and seen; a press that waits
--     for the tick finds the No-show and answers `locked`
--     (20261019150200). BG-09 does the same on the accepted check_logs
--     row, the lock check_out holds; and check_out, when a No check-out
--     appeared while it waited (detected after the press began), answers
--     `locked` as it would a moment later — never a recorded check-out
--     beside a fresh No check-out.
--
-- Re-created from the LIVE bodies with targeted replacements (docs/10
-- §3b); each pattern must match the stated number of times or the
-- migration stops. Security, search_path and grants are untouched.
-- =====================================================================
do $$
declare
  v_def  text := pg_get_functiondef('public.booking_tick(timestamp with time zone)'::regprocedure);
  v_ws   text;
  v_n    int;
  v_pat  text;
begin
  -- -------------------------------------------------------------------
  -- The working set, as the live body states it, plus the window.
  -- -------------------------------------------------------------------
  v_pat := 'create temporary table _tick on commit drop as\s+(select b\.id\s+as booking_id,.*?and b\.status in \(''confirmed'', ''worked''\));';
  select count(*) into v_n from regexp_matches(v_def, v_pat, 'g');
  if v_n <> 1 then
    raise exception '20261019150300: booking_tick - expected one working-set statement, found %', v_n;
  end if;
  v_ws := (regexp_match(v_def, v_pat))[1] || '
       -- 20261019150300: only sections a rule can still act on.
       and s.starts_at < p_now + interval ''3 days''
       and s.ends_at   > p_now - interval ''7 days''';
  if strpos(v_ws, '\') > 0 then
    raise exception '20261019150300: booking_tick - unexpected backslash in the working set';
  end if;

  v_def := regexp_replace(v_def, v_pat,
    '-- 20261019150300: no temporary table. Each statement below reads the
  -- working set as a CTE named _tick, inlined into each rule and bounded
  -- to the sections a rule can still act on (see the migration for the
  -- proof).');

  -- -------------------------------------------------------------------
  -- One run at a time.
  -- -------------------------------------------------------------------
  select count(*) into v_n from regexp_matches(v_def, '\nbegin\n', 'g');
  if v_n <> 1 then
    raise exception '20261019150300: booking_tick - expected one top-level begin, found %', v_n;
  end if;
  v_def := regexp_replace(v_def, '\nbegin\n', '
begin
  -- 20261019150300: overlapping runs each saw the other''s work undone.
  -- The second returns at once; the next minute catches up.
  if not pg_try_advisory_xact_lock(hashtextextended(''booking_tick'', 0)) then
    return jsonb_build_object(''n9_check_in'', 0, ''n9_check_out'', 0, ''n9b'', 0, ''no_show'', 0,
                              ''no_checkout'', 0, ''n13'', 0, ''n6'', 0, ''n7'', 0, ''skipped'', true);
  end if;
');

  -- -------------------------------------------------------------------
  -- BG-03: lock the candidates' sections, then raise in a fresh snapshot.
  -- The lock set is a superset of the statement's: both branches of the
  -- rule need p_now >= start + 30 min.
  -- -------------------------------------------------------------------
  v_pat := 'with due as \(\s+select \* from _tick\s+where status = ''confirmed''\s+and check_in_at is null\s+and \(';
  select count(*) into v_n from regexp_matches(v_def, v_pat, 'g');
  if v_n <> 1 then
    raise exception '20261019150300: booking_tick - expected one BG-03 statement, found %', v_n;
  end if;
  v_def := regexp_replace(v_def, v_pat, replace('-- 20261019150300: the check-in''s own lock, in id order, so a press
  -- deciding now is waited for and seen by the statement below.
  perform 1
     from shift_requirements sl
    where sl.id in (
      with _tick as not materialized (
  @WS@
      )
      select _tick.shift_id from _tick
       where status = ''confirmed''
         and check_in_at is null
         and p_now >= starts_at + interval ''30 minutes''
         and not exists (select 1 from violations v
                          where v.booking_id = _tick.booking_id and v.type = ''no_show''))
    order by sl.id
    for no key update of sl;

  \&', '@WS@', v_ws));

  -- -------------------------------------------------------------------
  -- BG-09: lock the candidates' accepted check-ins, then raise.
  -- -------------------------------------------------------------------
  v_pat := 'with due as \(\s+select \* from _tick\s+where check_in_at is not null\s+and check_out_at is null\s+and p_now >= ends_at \+ interval ''4 hours''';
  select count(*) into v_n from regexp_matches(v_def, v_pat, 'g');
  if v_n <> 1 then
    raise exception '20261019150300: booking_tick - expected one BG-09 statement, found %', v_n;
  end if;
  v_def := regexp_replace(v_def, v_pat, replace('-- 20261019150300: check_out()''s own lock, in id order, so a check-out
  -- deciding now is waited for and seen by the statement below.
  perform 1
     from check_logs ck
    where ck.check_in_at is not null
      and ck.booking_id in (
      with _tick as not materialized (
  @WS@
      )
      select _tick.booking_id from _tick
       where check_in_at is not null
         and check_out_at is null
         and p_now >= ends_at + interval ''4 hours''
         and not exists (select 1 from violations v
                          where v.booking_id = _tick.booking_id and v.type = ''no_checkout''))
    order by ck.id
    for no key update of ck;

  \&', '@WS@', v_ws));

  -- -------------------------------------------------------------------
  -- Every statement reads the working set as its own CTE.
  -- -------------------------------------------------------------------
  v_n := (length(v_def) - length(replace(v_def, 'with due as (', ''))) / length('with due as (');
  if v_n <> 8 then
    raise exception '20261019150300: booking_tick - expected eight statements on the working set, found %', v_n;
  end if;
  v_def := replace(v_def, 'with due as (', 'with _tick as not materialized (
  ' || v_ws || '
  ), due as (');

  select count(*) into v_n from regexp_matches(v_def, '\n\s*drop table _tick;\n', 'g');
  if v_n <> 1 then
    raise exception '20261019150300: booking_tick - expected one drop table, found %', v_n;
  end if;
  v_def := regexp_replace(v_def, '\n\s*drop table _tick;\n', E'\n');

  if v_def ~* 'create\s+temporary\s+table' then
    raise exception '20261019150300: booking_tick - a temporary table is left';
  end if;
  execute v_def;
end;
$$;

-- ---------------------------------------------------------------------
-- check_out: a No check-out raised while the press waited
-- ---------------------------------------------------------------------
do $$
declare
  p     record;
  v_def text := pg_get_functiondef('public.check_out(uuid,double precision,double precision,double precision)'::regprocedure);
  v_n   int;
begin
  for p in
    select * from (values
      ('(d := check_out_decision\(sr\.starts_at, sr\.ends_at, v_now, v_inside, cl\.check_in_at, v_last_site\);)',
       '\1

  -- One outcome, never both (20261019150300): BG-09 raised No check-out
  -- while this press waited for the check-in row — the button had locked
  -- by the time the press could be judged, so it is the locked press.
  if exists (select 1 from violations
              where booking_id = b.id and type = ''no_checkout'' and not resolved
                and detected_at > v_now) then
    d := check_out_decision(sr.starts_at, sr.ends_at, sr.ends_at + interval ''4 hours'',
                            v_inside, cl.check_in_at, v_last_site);
  end if;')
    ) as x(pattern, replacement)
  loop
    select count(*) into v_n from regexp_matches(v_def, p.pattern, 'g');
    if v_n <> 1 then
      raise exception '20261019150300: check_out - expected one match of %, found %', p.pattern, v_n;
    end if;
    v_def := regexp_replace(v_def, p.pattern, p.replacement);
  end loop;
  execute v_def;
end;
$$;
