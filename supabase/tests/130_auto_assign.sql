-- =====================================================================
-- 130 · Auto-assign (§3.4), three-stage confirmation (§3.5), booking
--       state machine (§3.6).
--
-- Four parts:
--   1. The shared booked-elsewhere vectors, run against the SQL half of
--      packages/domain/src/overlap.ts.
--   2. The candidate pool: every hard gate fires, and only the right one.
--   3. The engine: additive invitations, first-to-confirm, the automatic
--      withdrawal of overlapping invitations.
--   4. The clock: the 12:00 day-before cutoff across both BST and GMT,
--      self-cancel's 72-hour window, and the exclusive handover from the
--      hourly round to escalation at the moment a shift starts.
--
-- Every row is created inside the transaction and rolled back.
-- =====================================================================
begin;
select plan(70);

\ir _shared/overlap_vectors.psql

-- ---------------------------------------------------------------------
-- 1. The shared vectors
--
-- Two conversions, both deliberate.
--
-- The JSON carries zone-less ISO instants and the TypeScript side parses
-- them as UTC, so the 'Z' is appended here too — casting them raw would
-- read them in the server's zone and quietly test something else.
--
-- Venues are opaque labels in the vectors ('v1', 'v2'), because the rule
-- only ever asks whether two venues are the SAME one; the domain side has
-- no business knowing they are uuids in this database. md5()::uuid maps a
-- label to a stable uuid, so equality and nullness both survive the trip.
-- ---------------------------------------------------------------------
select is((select count(*)::int from vec_overlap), 15,
  'all 15 shared booked-elsewhere vectors loaded from overlap.vectors.json');

select results_eq(
  $$ select v.name,
            booked_elsewhere_conflict(
              ((v.input->'candidate'->>'startsAt') || 'Z')::timestamptz,
              ((v.input->'candidate'->>'endsAt')   || 'Z')::timestamptz,
              md5(v.input->'candidate'->>'venueId')::uuid,
              ((v.input->'held'->>'startsAt') || 'Z')::timestamptz,
              ((v.input->'held'->>'endsAt')   || 'Z')::timestamptz,
              md5(v.input->'held'->>'venueId')::uuid,
              (v.input->>'gapMinutes')::int)
       from vec_overlap v order by v.name $$,
  $$ select name, expect from vec_overlap order by name $$,
  'overlap.vectors.json: SQL booked_elsewhere_conflict() agrees with TypeScript overlapVerdict(), case for case'
);

select is(booked_elsewhere_gap_minutes(), 120,
  '§3.4: the different-venue gap is the two hours in settings, a fixed figure and not a travel time');

-- ---------------------------------------------------------------------
-- 2. Fixtures
--
-- One event at one venue with a single Waiting Staff section, headcount 2
-- buffer 1, so the confirmation target is 3 and "6 (+1)" arithmetic is
-- exercised at a readable size. Eight workers, each set up to trip one
-- gate, plus two clean ones for the engine tests.
-- ---------------------------------------------------------------------
\set cl      '7a7a7a7a-0000-4000-8000-000000000001'
\set cl2     '7a7a7a7a-0000-4000-8000-000000000002'
\set ro      '7b7b7b7b-0000-4000-8000-000000000001'
\set ro2     '7b7b7b7b-0000-4000-8000-000000000002'
\set ve      '7c7c7c7c-0000-4000-8000-000000000001'
\set ve2     '7c7c7c7c-0000-4000-8000-000000000002'
\set evt     '7d7d7d7d-0000-4000-8000-000000000001'
\set evt2    '7d7d7d7d-0000-4000-8000-000000000002'
\set sec     '7e7e7e7e-0000-4000-8000-000000000001'
\set other   '7e7e7e7e-0000-4000-8000-000000000002'
\set clean   '7f7f7f7f-0000-4000-8000-000000000001'
\set clean2  '7f7f7f7f-0000-4000-8000-000000000002'
\set wrong   '7f7f7f7f-0000-4000-8000-000000000003'
\set blocked '7f7f7f7f-0000-4000-8000-000000000004'
\set dnr     '7f7f7f7f-0000-4000-8000-000000000005'
\set elsew   '7f7f7f7f-0000-4000-8000-000000000006'
\set capped  '7f7f7f7f-0000-4000-8000-000000000007'
\set selfc   '7f7f7f7f-0000-4000-8000-000000000008'

