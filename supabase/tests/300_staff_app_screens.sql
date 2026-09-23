-- =====================================================================
-- 300 · The Staff App's three working screens (§10.4)
--
--   1. staff_bookings — what the worker's own cards may and may not show.
--      The two withholding rules (§10.4, §3.2, §5.2b) are the point: an
--      invitation that leaks the on-site contact has given away a named
--      person's phone number to somebody who never took the shift.
--   2. staff_open_shifts — Radar and the Shifts tab's Open shifts, with
--      RULE-17's two waves and RULE-20's visible cap state.
--   3. The five things a worker can press: decline, apply, withdraw,
--      confirm on the day, re-confirm a changed time.
--   4. The grants. Every function here is `security definer` over tables
--      the staff role cannot read, so a grant to anon is a data breach
--      and a missing grant to authenticated is a dead screen.
--
-- Every row is created inside the transaction and rolled back.
-- =====================================================================
begin;
select plan(73);

-- ---------------------------------------------------------------------
-- Fixtures
--
-- One client the worker is qualified at (§9.6) and one they are not, so
-- RULE-17's two waves are both reachable; one role they hold and one they
-- do not; and four events — live, wave-2, cancelled, and one section that
-- has already started.
-- ---------------------------------------------------------------------
\set cl      'a1a1a1a1-0000-4000-8000-000000000001'
\set cl2     'a1a1a1a1-0000-4000-8000-000000000002'
\set ro      'a2a2a2a2-0000-4000-8000-000000000001'
\set ro2     'a2a2a2a2-0000-4000-8000-000000000002'
\set ve      'a3a3a3a3-0000-4000-8000-000000000001'
\set ve2     'a3a3a3a3-0000-4000-8000-000000000002'
\set ev1     'a4a4a4a4-0000-4000-8000-000000000001'
\set ev2     'a4a4a4a4-0000-4000-8000-000000000002'
\set ev3     'a4a4a4a4-0000-4000-8000-000000000003'
\set s1      'a5a5a5a5-0000-4000-8000-000000000001'
\set s2      'a5a5a5a5-0000-4000-8000-000000000002'
\set s3      'a5a5a5a5-0000-4000-8000-000000000003'
\set s4      'a5a5a5a5-0000-4000-8000-000000000004'
\set s5      'a5a5a5a5-0000-4000-8000-000000000005'
\set me      'a6a6a6a6-0000-4000-8000-000000000001'
\set mate    'a6a6a6a6-0000-4000-8000-000000000002'
\set capped  'a6a6a6a6-0000-4000-8000-000000000003'
\set blk     'a6a6a6a6-0000-4000-8000-000000000004'
\set admin_uid 'a7a7a7a7-0000-4000-8000-000000000001'
\set me_uid    'a7a7a7a7-0000-4000-8000-000000000002'
\set mate_uid  'a7a7a7a7-0000-4000-8000-000000000003'

insert into auth.users (id, email) values
  (:'admin_uid', 'manager@staffapp.test'),
  (:'me_uid',    'me@staffapp.test'),
  (:'mate_uid',  'mate@staffapp.test');
insert into profiles (id, role, full_name)
values (:'admin_uid', 'admin', 'Staff App Fixture Manager');

insert into clients (id, name, contact_name, phone, staff_contact_point, contact_emails) values
  (:'cl',  'App Fixture Client',   'Ann A', '+447700900301', 'Front desk', array['a@staffapp.test']),
  (:'cl2', 'App Fixture Client 2', 'Ben B', '+447700900302', 'Stage door', array['b@staffapp.test']);
insert into roles (id, name, pay_rate) values
  (:'ro', 'App Waiting Staff', 14.00), (:'ro2', 'App Bar Staff', 15.50);
