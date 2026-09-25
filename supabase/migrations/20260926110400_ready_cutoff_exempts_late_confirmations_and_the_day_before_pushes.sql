-- =====================================================================
-- Migration 20260926110400 · the three-stage confirmation, as §3.5 and
--                            §8 actually describe it
--                            (§3.5, §8 N5/N6/N7/N13, BG-10; ADR-0029)
--
-- 1 · The 12:05 cutoff exempts a booking confirmed after the deadline.
--
-- release_unready_bookings() released every `confirmed` booking with no
-- "I'm ready" whose deadline had passed and whose section had not
-- started — with no test of WHEN the booking was confirmed. The
-- replacements the 12:05 re-fill itself produces (and any invitation
-- accepted the afternoon before) were therefore released at 12:05 ON THE
-- SHIFT DAY with N6b "…removed from your shift tomorrow…". §3.5: on the
-- day itself "finding a replacement is unrealistic", and stage 3 never
-- releases. A booking confirmed at or after ready_deadline(starts_at)
-- was never given the day-before stage and is left alone (the same
-- shape as BG-03's "confirmed after the start" exemption).
--
-- 2 · N6 and N7 are sent. Nothing queued either: N6 "Confirm tomorrow's
--     shift by 12:00 today — or you'll be removed from it" and N7
--     "Confirm today's shift" existed only in the register. booking_tick()
--     now queues both, once per booking, off the section's own clock
--     (RULE-18):
--
--       N6  the day before, from 08:00 Europe/London until the 12:00
--           deadline, to a confirmed booking with no day-before press —
--           and only where the booking was confirmed before the deadline
--           (a later one is exempt from the release, see 1, so there is
--           no deadline to warn about).
--       N7  on the day, from 08:00 Europe/London or two hours before the
--           start, whichever is earlier, until the start, to a confirmed
--           booking with no on-the-day press and no check-in. A reminder
--           only: nothing releases on it (§3.5).
--
--     08:00 is the wireframe's morning (shifts.html) and a defensible
--     hour to buzz a phone; §8 fixes only the day. ADR-0029 records it.
--
-- 3 · N5 carries what the register renders. queue_booking_push() wrote
--     {event, window}; the N5 body is "{role} · {event} · {dateTime} ·
--     {rate}/h", so the worker received "{role} · Gala Dinner · {dateTime}
--     · {rate}/h" with the braces in. The payload now carries role,
--     dateTime (Europe/London, "Fri 19 Sep 18:00–01:00"), date and rate —
--     the BASE pay_rate (§1.5: the worker sees base only; holiday is never
--     blended).
--
-- 4 · BG-10 is bounded by the check-out lock, not the scheduled end.
--     §5.2b: the breaks block "does not disable or disappear if the shift
--     runs longer than planned", and §8 gives N13 no end-of-shift skip.
--     The old `p_now < ends_at` protected against prompting a worker who
--     had gone home without checking out; that case is end + 4 h, when
--     the button locks and BG-09 raises No check-out — so the bound is
--     now end + 4 h and "no No check-out violation".
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · release_unready_bookings, from 20260921141500
-- ---------------------------------------------------------------------
create or replace function release_unready_bookings(p_now timestamptz default now())
returns int language plpgsql security definer set search_path = public, extensions as $$
declare r record; n int := 0;
begin
  for r in
    select b.id
    from bookings b
      join shift_requirements sr on sr.id = b.shift_id
      join events ev on ev.id = sr.event_id
    where b.status = 'confirmed'
      and b.day_before_confirmed_at is null
      and ev.cancelled_at is null
      and p_now >= ready_deadline(sr.starts_at)
      and p_now < sr.starts_at
      -- §3.5: a booking confirmed after the day-before deadline was never
      -- given stage 2, and stage 3 never releases.
      and (b.confirmed_at is null or b.confirmed_at < ready_deadline(sr.starts_at))
    for update of b
  loop
    update bookings set status = 'cancelled', cancelled_at = p_now, cancel_cause = 'ready_cutoff'
     where id = r.id;
    perform queue_booking_push('N6b', r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

comment on function release_unready_bookings(timestamptz) is
  '§3.5 stage 2, the 12:05 cutoff: releases confirmed bookings with no "I''m ready" once ready_deadline() has passed and the section has not started, and queues N6b. A booking confirmed at or after its own deadline is exempt (it was never given the day-before stage; on the day nothing releases).';

-- ---------------------------------------------------------------------
-- 3 · queue_booking_push, from 20260921141500, with the N5 values
-- ---------------------------------------------------------------------
create or replace function queue_booking_push(p_code text, p_booking uuid)
returns void language sql security definer set search_path = public as $$
  insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
  select p_code || ':booking:' || p_booking::text, 'push', p_code, b.staff_id,
         jsonb_build_object('bookingId', b.id, 'shiftId', sr.id, 'eventId', ev.id,
                            'invitationId', b.id, 'event', ev.title,
                            'role', r.name,
                            'date', to_char(sr.starts_at at time zone 'Europe/London', 'FMDay DD Mon'),
                            'dateTime', to_char(sr.starts_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI')
                                        || '–' || to_char(sr.ends_at at time zone 'Europe/London', 'HH24:MI'),
                            -- The BASE rate (§1.5): never charge_rate, holiday never blended.
                            'rate', '£' || to_char(sr.pay_rate, 'FM990.00'),
                            'window', to_char(sr.starts_at at time zone 'Europe/London', 'HH24:MI')
                                      || '–' || to_char(sr.ends_at at time zone 'Europe/London', 'HH24:MI'))
  from bookings b
    join shift_requirements sr on sr.id = b.shift_id
    join events ev on ev.id = sr.event_id
    join roles r on r.id = sr.role_id
  where b.id = p_booking
  on conflict (key) do nothing
$$;

comment on function queue_booking_push(text, uuid) is
  'Queues one push for one booking under its idempotency key (§8). The payload carries every value the register renders for N5/N6b: role, event, date, dateTime (Europe/London), rate (the worker''s BASE rate), window.';

-- ---------------------------------------------------------------------
-- 2 + 4 · booking_tick, from 20260921155908
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
  v_uk_today  date := (p_now at time zone 'Europe/London')::date;
  -- 08:00 Europe/London today, as an instant.
  v_uk_0800   timestamptz := ((p_now at time zone 'Europe/London')::date + time '08:00') at time zone 'Europe/London';
begin
  -- -------------------------------------------------------------------
  -- The working set. A booking is only in play while its event stands
  -- and its own booking has not been cancelled; `left`, `withdraw`,
  -- `cutoff` and `event_cancelled` all land in bookings.cancelled_at,
  -- and a cancelled event must not remind anybody of anything.
  -- -------------------------------------------------------------------
  create temporary table _tick on commit drop as
  select b.id            as booking_id,
         b.staff_id,
         b.status,
         b.confirmed_at,
         b.day_before_confirmed_at,
         b.on_day_confirmed_at,
         s.starts_at,
         s.ends_at,
         (s.starts_at at time zone 'Europe/London')::date as uk_start_date,
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
       order by c.attempted_at desc
       limit 1
    ) cl on true
   where b.cancelled_at is null
     and e.cancelled_at is null
     and b.status in ('confirmed', 'worked');

  -- -------------------------------------------------------------------
  -- §3.5 stage 2 · N6 "Confirm tomorrow's shift by 12:00 today", the day
  --   before, from 08:00 UK until the deadline. Only a booking confirmed
  --   BEFORE the deadline has one to meet (release_unready_bookings
  --   exempts the rest).
  -- -------------------------------------------------------------------
  with due as (
    select * from _tick
     where status = 'confirmed'
       and day_before_confirmed_at is null
       and check_in_at is null
       and uk_start_date = v_uk_today + 1
       and p_now >= v_uk_0800
       and p_now <  ready_deadline(starts_at)
       and (confirmed_at is null or confirmed_at < ready_deadline(starts_at))
  ), queued as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select 'N6:booking:' || booking_id, 'push', 'N6', staff_id,
           jsonb_build_object('bookingId', booking_id::text, 'event', event_title)
      from due
    on conflict (key) do nothing
    returning 1
  ) select count(*)::int into v_n6 from queued;

  -- -------------------------------------------------------------------
  -- §3.5 stage 3 · N7 "Confirm today's shift", on the day, from 08:00 UK
  --   or two hours before the start (whichever is earlier) until the
  --   start. A reminder, NOT a deadline: nothing releases on it.
  -- -------------------------------------------------------------------
  with due as (
    select * from _tick
     where status = 'confirmed'
       and on_day_confirmed_at is null
       and check_in_at is null
       and uk_start_date = v_uk_today
       and p_now >= least(v_uk_0800, starts_at - interval '2 hours')
       and p_now <  starts_at
  ), queued as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select 'N7:booking:' || booking_id, 'push', 'N7', staff_id,
           jsonb_build_object('bookingId', booking_id::text, 'event', event_title)
      from due
    on conflict (key) do nothing
    returning 1
  ) select count(*)::int into v_n7 from queued;

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
  -- BG-03 · No-show at start + 30.
  --   §5.1's exemption is the subtle part: a booking confirmed AFTER the
  --   section had already started — the replacement pulled in by the
  --   buffer-exhausted escalation (§3.4) — is measured from a start they
  --   were never booked for, so the window is meaningless for them and
  --   their check-in stays open until the shift ends.
  -- -------------------------------------------------------------------
  with due as (
    select * from _tick
     where status = 'confirmed'
       and check_in_at is null
       and p_now >= starts_at + interval '30 minutes'
       and (confirmed_at is null or confirmed_at <= starts_at)
       and not exists (
         select 1 from violations v
          where v.booking_id = _tick.booking_id and v.type = 'no_show'
       )
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
  --   Bounded by the CHECK-OUT LOCK, not the scheduled end: §5.2b says
  --   the breaks block "does not disable or disappear if the shift runs
  --   longer than planned". A worker still checked in an hour past the
  --   end is still on site and is still prompted; one four hours past it
  --   has gone home without checking out — the button has locked, BG-09
  --   has raised No check-out — and is not told to ask a manager on site.
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

  drop table _tick;

  return jsonb_build_object(
    'n6',           v_n6,
    'n7',           v_n7,
    'n9_check_in',  v_n9_in,
    'n9_check_out', v_n9_out,
    'n9b',          v_n9b,
    'no_show',      v_no_show,
    'no_checkout',  v_no_out,
    'n13',          v_n13
  );
end;
$$;

comment on function public.booking_tick(timestamptz) is
  'BG-01/02/02b/03/09/10 (§7) plus the §3.5 stage-2 (N6, the day before from 08:00 UK to the 12:00 deadline) and stage-3 (N7, on the day) pushes. Idempotent: notifications via the outbox key, violations via not-exists. Called every minute by the booking-tick Edge Function.';
