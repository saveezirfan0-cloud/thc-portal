-- ADR-0203 · A default morning reminder for every shift (uniform standards).
-- Product owner, 23.10.2026. Rides ADR-0110's kit message (CR2: 07:00 UK on the
-- day or start − 3 h, once per booking and start, until the worker confirms).
--
-- The message a worker gets for a booking is the client's own kit message for
-- that role (if any) followed by `settings.default_shift_message` (if any), one
-- acknowledgement for both. Blank the setting ('""') to switch the default off.

insert into settings (key, value)
values ('default_shift_message', to_jsonb(
  E'Look sharp. Every shift.\nUniform clean and pressed. Shoes polished. Hair neatly combed. Personal hygiene and grooming at the highest standard — always. You represent us the moment you walk in. Thank you.'::text))
on conflict (key) do nothing;

create or replace function public.shift_kit_message(p_client uuid, p_role uuid)
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
  select nullif(btrim(concat_ws(E'\n\n',
           (select nullif(btrim(r.kit_message), '')
              from client_role_requirements r
             where r.client_id = p_client and r.role_id = p_role),
           (select nullif(btrim(s.value #>> '{}'), '')
              from settings s
             where s.key = 'default_shift_message'))), '')
$$;
comment on function public.shift_kit_message(uuid, uuid) is
  'ADR-0203: what a worker is told on the morning of a shift for this client and role — the client''s kit message (ADR-0110) then settings.default_shift_message, either may be absent. Null when neither is set.';
revoke execute on function public.shift_kit_message(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.shift_kit_message(uuid, uuid) to service_role;

-- The worker's read: now a row for every live booking that has a quiz or a
-- message, the message being shift_kit_message().
create or replace function public.staff_shift_requirements()
returns table (
  booking_id          uuid,
  client_id           uuid,
  client_name         text,
  role_name           text,
  quiz_id             uuid,
  quiz_title          text,
  quiz_passed         boolean,
  quiz_attempts_used  int,
  quiz_attempts_max   int,
  kit_message         text,
  kit_due_at          timestamptz,
  kit_acknowledged_at timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select b.id,
         c.id,
         c.name,
         ro.name,
         q.id,
         q.title,
         case when q.id is null then null else client_quiz_passed(q.id, b.staff_id) end,
         case when q.id is null then null else client_quiz_attempts_used(q.id, b.staff_id) end,
         q.max_attempts,
         m.msg,
         case when m.msg is null then null else kit_reminder_due_at(s.starts_at) end,
         k.acknowledged_at
    from bookings b
    join shift_requirements s on s.id = b.shift_id
    join events e  on e.id = s.event_id
    join clients c on c.id = e.client_id
    join roles ro  on ro.id = s.role_id
    left join client_role_requirements r on r.client_id = e.client_id and r.role_id = s.role_id
    left join client_quizzes q on q.id = r.quiz_id and q.active
    left join booking_kit_acknowledgements k on k.booking_id = b.id
    cross join lateral (select shift_kit_message(e.client_id, s.role_id) as msg) m
   where b.staff_id = staff_caller()
     and b.cancelled_at is null
     and e.cancelled_at is null
     and b.status in ('invited', 'confirmed', 'worked')
     and s.ends_at + interval '4 hours' > now()
     and (q.id is not null or m.msg is not null)
   order by s.starts_at
$$;
comment on function public.staff_shift_requirements() is
  'ADR-0110, ADR-0203: for each of the caller''s live bookings with a requirement — the quiz and where they stand on it, and the morning message (the client''s kit message and the default, shift_kit_message) with when it is due and whether it was acknowledged. No charge rate, no other worker.';

create or replace function public.acknowledge_shift_kit(p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_staff uuid := staff_caller();
  b bookings;
  v_message text;
  v_at timestamptz;
begin
  if v_staff is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select * into b from bookings where id = p_booking;
  if b.id is null or b.staff_id <> v_staff then
    raise exception 'not_your_booking' using errcode = '42501';
  end if;
  if b.status not in ('confirmed', 'worked') or b.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_booked');
  end if;
  select shift_kit_message(e.client_id, s.role_id) into v_message
    from shift_requirements s
    join events e on e.id = s.event_id
   where s.id = b.shift_id;
  if v_message is null then
    return jsonb_build_object('ok', false, 'reason', 'nothing_to_acknowledge');
  end if;

  insert into booking_kit_acknowledgements (booking_id, staff_id)
  values (b.id, v_staff)
  on conflict (booking_id) do nothing;
  select acknowledged_at into v_at from booking_kit_acknowledgements where booking_id = b.id;

  return jsonb_build_object('ok', true, 'acknowledgedAt', v_at);
end $$;
comment on function public.acknowledge_shift_kit(uuid) is
  'ADR-0110, ADR-0203: the worker confirms they have read the morning message (shift_kit_message) for one of their confirmed bookings. Idempotent; refuses another worker''s booking, an unbooked one (not_booked) and one with no message (nothing_to_acknowledge).';

create or replace function public.client_kit_reminder_tick(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cr2 int := 0;
begin
  with due as (
    select b.id as booking_id, b.staff_id, s.starts_at, s.ends_at, e.title as event_title,
           ro.name as role_name, m.msg as kit_message, c.name as client_name
      from bookings b
      join shift_requirements s on s.id = b.shift_id
      join events e  on e.id = s.event_id
      join clients c on c.id = e.client_id
      join roles ro  on ro.id = s.role_id
      cross join lateral (select shift_kit_message(e.client_id, s.role_id) as msg) m
     where b.status = 'confirmed'
       and b.cancelled_at is null
       and e.cancelled_at is null
       and p_now >= kit_reminder_due_at(s.starts_at)
       and p_now <  s.starts_at
       and m.msg is not null
       and not exists (select 1 from booking_kit_acknowledgements k where k.booking_id = b.id)
  ), queued as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select booking_reminder_key('CR2', booking_id, starts_at), 'push', 'CR2', staff_id,
           jsonb_build_object('bookingId', booking_id::text,
                              'event',     event_title,
                              'client',    client_name,
                              'role',      role_name,
                              'message',   kit_message,
                              'window',    to_char(starts_at at time zone 'Europe/London', 'HH24:MI')
                                           || '–' || to_char(ends_at at time zone 'Europe/London', 'HH24:MI'))
      from due
    on conflict (key) do nothing
    returning 1
  ) select count(*)::int into v_cr2 from queued;

  return jsonb_build_object('cr2', v_cr2);
end $$;
comment on function public.client_kit_reminder_tick(timestamptz) is
  'ADR-0110, ADR-0203: queues CR2 for every confirmed booking whose shift_kit_message is set (the client''s kit message and/or the default), from kit_reminder_due_at() until the start, unless acknowledged. Keyed on booking + start so a moved shift is reminded again and a re-run never double-sends. Called every minute by the booking-tick Edge Function.';
