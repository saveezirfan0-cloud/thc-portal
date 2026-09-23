-- =====================================================================
-- 511 · Cancel event as one transaction (§3.3)
--   20260925100100_cancel_event.sql
--
--   1. Admin only — not a worker, not a client, not anon.
--   2. Reason mandatory; the event is kept, marked Cancelled; auto-assign
--      stops (event and roles); confirmed, invited AND applied bookings →
--      cancelled / event_cancelled with N12 each; worked and closed rows
--      untouched; a second press is refused.
--   3. All or nothing: a failure part-way leaves the event live.
-- =====================================================================
begin;
select plan(22);
\ir _shared/fixtures.psql

\set ev  '51500000-0000-4000-8000-000000000001'
\set ev2 '51500000-0000-4000-8000-000000000002'
\set s1  '51510000-0000-4000-8000-000000000001'
\set s2  '51510000-0000-4000-8000-000000000002'
\set s3  '51510000-0000-4000-8000-000000000003'
\set bc  '51520000-0000-4000-8000-000000000001'
\set bi  '51520000-0000-4000-8000-000000000002'
\set ba  '51520000-0000-4000-8000-000000000003'
\set bw  '51520000-0000-4000-8000-000000000004'
\set bx  '51520000-0000-4000-8000-000000000005'
\set b2  '51520000-0000-4000-8000-000000000006'
\set w1  '51530000-0000-4000-8000-000000000001'
\set w2  '51530000-0000-4000-8000-000000000002'
\set w3  '51530000-0000-4000-8000-000000000003'
\set w4  '51530000-0000-4000-8000-000000000004'
\set w5  '51530000-0000-4000-8000-000000000005'

insert into staff (id, first_name, last_name, email, phone, dob, status) values
  (:'w1', 'Con', 'Firmed', 'w1@ce511.test', '+447700952001', date '1995-01-01', 'compliant'),
  (:'w2', 'In',  'Vited',  'w2@ce511.test', '+447700952002', date '1995-01-01', 'compliant'),
  (:'w3', 'Ap',  'Plied',  'w3@ce511.test', '+447700952003', date '1995-01-01', 'compliant'),
  (:'w4', 'Wor', 'Ked',    'w4@ce511.test', '+447700952004', date '1995-01-01', 'compliant'),
  (:'w5', 'Clo', 'Sed',    'w5@ce511.test', '+447700952005', date '1995-01-01', 'compliant');

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, auto_assign) values
  (:'ev',  :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'To Be Cancelled', current_date, true, true, true),
  (:'ev2', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Rolls Back', current_date + 20, true, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour, auto_assign) values
  -- Under way: somebody has checked in (§3.3's on-the-day edge case).
  (:'s1', :'ev',  :'role_id', now() - interval '1 hour', now() + interval '7 hours', 5, 1, 20, 12, 5, true),
  (:'s2', :'ev',  :'role_id', now() + interval '2 hours', now() + interval '10 hours', 5, 1, 20, 12, 5, true),
  (:'s3', :'ev2', :'role_id', now() + interval '20 days', now() + interval '20 days 8 hours', 5, 0, 20, 12, 5, true);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at, applied_at, cancelled_at, cancel_cause) values
  (:'bc', :'s2', :'w1', 'confirmed', 'auto', now(), null, null, null),
  (:'bi', :'s2', :'w2', 'invited',   'auto', null,  null, null, null),
  (:'ba', :'s2', :'w3', 'applied',   'self', null,  now(), null, null),
  (:'bw', :'s1', :'w4', 'worked',    'auto', now() - interval '2 hours', null, null, null),
  (:'bx', :'s2', :'w5', 'closed',    'auto', null,  null, now(), 'declined'),
  (:'b2', :'s3', :'w1', 'confirmed', 'auto', now(), null, null, null);

-- ---------------------------------------------------------------------
-- 1 · Who may call it
-- ---------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.cancel_event(uuid, text)', 'execute'),
  'anon cannot execute cancel_event');