-- The RPCs authorise the caller themselves (they are `security definer`
-- over tables a worker cannot write), so the suite needs real identities:
-- a manager for the office-side calls and one worker for the two
-- assertions that exercise the worker path.
\set admin_uid '8a8a8a8a-0000-4000-8000-000000000001'
\set clean_uid '8a8a8a8a-0000-4000-8000-000000000002'

insert into auth.users (id, email) values
  (:'admin_uid', 'manager@auto.test'), (:'clean_uid', 'c1@auto.test');
insert into profiles (id, role, full_name) values (:'admin_uid', 'admin', 'Auto Fixture Manager');

insert into clients (id, name, contact_name, phone, staff_contact_point, contact_emails) values
  (:'cl',  'Auto Fixture Client',  'Ann A', '+447700900201', 'Front desk', array['auto@auto.test']),
  (:'cl2', 'Auto Fixture Client 2','Ben B', '+447700900202', 'Stage door', array['auto2@auto.test']);
insert into roles (id, name, pay_rate) values
  (:'ro', 'Auto Waiting Staff', 14.00), (:'ro2', 'Auto Bar Staff', 15.50);
insert into venues (id, name, address, location, venue_type, geofence_radius_m) values
  (:'ve',  'Auto Venue',   '3 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 'hotel', 150),
  (:'ve2', 'Auto Venue 2', '4 Test Street, London',
   st_setsrid(st_makepoint(-0.1400, 51.5000), 4326)::geography, 'hotel', 150);

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer, auto_assign) values
  (:'evt',  :'cl',  :'ve',  'Auto Venue',   '3 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Auto Fixture Event', (now() + interval '10 days')::date, true, true, true),
  (:'evt2', :'cl2', :'ve2', 'Auto Venue 2', '4 Test Street, London',
   st_setsrid(st_makepoint(-0.1400, 51.5000), 4326)::geography, 150,
   'Auto Fixture Event 2', (now() + interval '10 days')::date, true, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour, auto_assign) values
  (:'sec',   :'evt',  :'ro', now() + interval '10 days',
   now() + interval '10 days 8 hours', 2, 1, 22.97, 14.00, 3, true),
  -- Same day at the OTHER venue, one hour after the fixture section ends:
  -- inside the two-hour gap, so it makes its holder booked-elsewhere.
  (:'other', :'evt2', :'ro', now() + interval '10 days 9 hours',
   now() + interval '10 days 17 hours', 4, 0, 22.97, 14.00, 4, true);

insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, rtw_branch,
                   home_location, reliability, rating) values
  (:'clean',   :'clean_uid', 'Clean','One',       'c1@auto.test','+447700900211', date '1995-01-01','compliant','uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, 98, 4.8),
  (:'clean2',  null,         'Clean','Two',       'c2@auto.test','+447700900212', date '1995-01-02','compliant','uk_irish',
   st_setsrid(st_makepoint(-0.1020, 51.5000), 4326)::geography, 92, 4.2),
  (:'wrong',   null,         'Wrong','Role',      'wr@auto.test','+447700900213', date '1995-01-03','compliant','uk_irish',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 99, 5.0),
  (:'blocked', null,         'Block','Ed',        'bl@auto.test','+447700900214', date '1995-01-04','blocked','uk_irish',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 99, 5.0),
  (:'dnr',     null,         'Do','NotReturn',    'dn@auto.test','+447700900215', date '1995-01-05','compliant','uk_irish',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 99, 5.0),
  (:'elsew',   null,         'Booked','Elsewhere','be@auto.test','+447700900216', date '1995-01-06','compliant','uk_irish',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 99, 5.0),
  (:'capped',  null,         'Hours','Limit',     'hl@auto.test','+447700900217', date '1995-01-07','compliant','international_student',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 99, 5.0),
  (:'selfc',   null,         'Self','Cancel',     'sc@auto.test','+447700900218', date '1995-01-08','compliant','uk_irish',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 99, 5.0);

-- Everyone qualifies for the ROLE except `wrong`.
insert into staff_roles (staff_id, role_id)
select id, :'ro' from staff where id in
  (:'clean', :'clean2', :'blocked', :'dnr', :'elsew', :'capped', :'selfc');
insert into staff_roles (staff_id, role_id) values (:'wrong', :'ro2');

-- `clean` is qualified at this client AND role: wave 1. `clean2` is not.
insert into client_qualifications (client_id, role_id, staff_id) values (:'cl', :'ro', :'clean');
-- `dnr` carries the client-level bar, on the OTHER role — §9.6 reads it per client.
insert into client_qualifications (client_id, role_id, staff_id, do_not_return)
values (:'cl', :'ro2', :'dnr', true);
-- `elsew` holds a confirmed booking at the other venue, one hour after ours.
insert into bookings (shift_id, staff_id, status, source, confirmed_at)
values (:'other', :'elsew', 'confirmed', 'manual', now());
-- `capped` is a student in term time (no holiday ranges) → 20 h, and already
-- holds 16 h that week, so our 8-hour section would take them to 24.
update staff set term_dates = '{}' where id = :'capped';
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour)
-- On the Monday of the section's week — or the Tuesday when the section IS
-- that Monday (a Friday run), so the two never overlap and booked_elsewhere
-- cannot fire before the cap does.
values ('7e7e7e7e-0000-4000-8000-000000000003', :'evt2', :'ro',
        date_trunc('week', (now() + interval '10 days'))
          + (case when (now() + interval '10 days')::date = date_trunc('week', (now() + interval '10 days'))::date
                  then interval '1 day' else interval '0 day' end) + interval '1 hour',
        date_trunc('week', (now() + interval '10 days'))
          + (case when (now() + interval '10 days')::date = date_trunc('week', (now() + interval '10 days'))::date
                  then interval '1 day' else interval '0 day' end) + interval '17 hours',
        9, 0, 22.97, 14.00, 9);
insert into bookings (shift_id, staff_id, status, source, confirmed_at)
values ('7e7e7e7e-0000-4000-8000-000000000003', :'capped', 'confirmed', 'manual', now());
-- `selfc` self-cancelled off this event earlier (RULE-04).
insert into bookings (shift_id, staff_id, status, source, cancelled_at, cancel_cause, self_cancelled)
values (:'sec', :'selfc', 'cancelled', 'auto', now(), 'self_cancel', true);

-- ---------------------------------------------------------------------
-- 3. The pool and its gates
--
-- From here on the caller is the manager: invite_worker, and the office
-- side of accept_invite, are admin-only by the checks inside them.
-- ---------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"8a8a8a8a-0000-4000-8000-000000000001","role":"authenticated"}';

select is((select gate from auto_assign_candidates(:'sec') where staff_id = :'clean'), null,
  'a compliant, qualified, free worker carries no gate');
select is((select gate from auto_assign_candidates(:'sec') where staff_id = :'wrong'), 'wrong_role',
  'a worker who does not hold the role is gated wrong_role (§6: no row on the board at all)');
select is((select gate from auto_assign_candidates(:'sec') where staff_id = :'blocked'), 'blocked',
  'a blocked worker is gated before scoring (§2.12)');
select is((select gate from auto_assign_candidates(:'sec') where staff_id = :'dnr'), 'do_not_return',
  'do-not-return bars the worker at this client even though it was set on another role (§9.6)');
select is((select gate from auto_assign_candidates(:'sec') where staff_id = :'elsew'), 'booked_elsewhere',
  'a confirmed booking an hour later at a DIFFERENT venue is inside the two-hour gap (§3.4)');
select is((select gate from auto_assign_candidates(:'sec') where staff_id = :'capped'), 'hours_limit',
  'RULE-20 is a hard gate: 16 h already held + this 8 h section is over the 20 h term cap');
select is((select gate from auto_assign_candidates(:'sec') where staff_id = :'selfc'), 'self_cancelled',
  'RULE-04: self-cancelling off this event bars the worker from it permanently');

