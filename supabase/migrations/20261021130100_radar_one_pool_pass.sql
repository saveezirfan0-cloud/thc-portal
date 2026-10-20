-- =====================================================================
-- Migration 20261021130100 · Radar asks the pool once for the worker's own
--                            rows, and once a round for RULE-17 (ADR-0170)
--
-- After 20261019193100 Radar still made one pool call per candidate
-- section for the worker's own row (~190 for a two-role worker at go-live
-- size) and, for each section the worker is not qualified at, at least one
-- more for RULE-17's "is a qualified worker still reachable?" (~170): 1.5 s
-- for that worker on the 1,000-worker bench, ~4 ms a call.
--
-- Now, with every gate, the wave and the cards exactly as before (pgTAP
-- 880 compares this body with 20261019193100's over 859's fixture, as
-- nine workers, and section by section):
--
--   1. the worker's own rows come from auto_assign_worker_pool(me, the
--      candidate sections): the same rows auto_assign_candidates_pool(
--      section, false, array[me]) returned, in one pass;
--   2. RULE-17 is auto_assign_wave1_reachable(): for every section that
--      can need it at once, the qualified workers who could be reachable
--      (qualified at the client and role, compliant, holding the role and
--      no booking on the section — without any of these the pool's row
--      could not be reachable), asked of the pool in rounds of 1, 4, 16 …
--      per section, a section dropping out the moment one is reachable or
--      its list runs out. The answer is the EXISTS it replaces; a section
--      no longer costs a pool call of its own;
--   3. the sections handed to it are those where the answer can matter:
--      the worker's own row has no gate or hours_limit, is not qualified,
--      and the section has not started. The query asks again; nothing is
--      decided there.
--
-- Re-created from the LIVE body with targeted replacements (docs/10 §3b),
-- each pattern on code only and required to match exactly once; security
-- definer, search_path, jit off, grants and comment are carried over.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · RULE-17 for many sections: is a qualified worker still reachable?
-- ---------------------------------------------------------------------
create or replace function public.auto_assign_wave1_reachable(p_shifts uuid[], p_series boolean default false)
returns table (shift_id uuid)
language plpgsql
stable
set search_path = public, extensions
set jit = off
as $function$
#variable_conflict use_column
declare
  v_left uuid[] := array(select distinct u from unnest(p_shifts) u where u is not null);
  v_open uuid[] := '{}';
  v_ps   uuid[];
  v_pw   uuid[];
  v_from int := 0;
  v_step int := 1;
begin
  -- RULE-17 (§3.4): wave 1 is everyone qualified at the section's client
  -- AND role; it is exhausted when none of them is reachable — the pool
  -- gives them no gate, they are qualified and they hold no booking there.
  -- A worker who is not compliant, does not hold the role or already holds
  -- a booking on the section cannot be reachable (the pool's blocked,
  -- wrong_role and booking_status), so only the rest are asked about, in
  -- staff_id order, the next v_step of them per section each round.
  -- With p_series the series days count too, as auto_assign_worker_gate()
  -- and auto_assign_candidates() judge a worker: no gate on the section
  -- itself, then none from series_gate_for(). Radar reads the section's
  -- own pool alone (p_series false), as it always has.
  while cardinality(v_left) > 0 loop
    select array_agg(q.shift_id order by q.shift_id, q.staff_id),
           array_agg(q.staff_id order by q.shift_id, q.staff_id)
      into v_ps, v_pw
      from (select sr.id as shift_id, c1.staff_id
              from shift_requirements sr
              join events ev on ev.id = sr.event_id
             cross join lateral (
               select cq.staff_id
                 from client_qualifications cq
                 join staff qs on qs.id = cq.staff_id
                where cq.client_id = ev.client_id and cq.role_id = sr.role_id
                  and not cq.do_not_return
                  and qs.status = 'compliant'
                  and exists (select 1 from staff_roles qr
                               where qr.staff_id = cq.staff_id and qr.role_id = sr.role_id)
                  and not exists (select 1 from bookings qb
                                   where qb.shift_id = sr.id and qb.staff_id = cq.staff_id)
                order by cq.staff_id
               offset v_from limit v_step) c1
             where sr.id = any (v_left)) q;

    -- every section's list has run out: wave 1 is exhausted on each left
    exit when v_ps is null;

    v_open := v_open || array(
      select distinct c.shift_id
        from auto_assign_candidates_pool_pairs(v_ps, v_pw, false) c
       where c.gate is null and c.qualified and c.booking_status is null
         and (not p_series or series_gate_for(c.staff_id, c.shift_id) is null));

    -- still open: sections that had someone to ask this round and are not
    -- answered yet
    v_left := array(select distinct u from unnest(v_ps) u where not (u = any (v_open)));
    v_from := v_from + v_step;
    v_step := v_step * 4;
  end loop;

  return query select distinct u.x from unnest(v_open) as u(x);
