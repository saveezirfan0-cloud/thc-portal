-- =====================================================================
-- Migration 20260929110000 · a checked-in worker is staffed (§3.2, §3.4,
--                            §3.6; audit 25.09 D2, part of 2b and 9)
--
-- D2. attempt_check_in() moves a booking confirmed → worked (§3.6
-- "[shift + checklog] → worked"). Everything the engine decides with
-- counted `status = 'confirmed'` only, so the moment people checked in
-- the section read as empty again:
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
-- already did (board-data.ts lists both under Confirmed). ADR-0031.
--
-- `turned_away` is not staffed: RULE-15 turned them away because the
-- section was already full, and they are not working it.
--
-- Also in auto_assign_candidates, restated here because it has to be
-- dropped for its new column anyway:
--
--   * Only WORKERS have a row (event board item "candidates and
--     rejected people"). A candidate still in onboarding, or a rejected
--     applicant, holds staff_roles from the wizard and was returned gated
--     `blocked`, so the board listed them under Unavailable as "Blocked —
--     compliance". They are not workers at all (§2.12: compliant and
--     blocked are the two worker states; inactive and removed already had
--     no row through left_at / removed_at). invite_worker(),
--     accept_application() and staff_open_shifts() already treat an
--     absent row as "not bookable"; apply_to_shift() learns to in
--     20260929110100.
--   * booking_cause: the section's own booking's cancel_cause, beside
--     booking_status, so a round can tell an invitation the worker
--     DECLINED from one that merely closed because somebody else took the
--     slot (20260929110100, D33).
--   * EXECUTE is revoked from anon (brief item 8). The DROP in
--     20260927140100 handed it back to PUBLIC.
--
-- accept_invite() is restated from 20260925100000 with the overlap
-- safety net reading confirmed-or-worked; its slot check reads shift_fill
-- and is fixed with it. Its RULE-16 / rtw_expired / hours_limit branches
-- are unchanged.
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
  'Fill for one role section (§3.2, §3.3): `confirmed` counts confirmed AND worked bookings — a worked booking is a confirmed one that has checked in and still holds the slot (20260929110000, ADR-0031). Invitations never fill. target = headcount + buffer (absolute buffer).';

-- ---------------------------------------------------------------------
-- 2 · auto_assign_candidates: worked is booked elsewhere; workers only;
--     booking_cause
--
-- From 20260927140100 but for: the booked_elsewhere status list, the
-- `where` clause (workers only), the lateral read of this section's own
-- booking, and the trailing booking_cause column.
-- ---------------------------------------------------------------------
drop function if exists public.auto_assign_candidates(uuid, boolean);

