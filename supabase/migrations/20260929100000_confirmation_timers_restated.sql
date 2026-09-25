-- =====================================================================
-- Migration 20260929100000 · the confirmation timers, restated once
--                            (§3.5, §5.1, §5.2b, §7 BG-03/BG-10, §8 N6/N7/N13;
--                             ADR-0029, ADR-0030)
--
-- booking_tick() is restated ONCE here, from its latest body
-- (20260927140300), carrying every change of the 29.09 fix round, and the
-- three functions that must agree with it — mark_ready(),
-- release_unready_bookings() and two small helpers — beside it.
--
-- 1 · BG-10 / N13 is bounded by the check-out lock, not the scheduled end
--     (audit D1c, D27).
--     §5.2b: the Breaks block "is not tied to the shift's scheduled end
--     time and does not disable or disappear if the shift runs longer than
--     planned", and §8 gives N13 no end-of-shift skip. 20260927140300 kept
--     `p_now < ends_at`, so a worker still on site an hour into an overrun
--     was never prompted. The case that bound was written against — a
--     worker who went home without checking out — is the one RULE-02
--     already names: at end + 4 h the check-out button locks and BG-09
--     raises No check-out. So N13 now runs until end + 4 h and never for a
--     booking carrying a `no_checkout` violation (the intent of the
--     withdrawn 20260926130400, which never took effect).
--
-- 2 · N6 / N7 are keyed on the section's start as well as the booking
--     (audit D26).
--     'N6:booking:<id>' and 'N7:booking:<id>' were written once per booking
--     for ever, so a shift the office moved — N11, reconfirm_booking(),
--     which resets both confirmation stamps — got no reminder for its new
--     time. The key is now booking_reminder_key(code, booking, starts_at):
--     '<code>:booking:<id>:<start as epoch seconds>'. Same time → same key
--     → still one row however often the job runs; a moved time → a fresh
--     key → a fresh reminder.
--
-- 3 · N7 reaches a section starting between 00:00 and 01:00 UK (D26).
--     n7_due_at() is floored at 00:00 UK on the day, and the window used to
--     close at start − 30 min, so a 00:00–00:30 start had an empty window
--     and a 00:31–00:59 one had less than a minute. It now closes at
--     n7_closes_at(): start − 30 min, but never less than 30 minutes after
--     it opened and never after the start. A section starting at exactly
--     00:00 UK still gets none: there is no moment "on the day" before it,
--     and confirm_on_day() refuses before the UK day begins (ADR-0030).
--
-- 4 · Nobody is released at 12:05 who was not sent N6 (D26).
--     N6 goes out from booking_tick() — every minute, 08:00 UK the day
--     before until the noon deadline — to each booking the cutoff can
--     release. A booking accepted after the last tick before noon (11:59:30,
--     say) is subject to the cutoff (confirmed before 12:00) but no tick is
--     left to warn it, and a morning with booking-tick down warns nobody.
--     release_unready_bookings() now releases only a booking whose N6 for
--     its CURRENT start is in the outbox — the warning and the release are
--     the same set by construction. 20260927140300 already refused to
--     release on an unknown (NULL confirmed_at); this is the same rule for
--     the other unknown.
--
-- 5 · "I'm ready" is refused at the deadline (audit D25).
--     mark_ready() accepted a press any time before the start, so between
--     12:00 and the 12:05 run the deadline was soft, and with the cutoff now
--     retried all afternoon (auto-staffing) that would have been hours.
--     At or after ready_deadline(starts_at) it returns
--     {ok: false, reason: 'deadline_passed'}.
--
-- 6 · A booking confirmed after its start is marked No-show at the end if
--     it never arrived (audit D48).
--     §5.1 exempts it from the start + 30 lock, because it was never booked
--     for that start; its check-in stays open until the section ends. It
--     was exempt from BG-03 for ever instead, so a replacement who never
--     came left no trace. BG-03 now raises its No-show at ends_at.
--
-- 7 · The working set reads the ACCEPTED check-in (nit).
--     `_tick` took the latest check_logs attempt of any outcome. It now
--     takes the accepted press — the row with check_in_at set, which is
--     what attempt_check_in() writes on acceptance and resolve_violation()'s
--     "Get back" inserts.
--
-- ready_deadline() is not restated: it already builds 12:00 Europe/London
-- on the day before from the UK calendar date, and pgTAP 610 now holds it
-- to the same vectors as the TypeScript readyDeadline()
-- (packages/domain/src/readyDeadline.vectors.json), which was the half
-- that was wrong on DST days (audit D24).
-- =====================================================================