insert into venues (id, name, address, location, venue_type, geofence_radius_m) values
  (:'ve',  'App Venue',   '5 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 'hotel', 150),
  (:'ve2', 'App Venue 2', '6 Test Street, London',
   st_setsrid(st_makepoint(-0.1400, 51.5000), 4326)::geography, 'hotel', 150);

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, notes, onsite_contact,
                    pays_breaks, pays_buffer, auto_assign, cancelled_at, cancel_reason) values
  (:'ev1', :'cl',  :'ve',  'App Venue',   '5 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'App Fixture Event', (now() + interval '10 days')::date,
   'Use the stage door on Godliman Street.', 'Priya on 07700 900999',
   true, true, true, null, null),
  (:'ev2', :'cl2', :'ve2', 'App Venue 2', '6 Test Street, London',
   st_setsrid(st_makepoint(-0.1400, 51.5000), 4326)::geography, 150,
   'App Fixture Event 2', (now() + interval '11 days')::date, null, null,
   true, true, true, null, null),
  (:'ev3', :'cl',  :'ve',  'App Venue',   '5 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'App Fixture Cancelled', (now() + interval '12 days')::date, null, null,
   true, true, true, now(), 'Client postponed');

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour) values
  -- The worker's own role at the client they are qualified at: wave 1.
  (:'s1', :'ev1', :'ro',  now() + interval '10 days',
   now() + interval '10 days 8 hours', 2, 1, 22.97, 14.00, 'Black & whites', 3),
  -- A client they are NOT qualified at: wave 2, hidden until RULE-17 says so.
  (:'s2', :'ev2', :'ro',  now() + interval '11 days',
   now() + interval '11 days 8 hours', 2, 0, 22.97, 14.00, 'Black tie', 2),
  -- A role they do not hold at all.
  (:'s3', :'ev1', :'ro2', now() + interval '10 days 2 hours',
   now() + interval '10 days 10 hours', 2, 0, 24.50, 15.50, 'Black tie', 2),
  -- A section on the cancelled event.
  (:'s4', :'ev3', :'ro',  now() + interval '12 days',
   now() + interval '12 days 8 hours', 2, 0, 22.97, 14.00, 'Black & whites', 2),
  -- One that has already started: never on Radar, whatever else is true.
  (:'s5', :'ev1', :'ro',  now() - interval '2 hours',
   now() + interval '6 hours', 2, 0, 22.97, 14.00, 'Black & whites', 2);

insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, rtw_branch,
                   home_location, reliability, rating) values
  (:'me',     :'me_uid',   'App','Worker', 'me@staffapp.test',  '+447700900311', date '1995-02-01',
   'compliant','uk_irish', st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, 96, 4.6),
  (:'mate',   :'mate_uid', 'App','Mate',   'mate@staffapp.test','+447700900312', date '1995-02-02',
   'compliant','uk_irish', st_setsrid(st_makepoint(-0.1410, 51.5000), 4326)::geography, 96, 4.6),
  (:'capped', null,        'App','Capped', 'cap@staffapp.test', '+447700900313', date '1995-02-03',
   'compliant','international_student',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, 96, 4.6),
  (:'blk',    null,        'App','Blocked','blk@staffapp.test', '+447700900314', date '1995-02-04',
   'blocked','uk_irish', st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, 96, 4.6);

insert into staff_roles (staff_id, role_id)
select id, :'ro' from staff where id in (:'me', :'mate', :'capped', :'blk');

-- `me` and `capped` are qualified at cl+ro (wave 1 there); `mate` at cl2+ro,
-- which is what keeps cl2's wave 1 alive until they are reached.
insert into client_qualifications (client_id, role_id, staff_id) values
  (:'cl',  :'ro', :'me'),
  (:'cl',  :'ro', :'capped'),
  (:'cl2', :'ro', :'mate');

-- `capped` is a student in term time (no holiday ranges on file) → 20 h,
-- and already holds 16 h in the same Mon–Sun week as s1. s1 is 8 h.
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour)
values ('a5a5a5a5-0000-4000-8000-00000000000a', :'ev2', :'ro',
        date_trunc('week', (now() + interval '10 days')) + interval '1 hour',
        date_trunc('week', (now() + interval '10 days')) + interval '17 hours',
        9, 0, 22.97, 14.00, 9);
insert into bookings (shift_id, staff_id, status, source, confirmed_at)
values ('a5a5a5a5-0000-4000-8000-00000000000a', :'capped', 'confirmed', 'manual', now());

