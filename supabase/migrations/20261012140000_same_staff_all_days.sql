-- =====================================================================
-- Migration 20261012140000 · "Same staff on all days" (ADR-0117)
--
-- A deliberate change to Scope §3.2. "Multi-day = separate events created
-- via Duplicate (the clone copies the roles, NOT the staff)" still holds:
-- nobody is copied. What is new is a REQUIREMENT a manager can put on a
-- role section, which narrows who may be INVITED to it.
--
--   1 · events.series_id               the days of one multi-day job
--       shift_requirements
--         .same_staff_all_days         the per-ROLE switch (default off)
--   2 · series_siblings(p_shift)       the sections a flagged section must
--                                      also be fillable on (same series,
--                                      client and role, flag on, within 14
--                                      days)
--   3 · series_hours_blocked(w, s)     the series' hours projected over all
--                                      its days together, per Mon-Sun cap
--                                      week, through rota_guard_decide()
--   4 · auto_assign_candidates_pool()  the section's OWN pool - the
--                                      20261008120000 body plus ONE clause,
--                                      p_only, to judge named workers only
--   5 · series_gate_for(w, s)          the series gate for ONE worker,
--                                      without any pool scan
--       auto_assign_worker_gate(s, w)  pool row + series gate for ONE worker:
--                                      what a caller that judges one worker
--                                      reads
--       auto_assign_candidates()       the LIST: pool + series gate, for the
--                                      board and the auto-assign rounds
--   6 · invite_worker, accept_invite, apply_to_shift, accept_application,
--       take_offered_shift, staff_open_shifts, staff_open_offers: each
--       re-created from its LIVE body with the pool read changed (below)
--   7 · link_event_series(src, clone)  what Duplicate calls: sets series_id
--                                      on BOTH events
--
-- WHY THE CALLERS ARE RESTATED. authenticated runs under statement_timeout
-- = 8 s (20261012120000). A caller that reads the whole pool to judge one
-- worker (Accept, Radar apply, the office's Accept application, a take, an
-- invite) cannot also afford a sibling pool per day of the job. So those
-- callers read ONE row of the pool (p_only) and ask series_gate_for() about
-- that one worker, which evaluates every sibling's gates through the same
-- pool function for that one worker - the gate expressions exist once.
-- The seven callers are rewritten from their live bodies (pg_get_functiondef,
-- as 20261001203000 and 20261001215000 did), each pattern required to match
-- exactly once or the migration stops: a hand-copied body is how a shipped
-- rule gets dropped (docs/10 §3b), and several of these bodies have been
-- patched since the migration that last wrote them out.
-- Only the LIST consumers (the event board, the auto-assign rounds,
-- radar_wave1_exhausted / offer_candidates) call the wrapper.
--
-- WHY A WRAPPER AT ALL. The sibling check asks the same question of another
-- section. Done through the public function it would recurse (each sibling
-- would ask its own siblings), so the section's own gates live in
-- auto_assign_candidates_pool(), which knows nothing of series, and the
-- public name adds the series gate on top for lists. A LATER GATE therefore
-- belongs in auto_assign_candidates_pool(); redefining
-- auto_assign_candidates() would drop the series gate from the lists, and
-- re-creating one of the seven callers from an older body would drop it from
-- that path. pgTAP 804 fails in either case.
--
-- ENFORCED: a worker is a candidate for a flagged section only when, for
-- EVERY sibling, the pool has no gate for them (wrong role, blocked,
-- booked elsewhere incl. the 2 h different-venue gap, hours limit, right to
-- work, self-cancelled off that event, do-not-return, gender, language),
-- they have no availability-calendar entry over it, and the PROJECTED hours
-- of all the series' days together fit their weekly cap (RULE-20).
--
-- NOT ENFORCED (PROVISIONAL, awaiting the client - ADR-0117): one Accept
-- booking every day; withdrawing or cancelling one day cascading to the
-- others; the worker being told "all 3 days"; a per-event switch. A worker
-- who DECLINED a sibling day is not gated (only self-cancel is).
--
-- Additive and forward-only. No RLS change: events and shift_requirements
-- keep their policies; the client role holds no policy on either (ADR-0026,
-- 001_rls_guard) and the client_* views name their columns, so neither new
-- column reaches the client portal (pgTAP 804 asserts it).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The columns
-- ---------------------------------------------------------------------
alter table public.events
  add column if not exists series_id uuid;

