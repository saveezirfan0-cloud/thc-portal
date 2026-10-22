-- =====================================================================
-- Migration 20261024110000 · a late confirmer has one hour to press
--                            "I'm ready" (§3.5 stage 2; ADR-0196)
--
-- The gap this closes. §3.5 gives the day-before "I'm ready" one deadline,
-- 12:00 the day before. 20260927140300 (ready_cutoff_applies) exempted
-- anyone who confirmed AFTER that noon — they never faced it — and
-- 20260929100000 made mark_ready() refuse from noon on. Together a worker
-- who accepts at 18:09 for a shift tomorrow could not press "I'm ready"
-- (the app never showed the card, the database answered deadline_passed),
-- and could never be released for not pressing it either: confirmed with
-- no stage 2 at all, until the office noticed and withdrew them by hand.
--
-- The rule, instruction of the product owner, 22.10.2026:
--
--   A worker who confirms after the noon deadline, for a shift that starts
--   on a LATER UK day, has ONE HOUR from the moment they confirmed to press
--   "I'm ready". Not pressed → the slot is released, they are sent N6b and
--   auto-assign starts replacing them, exactly as at 12:05.
--
-- Deliberately narrow:
--   * a booking confirmed on the day of the shift is untouched (§3.5 stage 3
--     never releases; RULE-08's same-day replacements stay exempt);
--   * the on-time path (confirmed before noon) is untouched;
--   * a shift that starts before the hour is up cannot release anyone — the
--     window is capped at the start;
--   * nobody is released who was not warned (ADR-0034 §4 again): the warning
--     is an N6 push, variant "late", queued the minute after they confirm by
--     late_ready_tick(), and the release looks for that row — its key carries
--     the confirmation, so a re-confirmation is warned afresh.
--
-- reconfirm_booking() restamps confirmed_at, so a worker who accepts a moved
-- time after noon the day before is now on this clock too. That is the same
-- worker in the same position as a fresh accept: before this migration they
-- were simply never asked.
--
-- Shape, as the kit reminder (20261008180000): booking_tick() is not
-- restated. late_ready_tick() is its own function, called by the
-- booking-tick Edge Function; release_late_unready_bookings() is called by
-- the auto-staffing cutoff run, which re-fills after it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The rule, in one place.
-- ---------------------------------------------------------------------
create or replace function public.late_ready_applies(p_confirmed_at timestamptz, p_starts_at timestamptz)
returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  select p_confirmed_at is not null
     and p_confirmed_at >= ready_deadline(p_starts_at)
     and (p_confirmed_at at time zone 'Europe/London')::date
         < (p_starts_at at time zone 'Europe/London')::date
$$;

comment on function public.late_ready_applies(timestamptz, timestamptz) is
  '§3.5, ADR-0196: did this booking confirm after the noon "I''m ready" deadline but on a UK day before the shift? Then it has an hour from confirming. The complement of ready_cutoff_applies() for the afternoon before; same-day and NULL confirmations are neither.';

create or replace function public.late_ready_due_at(p_confirmed_at timestamptz, p_starts_at timestamptz)
returns timestamptz
language sql
immutable
set search_path = public, extensions
as $$
  select least(p_confirmed_at + interval '1 hour', p_starts_at)
$$;

comment on function public.late_ready_due_at(timestamptz, timestamptz) is
  'ADR-0196: when a late confirmer must have pressed "I''m ready" — one hour after confirming, never after the start. Only meaningful where late_ready_applies().';

-- The moment "I'm ready" stops being accepted for this booking.
create or replace function public.ready_due_at(p_confirmed_at timestamptz, p_starts_at timestamptz)
returns timestamptz
language sql
immutable
set search_path = public, extensions
as $$
  select case when late_ready_applies(p_confirmed_at, p_starts_at)
              then late_ready_due_at(p_confirmed_at, p_starts_at)
              else ready_deadline(p_starts_at) end
$$;

comment on function public.ready_due_at(timestamptz, timestamptz) is
  'mark_ready()''s deadline: 12:00 the day before, or for a booking confirmed after it the hour from confirming (ADR-0196). Mirrors readyDueAt() in packages/domain/src/staff.ts.';

-- One warning per confirmation of this start.
create or replace function public.late_ready_key(p_booking uuid, p_starts_at timestamptz, p_confirmed_at timestamptz)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select booking_reminder_key('N6', p_booking, p_starts_at)
         || ':late:' || extract(epoch from p_confirmed_at)::bigint::text
$$;

comment on function public.late_ready_key(uuid, timestamptz, timestamptz) is
  'The notification_outbox key of the late-confirmer warning (N6, variant late): the N6 key for this start plus the confirmation, so a re-confirmation is warned again and an earlier on-time N6 never stands in for it (ADR-0196).';

revoke execute on function public.late_ready_applies(timestamptz, timestamptz)           from public, anon;
revoke execute on function public.late_ready_due_at(timestamptz, timestamptz)            from public, anon;
revoke execute on function public.ready_due_at(timestamptz, timestamptz)                 from public, anon;
revoke execute on function public.late_ready_key(uuid, timestamptz, timestamptz)         from public, anon;
grant  execute on function public.late_ready_applies(timestamptz, timestamptz)           to authenticated, service_role;
grant  execute on function public.late_ready_due_at(timestamptz, timestamptz)            to authenticated, service_role;
grant  execute on function public.ready_due_at(timestamptz, timestamptz)                 to authenticated, service_role;
grant  execute on function public.late_ready_key(uuid, timestamptz, timestamptz)         to authenticated, service_role;

-- ---------------------------------------------------------------------
-- mark_ready(), 20260929100000 but for the deadline it reads.
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
  -- §3.5: noon the day before; for a worker who confirmed after it, the
  -- hour from confirming (20261024110000, ADR-0196).
  if now() >= ready_due_at(b.confirmed_at, sr.starts_at) then
    return jsonb_build_object('ok', false, 'reason', 'deadline_passed');
  end if;
  update bookings set day_before_confirmed_at = coalesce(day_before_confirmed_at, now())
   where id = b.id;
  return jsonb_build_object('ok', true);
end $$;

comment on function public.mark_ready(uuid) is
  '§3.5 stage 2, "I''m ready". Accepted before ready_due_at(confirmed_at, starts_at): 12:00 UK the day before, or for a booking confirmed after that noon the hour from confirming. Otherwise {ok:false, reason:''deadline_passed''} (20260929100000, 20261024110000).';

revoke execute on function public.mark_ready(uuid) from public, anon;
grant  execute on function public.mark_ready(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- The warning. Every minute, from the booking-tick Edge Function.
-- ---------------------------------------------------------------------
create or replace function public.late_ready_tick(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_n6 integer := 0;
begin
  with due as (
    select b.id as booking_id, b.staff_id, b.confirmed_at,
           s.id as shift_id, e.id as event_id, e.title as event_title,
           s.starts_at, s.ends_at
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
  ), queued as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select late_ready_key(booking_id, starts_at, confirmed_at), 'push', 'N6', staff_id,
           jsonb_build_object('variant', 'late',
                              'bookingId', booking_id, 'shiftId', shift_id, 'eventId', event_id,
                              'event', event_title,
                              'dueBy', to_char(late_ready_due_at(confirmed_at, starts_at)
                                               at time zone 'Europe/London', 'HH24:MI'),
                              'window', to_char(starts_at at time zone 'Europe/London', 'HH24:MI')
                                        || '–' || to_char(ends_at at time zone 'Europe/London', 'HH24:MI'))
      from due
    on conflict (key) do nothing
    returning 1
  ) select count(*)::int into v_n6 from queued;

  return jsonb_build_object('lateN6', v_n6);
end;
$$;

comment on function public.late_ready_tick(timestamptz) is
  'N6 (variant late): tells a worker who confirmed after the noon deadline that they have until one hour after confirming to press "I''m ready" (§3.5, ADR-0196). Idempotent by outbox key. Called every minute by the booking-tick Edge Function.';

revoke execute on function public.late_ready_tick(timestamptz) from public, anon, authenticated;
grant  execute on function public.late_ready_tick(timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- The release. Every five minutes, from the auto-staffing cutoff run, which
-- re-fills straight after it.
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
       -- And was told, about this confirmation.
       and exists (
         select 1 from notification_outbox o
          where o.key = late_ready_key(b.id, sr.starts_at, b.confirmed_at)
       )
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
  'ADR-0196: releases a confirmed booking whose worker confirmed after the noon deadline, was sent the late N6 and did not press "I''m ready" within the hour; queues N6b (variant late). cancel_cause ''ready_cutoff'', as the 12:05 release. Idempotent; called by every auto-staffing cutoff run, which re-fills after it.';

revoke execute on function public.release_late_unready_bookings(timestamptz) from public, anon, authenticated;
grant  execute on function public.release_late_unready_bookings(timestamptz) to service_role;