-- RULE-04 needs a SECOND section on the same event as s1, because the bar is
-- per EVENT rather than per section: self-cancelling off one role must take
-- the whole event off Radar, including roles never touched.
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour)
values ('a5a5a5a5-0000-4000-8000-00000000000b', :'ev1', :'ro',
        now() + interval '10 days 1 hour', now() + interval '10 days 9 hours',
        2, 0, 22.97, 14.00, 2);

-- The manager is the caller for most of this file: staff_bookings and
-- staff_open_shifts take a worker id, and only an admin may name one.
set local "request.jwt.claims" = '{"sub":"a7a7a7a7-0000-4000-8000-000000000001","role":"authenticated"}';

-- =====================================================================
-- 1. staff_bookings — the invitation withholds, the booking does not
-- =====================================================================
\set inv 'a8a8a8a8-0000-4000-8000-000000000001'
insert into bookings (id, shift_id, staff_id, status, source)
values (:'inv', :'s1', :'me', 'invited', 'auto');

select is((select count(*)::int from staff_bookings(:'me')), 1,
  'staff_bookings returns the worker''s own rows and nobody else''s');

select is((select onsite_contact from staff_bookings(:'me') where booking_id = :'inv'), null,
  '§10.4: an INVITATION does not carry the on-site contact — "Shown after you accept"');
select is((select notes from staff_bookings(:'me') where booking_id = :'inv'), null,
  'nor the event''s notes and specific instructions (§3.2)');
select is((select pays_breaks from staff_bookings(:'me') where booking_id = :'inv'), null,
  'nor the break policy, which reaches the worker through the Breaks block after booking (§5.2b)');

select is((select dress_code from staff_bookings(:'me') where booking_id = :'inv'), 'Black & whites',
  'the dress code IS on the invite: the worker judges it before committing (confirmed 08.09.2026)');

select is((select starts_at from staff_bookings(:'me') where booking_id = :'inv'),
          (select starts_at from shift_requirements where id = :'s1'),
  'RULE-18: the card shows the worker''s own ROLE window, never the event''s');

select ok((select distance_km from staff_bookings(:'me') where booking_id = :'inv') < 1,
  'the venue distance comes off the worker''s home location, for the km badge');

-- Accept it and the three withheld fields appear.
update bookings set status = 'confirmed', confirmed_at = now() where id = :'inv';

select is((select onsite_contact from staff_bookings(:'me') where booking_id = :'inv'),
  'Priya on 07700 900999',
  'once accepted, the on-site contact appears — as the free text the event carries, unsplit (§3.2)');
select is((select notes from staff_bookings(:'me') where booking_id = :'inv'),
  'Use the stage door on Godliman Street.',
  'and the specific instructions with it');
select is((select pays_breaks from staff_bookings(:'me') where booking_id = :'inv'), true,
  'and the break policy');

-- RULE-02: the no-check-out lock. The booking stays `worked`, so the card
-- does NOT disappear — it shows the static screen until a manager resolves.
select is((select no_checkout_open from staff_bookings(:'me') where booking_id = :'inv'), false,
  'no violation, no lock');
insert into violations (staff_id, booking_id, type) values (:'me', :'inv', 'no_checkout');
select is((select no_checkout_open from staff_bookings(:'me') where booking_id = :'inv'), true,
  'RULE-02: an unresolved No check-out locks the card in place rather than removing it (§5.2, §9.5)');
update violations set resolved = true, resolved_at = now() where booking_id = :'inv';
select is((select no_checkout_open from staff_bookings(:'me') where booking_id = :'inv'), false,
  'and a manager resolving it releases the card');

-- Back to an invitation for the action tests below.
delete from violations where booking_id = :'inv';
-- confirmed → invited is not a §3.6 edge (20260924120000): a fresh row.
delete from bookings where id = :'inv';
insert into bookings (id, shift_id, staff_id, status, source)
values (:'inv', :'s1', :'me', 'invited', 'auto');