comment on column public.events.series_id is
  'ADR-0117: links the days of one multi-day job. Set on BOTH events by link_event_series() when a Duplicate of an event with a "Same staff on all days" role is saved (a new random uuid when the source had none, else the source''s). Null = a single-day event. Not under the §3.2 edit lock; never exposed to the client portal.';

create index if not exists events_series_idx
  on public.events (series_id) where series_id is not null;

alter table public.shift_requirements
  add column if not exists same_staff_all_days boolean not null default false;

comment on column public.shift_requirements.same_staff_all_days is
  'ADR-0117: the client wants the SAME staff on every day of this job for this role. A worker may be invited to a section with this on only if they pass the hard gates, the availability calendar and the projected weekly hours for every sibling section (same series, same role, flag on, within 14 days) - gate not_available_all_days. Off by default; per role, not per event. A silent edit (nobody booked is re-asked or removed); not under the §3.2 edit lock, like required_gender.';

-- 20261001203000 replaced SELECT on this table with SELECT on every column
-- but the two rates; a column added since needs its own grant (753 asserts
-- the set column by column). anon and the client role hold no policy on the
-- table, so this reads no row for them.
grant select (same_staff_all_days) on public.shift_requirements to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2 · The siblings of a flagged section
--
-- Empty unless the section is itself flagged and its event is in a series.
-- Other events of the SAME series and CLIENT, the SAME role, the flag also
-- on, and starting within 14 days of this section (a series is a run of
-- days, not a standing arrangement). A cancelled event is not a day any
-- more, and a day that has already ended cannot be rostered (what the
-- worker really booked there is already in their week as a booking).
-- Invoker, like the pool: an office login or the service role sees the
-- sections.
-- ---------------------------------------------------------------------
create or replace function public.series_siblings(p_shift uuid)
returns table (
  shift_id  uuid,
  event_id  uuid,
  event_date date,
  starts_at timestamptz,
  ends_at   timestamptz,
  venue_id  uuid
)
language sql
stable
set search_path = public, extensions
as $$
  select sr2.id, ev2.id, ev2.event_date, sr2.starts_at, sr2.ends_at, ev2.venue_id
    from shift_requirements sr
    join events ev  on ev.id = sr.event_id
    join events ev2 on ev2.series_id = ev.series_id
                   and ev2.id <> ev.id
                   and ev2.client_id = ev.client_id
    join shift_requirements sr2 on sr2.event_id = ev2.id
   where sr.id = p_shift
     and sr.same_staff_all_days
     and ev.series_id is not null
     and ev2.cancelled_at is null
     and sr2.same_staff_all_days
     and sr2.role_id = sr.role_id
     and sr2.ends_at > now()
     and sr2.starts_at between sr.starts_at - interval '14 days' and sr.starts_at + interval '14 days'
$$;

comment on function public.series_siblings(uuid) is
  'ADR-0117: the sections a "Same staff on all days" section must also be fillable on - other events of the same series and client, same role, flag on, not cancelled, not yet ended, starting within 14 days of this section. Empty when the section is not flagged or not in a series. Mirrors seriesSiblings() in packages/domain/src/series.ts.';

