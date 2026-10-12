-- =====================================================================
-- Migration 20261012140000 · "Same staff on all days" (ADR-0116)
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
--                                      also be fillable on
--   3 · series_hours_blocked(w, s)     the series' hours projected over all
--                                      its days together, per Mon-Sun cap
--                                      week, through rota_guard_decide()
--   4 · auto_assign_candidates()       now a thin wrapper over
--                                      auto_assign_candidates_pool() (the
--                                      renamed 20261008120000 body, byte for
--                                      byte) that adds ONE gate,
--                                      'not_available_all_days'
--   5 · link_event_series(src, clone)  what Duplicate calls: sets series_id
--                                      on BOTH events
--
-- WHY A WRAPPER, AND WHY THE RENAME. The sibling check has to ask the SAME
-- question of another section (does this worker pass every hard gate
-- there?). Doing that inside auto_assign_candidates would recurse - each
-- sibling pool would ask its own siblings - so the section's own gates live
-- in auto_assign_candidates_pool(), which knows nothing of series, and the
-- public name adds the series gate on top. Every consumer of the pool - the
-- hourly and escalation rounds, invite_worker (its refusal IS the gate), the
-- event board, Radar, apply, accept_invite, accept_application and the offer
-- take - inherits it without being restated, so none of them can drop it.
-- A LATER GATE therefore belongs in auto_assign_candidates_pool(); a
-- `create or replace function auto_assign_candidates` would replace this
-- wrapper and silently drop the series gate. pgTAP 790 fails if that happens.
--
-- ENFORCED: a worker is a candidate for a flagged section only when, for
-- EVERY sibling (same series, same role, flag on, event not cancelled, not
-- yet ended), the pool has no gate for them (wrong role, blocked, booked
-- elsewhere incl. the 2 h different-venue gap, hours limit, right to work,
-- self-cancelled off that event, do-not-return, gender, language), they
-- have no availability-calendar entry over it, and the PROJECTED hours of
-- all the series' days together fit their weekly cap (RULE-20).
--
-- NOT ENFORCED (PROVISIONAL, awaiting the client - ADR-0116): one Accept
-- booking every day; withdrawing or cancelling one day cascading to the
-- others; the worker being told "all 3 days"; a per-event switch. A worker
-- who DECLINED a sibling day is not gated (only self-cancel is).
--
-- Additive and forward-only. No RLS change: events and shift_requirements
-- keep their policies; the client role holds no policy on either (ADR-0026,
-- 001_rls_guard) and the client_* views name their columns, so neither new
-- column reaches the client portal (pgTAP 790 asserts it).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The columns
-- ---------------------------------------------------------------------
alter table public.events
  add column if not exists series_id uuid;

comment on column public.events.series_id is
  'ADR-0116: links the days of one multi-day job. Set on BOTH events by link_event_series() when Duplicate is used (a new random uuid when the source had none, else the source''s). Null = a single-day event. Not under the §3.2 edit lock; never exposed to the client portal.';

create index if not exists events_series_idx
  on public.events (series_id) where series_id is not null;

alter table public.shift_requirements
  add column if not exists same_staff_all_days boolean not null default false;

comment on column public.shift_requirements.same_staff_all_days is
  'ADR-0116: the client wants the SAME staff on every day of this job for this role. A worker may be invited to a section with this on only if they pass the hard gates, the availability calendar and the projected weekly hours for every sibling section (same series, same role, flag on) - gate not_available_all_days. Off by default; per role, not per event. A silent edit (nobody booked is re-asked or removed); not under the §3.2 edit lock, like required_gender.';

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
-- on. A cancelled event is not a day any more, and a day that has already
-- ended cannot be rostered (what the worker really booked there is already
-- in their week as a booking). Invoker, like the pool: an office login or
-- the service role sees the sections; a worker's session sees what RLS lets
-- it, and is never the caller that matters here.
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
$$;

comment on function public.series_siblings(uuid) is
  'ADR-0116: the sections a "Same staff on all days" section must also be fillable on - other events of the same series and client, same role, flag on, not cancelled, not yet ended. Empty when the section is not flagged or not in a series. Mirrors seriesSiblings() in packages/domain/src/series.ts.';

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
  'ADR-0116: would the hours of this section PLUS every flagged sibling, projected together per Mon-Sun cap week, be blocked by the rota guard (RULE-20)? The worker''s other bookings count; the series'' own sections are counted once, as projected. Three 8 h days in a student-visa term week are blocked though each fits alone. A warn verdict (Working Time 48 in warn mode) does not block, exactly as weekly_cap_would_breach(). Mirrors seriesHoursBlocked() in packages/domain/src/series.ts.';

