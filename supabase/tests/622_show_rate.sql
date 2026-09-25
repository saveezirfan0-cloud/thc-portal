-- =====================================================================
-- 622 · the show-rate is computed (§6, §9.5, BG-03, audit D7)
--   20260929120100_show_rate_is_computed.sql · ADR-0033
--
--   show-rate = attended ÷ decided bookings:
--     attended  worked (incl. a No-show got back) or turned away
--     missed    an unresolved No-show
--   90 until three are decided. Kept current by triggers.
-- =====================================================================
begin;
\ir _shared/fixtures.psql

select plan(17);

\set st   '62200000-0000-4000-8000-0000000000d1'
\set ev   '62200000-0000-4000-8000-0000000000e1'

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status, reliability) values
  (:'st', 96221, 'Show', 'Rate', 'showrate@rls.test', '+447700962201', date '1992-04-04', 'compliant', 97);

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer) values
  (:'ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Show-rate Fixture', current_date - 60, true, true);

-- Eight past sections, a week apart, so no rota rule is in play.
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour)
select ('62200000-0000-4000-8000-0000000000f' || n)::uuid, :'ev', :'role_id',
       now() - (n * 7 + 1) * interval '1 day', now() - (n * 7 + 1) * interval '1 day' + interval '5 hours',
       6, 0, 22.97, 14.00, 6
  from generate_series(1, 8) n;

select is((select reliability from staff where id = :'st'), 97::numeric(5,2),
  'nothing has happened to this worker yet, so nothing has been recomputed');

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  ('62200000-0000-4000-8000-0000000000b1', '62200000-0000-4000-8000-0000000000f1', :'st', 'worked', 'auto', now() - interval '60 days');
select is((select reliability from staff where id = :'st'), 90.00::numeric(5,2),
  'one attended shift: still the 90 default — three are needed before the rate means anything');

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  ('62200000-0000-4000-8000-0000000000b2', '62200000-0000-4000-8000-0000000000f2', :'st', 'worked', 'auto', now() - interval '60 days'),
  ('62200000-0000-4000-8000-0000000000b3', '62200000-0000-4000-8000-0000000000f3', :'st', 'worked', 'auto', now() - interval '60 days');
select is((select reliability from staff where id = :'st'), 100.00::numeric(5,2),
  'three attended out of three: 100');

-- A No-show (BG-03 writes the violation on a confirmed booking).
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  ('62200000-0000-4000-8000-0000000000b4', '62200000-0000-4000-8000-0000000000f4', :'st', 'confirmed', 'auto', now() - interval '60 days');
select is((select reliability from staff where id = :'st'), 100.00::numeric(5,2),
  'a confirmed booking still waiting on its outcome counts for nothing yet');
insert into violations (staff_id, booking_id, type, detected_at)
values (:'st', '62200000-0000-4000-8000-0000000000b4', 'no_show', now() - interval '29 days');
select is((select reliability from staff where id = :'st'), 75.00::numeric(5,2),
  'the No-show is a miss: 3 of 4');
select is(staff_show_rate(:'st'), 75.00::numeric,
  'staff_show_rate() and the stored figure agree');

-- Get back / Resolve: the No-show becomes a resolved Late on a worked booking.
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select resolve_violation((select id from violations where booking_id = '62200000-0000-4000-8000-0000000000b4'),
                              'Came in through the stage door; the venue confirmed.',
                              (select ends_at from shift_requirements where id = '62200000-0000-4000-8000-0000000000f4'),
                              (select starts_at + interval '40 minutes' from shift_requirements where id = '62200000-0000-4000-8000-0000000000f4')) $$,
  'the manager resolves the No-show with the arrival time');
reset role;
select is((select reliability from staff where id = :'st'), 100.00::numeric(5,2),
  'a No-show resolved via Get back counts as attended: 4 of 4');

-- A second No-show, left unresolved.
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  ('62200000-0000-4000-8000-0000000000b5', '62200000-0000-4000-8000-0000000000f5', :'st', 'confirmed', 'auto', now() - interval '60 days');
insert into violations (staff_id, booking_id, type, detected_at)
values (:'st', '62200000-0000-4000-8000-0000000000b5', 'no_show', now() - interval '36 days');
select is((select reliability from staff where id = :'st'), 80.00::numeric(5,2),
  '4 of 5');

-- A turn-away turned up.
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  ('62200000-0000-4000-8000-0000000000b6', '62200000-0000-4000-8000-0000000000f6', :'st', 'confirmed', 'auto', now() - interval '60 days');
update bookings set status = 'turned_away' where id = '62200000-0000-4000-8000-0000000000b6';
select is((select reliability from staff where id = :'st'), 83.33::numeric(5,2),
  'a buffer turn-away came, so it is attended: 5 of 6 (RULE-15)');

-- Things that are not attendance at all.
insert into bookings (id, shift_id, staff_id, status, source) values
  ('62200000-0000-4000-8000-0000000000b7', '62200000-0000-4000-8000-0000000000f7', :'st', 'invited', 'auto');
update bookings set status = 'closed', cancel_cause = 'declined', cancelled_at = now()
 where id = '62200000-0000-4000-8000-0000000000b7';
select is((select reliability from staff where id = :'st'), 83.33::numeric(5,2),
  'declining an invitation has no effect on the show-rate (§3.6)');

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  ('62200000-0000-4000-8000-0000000000b8', '62200000-0000-4000-8000-0000000000f8', :'st', 'confirmed', 'auto', now() - interval '60 days');
update bookings set status = 'cancelled', cancel_cause = 'self_cancel', cancelled_at = now() - interval '60 days'
 where id = '62200000-0000-4000-8000-0000000000b8';
select is((select reliability from staff where id = :'st'), 83.33::numeric(5,2),
  'nor does a cancellation that was allowed (RULE-04)');

-- Other violation types do not move it (ADR-0033 leaves their weight to THC).
insert into violations (staff_id, booking_id, type, detected_at, minutes_late)
values (:'st', '62200000-0000-4000-8000-0000000000b1', 'late', now() - interval '8 days', 12);
select is((select reliability from staff where id = :'st'), 83.33::numeric(5,2),
  'a Late does not change the show-rate');

-- A No-show marked resolved without registering an arrival stops counting
-- as a miss; with no attendance either, the booking leaves the count (4 of 4).
update violations set resolved = true, resolved_at = now(), resolution_note = 'Phone died; was there.'
 where booking_id = '62200000-0000-4000-8000-0000000000b5' and type = 'no_show';
select is((select reliability from staff where id = :'st'), 100.00::numeric(5,2),
  'a resolved No-show no longer counts as missed');

-- Deleting an attended booking recomputes.
update violations set resolved = false where booking_id = '62200000-0000-4000-8000-0000000000b5';
delete from bookings where id = '62200000-0000-4000-8000-0000000000b6';
select is((select reliability from staff where id = :'st'), 80.00::numeric(5,2),
  'removing the turn-away takes it out of the count: 4 of 5');

select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('staff_show_rate', 'recompute_reliability',
                          'bookings_recompute_reliability', 'violations_recompute_reliability')
        and (has_function_privilege('anon', p.oid, 'execute')
             or has_function_privilege('authenticated', p.oid, 'execute')) $$,
  'neither anon nor a signed-in user can call the show-rate functions directly');

select ok(exists (select 1 from pg_trigger where tgname = 'bookings_recompute_reliability_t')
      and exists (select 1 from pg_trigger where tgname = 'violations_recompute_reliability_t'),
  'both triggers are installed');

select * from finish();
rollback;
