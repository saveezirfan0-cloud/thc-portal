-- =====================================================================
-- 904 · Notifications sweep (19.10.2026)
--   20261021040000_n10c_when_headcount_drops.sql, and the §8 timers
--   across the 25.10.2026 clock change
--
--   1. N10c when the office lowers a role's headcount to what is already
--      confirmed: the pending Radar applications close (closed /
--      slot_taken) with one N10c each and no N10 — §8 "the moment the role
--      becomes fully confirmed". A rise, or a drop that leaves a seat, closes
--      nothing; a second drop tells nobody twice.
--   2. Europe/London on Sunday 25 October 2026 (BST → GMT at 02:00):
--      N6 at 08:00 UK the day before and the 12:00 deadline on the BST
--      Saturday and on the GMT Sunday; N7 at 09:00 UK (or start − 2 h);
--      the 12:05 and 05:00 job gates; N6, the 12:05 release with N6b and
--      N9 driven through booking_tick() / release_unready_bookings() at
--      fixed instants either side of the change.
--   3. N10 keyed per application (20261021040100): an application accepted,
--      withdrawn by the office, applied for again on the same booking row
--      and accepted again is told "You're booked!" again.
-- =====================================================================
begin;
select plan(36);
\ir _shared/fixtures.psql

\set ev    '90400000-0000-4000-8000-000000000001'
\set s_hc  '90410000-0000-4000-8000-000000000001'
\set s_sun '90410000-0000-4000-8000-000000000002'
\set s_mon '90410000-0000-4000-8000-000000000003'
\set h1    '90420000-0000-4000-8000-000000000001'
\set h2    '90420000-0000-4000-8000-000000000002'
\set h3    '90420000-0000-4000-8000-000000000003'
\set d1    '90420000-0000-4000-8000-000000000004'
\set d2    '90420000-0000-4000-8000-000000000005'
\set b_h1  '90430000-0000-4000-8000-000000000001'
\set b_h2  '90430000-0000-4000-8000-000000000002'
\set b_app '90430000-0000-4000-8000-000000000003'
\set b_sun '90430000-0000-4000-8000-000000000004'
\set b_mon '90430000-0000-4000-8000-000000000005'
\set s_r   '90410000-0000-4000-8000-000000000004'
\set r1    '90420000-0000-4000-8000-000000000006'

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'h1', 'Hana', 'One',   'h1@sweep904.test', '+447700990401', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'h2', 'Hugo', 'Two',   'h2@sweep904.test', '+447700990402', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'h3', 'Hal',  'Three', 'h3@sweep904.test', '+447700990403', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'d1', 'Dora', 'Sun',   'd1@sweep904.test', '+447700990404', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'d2', 'Dan',  'Mon',   'd2@sweep904.test', '+447700990405', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'r1', 'Rae',  'Again', 'r1@sweep904.test', '+447700990406', date '1995-01-01', 'compliant', 'uk_irish');
insert into staff_roles (staff_id, role_id)
select id, :'role_id' from staff where email like '%@sweep904.test';

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Clock Change Gala', date '2026-10-25', true, true);

-- 25.10.2026: 10:00 UK is 10:00Z (GMT). 26.10.2026: 09:00 UK is 09:00Z.
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'s_hc',  :'ev', :'role_id', '2026-10-25 17:00+00', '2026-10-25 23:00+00', 3, 1, 30, 15, 1),
  (:'s_sun', :'ev', :'role_id', '2026-10-25 10:00+00', '2026-10-25 16:00+00', 5, 0, 30, 15, 1),
  (:'s_mon', :'ev', :'role_id', '2026-10-26 09:00+00', '2026-10-26 15:00+00', 5, 0, 30, 15, 1),
  (:'s_r',   :'ev', :'role_id', now() + interval '14 days', now() + interval '14 days 6 hours', 3, 0, 30, 15, 1);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at, applied_at) values
  (:'b_h1',  :'s_hc',  :'h1', 'confirmed', 'auto', '2026-10-01 10:00+00', null),
  (:'b_h2',  :'s_hc',  :'h2', 'confirmed', 'auto', '2026-10-01 10:00+00', null),
  (:'b_app', :'s_hc',  :'h3', 'applied',   'self', null, '2026-10-02 10:00+00'),
  (:'b_sun', :'s_sun', :'d1', 'confirmed', 'auto', '2026-10-01 10:00+00', null),
  (:'b_mon', :'s_mon', :'d2', 'confirmed', 'auto', '2026-10-01 10:00+00', null);

