-- =====================================================================
-- 20261021010200 · Radar's RULE-17 check reads the pool once per section
--
-- staff_open_shifts() (20261019193100) asked auto_assign_candidates_pool()
-- about each qualified worker in turn, stopping at the first reachable one.
-- When none is reachable -- every worker qualified at the client is booked
-- elsewhere, over their hours, or otherwise gated -- it read the pool once
-- per qualified worker, for every section the viewer is not qualified for.
-- Measured on the go-live bench seed (scripts/bench: 1,000 workers, 600
-- sections) in that worst case, as the worker:
--
--                                    194 qualified       979 qualified
--                                    before    after     before     after
--   /radar/[id] (p_shift)            578 ms    52 ms     3,887 ms   98 ms
--   /radar list, 40 such sections  21,801 ms  2,086 ms  136,814 ms 4,054 ms
--
-- The check is now asked in two steps: up to five qualified workers one at
-- a time (the common case -- someone is reachable -- answers as fast as
-- before), and only if none of those is reachable, ONE call about the
-- whole qualified set as p_only, the change 20261021010100 made to
-- apply_to_shift(). One call alone slowed the ordinary list (worker 2 on
-- the bench, 1.2 s -> 4.7 s); with the first step it is unchanged (1.23 s
-- -> 1.28 s; workers 1 and 3 1.89 -> 1.82 s and 0.81 -> 0.54 s), and every
-- worker's list is byte-identical. The verdict is the same rows filtered
-- the same way (gate, qualification and booking status are per worker);
-- nothing else in the body changes. Patched on the LIVE body, as 20261019193100
-- did, and refused unless the block it replaces is found exactly once.
-- jit = off, the grants, SECURITY DEFINER and search_path are kept (CREATE
-- OR REPLACE keeps the ACL and comment; the definition carries the rest).
-- =====================================================================

do $sos$
declare
  v_def text := pg_get_functiondef('public.staff_open_shifts(uuid, uuid)'::regprocedure);
  v_old text := $old$
            -- 20261017180000 judged every qualified worker to answer it;
            -- since 20261019193100 the answer stops at the first one
            -- reachable. A worker who already holds a booking here, does
            -- not hold the role or is not compliant cannot be reachable
            -- (the pool's booking_status, wrong_role and blocked), so the
            -- pool is not asked about them; it decides for the rest.
            else not exists (
              select 1
                from (select cq.staff_id
                        from client_qualifications cq
                        join staff qs on qs.id = cq.staff_id
                       where cq.client_id = ev.client_id and cq.role_id = sr.role_id
                         and not cq.do_not_return
                         and qs.status = 'compliant'
                         and exists (select 1 from staff_roles qr
                                      where qr.staff_id = cq.staff_id and qr.role_id = sr.role_id)
                         and not exists (select 1 from bookings qb
                                          where qb.shift_id = sr.id and qb.staff_id = cq.staff_id)
                      -- OFFSET 0 keeps the pool out of this join: planned
                      -- into it, it can land on a hash join's build side and
                      -- be asked about every worker before the first answer.
                      offset 0) q
               where exists (select 1
                               from auto_assign_candidates_pool(sr.id, false, array[q.staff_id]) w
                              where w.gate is null and w.qualified and w.booking_status is null))
$old$;
  v_new text := $new$
            -- Since 20261021010200 it is asked in two steps. First about a
            -- handful of qualified workers one at a time -- usually one of
            -- them is reachable and the answer comes at once, as before.
            -- Only if none of those is, the pool is asked ONCE about the
            -- whole qualified set (p_only): when nobody in the set was
            -- reachable, the one-at-a-time walk read the pool once per
            -- qualified worker (4 s per section with ~1,000 qualified, the
            -- list far over the 8 s limit). Same verdict either way. A
            -- worker who already holds a booking here, does not hold the
            -- role or is not compliant cannot be reachable (the pool's
            -- booking_status, wrong_role and blocked), so the pool is not
            -- asked about them; it decides for the rest.
            else not (
              exists (
                select 1
                  from (select cq.staff_id
                          from client_qualifications cq
                          join staff qs on qs.id = cq.staff_id
                         where cq.client_id = ev.client_id and cq.role_id = sr.role_id
                           and not cq.do_not_return
                           and qs.status = 'compliant'
                           and exists (select 1 from staff_roles qr
                                        where qr.staff_id = cq.staff_id and qr.role_id = sr.role_id)
                           and not exists (select 1 from bookings qb
                                            where qb.shift_id = sr.id and qb.staff_id = cq.staff_id)
                         limit 5
                        -- OFFSET 0 keeps the pool out of this join: planned
                        -- into it, it can land on a hash join's build side and
                        -- be asked about every worker before the first answer.
                        offset 0) q
                 where exists (select 1
                                 from auto_assign_candidates_pool(sr.id, false, array[q.staff_id]) w
                                where w.gate is null and w.qualified and w.booking_status is null))
              or exists (
                select 1
                  from auto_assign_candidates_pool(sr.id, false, array(
                         select cq.staff_id
                           from client_qualifications cq
                           join staff qs on qs.id = cq.staff_id
                          where cq.client_id = ev.client_id and cq.role_id = sr.role_id
                            and not cq.do_not_return
                            and qs.status = 'compliant'
                            and exists (select 1 from staff_roles qr
                                         where qr.staff_id = cq.staff_id and qr.role_id = sr.role_id)
                            and not exists (select 1 from bookings qb
                                             where qb.shift_id = sr.id and qb.staff_id = cq.staff_id))) w
                 where w.gate is null and w.qualified and w.booking_status is null))
$new$;
  v_n   int;
begin
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then
    raise exception '20261021010200: staff_open_shifts - expected one match of the RULE-17 block, found %', v_n;
  end if;
  v_def := replace(v_def, v_old, v_new);
  if position('SET jit TO ''off''' in v_def) = 0 then
    raise exception '20261021010200: staff_open_shifts lost jit = off';
  end if;
  execute v_def;

  execute format('comment on function public.staff_open_shifts(uuid, uuid) is %L',
    coalesce(obj_description('public.staff_open_shifts(uuid, uuid)'::regprocedure, 'pg_proc'), '')
    || ' Since 20261021010200 RULE-17''s wave check asks the pool once per section, about the whole qualified set (p_only), instead of once per qualified worker.');
end;
$sos$;
