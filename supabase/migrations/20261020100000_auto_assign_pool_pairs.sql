-- =====================================================================
-- Migration 20261020100000 · the pool judges many (section, worker) pairs
--                            in one pass, and one worker against many
--                            sections reads it once (ADR-0159)
--
-- Radar (staff_open_shifts) asks the pool about every section it could
-- show the worker, one call per section: ~190 calls for a two-role worker
-- at go-live size, ~4.4 ms each, because each call starts its plan again
-- and re-reads the worker's history. ADR-0156 left it there (0.5–1.7 s per
-- load) and named the next step: a pool that judges one worker against
-- many sections in one call.
--
-- A second pool would be a second place where gates are decided, which
-- ADR-0117 and CLAUDE.md rule out. So the pool's one body is generalised
-- instead, and every reader goes through it:
--
--   auto_assign_candidates_pool_pairs(p_shifts, p_staff, p_escalation)
--     the pool itself: the row for each pair (p_shifts[i], p_staff[i]);
--     with p_staff null, every section in p_shifts against the agency.
--     Every gate, its order and code, the wave and the five score inputs
--     are decided here and nowhere else;
--   auto_assign_candidates_pool(p_shift, p_escalation, p_only)
--     unchanged signature, columns and order (staff_id): one section
--     against the agency or the named workers — a reader of the above;
--   auto_assign_worker_pool(p_staff, p_shifts)
--     new: one worker against many sections, the same columns plus the
--     section's id, in section order — a reader of the above.
--
-- What changes in the body is only how each fact is joined to the row it
-- belongs to: a fact that belonged to "the" section now belongs to the
-- row's section, and a fact read once per worker is still read once per
-- worker. 20261019140000's shape is otherwise kept: each history source has
-- one branch for the agency (driven from the sections) and one for named
-- workers (driven from their bookings through the staff_id indexes), and
-- exactly one runs; the RULE-20 verdict is rota_guard_verdict()'s pieces,
-- asked only of a pair every earlier gate let through. The section-only
-- facts that were `s.id in (subquery over the one section)` — wrong role,
-- self-cancelled off the event, booked elsewhere, qualified, do-not-return
-- — become left joins on (section, worker) to sets unique on that key, so
-- with one section they say exactly what the IN said.
--
-- pgTAP 880 re-creates 20261019140000's pool under an _old_ name and
-- compares it with every reader here, row for row, over 859's fixture
-- (every gate code), and checks auto_assign_worker_pool() against
-- auto_assign_candidates_pool() for every (worker, section) pair, so the
-- two cannot drift apart.
--
-- Built against 20261019140000's body. The code (comments dropped,
-- whitespace collapsed) is fingerprinted first; if anything has changed it
-- since, this stops rather than dropping a rule it has not seen (docs/10
-- §3b).
-- =====================================================================

