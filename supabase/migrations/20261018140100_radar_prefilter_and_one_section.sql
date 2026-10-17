-- =====================================================================
-- Migration 20261018140100 · Radar asks the pool about the sections it
--                            could show, and /radar/[id] reads one section
--                            (ADR-0154)
--
-- 20261017180000 (the 17.10 hotfix, applied live during the incident)
-- stopped staff_open_shifts() reading the whole agency's pool once per
-- section. Two costs were left, and both grow with the agency:
--
--   * the worker's own pool row was still read for EVERY open section in
--     the agency, wrong-role ones included (they are dropped only after,
--     by their gate). At 600 open sections that is 600 pool reads a load;
--   * RULE-17's "is anyone qualified at this client and role still
--     reachable?" read the pool for every qualified worker, every time,
--     for every section the viewer is not qualified at — and a new starter
--     is qualified nowhere. On the 1,000-worker bench a two-role worker's
--     Radar took 69 s and a new starter's 22 s (now 1.3 s and 0.7 s).
--
-- Now, re-created from the LIVE body with targeted replacements (docs/10
-- §3b), each pattern required to match exactly once:
--
--   1. a `cand` step finds, without the pool, the sections Radar could show
--      this worker at all: their own pending application is on it (kept
--      until RULE-16 ends it, as before), or it has not started, has a slot
--      left (fill counts confirmed and worked, as shift_fill() does) and the
--      worker holds its role — without it the pool says wrong_role, which
--      never shows. Each is a test the query makes again afterwards, so
--      nothing is decided there; the pool still decides every gate;
--   2. RULE-17's check stops at the first reachable qualified worker. A
--      qualified worker who already holds a booking on the section, does
--      not hold the role or is not compliant cannot be reachable (the pool's
--      booking_status, wrong_role, blocked), so the pool is not asked about
--      them; it is asked, one worker at a time, about the rest;
--   3. a second, optional argument p_shift narrows the list to one section,
--      the way staff_open_offers(p_offer) does: /radar/[id] read the whole
--      Radar to show one card. The function is dropped and re-created for
--      the new argument; staff_open_shifts() and staff_open_shifts(p_staff)
--      read exactly as before;
--   4. jit off for the body, as for the pool (20261018140000);
--   5. the ORDER BY ends on the section id, so two sections at the same
--      distance starting at the same moment no longer swap between loads.
--
-- auto_assign_candidates(), the list wrapper the board and the rounds read,
-- returns its rows in staff_id order, so a reader paging through it sees a
-- stable order (another session is adding the paging); nothing else in it
-- changes, and no gate is added to it.
--
-- Security definer, search_path, grants and comments are carried over.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · staff_open_shifts(p_staff, p_shift)
-- ---------------------------------------------------------------------
do $$
declare
  p     record;
  v_def text := pg_get_functiondef('public.staff_open_shifts(uuid)'::regprocedure);
  v_cmt text := obj_description('public.staff_open_shifts(uuid)'::regprocedure::oid, 'pg_proc');
  v_n   int;
