-- =====================================================================
-- Migration 20261023100000 · Security-cleared events — staff bring ID
--   (ADR-0185; THC request 21.10.2026)
--
-- "Some events need to be 'security cleared' which means that the staff
-- members need to bring with them a form of ID: passport or driving
-- license. Can this please be a tick box when the event is being built and
-- staff need to be informed to bring this to the event. This should be
-- informed to the staff at the point they are confirmed on to the shift."
--
--   1 · events.security_cleared — default false, so every event on file,
--       and every new one nobody ticks, reads exactly as before. Event
--       level, as asked: the whole event is cleared, not one role section.
--       Not under the §3.2 edit lock (event_edit_lock_guard names the
--       columns it freezes, and this is not one) and it re-confirms
--       nobody (SILENT_FIELDS): it asks the booked to bring something, it
--       does not move the shift. Not a gate — nobody is refused a booking
--       for it, and check-in is unchanged (§5.1).
--   2 · audit_event_fields() — restated from 20261014093200 with
--       securityCleared, so ticking or clearing the box is in the activity
--       log ("event.updated").
--   3 · SC1 — the push that tells a worker to bring ID, queued
--       (a) by an AFTER trigger on bookings the moment a booking becomes
--       confirmed on a security-cleared event, so every path that
--       confirms one (Accept, first-to-confirm, auto-assign, a Radar
--       application accepted, a manual pick, a take over Radar) is covered
--       without being restated — the pattern CR1 uses (ADR-0110); and
--       (b) by an AFTER trigger on events when the box is ticked on an
--       event that already has confirmed staff, so people confirmed
--       before the tick are told too. Key SC1:booking:<id>, so a worker is
--       told once per booking however often the box is ticked and cleared.
--   4 · staff_security_cleared_bookings() — which of the caller's confirmed
--       bookings are on a security-cleared event, for the "Bring your
--       passport or driving licence" note on the shift screen the push
--       opens. A separate function rather than a column on
--       staff_shift_detail(), which 20261001215000 rewrites in place.
--   5 · notification_priorities() restated from 20261022170100 with SC1
--       (urgent, as N5–N7: it is about a shift that is days or hours away).
--
-- Nothing here edits an earlier migration. The client portal is unchanged:
-- its views name their columns (ADR-0004) and this is not one of them.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The column
-- ---------------------------------------------------------------------
alter table public.events
  add column if not exists security_cleared boolean not null default false;

comment on column public.events.security_cleared is
  'ADR-0185: the event is security cleared — staff must bring a passport or driving licence. Event level; ticked in the Shift Builder. Every worker confirmed on it is pushed SC1 (once per booking) and the shift screen carries the note. Not a booking gate, not under the §3.2 edit lock, re-confirms nobody.';

-- ---------------------------------------------------------------------
-- 2 · The activity log names it
-- ---------------------------------------------------------------------
create or replace function public.audit_event_fields(e events)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'title', e.title,
    'date', to_char(e.event_date, 'DD.MM.YYYY'),
    'client', (select c.name from clients c where c.id = e.client_id),
    'venue', e.venue_name,
    'venueAddress', e.venue_address,
    'radius', e.geofence_radius_m,
    'poNumber', e.po_number,
    'onsiteContact', e.onsite_contact,
    'notes', e.notes,
    'autoAssign', e.auto_assign,
    'languages', to_jsonb(e.required_languages),
    'securityCleared', e.security_cleared,
    'paysBreaks', e.pays_breaks,
    'paysBuffer', e.pays_buffer)
$$;

revoke all on function public.audit_event_fields(events) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3a · SC1 when a booking is confirmed on a security-cleared event
-- ---------------------------------------------------------------------
create or replace function public.bookings_security_cleared_notice()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_event text;
  v_when  text;
