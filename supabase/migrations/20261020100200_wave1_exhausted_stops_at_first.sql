-- =====================================================================
-- Migration 20261020100200 · "is wave 1 exhausted?" stops at the first
--                            reachable qualified worker, once per call
--                            (ADR-0167)
--
-- staff_open_offers() asked auto_assign_worker_gate() for the viewer once
-- per open offer, and offer_wave1_exhausted() for every pool offer the
-- viewer is not qualified for; take_offered_shift() asks the latter once.
-- offer_wave1_exhausted() answered by reading auto_assign_candidates() for
-- the offer's section - every worker in the agency judged, the series days
-- included - and then looking for one qualified worker still to be told:
-- ~0.13 s an offer at go-live size. radar_wave1_exhausted() had the same
-- shape.
--
-- Now, with the same answers (pgTAP 880 compares every function here with
-- its old body over 859's fixture, with offers reaching every branch):
--
--   * offers_wave1_exhausted(p_offers) answers the question for many
--     offers in one pass. Who could still be reachable is found without
--     the pool - qualified at the client and role (not do-not-return),
--     compliant, holding the role (without these the pool says not
--     qualified, blocked or wrong_role), not the offerer, no booking that
--     rules them out, not away and not told yet (the old body's own tests,
--     moved in front of the pool) - and asked about in rounds of 1, 4, 16
--     ... per offer, all offers' workers in one pool call a round, as
--     auto_assign_worker_gate() judges one worker (the section's pool,
--     then series_gate_for()). An offer drops out at its first reachable
--     worker or when its list runs out;
--   * offer_wave1_exhausted(p_offer) is that for one offer. The auto-assign
--     switches still exhaust it at once (OF1 follows them);
--   * radar_wave1_exhausted(p_shift) is auto_assign_wave1_reachable() with
--     the series days (20261020100100) for one section;
--   * staff_open_offers() reads the viewer's gate for every open offer from
--     one auto_assign_worker_pool() pass, and the wave-1 answer for every
--     pool offer the viewer is not qualified for from one
--     offers_wave1_exhausted() call; its ORDER BY ends on the offer id, so
--     two offers on one section no longer swap between loads (as Radar's
--     did on the section id, 20261019193100).
--
-- offer_wave1_exhausted()'s code is fingerprinted (comments dropped,
-- whitespace collapsed) and replaced whole: every test it made is in
-- offers_wave1_exhausted(). The other two are re-created from their LIVE
-- bodies with targeted replacements (docs/10 §3b), each on code only and
-- required to match exactly once. Security, search_path, grants and
-- comments are carried over.
-- =====================================================================