select is((select qualified from auto_assign_candidates(:'sec') where staff_id = :'clean'), true,
  'wave 1: qualified at this client AND this role (RULE-17)');
select is((select qualified from auto_assign_candidates(:'sec') where staff_id = :'clean2'), false,
  'wave 2: qualified for the role in general but not at this client');
select is((select qualified from auto_assign_candidates(:'sec') where staff_id = :'dnr'), false,
  'a do-not-return row never counts as a qualification');

select ok((select distance_km from auto_assign_candidates(:'sec') where staff_id = :'clean') < 0.2,
  'the proximity input is the real distance from the worker home to the venue');
select is((select reliability from auto_assign_candidates(:'sec') where staff_id = :'clean'), 98::numeric,
  'the show-rate input comes off the worker, for scoring in TypeScript');
select is_empty(
  $$ select 1 from auto_assign_candidates('7e7e7e7e-0000-4000-8000-000000000001')
      where reliability is null or rating is null or distance_km is null $$,
  'no factor input is ever null: a worker with no history gets the zero point, not a null that would NaN the score'
);

-- ---------------------------------------------------------------------
-- 4. Fill and the additive rounds
-- ---------------------------------------------------------------------
select is((select target from shift_fill(:'sec')), 3,
  'the confirmation target is headcount + buffer — the buffer is part of the target, not the headcount');
select is((select confirmed from shift_fill(:'sec')), 0, 'a cancelled booking is not a fill');

select is(invite_worker(:'sec', :'clean')->>'invited', 'true', 'a clean candidate is invited');
select is((select invited from shift_fill(:'sec')), 1, 'the invitation shows as invited, not as fill');
select is((select confirmed from shift_fill(:'sec')), 0, 'fill counts ONLY confirmed (§3.2)');
select is(invite_worker(:'sec', :'clean')->>'reason', 'already_has_booking',
  'auto-assign is additive and never doubles up on someone it has already invited');
select is(invite_worker(:'sec', :'blocked')->>'reason', 'blocked',
  'the gates are re-applied at the moment of the insert, not just when the pool was queried');
select is(invite_worker(:'sec', :'selfc')->>'reason', 'self_cancelled',
  'RULE-04 blocks a MANUAL invitation too, not only auto-assign');

-- ---------------------------------------------------------------------
-- The gate that is an ABSENCE rather than a value.
--
-- auto_assign_candidates ends `where s.removed_at is null and s.left_at
-- is null`, so for a leaver (§10.6) or a removed worker (§1.7) it returns
-- NO ROW — not a row carrying a gate. invite_worker read that with
-- `select gate into v_gate ... ; if v_gate is not null then refuse`, and
-- PL/pgSQL leaves the variable NULL when nothing matches. So the absence
-- of a candidate row read exactly like "no gate applies" and the insert
-- went ahead: §10.6 step 5 says a leaver "cannot be invited,
-- auto-assigned or manually added to any event", and §2.12 says the same
-- of all three stopped states.
--
-- Unreachable until §10.6 and §1.7 existed, because nothing could set
-- either column. 20260921192246 closes it with `not found`.
-- ---------------------------------------------------------------------
-- Borrowed inside a savepoint: clean2 is the second worker in the
-- first-to-confirm and withdrawal cases below, and §2.12 (20260926130800)
-- refuses removed → compliant on the row, so "putting them back" is a
-- rollback, not an update. The answers are captured with \gset and
-- asserted after the rollback, so the test counter is untouched by it.
savepoint borrowed_clean2;
update staff set status = 'inactive', left_at = now() - interval '1 day' where id = :'clean2';
select invite_worker(:'sec', :'clean2')->>'reason' as left_reason \gset
select count(*)::int as left_rows from bookings where shift_id = :'sec' and staff_id = :'clean2' \gset
update staff set status = 'removed', left_at = null, removed_at = now() - interval '1 day' where id = :'clean2';
select invite_worker(:'sec', :'clean2')->>'reason' as removed_reason \gset
rollback to savepoint borrowed_clean2;

