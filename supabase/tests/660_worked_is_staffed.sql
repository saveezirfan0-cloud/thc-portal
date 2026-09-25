-- =====================================================================
-- 660 · A checked-in worker is staffed (§3.2, §3.4, §3.6; audit D2)
--   20260930110000_worked_is_staffed.sql
--
--   1. shift_fill counts `worked` as confirmed; turned_away is not staffed.
--   2. A fully checked-in section is not picked by the escalation job, nor
--      by the hourly round (early check-in before the start), and every
--      write path refuses it as full: invite_worker (target_met),
--      office_invite_worker / apply_to_shift / accept_application (full).
--      A section short by one after check-in is picked, short by one.
--   3. A worker checked in at venue A is booked_elsewhere for an
--      overlapping shift at venue B, and cannot accept it (overlap).
--   4. Only workers have a candidate row: a candidate mid-onboarding or a
--      rejected applicant has none (not "Blocked — compliance"), and every
--      write path calls them not_bookable.
--   5. anon cannot execute auto_assign_candidates.
-- =====================================================================
begin;
select plan(24);
\ir _shared/fixtures.psql

\set ro    '61500000-0000-4000-8000-000000000001'
\set venb  '61500000-0000-4000-8000-000000000002'
\set eva   '61500000-0000-4000-8000-0000000000e1'
\set evb   '61500000-0000-4000-8000-0000000000e2'
\set sfull '61510000-0000-4000-8000-000000000001'
\set sone  '61510000-0000-4000-8000-000000000002'
\set searl '61510000-0000-4000-8000-000000000003'
\set sb    '61510000-0000-4000-8000-000000000004'
\set w1    '61520000-0000-4000-8000-000000000001'
\set w2    '61520000-0000-4000-8000-000000000002'
\set w3    '61520000-0000-4000-8000-000000000003'
\set w4    '61520000-0000-4000-8000-000000000004'
\set cand  '61520000-0000-4000-8000-000000000005'
\set rej   '61520000-0000-4000-8000-000000000006'
\set w7    '61520000-0000-4000-8000-000000000007'
\set w8    '61520000-0000-4000-8000-000000000008'
\set inv   '61530000-0000-4000-8000-000000000001'
\set app   '61530000-0000-4000-8000-000000000002'

insert into roles (id, name, pay_rate) values (:'ro', 'Worked Waiting Staff', 14.00);
insert into venues (id, name, address, location, venue_type, geofence_radius_m) values
  (:'venb', 'Venue B', '9 Other Road, London',
   st_setsrid(st_makepoint(-0.1300, 51.5100), 4326)::geography, 'hotel', 150);

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'eva', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Venue A Night',
   (now() at time zone 'Europe/London')::date, true, true),
  (:'evb', :'clienta', :'venb', 'Venue B', '9 Other Road, London',
   st_setsrid(st_makepoint(-0.1300, 51.5100), 4326)::geography, 150, 'Venue B Night',
   (now() at time zone 'Europe/London')::date, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  -- Under way, 1 (+0), the one worker checked in: full.
  (:'sfull', :'eva', :'ro', now() - interval '1 hour', now() + interval '5 hours', 1, 0, 22, 14, 1),
  -- Under way, 2 (+0), one checked in: short by one.
  (:'sone',  :'eva', :'ro', now() - interval '1 hour', now() + interval '5 hours', 2, 0, 22, 14, 2),
  -- Starts in 20 minutes, 1 (+0), the worker already checked in early.
  (:'searl', :'eva', :'ro', now() + interval '20 minutes', now() + interval '6 hours', 1, 0, 22, 14, 1),
  -- Venue B, overlapping the Venue A sections.
  (:'sb',    :'evb', :'ro', now() + interval '1 hour', now() + interval '6 hours', 3, 0, 22, 14, 3);

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch, home_location) values
  (:'w1',   'Ada', 'Onshift', 'w1@wk615.test', '+447700961501', date '1995-01-01', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography),
  (:'w2',   'Ben', 'Onshift', 'w2@wk615.test', '+447700961502', date '1995-01-01', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography),
  (:'w3',   'Cai', 'Free',    'w3@wk615.test', '+447700961503', date '1995-01-01', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography),
  (:'w4',   'Dee', 'Applied', 'w4@wk615.test', '+447700961504', date '1995-01-01', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography),
  (:'cand', 'Eve', 'Candidate','w5@wk615.test', '+447700961505', date '1995-01-01', 'documents', 'uk_irish', null),
  (:'rej',  'Fin', 'Rejected', 'w6@wk615.test', '+447700961506', date '1995-01-01', 'rejected',  'uk_irish', null),
  (:'w7',   'Gus', 'Turned',  'w7@wk615.test', '+447700961507', date '1995-01-01', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography),
  (:'w8',   'Hal', 'Free',    'w8@wk615.test', '+447700961508', date '1995-01-01', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography);
insert into staff_roles (staff_id, role_id)
select id, :'ro' from staff where email like '%@wk615.test';