-- ---------------------------------------------------------------------
-- 1 · N10c when the headcount drops to the confirmed count
-- ---------------------------------------------------------------------
update shift_requirements set headcount = 4 where id = :'s_hc';
select is((select status::text from bookings where id = :'b_app'), 'applied',
  'raising the headcount closes nothing');

update shift_requirements set headcount = 3 where id = :'s_hc';
select is((select status::text from bookings where id = :'b_app'), 'applied',
  'a drop that still leaves a seat (2 confirmed of 3) closes nothing');
select is((select count(*)::int from notification_outbox where template = 'N10c'
            and recipient_staff_id = :'h3'), 0, '… and tells nobody');

update shift_requirements set headcount = 2 where id = :'s_hc';
select is((select status::text || '/' || cancel_cause from bookings where id = :'b_app'),
  'closed/slot_taken',
  'lowering the headcount to the 2 already confirmed closes the pending application');
select is((select count(*)::int from notification_outbox where template = 'N10c'
            and recipient_staff_id = :'h3'), 1, 'with one N10c');
select ok((select key from notification_outbox where template = 'N10c' and recipient_staff_id = :'h3')
            like 'N10c:booking:' || :'b_app' || ':%',
  'keyed per application, N10c:booking:<id>:<applied_at>');
select is((select payload ->> 'event' || ' · ' || (payload ->> 'date') from notification_outbox
            where template = 'N10c' and recipient_staff_id = :'h3'),
  'Clock Change Gala · 25 Oct 2026', 'carrying the {event} and {date} the copy renders');
select is((select count(*)::int from notification_outbox where template = 'N10'
            and recipient_staff_id = :'h3'), 0,
  'and never N10 as well: exactly one of the two per application');
select is((select count(*)::int from bookings where shift_id = :'s_hc' and status = 'confirmed'), 2,
  'the confirmed workers are untouched');

update shift_requirements set headcount = 1 where id = :'s_hc';
select is((select count(*)::int from notification_outbox where template = 'N10c'
            and recipient_staff_id = :'h3'), 1, 'a second drop tells nobody twice');

-- ---------------------------------------------------------------------
-- 2 · The clock change, Sunday 25 October 2026
-- ---------------------------------------------------------------------
select is(n6_due_at('2026-10-25 10:00+00'), '2026-10-24 07:00+00'::timestamptz,
  'N6 for a Sunday shift: 08:00 UK on the BST Saturday is 07:00Z');
select is(ready_deadline('2026-10-25 10:00+00'), '2026-10-24 11:00+00'::timestamptz,
  'its deadline: 12:00 UK on the BST Saturday is 11:00Z');
select is(n6_due_at('2026-10-26 09:00+00'), '2026-10-25 08:00+00'::timestamptz,
  'N6 for a Monday shift: 08:00 UK on the GMT Sunday is 08:00Z');
select is(ready_deadline('2026-10-26 09:00+00'), '2026-10-25 12:00+00'::timestamptz,
  'its deadline: 12:00 UK on the GMT Sunday is 12:00Z');
select is(n7_due_at('2026-10-25 18:00+00'), '2026-10-25 09:00+00'::timestamptz,
  'N7 on the GMT Sunday: 09:00 UK is 09:00Z');
select is(n7_due_at('2026-10-25 10:00+00'), '2026-10-25 08:00+00'::timestamptz,
  'N7 for a 10:00 start: two hours before, 08:00 UK');
select is(n7_due_at('2026-10-24 18:00+00'), '2026-10-24 08:00+00'::timestamptz,
  'N7 on the BST Saturday: 09:00 UK is 08:00Z');

