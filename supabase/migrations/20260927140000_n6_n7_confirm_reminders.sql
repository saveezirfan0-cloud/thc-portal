-- =====================================================================
-- N6 and N7: the confirmation reminders nothing ever queued (§3.5, §8)
--
-- docs/15 §3: "N6 / N7 confirm reminders are never queued (verified).
-- Templates exist, but no sender exists. Workers are released at 12:05
-- without the day-before reminder." The register has had both codes since
-- the start (packages/notifications/src/templates.ts); release_unready_
-- bookings() has queued N6b since 20260921141500. So the worker was told
-- they HAD been removed, and never that they were about to be.
--
-- Both are added to booking_tick(), not to a new job. They fire off one
-- booking's own clock exactly like N9, N9b and N13, and booking-tick runs
-- every minute — which is what lets a booking confirmed at 10:30 the day
-- before still get N6 at 10:31, before the noon deadline. The auto-staffing
-- cutoff mode was the other candidate and is the wrong one: it only runs
-- inside the 12:05 UK window, which is after N6 is any use.
--
-- The same two mechanisms as the rest of booking_tick:
--   * each send is one notification_outbox row with a unique key —
--     'N6:booking:<id>' and 'N7:booking:<id>' (the shape 0001_init's own
--     comment on `key` gives) — so the every-minute job writes it once;
--   * every rule reads the ROLE SECTION's start (RULE-18), never the event.
--
-- WHEN, in UK wall-clock time (§1.8)
-- ---------------------------------
-- §8 gives N6 "the day before (cutoff 12:00)" and N7 "on the day of the
-- shift", with no hour. The hours below are the wireframes' — the push
-- galleries stamp N6 at 08:00 (wireframes/staff/invites.html) and N7 at
-- 09:00 (wireframes/staff/shifts.html) — and they are listed in
-- packages/notifications/REGISTER-NOTES.md for THC to confirm.
--
--   N6   from 08:00 UK on the day before the section starts, until the
--        12:00 deadline (ready_deadline(), 20260921141500). Never after
--        it: at 12:00 the reminder has become a lie, and 12:05 sends N6b.
--        Audience: confirmed, "I'm ready" not pressed. A booking accepted
--        between 08:00 and 12:00 the day before is picked up on the next
--        minute; one accepted after 12:00 gets nothing, because there is
--        no deadline left to remind them of.
--
--   N7   from 09:00 UK on the day the section starts — or two hours
--        before the start, if that is earlier, but never before 00:00 UK
--        that day — until 30 minutes before the start, where N9's
--        "Time to check in" takes over (BG-01) and the Check-in monitor
--        stops showing "Not confirmed today" (§9.5). A breakfast shift at
--        07:00 would otherwise be reminded two hours after it began.
--        Audience: confirmed, not checked in, on-the-day confirm not
--        pressed. A reminder only: nothing here, or anywhere, releases a
--        slot for missing it (§3.5).
--
-- "The day before" and "the day of" are UK calendar days, computed the
-- way ready_deadline() computes the noon deadline: in Europe/London and
-- cast back, so both hold across BST and GMT. 590_n6_n7_confirm_reminders
-- holds them to both DST boundaries.
--
-- Neither fires for a cancelled booking, a cancelled event, or a closed
-- one: booking_tick's working set already excludes all three, and both
-- rules additionally require status = 'confirmed'.
-- =====================================================================

-- ---------------------------------------------------------------------
-- When each reminder becomes due, for a section starting at p_starts_at.
-- Separate functions so pgTAP can pin the arithmetic on its own and so
-- the one number THC may change is in one place.
-- ---------------------------------------------------------------------
create or replace function public.n6_due_at(p_starts_at timestamptz)
returns timestamptz
language sql
immutable
set search_path = public, extensions
as $$
  select (((p_starts_at at time zone 'Europe/London')::date - 1) + time '08:00')
         at time zone 'Europe/London'
$$;

comment on function public.n6_due_at(timestamptz) is
  'N6 (§3.5, §8): 08:00 UK on the day before the role section starts. It runs until ready_deadline() — 12:00 the same day — and never after (20260927140000).';

create or replace function public.n7_due_at(p_starts_at timestamptz)
returns timestamptz
language sql
immutable
set search_path = public, extensions
as $$
  with d as (select (p_starts_at at time zone 'Europe/London')::date as uk_day)
  select greatest(
           (d.uk_day + time '00:00') at time zone 'Europe/London',
           least((d.uk_day + time '09:00') at time zone 'Europe/London',
                 p_starts_at - interval '2 hours'))
    from d
$$;

comment on function public.n7_due_at(timestamptz) is
  'N7 (§3.5, §8): 09:00 UK on the day the role section starts, or two hours before the start if earlier, never before that UK day begins. It runs until 30 minutes before the start, where N9 takes over (20260927140000).';

revoke execute on function public.n6_due_at(timestamptz) from public, anon;
revoke execute on function public.n7_due_at(timestamptz) from public, anon;
grant  execute on function public.n6_due_at(timestamptz) to authenticated, service_role;
grant  execute on function public.n7_due_at(timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- booking_tick(), byte-for-byte 20260921155908 but for:
--   * four more columns in the working set (shift, event and the two
--     confirmation stamps), and the section's window in UK time for the
--     payload queue_booking_push() also writes;
--   * the N6 and N7 blocks, after BG-10;
--   * `n6` and `n7` in the returned counts;
--   * a word the BG-10 comment had lost ("without it").
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
  'BG-01/02/02b/03/09/10 (§7) and the N6/N7 confirmation reminders (§3.5, 20260927140000). Idempotent: notifications via the outbox key, violations via not-exists. Called every minute by the booking-tick Edge Function.';

-- create or replace keeps the grants, but they are the whole of this
-- function's security story (it raises No-shows), so restated.
revoke execute on function public.booking_tick(timestamptz) from public, anon, authenticated;
grant  execute on function public.booking_tick(timestamptz) to service_role;