end
$function$;

revoke execute on function public.auto_assign_wave1_reachable(uuid[], boolean) from public, anon;
grant  execute on function public.auto_assign_wave1_reachable(uuid[], boolean) to authenticated, service_role;

comment on function public.auto_assign_wave1_reachable(uuid[], boolean) is
  'RULE-17 for many sections at once (ADR-0170): the sections of p_shifts on which a worker qualified at the client and role is still reachable - no gate, qualified and holding no booking there, in auto_assign_candidates_pool_pairs()''s words (with p_series, series_gate_for() too, as auto_assign_worker_gate() says). Stops asking about a section at its first reachable worker. SECURITY INVOKER; Radar reads it.';

-- ---------------------------------------------------------------------
-- 2 · staff_open_shifts(p_staff, p_shift)
-- ---------------------------------------------------------------------
do $$
declare
  p     record;
  v_def text := pg_get_functiondef('public.staff_open_shifts(uuid, uuid)'::regprocedure);
  v_cmt text := obj_description('public.staff_open_shifts(uuid, uuid)'::regprocedure::oid, 'pg_proc');
  v_n   int;
begin
  for p in
    select * from (values
      -- 1 + 2 + 3 · the worker's own rows and the RULE-17 answers, once
      -- per load, before the week meter
      ('\n  meter as materialized \(\n',
       $r$
  -- 20261021130100: the worker's own row of each candidate section's pool,
  -- in one pass: what auto_assign_candidates_pool(section, false,
  -- array[me]) returned for it, section by section.
  own as materialized (
    select a.*
      from me
     cross join lateral auto_assign_worker_pool(me.id, array(select cand.id from cand)) a
  ),
  -- 20261021130100: RULE-17's answer for every section where it can
  -- matter (the worker's own row has no gate or only hours_limit, is not
  -- qualified, and the section has not started): the sections on which a
  -- qualified worker is still reachable. The query below asks again.
  w1 as materialized (
    select x.shift_id
      from auto_assign_wave1_reachable(array(
             select a.shift_id
               from own a
               join shift_requirements s2 on s2.id = a.shift_id
              where (a.gate is null or a.gate = 'hours_limit')
                and not a.qualified
                and s2.starts_at > now())) x
  ),
  meter as materialized (
$r$),

      -- 1 · the card's own row is read from them
      ('from\s+auto_assign_candidates_pool\(sr\.id,\s*false,\s*array\[me\.id\]\)\s+a\M',
       'from own a where a.shift_id = sr.id'),

      -- 2 · RULE-17 reads the answers
      ('else not exists \(.*?auto_assign_candidates_pool\(sr\.id, false, array\[q\.staff_id\]\) w\s+where w\.gate is null and w\.qualified and w\.booking_status is null\)\)',
       $r$-- since 20261021130100 the answers for every section come from
            -- auto_assign_wave1_reachable(), which stops at the first
            -- reachable qualified worker per section (w1 above).
            else sr.id not in (select w1.shift_id from w1)$r$)
    ) as x(pattern, replacement)
  loop
    select count(*) into v_n from regexp_matches(v_def, p.pattern, 'g');
    if v_n <> 1 then
      raise exception '20261021130100: staff_open_shifts - expected one match of %, found %', p.pattern, v_n;
    end if;
    v_def := regexp_replace(v_def, p.pattern, p.replacement);
  end loop;

  execute v_def;

  execute format('comment on function public.staff_open_shifts(uuid, uuid) is %L',
    coalesce(v_cmt, '')
    || ' Since 20261021130100 (ADR-0170) the worker''s own rows come from auto_assign_worker_pool() in one pass and RULE-17''s wave check from auto_assign_wave1_reachable(), once per load, instead of a pool call per section.');
end;
$$;