-- =====================================================================
-- 2. staff_open_shifts — RULE-17's two waves, and what never appears
-- =====================================================================
-- `me` holds an invitation to s1, so s1 is on Invites, not on Radar.
select is_empty(
  $$ select shift_id::text from staff_open_shifts('a6a6a6a6-0000-4000-8000-000000000001')
      where shift_id = 'a5a5a5a5-0000-4000-8000-000000000001' $$,
  'a section the worker already holds an invitation for is on Invites, not offered again on Radar');

delete from bookings where id = :'inv';

select bag_eq(
  $$ select shift_id::text from staff_open_shifts('a6a6a6a6-0000-4000-8000-000000000001') $$,
  $$ values ('a5a5a5a5-0000-4000-8000-000000000001'::text),
            ('a5a5a5a5-0000-4000-8000-00000000000b') $$,
  'Radar shows the wave-1 client''s sections only: the wave-2 client is still hidden (RULE-17)');

-- Everything absent from that list, named one at a time so a regression
-- says which rule broke.
select is_empty(
  $$ select shift_id::text from staff_open_shifts('a6a6a6a6-0000-4000-8000-000000000001')
      where shift_id = 'a5a5a5a5-0000-4000-8000-000000000003' $$,
  'a role the worker does not hold never appears (§6: wrong_role is most of an agency of a thousand)');
select is_empty(
  $$ select shift_id::text from staff_open_shifts('a6a6a6a6-0000-4000-8000-000000000001')
      where shift_id = 'a5a5a5a5-0000-4000-8000-000000000004' $$,
  'a cancelled event''s sections never appear (§3.3)');
select is_empty(
  $$ select shift_id::text from staff_open_shifts('a6a6a6a6-0000-4000-8000-000000000001')
      where shift_id = 'a5a5a5a5-0000-4000-8000-000000000005' $$,
  'nor does a section that has already started');

select is(radar_wave1_exhausted(:'s2'), false,
  'RULE-17: cl2''s wave 1 is not exhausted while a qualified worker there is still un-invited');

-- Reach the last qualified worker at cl2 and wave 2 opens.
insert into bookings (shift_id, staff_id, status, source) values (:'s2', :'mate', 'invited', 'auto');

select is(radar_wave1_exhausted(:'s2'), true,
  'once every qualified worker holds a booking there, wave 1 is exhausted');
select bag_eq(
  $$ select shift_id::text from staff_open_shifts('a6a6a6a6-0000-4000-8000-000000000001') $$,
  $$ values ('a5a5a5a5-0000-4000-8000-000000000001'::text),
            ('a5a5a5a5-0000-4000-8000-00000000000b'),
            ('a5a5a5a5-0000-4000-8000-000000000002') $$,
  'and only then does the wave-2 client surface — self-apply cannot bypass the priority invitations enforce');

select results_eq(
  $$ select qualified from staff_open_shifts('a6a6a6a6-0000-4000-8000-000000000001') $$,
  $$ values (true), (true), (false) $$,
  '"You''ve worked here before" sorts first, which is the grouping the screen renders');

-- RULE-20 is the one gate that is SHOWN rather than hidden: the wireframe's
-- muted "Limit reached" card, with the arithmetic that produced it.
select is(
  (select hours_limit from staff_open_shifts(:'capped')
    where shift_id = 'a5a5a5a5-0000-4000-8000-000000000001'),
  true,
  'RULE-20: the section is still listed, flagged, so the worker sees why they cannot take it');
select is(
  (select hours_limit from staff_open_shifts(:'me')
    where shift_id = 'a5a5a5a5-0000-4000-8000-000000000001'),
  false,
  'and is not flagged for a worker with the hours to spare');

select is_empty(
  $$ select shift_id::text from staff_open_shifts('a6a6a6a6-0000-4000-8000-000000000004') $$,
  '§4.3: a blocked worker sees no open shifts at all');

-- =====================================================================
-- 3. The five buttons
-- =====================================================================
insert into bookings (id, shift_id, staff_id, status, source)
values (:'inv', :'s1', :'me', 'invited', 'auto');

