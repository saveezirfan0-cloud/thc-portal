-- =====================================================================
-- Migration 20261024130000 · a late confirmer is reminded every 15 minutes
--                            to press "I'm ready" (§3.5; ADR-0197, amends
--                            ADR-0196 and 20261024110000)
--
-- 20261024110000 gave a worker who confirms after the noon deadline one hour
-- to press "I'm ready", warned them once (N6, variant late) and released
-- them at the hour (N6b, variant late) — one push in the whole hour.
-- Product owner, 23.10.2026: remind them every 15 minutes, say they have an
-- hour and exactly when it runs out, and when it does tell them they have
-- been withdrawn and re-assign the space.
--
--   confirmed          N6 late        "You have 1 hour … until 19:09 (UK time)"
--   +15 / +30 / +45    N6 late-reminder "45 / 30 / 15 minutes left … by 19:09"
--   +60                released (unchanged), N6b late  "You have been removed
--                      from <event> … did not press I'm ready within 1 hour
--                      … your place is being offered to someone else"
--                      — the auto-staffing cutoff run then re-fills (unchanged)
--
-- Changed here, and only here:
--   * late_ready_tick(): after the first warning, one reminder per quarter
--     hour (steps 1–3), each naming the clock time the hour ends. One push
--     per booking per tick, however many ticks were missed; none once the
--     worker has pressed it or the hour is up. A booking whose first tick
--     came late is sent the first warning, not a burst.
--   * release_late_unready_bookings(): "was told" is now ANY push of the
--     hour — the first warning or a reminder — so a worker who was only
--     reached by a reminder is still released, and one reached by nothing
--     still is not (ADR-0034 §4).
--   * late_ready_step_key(), late_ready_told(): the reminder's outbox key
--     and the "was told" test. The first warning's key (late_ready_key) is
--     unchanged, so rows already queued still count.
--
-- Nothing else moves: the rule (late_ready_applies), the hour
-- (late_ready_due_at), mark_ready(), the cap at the start, the same-day
-- exemption. No new template code: N6 gains a variant, N6b's late copy is
-- reworded. booking_tick() is not restated.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The reminder's key: the first warning's key plus the step (1–3).
-- ---------------------------------------------------------------------
create or replace function public.late_ready_step_key(
  p_booking uuid, p_starts_at timestamptz, p_confirmed_at timestamptz, p_step int)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select late_ready_key(p_booking, p_starts_at, p_confirmed_at) || ':' || p_step::text
$$;

comment on function public.late_ready_step_key(uuid, timestamptz, timestamptz, int) is
  'The notification_outbox key of the step-th (1–3) late "I''m ready" reminder of one confirmation: late_ready_key() plus the step (ADR-0197).';

-- Has this confirmation been sent anything — the first warning or a reminder?
create or replace function public.late_ready_told(
  p_booking uuid, p_starts_at timestamptz, p_confirmed_at timestamptz)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  -- An exact list, not a LIKE: the keys are the first warning and steps 1–3,
  -- and `key in (…)` is four index lookups where a prefix match would read
  -- the whole outbox.
  select exists (
    select 1 from notification_outbox o
     where o.key in (
       late_ready_key(p_booking, p_starts_at, p_confirmed_at),
       late_ready_step_key(p_booking, p_starts_at, p_confirmed_at, 1),
       late_ready_step_key(p_booking, p_starts_at, p_confirmed_at, 2),
       late_ready_step_key(p_booking, p_starts_at, p_confirmed_at, 3))
  )
$$;

comment on function public.late_ready_told(uuid, timestamptz, timestamptz) is
  'ADR-0197: was this late confirmation sent the first warning or any reminder? What release_late_unready_bookings() needs before it removes anyone (ADR-0034 §4).';

revoke execute on function public.late_ready_step_key(uuid, timestamptz, timestamptz, int) from public, anon;
revoke execute on function public.late_ready_told(uuid, timestamptz, timestamptz)          from public, anon;
grant  execute on function public.late_ready_step_key(uuid, timestamptz, timestamptz, int) to authenticated, service_role;
grant  execute on function public.late_ready_told(uuid, timestamptz, timestamptz)          to authenticated, service_role;