-- ---------------------------------------------------------------------
-- 3 · The series' hours, projected, against the weekly cap
--
-- The section being judged and every sibling are grouped by the Mon-Sun
-- week each STARTS in (Europe/London - weekly_booked_hours()'s bucket) and
-- their hours summed. The worker's other commitments in that week are
-- counted WITHOUT any of the series' own sections, so a day they already
-- hold is counted once, as projected. Each week then goes through
-- rota_guard_decide() - the one decision weekly_cap_would_breach() uses -
-- so a Student visa band, a work visa limit and a right-to-work stop always
-- block, and a Working Time 48 blocks unless rota_guard_mode is 'warn'.
--
-- Three 8 h days in a student term week (cap 20) are blocked here although
-- each day alone fits. Mirrors projectSeriesWeeks() and seriesHoursBlocked()
-- in packages/domain/src/series.ts, held to series.vectors.json.
-- ---------------------------------------------------------------------
create or replace function public.series_hours_blocked(p_staff uuid, p_shift uuid)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  with days as (
    select sr.id as shift_id, sr.starts_at, sr.ends_at
      from shift_requirements sr
     where sr.id = p_shift
    union all
    select s.shift_id, s.starts_at, s.ends_at
      from series_siblings(p_shift) s
  ),
  wk as (
    select cap_week_start((d.starts_at at time zone 'Europe/London')::date)  as week_start,
           min((d.starts_at at time zone 'Europe/London')::date)             as first_day,
           sum(extract(epoch from (d.ends_at - d.starts_at)) / 3600.0)::numeric as hours,
           bool_and(can_roster_staff(p_staff, (d.starts_at at time zone 'Europe/London')::date)
                and can_roster_staff(p_staff, ((d.ends_at - interval '1 second')
                                               at time zone 'Europe/London')::date)) as can_roster
      from days d
     group by 1
  )
  select coalesce(bool_or(g.verdict = 'block'), false)
    from wk
    cross join lateral weekly_cap_for(p_staff, wk.first_day) c
    cross join lateral (
      select coalesce(sum(extract(epoch from (sr.ends_at - sr.starts_at)) / 3600.0), 0)::numeric as booked
        from bookings b
        join shift_requirements sr on sr.id = b.shift_id
       where b.staff_id = p_staff
         and booking_counts_toward_cap(b.status, b.cancelled_at, b.cancel_cause)
         and sr.id not in (select shift_id from days)
         and (sr.starts_at at time zone 'Europe/London')::date
             between wk.week_start and wk.week_start + 6
    ) bk
    cross join lateral rota_guard_decide(wk.can_roster, c.cap_hours, c.band, bk.booked, wk.hours,
                                         rota_guard_mode()) g
$$;

comment on function public.series_hours_blocked(uuid, uuid) is
  'ADR-0117: would the hours of this section PLUS every flagged sibling, projected together per Mon-Sun cap week, be blocked by the rota guard (RULE-20)? The worker''s other bookings count; the series'' own sections are counted once, as projected. Three 8 h days in a student-visa term week are blocked though each fits alone. A warn verdict (Working Time 48 in warn mode) does not block, exactly as weekly_cap_would_breach(). Mirrors seriesHoursBlocked() in packages/domain/src/series.ts.';

-- ---------------------------------------------------------------------
-- 4 · The section's own pool, with a worker filter
--
-- auto_assign_candidates(uuid, boolean) becomes auto_assign_candidates_pool
-- (uuid, boolean, uuid[]): 20261008120000's body, with ONE added predicate
-- (p_only). The old two-argument function is dropped and the public name
-- is re-created below as the series-aware list.
-- ---------------------------------------------------------------------
drop function public.auto_assign_candidates(uuid, boolean);

create or replace function public.auto_assign_candidates_pool(
  p_shift      uuid,
  -- §3.4 same-day escalation: also gate anyone whose home is not within
  -- escalation_radius_miles() of the venue. Default false = the ordinary
  -- pool, unchanged, for every caller that existed before 20260927140100.
  p_escalation boolean default false,
  -- 20261012140000 (ADR-0117): judge only these workers. Null = the whole
  -- pool, as before. A caller that reads the pool to judge ONE worker
  -- passes array[that worker] and pays for one row, not a thousand; the
  -- gates are the same expressions either way.
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
  -- (3) appended 20260930110000: this section's own booking's cause.
  booking_cause  text
) language sql stable
set search_path = public, extensions
as $$
  with sec as (
    select sr.id as shift_id, sr.role_id, sr.starts_at, sr.ends_at, sr.required_gender,
           ev.id as event_id, ev.client_id, ev.venue_id, ev.venue_location,
           -- ADR-0080: the languages the event needs besides English, which
           -- is never gated — everyone THC books speaks it.
           array_remove(ev.required_languages, 'English') as extra_languages
    from shift_requirements sr join events ev on ev.id = sr.event_id
    where sr.id = p_shift
  ),
  gap as (select booked_elsewhere_gap_minutes() as mins),
  -- One statute mile is 1,609.344 m; geography distances are metres.
  rad as (select case when p_escalation then escalation_radius_miles() * 1609.344 end as metres)
  select
    s.id,
    case
      when not exists (select 1 from staff_roles sro
                        where sro.staff_id = s.id and sro.role_id = sec.role_id) then 'wrong_role'
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
      when exists (select 1 from bookings b
                     join shift_requirements sr2 on sr2.id = b.shift_id
                    where b.staff_id = s.id and sr2.event_id = sec.event_id
                      and b.self_cancelled)                                     then 'self_cancelled'
      -- (1) §3.4 "only the worker's other CONFIRMED bookings count" — and a
      -- checked-in booking is a confirmed one (20260930110000, D2).
      when exists (
             select 1 from bookings b
               join shift_requirements sr2 on sr2.id = b.shift_id
               join events ev2 on ev2.id = sr2.event_id
              where b.staff_id = s.id and b.status in ('confirmed', 'worked')
                and b.shift_id <> sec.shift_id
                and booked_elsewhere_conflict(sec.starts_at, sec.ends_at, sec.venue_id,
                                              sr2.starts_at, sr2.ends_at, ev2.venue_id,
                                              gap.mins) <> 'clear')             then 'booked_elsewhere'
      -- RULE-20 and the right-to-work stop share one gate, but not one
      -- label: a worker past their right to work is not "over their
      -- hours" and the board must not say so (20260924130100).
      when weekly_cap_would_breach(s.id, sec.shift_id) then
        case when not (can_roster_staff(s.id, (sec.starts_at at time zone 'Europe/London')::date)
                       and can_roster_staff(s.id, ((sec.ends_at - interval '1 second')
                                                   at time zone 'Europe/London')::date))
             then 'rtw_expired'
             else 'hours_limit' end
      -- §3.4 same-day escalation only: "within a 3-mile radius of the
      -- venue". No home on file cannot be shown to be inside it.
      when rad.metres is not null
           and (s.home_location is null
                or not st_dwithin(s.home_location, sec.venue_location, rad.metres)) then 'outside_radius'
      else null
    end as gate,
    exists (select 1 from client_qualifications cq
             where cq.staff_id = s.id and cq.client_id = sec.client_id
               and cq.role_id = sec.role_id and not cq.do_not_return) as qualified,
    mine.status as booking_status,
    -- §6 show-rate, derived from the worker's history (20260928110100);
    -- 90 with no history is the formula's zero point, as before.
    coalesce(staff_show_rate(s.id), 90)::numeric,
    coalesce(s.rating, 4.0)::numeric,
    coalesce(st_distance(s.home_location, sec.venue_location) / 1000.0, 9999)::numeric,
    (select count(*) from bookings b join shift_requirements sr3 on sr3.id = b.shift_id
      where b.staff_id = s.id and b.status = 'confirmed' and sr3.starts_at > now())::int,
    (select count(*) from bookings b
       join shift_requirements sr4 on sr4.id = b.shift_id
       join events ev4 on ev4.id = sr4.event_id
      where b.staff_id = s.id and b.status = 'worked' and ev4.venue_id = sec.venue_id)::int,
    mine.cancel_cause as booking_cause
  from staff s cross join sec cross join gap cross join rad
  -- (3) This section's own booking, read once for its status and cause.
  -- bookings is unique on (shift_id, staff_id), so at most one row.
  left join lateral (
    select b.status::text as status, b.cancel_cause
      from bookings b
     where b.shift_id = sec.shift_id and b.staff_id = s.id
  ) mine on true
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
    -- 20261012140000: the one clause this migration adds to the pool.
    and (p_only is null or s.id = any (p_only))
$$;


comment on function public.auto_assign_candidates_pool(uuid, boolean, uuid[]) is
  'The section''s OWN §3.3/§3.4 pool (the body of auto_assign_candidates as of 20261008120000), with no knowledge of series, optionally restricted to named workers (p_only: a caller that judges ONE worker passes array[worker] and pays for one row). Call auto_assign_worker_gate() for one worker and auto_assign_candidates() for a list; both add the "Same staff on all days" gate (ADR-0117). A new gate on the section itself belongs HERE. EXECUTE stays granted to authenticated and service_role - never to anon or PUBLIC - because the invoker wrappers run as the caller: the event board calls auto_assign_candidates() as an office (admin) session and that must reach this function. Gates: wrong_role, male_only / female_only / gender_not_recorded (ADR-0079), languages_not_recorded / language_not_spoken (ADR-0080), do_not_return, blocked, self_cancelled, booked_elsewhere, rtw_expired, hours_limit, and - only with p_escalation - outside_radius.';

revoke execute on function public.auto_assign_candidates_pool(uuid, boolean, uuid[]) from public, anon;
grant  execute on function public.auto_assign_candidates_pool(uuid, boolean, uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5 · The series gate
--
-- series_gate_for(): ONE worker against ONE flagged section's siblings.
-- Cheap: for each sibling the pool is asked about that worker alone
-- (p_only), so no pool scan, no matter how many days the job has. Null when
-- the section has no siblings (not flagged, single day, or no live other
-- day), which is also the answer that costs one cheap lookup.
-- ---------------------------------------------------------------------
create or replace function public.series_gate_for(p_staff uuid, p_shift uuid)
returns text
language sql
stable
set search_path = public, extensions
as $$
  select case
    when not exists (select 1 from series_siblings(p_shift)) then null
    -- a hard gate on another day: the sibling's own pool, for this worker
    when exists (select 1
                   from series_siblings(p_shift) sib
                  cross join lateral auto_assign_candidates_pool(sib.shift_id, false, array[p_staff]) c
                  where c.gate is not null)                          then 'not_available_all_days'
    -- the availability calendar over another day
    when exists (select 1
                   from series_siblings(p_shift) sib
                   join staff_unavailability u on u.staff_id = p_staff
                    and sib.ends_at > sib.starts_at
                    and u.period && tstzrange(sib.starts_at, sib.ends_at, '[)'))
                                                                     then 'not_available_all_days'
    -- all the days' hours together against the weekly cap
    when series_hours_blocked(p_staff, p_shift)                      then 'not_available_all_days'
    else null
  end
$$;

comment on function public.series_gate_for(uuid, uuid) is
  'ADR-0117: not_available_all_days when this ONE worker fails a hard gate (the pool''s own, evaluated for them alone), has a calendar entry, or exceeds the projected weekly hours on any sibling of this flagged section; null otherwise and when there are no siblings. Costs a few single-row lookups per sibling - never a pool scan. What invite_worker, Accept, apply, take and Radar ask. Mirrors seriesGate() in packages/domain/src/series.ts.';

-- ONE worker: the pool's row (gate, qualified, booking_status) with the
-- series gate applied when the pool has no gate of its own. No row = not a
-- worker / left / removed, exactly as the old `where staff_id = x` read.
create or replace function public.auto_assign_worker_gate(
  p_shift      uuid,
  p_staff      uuid,
  p_escalation boolean default false
)
returns table (gate text, qualified boolean, booking_status text)
language sql
stable
set search_path = public, extensions
as $$
  select case when c.gate is not null then c.gate
              else series_gate_for(p_staff, p_shift) end,
         c.qualified,
         c.booking_status
    from auto_assign_candidates_pool(p_shift, p_escalation, array[p_staff]) c
$$;

comment on function public.auto_assign_worker_gate(uuid, uuid, boolean) is
  'ADR-0117: what a caller that judges ONE worker reads - that worker''s row of the section''s pool (one row, not a scan) with not_available_all_days when the pool has no gate of its own and a sibling day refuses them. Zero rows when the pool has none (a leaver, a removed account, a non-worker). invite_worker, accept_invite, apply_to_shift, accept_application, take_offered_shift and staff_open_offers read this.';

revoke execute on function public.auto_assign_worker_gate(uuid, uuid, boolean) from public, anon;
grant  execute on function public.auto_assign_worker_gate(uuid, uuid, boolean) to authenticated, service_role;
revoke execute on function public.series_gate_for(uuid, uuid) from public, anon;
grant  execute on function public.series_gate_for(uuid, uuid) to authenticated, service_role;
revoke execute on function public.series_siblings(uuid)            from public, anon;
grant  execute on function public.series_siblings(uuid)            to authenticated, service_role;
revoke execute on function public.series_hours_blocked(uuid, uuid) from public, anon;
grant  execute on function public.series_hours_blocked(uuid, uuid) to authenticated, service_role;

-- THE LIST: every worker, for the event board and the auto-assign rounds.
create or replace function public.auto_assign_candidates(
  p_shift      uuid,
  p_escalation boolean default false
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
) language sql stable
set search_path = public, extensions
as $$
  with own as (
    select * from auto_assign_candidates_pool(p_shift, p_escalation)
  ),
  sib as (
    select * from series_siblings(p_shift)
  ),
  -- Only workers the section's own gates left standing need the sibling
  -- days asked about them.
  cand as (
    select coalesce(array_agg(o.staff_id), array[]::uuid[]) as ids from own o where o.gate is null
  ),
  -- Barred by another day, computed ONCE per sibling over the candidates -
  -- never per worker. The sibling is judged as an ordinary day (no
  -- escalation radius: the radius is about the day the shift starts):
  --   · the sibling's own pool gate;
  --   · an availability-calendar entry over the sibling ([starts, ends),
  --     half-open like the rest of ADR-0043).
  barred as (
    select c.staff_id
      from sib
     cross join cand
     cross join lateral auto_assign_candidates_pool(sib.shift_id, false, cand.ids) c
     where c.gate is not null
    union
    select u.staff_id
      from sib
      join staff_unavailability u
        on sib.ends_at > sib.starts_at
       and u.period && tstzrange(sib.starts_at, sib.ends_at, '[)')
  ),
  has_sib as (
    select exists (select 1 from sib) as on_
  )
  select p.staff_id,
         case
           -- The section's own gate always wins: the truer reason.
           when p.gate is not null then p.gate
           when h.on_ then
             -- Nested, so the per-worker hours projection is only computed
             -- for a worker nothing else has barred.
             case
               when p.staff_id in (select b.staff_id from barred b) then 'not_available_all_days'
               when series_hours_blocked(p.staff_id, p_shift)       then 'not_available_all_days'
               else null
             end
           else null
         end,
         p.qualified, p.booking_status, p.reliability, p.rating, p.distance_km,
         p.future_shifts, p.venue_times, p.booking_cause
    from own p
   cross join has_sib h
$$;

comment on function public.auto_assign_candidates(uuid, boolean) is
  'The §3.3/§3.4 pool for one role section as a LIST: auto_assign_candidates_pool() plus, since 20261012140000 (ADR-0117), the gate not_available_all_days on a section marked "Same staff on all days" - a worker who fails a hard gate, has a calendar entry, or would exceed their weekly cap (projected over all the series'' days together) on ANY sibling section. The section''s own gate always wins; the series gate is the last. For the event board, the auto-assign rounds and the wave checks. A caller that judges ONE worker must read auto_assign_worker_gate() instead: this function costs one pool scan per sibling day, and authenticated runs under statement_timeout = 8 s. Do not redefine this function to add a gate: add it to auto_assign_candidates_pool().';

revoke execute on function public.auto_assign_candidates(uuid, boolean) from public, anon;
grant  execute on function public.auto_assign_candidates(uuid, boolean) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 6 · The callers that judge one worker
--
-- Re-created from their LIVE bodies with the pool read changed, the way
-- 20261001203000 and 20261001215000 did it (docs/10 §3b: a hand-copied body
-- is how a shipped rule gets dropped - several of these have been patched
-- since the migration that last wrote them out, staff_open_shifts and
-- staff_open_offers for the worker's own pay rate among them). Each pattern
-- must match exactly once or the migration stops. Security, search_path,
-- grants and comments are untouched (create or replace keeps them; the
-- security and search_path are in the definition itself).
--
--   invite_worker, accept_invite, apply_to_shift, accept_application,
--   take_offered_shift, staff_open_offers
--       the single-worker read of the pool becomes auto_assign_worker_gate()
--       (take_offered_shift also names the new gate in its refusal map);
--   staff_open_shifts
--       Radar keeps its whole-pool read for RULE-17's wave check (now the
--       section's own pool) and adds the series gate for the viewing worker
--       on a flagged section only.
-- ---------------------------------------------------------------------
do $$
declare
  p     record;
  v_def text;
  v_n   int;
begin
  for p in
    select * from (values
      ('public.invite_worker(uuid, uuid, booking_source, boolean)'::regprocedure,
       'select gate into v_gate\s+from auto_assign_candidates\(p_shift, p_source = ''escalation''\)\s+where staff_id = p_staff;',
       'select gate into v_gate from auto_assign_worker_gate(p_shift, p_staff, p_source = ''escalation'');'),

      ('public.accept_invite(uuid)'::regprocedure,
       'select c\.gate into v_gate\s+from auto_assign_candidates\(sr\.id, b\.source = ''escalation''\) c\s+where c\.staff_id = b\.staff_id;',
       'select c.gate into v_gate from auto_assign_worker_gate(sr.id, b.staff_id, b.source = ''escalation'') c;'),

      ('public.apply_to_shift(uuid, uuid)'::regprocedure,
       'select gate into v_gate from auto_assign_candidates\(p_shift\) where staff_id = v_me;',
       'select gate into v_gate from auto_assign_worker_gate(p_shift, v_me);'),

      ('public.accept_application(uuid)'::regprocedure,
       'select c\.gate into v_gate from auto_assign_candidates\(sr\.id\) c where c\.staff_id = b\.staff_id;',
       'select c.gate into v_gate from auto_assign_worker_gate(sr.id, b.staff_id) c;'),

      ('public.take_offered_shift(uuid)'::regprocedure,
       'select c\.gate, c\.qualified into v_gate, v_qualified\s+from auto_assign_candidates\(sr\.id\) c\s+where c\.staff_id = v_me;',
       'select c.gate, c.qualified into v_gate, v_qualified from auto_assign_worker_gate(sr.id, v_me) c;'),
      ('public.take_offered_shift(uuid)'::regprocedure,
       'when ''hours_limit'' then v_gate\s+else ''not_bookable''',
       'when ''hours_limit'' then v_gate when ''not_available_all_days'' then v_gate else ''not_bookable'''),

      ('public.staff_open_offers(uuid)'::regprocedure,
       'from auto_assign_candidates\(sr\.id\) a\s+where a\.staff_id = me\.id',
       'from auto_assign_worker_gate(sr.id, me.id) a'),

      ('public.staff_open_shifts(uuid)'::regprocedure,
       'min\(a\.gate\)\s+filter \(where a\.staff_id = me\.id\) as my_gate,',
       'coalesce(min(a.gate) filter (where a.staff_id = me.id), case when sr.same_staff_all_days then series_gate_for(me.id, sr.id) end) as my_gate,'),
      ('public.staff_open_shifts(uuid)'::regprocedure,
       'from auto_assign_candidates\(sr\.id\) a\s+\) c',
       'from auto_assign_candidates_pool(sr.id) a ) c')
    ) as x(fn, pattern, replacement)
  loop
    v_def := pg_get_functiondef(p.fn);
    select count(*) into v_n from regexp_matches(v_def, p.pattern, 'g');
    if v_n <> 1 then
      raise exception '20261012140000: % - expected one match of %, found %', p.fn, p.pattern, v_n;
    end if;
    execute regexp_replace(v_def, p.pattern, p.replacement);
  end loop;
end;
$$;


-- ---------------------------------------------------------------------
-- Comments: what the restated callers now do, and what this supersedes
--
-- ADR-0043 said the availability calendar never gates a manual invite, an
-- Accept, an apply or a take. That still holds for the section's OWN day.
-- For another day of a same-staff-all-days job it no longer does: it is the
-- gate not_available_all_days (ADR-0117). The old comments are not edited
-- (applied migrations); the notes are appended here.
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  v_note constant text :=
    ' SUPERSEDED FOR SERIES SIBLINGS by 20261012140000 (ADR-0117): on a section marked "Same staff on all days", a worker who fails a hard gate, has a calendar entry or exceeds the projected weekly hours on another day of the job is refused not_available_all_days, for every source (a manual invite, an Accept, an apply and a take included).';
begin
  for r in
    select * from (values
      ('public.invite_worker(uuid, uuid, booking_source, boolean)'::regprocedure, v_note),
      ('public.accept_invite(uuid)'::regprocedure, v_note),
      ('public.apply_to_shift(uuid, uuid)'::regprocedure, v_note),
      ('public.accept_application(uuid)'::regprocedure, v_note),
      ('public.take_offered_shift(uuid)'::regprocedure, v_note),
      ('public.staff_unavailable(uuid, timestamptz, timestamptz)'::regprocedure, v_note),
      ('public.staff_open_shifts(uuid)'::regprocedure,
       ' Since 20261012140000 (ADR-0117) a section marked "Same staff on all days" is left off the Radar of a worker another day of the job refuses (series_gate_for, one worker, no sibling pool).'),
      ('public.staff_open_offers(uuid)'::regprocedure,
       ' Since 20261012140000 (ADR-0117) a section marked "Same staff on all days" is left off the Radar of a worker another day of the job refuses (auto_assign_worker_gate).')
    ) x(fn, note)
  loop
    execute format('comment on function %s is %L', r.fn,
                   coalesce(obj_description(r.fn::oid, 'pg_proc'), '') || r.note);
  end loop;

  execute format('comment on table public.staff_unavailability is %L',
                 coalesce(obj_description('public.staff_unavailability'::regclass, 'pg_class'), '') || v_note);
end $$;

-- ---------------------------------------------------------------------
-- 7 · Duplicate links the days
--
-- Called by the Shift Builder's createEvent - only when the source event has
-- a "Same staff on all days" role - right after the clone's row is written
-- and BEFORE its sections and its first auto-assign round, so the first
-- round already sees the series. Sets series_id on BOTH events: the
-- source's own when it has one, else a new random uuid. Idempotent for a
-- clone already in that series; refuses a clone that belongs to another
-- one, an event of another client, an event linked to itself, and a clone
-- that is not new (it must have no bookings and have been created within
-- the last hour: a live, staffed event cannot be pulled into a series).
-- ---------------------------------------------------------------------
create or replace function public.link_event_series(p_source uuid, p_clone uuid)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  src      events;
  cln      events;
  v_series uuid;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if p_source is null or p_clone is null or p_source = p_clone then
    raise exception 'series_needs_two_events' using errcode = 'P0001';
  end if;

  -- Both rows, in id order, so two Duplicates of one source cannot each
  -- invent a series for it.
  perform 1 from events where id in (p_source, p_clone) order by id for update;
  select * into src from events where id = p_source;
  select * into cln from events where id = p_clone;
  if src.id is null or cln.id is null then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;
  if src.client_id is distinct from cln.client_id then
    raise exception 'series_other_client' using errcode = 'P0001',
      detail = 'The days of one job belong to one client.';
  end if;
  if cln.series_id is not null and cln.series_id is distinct from src.series_id then
    raise exception 'series_clone_already_linked' using errcode = 'P0001';
  end if;

  -- Already linked to this very series: nothing to do, nothing to audit.
  if cln.series_id is not null and cln.series_id = src.series_id then
    return cln.series_id;
  end if;

  -- A clone is the event the Shift Builder has just saved. A live, staffed
  -- or old event is not.
  if cln.created_at < now() - interval '1 hour'
     or exists (select 1
                  from bookings b
                  join shift_requirements sr on sr.id = b.shift_id
                 where sr.event_id = cln.id) then
    raise exception 'series_clone_not_new' using errcode = 'P0001',
      detail = 'Only an event that has just been created, with nobody booked on it, can be linked as the next day of a job.';
  end if;

  v_series := coalesce(src.series_id, gen_random_uuid());
  if src.series_id is distinct from v_series then
    update events set series_id = v_series where id = src.id;
  end if;
  update events set series_id = v_series where id = cln.id;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'event.series_linked', 'event', cln.id,
          jsonb_build_object('source', src.id, 'seriesId', v_series));

  return v_series;
end $$;

comment on function public.link_event_series(uuid, uuid) is
  'ADR-0117: Duplicate links the days of a multi-day job (only when the source has a "Same staff on all days" role - the caller decides). Sets events.series_id on BOTH the source and the clone - the source''s own when it has one, else a new random uuid. Office logins only (a viewer is refused by the read-only guard); one client; idempotent; refuses a clone already in another series and a clone that is not new (created over an hour ago, or with anybody booked). Staff are still not copied (§3.2).';

revoke execute on function public.link_event_series(uuid, uuid) from public, anon;
grant  execute on function public.link_event_series(uuid, uuid) to authenticated, service_role;