select is(decline_invite(:'inv')->>'ok', 'true', 'Decline is always available (§10.4)');
select is((select status::text from bookings where id = :'inv'), 'closed',
  'and moves the invitation to closed, so it does not linger as if it were live (§3.4)');
select is((select reliability from staff where id = :'me'), 96::numeric(5,2),
  'declining has no effect on the show-rate — the whole point of the sentence');
select is(decline_invite(:'inv')->>'reason', 'not_invited',
  'declining twice is refused rather than re-closing a dead row');

delete from bookings where id = :'inv';

-- Radar self-apply, and its live re-check.
select is(apply_to_shift(:'s1', :'me')->>'ok', 'true', '§10.4: a worker applies for an open shift');
select is((select status::text from bookings where shift_id = :'s1' and staff_id = :'me'), 'applied',
  'applying records an application, never a confirmation — the office still decides');
select is((select source::text from bookings where shift_id = :'s1' and staff_id = :'me'), 'self',
  'and marks it as self-applied, which is what the board''s "Applied" chip reads (§3.3)');
select isnt((select applied_at from bookings where shift_id = :'s1' and staff_id = :'me'), null,
  'with the moment it was applied for, for Radar''s "Applied today 13:05" line');

select bag_eq(
  $$ select shift_id::text from staff_open_shifts('a6a6a6a6-0000-4000-8000-000000000001')
      where applied_at is not null $$,
  $$ values ('a5a5a5a5-0000-4000-8000-000000000001'::text) $$,
  'an applied shift STAYS on Radar under its own section until it resolves (§10.4)');

select is(apply_to_shift(:'s1', :'me')->>'reason', 'already_has_booking',
  'a second application for the same section is refused');

select is(withdraw_application(
  (select id from bookings where shift_id = :'s1' and staff_id = :'me'))->>'ok', 'true',
  'a pending application can be withdrawn');
select is((select self_cancelled from bookings where shift_id = :'s1' and staff_id = :'me'), false,
  'withdrawing never sets self_cancelled: RULE-04''s permanent bar is for abandoning a BOOKING');

delete from bookings where shift_id = :'s1' and staff_id = :'me';

-- The live re-check. s1 is headcount 2, buffer 1 — full at 2, not at 3.
-- The second seat is filled by `blk`, not `capped`: `capped` is a student
-- already at 16 h, and confirming them onto this 8 h shift is exactly what
-- the rota guard (20260923100200) now refuses (acceptance criterion 1).
insert into bookings (shift_id, staff_id, status, source, confirmed_at) values
  (:'s1', :'mate', 'confirmed', 'manual', now()),
  (:'s1', :'blk',  'confirmed', 'manual', now());
select is(apply_to_shift(:'s1', :'me')->>'reason', 'full',
  '"Sorry, this shift is now full" — measured against headcount, never headcount + buffer');
delete from bookings where shift_id = :'s1' and staff_id in (:'mate', :'blk');

select is(apply_to_shift(:'s1', :'capped')->>'reason', 'hours_limit',
  'RULE-20 blocks Apply the same way it blocks Accept, with the reason the "Limit Reached" label reads');

-- Stage 3 (§3.5) and the N11 re-confirmation.
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at, day_before_confirmed_at)
values (:'inv', :'s1', :'me', 'confirmed', 'auto', now(), now());

select is(confirm_on_day(:'inv')->>'reason', 'not_today',
  'the on-the-day confirmation is refused before the day itself');
-- Anchored to MIDDAY on the UK day, not to now() + 3 hours.
--
-- `confirm_on_day()` compares `(starts_at at time zone 'Europe/London')::date`
-- with today's UK date and nothing else — it has no "not yet started" rule. The
-- old form was `now() + 3 hours`, which is tomorrow in UK terms for any run
-- after about 21:00 BST, so the next assertion got `not_today` and the file
-- failed. It passed all day and broke in the evening: CI run 173 on 22.09 at
-- 20:18 UTC (21:18 BST) is the first one that reached this window.
--
-- Midday is on today's UK date whatever the hour, and stays eight hours long.
-- Nothing after this depends on the shift being in the future:
-- `reconfirm_booking()` checks status and `reconfirm_required`, never a time.
update shift_requirements
   set starts_at = ((now() at time zone 'Europe/London')::date + time '12:00')
                     at time zone 'Europe/London',
       ends_at   = ((now() at time zone 'Europe/London')::date + time '20:00')
                     at time zone 'Europe/London'
 where id = :'s1';