do $$
begin
  if (select md5(btrim(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g')))
        from pg_proc p
       where p.oid = 'public.offer_wave1_exhausted(uuid)'::regprocedure)
     is distinct from 'fc556a568dd1df79a44d2cfe46c9f331' then
    raise exception '20261020100200: offer_wave1_exhausted() is not the body this migration replaces (20260930205000). Something changed it since; merge that change into offers_wave1_exhausted() first.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 1 · offers_wave1_exhausted(p_offers): the question for many offers
-- ---------------------------------------------------------------------
create or replace function public.offers_wave1_exhausted(p_offers uuid[])
returns table (offer_id uuid)
language plpgsql
stable
security definer
set search_path = public, extensions
set jit = off
as $function$
#variable_conflict use_column
declare
  v_left uuid[];
  v_open uuid[] := '{}';
  v_po   uuid[];
  v_ps   uuid[];
  v_pw   uuid[];
  v_from int := 0;
  v_step int := 1;
begin
  -- With the event or the role's auto-assign OFF nobody is ever pushed an
  -- offer (OF1 follows the switches), so waiting for wave 1 to be told
  -- would wait for ever: the office opening it to the pool is the release,
  -- and wave 2 may see and take it at once. Only the others are asked.
  v_left := array(
    select o.id
      from shift_offers o
      join shift_requirements sr on sr.id = o.shift_id
      join events ev             on ev.id = sr.event_id
     where o.id = any (p_offers)
       and ev.auto_assign and sr.auto_assign);

  -- Otherwise wave 1 is everyone qualified at this client AND role who
  -- could take the shift: ungated, not the offerer, holding no booking
  -- here that rules them out, and not away (the calendar keeps the pushes
  -- from them, so waiting for them to be told would wait forever).
  -- Exhausted once every one of them has been told (shift_offer_notices).
  -- The tests that need no pool come first; the next v_step of the workers
  -- they leave, in staff_id order, are asked about each round.
  while cardinality(v_left) > 0 loop
    select array_agg(q.offer_id order by q.offer_id, q.staff_id),
           array_agg(q.shift_id order by q.offer_id, q.staff_id),
           array_agg(q.staff_id order by q.offer_id, q.staff_id)
      into v_po, v_ps, v_pw
      from (select o.id as offer_id, o.shift_id, c1.staff_id
              from shift_offers o
              join shift_requirements sr on sr.id = o.shift_id
              join events ev             on ev.id = sr.event_id
             cross join lateral (
               select cq.staff_id
                 from client_qualifications cq
                 join staff qs on qs.id = cq.staff_id
                where cq.client_id = ev.client_id and cq.role_id = sr.role_id
                  and not cq.do_not_return
                  and qs.status = 'compliant'
                  and exists (select 1 from staff_roles qr
                               where qr.staff_id = cq.staff_id and qr.role_id = sr.role_id)
                  and cq.staff_id <> o.offered_by_staff_id
                  and not exists (select 1 from bookings qb
                                   where qb.shift_id = sr.id and qb.staff_id = cq.staff_id
                                     and qb.status in ('confirmed', 'worked', 'turned_away', 'cancelled'))
                  and not staff_unavailable(cq.staff_id, sr.starts_at, sr.ends_at)
                  and not exists (select 1 from shift_offer_notices n
                                   where n.offer_id = o.id and n.staff_id = cq.staff_id)
                order by cq.staff_id
               offset v_from limit v_step) c1
             where o.id = any (v_left)) q;

    -- every offer's list has run out: wave 1 is exhausted on each left
    exit when v_po is null;

    -- the round's workers judged as auto_assign_worker_gate() judges one:
    -- the section's own pool gate, then (none there) the series days'
    v_open := v_open || array(
      select distinct x.o
        from unnest(v_po, v_ps, v_pw) as x(o, s, w)
        join auto_assign_candidates_pool_pairs(v_ps, v_pw, false) c
          on c.shift_id = x.s and c.staff_id = x.w
       where (case when c.gate is not null then c.gate
                   else series_gate_for(c.staff_id, c.shift_id) end) is null
         and c.qualified
         and (c.booking_status is null
              or c.booking_status not in ('confirmed', 'worked', 'turned_away', 'cancelled')));

    v_left := array(select distinct u from unnest(v_po) u where not (u = any (v_open)));
    v_from := v_from + v_step;
    v_step := v_step * 4;
  end loop;

  return query
    select distinct u.x from unnest(p_offers) as u(x)
     where u.x is not null and not (u.x = any (v_open));
end
$function$;

revoke execute on function public.offers_wave1_exhausted(uuid[]) from public, anon, authenticated;
grant  execute on function public.offers_wave1_exhausted(uuid[]) to service_role;

comment on function public.offers_wave1_exhausted(uuid[]) is
  'RULE-17 for shift offers, many at once (ADR-0167): the offers of p_offers whose wave 1 is exhausted - auto-assign off on the event or role, or no worker qualified at the client and role left who is ungated (auto_assign_worker_gate()''s sense), not the offerer, not holding a booking that rules them out, not away and not yet told. Stops asking about an offer at its first such worker. offer_wave1_exhausted() and staff_open_offers() read it.';

-- ---------------------------------------------------------------------
-- 2 · offer_wave1_exhausted(p_offer): the same, for one offer
-- ---------------------------------------------------------------------
do $$
declare
  v_cmt text := obj_description('public.offer_wave1_exhausted(uuid)'::regprocedure::oid, 'pg_proc');
begin
  create or replace function public.offer_wave1_exhausted(p_offer uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, extensions
  as $function$
    -- 20261020100200: the question and every test in it are
    -- offers_wave1_exhausted()'s; this asks it about one offer.
    select exists (select 1 from offers_wave1_exhausted(array[p_offer]))
  $function$;

  execute format('comment on function public.offer_wave1_exhausted(uuid) is %L',
    coalesce(v_cmt, '')
    || ' Since 20261020100200 (ADR-0167) it is offers_wave1_exhausted() for one offer: the same tests, stopping at the first reachable qualified worker instead of reading the whole candidate list.');
end;
$$;

-- ---------------------------------------------------------------------
-- 3 · radar_wave1_exhausted(p_shift)
-- ---------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('public.radar_wave1_exhausted(uuid)'::regprocedure);
  v_cmt text := obj_description('public.radar_wave1_exhausted(uuid)'::regprocedure::oid, 'pg_proc');
  v_pat text := 'select 1 from auto_assign_candidates\(p_shift\) c\s+'
             || 'where c\.gate is null and c\.qualified and c\.booking_status is null';
  v_n   int;
begin
  select count(*) into v_n from regexp_matches(v_def, v_pat, 'g');
  if v_n <> 1 then
    raise exception '20261020100200: radar_wave1_exhausted - expected one match of %, found %', v_pat, v_n;
  end if;
  -- 20261020100200: auto_assign_wave1_reachable() with the series days, as
  -- auto_assign_candidates() judged them; it stops at the first reachable
  -- qualified worker.
  v_def := regexp_replace(v_def, v_pat, 'select 1 from auto_assign_wave1_reachable(array[p_shift], true)');
  execute v_def;

  execute format('comment on function public.radar_wave1_exhausted(uuid) is %L',
    coalesce(v_cmt, '')
    || ' Since 20261020100200 (ADR-0167) it is auto_assign_wave1_reachable() with the series days, stopping at the first reachable qualified worker.');
end;
$$;

-- ---------------------------------------------------------------------
-- 4 · staff_open_offers(p_offer): the viewer's gates and the wave-1
--     answers, once per call
-- ---------------------------------------------------------------------
-- The viewer's gate on each offer is the section's pool row for them, then
-- (no gate there) series_gate_for(), as auto_assign_worker_gate() composes
-- them - from one auto_assign_worker_pool() read over the open offers'
-- sections. An offer whose section has no pool row for the viewer still
-- drops out. The wave-1 answer is read from one offers_wave1_exhausted()
-- call over the pool offers the viewer is not qualified for, the only rows
-- where the query asks it.
do $$
declare
  p     record;
  v_def text := pg_get_functiondef('public.staff_open_offers(uuid)'::regprocedure);
  v_cmt text := obj_description('public.staff_open_offers(uuid)'::regprocedure::oid, 'pg_proc');
  v_n   int;
begin
  for p in
    select * from (values
      ('(direct as \(select coalesce\(\(select s\.value = ''true''::jsonb from settings s\s+where s\.key = ''shift_offers_direct_enabled''\), false\) as on_\))',
       $r$\1,
       -- 20261020100200: the viewer's pool row for every open offer's
       -- section, in one pass (auto_assign_worker_gate() read it once per
       -- offer). The offers are narrowed again below.
       mypool as materialized (
         select a.*
           from me
          cross join lateral auto_assign_worker_pool(me.id, array(
                  select distinct o.shift_id
                    from shift_offers o
                   where o.status = 'open'
                     and o.expires_at > now()
                     and o.offered_by_staff_id <> me.id
                     and (p_offer is null or o.id = p_offer))) a
       ),
       -- 20261020100200: wave 1's answer for every open pool offer the
       -- viewer is not qualified for, in one call (it was asked per offer).
       w1x as materialized (
         select x.offer_id
           from offers_wave1_exhausted(array(
                  select o.id
                    from me
                    join shift_offers o on o.status = 'open'
                                       and o.expires_at > now()
                                       and o.offered_by_staff_id <> me.id
                                       and o.mode = 'pool'
                                       and (p_offer is null or o.id = p_offer)
                    join mypool a on a.shift_id = o.shift_id and not a.qualified)) x
       )$r$),
      ('cross join lateral \(\s*select a\.gate, a\.qualified, a\.booking_status\s+from auto_assign_worker_gate\(sr\.id, me\.id\) a\s*\) c',
       $r$cross join lateral (
      -- auto_assign_worker_gate()'s answer, from the pass above
      select case when a.gate is not null then a.gate
                  else series_gate_for(me.id, sr.id) end as gate,
             a.qualified, a.booking_status
        from mypool a
       where a.shift_id = sr.id
    ) c$r$),
      ('or offer_wave1_exhausted\(o\.id\)\)',
       'or o.id in (select w1x.offer_id from w1x))'),
      -- a total order: two offers on one section (same distance, same
      -- start) came back in whichever order the plan met them
      ('(\s+sr\.starts_at)(\s+\$function\$)',
       E'\\1,\n           o.id\\2')
    ) as x(pattern, replacement)
  loop
    select count(*) into v_n from regexp_matches(v_def, p.pattern, 'g');
    if v_n <> 1 then
      raise exception '20261020100200: staff_open_offers - expected one match of %, found %', p.pattern, v_n;
    end if;
    v_def := regexp_replace(v_def, p.pattern, p.replacement);
  end loop;

  execute v_def;

  execute format('comment on function public.staff_open_offers(uuid) is %L',
    coalesce(v_cmt, '')
    || ' Since 20261020100200 (ADR-0167) the viewer''s gate on every open offer comes from one auto_assign_worker_pool() read and the wave-1 answers from one offers_wave1_exhausted() call.');
end;
$$;