-- ---------------------------------------------------------------------
-- The reminder key (2). Immutable so pgTAP can pin it, and so booking_tick
-- and release_unready_bookings cannot spell it two ways.
-- ---------------------------------------------------------------------
create or replace function public.booking_reminder_key(p_code text, p_booking uuid, p_starts_at timestamptz)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select p_code || ':booking:' || p_booking::text || ':'
         || extract(epoch from p_starts_at)::bigint::text
$$;

comment on function public.booking_reminder_key(text, uuid, timestamptz) is
  'The notification_outbox key for a start-dependent booking reminder (N6, N7): <code>:booking:<id>:<start epoch seconds>. A moved start is a new key, so a moved shift is reminded again (20260929100000).';

revoke execute on function public.booking_reminder_key(text, uuid, timestamptz) from public, anon;
grant  execute on function public.booking_reminder_key(text, uuid, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- When N7 stops (3). Opens at n7_due_at() (20260927140000, unchanged).
-- ---------------------------------------------------------------------
create or replace function public.n7_closes_at(p_starts_at timestamptz)
returns timestamptz
language sql
immutable
set search_path = public, extensions
as $$
  select greatest(p_starts_at - interval '30 minutes',
                  least(p_starts_at, n7_due_at(p_starts_at) + interval '30 minutes'))
$$;

comment on function public.n7_closes_at(timestamptz) is
  'N7 (§3.5, §8): the end of its window. 30 minutes before the start, where N9 takes over — but never less than 30 minutes after n7_due_at() and never after the start, so a section starting 00:01–00:59 UK is still reminded. 00:00 exactly has no window (ADR-0030; 20260929100000).';

revoke execute on function public.n7_closes_at(timestamptz) from public, anon;
grant  execute on function public.n7_closes_at(timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- mark_ready(), 20260921141500 but for the deadline (5).
-- ---------------------------------------------------------------------
create or replace function public.mark_ready(p_booking uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare b bookings; sr shift_requirements;
begin
  select * into b from bookings where id = p_booking;
  if b.id is null then raise exception 'booking_not_found' using errcode = 'P0002'; end if;
  if current_app_role() is distinct from 'admin'
     and b.staff_id is distinct from (select id from staff where user_id = auth.uid()) then
    raise exception 'not_your_booking' using errcode = '42501';
  end if;
  if b.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'reason', 'not_confirmed');
  end if;
  select * into sr from shift_requirements where id = b.shift_id;
  if now() >= sr.starts_at then
    return jsonb_build_object('ok', false, 'reason', 'shift_started');
  end if;
  -- §3.5: "The deadline is 12:00 noon the day before." Hard at 12:00, not
  -- at whenever the 12:05 run happens to reach this row (20260929100000).
  if now() >= ready_deadline(sr.starts_at) then
    return jsonb_build_object('ok', false, 'reason', 'deadline_passed');
  end if;
  update bookings set day_before_confirmed_at = coalesce(day_before_confirmed_at, now())
   where id = b.id;
  return jsonb_build_object('ok', true);
end $$;

comment on function public.mark_ready(uuid) is
  '§3.5 stage 2, "I''m ready". Accepted only before ready_deadline(starts_at) — 12:00 UK the day before; at or after it the answer is {ok:false, reason:''deadline_passed''} (20260929100000).';

revoke execute on function public.mark_ready(uuid) from public, anon;
grant  execute on function public.mark_ready(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- release_unready_bookings(), 20260927140300 but for the N6 condition (4).
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
      -- And was told: N6 for this start is in the outbox (20260929100000).
      and exists (
        select 1 from notification_outbox o
         where o.key = booking_reminder_key('N6', b.id, sr.starts_at)
      )
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
  'The 12:00 day-before cutoff (§3.5, RULE-05). Releases a confirmed, not-ready booking only if it was confirmed before the deadline, was sent N6 for its current start, and its section starts on a later UK day than the run; queues N6b for exactly the rows released. Idempotent: auto-staffing calls it on every run from 12:05 UK to midnight (20260927140300, 20260929100000).';

revoke execute on function public.release_unready_bookings(timestamptz) from public, anon, authenticated;
grant  execute on function public.release_unready_bookings(timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- booking_tick(), 20260927140300 but for (1), (2), (3), (6) and (7).
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
  'BG-01/02/02b/03/09/10 (§7) and the N6/N7 confirmation reminders (§3.5). N13 runs until the check-out lock (end + 4 h) unless No check-out is raised; a booking confirmed after its start is marked No-show at the end if it never checked in; N6/N7 are keyed on booking + start (20260929100000). Idempotent: notifications via the outbox key, violations via not-exists. Called every minute by the booking-tick Edge Function.';

revoke execute on function public.booking_tick(timestamptz) from public, anon, authenticated;
grant  execute on function public.booking_tick(timestamptz) to service_role;