select is(confirm_on_day(:'inv')->>'ok', 'true', 'and accepted on it');
select is((select status::text from bookings where id = :'inv'), 'confirmed',
  '§3.5: stage 3 is a REMINDER — it records the press and never releases the slot');

update bookings set reconfirm_required = true, reconfirm_reason = 'Start time moved' where id = :'inv';
select is(reconfirm_booking(:'inv')->>'ok', 'true', 'N11: the worker confirms the new time (§3.5)');
select is((select day_before_confirmed_at from bookings where id = :'inv'), null,
  'and the later stages reset: "I''m ready" for 12:00 is not agreement to an 11:00 start');
select is(reconfirm_booking(:'inv')->>'reason', 'nothing_to_reconfirm',
  'pressing it again has nothing to confirm');

-- =====================================================================
-- 4. Grants, and the caller check
-- =====================================================================
select is_empty(
  $$ select p.proname::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('staff_caller','staff_bookings','staff_open_shifts',
                          'radar_wave1_exhausted','decline_invite','apply_to_shift',
                          'withdraw_application','confirm_on_day','reconfirm_booking')
        and has_function_privilege('anon', p.oid, 'execute') $$,
  'anon can execute none of the Staff App RPCs: every one is definer over tables a worker cannot read');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('staff_caller','staff_bookings','staff_open_shifts',
                        'decline_invite','apply_to_shift',
                        'withdraw_application','confirm_on_day','reconfirm_booking')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  8, 'and a signed-in worker can execute all eight of the reachable ones, or the screens are dead');

-- A worker in their own session reaches their own rows and nobody else's.
set local "request.jwt.claims" = '{"sub":"a7a7a7a7-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from staff_bookings()), 1,
  'a worker''s own session resolves to their own staff row without naming it');
select throws_ok(
  $$ select * from staff_bookings('a6a6a6a6-0000-4000-8000-000000000002') $$,
  '42501', 'not_your_worker',
  'and naming a colleague is refused, which is what makes these definer functions safe');


-- =====================================================================
-- Reset what section 3 left behind: it holds a booking on s1 and moved that
-- section's window to today for the stage-3 assertions. Everything below
-- reads s1 as the ten-days-out section the fixtures declared.
-- =====================================================================
-- Section 4 ended in the worker's own session, to prove the caller check.
-- Everything below names a worker, which only an admin may do.
set local "request.jwt.claims" = '{"sub":"a7a7a7a7-0000-4000-8000-000000000001","role":"authenticated"}';

delete from bookings where shift_id = :'s1' and staff_id = :'me';
update shift_requirements set starts_at = now() + interval '10 days',
                              ends_at   = now() + interval '10 days 8 hours'
 where id = :'s1';

-- =====================================================================
-- 5. The exclusions that are NOT shown, one rule at a time
--
-- staff_open_shifts filters five gates out entirely rather than listing
-- them with a reason, because none of them tells a worker anything they can
-- act on. Each is asserted separately so a regression names the rule.
-- =====================================================================
select ok(
  (select count(*) from staff_open_shifts(:'me')
    where shift_id in ('a5a5a5a5-0000-4000-8000-000000000001',
                       'a5a5a5a5-0000-4000-8000-00000000000b')) = 2,
  'both of the event''s sections are on Radar before anything bars the worker');

-- RULE-04: self-cancelling off ONE section takes the whole EVENT away.
insert into bookings (shift_id, staff_id, status, source, cancelled_at, cancel_cause, self_cancelled)
values (:'s1', :'me', 'cancelled', 'auto', now(), 'self_cancel', true);
select is_empty(
  $$ select shift_id::text from staff_open_shifts('a6a6a6a6-0000-4000-8000-000000000001')
      where shift_id in ('a5a5a5a5-0000-4000-8000-000000000001',
                         'a5a5a5a5-0000-4000-8000-00000000000b') $$,
  'RULE-04: a worker who self-cancelled off an event never sees THAT EVENT on Radar again — not just the section');