-- ---------------------------------------------------------------------
-- 4 · The pool, split: the section's own gates, then the series gate
--
-- auto_assign_candidates(uuid, boolean) becomes auto_assign_candidates_pool
-- (20261008120000's body, untouched, grants and comment travel with the
-- object). The public name is a wrapper returning the same eleven columns.
-- ---------------------------------------------------------------------
alter function public.auto_assign_candidates(uuid, boolean)
  rename to auto_assign_candidates_pool;

comment on function public.auto_assign_candidates_pool(uuid, boolean) is
  'The section''s OWN §3.3/§3.4 pool (the body of auto_assign_candidates as of 20261008120000), with no knowledge of series. Call auto_assign_candidates(), which adds the "Same staff on all days" gate (ADR-0116), everywhere except a sibling check. A new gate on the section itself belongs HERE: redefining auto_assign_candidates() replaces the wrapper and drops the series gate. Gates: wrong_role, male_only / female_only / gender_not_recorded (ADR-0079), languages_not_recorded / language_not_spoken (ADR-0080), do_not_return, blocked, self_cancelled, booked_elsewhere, rtw_expired, hours_limit, and - only with p_escalation - outside_radius.';

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
  with sib as (
    select * from series_siblings(p_shift)
  ),
  -- Barred by another day, computed ONCE per sibling over its whole pool -
  -- never per worker. The sibling is judged as an ordinary day (no
  -- escalation radius: the radius is about the day the shift starts):
  --   · the sibling's own pool gate (wrong role, blocked, booked elsewhere
  --     with the 2 h gap, hours limit, right to work, self-cancelled off
  --     that event, do-not-return, gender, language);
  --   · an availability-calendar entry over the sibling (staff_unavailable:
  --     [starts, ends), half-open like the rest of ADR-0043).
  barred as (
    select c.staff_id
      from sib
     cross join lateral auto_assign_candidates_pool(sib.shift_id, false) c
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
    from auto_assign_candidates_pool(p_shift, p_escalation) p
   cross join has_sib h
$$;

comment on function public.auto_assign_candidates(uuid, boolean) is
  'The §3.3/§3.4 pool for one role section: auto_assign_candidates_pool() plus, since 20261012140000 (ADR-0116), the gate not_available_all_days on a section marked "Same staff on all days" - a worker who fails a hard gate, has a calendar entry, or would exceed their weekly cap (projected over all the series'' days together) on ANY sibling section. The section''s own gate always wins; the series gate is the last. invite_worker, the rounds, the board, Radar, apply, Accept and the offer take all read this function, so they all refuse by that name. Do not redefine this function to add a gate: add it to auto_assign_candidates_pool().';

revoke execute on function public.auto_assign_candidates(uuid, boolean) from public, anon;
grant  execute on function public.auto_assign_candidates(uuid, boolean) to authenticated, service_role;

revoke execute on function public.series_siblings(uuid)            from public, anon;
grant  execute on function public.series_siblings(uuid)            to authenticated, service_role;
revoke execute on function public.series_hours_blocked(uuid, uuid) from public, anon;
grant  execute on function public.series_hours_blocked(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5 · Duplicate links the days
--
-- Called by the Shift Builder's createEvent right after the clone's row is
-- written and BEFORE its sections and its first auto-assign round, so the
-- first round already sees the series. Sets series_id on BOTH events: the
-- source's own when it has one, else a new random uuid. Idempotent for a
-- clone already in that series; refuses a clone that belongs to another one,
-- an event of another client, and linking an event to itself.
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

  v_series := coalesce(src.series_id, gen_random_uuid());
  if src.series_id is distinct from v_series then
    update events set series_id = v_series where id = src.id;
  end if;
  -- Already linked: nothing changed, nothing to audit.
  if cln.series_id is distinct from v_series then
    update events set series_id = v_series where id = cln.id;
    insert into audit_log (at, actor, action, entity, entity_id, data)
    values (now(), auth.uid(), 'event.series_linked', 'event', cln.id,
            jsonb_build_object('source', src.id, 'seriesId', v_series));
  end if;

  return v_series;
end $$;

comment on function public.link_event_series(uuid, uuid) is
  'ADR-0116: Duplicate links the days of a multi-day job. Sets events.series_id on BOTH the source and the clone - the source''s own when it has one, else a new random uuid. Office logins only (a viewer is refused by the read-only guard); one client; idempotent; refuses a clone already in another series. Staff are still not copied (§3.2).';

revoke execute on function public.link_event_series(uuid, uuid) from public, anon;
grant  execute on function public.link_event_series(uuid, uuid) to authenticated, service_role;