begin
  if new.status <> 'confirmed' or new.cancelled_at is not null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'confirmed' then return new; end if;

  select e.title, to_char(s.starts_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI')
    into v_event, v_when
    from shift_requirements s
    join events e on e.id = s.event_id
   where s.id = new.shift_id
     and e.security_cleared
     and e.cancelled_at is null;
  if not found then return new; end if;

  insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
  values ('SC1:booking:' || new.id, 'push', 'SC1', new.staff_id,
          jsonb_build_object('event', v_event, 'dateTime', v_when, 'bookingId', new.id::text))
  on conflict (key) do nothing;
  return new;
end $$;

drop trigger if exists bookings_security_cleared_notice on bookings;
create trigger bookings_security_cleared_notice
  after insert or update of status on bookings
  for each row execute function public.bookings_security_cleared_notice();

comment on function public.bookings_security_cleared_notice() is
  'ADR-0185: queues SC1 ("bring your passport or driving licence", once per booking) when a booking becomes confirmed on an event marked security cleared. A trigger on bookings, so every path that confirms one is covered.';
revoke execute on function public.bookings_security_cleared_notice() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3b · SC1 to the people already confirmed when the box is ticked
-- ---------------------------------------------------------------------
create or replace function public.events_security_cleared_notice()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.cancelled_at is not null or not new.security_cleared or old.security_cleared then
    return new;
  end if;

  -- Sections that have not finished: nobody needs telling about a shift
  -- that is over.
  insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
  select 'SC1:booking:' || b.id, 'push', 'SC1', b.staff_id,
         jsonb_build_object('event', new.title,
                            'dateTime', to_char(s.starts_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI'),
                            'bookingId', b.id::text)
    from shift_requirements s
    join bookings b on b.shift_id = s.id
   where s.event_id = new.id
     and s.ends_at > now()
     and b.status = 'confirmed'
     and b.cancelled_at is null
  on conflict (key) do nothing;
  return new;
end $$;

drop trigger if exists events_security_cleared_notice on events;
create trigger events_security_cleared_notice
  after update of security_cleared on events
  for each row
  when (old.security_cleared is distinct from new.security_cleared)
  execute function public.events_security_cleared_notice();

comment on function public.events_security_cleared_notice() is
  'ADR-0185: when "Security cleared" is ticked on an event that already has confirmed staff, queues SC1 for each of them (once per booking, the same key as the confirmation trigger). Clearing the box tells nobody.';
revoke execute on function public.events_security_cleared_notice() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4 · The worker's read: which of my shifts need ID
--
-- The caller's own confirmed bookings on a security-cleared event that has
-- not been cancelled and whose check-out window has not closed (end + 4 h,
-- RULE-02, as staff_shift_requirements). Nothing about any other worker.
-- ---------------------------------------------------------------------
create or replace function public.staff_security_cleared_bookings()
returns setof uuid
language sql
stable
security definer
set search_path = public, extensions
as $$
  select b.id
    from bookings b
    join shift_requirements s on s.id = b.shift_id
    join events e on e.id = s.event_id
   where b.staff_id = staff_caller()
     and e.security_cleared
     and e.cancelled_at is null
     and b.cancelled_at is null
     and b.status = 'confirmed'
     and s.ends_at + interval '4 hours' > now()
$$;

comment on function public.staff_security_cleared_bookings() is
  'ADR-0185: the ids of the caller''s confirmed, live bookings on a security-cleared event — for the "bring your passport or driving licence" note on the shift screen. Resolves the caller through staff_caller(); nobody else''s booking.';

revoke execute on function public.staff_security_cleared_bookings() from public, anon;
grant  execute on function public.staff_security_cleared_bookings() to authenticated;

-- ---------------------------------------------------------------------
-- 5 · notification_priorities(), restated from 20261022170100 with SC1
--     (urgent, as N5–N7). priorityValuesSql() renders these rows.
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
  'ADR-0158: the send class of every register code and document email — 0 urgent, 1 normal, 2 bulk. Mirrors SEND_PRIORITY in packages/notifications/src/priority.ts (priorityValuesSql() renders these rows; __tests__/priority.test.ts holds the two equal). INV1 added 20261022100000 (ADR-0176), DR1 20261022170100 (ADR-0180), SC1 20261023100000 (ADR-0185).';

revoke execute on function public.notification_priorities() from public, anon, authenticated;
grant execute on function public.notification_priorities() to service_role;
