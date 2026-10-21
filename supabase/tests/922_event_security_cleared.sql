-- =====================================================================
-- 921 · Security-cleared events: bring a passport or driving licence ·
--       20261023100000 · ADR-0185
--
--   A. Shape: events.security_cleared is not null and false by default;
--      the three definers pin their search_path; the activity log names it.
--   B. SC1 goes out once when a booking is confirmed on a cleared event —
--      never at invitation, never for an event that is not cleared.
--   C. Ticking the box on an event that already has confirmed staff tells
--      each of them, once per booking however often it is ticked; clearing
--      it tells nobody.
--   D. The worker's read: their own confirmed bookings on a cleared event,
--      nobody else's; closed to anon; a client login gets nothing.
--   E. SC1 is urgent, as N5–N7.
-- =====================================================================
begin;
select plan(18);
\ir _shared/fixtures.psql

\set booking_c 'ffffffff-0000-4000-8000-0000000000c1'
\set booking_d 'ffffffff-0000-4000-8000-0000000000d1'

-- =====================================================================
-- A · Shape
-- =====================================================================
select is(
  (select is_nullable || ':' || column_default
     from information_schema.columns
    where table_schema = 'public' and table_name = 'events' and column_name = 'security_cleared'),
  'NO:false',
  'A: events.security_cleared is not null and false by default');
select is((select security_cleared from events where id = :'event_a'), false,
  'A: an event nobody ticks is not cleared');
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('bookings_security_cleared_notice', 'events_security_cleared_notice',
                        'staff_security_cleared_bookings')
      and p.prosecdef
      and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')),
  3,
  'A: the two triggers and the worker read are definers with a pinned search_path');

-- =====================================================================
-- B · SC1 when a booking is confirmed on a cleared event
-- =====================================================================
-- Event A is not cleared yet: a confirmation there queues nothing.
insert into bookings (id, shift_id, staff_id, status, source) values
  (:'booking_c', :'shift_a', :'staffb', 'invited', 'manual');
update bookings set status = 'confirmed', confirmed_at = now() where id = :'booking_c';
select is((select count(*)::int from notification_outbox where template = 'SC1'), 0,
  'B: confirming on an event that is not cleared queues no SC1');

-- C starts here: the box is ticked with staff A (booking_a) and staff B
-- (booking_c) already confirmed on the event.
update events set security_cleared = true where id = :'event_a';
select results_eq(
  $$ select key, channel::text, template, recipient_staff_id
       from notification_outbox where template = 'SC1' order by recipient_staff_id $$,
  format($$ values ('SC1:booking:' || %L, 'push'::text, 'SC1'::text, %L::uuid),
                   ('SC1:booking:' || %L, 'push'::text, 'SC1'::text, %L::uuid) $$,
         :'booking_a', :'staffa', :'booking_c', :'staffb'),
  'C: ticking the box tells each worker already confirmed, keyed on the booking');
select is(
  (select payload ->> 'event' from notification_outbox
    where template = 'SC1' and key = 'SC1:booking:' || :'booking_a'),
  'Fixture Event A',
  'C: the push names the event');
select is(
  (select payload ->> 'bookingId' from notification_outbox
    where template = 'SC1' and key = 'SC1:booking:' || :'booking_a'),
  :'booking_a',
  'C: and carries the booking, which the push opens');

update events set security_cleared = false where id = :'event_a';
select is((select count(*)::int from notification_outbox where template = 'SC1'), 2,
  'C: clearing the box tells nobody');
update events set security_cleared = true where id = :'event_a';
select is((select count(*)::int from notification_outbox where template = 'SC1'), 2,
  'C: ticking it again tells nobody twice — once per booking');

-- B, on a cleared event. Staff B is replaced by a fresh booking on the same
-- shift: invited first (nothing), then confirmed (SC1).
delete from bookings where id = :'booking_c';
insert into bookings (id, shift_id, staff_id, status, source) values
  (:'booking_d', :'shift_a', :'staffb', 'invited', 'manual');
select is((select count(*)::int from notification_outbox
            where template = 'SC1' and key = 'SC1:booking:' || :'booking_d'), 0,
  'B: an invitation queues no SC1 — it is asked of the confirmed');
update bookings set status = 'confirmed', confirmed_at = now() where id = :'booking_d';
select is((select count(*)::int from notification_outbox
            where template = 'SC1' and key = 'SC1:booking:' || :'booking_d'
              and recipient_staff_id = :'staffb'), 1,
  'B: confirming on a cleared event queues SC1 to that worker');
update bookings set status = 'confirmed' where id = :'booking_d';
select is((select count(*)::int from notification_outbox
            where template = 'SC1' and key = 'SC1:booking:' || :'booking_d'), 1,
  'B: re-saving a confirmed booking queues nothing more');

-- The activity log names the box.
select is((select audit_event_fields(e) ->> 'securityCleared' from events e where e.id = :'event_a'),
  'true',
  'A: the activity log carries securityCleared');

-- =====================================================================
-- D · The worker's read
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq(
  $$ select staff_security_cleared_bookings() $$,
  format($$ values (%L::uuid) $$, :'booking_a'),
  'D: staff A reads their own confirmed booking on the cleared event');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq(
  $$ select staff_security_cleared_bookings() $$,
  format($$ values (%L::uuid) $$, :'booking_d'),
  'D: staff B reads only theirs — not booking_b, whose event is not cleared, and not staff A''s');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is_empty($$ select staff_security_cleared_bookings() $$,
  'D: a client login is no worker and reads nothing');
reset role;

select ok(not has_function_privilege('anon', 'public.staff_security_cleared_bookings()', 'execute'),
  'D: anon cannot call the worker read');

-- =====================================================================
-- E · The send class
-- =====================================================================
select is(notification_priority('SC1'), 0::smallint, 'E: SC1 is urgent, as N5–N7');

select * from finish();
rollback;
