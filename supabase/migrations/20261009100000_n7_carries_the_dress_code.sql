-- =====================================================================
-- Migration 20261009100000 · N7 carries the role section's dress code
--                            (§3.2, §3.5 stage 3, §8 N7, §9.7; ADR-0108)
--
-- Owner request, 09.10.2026: staff booked on a United Grand Lodge shift
-- are to be reminded on the morning of the shift — in the same push that
-- asks them to confirm — not to forget to arrive in their plain black
-- waistcoat and plain black tie.
--
-- The dress code is already the role section's own (shift_requirements.
-- dress_code, defaulted from the client + role rate card, §3.2/§9.7), so
-- the push names no client: every N7 for a section with a dress code now
-- carries it, and the register's 'dress-code' variant of N7 renders
--
--     Confirm today's shift — and don't forget to arrive in your
--     plain black waistcoat and plain black tie
--
-- A section with no dress code names no variant and gets §8's plain line,
-- exactly as before. The dress code is read at the moment the reminder is
-- queued — a change to it re-confirms everybody anyway (§3.5, N11b).
--
-- booking_tick() is restated ONCE here, from its latest body
-- (20260929100000), with two additions: `_tick` carries s.dress_code, and
-- the N7 payload adds `variant` + `dressCode` when the section has one.
-- Nothing else in the function moves. pgTAP 783 holds it; 590 and 612
-- still hold the timing and the keys.
-- =====================================================================

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
         s.dress_code,
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
  --   The push also carries the role section's dress code, when it has
  --   one (ADR-0108, 20261009100000): `variant: 'dress-code'` and
  --   `dressCode`, which the register renders as "— and don't forget to
  --   arrive in your <dress code>". A section with no dress code names
  --   no variant and gets §8's plain line.
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
           || case when nullif(btrim(dress_code), '') is null then '{}'::jsonb
                   else jsonb_build_object('variant', 'dress-code', 'dressCode', btrim(dress_code))
              end
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
  'BG-01/02/02b/03/09/10 (§7) and the N6/N7 confirmation reminders (§3.5). N13 runs until the check-out lock (end + 4 h) unless No check-out is raised; a booking confirmed after its start is marked No-show at the end if it never checked in; N6/N7 are keyed on booking + start (20260929100000); N7 carries the section''s dress code when it has one (ADR-0108, 20261009100000). Idempotent: notifications via the outbox key, violations via not-exists. Called every minute by the booking-tick Edge Function.';