select is(:'left_reason'::text, 'not_bookable',
  '§10.6: a worker who has left cannot be invited — their absence from the candidate pool must not read as "no gate applies"');
select is(:'left_rows'::int, 0,
  'and no row is written, which is what the old code did instead');
select is(:'removed_reason'::text, 'not_bookable',
  '§1.7: nor can a GDPR-removed worker, for the same reason and by the same route');
select is((select gate from auto_assign_candidates(:'sec') where staff_id = :'clean2'), null,
  'and they return to the pool cleanly (the borrowing was rolled back — §2.12 has no removed → compliant edge), so the cases below are unaffected');

-- ---------------------------------------------------------------------
-- 5. First-to-confirm and the automatic withdrawal (§3.4, §3.6)
-- ---------------------------------------------------------------------
select is(
  accept_invite((select id from bookings where shift_id = :'sec' and staff_id = :'clean'))->>'ok',
  'true', 'the worker accepts and the booking is confirmed');
select is((select confirmed from shift_fill(:'sec')), 1, 'accepting moves the booking into the fill');
select is((select status::text from bookings where shift_id = :'sec' and staff_id = :'clean'),
  'confirmed', 'invited → confirmed (§3.6)');

-- An invitation elsewhere whose window intersects the accepted one is
-- withdrawn; one that merely falls inside the travel gap is not.
insert into bookings (shift_id, staff_id, status, source) values (:'other', :'clean2', 'invited', 'auto');
select is(invite_worker(:'sec', :'clean2')->>'invited', 'true', 'the second worker is invited');
select is(
  accept_invite((select id from bookings where shift_id = :'sec' and staff_id = :'clean2'))->>'withdrawn',
  '0', 'an invitation an hour later at another venue does NOT intersect, so it is left alone (§3.4)');
select is((select status::text from bookings where shift_id = :'other' and staff_id = :'clean2'),
  'invited', 'that invitation is still live — the office may yet move its time');

-- Now one that really does intersect.
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour)
values ('7e7e7e7e-0000-4000-8000-000000000004', :'evt2', :'ro',
        now() + interval '20 days', now() + interval '20 days 8 hours', 4, 0, 22.97, 14.00, 4);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour)
values ('7e7e7e7e-0000-4000-8000-000000000005', :'evt', :'ro',
        now() + interval '20 days 4 hours', now() + interval '20 days 12 hours', 4, 0, 22.97, 14.00, 4);
insert into bookings (shift_id, staff_id, status, source) values
  ('7e7e7e7e-0000-4000-8000-000000000004', :'clean', 'invited', 'auto'),
  ('7e7e7e7e-0000-4000-8000-000000000005', :'clean', 'invited', 'auto');
select is(
  accept_invite((select id from bookings
                  where shift_id = '7e7e7e7e-0000-4000-8000-000000000004' and staff_id = :'clean'))->>'withdrawn',
  '1', 'Accept automatically withdraws the other open invitation that overlaps its window (14.07.2026)');
select is((select cancel_cause from bookings
            where shift_id = '7e7e7e7e-0000-4000-8000-000000000005' and staff_id = :'clean'),
  'overlap_auto_withdraw', 'the withdrawn invitation records why it went');

-- The safety net: a worker cannot accept onto something that clashes with
-- a booking they have already confirmed.
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour)
values ('7e7e7e7e-0000-4000-8000-000000000006', :'evt', :'ro',
        now() + interval '20 days 2 hours', now() + interval '20 days 10 hours', 4, 0, 22.97, 14.00, 4);
insert into bookings (shift_id, staff_id, status, source) values
  ('7e7e7e7e-0000-4000-8000-000000000006', :'clean', 'invited', 'auto');
select is(
  accept_invite((select id from bookings
                  where shift_id = '7e7e7e7e-0000-4000-8000-000000000006' and staff_id = :'clean'))->>'reason',
  'overlap', '§3.4 safety net: Accept is refused on a shift that clashes with a just-confirmed booking');
select is((select status::text from bookings
            where shift_id = '7e7e7e7e-0000-4000-8000-000000000006' and staff_id = :'clean'),
  'invited', 'a refused Accept leaves the invitation live rather than closing it');

