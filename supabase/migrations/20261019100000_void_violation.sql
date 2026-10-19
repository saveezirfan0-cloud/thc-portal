-- =====================================================================
-- 20261019100000 · Void a violation — ADR-0151
--
-- A violation raised against a booking that should never have existed
-- ("booked in by mistake") has no way out. resolve_violation() keeps the
-- row, demands a finish time and reclassifies; a booking that has already
-- been worked cannot be withdrawn (§3.6: worked → cancelled is not an
-- edge); and a plain DELETE is undone within a minute, because booking_tick()
-- raises No check-out again for any checked-in, never-checked-out booking
-- more than 4 h past its end that has no No check-out row.
--
--   1 · violation_was_voided(booking, type) — the tick's memory of a void.
--   2 · _void_violation() — moves the row out of `violations` and into
--       audit_log (entity 'booking', action 'violation.voided', the whole
--       row in data). Nothing that reads `violations` — the Check-in list,
--       staff_show_rate, the pay floor, the profile, the payroll lines —
--       needs to change: a voided violation is simply not there. Internal.
--   3 · void_violation() — the admin RPC: a note is mandatory, as for
--       resolve_violation (§9.5).
--   4 · booking_tick() restated from 20260929100000 with one added line in
--       BG-03 and BG-09: a type already voided for the booking is not
--       raised again. Nothing else in it changed.
--   5 · The nine violations on the four Leonardo Hotel St Pauls bookings of
--       17–18 Oct 2026 (Kumar Ayush, Manas Kumar, Vishal Kothakonda, Sarah
--       Page) — the staff were booked in by mistake. Matched by id, so on
--       any database that lacks them it changes nothing. The bookings stay
--       `worked`: pay is untouched here and is a decision for Finance.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The tick's memory
-- ---------------------------------------------------------------------
create or replace function public.violation_was_voided(p_booking uuid, p_type violation_type)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select exists (
    select 1 from audit_log a
     where a.entity = 'booking'
       and a.entity_id = p_booking
       and a.action = 'violation.voided'
       and a.data ->> 'type' = p_type::text
  )
$$;

comment on function public.violation_was_voided(uuid, violation_type) is
  'ADR-0151: true when a violation of this type was voided for the booking (audit_log, action violation.voided). booking_tick() reads it so BG-03 and BG-09 do not raise a voided violation again.';

revoke execute on function public.violation_was_voided(uuid, violation_type) from public, anon, authenticated;
grant  execute on function public.violation_was_voided(uuid, violation_type) to service_role;

-- ---------------------------------------------------------------------
-- 2 · The move. No caller check: it is reached only from void_violation()
--     and from the one-off below, and no role may execute it.
-- ---------------------------------------------------------------------
create or replace function public._void_violation(p_violation uuid, p_reason text, p_actor uuid)
returns violations
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v violations;
begin
  delete from violations where id = p_violation returning * into v;
  if v.id is null then
    return null;
  end if;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), p_actor, 'violation.voided', 'booking', v.booking_id,
          jsonb_build_object('violationId', v.id,
                             'staffId',     v.staff_id,
                             'type',        v.type::text,
                             'reason',      btrim(p_reason),
                             'violation',   to_jsonb(v)));
  return v;
end $$;

comment on function public._void_violation(uuid, text, uuid) is
  'ADR-0151: deletes the violation and writes it, whole, to audit_log as violation.voided against its booking. Returns the row, or null if there was none. Internal.';

