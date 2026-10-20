-- =====================================================================
-- 880 · The pool over pairs, Radar in one pass, wave 1 stopping at the
--       first reachable worker - old bodies against new (ADR-0170)
--   20261021130000_auto_assign_pool_pairs.sql
--   20261021130100_radar_one_pool_pass.sql
--   20261021130200_wave1_exhausted_stops_at_first.sql
--
-- The three migrations change how the answers are computed and nothing
-- about what they are. The bodies as they stood before them are
-- re-created under _old_ names (_shared/pool_radar_before_20261021130000
-- .psql, each old reader calling the old pool) and every reader is
-- compared with its old self over 859's fixture (every gate code, both
-- waves, every booking state, a two-day job, the 2 h gap, the term cap,
-- the radius) plus open shift offers that reach every wave-1 branch:
--
--   A · the pool for one section: list reads ordinary and escalation,
--       every section x worker one at a time, a named list;
--   B · auto_assign_worker_pool() is, for every (worker, section) pair,
--       exactly auto_assign_candidates_pool(section, false, array[worker])
--       - the test that fails if the two ever disagree - and the old pool;
--       auto_assign_candidates_pool_pairs() over arbitrary pairs and over
--       many sections against the agency is the old pool one at a time;
--   C · the series readers over it (auto_assign_candidates(),
--       auto_assign_worker_gate());
--   D · RULE-17: auto_assign_wave1_reachable() with and without the
--       series days, and radar_wave1_exhausted();
--   E · Radar as nine workers: the same cards, every column, same order;
--   F · offers: offer_wave1_exhausted() and offers_wave1_exhausted() for
--       every offer (switch off, everyone told, the offerer, the calendar,
--       the series days, an expired offer, an unknown id), and
--       staff_open_offers() as each worker, every column, same order (now
--       total: ties end on the offer id);
--   G · who may call what.
-- =====================================================================
begin;
select plan(44);
-- The old bodies' plans cost far above jit_above_cost; compiling them on
-- every call is most of this file's run time and none of its meaning.
set local jit = off;
\ir _shared/fixtures.psql
\ir _shared/pool_radar_fixture.psql
\ir _shared/pool_radar_before_20261021130000.psql

-- ---- open shift offers: one per wave-1 branch ------------------------
\set o1 '88010000-0000-4000-8000-000000000001'
\set o2 '88010000-0000-4000-8000-000000000002'
\set o3 '88010000-0000-4000-8000-000000000003'
\set o4 '88010000-0000-4000-8000-000000000004'
\set o5 '88010000-0000-4000-8000-000000000005'
\set o6 '88010000-0000-4000-8000-000000000006'
\set o7 '88010000-0000-4000-8000-000000000007'
\set o8 '88010000-0000-4000-8000-000000000008'

insert into settings (key, value) values ('shift_offers_direct_enabled', 'true'::jsonb)
on conflict (key) do update set value = excluded.value;
-- Nia is booked on the two-day job's Friday, so she can offer it.
insert into bookings (shift_id, staff_id, status, source, confirmed_at) values (:'s7a', :'wn', 'confirmed', 'auto', now());
-- Ivy and Staff Bravo (both wave 1 at client B) are away on the job's
-- Saturday: on Friday the series days bar them.
insert into staff_unavailability (staff_id, period, all_day) values
  (:'winv', unavailability_range(:'w'::date + 5), true),
  (:'staffb', unavailability_range(:'w'::date + 5), true);
-- The back-to-back section's role runs with auto-assign off.
update shift_requirements set auto_assign = false where id = :'s6';