-- First-to-confirm: the target is met, so the next Accept finds it gone.
select is(invite_worker(:'sec', :'elsew')->>'invited', 'false',
  'a gated worker is still refused when the section has room');
insert into bookings (shift_id, staff_id, status, source)
values (:'sec', :'dnr', 'invited', 'manual');
update bookings set status = 'confirmed', confirmed_at = now()
 where shift_id = :'sec' and staff_id = :'clean2';
insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  ('7f7f7f7f-0000-4000-8000-000000000009','Third','Confirm','t3@auto.test','+447700900219',
   date '1995-01-09','compliant','uk_irish');
insert into staff_roles (staff_id, role_id) values ('7f7f7f7f-0000-4000-8000-000000000009', :'ro');
insert into bookings (shift_id, staff_id, status, source, confirmed_at)
values (:'sec', '7f7f7f7f-0000-4000-8000-000000000009', 'confirmed', 'auto', now());
select is((select confirmed from shift_fill(:'sec')), 3, 'the section is now at its target of 3');
select is(accept_invite((select id from bookings where shift_id = :'sec' and staff_id = :'dnr'))->>'reason',
  'taken', 'first-to-confirm: the slot has gone and the invitation is refused');
select is((select status::text from bookings where shift_id = :'sec' and staff_id = :'dnr'),
  'closed', '§3.4: the invitation moves to Closed rather than lingering as if it were live');
select is(invite_worker(:'sec', '7f7f7f7f-0000-4000-8000-000000000009')->>'reason', 'already_has_booking',
  'a filled section stops taking invitations');

-- ---------------------------------------------------------------------
-- 6. The clock (§3.5, RULE-04)
-- ---------------------------------------------------------------------
select is(ready_deadline(timestamptz '2026-07-15 10:00+01'), timestamptz '2026-07-14 11:00Z',
  'the day-before deadline is 12:00 UK in BST, which is 11:00 UTC');
select is(ready_deadline(timestamptz '2026-12-15 10:00Z'), timestamptz '2026-12-14 12:00Z',
  'and 12:00 UK in GMT, which is 12:00 UTC — the cutoff does not drift across the DST boundary');

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour)
values ('7e7e7e7e-0000-4000-8000-000000000007', :'evt', :'ro',
        timestamptz '2026-12-15 10:00Z', timestamptz '2026-12-15 18:00Z', 4, 0, 22.97, 14.00, 4);
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  ('0e0e0e0e-0000-4000-8000-000000000001','7e7e7e7e-0000-4000-8000-000000000007', :'clean',
   'confirmed','auto', now()),
  ('0e0e0e0e-0000-4000-8000-000000000002','7e7e7e7e-0000-4000-8000-000000000007', :'clean2',
   'confirmed','auto', now());
update bookings set day_before_confirmed_at = now() where id = '0e0e0e0e-0000-4000-8000-000000000002';

select is(release_unready_bookings(timestamptz '2026-12-14 11:59Z'), 0,
  'one minute before noon the day before, nobody is released');
select is(release_unready_bookings(timestamptz '2026-12-14 12:05Z'), 1,
  'at the cutoff the worker who never pressed "I am ready" loses the slot, and only them');
select is((select cancel_cause from bookings where id = '0e0e0e0e-0000-4000-8000-000000000001'),
  'ready_cutoff', 'the released booking records the cutoff as its cause');
select is((select status::text from bookings where id = '0e0e0e0e-0000-4000-8000-000000000002'),
  'confirmed', 'the worker who did press it keeps the shift');
select is((select count(*)::int from notification_outbox
            where key = 'N6b:booking:0e0e0e0e-0000-4000-8000-000000000001'), 1,
  'N6b is queued once, under its idempotency key (§8)');
select is(release_unready_bookings(timestamptz '2026-12-14 12:10Z'), 0,
  'the job is idempotent: a second pass releases nobody and queues nothing new');

