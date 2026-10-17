-- =====================================================================
-- Migration 20261018140000 · the auto-assign pool works out each fact
--                            once per call, not once per worker (ADR-0154)
--
-- auto_assign_candidates_pool() is the one place the hard gates, the wave
-- and the score inputs are decided (ADR-0117). Every list reader goes
-- through it — the event board once per section every 30 s, the hourly,
-- cutoff and escalation rounds once per due section, offer_candidates —
-- and so does every one-worker reader through auto_assign_worker_gate()
-- (invite, Accept, apply, accept-application, take) and Radar.
--
-- At go-live size it does not fit. On a local cluster with 1,000 workers,
-- 600 open sections and ~30 worked shifts each (scripts/bench/
-- radar_and_pool_at_scale.sql) one section's pool took 1.5–2.7 s as
-- service_role and 3.6–4.7 s as the board's admin. Per worker it ran:
--   * weekly_cap_would_breach() — rota_guard_verdict() and its chain,
--     re-planned on every call (a nested SQL function is), ~2.7 ms;
--   * staff_show_rate() over the whole history, ~0.25 ms;
--   * the booked-elsewhere test over EVERY confirmed or worked booking the
--     worker ever had, booked_elsewhere_conflict() on each, ~0.26 ms;
--   * a count of every shift worked at the venue, ~0.17 ms;
-- and the same for wrong-role workers, whose row the board never shows.
--
-- Now, with every gate, its order, its code, the wave and the five score
-- inputs exactly as before (pgTAP 854 compares this body with the old one
-- over a dataset that reaches every gate):
--
--   * the facts that come from the booking history are worked out ONCE per
--     call as grouped joins: show-rate (staff_show_rate()'s sample and
--     formula), confirmed shifts to come, shifts at this venue, the hours
--     booked in the section's
--     Mon–Sun week (booking_counts_toward_cap() still says what counts),
--     who self-cancelled off this event, and who holds a confirmed or
--     worked booking near this section;
--   * booked elsewhere reads only the sections within the 2 h gap of this
--     one: a section that ends before this one starts less the gap, or
--     starts after it ends plus the gap, can neither intersect it nor sit
--     too close to it, so booked_elsewhere_conflict() — still the judge —
--     is asked about a few rows instead of the worker's whole history. The
--     new index on shift_requirements(ends_at) makes that window a range;
--   * the RULE-20 verdict is rota_guard_verdict()'s, built from the same
--     pieces (weekly_cap_for(), can_roster_staff() on the start and end
--     day, rota_guard_decide(), rota_guard_mode()) with the week's booked
--     hours from the grouped join, and asked only of a worker every
--     earlier gate let through, as the CASE always did. can_roster_staff()
--     is asked once per day instead of twice, the rtw_expired label reading
--     the same answer;
--   * every history source has two branches and exactly one runs (a
--     one-time filter on p_only): a list call reads the agency's rows; a
--     call for named workers reads only theirs, through the staff_id
--     indexes, so a one-worker gate never aggregates the agency's history;
--   * plpgsql with a generic plan cached for the session: a SQL function is
--     parsed and planned again on every call when it is called from another
--     function, which is how every one-worker reader reaches it. jit is off
--     for the body: its estimated cost is far above jit_above_cost, and
--     compiling it cost seconds a call while executing it costs
--     milliseconds;
--   * rows come back ordered by staff_id, so a reader that pages through
--     the list (the rounds, offer_candidates) sees a stable order.
--
-- Unchanged: the signature, the result columns and their types, SECURITY
-- INVOKER, search_path, the comment's text so far and the grants. Owner
-- rights were weighed and not taken (ADR-0154): the pool is reached from
-- SECURITY DEFINER functions inside staff sessions, so a definer pool could
-- not tell those calls from a worker calling it directly.
--
-- Built against 20261012140000's body. That body is checked before it is
-- replaced: if anything has changed it since, this stops rather than
-- dropping a rule it has not seen (docs/10 §3b).
-- =====================================================================

do $$
begin
  if (select md5(p.prosrc) from pg_proc p
       where p.oid = 'public.auto_assign_candidates_pool(uuid, boolean, uuid[])'::regprocedure)
     is distinct from '280fa079085d82deb53ba0484bc9252d' then
    raise exception '20261018140000: auto_assign_candidates_pool() is not the body this migration replaces (20261012140000). Something changed it since; merge that change into this migration''s body first.';
  end if;
end;
$$;