insert into shift_offers (id, booking_id, shift_id, offered_by_staff_id, mode, target_staff_id, status, expires_at)
select x.id::uuid, b.id, b.shift_id, b.staff_id, x.mode, x.target::uuid, 'open', now() + x.exp
  from (values
    -- s1, client A: Quinn is still to be told - not exhausted
    (:'o1', :'s1',  :'wf1',   'pool',   null,     interval '2 days'),
    -- s1 again: Quinn, Dee and Staff Alpha told, the student capped out
    (:'o2', :'s1',  :'wf2',   'pool',   null,     interval '2 days'),
    -- client B's Saturday: the student capped, Bo blocked, Ivy and Bravo away
    (:'o3', :'s13', :'wsib',  'pool',   null,     interval '2 days'),
    -- auto-assign off on the role: exhausted by the switch
    (:'o4', :'s6',  :'wback', 'pool',   null,     interval '2 days'),
    -- a direct offer to Nia
    (:'o5', :'s5',  :'wels',  'direct', :'wn',    interval '2 days'),
    -- the two-day job's Friday: Ivy and Bravo free that day, away on the other
    (:'o6', :'s7a', :'wn',    'pool',   null,     interval '2 days'),
    -- the student offers her own Monday: she is the offerer, not wave 1
    (:'o7', :'sh1', :'wcap',  'pool',   null,     interval '2 days'),
    -- expired
    (:'o8', :'s9',  :'wf1',   'pool',   null,     interval '-1 hour')
  ) as x(id, shift, staff, mode, target, exp)
  join bookings b on b.shift_id = x.shift::uuid and b.staff_id = x.staff::uuid;
insert into shift_offer_notices (offer_id, staff_id) values (:'o2', :'wq'), (:'o2', :'wdec'), (:'o2', :'staffa');

create temp table t880_offers as select id from shift_offers where id::text like '88010000-%'
union all select '88010000-0000-4000-8000-0000000000ff'::uuid;     -- no such offer
grant select on t880_offers to public;

-- =====================================================================
-- A · the pool for one section, old body against new
-- =====================================================================
select is((select count(*)::int from t854_sec s cross join (values (false), (true)) e(esc)
            cross join lateral (
              (select * from auto_assign_candidates_pool(s.id, e.esc)
               except all select * from _old_auto_assign_candidates_pool(s.id, e.esc))
              union all
              (select * from _old_auto_assign_candidates_pool(s.id, e.esc)
               except all select * from auto_assign_candidates_pool(s.id, e.esc))) d),
  0, 'A: every section, ordinary and escalation: the pool returns exactly the old pool''s rows (every column)');
select is((select count(*)::int from t854_sec s cross join lateral auto_assign_candidates_pool(s.id) p),
          (select count(*)::int from t854_sec s cross join lateral _old_auto_assign_candidates_pool(s.id) p),
  'A: and the same number of them');
select is((select array_agg(distinct g order by g) from (
             select p.gate as g from t854_sec s cross join lateral auto_assign_candidates_pool(s.id, true) p
             union select p.gate from t854_sec s cross join lateral auto_assign_candidates_pool(s.id, false) p) x),
  array['blocked', 'booked_elsewhere', 'do_not_return', 'female_only', 'gender_not_recorded', 'hours_limit',
        'language_not_spoken', 'languages_not_recorded', 'male_only', 'outside_radius', 'rtw_expired',
        'self_cancelled', 'wrong_role', null],
  'A: coverage - the comparison crossed every gate code the pool has');
select ok((select bool_and(a.staff_id < b.staff_id)
             from (select staff_id, row_number() over () rn from auto_assign_candidates_pool(:'s1')) a
             join (select staff_id, row_number() over () rn from auto_assign_candidates_pool(:'s1')) b on b.rn = a.rn + 1),
  'A: rows still come back in staff_id order');
select is((select count(*)::int from t854_sec s cross join t854_staff w
            where (select array_agg(x order by x::text) from auto_assign_candidates_pool(s.id, false, array[w.id]) x)
                  is distinct from
                  (select array_agg(x order by x::text) from _old_auto_assign_candidates_pool(s.id, false, array[w.id]) x)),
  0, 'A: every section x every worker, one at a time: the same row (or none) as the old pool');
select is((select count(*)::int from t854_sec s
            cross join lateral (select array_agg(id) ids from staff where email like '%@p854.test') w
            cross join lateral (
              (select * from auto_assign_candidates_pool(s.id, true, w.ids || w.ids)
               except all select * from _old_auto_assign_candidates_pool(s.id, true, w.ids || w.ids))
              union all
              (select * from _old_auto_assign_candidates_pool(s.id, true, w.ids || w.ids)
               except all select * from auto_assign_candidates_pool(s.id, true, w.ids || w.ids))) d),
  0, 'A: a list of named workers, each named twice: the same rows, once each');
select is((select count(*)::int from auto_assign_candidates_pool(:'s1', false, '{}'::uuid[])), 0,
  'A: an empty list is no rows, as before');

