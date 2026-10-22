-- =====================================================================
-- Migration 20261024120000 · a worker who accepts after the noon deadline
--                            gets an hour to press "I'm ready" (§3.5; ADR-0196)
--
-- §3.5's stage 2: "Not pressed by 12:00 → the system automatically releases
-- the slot". 20260927140300 exempted a worker who ACCEPTED after that noon —
-- they never faced the deadline — and left them on the shift with no stage 2
-- at all. Product owner, 22.10.2026: they are asked instead.
--
--   accepted after 12:00 the day before, for a shift starting on a later UK day
--     +15 min  push LR1 "Press I'm ready within 45 minutes"
--     +30 min  push LR1 "… within 30 minutes"
--     +45 min  push LR1 "… within 15 minutes"
--     +60 min  not pressed → released (cancel_cause 'ready_cutoff', exactly
--              as the noon rule), told with LR2, and re-filled by the same
--              auto-staffing run (the cutoff mode, every 5 minutes)
--
-- Not changed: a booking confirmed before the deadline keeps the noon rule
-- (N6 / N6b / 12:05); a booking made ON the day of the shift (RULE-08) is
-- still exempt; so is one made inside the last hour before the start, which
-- would be released at the shift.
--
-- Same safeguards as the noon rule (ADR-0034): the press is refused once the
-- hour has gone (`deadline_passed`), and nobody is released who was not sent
-- the first reminder for THIS confirmation. A booking whose hour ended before
-- this migration ran therefore stays: it was never warned.
--
-- booking_tick() is NOT restated: the reminders are their own function,
-- late_ready_tick(), run by the same booking-tick Edge Function (as
-- client_kit_reminder_tick() is). release_unready_bookings() and mark_ready()
-- are restated from 20260929100000, changed only where marked.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The rule. SQL half of lateReadyApplies() in packages/domain/src/staff.ts.
-- ---------------------------------------------------------------------
create or replace function public.late_ready_applies(p_confirmed_at timestamptz, p_starts_at timestamptz)
returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  select p_confirmed_at is not null
     -- the noon deadline had already come: ready_cutoff_applies() is false
     and p_confirmed_at >= ready_deadline(p_starts_at)
     -- accepted on the day before, not on the day of the shift
     and (p_confirmed_at at time zone 'Europe/London')::date
         < (p_starts_at at time zone 'Europe/London')::date
     -- and the hour is over before the shift starts
     and p_confirmed_at + interval '1 hour' <= p_starts_at
$$;

comment on function public.late_ready_applies(timestamptz, timestamptz) is
  '§3.5, ADR-0196: does the one-hour "I''m ready" apply? Accepted at or after ready_deadline(start), on a UK day before the shift''s, with the hour over before the start. NULL confirmed_at: no. TS half: lateReadyApplies() (20261024120000).';

create or replace function public.late_ready_closes_at(p_confirmed_at timestamptz)
returns timestamptz
language sql
immutable
set search_path = public, extensions
as $$ select p_confirmed_at + interval '1 hour' $$;

comment on function public.late_ready_closes_at(timestamptz) is
  'ADR-0196: the end of a late-accepted worker''s hour — the last moment mark_ready() accepts, and the first at which release_unready_bookings() releases (20261024120000).';

-- LR1 keys carry the confirmation as well as the step, so a shift the office
-- moves and the worker re-accepts (reconfirm_booking restamps confirmed_at)
-- is reminded afresh.
create or replace function public.late_ready_key(p_booking uuid, p_confirmed_at timestamptz, p_step int)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select 'LR1:booking:' || p_booking::text || ':'
         || extract(epoch from p_confirmed_at)::bigint::text || ':' || p_step::text
$$;

comment on function public.late_ready_key(uuid, timestamptz, int) is
  'The notification_outbox key for the step-th (1–3) late "I''m ready" reminder of one confirmation (20261024120000).';

revoke execute on function public.late_ready_applies(timestamptz, timestamptz) from public, anon;
revoke execute on function public.late_ready_closes_at(timestamptz)            from public, anon;
revoke execute on function public.late_ready_key(uuid, timestamptz, int)       from public, anon;
grant  execute on function public.late_ready_applies(timestamptz, timestamptz) to authenticated, service_role;
grant  execute on function public.late_ready_closes_at(timestamptz)            to authenticated, service_role;
grant  execute on function public.late_ready_key(uuid, timestamptz, int)       to authenticated, service_role;