set local role anon;
select throws_ok(format($$ select cancel_event(%L, 'x') $$, :'ev'), '42501', null, 'anon is refused');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select cancel_event(%L, 'x') $$, :'ev'), '42501', 'not_authorised',
  'a worker cannot cancel an event');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select cancel_event(%L, 'x') $$, :'ev'), '42501', 'not_authorised',
  'nor can the client whose event it is — §3.3 is the office''s action');
reset role;

-- ---------------------------------------------------------------------
-- 2 · The cancellation
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(cancel_event(:'ev', '   '), jsonb_build_object('ok', false, 'reason', 'reason_required'),
  'a blank reason is refused (§3.3: the manager must give one)');
select is((select cancelled_at from events where id = :'ev'), null, 'and nothing was cancelled');

select is(cancel_event(:'ev', '  Client cancelled — postponed  '),
  jsonb_build_object('ok', true, 'bookingsCancelled', 3),
  'cancelled: the confirmed, invited and applied bookings move');
select isnt((select cancelled_at from events where id = :'ev'), null, 'the event is marked Cancelled, and kept');
select is((select cancel_reason from events where id = :'ev'), 'Client cancelled — postponed',
  'with the reason, trimmed');
select is((select auto_assign from events where id = :'ev'), false, 'auto-assign stops for the event');
select is((select count(*)::int from shift_requirements where event_id = :'ev' and auto_assign), 0,
  'and for every role on it');
select is((select array_agg(status::text || '/' || coalesce(cancel_cause, '-') order by id)
             from bookings where id in (:'bc', :'bi', :'ba')),
  array['cancelled/event_cancelled', 'cancelled/event_cancelled', 'cancelled/event_cancelled'],
  'confirmed, invited and applied → cancelled / event_cancelled');
select is((select status::text from bookings where id = :'bw'), 'worked',
  'a checked-in booking is left as worked (§3.6 has no edge out; §3.3 pays the scheduled hours)');
select is((select status::text || '/' || cancel_cause from bookings where id = :'bx'), 'closed/declined',
  'a declined invitation is not re-cancelled');
select is((select array_agg(recipient_staff_id order by recipient_staff_id)
             from notification_outbox where template = 'N12'
              and key in ('N12:booking:' || :'bc', 'N12:booking:' || :'bi', 'N12:booking:' || :'ba')),
  array[:'w1'::uuid, :'w2'::uuid, :'w3'::uuid],
  'N12 to the confirmed, the invited AND the pending Radar applicant (confirmed 08.09.2026)');
select is((select count(*)::int from notification_outbox where template = 'N12'
            and recipient_staff_id in (:'w4', :'w5')), 0,
  'nobody else is told');
select is((select status::text from bookings where id = :'b2'), 'confirmed',
  'the same worker''s booking on another event is untouched');
select is((select count(*)::int from audit_log where action = 'event.cancelled' and entity_id = :'ev'), 1,
  'the cancellation is audited');

select is(cancel_event(:'ev', 'again'), jsonb_build_object('ok', false, 'reason', 'already_cancelled'),
  'a second press is refused');
select is((select cancel_reason from events where id = :'ev'), 'Client cancelled — postponed',
  'and does not overwrite the reason');
reset role;

-- ---------------------------------------------------------------------
-- 3 · All or nothing
-- ---------------------------------------------------------------------
create function public.t511_refuse_booking_update() returns trigger language plpgsql as $$
begin raise exception 'fixture_refusal'; end $$;
create trigger t511_refuse before update on bookings
  for each row when (old.shift_id = '51510000-0000-4000-8000-000000000003')
  execute function public.t511_refuse_booking_update();

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select cancel_event(%L, 'Client cancelled') $$, :'ev2'), 'P0001', 'fixture_refusal',
  'a bookings update that fails is surfaced, not swallowed');
select is((select cancelled_at from events where id = :'ev2'), null,
  'and the event write rolls back with it: no Cancelled event with live bookings');
reset role;

select * from finish();
rollback;