-- =====================================================================
-- B · one worker against many sections, and arbitrary pairs
-- =====================================================================
create temp table t880_wp as
select w.id as w, x.* from t854_staff w
 cross join lateral auto_assign_worker_pool(w.id, array(select id from t854_sec)) x;
create temp table t880_one as
select w.id as w, s.id as shift_id, p.* from t854_staff w cross join t854_sec s
 cross join lateral auto_assign_candidates_pool(s.id, false, array[w.id]) p;

select is((select count(*)::int from (
             (select * from t880_wp except all select * from t880_one)
             union all
             (select * from t880_one except all select * from t880_wp)) d),
  0, 'B: auto_assign_worker_pool(worker, every section) is auto_assign_candidates_pool(section, false, array[worker]) for every (worker, section) pair, every column');
select is((select count(*)::int from (
             (select w.id, s.id, p.* from t854_staff w cross join t854_sec s
               cross join lateral _old_auto_assign_candidates_pool(s.id, false, array[w.id]) p
              except all select * from t880_wp)
             union all
             (select * from t880_wp
              except all select w.id, s.id, p.* from t854_staff w cross join t854_sec s
               cross join lateral _old_auto_assign_candidates_pool(s.id, false, array[w.id]) p)) d),
  0, 'B: and the old pool''s row for each pair');
select ok((select count(*) > 300 and count(distinct gate) >= 10 from t880_wp),
  'B: coverage - hundreds of pairs across the gate codes');
select ok((select bool_and(a.shift_id < b.shift_id)
             from (select shift_id, row_number() over () rn from auto_assign_worker_pool(:'wq', array(select id from t854_sec))) a
             join (select shift_id, row_number() over () rn from auto_assign_worker_pool(:'wq', array(select id from t854_sec))) b on b.rn = a.rn + 1),
  'B: one row per section, in section order');
select is((select count(*)::int from auto_assign_worker_pool(:'wq', array[:'s1', :'s1', :'s2']::uuid[])), 2,
  'B: a section named twice is one row');
select is((select count(*)::int from auto_assign_worker_pool(:'wrem', array(select id from t854_sec)))
        + (select count(*)::int from auto_assign_worker_pool(null, array(select id from t854_sec)))
        + (select count(*)::int from auto_assign_worker_pool(:'wq', array['85420000-0000-4000-8000-0000000000ff']::uuid[]))
        + (select count(*)::int from auto_assign_worker_pool(:'wq', '{}'::uuid[]))
        + (select count(*)::int from auto_assign_worker_pool(:'wq', null)), 0,
  'B: a removed worker, no worker, an unknown section, no sections: no rows');

create temp table t880_pairs as
select s.id as s, w.id as w, row_number() over (order by md5(s.id::text || w.id::text)) as k
  from t854_sec s cross join t854_staff w;
select is((select count(*)::int from (
             (select * from auto_assign_candidates_pool_pairs(
                        array(select s from t880_pairs order by k), array(select w from t880_pairs order by k), false)
              except all
              select p.s, o.* from t880_pairs p cross join lateral _old_auto_assign_candidates_pool(p.s, false, array[p.w]) o)
             union all
             (select p.s, o.* from t880_pairs p cross join lateral _old_auto_assign_candidates_pool(p.s, false, array[p.w]) o
              except all
              select * from auto_assign_candidates_pool_pairs(
                        array(select s from t880_pairs order by k), array(select w from t880_pairs order by k), false))) d),
  0, 'B: every (section, worker) pair in ONE pairs call, shuffled: the old pool''s row for each');
select is((select count(*)::int from (
             (select * from auto_assign_candidates_pool_pairs(array(select id from t854_sec), null, true)
              except all
              select s.id, o.* from t854_sec s cross join lateral _old_auto_assign_candidates_pool(s.id, true) o)
             union all
             (select s.id, o.* from t854_sec s cross join lateral _old_auto_assign_candidates_pool(s.id, true) o
              except all
              select * from auto_assign_candidates_pool_pairs(array(select id from t854_sec), null, true))) d),
  0, 'B: every section against the agency in ONE call (escalation): the old list read of each');