-- ---------------------------------------------------------------------
-- The warning and the reminders. Every minute, from the booking-tick Edge
-- Function. 20261024110000 but for the reminders.
-- ---------------------------------------------------------------------
create or replace function public.late_ready_tick(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_first  integer := 0;
  v_remind integer := 0;
begin
  with due as (
    select b.id as booking_id, b.staff_id, b.confirmed_at,
           s.id as shift_id, e.id as event_id, e.title as event_title,
           s.starts_at, s.ends_at,
           late_ready_due_at(b.confirmed_at, s.starts_at) as due_at,
           -- whole quarter-hours since confirming: 0 the first quarter-hour,
           -- then 1, 2, 3; never more, the hour being up at 4.
           least(3, floor(extract(epoch from (p_now - b.confirmed_at)) / 900))::int as step,
           late_ready_told(b.id, s.starts_at, b.confirmed_at) as told
      from bookings b
      join shift_requirements s on s.id = b.shift_id
      join events e             on e.id = s.event_id
     where b.status = 'confirmed'
       and b.cancelled_at is null
       and b.day_before_confirmed_at is null
       and e.cancelled_at is null
       and late_ready_applies(b.confirmed_at, s.starts_at)
       and p_now >= b.confirmed_at
       and p_now <  late_ready_due_at(b.confirmed_at, s.starts_at)
  ), picked as (
    -- One push per booking per tick: the first warning if it has not gone,
    -- otherwise the reminder for the quarter-hour we are in.
    select d.*,
           not d.told as is_first,
           -- an hour cut short by the start cannot say "1 hour"
           d.due_at = d.confirmed_at + interval '1 hour' as full_hour,
           -- Keyed by the quarter-hour the message belongs to, first warning
           -- or not: the first quarter-hour is the base key, the next three
           -- are steps 1–3. A first warning that comes late at step 2 takes
           -- step 2's key, so the next tick does not send step 2's reminder
           -- straight after.
           case when d.step = 0 then late_ready_key(d.booking_id, d.starts_at, d.confirmed_at)
                else late_ready_step_key(d.booking_id, d.starts_at, d.confirmed_at, d.step) end as msg_key
      from due d
     where not d.told or d.step >= 1
  ), queued as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select msg_key, 'push', 'N6', staff_id,
           jsonb_build_object(
             -- "You have 1 hour" only while it is true: a full hour, still in
             -- its first quarter. A first warning that came late says how
             -- many minutes are left instead.
             'variant', case when is_first and full_hour and step = 0 then 'late' else 'late-reminder' end,
             'bookingId', booking_id, 'shiftId', shift_id, 'eventId', event_id,
             'event', event_title,
             -- when the hour runs out, in UK time
             'dueBy', to_char(due_at at time zone 'Europe/London', 'HH24:MI'),
             'dateTime', to_char(starts_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI')
                         || '–' || to_char(ends_at at time zone 'Europe/London', 'HH24:MI'),
             'window', to_char(starts_at at time zone 'Europe/London', 'HH24:MI')
                       || '–' || to_char(ends_at at time zone 'Europe/London', 'HH24:MI'),
             -- what is left of the hour: at this quarter-hour's mark (45, 30,
             -- 15), or from now for a first warning that came late
             'minutes', (select case when m = 1 then '1 minute' else m::text || ' minutes' end
                           from (select greatest(1, ceil(extract(epoch from (
                                   due_at - case when is_first then p_now
                                                 else confirmed_at + step * interval '15 minutes' end
                                 )) / 60))::int as m) left_to_go))
      from picked
    on conflict (key) do nothing
    returning key
  )
  -- "First" counts the workers warned for the first time, whatever the
  -- wording: a first warning that came late is worded as a reminder but is
  -- still the first push of the hour (929 pins this for a shortened hour).
  select count(*) filter (where p.is_first)::int,
         count(*) filter (where not p.is_first)::int
    into v_first, v_remind
    from queued q
    join picked p on p.msg_key = q.key;

  return jsonb_build_object('lateN6', v_first, 'lateReminders', v_remind);
end;
$$;

comment on function public.late_ready_tick(timestamptz) is
  'N6 (variants late, late-reminder): tells a worker who confirmed after the noon deadline that they have an hour to press "I''m ready", when it runs out, and reminds them at 15, 30 and 45 minutes (§3.5, ADR-0196, ADR-0197). One push per booking per tick; idempotent by outbox key. Called every minute by the booking-tick Edge Function.';

revoke execute on function public.late_ready_tick(timestamptz) from public, anon, authenticated;
grant  execute on function public.late_ready_tick(timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- The release, 20261024110000 but for what "was told" means.
-- ---------------------------------------------------------------------
create or replace function public.release_late_unready_bookings(p_now timestamptz default now())
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
       and late_ready_applies(b.confirmed_at, sr.starts_at)
       -- The hour is up, and the shift has not started: nobody is released
       -- into a start they were never going to reach a replacement for.
       and p_now >= late_ready_due_at(b.confirmed_at, sr.starts_at)
       and p_now <  sr.starts_at
       -- And was told, about this confirmation: the first warning or any
       -- reminder (ADR-0197).
       and late_ready_told(b.id, sr.starts_at, b.confirmed_at)
    for update of b
  loop
    update bookings set status = 'cancelled', cancelled_at = p_now, cancel_cause = 'ready_cutoff'
     where id = r.id;
    perform queue_booking_push('N6b', r.id);
    -- N6b's own copy speaks of the 12:00 deadline; this worker's was an hour.
    update notification_outbox
       set payload = payload || jsonb_build_object('variant', 'late')
     where key = 'N6b:booking:' || r.id::text and sent_at is null;
    n := n + 1;
  end loop;
  return n;
end $$;

comment on function public.release_late_unready_bookings(timestamptz) is
  'ADR-0196, ADR-0197: releases a confirmed booking whose worker confirmed after the noon deadline, was sent the late warning or a reminder and did not press "I''m ready" within the hour; queues N6b (variant late). cancel_cause ''ready_cutoff'', as the 12:05 release. Idempotent; called by every auto-staffing cutoff run, which re-fills after it.';

revoke execute on function public.release_late_unready_bookings(timestamptz) from public, anon, authenticated;
grant  execute on function public.release_late_unready_bookings(timestamptz) to service_role;
