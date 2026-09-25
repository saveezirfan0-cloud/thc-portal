-- =====================================================================
-- Migration 20260927181200 · RULE-12 on the Accept path, and RULE-05's
--                            default (RULE index audit, 26.09)
--
-- 1 · RULE-12 (§4.4): "a non-compliant / blocked worker cannot be
--     assigned to a shift". The gate held before scoring
--     (auto_assign_candidates → blocked, pinned by 130) and at the insert
--     (invite_worker), and accept_application() re-reads it — but
--     accept_invite() never read staff.status or the gate at all. It
--     relied on block_worker() having withdrawn every open invitation,
--     and block_worker's withdrawn CTE only cancelled invited/applied
--     rows whose section had not yet started. So an escalation
--     invitation on a section already under way (§3.4, source =
--     'escalation') survived a block, a leave or a conviction
--     declaration, and the blocked or inactive worker could still press
--     Accept and land in `confirmed`.
--
--     Two closures, both needed:
--       a. accept_invite() reads the same gate accept_application() does,
--          once the slot check has run: an absent candidate row (removed §1.7,
--          left §10.6) is not_bookable; blocked / do_not_return /
--          self_cancelled / wrong_role / outside_radius are refused by
--          name. booked_elsewhere and hours_limit fall through to the
--          checks that already existed, which answer with the labels the
--          Staff App shows (overlap; hours_limit vs rtw_expired).
--       b. block_worker() withdraws EVERY open invitation and application,
--          not only future ones. An invitation is never "under way" — only
--          a confirmed booking is, which is why the released CTE keeps its
--          future-only rule (a worker already on the floor is not pulled
--          off it by a block that lands mid-shift).
--
-- 2 · RULE-05 (§3.4): "allocation (how many invites per hour), with the
--     default = headcount + buffer, editable". shift_requirements.
--     allocation_per_hour was `int not null` with no database default —
--     the comment on the column said "default headcount + buffer" but the
--     only place that applied it was the Shift Builder's draft
--     (apps/office/app/events/draft.ts). A default cannot reference other
--     columns, so a BEFORE INSERT trigger fills it from headcount + buffer
--     when the insert leaves it null. The NOT NULL still holds; the
--     trigger runs before the constraint is checked.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1a · accept_invite(), from 20260925100000, reading the gate
-- ---------------------------------------------------------------------
create or replace function accept_invite(p_booking uuid)
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

  select * into v_fill from shift_fill(b.shift_id);
  if v_fill.confirmed >= v_fill.target then
    update bookings set status = 'closed', cancelled_at = now(), cancel_cause = 'slot_taken'
     where id = b.id;
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end if;

  -- RULE-12, re-read at the moment of Accept (20260927181200) — the same
  -- read accept_application() makes, judged against the escalation pool
  -- for an escalation invitation so the §3.4 radius holds here too. An
  -- absent row is a leaver or a removed account (not_bookable). After the
  -- slot check on purpose: a slot that has gone closes the invitation
  -- whoever holds it (`taken`), and a dead invitation left "live" on a
  -- blocked worker's list is the lingering §3.4 forbids. The two gates
  -- the checks below already answer, with the labels the Staff App shows
  -- (overlap; hours_limit vs rtw_expired), are left to them.
  select c.gate into v_gate
    from auto_assign_candidates(sr.id, b.source = 'escalation') c
   where c.staff_id = b.staff_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_bookable');
  end if;
  if v_gate is not null and v_gate not in ('booked_elsewhere', 'hours_limit') then
    return jsonb_build_object('ok', false, 'reason', v_gate);
  end if;

  if exists (
    select 1 from bookings o
      join shift_requirements sr2 on sr2.id = o.shift_id
      join events ev2 on ev2.id = sr2.event_id
     where o.staff_id = b.staff_id and o.status = 'confirmed' and o.shift_id <> b.shift_id
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

comment on function accept_invite(uuid) is
  'First-to-confirm (§3.4): event_ended / not_bookable / the RULE-12 gates by name (blocked, do_not_return, self_cancelled, wrong_role, outside_radius — 20260927181200) / taken / overlap / rtw_expired / hours_limit / ok. Re-checks RULE-16, the hard gates, the slot, the booked-elsewhere gap, the right to work and the RULE-20 weekly cap; withdraws the worker''s other intersecting invitations; closes the role''s pending applications with N10c once it is fully confirmed (20260925100000).';

-- ---------------------------------------------------------------------
-- 1b · block_worker(), from 20260921192246: every open invitation and
--      application is withdrawn, started sections included
-- ---------------------------------------------------------------------
create or replace function public.block_worker(
  p_staff  uuid,
  p_kind   block_kind,
  p_reason text,
  p_now    timestamptz default now(),
  p_status staff_status default 'blocked',
  p_cause  text          default 'blocked'
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_released int := 0;
  v_withdrawn int := 0;
  v_was staff_status;
begin
  select status into v_was from staff where id = p_staff for update;
  if v_was is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if p_status not in ('blocked', 'inactive', 'removed') then
    raise exception 'block_worker: p_status must be blocked, inactive or removed, got %', p_status
      using errcode = 'P0001';
  end if;
  perform assert_staff_transition(v_was, p_status);

  update staff
     set status = p_status,
         block_kind = case when p_status = 'blocked' then p_kind else null end,
         block_reason = case when p_status = 'blocked' then p_reason else null end,
         leave_reason = case when p_status = 'inactive' then p_reason else leave_reason end,
         left_at      = case when p_status = 'inactive' then p_now   else left_at end,
         removed_at   = case when p_status = 'removed'  then p_now   else removed_at end
   where id = p_staff;

  -- Future confirmed bookings only: a worker already on the floor is not
  -- pulled off it by a block that lands mid-shift (§4.3 "future confirmed
  -- shifts are released").
  with released as (
    update bookings b
       set status = 'cancelled', cancelled_at = p_now, cancel_cause = p_cause
      from shift_requirements s
     where s.id = b.shift_id
       and b.staff_id = p_staff
       and b.status = 'confirmed'
       and b.cancelled_at is null
       and s.starts_at > p_now
    returning 1
  ) select count(*)::int into v_released from released;

  -- EVERY open invitation and application, whether or not the section has
  -- started: an invitation is never under way, and an escalation
  -- invitation on a section already running (§3.4) is exactly the one a
  -- blocked worker could otherwise still accept (RULE-12, 20260927181200).
  with withdrawn as (
    update bookings b
       set status = 'cancelled', cancelled_at = p_now, cancel_cause = p_cause || '_invite'
     where b.staff_id = p_staff
       and b.status in ('invited', 'applied')
       and b.cancelled_at is null
    returning 1
  ) select count(*)::int into v_withdrawn from withdrawn;

  return jsonb_build_object(
    'staffId', p_staff::text,
    'wasStatus', v_was::text,
    'status', p_status::text,
    'kind', p_kind::text,
    'released', v_released,
    'withdrawn', v_withdrawn);
end $$;

comment on function public.block_worker(uuid, block_kind, text, timestamptz, staff_status, text) is
  'The one exit from compliant to blocked / inactive / removed (§4.3, §10.6, §1.7): sets the status and its reason, releases FUTURE confirmed bookings with p_cause, and withdraws EVERY open invitation and application with p_cause || ''_invite'' — started sections included since 20260927181200 (RULE-12). Service role only; the office routes go through block_worker_manually() and the leaving / removal functions.';

-- ---------------------------------------------------------------------
-- 2 · RULE-05: allocation_per_hour defaults to headcount + buffer
-- ---------------------------------------------------------------------
create or replace function public.shift_requirements_default_allocation()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  -- §3.4: "allocation … with the default = headcount + buffer, editable".
  -- A column default cannot read other columns, so the default lives here.
  if new.allocation_per_hour is null then
    new.allocation_per_hour := new.headcount + coalesce(new.buffer, 0);
  end if;
  return new;
end $$;

comment on function public.shift_requirements_default_allocation() is
  'BEFORE INSERT on shift_requirements: allocation_per_hour := headcount + buffer when the insert leaves it null (§3.4 RULE-05, 20260927181200). The NOT NULL constraint still holds behind it.';

drop trigger if exists shift_requirements_default_allocation on public.shift_requirements;
create trigger shift_requirements_default_allocation
  before insert on public.shift_requirements
  for each row execute function public.shift_requirements_default_allocation();

comment on column public.shift_requirements.allocation_per_hour is
  'How many invitations one hourly auto-assign round adds (§3.4). Defaults to headcount + buffer at insert (shift_requirements_default_allocation, 20260927181200); editable per role.';

revoke execute on function public.shift_requirements_default_allocation() from public, anon, authenticated;