-- =====================================================================
-- C · the series readers over the pool
-- =====================================================================
select is((select count(*)::int from t854_sec s cross join (values (false), (true)) e(esc)
            cross join lateral (
              (select * from auto_assign_candidates(s.id, e.esc)
               except all select * from _old_auto_assign_candidates(s.id, e.esc))
              union all
              (select * from _old_auto_assign_candidates(s.id, e.esc)
               except all select * from auto_assign_candidates(s.id, e.esc))) d),
  0, 'C: auto_assign_candidates() - the series-aware list - returns exactly what it did');
select is((select count(*)::int from t854_sec s cross join t854_staff w
            where (select array_agg(x order by x::text) from auto_assign_worker_gate(s.id, w.id) x)
                  is distinct from
                  (select array_agg(x order by x::text) from _old_auto_assign_worker_gate(s.id, w.id) x)),
  0, 'C: auto_assign_worker_gate() - invite, Accept, apply, take - the same answer for every section and worker');
select is((select count(*)::int from auto_assign_candidates(:'s7a') where gate = 'not_available_all_days'), 4,
  'C: coverage - on the two-day job the calendar (three workers) and a booking on the other day read not_available_all_days');

-- =====================================================================
-- D · RULE-17: is a qualified worker still reachable?
-- =====================================================================
select is((select array_agg(x.shift_id order by x.shift_id)
             from auto_assign_wave1_reachable(array(select id from t854_sec)) x),
          (select array_agg(s.id order by s.id) from t854_sec s
            where exists (select 1 from _old_auto_assign_candidates_pool(s.id) c
                           where c.gate is null and c.qualified and c.booking_status is null)),
  'D: auto_assign_wave1_reachable(): exactly the sections where the old pool had a reachable qualified worker');
select is((select array_agg(x.shift_id order by x.shift_id)
             from auto_assign_wave1_reachable(array(select id from t854_sec), true) x),
          (select array_agg(s.id order by s.id) from t854_sec s where not _old_radar_wave1_exhausted(s.id)),
  'D: with the series days: exactly where the old radar_wave1_exhausted() said wave 1 was not exhausted');
select is((select count(*)::int from t854_sec s where radar_wave1_exhausted(s.id) is distinct from _old_radar_wave1_exhausted(s.id)),
  0, 'D: radar_wave1_exhausted() - the same answer for every section');
select ok((select bool_or(radar_wave1_exhausted(s.id)) and bool_or(not radar_wave1_exhausted(s.id)) from t854_sec s),
  'D: coverage - exhausted and not');
select ok(:'s7a'::uuid in (select shift_id from auto_assign_wave1_reachable(array[:'s7a']::uuid[]))
      and :'s7a'::uuid not in (select shift_id from auto_assign_wave1_reachable(array[:'s7a']::uuid[], true)),
  'D: coverage - the two-day job''s Friday: reachable on the day alone, not once the series days count (Ivy and Bravo are away on Saturday)');
select is((select count(*)::int from auto_assign_wave1_reachable(array[null, '85420000-0000-4000-8000-0000000000ff']::uuid[]))
        + (select count(*)::int from auto_assign_wave1_reachable('{}'::uuid[])), 0,
  'D: no sections, an unknown one: nothing reachable');

-- =====================================================================
-- E · Radar, old body against new, as each worker
-- =====================================================================
create temp table t880_radar_new as select null::uuid uid, 0::bigint rn, x.* from staff_open_shifts() x where false;
create temp table t880_radar_old as select null::uuid uid, 0::bigint rn, x.* from staff_open_shifts() x where false;
create temp table t880_radar_one as select null::uuid uid, x.* from staff_open_shifts() x where false;
create temp table t880_offers_new as select null::uuid uid, 0::bigint rn, x.* from staff_open_offers() x where false;
create temp table t880_offers_old as select null::uuid uid, 0::bigint rn, x.* from staff_open_offers() x where false;
grant all on t880_radar_new, t880_radar_old, t880_radar_one, t880_offers_new, t880_offers_old to public;

