-- =====================================================================
-- Migration 20260930201000 · availability in auto-assign
--   (ADR-0042 Worker availability; docs/19 §1, Phase 1 Agent A, part A1)
--
-- The calendar a worker keeps in the Staff App (staff_unavailability,
-- 20260930200100) becomes a HARD GATE on what the machine does, and
-- advice for people:
--
--   stops    the hourly rounds, the first round, the cutoff refills and
--            the same-day escalation — every invitation written with
--            source 'auto' or 'escalation' — and the OF1 offer pushes
--            (20260930201100)
--   never    a manager's manual invite (the board asks first: "{name}
--            marked themselves unavailable for this time. Invite
--            anyway?"), the worker's own Accept / Radar apply / take, an
--            open invitation (§3.4: never withdrawn by auto-assign), or a
--            confirmed booking (never cancelled by a calendar entry)
--
-- §6's five weights are contractual, so this is not a sixth factor: the
-- SQL pool (auto_assign_candidates, frozen in Phase 1 by docs/19 §0.6) is
-- unchanged, and the gate is overlaid in two places —
--
--   1 · auto_assign_unavailable(p_shift): who has an entry overlapping the
--       ROLE SECTION's window (RULE-18), and the entry's window. The
--       auto-staffing Edge Function passes the ids to selectInvitees() /
--       selectOfferRecipients() (withAvailability() in packages/domain);
--       the event board shows each under Unavailable → "Marked
--       unavailable · {UK window}" with Invite anyway.
--   2 · invite_worker(): restated byte for byte from 20260928110200 with
--       ONE clause — p_source in ('auto', 'escalation') and
--       staff_unavailable(p_staff, section start, section end) refuses
--       {invited:false, reason:'unavailable'} at the insert, under the
--       section lock, so a round that read the calendar a moment early
--       still cannot write the invitation. After the pool gate on purpose:
--       "blocked" or "wrong role" is the truer reason for a worker who is
--       also on holiday. 'manual' (office_invite_worker) never reaches the
--       clause.
--
-- pgTAP 706 asserts the new refusal AND every refusal invite_worker made
-- before it, in one file (docs/10 §3b: a restated function must not drop
-- a shipped gate with a green build).
--
-- Forward-only. References only 20260930200100 and earlier objects.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · auto_assign_unavailable(): the calendar, per role section
--
-- One row per entry overlapping the section, half-open on both sides
-- (an entry ending at 17:00 misses a 17:00 start — staff_unavailable()'s
-- own `&&`). Definer, because the table is admin-read only and the job
-- runs as the service role; the check inside admits the office, the
-- service role and a direct connection, and nobody else — a worker must
-- not read another worker's calendar through it.
-- ---------------------------------------------------------------------
create or replace function public.auto_assign_unavailable(p_shift uuid)
returns table (staff_id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if current_app_role() is distinct from 'admin'
     and coalesce(auth.role(), '') <> 'service_role'
     and auth.role() is not null then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  return query
    select u.staff_id, lower(u.period), upper(u.period)
      from shift_requirements sr
      join staff_unavailability u
        on u.period && tstzrange(sr.starts_at, sr.ends_at, '[)')
     where sr.id = p_shift
       and sr.ends_at > sr.starts_at
     order by u.staff_id, lower(u.period);
end $$;

comment on function public.auto_assign_unavailable(uuid) is
  'ADR-0042: every availability entry overlapping this ROLE SECTION''s window (RULE-18), as (staff_id, starts_at, ends_at) — one row per entry. What the auto-staffing rounds and the offer pushes skip (withAvailability() in packages/domain) and what the event board shows as "Marked unavailable · {UK window}". Admin, service role or a direct connection only; a worker is refused.';

revoke execute on function public.auto_assign_unavailable(uuid) from public, anon;
grant  execute on function public.auto_assign_unavailable(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2 · invite_worker(): 20260928110200 byte for byte, plus the calendar
--     clause for the machine's own sources
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

  -- ADR-0042 (20260930201000): the calendar gates what the MACHINE does.
  -- An hourly, first-round, cutoff-refill or escalation invitation is
  -- refused for a worker who marked this role section's window (RULE-18)
  -- unavailable; a manager's 'manual' invite is not — the board asks
  -- "Invite anyway?" first. After the pool gate, so a worker who is also
  -- blocked or on the wrong role is refused for that truer reason.
  if p_source in ('auto', 'escalation')
     and staff_unavailable(p_staff, sr.starts_at, sr.ends_at) then
    return jsonb_build_object('invited', false, 'reason', 'unavailable');
  end if;

  -- `bookings` is unique on (shift, staff), so any existing row blocks a
  -- second one — including a cancelled row. A slot released by the 12:00
  -- cutoff therefore cannot be re-offered to the same worker by a later
  -- round; it goes to someone else, which is what §3.5 intends anyway.
  if exists (select 1 from bookings where shift_id = p_shift and staff_id = p_staff) then
    return jsonb_build_object('invited', false, 'reason', 'already_has_booking');
  end if;

  -- §3.4: invitations are additive "until headcount + buffer is filled",
  -- and fill counts ONLY confirmed (§3.2). Open invitations are not
  -- fill — "earlier invitations stay open" — so they do not count against
  -- the target here; the per-round `allocation` (selectInvitees) is the
  -- throttle. Counting them (20260921141500 … 20260927140100) stalled the
  -- rounds at zero confirmations once allocation invitations were out.
  select * into v_fill from shift_fill(p_shift);
  if not p_ignore_target and v_fill.confirmed >= v_fill.target then
    return jsonb_build_object('invited', false, 'reason', 'target_met');
  end if;

  insert into bookings (shift_id, staff_id, status, source)
  values (p_shift, p_staff, 'invited', p_source)
  returning id into v_booking;

  perform queue_booking_push('N5', v_booking);
  return jsonb_build_object('invited', true, 'bookingId', v_booking);
end $$;

comment on function public.invite_worker(uuid, uuid, booking_source, boolean) is
  'Writes one invitation, re-applying every §3.3/§3.4 gate at the insert — with p_source = ''escalation'', the §3.4 radius too (20260927140100). target_met only once CONFIRMED >= headcount + buffer: open invitations are not fill, so an hourly round keeps adding `allocation` while nobody has confirmed (20260928110200). An absent candidate row means removed (§1.7) or left (§10.6) and is refused as not_bookable — auto_assign_candidates filters those two out entirely, so their absence must not read as "no gate applies". Since 20260930201000 (ADR-0042) an ''auto'' or ''escalation'' invitation for a worker whose availability calendar overlaps the role section is refused as unavailable; a ''manual'' one is not.';