-- §3.5: a booking confirmed AFTER the day-before deadline — the
-- replacement the 12:05 re-fill itself produced, or an invitation accepted
-- that afternoon — was never given stage 2, and stage 3 never releases.
-- Before 20260926130400 this worker was released at 12:05 ON THE SHIFT DAY
-- with N6b "…removed from your shift tomorrow…".
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  ('0e0e0e0e-0000-4000-8000-00000000ff01','7e7e7e7e-0000-4000-8000-000000000007', :'wrong',
   'confirmed','auto', timestamptz '2026-12-14 14:00Z');
select is(release_unready_bookings(timestamptz '2026-12-15 09:00Z'), 0,
  '§3.5: a booking confirmed after the 12:00 deadline is not released by the next 12:05 — on the day itself nothing releases');
select is((select status::text from bookings where id = '0e0e0e0e-0000-4000-8000-00000000ff01'), 'confirmed',
  'and the late-confirmed worker keeps the shift');

-- §8 N5 renders "{role} · {event} · {dateTime} · {rate}/h": the payload
-- carries every value, and the rate is the worker's BASE rate (§1.5).
select queue_booking_push('N5', '0e0e0e0e-0000-4000-8000-00000000ff01');
select is((select payload->>'role' from notification_outbox where key = 'N5:booking:0e0e0e0e-0000-4000-8000-00000000ff01'),
  (select name from roles where id = :'ro'), 'N5 carries the role name');
select is((select payload->>'rate' from notification_outbox where key = 'N5:booking:0e0e0e0e-0000-4000-8000-00000000ff01'),
  '£14.00', 'and the BASE pay rate — never the charge rate, holiday never blended (§1.5)');
select is((select payload->>'dateTime' from notification_outbox where key = 'N5:booking:0e0e0e0e-0000-4000-8000-00000000ff01'),
  'Tue 15 Dec 10:00–18:00', 'and the section''s window in Europe/London');

select is(self_cancel_booking('0e0e0e0e-0000-4000-8000-000000000002')->>'ok', 'true',
  'RULE-04: a worker may self-cancel while more than 72 hours remain');
select is((select self_cancelled from bookings where id = '0e0e0e0e-0000-4000-8000-000000000002'), true,
  'self-cancel sets the flag that bars them from the whole event, unlike every other cancel');

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at)
values ('0e0e0e0e-0000-4000-8000-000000000003', :'sec', :'elsew', 'confirmed', 'auto', now());
update shift_requirements set starts_at = now() + interval '48 hours',
                              ends_at = now() + interval '56 hours' where id = :'sec';
select is(self_cancel_booking('0e0e0e0e-0000-4000-8000-000000000003')->>'reason', 'too_late',
  'inside 72 hours the worker must call the office instead (RULE-04)');

-- ---------------------------------------------------------------------
-- 7. The exclusive handover at the shift's start (§3.4)
-- ---------------------------------------------------------------------
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour)
values ('7e7e7e7e-0000-4000-8000-000000000008', :'evt', :'ro',
        now() - interval '1 hour', now() + interval '7 hours', 4, 0, 22.97, 14.00, 4);

select is_empty(
  $$ select 1 from auto_assign_due_shifts('hourly')
      where shift_id = '7e7e7e7e-0000-4000-8000-000000000008' $$,
  'once a shift is under way the hourly round does not touch it at all — the handover is exclusive');
select isnt_empty(
  $$ select 1 from auto_assign_due_shifts('escalation')
      where shift_id = '7e7e7e7e-0000-4000-8000-000000000008' $$,
  'the escalation job picks up a shift that is under way and still short');
select is_empty(
  $$ select 1 from auto_assign_due_shifts('escalation')
      where shift_id = '7e7e7e7e-0000-4000-8000-000000000007' $$,
  'and leaves a shift that has not started alone');

update events set auto_assign = false where id = :'evt';
select is_empty(
  $$ select 1 from auto_assign_due_shifts('escalation')
      where shift_id = '7e7e7e7e-0000-4000-8000-000000000008' $$,
  'the event-level switch turns auto-assign off for every section under it (§3.4)');
update events set auto_assign = true where id = :'evt';
update shift_requirements set auto_assign = false where id = '7e7e7e7e-0000-4000-8000-000000000008';
select is_empty(
  $$ select 1 from auto_assign_due_shifts('escalation')
      where shift_id = '7e7e7e7e-0000-4000-8000-000000000008' $$,
  'and the role-level switch turns it off for just that section');