select is(apply_to_shift('a5a5a5a5-0000-4000-8000-00000000000b', :'me')->>'reason', 'self_cancelled',
  'and applying to its other role is refused with the reason, not silently');
delete from bookings where shift_id = :'s1' and staff_id = :'me';

-- §9.6: the client-level bar.
insert into client_qualifications (client_id, role_id, staff_id, do_not_return)
values (:'cl', :'ro2', :'me', true);
select is_empty(
  $$ select shift_id::text from staff_open_shifts('a6a6a6a6-0000-4000-8000-000000000001')
      where shift_id = 'a5a5a5a5-0000-4000-8000-000000000001' $$,
  '§9.6: do-not-return is read per CLIENT, so a bar set on another role still clears Radar');
delete from client_qualifications where staff_id = :'me' and do_not_return;

-- §3.4: a confirmed booking inside the two-hour different-venue gap.
insert into bookings (shift_id, staff_id, status, source, confirmed_at)
values (:'s2', :'me', 'confirmed', 'manual', now());
update shift_requirements set starts_at = now() + interval '10 days 9 hours',
                              ends_at   = now() + interval '10 days 17 hours'
 where id = :'s2';
select is_empty(
  $$ select shift_id::text from staff_open_shifts('a6a6a6a6-0000-4000-8000-000000000001')
      where shift_id = 'a5a5a5a5-0000-4000-8000-000000000001' $$,
  '§3.4: a section the worker could not physically reach is not offered at all');
delete from bookings where shift_id = :'s2' and staff_id = :'me';
update shift_requirements set starts_at = now() + interval '11 days',
                              ends_at   = now() + interval '11 days 8 hours'
 where id = :'s2';

-- =====================================================================
-- 6. Declining and withdrawing are not a bar (§10.4)
--
-- The dialogs in front of both say "You can still apply for this shift on
-- Radar later if it's open". A `closed` row survives only because
-- (shift_id, staff_id) is unique; treating it as a booking silently and
-- irreversibly removed the worker from the section they declined.
-- =====================================================================
insert into bookings (id, shift_id, staff_id, status, source)
values (:'inv', :'s1', :'me', 'invited', 'auto');
select is(decline_invite(:'inv')->>'ok', 'true', 'the worker declines');
select ok(
  (select count(*) from staff_open_shifts(:'me')
    where shift_id = 'a5a5a5a5-0000-4000-8000-000000000001') = 1,
  'and the shift comes back on Radar, exactly as the dialog promised');
select is(apply_to_shift(:'s1', :'me')->>'ok', 'true',
  'and they can apply for it again');
select is((select count(*)::int from bookings where shift_id = :'s1' and staff_id = :'me'), 1,
  'reviving the closed row rather than inserting a second: (shift_id, staff_id) is unique');
select is((select status::text from bookings where shift_id = :'s1' and staff_id = :'me'), 'applied',
  'and the revived row is a fresh application');

select is(withdraw_application(
  (select id from bookings where shift_id = :'s1' and staff_id = :'me'))->>'ok', 'true',
  'withdrawing it again');
select is(apply_to_shift(:'s1', :'me')->>'ok', 'true',
  'and the same is true of a withdrawal — neither costs the worker the shift');
delete from bookings where shift_id = :'s1' and staff_id = :'me';

-- A CANCELLED row is different and must stay a bar: RULE-04's self-cancel
-- and the office's withdraw both land there, and neither invites a retry.
insert into bookings (shift_id, staff_id, status, source, cancelled_at, cancel_cause)
values (:'s1', :'me', 'cancelled', 'auto', now(), 'office_withdraw');
select is(apply_to_shift(:'s1', :'me')->>'reason', 'already_has_booking',
  'a cancelled booking is NOT a closed one: an office withdrawal is not an invitation to re-apply');
delete from bookings where shift_id = :'s1' and staff_id = :'me';

