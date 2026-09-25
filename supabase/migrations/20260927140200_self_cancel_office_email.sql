-- =====================================================================
-- E10: the office hears about a self-cancel (§9.12, RULE-04, §3.6)
--
-- docs/15 §3: "Self-cancel email to admin@ (§9.12) has no code and no
-- sender." §9.12: "A worker's self-cancel of a confirmed booking (RULE-04,
-- §3.6) also triggers an immediate email to admin@thehospitalitycompany.
-- co.uk, flagging which event/role/shift lost a confirmed worker so the
-- office can follow up if auto-assign doesn't backfill it in time."
--
-- §8 never lists it, so the register carries it as an extension, E10 —
-- the next free E-number, which packages/notifications/REGISTER-NOTES.md
-- had already pencilled in for exactly this. Copy, sender (admin) and the
-- admin@ recipient live in packages/notifications/src/templates.ts; this
-- writes the outbox row that carries the values.
--
-- Where it is queued
-- ------------------
-- Inside self_cancel_booking(), in the same transaction as the cancel: the
-- one function that makes the RULE-04 transition (20260921141500; the
-- Staff App's cancelSelf action calls it). A cancel that rolls back sends
-- nothing; one that commits cannot lose its email to a crash between two
-- writes. The key is 'E10:booking:<id>' — a booking self-cancels once
-- (cancelled is terminal, 20260924120000), so one key, one email.
--
-- What it carries
-- ---------------
-- Everything §9.12 asks for — event, role, shift — plus what the office
-- needs to decide whether to act: client and venue, who cancelled, the
-- confirmed count for the section AFTER the cancel against headcount and
-- the absolute buffer (shown "5 of 6 (+1)", never "of 7"), and whether
-- auto-assign is on for it at all (both switches, §3.4). If it is off,
-- nobody is going to backfill the slot but the office.
--
-- Times are UK (§1.8): the office reads scheduled times in UK time, and
-- the email says so.
-- =====================================================================

create or replace function public.queue_self_cancel_email(p_booking uuid, p_at timestamptz)
returns void
language sql
set search_path = public, extensions
as $$
  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  select 'E10:booking:' || b.id, 'email', 'E10',
         array['admin@thehospitalitycompany.co.uk'],
         jsonb_build_object(
           'event',       ev.title,
           'client',      c.name,
           'venue',       ev.venue_name,
           'role',        r.name,
           'date',        to_char(sr.starts_at at time zone 'Europe/London', 'Dy DD Mon YYYY'),
           'dateTime',    to_char(sr.starts_at at time zone 'Europe/London', 'Dy DD Mon YYYY HH24:MI')
                          || '–' || to_char(sr.ends_at at time zone 'Europe/London', 'HH24:MI'),
           'name',        s.first_name || ' ' || s.last_name,
           'employeeId',  coalesce(s.employee_id::text, '(not yet issued)'),
           'cancelledAt', to_char(p_at at time zone 'Europe/London', 'DD Mon YYYY HH24:MI'),
           'confirmed',   f.confirmed::text,
           'headcount',   sr.headcount::text,
           'buffer',      sr.buffer::text,
           'autoAssign',  case when ev.auto_assign and sr.auto_assign then 'on'
                               else 'off — this slot will only be filled by hand' end,
           'bookingId',   b.id::text,
           'shiftId',     sr.id::text,
           'eventId',     ev.id::text)
    from bookings b
    join staff s               on s.id  = b.staff_id
    join shift_requirements sr on sr.id = b.shift_id
    join events ev             on ev.id = sr.event_id
    join clients c             on c.id  = ev.client_id
    join roles r               on r.id  = sr.role_id
    cross join lateral shift_fill(sr.id) f
   where b.id = p_booking
  on conflict (key) do nothing
$$;

comment on function public.queue_self_cancel_email(uuid, timestamptz) is
  'E10 (§9.12): the office email for a worker''s self-cancel of a confirmed booking. One outbox row keyed E10:booking:<id>; copy in packages/notifications (20260927140200).';

-- Called only from self_cancel_booking(), which is security definer and so
-- runs it as the owner. Nobody else may queue office email.
revoke execute on function public.queue_self_cancel_email(uuid, timestamptz) from public, anon, authenticated;
grant  execute on function public.queue_self_cancel_email(uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- self_cancel_booking(), byte-for-byte 20260921141500 but for the E10
-- line after the update.
-- ---------------------------------------------------------------------
create or replace function public.self_cancel_booking(p_booking uuid)
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
  if sr.starts_at - now() <= interval '72 hours' then
    return jsonb_build_object('ok', false, 'reason', 'too_late');
  end if;
  update bookings
     set status = 'cancelled', cancelled_at = now(),
         cancel_cause = 'self_cancel', self_cancelled = true
   where id = b.id;
  -- §9.12: the office is told at once which event/role/shift lost a
  -- confirmed worker (E10, 20260927140200).
  perform queue_self_cancel_email(b.id, now());
  return jsonb_build_object('ok', true);
end $$;

comment on function public.self_cancel_booking(uuid) is
  'RULE-04 (§3.6): a worker cancels a confirmed booking while more than 72 hours remain. Sets self_cancelled (barred from the event) and queues E10 to admin@ (§9.12, 20260927140200).';