-- ---------------------------------------------------------------------
-- 8. Who may call these
--
-- The RPCs are `security definer` over tables a worker holds no write
-- policy on, so the authorisation is theirs to do. If it were wrong, a
-- worker could confirm themselves into somebody else's slot.
-- ---------------------------------------------------------------------
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour)
values ('7e7e7e7e-0000-4000-8000-000000000009', :'evt2', :'ro',
        now() + interval '30 days', now() + interval '30 days 8 hours', 4, 0, 22.97, 14.00, 4);
insert into bookings (id, shift_id, staff_id, status, source) values
  ('0e0e0e0e-0000-4000-8000-000000000004','7e7e7e7e-0000-4000-8000-000000000009', :'clean',  'invited','auto'),
  ('0e0e0e0e-0000-4000-8000-000000000005','7e7e7e7e-0000-4000-8000-000000000009', :'clean2', 'invited','auto');

set local "request.jwt.claims" = '{"sub":"8a8a8a8a-0000-4000-8000-000000000002","role":"authenticated"}';

select is(accept_invite('0e0e0e0e-0000-4000-8000-000000000004')->>'ok', 'true',
  'a worker accepts their own invitation');
select throws_ok(
  $$ select accept_invite('0e0e0e0e-0000-4000-8000-000000000005') $$,
  '42501', 'not_your_booking',
  'and cannot accept somebody else''s, which is the whole reason these are definer functions');

-- ---------------------------------------------------------------------
-- 9. The weekly cap is re-read at the moment of Accept (§10.4, RULE-20)
--
-- The gate in auto_assign_candidates stops the INVITATION. This is the
-- other half: a worker may hold an open invitation for days and accept
-- other shifts in the meantime, so the cap has to be asked again here,
-- exactly as the slot count and the booked-elsewhere gap already are.
--
-- `capped` is the student from the fixtures above: no holiday ranges on
-- file, so term time and a 20-hour cap, already holding the 16-hour
-- section in the same Mon-Sun week. An 8-hour section takes them to 24.
-- ---------------------------------------------------------------------
-- Back to the manager: section 8 left the session as a worker, and these
-- calls are about a different worker's booking.
set local "request.jwt.claims" = '{"sub":"8a8a8a8a-0000-4000-8000-000000000001","role":"authenticated"}';

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour)
values ('7e7e7e7e-0000-4000-8000-00000000000a', :'evt2', :'ro',
        date_trunc('week', (now() + interval '10 days')) + interval '2 days 9 hours',
        date_trunc('week', (now() + interval '10 days')) + interval '2 days 17 hours',
        4, 0, 22.97, 14.00, 4);
insert into bookings (id, shift_id, staff_id, status, source)
values ('0e0e0e0e-0000-4000-8000-00000000000a','7e7e7e7e-0000-4000-8000-00000000000a',
        :'capped', 'invited', 'manual');

select is(weekly_cap_hours(:'capped', (date_trunc('week', (now() + interval '10 days')))::date), 20,
  'the fixture student is on the 20-hour term cap, with no holiday ranges on file');
select is(accept_invite('0e0e0e0e-0000-4000-8000-00000000000a')->>'reason', 'hours_limit',
  '§10.4: Accept is blocked where it would take the worker over their weekly limit');
select is((select status::text from bookings where id = '0e0e0e0e-0000-4000-8000-00000000000a'),
  'invited',
  'and the invitation stays live rather than closing: the hours can free up, unlike a slot that has gone');

-- The same worker, under the cap: the gate must not be a blanket refusal.
update bookings set status = 'cancelled', cancelled_at = now(), cancel_cause = 'office_withdraw'
 where shift_id = '7e7e7e7e-0000-4000-8000-000000000003' and staff_id = :'capped';
select is(accept_invite('0e0e0e0e-0000-4000-8000-00000000000a')->>'ok', 'true',
  'with the 16 hours released, the same 8-hour shift fits inside the 20 and Accept goes through');

select * from finish();
rollback;