create or replace function public.auto_assign_candidates(
  p_shift      uuid,
  -- §3.4 same-day escalation: also gate anyone whose home is not within
  -- escalation_radius_miles() of the venue.
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
      -- §3.4 "only the worker's other CONFIRMED bookings count" — and a
      -- checked-in booking is a confirmed one (20260929110000).
      when exists (
             select 1 from bookings b
               join shift_requirements sr2 on sr2.id = b.shift_id
               join events ev2 on ev2.id = sr2.event_id
              where b.staff_id = s.id and b.status in ('confirmed', 'worked')
                and b.shift_id <> sec.shift_id
                and booked_elsewhere_conflict(sec.starts_at, sec.ends_at, sec.venue_id,
                                              sr2.starts_at, sr2.ends_at, ev2.venue_id,
                                              gap.mins) <> 'clear')             then 'booked_elsewhere'
      when weekly_cap_would_breach(s.id, sec.shift_id) then
        case when not (can_roster_staff(s.id, (sec.starts_at at time zone 'Europe/London')::date)
                       and can_roster_staff(s.id, ((sec.ends_at - interval '1 second')
                                                   at time zone 'Europe/London')::date))
             then 'rtw_expired'
             else 'hours_limit' end
      when rad.metres is not null
           and (s.home_location is null
                or not st_dwithin(s.home_location, sec.venue_location, rad.metres)) then 'outside_radius'
      else null
    end as gate,
    exists (select 1 from client_qualifications cq
             where cq.staff_id = s.id and cq.client_id = sec.client_id
               and cq.role_id = sec.role_id and not cq.do_not_return) as qualified,
    mine.status,
    coalesce(s.reliability, 90)::numeric,
    coalesce(s.rating, 4.0)::numeric,
    coalesce(st_distance(s.home_location, sec.venue_location) / 1000.0, 9999)::numeric,
    (select count(*) from bookings b join shift_requirements sr3 on sr3.id = b.shift_id
      where b.staff_id = s.id and b.status = 'confirmed' and sr3.starts_at > now())::int,
    (select count(*) from bookings b
       join shift_requirements sr4 on sr4.id = b.shift_id
       join events ev4 on ev4.id = sr4.event_id
      where b.staff_id = s.id and b.status = 'worked' and ev4.venue_id = sec.venue_id)::int,
    mine.cancel_cause
  from staff s cross join sec cross join gap cross join rad
  left join lateral (
    select b.status::text as status, b.cancel_cause
      from bookings b
     where b.shift_id = sec.shift_id and b.staff_id = s.id
  ) mine on true
  -- Workers only (§2.12): compliant, or blocked (which is gated below).
  -- A candidate mid-onboarding or a rejected applicant is not in any pool
  -- and produces no row — not an Unavailable "Blocked — compliance" row.
  -- Leavers (§10.6) and removed workers (§1.7) never had one.
  where s.removed_at is null and s.left_at is null
    and s.status in ('compliant', 'blocked')
$$;

comment on function public.auto_assign_candidates(uuid, boolean) is
  'The §3.3/§3.4 pool for one role section, computed fresh: gate, wave, the five §6 factor inputs, and this section''s own booking (status + cause). Workers only: candidates, rejected applicants, leavers and removed workers have no row (20260929110000). Gates: wrong_role, do_not_return, blocked, self_cancelled, booked_elsewhere (confirmed or worked, 2 h different-venue gap), rtw_expired, hours_limit (RULE-20), and — only with p_escalation — outside_radius (§3.4). Scoring itself is packages/domain/scoring.ts.';

-- A new function gets PUBLIC's EXECUTE by default, and Supabase's default
-- privileges name anon too; both are revoked by name (docs/14 O7). The
-- board (admin) and the job (service role) keep it.
revoke execute on function public.auto_assign_candidates(uuid, boolean) from public, anon;
grant execute on function public.auto_assign_candidates(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3 · accept_invite: the overlap safety net counts a checked-in booking
--
-- From 20260925100000 but for `o.status in ('confirmed','worked')`. The
-- slot check reads shift_fill(), which now counts worked too.
-- ---------------------------------------------------------------------
create or replace function public.accept_invite(p_booking uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  b           bookings;
  sr          shift_requirements;
  ev          events;
  v_fill      record;
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

  -- First-to-confirm (§3.4). Confirmed-or-worked fills (20260929110000).
  select * into v_fill from shift_fill(b.shift_id);
  if v_fill.confirmed >= v_fill.target then
    update bookings set status = 'closed', cancelled_at = now(), cancel_cause = 'slot_taken'
     where id = b.id;
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end if;

  -- §3.4 safety net: "blocks Accept on a shift that already overlaps a
  -- just-confirmed booking" — a booking the worker has already checked in
  -- to is at least as confirmed (20260929110000).
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
  'First-to-confirm (§3.4): event_ended / taken / overlap / rtw_expired / hours_limit / ok. Re-checks RULE-16, the slot (confirmed or worked fill), the booked-elsewhere gap against confirmed AND checked-in bookings (20260929110000), the right to work and the RULE-20 weekly cap; withdraws the worker''s other intersecting invitations; closes the role''s pending applications with N10c once it is full.';
