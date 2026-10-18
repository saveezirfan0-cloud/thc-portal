-- =====================================================================
-- Radar reads one pool row, not the whole agency per section
--
-- On 17.10.2026 from 17:04 UTC the live project stopped answering: the
-- Back Office's sign-in check timed out (504 MIDDLEWARE_INVOCATION_TIMEOUT),
-- PostgREST logged "Timed out acquiring connection from connection pool"
-- and Postgres "remaining connection slots are reserved". pg_stat_statements
-- named one statement as the load: staff_open_shifts(), the Staff App's
-- Radar, at 4.1 s a call on average and up to the 8 s statement limit,
-- with more total database time than every other statement put together.
--
-- Why: for EVERY section that has not ended (70 that afternoon) it ran
-- auto_assign_candidates_pool(sr.id) over every worker in the agency, so a
-- single Radar load judged 70 x 424 workers, each through the cap, show-rate
-- and booked-elsewhere subqueries. It needed the whole pool for one thing
-- only: RULE-17's "is anyone qualified at this client and role still
-- reachable?" — and only for a worker who is not qualified there.
--
-- Now:
--   * the viewing worker's own row comes from the pool restricted to them
--     (p_only = array[me.id]) — the one-row read the other single-worker
--     callers already use (20261012140000, ADR-0117);
--   * the RULE-17 wave check runs only when it can change the answer (the
--     worker passed every other test and is not qualified here), and only
--     over the workers qualified at the section's client and role — the only
--     rows of the pool whose `qualified` can be true, so the answer is the
--     same as over the whole pool.
--
-- Re-created from the LIVE body with the pieces changed, the way
-- 20261012140000 did it (docs/10 §3b: a hand-copied body is how a shipped
-- rule gets dropped). Each pattern must match exactly once or the migration
-- stops. All are applied before the one CREATE OR REPLACE: the body is
-- checked as it is created, and half the change does not compile. Security,
-- search_path and grants are untouched.
-- =====================================================================
do $$
declare
  p     record;
  v_def text := pg_get_functiondef('public.staff_open_shifts(uuid)'::regprocedure);
  v_n   int;
begin
  for p in
    select * from (values
      ('-- ONE pass over the section''s candidates, answering both questions\..*?on a phone-facing screen\.',
       '-- The viewing worker''s own row of the section''s pool. Reading the
    -- whole pool here, for every section, judged every worker in the agency
    -- once per section on a phone-facing screen (20261017180000).'),

      ('cross join lateral \(\s+select\s+count\(\*\) filter \(where a\.staff_id = me\.id\) > 0\s+as me_present,.*?as wave1_alive\s+from auto_assign_candidates_pool\(sr\.id\) a \) c',
       'cross join lateral (
      select
        count(*) > 0 as me_present,
        coalesce(min(a.gate), case when sr.same_staff_all_days then series_gate_for(me.id, sr.id) end) as my_gate,
        bool_or(a.qualified)  as my_qualified,
        min(a.booking_status) as my_status,
        min(a.booking_cause)  as my_cause
      -- 20261017180000: this worker''s row only. RULE-17''s wave check is
      -- asked below, and only when it can change the answer.
      from auto_assign_candidates_pool(sr.id, false, array[me.id]) a ) c'),

      ('and \(c\.my_qualified or not c\.wave1_alive\)',
       'and case
            when c.my_qualified then true
            -- RULE-17: is anyone qualified at this client and role still
            -- reachable? A worker not in that set waits for it to empty.
            -- Only the qualified workers can make it true, so the pool is
            -- read for them alone (20261017180000).
            else not coalesce((
              select bool_or(w.gate is null and w.qualified and w.booking_status is null)
                from auto_assign_candidates_pool(sr.id, false, array(
                       select cq.staff_id from client_qualifications cq
                        where cq.client_id = ev.client_id and cq.role_id = sr.role_id
                          and not cq.do_not_return)) w), false)
          end')
    ) as x(pattern, replacement)
  loop
    select count(*) into v_n from regexp_matches(v_def, p.pattern, 'g');
    if v_n <> 1 then
      raise exception '20261017180000: staff_open_shifts - expected one match of %, found %', p.pattern, v_n;
    end if;
    v_def := regexp_replace(v_def, p.pattern, p.replacement);
  end loop;
  execute v_def;

  execute format('comment on function public.staff_open_shifts(uuid) is %L',
    coalesce(obj_description('public.staff_open_shifts(uuid)'::regprocedure::oid, 'pg_proc'), '')
    || ' Since 20261017180000 the viewing worker''s row is read from the pool restricted to them, and RULE-17''s wave check only for a worker not qualified at the section''s client and role, over the qualified workers alone: the same answers, without judging the whole agency once per section.');
end;
$$;