-- "Not over yet" and "near this section" read shift_requirements by end:
-- booked-elsewhere's window here, and Radar's ends_at > now().
create index if not exists shift_requirements_ends_at_idx on public.shift_requirements (ends_at);

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
    where sr.id = p_shift
  ),
  gap  as materialized (select booked_elsewhere_gap_minutes() as mins),
  -- One statute mile is 1,609.344 m; geography distances are metres.
  rad  as materialized (select case when p_escalation then escalation_radius_miles() * 1609.344 end as metres),
  mode as materialized (select rota_guard_mode() as m),
  -- 20261018140000: what each row needs from the booking history, worked
  -- out ONCE per call as grouped joins instead of once per worker. Each
  -- source below has two branches and exactly one of them runs (a one-time
  -- filter on p_only): a list call reads the agency's rows; a call for named
  -- workers reads only theirs, through the staff_id indexes. What is done
  -- with the rows is written once, after the branches.
  --
  -- §6 show-rate, staff_show_rate()'s sample and formula (20260928110100):
  -- worked or turned-away shifts, and any with an open No-show; held
  -- against the worker when an open No-show or No check-out not under
  -- stale-fix review sits on it.
  hist as (
    select b.id, b.staff_id, b.status from bookings b where p_only is null
    union all
    select b.id, b.staff_id, b.status from bookings b where b.staff_id = any (p_only)
  ),
  viol as (
    select v.booking_id, v.type, v.resolved, v.stale_fix_review from violations v where p_only is null
    union all
    select v.booking_id, v.type, v.resolved, v.stale_fix_review from violations v
     where v.booking_id in (select b.id from bookings b where b.staff_id = any (p_only))
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
  -- Confirmed shifts still to come (§6 fair rotation).
  future_src as (
    select b.staff_id
      from shift_requirements sr3 join bookings b on b.shift_id = sr3.id
     where p_only is null and sr3.starts_at > now() and b.status = 'confirmed'
    union all
    select b.staff_id
      from bookings b join shift_requirements sr3 on sr3.id = b.shift_id
     where b.staff_id = any (p_only) and b.status = 'confirmed' and sr3.starts_at > now()
  ),
  future as (
    select f.staff_id, count(*)::int as n from future_src f group by f.staff_id
  ),
  -- Shifts worked at this venue (§6 venue history).
  venue_src as (
    select b.staff_id, b.status, ev4.venue_id
      from sec join events ev4 on ev4.venue_id = sec.venue_id
      join shift_requirements sr4 on sr4.event_id = ev4.id
      join bookings b on b.shift_id = sr4.id
     where p_only is null
    union all
    select b.staff_id, b.status, ev4.venue_id
      from sec join events ev4 on ev4.venue_id = sec.venue_id
      join shift_requirements sr4 on sr4.event_id = ev4.id
      join bookings b on b.shift_id = sr4.id
     where b.staff_id = any (p_only)
  ),
  venue as (
    select vs.staff_id, count(*)::int as n
      from venue_src vs cross join sec
     where vs.status = 'worked' and vs.venue_id = sec.venue_id
     group by vs.staff_id
  ),
  -- RULE-20: the hours already booked in the section's Mon-Sun week, as
  -- weekly_booked_hours_except() counts them; booking_counts_toward_cap()
  -- is still the one definition of what counts. The range on starts_at, a
  -- day wider each side, only narrows the scan; the UK-date test is the rule.
  week_src as (
    select b.staff_id, b.shift_id, b.status, b.cancelled_at, b.cancel_cause, sr2.starts_at, sr2.ends_at
      from sec
      join shift_requirements sr2
        on sr2.starts_at >= (sec.week_start - 1)::timestamp at time zone 'Europe/London'
       and sr2.starts_at <  (sec.week_start + 8)::timestamp at time zone 'Europe/London'
      join bookings b on b.shift_id = sr2.id
     where p_only is null
    union all
    select b.staff_id, b.shift_id, b.status, b.cancelled_at, b.cancel_cause, sr2.starts_at, sr2.ends_at
      from sec
      join shift_requirements sr2
        on sr2.starts_at >= (sec.week_start - 1)::timestamp at time zone 'Europe/London'
       and sr2.starts_at <  (sec.week_start + 8)::timestamp at time zone 'Europe/London'
      join bookings b on b.shift_id = sr2.id
     where b.staff_id = any (p_only)
  ),
  week as (
    select w.staff_id,
           coalesce(sum(extract(epoch from (w.ends_at - w.starts_at)) / 3600.0), 0)::numeric as booked
      from week_src w cross join sec
     where w.shift_id is distinct from sec.shift_id
       and booking_counts_toward_cap(w.status, w.cancelled_at, w.cancel_cause)
       and (w.starts_at at time zone 'Europe/London')::date
           between sec.week_start and sec.week_start + 6
     group by w.staff_id
  ),
  -- (1) §3.4 "only the worker's other CONFIRMED bookings count" — and a
  -- checked-in booking is a confirmed one (20260930110000, D2) — read from
  -- the sections near this one only. A section that ends before this one
  -- starts less the gap, or starts after it ends plus the gap, can neither
  -- intersect it nor sit too close to it (min_4h keeps every section's end
  -- after its start; a negative or missing gap only ever flags an overlap),
  -- so the window drops nothing booked_elsewhere_conflict() would flag.
  near_src as (
    select b.staff_id, b.shift_id, sr2.starts_at, sr2.ends_at, ev2.venue_id
      from sec cross join gap
      join shift_requirements sr2
        on sr2.starts_at < sec.ends_at + make_interval(mins => greatest(gap.mins, 0))
       and sr2.ends_at > sec.starts_at - make_interval(mins => greatest(gap.mins, 0))
      join events ev2 on ev2.id = sr2.event_id
      join bookings b on b.shift_id = sr2.id
     where p_only is null and b.status in ('confirmed', 'worked')
    union all
    select b.staff_id, b.shift_id, sr2.starts_at, sr2.ends_at, ev2.venue_id
      from sec cross join gap
      join bookings b on b.staff_id = any (p_only) and b.status in ('confirmed', 'worked')
      join shift_requirements sr2
        on sr2.id = b.shift_id
       and sr2.starts_at < sec.ends_at + make_interval(mins => greatest(gap.mins, 0))
       and sr2.ends_at > sec.starts_at - make_interval(mins => greatest(gap.mins, 0))
      join events ev2 on ev2.id = sr2.event_id
  ),
  elsewhere as (
    select n.staff_id
      from near_src n cross join sec cross join gap
     where n.shift_id <> sec.shift_id
       and booked_elsewhere_conflict(sec.starts_at, sec.ends_at, sec.venue_id,
                                     n.starts_at, n.ends_at, n.venue_id, gap.mins) <> 'clear'
  ),
  -- (3) This section's own bookings, read once for their status and cause.
  -- bookings is unique on (shift_id, staff_id), so at most one per worker.
  mine as (
    select b.staff_id, b.status::text as status, b.cancel_cause
      from sec join bookings b on b.shift_id = sec.shift_id
  ),
  -- The workers this call is about: the agency, or the named ones. The
  -- columns are named: the office's role reads staff column by column.
  pool as (
    select s.id, s.status, s.gender, s.languages, s.rating, s.home_location,
           s.removed_at, s.left_at, s.spudbros_express, s.thc_shifts_enabled
      from staff s where p_only is null
    union all
    select s.id, s.status, s.gender, s.languages, s.rating, s.home_location,
           s.removed_at, s.left_at, s.spudbros_express, s.thc_shifts_enabled
      from staff s where s.id = any (p_only)
  )
  select
    s.id,
    case
      when not (s.id in (select sro.staff_id from sec s2
                           join staff_roles sro on sro.role_id = s2.role_id))   then 'wrong_role'
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
      when exists (select 1 from client_qualifications cq
                    where cq.staff_id = s.id and cq.client_id = sec.client_id
                      and cq.do_not_return)                                     then 'do_not_return'
      when s.status <> 'compliant'                                              then 'blocked'
      when s.id in (select b.staff_id from sec s2
                      join shift_requirements sr2 on sr2.event_id = s2.event_id
                      join bookings b on b.shift_id = sr2.id
                     where b.self_cancelled)                                    then 'self_cancelled'
      -- (1) above.
      when s.id in (select e.staff_id from elsewhere e)                       then 'booked_elsewhere'
      -- RULE-20 and the right-to-work stop share one gate, but not one
      -- label: a worker past their right to work is not "over their
      -- hours" and the board must not say so (20260924130100). The verdict
      -- is rota_guard_verdict()'s, from its own pieces, with the week's
      -- booked hours from the grouped join above; asked only of a worker
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
    s.id in (select cq.staff_id from sec s2
               join client_qualifications cq on cq.client_id = s2.client_id and cq.role_id = s2.role_id
              where not cq.do_not_return) as qualified,
    mine.status as booking_status,
    -- §6 show-rate; 90 with no history is the formula's zero point.
    coalesce(sh.rate, 90)::numeric,
    coalesce(s.rating, 4.0)::numeric,
    coalesce(st_distance(s.home_location, sec.venue_location) / 1000.0, 9999)::numeric,
    coalesce(fu.n, 0)::int,
    coalesce(vn.n, 0)::int,
    mine.cancel_cause as booking_cause
  from pool s cross join sec cross join rad
  left join mine     on mine.staff_id = s.id
  left join shows sh on sh.staff_id = s.id
  left join future fu on fu.staff_id = s.id
  left join venue vn on vn.staff_id = s.id
  left join week  wk on wk.staff_id = s.id
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
  order by s.id;
end
$function$;

do $$
begin
  execute format('comment on function public.auto_assign_candidates_pool(uuid, boolean, uuid[]) is %L',
    coalesce(obj_description('public.auto_assign_candidates_pool(uuid, boolean, uuid[])'::regprocedure::oid, 'pg_proc'), '')
    || ' Since 20261018140000 (ADR-0154) every fact from the booking history is worked out once per call as a grouped join, booked elsewhere reads only the sections within the gap of this one, and rows come back in staff_id order: the same gates, wave and score inputs, at a cost that no longer grows with each worker''s history.');
end;
$$;