revoke execute on function public._void_violation(uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3 · The admin RPC
-- ---------------------------------------------------------------------
create or replace function public.void_violation(p_violation uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v violations;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'admins_only' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'note_required' using errcode = 'P0001';
  end if;

  v := _void_violation(p_violation, p_reason, auth.uid());
  if v.id is null then
    raise exception 'violation_not_found' using errcode = 'P0002';
  end if;

  return jsonb_build_object('ok', true, 'type', v.type::text, 'bookingId', v.booking_id);
end $$;

comment on function public.void_violation(uuid, text) is
  'ADR-0151: removes a violation that should never have been raised (a booking made by mistake), with a mandatory reason. The row moves to audit_log (violation.voided) and booking_tick() will not raise that type again for the booking. Admin only.';

revoke execute on function public.void_violation(uuid, text) from public, anon;
grant  execute on function public.void_violation(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4 · booking_tick(), 20260929100000's body plus the voided guard in
--     BG-03 and BG-09.
-- ---------------------------------------------------------------------
create or replace function public.booking_tick(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_n9_in     integer := 0;
  v_n9_out    integer := 0;
  v_n9b       integer := 0;
  v_no_show   integer := 0;
  v_no_out    integer := 0;
  v_n13       integer := 0;
  v_n6        integer := 0;
  v_n7        integer := 0;
begin
  -- -------------------------------------------------------------------
  -- The working set. A booking is only in play while its event stands
  -- and its own booking has not been cancelled; `left`, `withdraw`,
  -- `cutoff` and `event_cancelled` all land in bookings.cancelled_at,
  -- and a cancelled event must not remind anybody of anything.
  --
  -- check_in_at / check_out_at come from the ACCEPTED press — the
  -- check_logs row with check_in_at set — not from whichever attempt was
  -- logged last (20260929100000).
  -- -------------------------------------------------------------------
  create temporary table _tick on commit drop as
  select b.id            as booking_id,
         b.staff_id,
         b.status,
         b.confirmed_at,
         b.day_before_confirmed_at,
         b.on_day_confirmed_at,
         s.id            as shift_id,
         e.id            as event_id,
         s.starts_at,
         s.ends_at,
         e.pays_breaks,
         e.title         as event_title,
         cl.check_in_at,
         cl.check_out_at
    from bookings b
    join shift_requirements s on s.id = b.shift_id
    join events e             on e.id = s.event_id
    left join lateral (
      select c.check_in_at, c.check_out_at
        from check_logs c
       where c.booking_id = b.id
         and c.check_in_at is not null
       order by c.check_in_at desc, c.attempted_at desc
       limit 1
    ) cl on true
   where b.cancelled_at is null
     and e.cancelled_at is null
     and b.status in ('confirmed', 'worked');

  -- -------------------------------------------------------------------
  -- BG-01 · "Time to check in", 30 minutes before the section starts.
  --   Skipped once they have checked in, which is what status 'worked'
  --   means here (0006's attempt_check_in sets it).
  -- -------------------------------------------------------------------
  with due as (
    select * from _tick
     where status = 'confirmed'
       and check_in_at is null
       and p_now >= starts_at - interval '30 minutes'
       and p_now <  starts_at
  ), queued as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select 'N9:booking:' || booking_id || ':check-in', 'push', 'N9', staff_id,
           jsonb_build_object('variant', 'check-in', 'bookingId', booking_id::text)
      from due
    on conflict (key) do nothing
    returning 1
  ) select count(*)::int into v_n9_in from queued;

  -- -------------------------------------------------------------------
  -- BG-02 · "Don't forget to check out", 30 minutes before the end.
  --   Only for somebody actually on shift, and skipped once they are out.
  -- -------------------------------------------------------------------
  with due as (
    select * from _tick
     where check_in_at is not null
       and check_out_at is null
       and p_now >= ends_at - interval '30 minutes'
       and p_now <  ends_at
  ), queued as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select 'N9:booking:' || booking_id || ':check-out', 'push', 'N9', staff_id,
           jsonb_build_object('variant', 'check-out', 'bookingId', booking_id::text)
      from due
    on conflict (key) do nothing
    returning 1
  ) select count(*)::int into v_n9_out from queued;

  -- -------------------------------------------------------------------
  -- BG-02b · "You still haven't checked out", 30 minutes after the end.
  --   Sent once, and it exists to stop BG-09 ever firing: it lands three
  --   and a half hours before the check-out button locks (RULE-02, §5.2).
  -- -------------------------------------------------------------------
  with due as (
    select * from _tick
     where check_in_at is not null
       and check_out_at is null
       and p_now >= ends_at + interval '30 minutes'
       and p_now <  ends_at + interval '4 hours'
  ), queued as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select 'N9b:booking:' || booking_id, 'push', 'N9b', staff_id,
           jsonb_build_object('event', event_title, 'bookingId', booking_id::text)
      from due
    on conflict (key) do nothing
    returning 1
  ) select count(*)::int into v_n9b from queued;

  -- -------------------------------------------------------------------
  -- BG-03 · No-show.
  --   At start + 30 for a booking confirmed at or before the start (§5.1).
  --   A booking confirmed AFTER the section had already started — the
  --   replacement pulled in by the buffer-exhausted escalation (§3.4) — is
  --   exempt from that: it is measured from a start it was never booked
  --   for, and its check-in stays open until the section ends. So its
  --   No-show is raised at the end instead, if it never arrived
  --   (20260929100000; before that it was never raised at all).
  -- -------------------------------------------------------------------
  with due as (
    select * from _tick
     where status = 'confirmed'
       and check_in_at is null
       and (
             ((confirmed_at is null or confirmed_at <= starts_at)
              and p_now >= starts_at + interval '30 minutes')
          or (confirmed_at > starts_at
              and p_now >= ends_at)
           )
       and not exists (
         select 1 from violations v
          where v.booking_id = _tick.booking_id and v.type = 'no_show'
       )
       and not violation_was_voided(_tick.booking_id, 'no_show')
  ), raised as (
    insert into violations (staff_id, booking_id, type, detected_at)
    select staff_id, booking_id, 'no_show', p_now from due
    returning 1
  ) select count(*)::int into v_no_show from raised;

  -- -------------------------------------------------------------------
  -- BG-09 · "No check-out" at end + 4 hours, when the button locks.
  --   Never a silent default: payable time is held until a manager
  --   resolves it by entering the actual finish (RULE-02, §9.5).
  -- -------------------------------------------------------------------
  with due as (
    select * from _tick
     where check_in_at is not null
       and check_out_at is null
       and p_now >= ends_at + interval '4 hours'
       and not exists (
         select 1 from violations v
          where v.booking_id = _tick.booking_id and v.type = 'no_checkout'
       )
       and not violation_was_voided(_tick.booking_id, 'no_checkout')
  ), raised as (
    insert into violations (staff_id, booking_id, type, detected_at)
    select staff_id, booking_id, 'no_checkout', p_now from due
    returning 1
  ) select count(*)::int into v_no_out from raised;

  -- -------------------------------------------------------------------
  -- BG-10 · The 6-hour break alert (§5.2b).
  --   Unpaid-break clients only, once per shift, skipped if any break has
  --   been started. Informational: no Violation, no effect on pay, and it
  --   does not pause the chargeable timer.
  --
  --   Bounded by the CHECK-OUT LOCK, not the scheduled end
  --   (20260929100000). §5.2b: the Breaks block "does not disable or
  --   disappear if the shift runs longer than planned", so a worker still
  --   checked in an hour into an overrun is still on site and is still
  --   prompted. One four hours past the end has gone home without checking
  --   out: the button has locked, BG-09 (above, same run) has raised No
  --   check-out, and they are not told to ask a manager on site.
  -- -------------------------------------------------------------------
  with due as (
    select * from _tick
     where pays_breaks = false
       and check_in_at is not null
       and check_out_at is null
       and p_now >= check_in_at + interval '6 hours'
       and p_now <  ends_at + interval '4 hours'
       and not exists (
         select 1 from breaks bk where bk.booking_id = _tick.booking_id
       )
       and not exists (
         select 1 from violations v
          where v.booking_id = _tick.booking_id and v.type = 'no_checkout'
       )
  ), queued as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select 'N13:booking:' || booking_id, 'push', 'N13', staff_id,
           jsonb_build_object('bookingId', booking_id::text)
      from due
    on conflict (key) do nothing
    returning 1
  ) select count(*)::int into v_n13 from queued;

  -- -------------------------------------------------------------------
  -- N6 · "Confirm tomorrow's shift by 12:00 today — or you'll be removed
  --   from it" (§3.5 stage 2, §8). 08:00 UK the day before, up to the
  --   noon deadline and never past it. Only a confirmed booking whose
  --   worker has not pressed "I'm ready" and that the cutoff can release
  --   (ready_cutoff_applies, 20260927140300). release_unready_bookings()
  --   releases only a booking this block has queued for (20260929100000).
  --
  --   Keyed on the start as well as the booking, so a moved shift is
  --   reminded again (20260929100000).
  -- -------------------------------------------------------------------
  with due as (
    select * from _tick
     where status = 'confirmed'
       and day_before_confirmed_at is null
       and ready_cutoff_applies(confirmed_at, starts_at)
       and p_now >= n6_due_at(starts_at)
       and p_now <  ready_deadline(starts_at)
  ), queued as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select booking_reminder_key('N6', booking_id, starts_at), 'push', 'N6', staff_id,
           jsonb_build_object('bookingId', booking_id, 'shiftId', shift_id, 'eventId', event_id,
                              'event', event_title,
                              'window', to_char(starts_at at time zone 'Europe/London', 'HH24:MI')
                                        || '–' || to_char(ends_at at time zone 'Europe/London', 'HH24:MI'))
      from due
    on conflict (key) do nothing
    returning 1
  ) select count(*)::int into v_n6 from queued;

  -- -------------------------------------------------------------------
  -- N7 · "Confirm today's shift" (§3.5 stage 3, §8). On the UK day the
  --   section starts, from n7_due_at() — 09:00, or two hours before the
  --   start if earlier, never before 00:00 — until n7_closes_at(): 30
  --   minutes before the start, but never less than 30 minutes after it
  --   opened, so a section starting just after midnight is reached
  --   (20260929100000). Only a confirmed booking, not yet checked in,
  --   whose worker has not pressed the on-the-day confirmation. A
  --   reminder: nothing is released for ignoring it.
  -- -------------------------------------------------------------------
  with due as (
    select * from _tick
     where status = 'confirmed'
       and check_in_at is null
       and on_day_confirmed_at is null
       and p_now >= n7_due_at(starts_at)
       and p_now <  n7_closes_at(starts_at)
  ), queued as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select booking_reminder_key('N7', booking_id, starts_at), 'push', 'N7', staff_id,
           jsonb_build_object('bookingId', booking_id, 'shiftId', shift_id, 'eventId', event_id,
                              'event', event_title,
                              'window', to_char(starts_at at time zone 'Europe/London', 'HH24:MI')
                                        || '–' || to_char(ends_at at time zone 'Europe/London', 'HH24:MI'))
      from due
    on conflict (key) do nothing
    returning 1
  ) select count(*)::int into v_n7 from queued;

  drop table _tick;

  return jsonb_build_object(
    'n9_check_in',  v_n9_in,
    'n9_check_out', v_n9_out,
    'n9b',          v_n9b,
    'no_show',      v_no_show,
    'no_checkout',  v_no_out,
    'n13',          v_n13,
    'n6',           v_n6,
    'n7',           v_n7
  );
