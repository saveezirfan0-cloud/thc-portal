-- =====================================================================
-- N10 keyed per application, as N10c already is
--
-- queue_application_push() (20260925100000) keyed N10c on the booking AND
-- the application's applied_at, "so a re-application that closes again is
-- told again", but N10 on the booking alone: 'N10:booking:<id>'. A booking
-- row is reused (`bookings` is unique on shift + staff): an application
-- accepted (N10), then withdrawn by the office (N10b) or released at the
-- 12:05 cutoff (N6b), can be applied for again on Radar — apply_to_shift()
-- reopens the same row with a new applied_at — and accepted again. The
-- second N10 hit the first one's key, `on conflict do nothing` dropped it,
-- and the worker, last told "You've been removed", was never told they
-- were booked again. §8 marks N10 mandatory.
--
-- The body below is 20260925100000's byte for byte but for the key: N10
-- now carries the applied_at epoch exactly as N10c does. One application
-- is still one N10 (accept_application() is its only caller, once, on the
-- applied → confirmed transition).
-- =====================================================================

create or replace function public.queue_application_push(p_code text, p_booking uuid)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
  select p_code || ':booking:' || b.id::text || ':'
           || coalesce(floor(extract(epoch from b.applied_at))::bigint::text, '0'),
         'push', p_code, b.staff_id,
         jsonb_build_object('bookingId', b.id, 'shiftId', sr.id, 'eventId', ev.id,
                            'event', ev.title,
                            'date', to_char(sr.starts_at at time zone 'Europe/London', 'DD Mon YYYY'),
                            'window', to_char(sr.starts_at at time zone 'Europe/London', 'HH24:MI')
                                      || '–' || to_char(sr.ends_at at time zone 'Europe/London', 'HH24:MI'))
    from bookings b
    join shift_requirements sr on sr.id = b.shift_id
    join events ev on ev.id = sr.event_id
   where b.id = p_booking
      and p_code in ('N10', 'N10c')
  on conflict (key) do nothing
$$;

comment on function public.queue_application_push(text, uuid) is
  'Queues N10 (application accepted) or N10c (role filled without it) for one Radar application, with the {event} and {date} values the §8 register renders. Both are keyed per application — <code>:booking:<id>:<applied_at epoch> — so a re-application on a reopened booking that is accepted (N10) or closes (N10c) again is told again (20261021040100).';
