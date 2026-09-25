-- =====================================================================
-- Migration 20260930110000 · a checked-in worker is staffed (§3.2, §3.4,
--                            §3.6; audit 25.09 D2 and the board's
--                            "candidates get no row")
--
-- D2. attempt_check_in() moves a booking confirmed → worked (§3.6
-- "[shift + checklog] → worked"). Everything the engine decided counted
-- `status = 'confirmed'` only, so the moment people checked in the
-- section read as empty again:
--
--   * shift_fill() — the one fill every round, Radar and the office read —
--     reported the section short, so auto_assign_due_shifts('escalation')
--     picked a fully staffed, under-way shift and invited every 10
--     minutes, ignoring the target (p_ignore_target);
--   * auto_assign_candidates()'s booked_elsewhere gate let a worker on
--     shift at venue A be invited to an overlapping shift at venue B;
--   * accept_invite()'s overlap safety net let them accept it.
--
-- `worked` is a confirmed booking that has checked in. It holds the slot
-- exactly as it did a minute earlier, so "fill counts ONLY confirmed"
-- (§3.2/§3.3) reads `status in ('confirmed','worked')` wherever the
-- question is "is this slot staffed / is this worker booked". The board
-- already did (board-data.ts lists both under Confirmed). ADR-0037.
--
-- `turned_away` is not staffed: RULE-15 turned them away because the
-- section was already full, and they are not working it.
--
-- What is restated, and from where
--
--   • shift_fill() — 20260921141500's body (restated only for its
--     search_path in 20260922183014) with the one status list changed.
--     No other version exists.
--   • auto_assign_candidates() — 20260928110100's body (the derived
--     staff_show_rate(), which must survive) with three changes, marked
--     in place:
--       1. booked_elsewhere counts confirmed OR worked bookings;
--       2. only WORKERS have a row. A candidate still in onboarding, or a
--          rejected applicant, holds staff_roles from the wizard and was
--          returned gated `blocked`, so the event board listed them under
--          Unavailable as "Blocked — compliance". They are not workers at
--          all (§2.12: compliant and blocked are the two worker states;
--          inactive and removed already had no row through left_at /
--          removed_at). invite_worker(), accept_invite(),
--          accept_application() and staff_open_shifts() already treat an
--          absent row as "not bookable"; apply_to_shift() learns to in
--          20260930110100;
--       3. a trailing booking_cause column — this section's own booking's
--          cancel_cause beside booking_status — so a round can tell an
--          invitation the worker DECLINED from one that merely closed
--          because somebody else took the slot (20260930110100, D33;
--          packages/domain roundMayInvite()).
--     The return type changes, so it is dropped and created; the grants
--     and revokes of 20260928110800 are restated by name, because a new
--     function carries PUBLIC's default EXECUTE.
--   • accept_invite() — 20260928110400's body (the RULE-12 gate read,
--     which must survive) with the overlap safety net's status list
--     changed to confirmed-or-worked. Its slot check reads shift_fill()
--     and is corrected with it. Nothing else moves.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · shift_fill: confirmed-or-worked is the fill
-- ---------------------------------------------------------------------
create or replace function public.shift_fill(p_shift uuid)
returns table (confirmed int, invited int, headcount int, buffer int, target int, still_short int)
language sql
stable
set search_path = public, extensions
as $$
  select
    c.confirmed, c.invited, sr.headcount, sr.buffer,
    sr.headcount + sr.buffer as target,
    greatest(0, sr.headcount + sr.buffer - c.confirmed) as still_short
  from shift_requirements sr
  cross join lateral (
    select
      -- A checked-in booking (`worked`) still holds its slot (§3.6).
      count(*) filter (where b.status in ('confirmed', 'worked'))::int as confirmed,
      count(*) filter (where b.status = 'invited')::int                as invited
    from bookings b where b.shift_id = sr.id
  ) c
  where sr.id = p_shift
$$;

comment on function public.shift_fill(uuid) is
  'Fill for one role section (§3.2, §3.3): `confirmed` counts confirmed AND worked bookings — a worked booking is a confirmed one that has checked in and still holds the slot (20260930110000, ADR-0037). Invitations never fill. target = headcount + buffer (absolute buffer).';

-- ---------------------------------------------------------------------
-- 2 · auto_assign_candidates — 20260928110100 but for the three marked
--     changes
-- ---------------------------------------------------------------------
drop function if exists public.auto_assign_candidates(uuid, boolean);