-- =====================================================================
-- 7. RULE-20 at the moment of Accept (§10.4)
--
-- The gate in auto_assign_candidates stops the INVITATION. This is the
-- other half: a worker may hold an invitation for days and accept other
-- shifts meanwhile, and a manager can invite by hand, bypassing the round
-- altogether. A hard gate that exists only on the screen is not one.
-- =====================================================================
insert into bookings (id, shift_id, staff_id, status, source)
values ('a8a8a8a8-0000-4000-8000-000000000002', :'s1', :'capped', 'invited', 'manual');
select is(accept_invite('a8a8a8a8-0000-4000-8000-000000000002')->>'reason', 'hours_limit',
  '§10.4: Accept is blocked where it would take the worker over their weekly limit');
select is((select status::text from bookings where id = 'a8a8a8a8-0000-4000-8000-000000000002'),
  'invited',
  'and the invitation stays LIVE: hours free up, unlike a slot that has gone (RULE-16, §4.4)');
select is(
  (select hours_limit from staff_bookings(:'capped')
    where booking_id = 'a8a8a8a8-0000-4000-8000-000000000002'),
  true,
  'and the card can render "Limit Reached" rather than only discovering it on the tap');
select ok(
  (select cap_hours from staff_bookings(:'capped')
    where booking_id = 'a8a8a8a8-0000-4000-8000-000000000002') = 20,
  'with the arithmetic §10.4 shows the worker: the calculated ceiling for that Mon-Sun week');
select ok(
  (select booked_hours from staff_bookings(:'capped')
    where booking_id = 'a8a8a8a8-0000-4000-8000-000000000002') = 16,
  'and the hours already committed in it');

-- RULE-16's other half: an invitation to a shift that has ended is not live.
update shift_requirements set starts_at = now() - interval '12 hours',
                              ends_at   = now() - interval '4 hours'
 where id = :'s1';
select is(accept_invite('a8a8a8a8-0000-4000-8000-000000000002')->>'reason', 'event_ended',
  'RULE-16: an invitation to a shift that has already ended cannot be accepted');
update shift_requirements set starts_at = now() + interval '10 days',
                              ends_at   = now() + interval '10 days 8 hours'
 where id = :'s1';
delete from bookings where id = 'a8a8a8a8-0000-4000-8000-000000000002';

-- =====================================================================
-- 8. Every RPC checks that the booking is the caller's own
--
-- These are `security definer` over `bookings`. The check is the only thing
-- between a worker and declining a colleague's invitation.
-- =====================================================================
insert into bookings (id, shift_id, staff_id, status, source)
values ('a8a8a8a8-0000-4000-8000-000000000003', :'s1', :'mate', 'invited', 'auto');
set local "request.jwt.claims" = '{"sub":"a7a7a7a7-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$ select decline_invite('a8a8a8a8-0000-4000-8000-000000000003') $$,
  '42501', 'not_your_booking', 'a worker cannot decline a colleague''s invitation');
select throws_ok($$ select withdraw_application('a8a8a8a8-0000-4000-8000-000000000003') $$,
  '42501', 'not_your_booking', 'nor withdraw their application');
select throws_ok($$ select confirm_on_day('a8a8a8a8-0000-4000-8000-000000000003') $$,
  '42501', 'not_your_booking', 'nor confirm their shift on the day');
select throws_ok($$ select reconfirm_booking('a8a8a8a8-0000-4000-8000-000000000003') $$,
  '42501', 'not_your_booking', 'nor accept a time change on their behalf');
set local "request.jwt.claims" = '{"sub":"a7a7a7a7-0000-4000-8000-000000000001","role":"authenticated"}';
delete from bookings where id = 'a8a8a8a8-0000-4000-8000-000000000003';

-- radar_wave1_exhausted is the one function here with no caller of its own
-- to check, so it must not be reachable from outside.
select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'radar_wave1_exhausted'
        and (has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute')) $$,
  'radar_wave1_exhausted is internal to staff_open_shifts: no signed-in account can probe a role''s pool');

select * from finish();
rollback;
