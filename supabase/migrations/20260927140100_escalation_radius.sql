-- =====================================================================
-- Same-day escalation reads its radius (§3.4, §7)
--
-- docs/15 §3: "Same-day escalation ignores the 3-mile radius (verified).
-- `escalation_radius_miles` is editable on /settings but nothing reads it."
--
-- §3.4: once a shift has started, the escalation job "widens the invite
-- pool to every worker qualified for that role within a 3-mile radius of
-- the venue, ignoring the event's original headcount + buffer cap … once
-- people are already working short-handed, an hour is useless, and
-- proximity to the venue matters more than the match score." The cap half
-- was built (invite_worker's p_ignore_target, 20260921141500). The radius
-- half was not, so a Tuesday-evening shortfall at a London hotel could
-- invite somebody who lives in Leeds.
--
-- What changes
-- ------------
-- 1. escalation_radius_miles() reads settings.escalation_radius_miles
--    (0001_init seeds 3; /settings edits it). Anything unusable in the row
--    falls back to 3, the scope's own figure, rather than failing the job.
--
-- 2. auto_assign_candidates gains ONE defaulted parameter, p_escalation.
--    With it false — the default, and every existing caller: the event
--    board, Radar, apply_to_shift, accept_application, invite_worker's
--    hourly path — it returns exactly what it returned before, row for row
--    and gate for gate. With it true, a worker who passes every other gate
--    but whose home is not within the radius of the venue is gated
--    `outside_radius`. A worker with no home location on file cannot be
--    shown to be within it, and is gated the same way.
--
--    It is a gate, not a filter, for the reason every other bar is: the
--    engine skips gated rows (rankPool), and anyone asking why a person
--    was not called can see the reason. It sits LAST in the precedence, so
--    a worker who is also blocked or over their hours still shows that.
--
--    Qualified-first survives unchanged: §3.4 says "qualified workers
--    inside the radius are called before unqualified ones", and the
--    `qualified` column still drives the two waves in selectInvitees().
--
-- 3. invite_worker re-applies the radius when p_source = 'escalation', the
--    same way it re-applies every other gate at the insert — so a pool read
--    a minute earlier cannot put someone outside the radius on the shift.
--
-- 4. supabase/functions/auto-staffing, escalation mode, now asks for the
--    escalation pool and writes source = 'escalation'. That enum value has
--    existed since 0001_init and the seed and 170 already use it for the
--    replacement confirmed after the start; the engine was the one writer
--    that said 'auto' instead.
--
-- Why DROP and not CREATE OR REPLACE
-- ----------------------------------
-- A new parameter is a new signature. Replacing would leave the one-
-- argument function in place beside the two-argument one, and every
-- `auto_assign_candidates(p_shift)` call — the board, Radar, invite_worker
-- — would then fail with "function is not unique", because both match.
-- Dropping first leaves one function that answers both call shapes. The
-- callers are PL/pgSQL and SQL bodies resolved at call time, so nothing
-- holds a dependency on the old oid; PostgREST's rpc() fills the default.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The radius, from settings
-- ---------------------------------------------------------------------
create or replace function public.escalation_radius_miles()
returns numeric
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(
    (select case when (value #>> '{}') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
                      and (value #>> '{}')::numeric > 0
                 then (value #>> '{}')::numeric end
       from settings where key = 'escalation_radius_miles'),
    3)
$$;

comment on function public.escalation_radius_miles() is
  '§3.4 same-day escalation radius in miles: settings.escalation_radius_miles (a number, or a numeric string), 3 when missing or unusable (20260927140100).';

-- ---------------------------------------------------------------------
-- 2 · The pool, with an escalation mode
--
-- Byte-for-byte 20260924130100 but for the parameter, the `rad` CTE and
-- the last branch of the gate.
-- ---------------------------------------------------------------------
drop function if exists public.auto_assign_candidates(uuid);

create or replace function public.auto_assign_candidates(
  p_shift      uuid,
  -- §3.4 same-day escalation: also gate anyone whose home is not within
  -- escalation_radius_miles() of the venue. Default false = the ordinary
  -- pool, unchanged, for every caller that existed before 20260927140100.
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
  venue_times    int
) language sql stable
set search_path = public, extensions
as $$
  with sec as (
    select sr.id as shift_id, sr.role_id, sr.starts_at, sr.ends_at,
           ev.id as event_id, ev.client_id, ev.venue_id, ev.venue_location
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
      when exists (select 1 from client_qualifications cq
                    where cq.staff_id = s.id and cq.client_id = sec.client_id
                      and cq.do_not_return)                                     then 'do_not_return'
      when s.status <> 'compliant'                                              then 'blocked'
      when exists (select 1 from bookings b
                     join shift_requirements sr2 on sr2.id = b.shift_id
                    where b.staff_id = s.id and sr2.event_id = sec.event_id
                      and b.self_cancelled)                                     then 'self_cancelled'
      when exists (
             select 1 from bookings b
               join shift_requirements sr2 on sr2.id = b.shift_id
               join events ev2 on ev2.id = sr2.event_id
              where b.staff_id = s.id and b.status = 'confirmed' and b.shift_id <> sec.shift_id
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
    (select b.status::text from bookings b
      where b.shift_id = sec.shift_id and b.staff_id = s.id) as booking_status,
    coalesce(s.reliability, 90)::numeric,
    coalesce(s.rating, 4.0)::numeric,
    coalesce(st_distance(s.home_location, sec.venue_location) / 1000.0, 9999)::numeric,
    (select count(*) from bookings b join shift_requirements sr3 on sr3.id = b.shift_id
      where b.staff_id = s.id and b.status = 'confirmed' and sr3.starts_at > now())::int,
    (select count(*) from bookings b
       join shift_requirements sr4 on sr4.id = b.shift_id
       join events ev4 on ev4.id = sr4.event_id
      where b.staff_id = s.id and b.status = 'worked' and ev4.venue_id = sec.venue_id)::int
  from staff s cross join sec cross join gap cross join rad
  where s.removed_at is null and s.left_at is null
$$;

comment on function public.auto_assign_candidates(uuid, boolean) is
  'The §3.3/§3.4 pool for one role section, computed fresh: gate, wave and the five §6 factor inputs. Gates: wrong_role, do_not_return, blocked, self_cancelled, booked_elsewhere, rtw_expired (20260924130100), hours_limit (RULE-20), and — only with p_escalation — outside_radius: home not within escalation_radius_miles() of the venue (§3.4 same-day escalation, 20260927140100). Scoring itself is packages/domain/scoring.ts.';

-- The dropped function held PUBLIC's default EXECUTE plus the explicit
-- service_role grant of 20260921162107; the new one gets PUBLIC's by
-- default, and the job's grant is restated so 190 keeps holding.
grant execute on function public.auto_assign_candidates(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3 · invite_worker re-applies the radius for an escalation invitation
--
-- Byte-for-byte 20260921192246 but for the candidate read, which now asks
-- for the escalation pool when the invitation is an escalation one.
-- ---------------------------------------------------------------------
create or replace function public.invite_worker(
  p_shift uuid, p_staff uuid,
  p_source booking_source default 'auto',
  -- Escalation only (§3.4): once the shift is under way the job invites
  -- "ignoring the event's original headcount + buffer cap". Never set by
  -- the hourly round, which is what keeps the cap meaningful before start.
  p_ignore_target boolean default false
)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  sr        shift_requirements;
  ev        events;
  v_gate    text;
  v_fill    record;
  v_booking uuid;
begin
  if current_app_role() is distinct from 'admin' and auth.uid() is not null then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  -- Lock the section: the fill check below and the insert must not race
  -- another round, or two workers take the last slot of the target.
  select * into sr from shift_requirements where id = p_shift for update;
  if sr.id is null then raise exception 'shift_not_found' using errcode = 'P0002'; end if;
  select * into ev from events where id = sr.event_id;
  if ev.cancelled_at is not null then
    return jsonb_build_object('invited', false, 'reason', 'event_cancelled');
  end if;

  -- Gates before "do they already have one", so the REASON is the useful
  -- one. A worker who self-cancelled off this event still holds the
  -- cancelled row, and reporting `already_has_booking` for them would hide
  -- RULE-04 behind a bookkeeping detail on the manager's screen.
  --
  -- An escalation invitation is judged against the escalation pool, so the
  -- §3.4 radius holds at the insert as well as in the round (20260927140100).
  select gate into v_gate
    from auto_assign_candidates(p_shift, p_source = 'escalation')
   where staff_id = p_staff;
  -- NOT FOUND is its own refusal. auto_assign_candidates ends `where
  -- s.removed_at is null and s.left_at is null`, so for a leaver (§10.6)
  -- or a removed worker (§1.7) it returns no row at all — and SELECT INTO
  -- leaves v_gate NULL when nothing matches, which read exactly like "no
  -- gate applies". Every worker who is neither removed nor left HAS a row
  -- here, carrying a gate when they are ineligible, so an absent row means
  -- those two states and nothing else. §10.6 step 5: a leaver "cannot be
  -- invited, auto-assigned or manually added to any event".
  if not found then
    return jsonb_build_object('invited', false, 'reason', 'not_bookable');
  end if;
  if v_gate is not null then
    return jsonb_build_object('invited', false, 'reason', v_gate);
  end if;

  -- `bookings` is unique on (shift, staff), so any existing row blocks a
  -- second one — including a cancelled row. A slot released by the 12:00
  -- cutoff therefore cannot be re-offered to the same worker by a later
  -- round; it goes to someone else, which is what §3.5 intends anyway.
  if exists (select 1 from bookings where shift_id = p_shift and staff_id = p_staff) then
    return jsonb_build_object('invited', false, 'reason', 'already_has_booking');
  end if;

  -- Invitations are additive up to the target, counting the ones already
  -- open: without this a role whose target is met on paper keeps inviting.
  select * into v_fill from shift_fill(p_shift);
  if not p_ignore_target and v_fill.confirmed + v_fill.invited >= v_fill.target then
    return jsonb_build_object('invited', false, 'reason', 'target_met');
  end if;

  insert into bookings (shift_id, staff_id, status, source)
  values (p_shift, p_staff, 'invited', p_source)
  returning id into v_booking;

  perform queue_booking_push('N5', v_booking);
  return jsonb_build_object('invited', true, 'bookingId', v_booking);
end $$;

comment on function public.invite_worker(uuid, uuid, booking_source, boolean) is
  'Writes one invitation, re-applying every §3.3/§3.4 gate at the insert — with p_source = ''escalation'', the §3.4 radius too (20260927140100). An absent candidate row means removed (§1.7) or left (§10.6) and is refused as not_bookable — auto_assign_candidates filters those two out entirely, so their absence must not read as "no gate applies".';

-- ---------------------------------------------------------------------
-- 4 · The job's own schedule note says what the round now does.
-- ---------------------------------------------------------------------
update job_schedules
   set note = 'Escalation (§3.4): sections already under way and still short, inviting within settings.escalation_radius_miles of the venue (auto_assign_candidates p_escalation) with p_ignore_target, source = escalation, so the headcount + buffer cap does not apply once the shift has started.'
 where job = 'auto-staffing-escalation';