do $$
declare u record;
begin
  for u in select * from t854_users loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.uid, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into t880_radar_new select u.uid, row_number() over (), x.* from staff_open_shifts() x;
    insert into t880_radar_old select u.uid, row_number() over (), x.* from _old_staff_open_shifts() x;
    insert into t880_radar_one select u.uid, x.* from t854_sec s cross join lateral staff_open_shifts(null, s.id) x;
    insert into t880_offers_new select u.uid, row_number() over (), x.* from staff_open_offers() x;
    insert into t880_offers_old select u.uid, row_number() over (), x.* from _old_staff_open_offers() x;
    execute 'reset role';
  end loop;
  perform set_config('request.jwt.claims', '', true);
end $$;

select is((select count(*)::int from (
             (select to_jsonb(n) from t880_radar_new n except all select to_jsonb(o) from t880_radar_old o)
             union all
             (select to_jsonb(o) from t880_radar_old o except all select to_jsonb(n) from t880_radar_new n)) d),
  0, 'E: every worker''s Radar - the same cards, every column, in the same place in the list');
select ok((select count(distinct uid) >= 6 and count(*) >= 20 from t880_radar_new),
  'E: coverage - most workers see cards');
select ok(exists (select 1 from t880_radar_new where uid = :'u_n' and shift_id = :'s14')
      and not exists (select 1 from t880_radar_new where uid = :'u_n' and shift_id = :'s1'),
  'E: RULE-17 - a wave-2 worker sees the section whose wave 1 is exhausted and not the one where a qualified worker is still free');
select ok(exists (select 1 from t880_radar_new where uid = :'u_cap' and hours_limit)
      and exists (select 1 from t880_radar_new where uid = :'u_app' and shift_id = :'s10' and applied_at is not null),
  'E: Limit Reached, and an application on a started section, still listed');
select is((select count(*)::int from (
             (select to_jsonb(x) - 'rn' from t880_radar_one x except all select to_jsonb(n) - 'rn' from t880_radar_new n)
             union all
             (select to_jsonb(n) - 'rn' from t880_radar_new n except all select to_jsonb(x) - 'rn' from t880_radar_one x)) d),
  0, 'E: staff_open_shifts(p_shift) is the list narrowed to that section - for every worker and every section');

-- =====================================================================
-- F · shift offers
-- =====================================================================
select is((select count(*)::int from t880_offers o
            where offer_wave1_exhausted(o.id) is distinct from _old_offer_wave1_exhausted(o.id)),
  0, 'F: offer_wave1_exhausted() - the same answer for every offer, an unknown id included');
select is((select array_agg(x.offer_id order by x.offer_id) from offers_wave1_exhausted(array(select id from t880_offers)) x),
          (select array_agg(o.id order by o.id) from t880_offers o where _old_offer_wave1_exhausted(o.id)),
  'F: offers_wave1_exhausted() over every offer at once: exactly the offers the old body called exhausted');
select is((select array_agg(o.id order by o.id) from t880_offers o where _old_offer_wave1_exhausted(o.id)),
          array[:'o2', :'o3', :'o4', :'o6', '88010000-0000-4000-8000-0000000000ff']::uuid[],
  'F: coverage - exhausted by notices (o2), by gates and the calendar (o3), by the switch (o4), by the series days (o6), and an unknown offer; not o1 / o7 (someone still to tell, the offerer left out)');
select is((select count(*)::int from offers_wave1_exhausted(array[:'o1', :'o1', :'o2', null]::uuid[])), 1,
  'F: an offer named twice is one answer; a null is none');
select is((select count(*)::int from (
             (select to_jsonb(n) - 'rn' from t880_offers_new n except all select to_jsonb(o) - 'rn' from t880_offers_old o)
             union all
             (select to_jsonb(o) - 'rn' from t880_offers_old o except all select to_jsonb(n) - 'rn' from t880_offers_new n)) d),
  0, 'F: every worker''s open offers - the same offers, every column');
select is((select count(*)::int from t880_offers_new n join t880_offers_old o using (uid, rn)
            where (n.qualified, n.distance_km, n.starts_at) is distinct from (o.qualified, o.distance_km, o.starts_at)),
  0, 'F: in the same order (qualified first, then distance, then start)');
select ok((select bool_and((not a.qualified, a.distance_km, a.starts_at, a.offer_id) < (not b.qualified, b.distance_km, b.starts_at, b.offer_id))
             from t880_offers_new a join t880_offers_new b on b.uid = a.uid and b.rn = a.rn + 1)
      and exists (select 1 from t880_offers_new a join t880_offers_new b on b.uid = a.uid and b.rn = a.rn + 1
                   where (a.qualified, a.distance_km, a.starts_at) = (b.qualified, b.distance_km, b.starts_at)),
  'F: and the order is total now: ties (two offers on one section) end on the offer id');