do $$
begin
  if (select md5(btrim(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g')))
        from pg_proc p
       where p.oid = 'public.auto_assign_candidates_pool(uuid, boolean, uuid[])'::regprocedure)
     is distinct from 'edea5181c44b4bf63a78aa35d18b2514' then
    raise exception '20261020100000: auto_assign_candidates_pool() is not the body this migration replaces (20261019140000). Something changed it since; merge that change into auto_assign_candidates_pool_pairs() first.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 1 · the pool: every (section, worker) pair asked for, in one pass
-- ---------------------------------------------------------------------
create or replace function public.auto_assign_candidates_pool_pairs(
  p_shifts     uuid[],
  p_staff      uuid[],
  p_escalation boolean default false
)
returns table (
  shift_id       uuid,
  staff_id       uuid,
  gate           text,
  qualified      boolean,
  booking_status text,
  reliability    numeric,
  rating         numeric,
  distance_km    numeric,
  future_shifts  int,
  venue_times    int,
  booking_cause  text
)
language plpgsql
stable
set search_path = public, extensions
set jit = off
set plan_cache_mode = force_generic_plan
as $function$
#variable_conflict use_column
begin
  return query
  with sec as materialized (
    select sr.id as shift_id, sr.role_id, sr.starts_at, sr.ends_at, sr.required_gender,
           ev.id as event_id, ev.client_id, ev.venue_id, ev.venue_location,
           -- ADR-0080: the languages the event needs besides English, which
           -- is never gated — everyone THC books speaks it.
           array_remove(ev.required_languages, 'English') as extra_languages,
           -- RULE-20's inputs, derived from the section as rota_guard_verdict()
           -- derives them: the UK day it starts and ends on, its hours, and
           -- the Monday of its Mon-Sun week.
           (sr.starts_at at time zone 'Europe/London')::date                              as starts_on,
           ((sr.ends_at - interval '1 second') at time zone 'Europe/London')::date        as ends_on,
           round((extract(epoch from (sr.ends_at - sr.starts_at)) / 3600.0)::numeric, 2)  as hours,
           cap_week_start((sr.starts_at at time zone 'Europe/London')::date)              as week_start
    from shift_requirements sr join events ev on ev.id = sr.event_id
    where sr.id = any (p_shifts)
  ),
  -- The pairs asked about by name: (p_shifts[i], p_staff[i]), each once.
  -- Empty when p_staff is null, which asks about the whole agency.
  pairs as materialized (
    select distinct x.shift_id, x.staff_id
      from unnest(p_shifts, p_staff) as x(shift_id, staff_id)
     where p_staff is not null and x.shift_id is not null and x.staff_id is not null
  ),
  gap  as materialized (select booked_elsewhere_gap_minutes() as mins),
  -- One statute mile is 1,609.344 m; geography distances are metres.
  rad  as materialized (select case when p_escalation then escalation_radius_miles() * 1609.344 end as metres),
  mode as materialized (select rota_guard_mode() as m),
  -- The named workers' bookings, each with its section's times, event and
  -- venue, read ONCE through bookings(staff_id) and shared by every named
  -- branch below. Empty for a call about the agency.
  wb as materialized (
    select b.id, b.staff_id, b.shift_id, b.status, b.cancelled_at, b.cancel_cause, b.self_cancelled,
           sr.starts_at, sr.ends_at, sr.event_id, ev.venue_id
      from bookings b
      join shift_requirements sr on sr.id = b.shift_id
      join events ev on ev.id = sr.event_id
     where b.staff_id = any (p_staff)
  ),
  -- What each row needs from the booking history, worked out ONCE per call
  -- as grouped joins (20261019140000). Each source below has two branches
  -- and exactly one of them runs (a one-time filter on p_staff): a call for
  -- the agency reads the agency's rows from the sections; a call for named
  -- workers reads only theirs, through the staff_id indexes. What is done
  -- with the rows is written once, after the branches.
  --
  -- §6 show-rate, staff_show_rate()'s sample and formula (20260928110100):
  -- worked or turned-away shifts, and any with an open No-show; held
  -- against the worker when an open No-show or No check-out not under
  -- stale-fix review sits on it. Per worker, whatever the section.
  hist as (
    select b.id, b.staff_id, b.status from bookings b where p_staff is null
    union all
    select wb.id, wb.staff_id, wb.status from wb
  ),
  viol as (
    select v.booking_id, v.type, v.resolved, v.stale_fix_review from violations v where p_staff is null
    union all
    select v.booking_id, v.type, v.resolved, v.stale_fix_review from violations v
     where v.booking_id in (select wb.id from wb)
  ),
  shows as (
    select h.staff_id,
           round(100.0 * count(*) filter (where not coalesce(vb.against, false)) / count(*), 2) as rate
      from hist h
      left join (
        select vv.booking_id,
               bool_or(not vv.resolved and vv.type in ('no_show', 'no_checkout')
                       and not vv.stale_fix_review)                  as against,
               bool_or(vv.type = 'no_show' and not vv.resolved)      as no_show
          from viol vv group by vv.booking_id
      ) vb on vb.booking_id = h.id
     where h.status in ('worked', 'turned_away') or coalesce(vb.no_show, false)
     group by h.staff_id
  ),
  -- Confirmed shifts still to come (§6 fair rotation). Per worker.
  future_src as (
    select b.staff_id
      from shift_requirements sr3 join bookings b on b.shift_id = sr3.id
     where p_staff is null and sr3.starts_at > now() and b.status = 'confirmed'
    union all
    select wb.staff_id from wb where wb.status = 'confirmed' and wb.starts_at > now()
  ),
  future as (
    select f.staff_id, count(*)::int as n from future_src f group by f.staff_id
  ),
  -- Shifts worked at the row's venue (§6 venue history). Per worker and
  -- venue: each venue of the sections asked about is read once.
  venue_src as (
    select x.staff_id, x.status, x.venue_id
      from (select distinct s4.venue_id from sec s4) sv
     cross join lateral (
       select b.staff_id, b.status, ev4.venue_id
         from events ev4
         join shift_requirements sr4 on sr4.event_id = ev4.id
         join bookings b on b.shift_id = sr4.id
        where ev4.venue_id = sv.venue_id
        offset 0) x
     where p_staff is null
    union all
    select wb.staff_id, wb.status, wb.venue_id
      from wb where wb.venue_id in (select s4.venue_id from sec s4)
  ),
  venue as (
    select vs.staff_id, vs.venue_id, count(*)::int as n
      from venue_src vs
     where vs.status = 'worked'
     group by vs.staff_id, vs.venue_id
  ),
  -- RULE-20: the hours already booked in the row's section's Mon-Sun week,
  -- as weekly_booked_hours_except() counts them; booking_counts_toward_cap()
  -- is still the one definition of what counts. The range on starts_at, a
  -- day wider each side, only narrows the scan; the UK-date test is the rule.
  -- Per section and worker; for named workers, per pair asked about.
  week_src as (
    select sec.shift_id as for_shift, x.staff_id, x.shift_id, x.status, x.cancelled_at, x.cancel_cause,
           x.starts_at, x.ends_at
      from sec
     cross join lateral (
       select b.staff_id, b.shift_id, b.status, b.cancelled_at, b.cancel_cause, sr2.starts_at, sr2.ends_at
         from shift_requirements sr2
         join bookings b on b.shift_id = sr2.id
        where sr2.starts_at >= (sec.week_start - 1)::timestamp at time zone 'Europe/London'
          and sr2.starts_at <  (sec.week_start + 8)::timestamp at time zone 'Europe/London'
        offset 0) x
     where p_staff is null
    union all
    select sec.shift_id as for_shift, wb.staff_id, wb.shift_id, wb.status, wb.cancelled_at, wb.cancel_cause,
           wb.starts_at, wb.ends_at
      from pairs pp
      join sec on sec.shift_id = pp.shift_id
      join wb
        on wb.staff_id = pp.staff_id
       and wb.starts_at >= (sec.week_start - 1)::timestamp at time zone 'Europe/London'
       and wb.starts_at <  (sec.week_start + 8)::timestamp at time zone 'Europe/London'
  ),
  week as (
    select w.for_shift, w.staff_id,
           coalesce(sum(extract(epoch from (w.ends_at - w.starts_at)) / 3600.0), 0)::numeric as booked
      from week_src w join sec on sec.shift_id = w.for_shift
     where w.shift_id is distinct from sec.shift_id
       and booking_counts_toward_cap(w.status, w.cancelled_at, w.cancel_cause)
       and (w.starts_at at time zone 'Europe/London')::date
           between sec.week_start and sec.week_start + 6
     group by w.for_shift, w.staff_id
  ),
  -- (1) §3.4 "only the worker's other CONFIRMED bookings count" — and a
  -- checked-in booking is a confirmed one (20260930110000, D2) — read from
  -- the sections near the row's section only. A section that ends before
  -- it starts less the gap, or starts after it ends plus the gap, can
  -- neither intersect it nor sit too close to it (min_4h keeps every
  -- section's end after its start; a negative or missing gap only ever
  -- flags an overlap), so the window drops nothing booked_elsewhere_conflict()
  -- would flag.
  near_src as (
    select sec.shift_id as for_shift, x.staff_id, x.shift_id, x.starts_at, x.ends_at, x.venue_id
      from sec cross join gap
     cross join lateral (
       select sr2.id, sr2.starts_at, sr2.ends_at, ev2.venue_id
         from shift_requirements sr2
         join events ev2 on ev2.id = sr2.event_id
        where sr2.starts_at < sec.ends_at + make_interval(mins => greatest(gap.mins, 0))
          and sr2.ends_at > sec.starts_at - make_interval(mins => greatest(gap.mins, 0))
        offset 0) y
     cross join lateral (
       select b.staff_id, b.shift_id, y.starts_at, y.ends_at, y.venue_id
         from bookings b
        where b.shift_id = y.id and b.status in ('confirmed', 'worked')
        offset 0) x
     where p_staff is null
    union all
    select sec.shift_id as for_shift, wb.staff_id, wb.shift_id, wb.starts_at, wb.ends_at, wb.venue_id
      from pairs pp
      join sec on sec.shift_id = pp.shift_id
      cross join gap
      join wb
        on wb.staff_id = pp.staff_id
       and wb.status in ('confirmed', 'worked')
       and wb.starts_at < sec.ends_at + make_interval(mins => greatest(gap.mins, 0))
       and wb.ends_at > sec.starts_at - make_interval(mins => greatest(gap.mins, 0))
  ),
  elsewhere as materialized (
    select distinct n.for_shift, n.staff_id
      from near_src n join sec on sec.shift_id = n.for_shift cross join gap
     where n.shift_id <> sec.shift_id
       and booked_elsewhere_conflict(sec.starts_at, sec.ends_at, sec.venue_id,
                                     n.starts_at, n.ends_at, n.venue_id, gap.mins) <> 'clear'
  ),
  -- (3) The row's section's own booking, read once for its status and cause.
  -- bookings is unique on (shift_id, staff_id), so at most one per pair.
  mine as (
    select b.shift_id, b.staff_id, b.status::text as status, b.cancel_cause
      from sec join bookings b on b.shift_id = sec.shift_id
     where p_staff is null
    union all
    select wb.shift_id, wb.staff_id, wb.status::text as status, wb.cancel_cause
      from pairs pp join wb on wb.shift_id = pp.shift_id and wb.staff_id = pp.staff_id
  ),
  -- The section-only facts, each in a set unique on the key it is joined
  -- by, with the same two branches as the history (one runs): who holds
  -- the section's role (staff_roles is keyed on (staff, role)) ...
  held as materialized (
    select sro.staff_id, sro.role_id
      from staff_roles sro
     where p_staff is null and sro.role_id in (select s5.role_id from sec s5)
    union all
    select sro.staff_id, sro.role_id
      from staff_roles sro
     where sro.staff_id = any (p_staff) and sro.role_id in (select s5.role_id from sec s5)
  ),
  -- ... who may not return to the section's client, once per (worker,
  -- client) ...
  dnr as materialized (
    select distinct cq.staff_id, cq.client_id
      from client_qualifications cq
     where p_staff is null and cq.do_not_return
       and cq.client_id in (select s5.client_id from sec s5)
    union all
    select distinct cq.staff_id, cq.client_id
      from client_qualifications cq
     where cq.staff_id = any (p_staff) and cq.do_not_return
       and cq.client_id in (select s5.client_id from sec s5)
  ),
  -- ... RULE-17 wave 1, qualified at the section's client AND role
  -- (unique on (client, role, staff)) ...
  qual as materialized (
    select cq.staff_id, cq.client_id, cq.role_id
      from client_qualifications cq
      join (select distinct s5.client_id, s5.role_id from sec s5) k
        on k.client_id = cq.client_id and k.role_id = cq.role_id
     where p_staff is null and not cq.do_not_return
    union all
    select cq.staff_id, cq.client_id, cq.role_id
      from client_qualifications cq
      join (select distinct s5.client_id, s5.role_id from sec s5) k
        on k.client_id = cq.client_id and k.role_id = cq.role_id
     where cq.staff_id = any (p_staff) and not cq.do_not_return
  ),
  -- ... and RULE-04, who self-cancelled off any section of the section's
  -- event.
  selfc as materialized (
    select distinct sr2.event_id, b.staff_id
      from (select distinct s5.event_id from sec s5) e
      join shift_requirements sr2 on sr2.event_id = e.event_id
      join bookings b on b.shift_id = sr2.id
     where p_staff is null and b.self_cancelled
    union all
    select distinct wb.event_id, wb.staff_id
      from wb
     where wb.self_cancelled and wb.event_id in (select s5.event_id from sec s5)
  ),
  -- The rows this call is about: every section against the agency, or the
  -- pairs named. The columns are named: the office's role reads staff
  -- column by column.
  pool as (
    select sec.shift_id as for_shift,
           s.id, s.status, s.gender, s.languages, s.rating, s.home_location,
           s.removed_at, s.left_at, s.spudbros_express, s.thc_shifts_enabled
      from sec cross join staff s where p_staff is null
    union all
    select pp.shift_id as for_shift,
           s.id, s.status, s.gender, s.languages, s.rating, s.home_location,
           s.removed_at, s.left_at, s.spudbros_express, s.thc_shifts_enabled
      from staff s join pairs pp on pp.staff_id = s.id
     where s.id = any (p_staff)
  )
  select
    sec.shift_id,
    s.id,
    case
      when hr.staff_id is null                                                  then 'wrong_role'
      -- ADR-0079: the client asked for staff of one gender on this role.
      -- Straight after wrong_role because, like it, it is what the SECTION
      -- asks for rather than anything about the worker's week.
      when sec.required_gender is not null and s.gender is null              then 'gender_not_recorded'
      when sec.required_gender = 'M' and s.gender <> 'M'                      then 'male_only'
      when sec.required_gender = 'F' and s.gender <> 'F'                      then 'female_only'
      -- ADR-0080: the event needs staff who also speak another language.
      -- Next to the gender gates for the same reason: it is what the EVENT
      -- asks for. Nothing on file reads as "not shown to speak it", listed
      -- so the office can record it; on file without it is no row at all.
      when cardinality(sec.extra_languages) > 0 and s.languages is null         then 'languages_not_recorded'
      when not (sec.extra_languages <@ s.languages)                             then 'language_not_spoken'
      when dn.staff_id is not null                                              then 'do_not_return'
      when s.status <> 'compliant'                                              then 'blocked'
      when sc.staff_id is not null                                              then 'self_cancelled'
      -- (1) above.
      when el.staff_id is not null                                              then 'booked_elsewhere'
      -- RULE-20 and the right-to-work stop share one gate, but not one
      -- label: a worker past their right to work is not "over their
      -- hours" and the board must not say so (20260924130100). The verdict
      -- is rota_guard_verdict()'s, from its own pieces, with the week's
      -- booked hours from the grouped join above; asked only of a pair
      -- every gate before it let through.
      else coalesce(
        (select case when g.verdict = 'block'
                     then case when not x.can_roster then 'rtw_expired' else 'hours_limit' end end
           from (select can_roster_staff(s.id, sec.starts_on)
                        and can_roster_staff(s.id, sec.ends_on) as can_roster) x
          cross join lateral weekly_cap_for(s.id, sec.starts_on) c
          cross join lateral rota_guard_decide(x.can_roster, c.cap_hours, c.band,
                                               coalesce(wk.booked, 0), sec.hours,
                                               (select mode.m from mode)) g),
        -- §3.4 same-day escalation only: "within a 3-mile radius of the
        -- venue". No home on file cannot be shown to be inside it.
        case when rad.metres is not null
                  and (s.home_location is null
                       or not st_dwithin(s.home_location, sec.venue_location, rad.metres)) then 'outside_radius' end)
    end as gate,
    -- RULE-17 wave 1: qualified at this client AND role.
    qu.staff_id is not null as qualified,
    mine.status as booking_status,
    -- §6 show-rate; 90 with no history is the formula's zero point.
    coalesce(sh.rate, 90)::numeric,
    coalesce(s.rating, 4.0)::numeric,
    coalesce(st_distance(s.home_location, sec.venue_location) / 1000.0, 9999)::numeric,
    coalesce(fu.n, 0)::int,
    coalesce(vn.n, 0)::int,
    mine.cancel_cause as booking_cause
  from pool s
  join sec on sec.shift_id = s.for_shift
  cross join rad
  left join held hr      on hr.staff_id = s.id and hr.role_id = sec.role_id
  left join dnr dn       on dn.staff_id = s.id and dn.client_id = sec.client_id
  left join selfc sc     on sc.staff_id = s.id and sc.event_id = sec.event_id
  left join elsewhere el on el.staff_id = s.id and el.for_shift = sec.shift_id
  left join qual qu      on qu.staff_id = s.id and qu.client_id = sec.client_id and qu.role_id = sec.role_id
  left join mine         on mine.staff_id = s.id and mine.shift_id = sec.shift_id
  left join shows sh     on sh.staff_id = s.id
  left join future fu    on fu.staff_id = s.id
  left join venue vn     on vn.staff_id = s.id and vn.venue_id = sec.venue_id
  left join week  wk     on wk.staff_id = s.id and wk.for_shift = sec.shift_id
  where s.removed_at is null and s.left_at is null
    -- (2) Workers only (§2.12): compliant, or blocked (gated above). A
    -- candidate mid-onboarding or a rejected applicant is in no pool and
    -- produces no row — not an Unavailable "Blocked — compliance" row.
    and s.status in ('compliant', 'blocked')
    -- SpudBros Express staff (20261008120000): onboarding only, unless the
    -- office has switched THC shifts on for them. No row at all — like a
    -- candidate — so they never show on the board, never get an invitation
    -- and never see an offer.
    and not (s.spudbros_express and not s.thc_shifts_enabled)
  order by sec.shift_id, s.id;
end
$function$;

revoke execute on function public.auto_assign_candidates_pool_pairs(uuid[], uuid[], boolean) from public, anon;
grant  execute on function public.auto_assign_candidates_pool_pairs(uuid[], uuid[], boolean) to authenticated, service_role;

comment on function public.auto_assign_candidates_pool_pairs(uuid[], uuid[], boolean) is
  'The auto-assign pool (ADR-0117, ADR-0156, ADR-0159): the one place the hard gates, their order and codes, RULE-17''s wave and the five score inputs are decided. Returns the row for each (p_shifts[i], p_staff[i]); with p_staff null, for every section in p_shifts against the whole agency. auto_assign_candidates_pool() (one section) and auto_assign_worker_pool() (one worker, many sections) read it; a new pool gate goes here. SECURITY INVOKER: a worker or client calling it directly reads nothing.';

-- ---------------------------------------------------------------------
-- 2 · auto_assign_candidates_pool(): one section, a reader of the pool
-- ---------------------------------------------------------------------
create or replace function public.auto_assign_candidates_pool(
  p_shift      uuid,
  p_escalation boolean default false,
  p_only       uuid[] default null
)
returns table (
  staff_id       uuid,
  gate           text,
  qualified      boolean,
  booking_status text,
  reliability    numeric,
  rating         numeric,
  distance_km    numeric,
  future_shifts  int,
  venue_times    int,
  booking_cause  text
)
language plpgsql
stable
set search_path = public, extensions
set jit = off
set plan_cache_mode = force_generic_plan
as $function$
#variable_conflict use_column
begin
  -- 20261020100000: the gates are decided in auto_assign_candidates_pool_pairs();
  -- this is that pool for one section, against the agency (p_only null) or
  -- the workers named (the section paired with each name), in staff_id
  -- order as before.
  return query
  select c.staff_id, c.gate, c.qualified, c.booking_status, c.reliability, c.rating,
         c.distance_km, c.future_shifts, c.venue_times, c.booking_cause
    from auto_assign_candidates_pool_pairs(
           case when p_only is null then array[p_shift]
                else array_fill(p_shift, array[coalesce(cardinality(p_only), 0)]) end,
           p_only,
           p_escalation) c
   order by c.staff_id;
end
$function$;

do $$
begin
  execute format('comment on function public.auto_assign_candidates_pool(uuid, boolean, uuid[]) is %L',
    coalesce(obj_description('public.auto_assign_candidates_pool(uuid, boolean, uuid[])'::regprocedure::oid, 'pg_proc'), '')
    || ' Since 20261020100000 (ADR-0159) the body is auto_assign_candidates_pool_pairs(), where every gate is decided; this is that pool for one section, with the same columns and order.');
end;
$$;

-- ---------------------------------------------------------------------
-- 3 · auto_assign_worker_pool(): one worker, many sections, one pass
-- ---------------------------------------------------------------------
create or replace function public.auto_assign_worker_pool(
  p_staff  uuid,
  p_shifts uuid[]
)
returns table (
  shift_id       uuid,
  staff_id       uuid,
  gate           text,
  qualified      boolean,
  booking_status text,
  reliability    numeric,
  rating         numeric,
  distance_km    numeric,
  future_shifts  int,
  venue_times    int,
  booking_cause  text
)
language plpgsql
stable
set search_path = public, extensions
set jit = off
set plan_cache_mode = force_generic_plan
as $function$
#variable_conflict use_column
begin
  -- The worker's row of each section's pool, exactly what
  -- auto_assign_candidates_pool(section, false, array[p_staff]) returns for
  -- it, for every section at once: one read of the worker's history instead
  -- of one per section. No row where the pool has none (wrong role is a
  -- row; a removed worker or an unknown section is not).
  return query
  select c.shift_id, c.staff_id, c.gate, c.qualified, c.booking_status, c.reliability, c.rating,
         c.distance_km, c.future_shifts, c.venue_times, c.booking_cause
    from auto_assign_candidates_pool_pairs(
           p_shifts,
           array_fill(p_staff, array[coalesce(cardinality(p_shifts), 0)]),
           false) c
   order by c.shift_id;
end
$function$;

revoke execute on function public.auto_assign_worker_pool(uuid, uuid[]) from public, anon;
grant  execute on function public.auto_assign_worker_pool(uuid, uuid[]) to authenticated, service_role;

comment on function public.auto_assign_worker_pool(uuid, uuid[]) is
  'One worker against many sections (ADR-0159): for each section in p_shifts, the row auto_assign_candidates_pool(section, false, array[p_staff]) returns, plus the section id, in section order, computed in one pass. Decides nothing itself: the gates are auto_assign_candidates_pool_pairs()''s. Radar reads it; pgTAP 880 holds it equal to the one-section pool for every (worker, section) pair.';