-- ---------------------------------------------------------------------
-- mark_ready(), 20260929100000 but for the late window.
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
  -- §3.5: "The deadline is 12:00 noon the day before." Hard at 12:00 — except
  -- for a worker who accepted after it, whose hour from accepting is open
  -- (ADR-0196) and just as hard when it closes.
  if now() >= ready_deadline(sr.starts_at)
     and not (late_ready_applies(b.confirmed_at, sr.starts_at)
              and now() < late_ready_closes_at(b.confirmed_at)) then
    return jsonb_build_object('ok', false, 'reason', 'deadline_passed');
  end if;
  update bookings set day_before_confirmed_at = coalesce(day_before_confirmed_at, now())
   where id = b.id;
  return jsonb_build_object('ok', true);
end $$;

comment on function public.mark_ready(uuid) is
  '§3.5 stage 2, "I''m ready". Accepted before ready_deadline(starts_at) — 12:00 UK the day before — or, for a booking confirmed after it (late_ready_applies), until an hour after the confirmation; otherwise {ok:false, reason:''deadline_passed''} (20261024120000).';

revoke execute on function public.mark_ready(uuid) from public, anon;
grant  execute on function public.mark_ready(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- release_unready_bookings(), 20260929100000 but with the late rule beside
-- the noon one. The two are exclusive: the noon rule needs confirmed_at
-- before the deadline, the late one at or after it.
-- ---------------------------------------------------------------------
create or replace function public.release_unready_bookings(p_now timestamptz default now())
returns int language plpgsql security definer set search_path = public, extensions as $$
declare r record; n int := 0;
begin
  for r in
    select b.id,
           -- the late rule released it, not the noon one: it gets LR2, not N6b
           late_ready_applies(b.confirmed_at, sr.starts_at) as late
    from bookings b
      join shift_requirements sr on sr.id = b.shift_id
      join events ev on ev.id = sr.event_id
    where b.status = 'confirmed'
      and b.day_before_confirmed_at is null
      and ev.cancelled_at is null
      and (
        (
          -- The noon rule, unchanged (20260929100000).
          ready_cutoff_applies(b.confirmed_at, sr.starts_at)
          and p_now >= ready_deadline(sr.starts_at)
          and (p_now at time zone 'Europe/London')::date
              < (sr.starts_at at time zone 'Europe/London')::date
          and exists (
            select 1 from notification_outbox o
             where o.key = booking_reminder_key('N6', b.id, sr.starts_at)
          )
        )
        or (
          -- The late rule (ADR-0196): an hour after accepting, and only if
          -- the first reminder for this confirmation went out. Never at or
          -- after the start (late_ready_applies keeps the hour clear of it,
          -- and this keeps a rescheduled-earlier shift clear too).
          late_ready_applies(b.confirmed_at, sr.starts_at)
          and p_now >= late_ready_closes_at(b.confirmed_at)
          and p_now < sr.starts_at
          and exists (
            select 1 from notification_outbox o
             where o.key = late_ready_key(b.id, b.confirmed_at, 1)
          )
        )
      )
    for update of b
  loop
    update bookings set status = 'cancelled', cancelled_at = p_now, cancel_cause = 'ready_cutoff'
     where id = r.id;
    if r.late then
      insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
      select 'LR2:booking:' || b.id::text || ':' || extract(epoch from b.confirmed_at)::bigint::text,
             'push', 'LR2', b.staff_id,
             jsonb_build_object('bookingId', b.id, 'shiftId', sr.id, 'eventId', ev.id,
                                'event', ev.title,
                                'dateTime', to_char(sr.starts_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI')
                                            || '–' || to_char(sr.ends_at at time zone 'Europe/London', 'HH24:MI'))
        from bookings b
          join shift_requirements sr on sr.id = b.shift_id
          join events ev on ev.id = sr.event_id
       where b.id = r.id
      on conflict (key) do nothing;
    else
      perform queue_booking_push('N6b', r.id);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

comment on function public.release_unready_bookings(timestamptz) is
  'The "I''m ready" cutoff (§3.5, RULE-05). Noon rule: a confirmed, not-ready booking confirmed before the deadline, sent N6 for its start, on a run the day before the shift — N6b. Late rule (ADR-0196): a booking confirmed after the deadline, an hour after confirming, sent the first LR1 — LR2. Idempotent: the auto-staffing cutoff mode calls it every 5 minutes, all day (20261024120000).';

revoke execute on function public.release_unready_bookings(timestamptz) from public, anon, authenticated;
grant  execute on function public.release_unready_bookings(timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- The reminders. Run every minute by the booking-tick Edge Function, beside
-- booking_tick(). One push per step per confirmation, whatever the minute it
-- lands on: step = whole quarter-hours since accepting, so a tick that was
-- down for the first one sends the current step, never a burst.
-- ---------------------------------------------------------------------
create or replace function public.late_ready_tick(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_lr1 integer := 0;
begin
  with due as (
    select b.id          as booking_id,
           b.staff_id,
           b.confirmed_at,
           sr.id         as shift_id,
           ev.id         as event_id,
           ev.title      as event_title,
           sr.starts_at,
           sr.ends_at,
           floor(extract(epoch from (p_now - b.confirmed_at)) / 900)::int as step
      from bookings b
      join shift_requirements sr on sr.id = b.shift_id
      join events ev             on ev.id = sr.event_id
     where b.status = 'confirmed'
       and b.cancelled_at is null
       and b.day_before_confirmed_at is null
       and ev.cancelled_at is null
       and late_ready_applies(b.confirmed_at, sr.starts_at)
       and p_now >= b.confirmed_at + interval '15 minutes'
       and p_now <  late_ready_closes_at(b.confirmed_at)
  ), queued as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select late_ready_key(booking_id, confirmed_at, step), 'push', 'LR1', staff_id,
           jsonb_build_object('bookingId', booking_id, 'shiftId', shift_id, 'eventId', event_id,
                              'event', event_title,
                              'dateTime', to_char(starts_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI')
                                          || '–' || to_char(ends_at at time zone 'Europe/London', 'HH24:MI'),
                              -- 45, 30, 15: what is left of the hour at this step
                              'minutes', (60 - 15 * step)::text)
      from due
     where step between 1 and 3
    on conflict (key) do nothing
    returning 1
  ) select count(*)::int into v_lr1 from queued;

  return jsonb_build_object('lr1', v_lr1);
end;
$$;

comment on function public.late_ready_tick(timestamptz) is
  'ADR-0196: the "I''m ready" reminders for a worker who accepted after the noon deadline — LR1 at 15, 30 and 45 minutes after accepting, one per step per confirmation. Idempotent via the outbox key. Called every minute by the booking-tick Edge Function (20261024120000).';

revoke execute on function public.late_ready_tick(timestamptz) from public, anon, authenticated;
grant  execute on function public.late_ready_tick(timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- notification_priorities(), restated from 20261023100000 with LR1 and LR2
-- (urgent, as N6/N6b). priorityValuesSql() renders these rows.
-- ---------------------------------------------------------------------
create or replace function public.notification_priorities()
returns table (code text, priority smallint)
language sql immutable set search_path = public, extensions as $$
  select v.code, v.priority::smallint from (values
    ('BG08', 1),
    ('CL1', 1),
    ('CL2', 1),
    ('CL3', 1),
    ('CL4', 2),
    ('CL5', 1),
    ('CL6', 1),
    ('CP1', 1),
    ('CP2', 1),
    ('CP3', 1),
    ('CR1', 1),
    ('CR2', 0),
    ('CR3', 1),
    ('D1', 1),
    ('D2', 1),
    ('DR1', 1),
    ('E1', 1),
    ('E10', 0),
    ('E11', 1),
    ('E12', 1),
    ('E2', 1),
    ('E2b', 1),
    ('E3', 1),
    ('E4', 1),
    ('E5', 1),
    ('E5b', 1),
    ('E6', 1),
    ('E7', 1),
    ('E8', 1),
    ('E9', 1),
    ('INV1', 1),
    ('IR1', 2),
    ('LR1', 0),
    ('LR2', 0),
    ('N1', 2),
    ('N10', 0),
    ('N10b', 0),
    ('N10c', 0),
    ('N10d', 0),
    ('N10e', 0),
    ('N11', 0),
    ('N11b', 0),
    ('N12', 0),
    ('N13', 0),
    ('N14', 1),
    ('N15', 1),
    ('N2', 2),
    ('N3', 2),
    ('N4', 1),
    ('N5', 0),
    ('N6', 0),
    ('N6b', 0),
    ('N7', 0),
    ('N8', 1),
    ('N9', 0),
    ('N9b', 0),
    ('NS1', 1),
    ('OC1', 2),
    ('OC2', 2),
    ('OC3', 2),
    ('OC4', 2),
    ('OF1', 0),
    ('OF2', 0),
    ('OF3', 0),
    ('OF4', 0),
    ('OF5', 0),
    ('OF6', 0),
    ('OM1', 0),
    ('OM2', 0),
    ('RC1', 1),
    ('RC2', 1),
    ('RC3', 1),
    ('RC4', 1),
    ('RC5', 1),
    ('SC1', 0)
  ) as v(code, priority)
$$;

comment on function public.notification_priorities() is
  'ADR-0158: the send class of every register code and document email — 0 urgent, 1 normal, 2 bulk. Mirrors SEND_PRIORITY in packages/notifications/src/priority.ts (priorityValuesSql() renders these rows; __tests__/priority.test.ts holds the two equal). INV1 added 20261022100000 (ADR-0176), DR1 20261022170100 (ADR-0180), SC1 20261023100000 (ADR-0185), LR1 and LR2 20261024120000 (ADR-0196).';

revoke execute on function public.notification_priorities() from public, anon, authenticated;
grant execute on function public.notification_priorities() to service_role;
