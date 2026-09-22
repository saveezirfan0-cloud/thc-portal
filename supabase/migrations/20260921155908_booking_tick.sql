-- =====================================================================
-- booking_tick() — the per-booking timers (§7 BG-01/02/02b/03/09/10)
--
-- Six of the ten §7 rules fire off one booking's own clock, so they are
-- one sweep rather than six jobs. docs/01-architecture.md §4 registers it
-- as `booking-tick`, every minute.
--
-- The rules live here, in SQL, rather than in the Edge Function, for the
-- reason the rest of this schema gives: pgTAP can test them and the Edge
-- Function becomes a thin HTTP wrapper that cannot get the logic wrong.
--
-- Idempotency has two mechanisms, because there are two kinds of effect:
--
--   * Notifications go through notification_outbox, whose unique `key`
--     makes a second insert a no-op. A minute-by-minute job re-selects
--     the same booking many times; the key is what stops N9 being sent
--     sixty times in the half hour before a shift.
--   * Violations are guarded by `not exists`, because they have no
--     natural unique key and a second no_show row would double-count
--     against the show rate (§6).
--
-- Every rule reads the ROLE SECTION's window (RULE-18, §3.2) — never the
-- event's. Two roles on one event run at different times, and a worker's
-- reminders belong to their own section.
--
-- Times are timestamptz throughout, so "30 minutes before the start" is
-- an interval on an instant and needs no timezone reasoning. Only the
-- jobs pinned to a UK wall-clock hour do (§7), and none of these six is.
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
  --   requires and the first test run proved: without 
  --   this also caught every worker who was six hours past check-in but
  --   whose shift had already finished — including one carrying a
  --   no_checkout violation — and told them to "ask your manager on site
  --   about taking your break" hours after they had gone home.
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

  drop table _tick;

  return jsonb_build_object(
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
  'BG-01/02/02b/03/09/10 (§7). Idempotent: notifications via the outbox key, violations via not-exists. Called every minute by the booking-tick Edge Function.';

-- Same reasoning as 20260921130927: security definer in public means
-- PostgREST publishes it and PUBLIC holds EXECUTE by default. This one
-- raises violations and enqueues pushes, so anonymous access to it is a
-- way to forge a No-show against any worker.
revoke execute on function public.booking_tick(timestamptz) from public, anon, authenticated;
grant  execute on function public.booking_tick(timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- The registry entry can be enabled now: supabase/functions/booking-tick
-- exists in this commit, which is what 20260921130927 was waiting for.
--
-- ORDERING, and it matters: `install_job_schedules()` is a deploy step,
-- and it must run AFTER `supabase functions deploy`. Enabled here means
-- "install this schedule when you install schedules", not "a function is
-- already listening" — installing first would schedule a per-minute
-- net.http_post against a function that is not deployed yet, which is
-- the 404 loop the original migration went out of its way to avoid.
-- ---------------------------------------------------------------------
update job_schedules
   set enabled = true,
       note = 'BG-01/02/02b/03/09/10 per-booking timers (§7). Rules in booking_tick(); the Edge Function is a thin wrapper. Deploy functions before running install_job_schedules().'
 where job = 'booking-tick';
