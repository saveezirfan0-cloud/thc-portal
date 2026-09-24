-- =====================================================================
-- The 12:05 cutoff releases only a worker who had the chance (§3.5)
--
-- release_unready_bookings() (20260921141500) dropped every confirmed,
-- not-ready booking once `now >= ready_deadline(start)` and `now < start`.
-- Two kinds of worker were caught who never faced the deadline at all:
--
--   * one who accepted AFTER 12:00 the day before. There was no deadline
--     left to meet, yet the next 12:05 run — on the day of the shift —
--     released them and sent N6b, "removed from your shift tomorrow",
--     about a shift that was today;
--   * one booked on the day itself (RULE-08 same-day auto-assign, or the
--     office), whose deadline was yesterday before they were even booked.
--
-- Neither could have pressed "I'm ready" in time — the Staff App shows a
-- same-day booking the Today card, not the ready prompt. §3.5: "Not pressed
-- by 12:00 → the system automatically releases the slot"; a worker only
-- fails to press it by 12:00 if they were booked before 12:00.
--
-- The rule, now in one place:
--
--   ready_cutoff_applies(confirmed_at, starts_at)
--     the booking was confirmed strictly before ready_deadline(starts_at).
--     A NULL confirmed_at is treated as NOT subject: every live confirm
--     path stamps it (accept_invite, accept_application), so a NULL is
--     hand-written data, and a hard release on an unknown is the wrong way
--     round — it removes a worker the system cannot show was ever warned.
--     reconfirm_booking() restamps confirmed_at, so a worker who accepts a
--     moved time after noon the day before is not released either.
--
--   release_unready_bookings(p_now) releases only when, in addition,
--     the section starts on a LATER UK day than p_now — i.e. the run is on
--     the day before (ready_deadline is noon that day, so this is the
--     "next UK day relative to the deadline"), never on the day of the
--     shift. A run that is late or repeated cannot reach a shift starting
--     today.
--
-- N6b stays as it was: queued inside the loop, so only for rows actually
-- released. N6 (booking_tick, 20260927140000) is held to the same rule so
-- it never warns somebody the cutoff will not touch, and the Staff App's
-- shiftCard() (packages/domain/src/staff.ts) shows "I'm ready" only to the
-- same bookings — readyCutoffApplies() there is this function's TS half.
-- =====================================================================

create or replace function public.ready_cutoff_applies(p_confirmed_at timestamptz, p_starts_at timestamptz)
returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  select p_confirmed_at is not null
     and p_confirmed_at < ready_deadline(p_starts_at)
$$;

comment on function public.ready_cutoff_applies(timestamptz, timestamptz) is
  '§3.5: is this booking subject to the 12:00 day-before "I''m ready" deadline? Only if it was confirmed before it. NULL confirmed_at: no. Shared by release_unready_bookings(), booking_tick()''s N6 and (in TS) shiftCard() (20260927140300).';

revoke execute on function public.ready_cutoff_applies(timestamptz, timestamptz) from public, anon;
grant  execute on function public.ready_cutoff_applies(timestamptz, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- release_unready_bookings(), 20260921141500 but for the two conditions
-- marked below.
-- ---------------------------------------------------------------------
create or replace function public.release_unready_bookings(p_now timestamptz default now())
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
      -- Had the chance: confirmed before the deadline (20260927140300).
      and ready_cutoff_applies(b.confirmed_at, sr.starts_at)
      and p_now >= ready_deadline(sr.starts_at)
      -- The day before, never the day of the shift (20260927140300).
      and (p_now at time zone 'Europe/London')::date
          < (sr.starts_at at time zone 'Europe/London')::date
    for update of b
  loop
    update bookings set status = 'cancelled', cancelled_at = p_now, cancel_cause = 'ready_cutoff'
     where id = r.id;
    perform queue_booking_push('N6b', r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

comment on function public.release_unready_bookings(timestamptz) is
  'The 12:00 day-before cutoff (§3.5, RULE-05). Releases a confirmed, not-ready booking only if it was confirmed before the deadline and its section starts on a later UK day than the run; queues N6b for exactly the rows released (20260927140300).';

revoke execute on function public.release_unready_bookings(timestamptz) from public, anon, authenticated;
grant  execute on function public.release_unready_bookings(timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- booking_tick(), 20260927140000 but for the ready_cutoff_applies() line
-- in the N6 block.
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
       order by c.attempted_at desc
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
  --   Bounded to the section's own window, which the scope's wording
  --   requires and the first test run proved: without it this also caught
  --   every worker who was six hours past check-in but whose shift had
  --   already finished — including one carrying a no_checkout violation —
  --   and told them to "ask your manager on site about taking your break"
  --   hours after they had gone home.
  -- -------------------------------------------------------------------
  with due as (
    select * from _tick
     where pays_breaks = false
       and check_in_at is not null
       and check_out_at is null
       and p_now >= check_in_at + interval '6 hours'
       and p_now <  ends_at
       and not exists (
         select 1 from breaks bk where bk.booking_id = _tick.booking_id
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
  --   worker has not pressed "I'm ready" — those are exactly the ones
  --   release_unready_bookings() will drop at 12:05.
  --
  --   The payload is queue_booking_push()'s, the helper N5 and N6b go
  --   through, so all three confirmation pushes carry the same fields.
  -- -------------------------------------------------------------------
  with due as (
    select * from _tick
     where status = 'confirmed'
       and day_before_confirmed_at is null
       -- Only a booking the 12:05 cutoff can actually release: one that
       -- was confirmed before the deadline (20260927140300).
       and ready_cutoff_applies(confirmed_at, starts_at)
       and p_now >= n6_due_at(starts_at)
       and p_now <  ready_deadline(starts_at)
  ), queued as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select 'N6:booking:' || booking_id, 'push', 'N6', staff_id,
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
  --   section starts, from n7_due_at() until 30 minutes before the
  --   start. Only a confirmed booking, not yet checked in, whose worker
  --   has not pressed the on-the-day confirmation. A reminder: nothing
  --   is released for ignoring it.
  -- -------------------------------------------------------------------
  with due as (
    select * from _tick
     where status = 'confirmed'
       and check_in_at is null
       and on_day_confirmed_at is null
       and p_now >= n7_due_at(starts_at)
       and p_now <  starts_at - interval '30 minutes'
  ), queued as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select 'N7:booking:' || booking_id, 'push', 'N7', staff_id,
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
  'BG-01/02/02b/03/09/10 (§7) and the N6/N7 confirmation reminders (§3.5, 20260927140000; N6 only for bookings the cutoff can release, 20260927140300). Idempotent: notifications via the outbox key, violations via not-exists. Called every minute by the booking-tick Edge Function.';

revoke execute on function public.booking_tick(timestamptz) from public, anon, authenticated;
grant  execute on function public.booking_tick(timestamptz) to service_role;
