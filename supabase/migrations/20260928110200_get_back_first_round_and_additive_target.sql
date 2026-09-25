-- =====================================================================
-- Migration 20260928110200 · three §3.3 / §3.4 corrections from the
--                            26.09 scope audit (scheduling half)
--
-- 1 · "Get back" registers the arrival (§3.3, RULE-01).
--     The event board's Get back (apps/office/app/events/[id]/actions.ts)
--     deleted the no_show violation and inserted a `late` one straight
--     into `violations`. It never wrote the check-in and never moved the
--     booking off `confirmed`, so payable_shifts_v — whose kind is
--     derived from the check log — paid the worker 0, and the no-show
--     history row was destroyed rather than resolved. The Violation log's
--     Resolve on the same entry (resolve_violation, 20260923190000) does
--     it right: check_logs row at the moment of the press, booking →
--     worked, the same violation reclassified in place. §3.3 says the two
--     buttons are ONE action ("pressing it on the event's roster screen
--     (or 'Resolve' on the same entry in the Violation log, §9.5)"), so
--     the board now goes through the same function: get_back(p_booking)
--     finds the booking's open no-show and delegates.
--
--     The manual No-show next to it wrote its violation from the office
--     session too — the right shape (booking_tick's BG-03 insert, same
--     columns) but none of its guards: nothing checked the booking was
--     still confirmed, that no check-in existed, that the §3.3 window
--     ("from shift start until 2 weeks after end") held on the server,
--     or that a second press would not stack a second no-show. Those are
--     office_mark_no_show(p_booking), locked on the booking.
--
-- 2 · The hourly round is additive against CONFIRMED (§3.4).
--     invite_worker refused with target_met once
--     confirmed + invited >= headcount + buffer, so open invitations
--     counted against the confirmation target: with the default
--     allocation (= headcount + buffer) round one invited the target and
--     every later round invited nobody until someone declined, even with
--     zero confirmations. §3.4: "from the moment the event is created it
--     adds allocation invites every hour, in descending score order;
--     earlier invitations stay open (they are not pulled or rejected); it
--     keeps adding until headcount + buffer is FILLED" — and fill counts
--     only confirmed (§3.2, §3.3 header, shift_fill). The per-round
--     `allocation` is the only throttle the scope names. The ceiling
--     invite_worker enforces is therefore confirmed >= target, and a
--     round with nobody confirmed keeps adding. (auto_assign_due_shifts
--     already selects sections by f.confirmed < f.target; only the insert
--     disagreed.)
--
-- 3 · The first round runs at creation, not at :17 (§3.4).
--     "from the moment the event is created" — but the only trigger was
--     the hourly cron, so an event saved at 09:20 got its first
--     invitations at 10:17. auto_assign_first_round(p_event) posts one
--     hourly-mode round for that event's sections to the auto-staffing
--     Edge Function, exactly as the cron command does (same URL, same
--     bearer from Vault, same base-URL guard), with `event=<id>` so the
--     round touches only the new event and not every other open section
--     an hour early. Admin only; never raises into the save that called
--     it — a missing base URL or key is reported, not thrown, and the
--     :17 round catches up.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1a · get_back(): the board's button, through resolve_violation()
-- ---------------------------------------------------------------------
create or replace function public.get_back(p_booking uuid, p_note text default null)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_violation uuid;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'admins_only' using errcode = '42501';
  end if;

  -- The open no-show on this booking. Locked, so two presses (or a press
  -- racing the Violation log's Resolve) resolve the same row once.
  select id into v_violation
    from violations
   where booking_id = p_booking and type = 'no_show' and not resolved
   order by detected_at
   limit 1
   for update;
  if v_violation is null then
    raise exception 'no_open_no_show' using errcode = 'P0002',
      hint = 'This worker has no unresolved No-show to get back from.';
  end if;

  -- resolve_violation makes the note mandatory (§9.5). From the board the
  -- press IS the note; the Violation log's Resolve types its own.
  return resolve_violation(
    v_violation,
    coalesce(nullif(btrim(p_note), ''),
             'Get back — registered as arrived from the event board (§3.3).'));
end $$;

comment on function public.get_back(uuid, text) is
  '§3.3 "Get back" from the event board. Admin only. Finds the booking''s open no_show violation under a row lock and delegates to resolve_violation(), so the arrival is registered (check_logs at the press, booking → worked, the entry reclassified to late with minutes from the section start) exactly as the Violation log''s Resolve does. no_open_no_show (P0002) when there is nothing to get back from.';

revoke execute on function public.get_back(uuid, text) from public, anon;
grant  execute on function public.get_back(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1b · office_mark_no_show(): the manual No-show, with its guards
-- ---------------------------------------------------------------------
create or replace function public.office_mark_no_show(p_booking uuid)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  b        bookings;
  sr       shift_requirements;
  v_now    timestamptz := now();
  v_id     uuid;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'admins_only' using errcode = '42501';
  end if;

  select * into b from bookings where id = p_booking for update;
  if b.id is null then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  -- §3.3: the worker "stays inside Confirmed with a badge". A booking that
  -- is not confirmed has nothing to badge — an invitation was never a
  -- promise to turn up, and a worked one did.
  if b.status <> 'confirmed' then
    raise exception 'booking_not_confirmed: %', b.status using errcode = 'P0001';
  end if;
  if exists (select 1 from check_logs where booking_id = b.id and check_in_at is not null) then
    raise exception 'already_checked_in' using errcode = 'P0001';
  end if;

  select * into sr from shift_requirements where id = b.shift_id;
  -- The same window as canMarkNoShow() (packages/domain/src/board.ts):
  -- from the role section's start until two weeks after its end.
  if v_now < sr.starts_at or v_now > sr.ends_at + interval '14 days' then
    raise exception 'outside_window' using errcode = 'P0001',
      hint = 'No-show can be recorded from the shift start until two weeks after it ends (§3.3).';
  end if;

  -- A second press finds the first: one no-show per booking, as BG-03
  -- (booking_tick) already guarantees for the automatic one.
  select id into v_id from violations
   where booking_id = b.id and type = 'no_show' and not resolved
   limit 1;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'already', true, 'violationId', v_id,
                              'payrollExported', booking_payroll_exported(b.id));
  end if;

  insert into violations (staff_id, booking_id, type, detected_at)
  values (b.staff_id, b.id, 'no_show', v_now)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'already', false, 'violationId', v_id,
                            -- RULE-06: never corrected retroactively; the screen warns.
                            'payrollExported', booking_payroll_exported(b.id));
end $$;

comment on function public.office_mark_no_show(uuid) is
  '§3.3 manual No-show from the event board. Admin only, locked on the booking: confirmed bookings with no check-in, from the section start until two weeks after its end (the window canMarkNoShow() shows), one open no_show per booking. Writes the same violation row BG-03 (booking_tick) writes; the worker stays in Confirmed, badged.';

revoke execute on function public.office_mark_no_show(uuid) from public, anon;
grant  execute on function public.office_mark_no_show(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2 · invite_worker(): the target is CONFIRMED against headcount + buffer
--
-- Byte-for-byte 20260927140100 but for the fill check, which no longer
-- adds the open invitations to the confirmed count.
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
  'Writes one invitation, re-applying every §3.3/§3.4 gate at the insert — with p_source = ''escalation'', the §3.4 radius too (20260927140100). target_met only once CONFIRMED >= headcount + buffer: open invitations are not fill, so an hourly round keeps adding `allocation` while nobody has confirmed (20260928110200). An absent candidate row means removed (§1.7) or left (§10.6) and is refused as not_bookable — auto_assign_candidates filters those two out entirely, so their absence must not read as "no gate applies".';

comment on function public.office_invite_worker(uuid, uuid) is
  'The manager''s Invite from the event board''s Potential pool (§3.3, §3.4). Admin only. Refuses event_cancelled / event_ended (RULE-16) / full (confirmed >= headcount + buffer), then delegates to invite_worker(…, ''manual'', true): every hard gate by name, not_bookable, already_has_booking, the invited insert and N5. Since 20260928110200 the rounds'' own ceiling is the same confirmed count, so p_ignore_target here only skips a check the section-level `full` refusal has already made.';

-- ---------------------------------------------------------------------
-- 3 · auto_assign_first_round(): one hourly round for a new event, now
-- ---------------------------------------------------------------------
create or replace function public.auto_assign_first_round(p_event uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  ev        events;
  v_due     int;
  v_base    text;
  v_key     text;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'admins_only' using errcode = '42501';
  end if;

  select * into ev from events where id = p_event;
  if ev.id is null then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;
  if ev.cancelled_at is not null then
    return jsonb_build_object('queued', false, 'reason', 'event_cancelled');
  end if;

  -- The same selection the :17 round makes — both switches on, not
  -- started, confirmed below headcount + buffer — narrowed to this event.
  -- Nothing due means nothing to post: auto-assign off, or every section
  -- already under way (escalation's job, §3.4).
  select count(*)::int into v_due
    from auto_assign_due_shifts('hourly') d
   where d.event_id = p_event;
  if v_due = 0 then
    return jsonb_build_object('queued', false, 'reason', 'nothing_due');
  end if;

  -- Exactly what install_job_schedules() puts in the cron command: the
  -- guarded base URL and the service-role bearer from Vault, read at the
  -- moment of the call. Inside an exception block for the same reason as
  -- willo_invite_nudge(): a refused or missing base must never fail the
  -- event save that fired it — the hourly cron catches up at :17.
  begin
    v_base := edge_base_url();
    if coalesce(v_base, '') = '' then
      return jsonb_build_object('queued', false, 'reason', 'edge_base_url_not_set', 'due', v_due);
    end if;
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
    if coalesce(v_key, '') = '' then
      return jsonb_build_object('queued', false, 'reason', 'service_role_key_not_set', 'due', v_due);
    end if;
    perform net.http_post(
      url     := v_base || '/auto-staffing?mode=hourly&event=' || p_event::text,
      body    := jsonb_build_object('job', 'auto-staffing-first-round', 'eventId', p_event::text),
      params  := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || v_key));
  exception when others then
    raise warning 'auto_assign_first_round: %', sqlerrm;
    return jsonb_build_object('queued', false, 'reason', sqlerrm, 'due', v_due);
  end;

  return jsonb_build_object('queued', true, 'due', v_due);
end $$;

comment on function public.auto_assign_first_round(uuid) is
  '§3.4 "from the moment the event is created": posts one hourly-mode auto-staffing round for this event''s due sections (auto_assign_due_shifts(''hourly'') narrowed to the event — both switches on, not started, short of headcount + buffer) to the Edge Function, with the same guarded base URL and Vault bearer the cron command uses. Admin only. Never raises past the save that called it: queued=false with a reason when auto-assign is off, nothing is due, or the base URL / key is not configured — the :17 round catches up.';

revoke execute on function public.auto_assign_first_round(uuid) from public, anon;
grant  execute on function public.auto_assign_first_round(uuid) to authenticated, service_role;
