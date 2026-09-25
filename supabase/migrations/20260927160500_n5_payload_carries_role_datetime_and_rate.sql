-- =====================================================================
-- Migration 20260927160500 · N5 carries what the register renders
--                            (§3.5, §8 N5; ADR-0029)
--
-- queue_booking_push() wrote {event, window}; the N5 body is "{role} ·
-- {event} · {dateTime} · {rate}/h", so the worker received "{role} · Gala
-- Dinner · {dateTime} · {rate}/h" with the braces in. The payload now
-- carries role, dateTime (Europe/London, "Fri 19 Sep 18:00–01:00"), date
-- and rate — the BASE pay_rate (§1.5: the worker sees base only; holiday
-- is never blended).
--
-- What this file no longer does. Written as 20260926130400 in the 26.09
-- audit round, it also restated release_unready_bookings() (the 12:05
-- cutoff exempting a booking confirmed after its deadline) and
-- booking_tick() (N6 and N7 queued; BG-10 bounded by the check-out lock).
-- The parallel round merged first as #56 decided the same two questions
-- in 20260927140000 (N6/N7) and 20260927140300 (ready_cutoff_applies();
-- BG-10 bounded to the section's own end, with the reason recorded
-- there), and on a fresh database those two ran after this one and won —
-- so the tree's behaviour, and the tests that pin it (110, 590, 593),
-- were already theirs. The live project then refused this round's files
-- outright: numbered 20260926, they sorted below the last migration
-- applied remotely (20260927140300), and `supabase db push` will not
-- insert a migration under an applied one without --include-all, which
-- ci.yml and docs/12 say never to pass blind. Had it been passed, this
-- file would have applied AFTER 140300 and put back the versions the
-- tree had already superseded — the live database and the test database
-- would have disagreed. So the round is renumbered 20260927160000–161300
-- (same order, same content) and the two superseded restatements are
-- removed here; docs/10 §3b, main's version wins. Only the N5 payload,
-- which nothing else re-defined, remains.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 3 · queue_booking_push, from 20260921141500, with the N5 values
-- ---------------------------------------------------------------------
create or replace function queue_booking_push(p_code text, p_booking uuid)
returns void language sql security definer set search_path = public as $$
  insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
  select p_code || ':booking:' || p_booking::text, 'push', p_code, b.staff_id,
         jsonb_build_object('bookingId', b.id, 'shiftId', sr.id, 'eventId', ev.id,
                            'invitationId', b.id, 'event', ev.title,
                            'role', r.name,
                            'date', to_char(sr.starts_at at time zone 'Europe/London', 'FMDay DD Mon'),
                            'dateTime', to_char(sr.starts_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI')
                                        || '–' || to_char(sr.ends_at at time zone 'Europe/London', 'HH24:MI'),
                            -- The BASE rate (§1.5): never charge_rate, holiday never blended.
                            'rate', '£' || to_char(sr.pay_rate, 'FM990.00'),
                            'window', to_char(sr.starts_at at time zone 'Europe/London', 'HH24:MI')
                                      || '–' || to_char(sr.ends_at at time zone 'Europe/London', 'HH24:MI'))
  from bookings b
    join shift_requirements sr on sr.id = b.shift_id
    join events ev on ev.id = sr.event_id
    join roles r on r.id = sr.role_id
  where b.id = p_booking
  on conflict (key) do nothing
$$;

comment on function queue_booking_push(text, uuid) is
  'Queues one push for one booking under its idempotency key (§8). The payload carries every value the register renders for N5/N6b: role, event, date, dateTime (Europe/London), rate (the worker''s BASE rate), window.';