create function public.auto_assign_candidates(
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
  venue_times    int,
  -- (3) appended 20260930110000: this section's own booking's cause.
  booking_cause  text
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
$$;

comment on function public.auto_assign_candidates(uuid, boolean) is
  'The §3.3/§3.4 pool for one role section, computed fresh: gate, wave, the five §6 factor inputs — reliability is staff_show_rate() (20260928110100), never the stored column — and this section''s own booking (status and, since 20260930110000, cause). Workers only: candidates, rejected applicants, leavers and removed workers have no row (20260930110000). Gates: wrong_role, do_not_return, blocked, self_cancelled, booked_elsewhere (confirmed or worked, 2 h different-venue gap — 20260930110000), rtw_expired (20260924130100), hours_limit (RULE-20), and — only with p_escalation — outside_radius (§3.4 same-day escalation, 20260927140100). Scoring itself is packages/domain/scoring.ts.';

-- 20260928110800, restated by name: a new function gets PUBLIC's EXECUTE
-- by default, and Supabase's default privileges name anon too. The board
-- (admin) and the jobs (service role) keep it.
revoke execute on function public.auto_assign_candidates(uuid, boolean) from public, anon;
grant  execute on function public.auto_assign_candidates(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3 · accept_invite — 20260928110400 but for the overlap status list
-- ---------------------------------------------------------------------
create or replace function public.accept_invite(p_booking uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  b           bookings;
  sr          shift_requirements;
  ev          events;
  v_fill      record;
  v_gate      text;
  v_gap       int := booked_elsewhere_gap_minutes();
  v_withdrawn int := 0;
  v_closed    int := 0;
begin
  select * into b from bookings where id = p_booking;
  if b.id is null then raise exception 'booking_not_found' using errcode = 'P0002'; end if;

  if current_app_role() is distinct from 'admin'
     and b.staff_id is distinct from (select id from staff where user_id = auth.uid()) then
    raise exception 'not_your_booking' using errcode = '42501';
  end if;

  select * into sr from shift_requirements where id = b.shift_id for update;
  select * into ev from events where id = sr.event_id;
  if ev.cancelled_at is not null then raise exception 'event_cancelled' using errcode = 'P0001'; end if;
  if b.status <> 'invited' then
    return jsonb_build_object('ok', false, 'reason', 'not_invited', 'status', b.status::text);
  end if;

  -- RULE-16. Before the slot count, deliberately: `taken` closes the
  -- invitation, and an invitation that expired is not one somebody else won.
  if now() >= sr.ends_at then
    return jsonb_build_object('ok', false, 'reason', 'event_ended');
  end if;

  -- First-to-confirm (§3.4). shift_fill counts confirmed-or-worked
  -- (20260930110000): a checked-in worker still holds their slot.
  select * into v_fill from shift_fill(b.shift_id);
  if v_fill.confirmed >= v_fill.target then
    update bookings set status = 'closed', cancelled_at = now(), cancel_cause = 'slot_taken'
     where id = b.id;
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end if;

  -- RULE-12, re-read at the moment of Accept (20260928110400) — the same
  -- read accept_application() makes, judged against the escalation pool
  -- for an escalation invitation so the §3.4 radius holds here too. An
  -- absent row is a leaver, a removed account, or — since 20260930110000 —
  -- someone who is not a worker (not_bookable). After the slot check on
  -- purpose: a slot that has gone closes the invitation whoever holds it
  -- (`taken`), and a dead invitation left "live" on a blocked worker's
  -- list is the lingering §3.4 forbids. The two gates the checks below
  -- already answer, with the labels the Staff App shows (overlap;
  -- hours_limit vs rtw_expired), are left to them.
  select c.gate into v_gate
    from auto_assign_candidates(sr.id, b.source = 'escalation') c
   where c.staff_id = b.staff_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_bookable');
  end if;
  if v_gate is not null and v_gate not in ('booked_elsewhere', 'hours_limit') then
    return jsonb_build_object('ok', false, 'reason', v_gate);
  end if;

  -- §3.4 safety net: "blocks Accept on a shift that already overlaps a
  -- just-confirmed booking" — and a booking the worker has already
  -- checked in to is at least as confirmed (20260930110000, D2).
  if exists (
    select 1 from bookings o
      join shift_requirements sr2 on sr2.id = o.shift_id
      join events ev2 on ev2.id = sr2.event_id
     where o.staff_id = b.staff_id and o.status in ('confirmed', 'worked')
       and o.shift_id <> b.shift_id
       and booked_elsewhere_conflict(sr.starts_at, sr.ends_at, ev.venue_id,
                                     sr2.starts_at, sr2.ends_at, ev2.venue_id, v_gap) <> 'clear'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'overlap');
  end if;

  -- RULE-20, re-read live at the moment of Accept (§10.4) — 20260922153000.
  -- The right-to-work stop shares the gate but not the label: a worker
  -- past their right to work is not over their hours (20260924130100).
  if weekly_cap_would_breach(b.staff_id, b.shift_id) then
    if not (can_roster_staff(b.staff_id, (sr.starts_at at time zone 'Europe/London')::date)
            and can_roster_staff(b.staff_id, ((sr.ends_at - interval '1 second')
                                              at time zone 'Europe/London')::date)) then
      return jsonb_build_object('ok', false, 'reason', 'rtw_expired');
    end if;
    return jsonb_build_object('ok', false, 'reason', 'hours_limit');
  end if;

  update bookings set status = 'confirmed', confirmed_at = now() where id = b.id;

  with overlapping as (
    update bookings o set status = 'cancelled', cancelled_at = now(),
                          cancel_cause = 'overlap_auto_withdraw'
     from shift_requirements sr3
    where sr3.id = o.shift_id
      and o.staff_id = b.staff_id and o.status = 'invited' and o.id <> b.id
      and sr.starts_at < sr3.ends_at and sr3.starts_at < sr.ends_at
    returning o.id
  ) select count(*)::int into v_withdrawn from overlapping;

  -- §8 N10c: a first-to-confirm fill closes the pending applications too.
  v_closed := close_filled_role_applications(sr.id);

  return jsonb_build_object('ok', true, 'withdrawn', v_withdrawn, 'closedApplications', v_closed);
end $$;

comment on function public.accept_invite(uuid) is
  'First-to-confirm (§3.4): event_ended / not_bookable / the RULE-12 gates by name (blocked, do_not_return, self_cancelled, wrong_role, outside_radius — 20260928110400) / taken / overlap / rtw_expired / hours_limit / ok. Re-checks RULE-16, the hard gates, the slot (confirmed-or-worked fill), the booked-elsewhere gap against confirmed AND checked-in bookings (20260930110000), the right to work and the RULE-20 weekly cap; withdraws the worker''s other intersecting invitations; closes the role''s pending applications with N10c once it is full.';