begin
  for p in
    select * from (values
      -- 3 · the new argument
      ('public\.staff_open_shifts\(p_staff uuid DEFAULT NULL::uuid\)',
       'public.staff_open_shifts(p_staff uuid DEFAULT NULL::uuid, p_shift uuid DEFAULT NULL::uuid)'),

      -- 1 · the sections joined are the prefiltered ones (applied to the
      -- original join before step 1's CTE, which repeats its text, exists)
      ('\n    join shift_requirements sr on sr\.ends_at > now\(\)\n',
       E'\n    join shift_requirements sr on sr.id in (select cand.id from cand)\n                              and sr.ends_at > now()\n'),

      -- 1 · the prefilter
      ('  with me as \(select staff_caller\(p_staff\) as id\)\n',
       $r$  with me as (select staff_caller(p_staff) as id),
  -- 20261018140100: the sections Radar could show this worker at all,
  -- found without the pool, so the pool is asked about those alone (it
  -- was asked about every open section in the agency). Nothing is decided
  -- here: each test is one the query below makes again. The worker's own
  -- pending application keeps a section, as below (RULE-16 ends it).
  -- Otherwise it must not have started, must have a slot left (fill counts
  -- confirmed and worked, as shift_fill() does) and the worker must hold
  -- its role: without it the pool says wrong_role, which never shows.
  -- p_shift narrows the list to one section for /radar/[id].
  cand as materialized (
    select sr.id
      from me
      join shift_requirements sr on sr.ends_at > now()
      join events ev on ev.id = sr.event_id and ev.cancelled_at is null
     where (p_shift is null or sr.id = p_shift)
       and (exists (select 1 from bookings o
                     where o.shift_id = sr.id and o.staff_id = me.id and o.status = 'applied')
            or (sr.starts_at > now()
                and exists (select 1 from staff_roles sro
                             where sro.staff_id = me.id and sro.role_id = sr.role_id)
                and (select count(*) from bookings b
                      where b.shift_id = sr.id and b.status in ('confirmed', 'worked')) < sr.headcount))
  )
$r$),

      -- 2 · RULE-17 stops at the first reachable qualified worker
      ('            else not coalesce\(\(\n.*?\)\) w\), false\)\n',
       $r$            -- 20261017180000 judged every qualified worker to answer it;
            -- since 20261018140100 the answer stops at the first one
            -- reachable. A worker who already holds a booking here, does
            -- not hold the role or is not compliant cannot be reachable
            -- (the pool's booking_status, wrong_role and blocked), so the
            -- pool is not asked about them; it decides for the rest.
            else not exists (
              select 1
                from client_qualifications cq
                join staff qs on qs.id = cq.staff_id
               where cq.client_id = ev.client_id and cq.role_id = sr.role_id
                 and not cq.do_not_return
                 and qs.status = 'compliant'
                 and exists (select 1 from staff_roles qr
                              where qr.staff_id = cq.staff_id and qr.role_id = sr.role_id)
                 and not exists (select 1 from bookings qb
                                  where qb.shift_id = sr.id and qb.staff_id = cq.staff_id)
                 and exists (select 1
                               from auto_assign_candidates_pool(sr.id, false, array[cq.staff_id]) w
                              where w.gate is null and w.qualified and w.booking_status is null))
$r$),

      -- 5 · a total order: two sections at the same distance starting at
      -- the same moment came back in whichever order the plan met them
      ('\n           sr\.starts_at\n',
       E'\n           sr.starts_at,\n           sr.id\n')
    ) as x(pattern, replacement)
  loop
    select count(*) into v_n from regexp_matches(v_def, p.pattern, 'g');
    if v_n <> 1 then
      raise exception '20261018140100: staff_open_shifts - expected one match of %, found %', p.pattern, v_n;
    end if;
    v_def := regexp_replace(v_def, p.pattern, p.replacement);
  end loop;

  drop function public.staff_open_shifts(uuid);
  execute v_def;

  alter function public.staff_open_shifts(uuid, uuid) set jit = off;
  revoke execute on function public.staff_open_shifts(uuid, uuid) from public, anon;
  grant  execute on function public.staff_open_shifts(uuid, uuid) to authenticated, service_role;

  execute format('comment on function public.staff_open_shifts(uuid, uuid) is %L',
    coalesce(v_cmt, '')
    || ' Since 20261018140100 (ADR-0154) the pool is asked only about the sections the worker could be shown (their own application, or not started, not full and in a role they hold), RULE-17''s wave check stops at the first reachable qualified worker, and p_shift narrows the list to one section for /radar/[id].');
end;
$$;

-- ---------------------------------------------------------------------
-- 2 · auto_assign_candidates(): rows in staff_id order
-- ---------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('public.auto_assign_candidates(uuid, boolean)'::regprocedure);
  v_pat text := '    from own p\n   cross join has_sib h\n';
  v_n   int;
begin
  select count(*) into v_n from regexp_matches(v_def, v_pat, 'g');
  if v_n <> 1 then
    raise exception '20261018140100: auto_assign_candidates - expected one match of %, found %', v_pat, v_n;
  end if;
  v_def := regexp_replace(v_def, v_pat,
    E'    from own p\n   cross join has_sib h\n   -- 20261018140100: a stable order for a reader that pages.\n   order by p.staff_id\n');
  execute v_def;
  alter function public.auto_assign_candidates(uuid, boolean) set jit = off;
end;
$$;
