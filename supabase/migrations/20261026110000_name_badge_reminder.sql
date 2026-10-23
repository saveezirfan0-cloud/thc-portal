-- =====================================================================
-- Migration 20261026110000 · bring your name badge (ADR-0204)
--
-- THC (23.10.2026): for all Leonardo Hotel St Paul's M&E shifts, remind
-- staff in the morning not to forget their name badge if they have been
-- given one.
--
-- The client already has clients.name_badges on (ADR-0081, the badges the
-- Allocation Timesheet carries), so the reminder follows that switch rather
-- than a second one: on the morning of every confirmed shift for a client
-- with name badges, the worker gets CR2 ("For your shift today") at the
-- time kit_reminder_due_at() gives (07:00 UK, or start - 3 h if earlier).
-- It is the same push as the client's kit message, so a role that also has
-- a kit message gets ONE notification carrying both, and CR2's own key
-- (booking + start) keeps it to one per shift. Nothing to acknowledge for
-- the badge alone; a kit message still stops once acknowledged.
--
-- No new notification code: CR2's switch, priority, template and deep link
-- are unchanged. Forward-only.
-- =====================================================================

create or replace function public.client_kit_reminder_tick(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cr2 int := 0;
  c_badge constant text :=
    'Don''t forget to bring your name badge today, if you have been given one.';
begin
  with due as (
    select b.id as booking_id, b.staff_id, s.starts_at, s.ends_at, e.title as event_title,
           ro.name as role_name, c.name as client_name,
           concat_ws(E'\n\n',
             case when r.kit_message is not null
                       and not exists (select 1 from booking_kit_acknowledgements k where k.booking_id = b.id)
                  then r.kit_message end,
             case when c.name_badges then c_badge end) as message
      from bookings b
      join shift_requirements s on s.id = b.shift_id
      join events e  on e.id = s.event_id
      join clients c on c.id = e.client_id
      join roles ro  on ro.id = s.role_id
      left join client_role_requirements r on r.client_id = e.client_id and r.role_id = s.role_id
     where (r.kit_message is not null or c.name_badges)
       and b.status = 'confirmed'
       and b.cancelled_at is null
       and e.cancelled_at is null
       and p_now >= kit_reminder_due_at(s.starts_at)
       and p_now <  s.starts_at
  ), queued as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select booking_reminder_key('CR2', booking_id, starts_at), 'push', 'CR2', staff_id,
           jsonb_build_object('bookingId', booking_id::text,
                              'event',     event_title,
                              'client',    client_name,
                              'role',      role_name,
                              'message',   message,
                              'window',    to_char(starts_at at time zone 'Europe/London', 'HH24:MI')
                                           || '–' || to_char(ends_at at time zone 'Europe/London', 'HH24:MI'))
      from due
     where message <> ''
    on conflict (key) do nothing
    returning 1
  ) select count(*)::int into v_cr2 from queued;

  return jsonb_build_object('cr2', v_cr2);
end $$;

comment on function public.client_kit_reminder_tick(timestamptz) is
  'ADR-0110/0204: queues CR2 for every confirmed booking from kit_reminder_due_at() until the start — the client''s kit message (until acknowledged) and, for a client with name_badges on, the bring-your-name-badge line, in one push. Keyed on booking + start (booking_reminder_key) so a moved shift is reminded again and a re-run never double-sends. Called every minute by the booking-tick Edge Function beside booking_tick().';

revoke execute on function public.client_kit_reminder_tick(timestamptz) from public, anon, authenticated;
grant  execute on function public.client_kit_reminder_tick(timestamptz) to service_role;