select ok(is_uk_time('2026-10-24 11:05+00', '12:05'), 'the 12:05 cutoff gate opens at 11:05Z on the BST Saturday');
select ok(is_uk_time('2026-10-25 12:05+00', '12:05'), '… and at 12:05Z on the GMT Sunday');
select ok(not is_uk_time('2026-10-25 11:05+00', '12:05'), '… not an hour early after the change');
select ok(is_uk_time('2026-10-25 05:00+00', '05:00') and not is_uk_time('2026-10-25 04:00+00', '05:00'),
  'the 05:00 compliance gate (N1–N4, N14) runs at 05:00Z after the change, not 04:00Z');

select booking_tick('2026-10-24 06:59+00');
select is((select count(*)::int from notification_outbox where key = booking_reminder_key('N6', :'b_sun', '2026-10-25 10:00+00')), 0,
  'booking_tick at 07:59 UK Saturday: no N6 yet');
select booking_tick('2026-10-24 07:00+00');
select is((select payload ->> 'window' from notification_outbox where key = booking_reminder_key('N6', :'b_sun', '2026-10-25 10:00+00')),
  '10:00–16:00', 'at 08:00 UK: N6, with the window in UK time after the change');

select is(release_unready_bookings('2026-10-24 10:59+00') >= 0, true, 'a run before the deadline');
select is((select status::text from bookings where id = :'b_sun'), 'confirmed',
  '… releases nothing at 11:59 UK');
select release_unready_bookings('2026-10-24 11:05+00');
select is((select status::text || '/' || cancel_cause from bookings where id = :'b_sun'), 'cancelled/ready_cutoff',
  'at 12:05 UK Saturday the unready booking is released');
select is((select count(*)::int from notification_outbox where key = 'N6b:booking:' || :'b_sun'), 1,
  '… with exactly one N6b');
select release_unready_bookings('2026-10-24 11:10+00');
select is((select count(*)::int from notification_outbox where template = 'N6b' and recipient_staff_id = :'d1'), 1,
  'a retry run that afternoon sends no second N6b');

-- Monday's shift: d2 pressed "I'm ready", so N9 is the next thing they hear.
update bookings set day_before_confirmed_at = '2026-10-25 09:00+00', on_day_confirmed_at = '2026-10-26 07:00+00'
 where id = :'b_mon';
select booking_tick('2026-10-26 08:29+00');
select is((select count(*)::int from notification_outbox where key = 'N9:booking:' || :'b_mon' || ':check-in'), 0,
  'N9 "Time to check in": nothing at start − 31 min');
select booking_tick('2026-10-26 08:30+00');
select is((select count(*)::int from notification_outbox where key = 'N9:booking:' || :'b_mon' || ':check-in'), 1,
  '… one at start − 30 (08:30 UK, GMT)');

-- ---------------------------------------------------------------------
-- 3 · N10 per application: accepted, withdrawn, applied again, accepted
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select (apply_to_shift(:'s_r', :'r1') ->> 'bookingId') as b_r \gset
select is(accept_application(:'b_r') ->> 'ok', 'true', 'the office accepts the application');
select is(withdraw_booking(:'b_r') ->> 'notified', 'N10b', 'then withdraws it (N10b)');
reset role;
-- A later application: in real life another transaction, so another now().
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(apply_to_shift(:'s_r', :'r1') ->> 'bookingId', :'b_r', 'the worker applies again: the same booking row reopens');
reset role;
update bookings set applied_at = applied_at + interval '1 minute' where id = :'b_r';
set local role authenticated;
select is(accept_application(:'b_r') ->> 'ok', 'true', 'the office accepts it again');
reset role;
select is((select count(*)::int from notification_outbox where template = 'N10' and recipient_staff_id = :'r1'), 2,
  'two applications accepted: two N10, the second no longer swallowed by the first one''s key');
select is((select count(distinct key)::int from notification_outbox where template = 'N10' and recipient_staff_id = :'r1'
            and key like 'N10:booking:' || :'b_r' || ':%'), 2,
  'each keyed N10:booking:<id>:<applied_at>');

select * from finish();
rollback;
