-- =====================================================================
-- Migration 20260930201000 · availability in auto-assign
--   (ADR-0043 Worker availability; docs/19 §1, Phase 1 Agent A, part A1)
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
--   2 · invite_worker(): restated byte for byte from its latest body —
--       20260930110100 (D9: the switches at the insert; D33: an ended row
--       is reopened, not refused), which landed on main while this was
--       built on 20260928110200 and is why this file was re-stamped
--       after it (docs/10 §3b) — with ONE clause — p_source in ('auto', 'escalation') and
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
  'ADR-0043: every availability entry overlapping this ROLE SECTION''s window (RULE-18), as (staff_id, starts_at, ends_at) — one row per entry. What the auto-staffing rounds and the offer pushes skip (withAvailability() in packages/domain) and what the event board shows as "Marked unavailable · {UK window}". Admin, service role or a direct connection only; a worker is refused.';

revoke execute on function public.auto_assign_unavailable(uuid) from public, anon;
grant  execute on function public.auto_assign_unavailable(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2 · invite_worker(): main's 20260930110100 byte for byte (D9 switches
--     at the insert, D33 reopen), plus the calendar clause for the
--     machine's own sources
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
  v_old     bookings;
  v_reopen  text;
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

  -- D9 (20260930110100): the switches are read at the insert, not only
  -- when the round began. A manager's manual invitation is not
  -- auto-assign and is never held to them (§3.4 "for example when the
  -- client asks for a specific person").
  if p_source in ('auto', 'escalation') and not (ev.auto_assign and sr.auto_assign) then
    return jsonb_build_object('invited', false, 'reason', 'auto_assign_off');
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
  -- NOT FOUND is its own refusal: a leaver (§10.6), a removed worker
  -- (§1.7) or — since 20260930110000 — someone who is not a worker at all
  -- (a candidate, a rejected applicant) has no row, and SELECT INTO leaves
  -- v_gate NULL when nothing matches, which read exactly like "no gate
  -- applies".
  if not found then
    return jsonb_build_object('invited', false, 'reason', 'not_bookable');
  end if;
  if v_gate is not null then
    return jsonb_build_object('invited', false, 'reason', v_gate);
  end if;

  -- ADR-0043 (20260930201000): the calendar gates what the MACHINE does.
  -- An hourly, first-round, cutoff-refill or escalation invitation is
  -- refused for a worker who marked this role section's window (RULE-18)
  -- unavailable; a manager's 'manual' invite is not — the board asks
  -- "Invite anyway?" first. After the pool gate, so a worker who is also
  -- blocked or on the wrong role is refused for that truer reason.
  if p_source in ('auto', 'escalation')
     and staff_unavailable(p_staff, sr.starts_at, sr.ends_at) then
    return jsonb_build_object('invited', false, 'reason', 'unavailable');
  end if;

  -- D33 (20260930110100): `bookings` is unique on (shift, staff), so an
  -- existing row is REOPENED rather than a second one inserted — when
  -- booking_reopenable_by() lets this source do it. A live row, a
  -- self-cancel, an event cancellation, a GDPR removal, a row with
  -- history, or a person's decision an automatic round must not overturn
  -- is still `already_has_booking`.
  select * into v_old from bookings where shift_id = p_shift and staff_id = p_staff for update;
  if v_old.id is not null then
    v_reopen := booking_reopenable_by(v_old.status, v_old.cancel_cause);
    if v_reopen is null
       or v_reopen = 'never'
       or v_old.self_cancelled
       or (v_reopen = 'person' and p_source <> 'manual')
       or exists (select 1 from check_logs where booking_id = v_old.id)
       or exists (select 1 from breaks where booking_id = v_old.id)
       or exists (select 1 from violations where booking_id = v_old.id) then
      return jsonb_build_object('invited', false, 'reason', 'already_has_booking');
    end if;
  end if;

  -- §3.4: invitations are additive "until headcount + buffer is filled",
  -- and fill counts ONLY confirmed (§3.2; confirmed-or-worked since
  -- 20260930110000). Open invitations are not fill — "earlier invitations
  -- stay open" — so they do not count against the target here; the
  -- per-round `allocation` (selectInvitees) is the throttle
  -- (20260928110200).
  select * into v_fill from shift_fill(p_shift);
  if not p_ignore_target and v_fill.confirmed >= v_fill.target then
    return jsonb_build_object('invited', false, 'reason', 'target_met');
  end if;

  if v_old.id is not null then
    -- D33: a reopened offer is a new one — every stamp of the old booking
    -- goes, and created_at reads as sent now on the board.
    update bookings
       set status = 'invited', source = p_source, created_at = now(),
           confirmed_at = null, day_before_confirmed_at = null, on_day_confirmed_at = null,
           reconfirm_required = false, reconfirm_reason = null,
           cancelled_at = null, cancel_cause = null, applied_at = null
     where id = v_old.id
    returning id into v_booking;

    -- Its own N5: `N5:booking:<id>` is already taken by the first offer.
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select 'N5:booking:' || v_booking::text || ':'
             || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text,
           'push', 'N5', p_staff, booking_push_payload(v_booking)
    on conflict (key) do nothing;

    return jsonb_build_object('invited', true, 'bookingId', v_booking, 'reopened', true);
  end if;

  insert into bookings (shift_id, staff_id, status, source)
  values (p_shift, p_staff, 'invited', p_source)
  returning id into v_booking;

  perform queue_booking_push('N5', v_booking);
  return jsonb_build_object('invited', true, 'bookingId', v_booking);
end $$;

comment on function public.invite_worker(uuid, uuid, booking_source, boolean) is
  'Writes one invitation, re-applying every §3.3/§3.4 gate at the insert — with p_source = ''escalation'', the §3.4 radius too (20260927140100). Refuses: event_cancelled · auto_assign_off (an auto/escalation invitation with either switch off at the insert, D9, 20260930110100) · not_bookable (no candidate row: removed, left, or not a worker) · the gate by name · already_has_booking (a live row, a self-cancel, or an ended row this source may not reopen — booking_reopenable_by) · target_met only once CONFIRMED (confirmed-or-worked) >= headcount + buffer: open invitations are not fill (20260928110200). Reopens an ended row instead of inserting, with its own N5 (D33, 20260930110100). Since 20260930201000 (ADR-0043) an ''auto'' or ''escalation'' invitation for a worker whose availability calendar overlaps the role section is refused as unavailable (after the pool gate, before the booking check); a ''manual'' one is not.';