-- Checked in (§3.6 confirmed → worked), each on a different Venue A section.
insert into bookings (shift_id, staff_id, status, source, confirmed_at) values
  (:'sfull', :'w1', 'worked', 'auto', now() - interval '2 days'),
  (:'sone',  :'w2', 'worked', 'auto', now() - interval '2 days'),
  (:'searl', :'w3', 'worked', 'auto', now() - interval '2 days'),
  -- Turned away at the door (RULE-15): not staffing the section.
  (:'sone',  :'w7', 'turned_away', 'auto', now() - interval '2 days');
insert into bookings (id, shift_id, staff_id, status, source, applied_at) values
  (:'app', :'searl', :'w4', 'applied', 'self', now() - interval '1 day');
-- Ada is invited to Venue B, overlapping the shift she is on.
insert into bookings (id, shift_id, staff_id, status, source) values
  (:'inv', :'sb', :'w1', 'invited', 'manual');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);

-- ---------------------------------------------------------------------
-- 1 · The fill
-- ---------------------------------------------------------------------
select is((select confirmed from shift_fill(:'sfull')), 1,
  'a checked-in (worked) booking is a confirmed one: it fills the slot (§3.6)');
select is((select still_short from shift_fill(:'sfull')), 0, 'so the full section is not short');
select is((select confirmed from shift_fill(:'sone')), 1,
  'a turned-away worker (RULE-15) does not staff the section');

-- ---------------------------------------------------------------------
-- 2 · Neither round touches a checked-in full section
-- ---------------------------------------------------------------------
select is_empty(
  format($$ select 1 from auto_assign_due_shifts('escalation') where shift_id = %L $$, :'sfull'),
  'escalation: a section whose people have all checked in is not "still short" (it was re-invited every 10 minutes)');
select is(
  (select still_short from auto_assign_due_shifts('escalation') where shift_id = :'sone'), 1,
  'escalation: a section with 1 of 2 checked in is picked, short by exactly one');
select is_empty(
  format($$ select 1 from auto_assign_due_shifts('hourly') where shift_id = %L $$, :'searl'),
  'hourly: a section filled by an early check-in before its start is not picked');

select is(invite_worker(:'searl', :'w8') ->> 'reason', 'target_met',
  'invite_worker: an auto invitation onto a checked-in full section is target_met');
select is(office_invite_worker(:'searl', :'w8'),
  jsonb_build_object('invited', false, 'reason', 'full'),
  'office_invite_worker: the manager is told the role is full');
select is(apply_to_shift(:'searl', :'w8') ->> 'reason', 'full',
  'apply_to_shift: Radar''s live re-check says "Sorry, this shift is now full"');
select is(apply_to_shift(:'searl', :'w2') ->> 'reason', 'booked_elsewhere',
  'apply_to_shift: Ben is on shift elsewhere, and says so first');
select is(accept_application(:'app') ->> 'reason', 'full',
  'accept_application: a checked-in section has no seat left for an application');
select is((select status::text || '/' || cancel_cause from bookings where id = :'app'), 'closed/slot_taken',
  'and the application is closed with N10c at that point');

-- ---------------------------------------------------------------------
-- 3 · Booked elsewhere counts a checked-in booking
-- ---------------------------------------------------------------------
select is((select gate from auto_assign_candidates(:'sb') where staff_id = :'w1'), 'booked_elsewhere',
  'Ada is on shift at Venue A: gated booked_elsewhere for the overlapping Venue B shift');
select is((select gate from auto_assign_candidates(:'sb') where staff_id = :'w3'), 'booked_elsewhere',
  'and so is Cai, checked in early for a Venue A section inside the 2 h gap');
select is(invite_worker(:'sb', :'w2') ->> 'reason', 'booked_elsewhere',
  'invite_worker refuses a worker who is on shift elsewhere');
select is(accept_invite(:'inv') ->> 'reason', 'overlap',
  'accept_invite: the §3.4 safety net holds against a checked-in booking');
select is((select status::text from bookings where id = :'inv'), 'invited',
  'the refused Accept leaves the invitation live');
select is((select gate from auto_assign_candidates(:'sb') where staff_id = :'w7'), null,
  'a turned-away worker is free to be booked elsewhere');

-- ---------------------------------------------------------------------
-- 4 · Workers only
-- ---------------------------------------------------------------------
select is_empty(
  format($$ select 1 from auto_assign_candidates(%L) where staff_id in (%L, %L) $$, :'sb', :'cand', :'rej'),
  'a candidate mid-onboarding and a rejected applicant have no candidate row — not an Unavailable "Blocked — compliance"');
select is((select gate from auto_assign_candidates(:'sb') where staff_id = :'w4'), null,
  'a compliant worker still has theirs');
select is(invite_worker(:'sb', :'cand') ->> 'reason', 'not_bookable',
  'invite_worker: a candidate is not bookable');
select is(apply_to_shift(:'sb', :'rej') ->> 'reason', 'not_bookable',
  'apply_to_shift: nor is a rejected applicant — an absent row is not "no gate"');

-- ---------------------------------------------------------------------
-- 5 · Grants
-- ---------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.auto_assign_candidates(uuid, boolean)', 'execute'),
  'anon cannot execute auto_assign_candidates');
select ok(has_function_privilege('authenticated', 'public.auto_assign_candidates(uuid, boolean)', 'execute')
      and has_function_privilege('service_role', 'public.auto_assign_candidates(uuid, boolean)', 'execute'),
  'the board (authenticated admin) and the job (service role) still can');

select * from finish();
rollback;