end;
$$;

comment on function public.booking_tick(timestamptz) is
  'BG-01/02/02b/03/09/10 (§7) and the N6/N7 confirmation reminders (§3.5). N13 runs until the check-out lock (end + 4 h) unless No check-out is raised; a booking confirmed after its start is marked No-show at the end if it never checked in; N6/N7 are keyed on booking + start (20260929100000). A No-show or No check-out that was voided for the booking is not raised again (ADR-0151). Idempotent: notifications via the outbox key, violations via not-exists. Called every minute by the booking-tick Edge Function.';

revoke execute on function public.booking_tick(timestamptz) from public, anon, authenticated;
grant  execute on function public.booking_tick(timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- 5 · The nine violations booked in by mistake (office request, 19.10.2026)
-- ---------------------------------------------------------------------
do $$
declare
  v_id uuid;
begin
  foreach v_id in array array[
    '6d9ed31a-7dc5-4f22-8994-d0eb15974e46',  -- Kumar Ayush · No check-out
    'ba21b32c-2c02-4ad8-88e4-3e5318921856',  -- Kumar Ayush · Left the geofence
    '6f639d7e-9326-4482-b2b5-74bc97a9b8c9',  -- Manas Kumar · No check-out
    '79c11050-0fa5-4880-97b7-d828ba9cfdd9',  -- Manas Kumar · Left the geofence
    'd54182e9-903d-4d06-8ed4-3e8d33ce6007',  -- Vishal Kothakonda · No check-out
    '17a48fbc-e72a-4f77-af1a-7911f7495544',  -- Vishal Kothakonda · Left early
    '0db0d922-e7da-4739-bbe8-0240b4ed759c',  -- Vishal Kothakonda · Left the geofence
    '9d73665f-e0fb-4162-9240-313fbe194828',  -- Sarah Page · Left early
    '4a384b6b-278b-4293-b703-ebdf0f38c1b2'   -- Sarah Page · Left the geofence
  ]::uuid[]
  loop
    perform _void_violation(v_id, 'Booked in by mistake (office request, 19.10.2026)', null);
  end loop;
end $$;