select ok((select count(distinct uid) >= 3 from t880_offers_new)
      and exists (select 1 from t880_offers_new where uid = :'u_n' and offer_id = :'o5'),
  'F: coverage - several workers see offers, Nia her direct one');
select ok(not exists (select 1 from t880_offers_new where offer_id = :'o8')
      and not exists (select 1 from t880_offers_new where uid = :'u_n' and offer_id = :'o1')
      and exists (select 1 from t880_offers_new where uid = :'u_q' and offer_id = :'o1'),
  'F: coverage - the expired offer is hidden; o1 shows to wave 1 (Quinn) and waits for wave 2 (Nia)');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'u_q', 'role', 'authenticated')::text, true);
select is((select array_agg(offer_id order by offer_id) from staff_open_offers(:'o1')),
          array[:'o1']::uuid[], 'F: staff_open_offers(p_offer) still narrows to one offer');
reset role;
select set_config('request.jwt.claims', '', true);

-- =====================================================================
-- G · who may call what
-- =====================================================================
select ok((select bool_and(not prosecdef) from pg_proc where oid in (
             'public.auto_assign_candidates_pool_pairs(uuid[], uuid[], boolean)'::regprocedure,
             'public.auto_assign_candidates_pool(uuid, boolean, uuid[])'::regprocedure,
             'public.auto_assign_worker_pool(uuid, uuid[])'::regprocedure,
             'public.auto_assign_wave1_reachable(uuid[], boolean)'::regprocedure)),
  'G: the pool and its readers stay SECURITY INVOKER (ADR-0156 weighed owner rights and kept the caller''s)');
select ok((select bool_and(prosecdef) from pg_proc where oid in (
             'public.offers_wave1_exhausted(uuid[])'::regprocedure,
             'public.offer_wave1_exhausted(uuid)'::regprocedure,
             'public.radar_wave1_exhausted(uuid)'::regprocedure,
             'public.staff_open_offers(uuid)'::regprocedure,
             'public.staff_open_shifts(uuid, uuid)'::regprocedure)),
  'G: the wave-1 checks and the two Staff App reads stay SECURITY DEFINER');
select ok(not has_function_privilege('anon', 'public.auto_assign_candidates_pool_pairs(uuid[], uuid[], boolean)', 'execute')
      and not has_function_privilege('anon', 'public.auto_assign_worker_pool(uuid, uuid[])', 'execute')
      and not has_function_privilege('anon', 'public.auto_assign_wave1_reachable(uuid[], boolean)', 'execute')
      and not has_function_privilege('anon', 'public.offers_wave1_exhausted(uuid[])', 'execute')
      and not has_function_privilege('authenticated', 'public.offers_wave1_exhausted(uuid[])', 'execute')
      and has_function_privilege('service_role', 'public.offers_wave1_exhausted(uuid[])', 'execute')
      and not has_function_privilege('authenticated', 'public.offer_wave1_exhausted(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.auto_assign_worker_pool(uuid, uuid[])', 'execute')
      and has_function_privilege('authenticated', 'public.staff_open_offers(uuid)', 'execute'),
  'G: grants - no anon; offer wave-1 checks for jobs only; the pool readers as the pool');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'u_q', 'role', 'authenticated')::text, true);
select is((select count(*)::int from auto_assign_worker_pool(:'wn', array(select id from t854_sec)))
        + (select count(*)::int from auto_assign_candidates_pool_pairs(array[:'s1']::uuid[], null)), 0,
  'G: a worker calling the pool directly reads nothing (sections are office-only)');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table t880_admin as select * from auto_assign_worker_pool(:'wq', array(select id from t854_sec));
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from (
             (select * from t880_admin except all select * from auto_assign_worker_pool(:'wq', array(select id from t854_sec)))
             union all
             (select * from auto_assign_worker_pool(:'wq', array(select id from t854_sec)) except all select * from t880_admin)) d),
  0, 'G: the office reads a worker''s rows through its own rights, row for row what the owner reads');

select * from finish();
rollback;
