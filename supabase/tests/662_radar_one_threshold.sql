-- =====================================================================
-- 662 · Radar stops offering, and applications close with N10c, at ONE
--       threshold (§3.3, §8 N10c, §10.4; audit D39)
--   20260930110200_radar_closes_where_it_stops_offering.sql
--
--   1. Between headcount and headcount + buffer the Applied card no longer
--      vanishes without a word: the application closes with N10c at the
--      moment Radar stops offering the shift (confirmed = headcount).
--   2. The worker's own pending application stays on Radar until it
--      resolves, whatever the wave or the gates do meanwhile, and until
--      the section ends (RULE-16) — not merely until it starts.
--   3. Radar offers a section again after an ended row the worker may
--      reopen (office withdrawal), never after a self-cancel.
-- =====================================================================
begin;
select plan(17);
\ir _shared/fixtures.psql

select cap_week_start(current_date) + 14 as w \gset

\set ro   '61700000-0000-4000-8000-000000000001'
\set eva  '61700000-0000-4000-8000-0000000000e1'
\set evb  '61700000-0000-4000-8000-0000000000e2'
\set s    '61710000-0000-4000-8000-000000000001'
\set s2   '61710000-0000-4000-8000-000000000002'
\set s3   '61710000-0000-4000-8000-000000000003'
\set s4   '61710000-0000-4000-8000-000000000004'
\set s5   '61710000-0000-4000-8000-000000000005'
\set me   '61720000-0000-4000-8000-000000000001'
\set x1   '61720000-0000-4000-8000-000000000002'
\set x2   '61720000-0000-4000-8000-000000000003'
\set q    '61720000-0000-4000-8000-000000000004'
\set i1   '61730000-0000-4000-8000-000000000001'
\set i2   '61730000-0000-4000-8000-000000000002'

insert into roles (id, name, pay_rate) values (:'ro', 'Radar Waiting Staff', 14.00);
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'eva', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Radar Gala', :'w'::date + 3, true, true),
  (:'evb', :'clientb', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Other Client Dinner', :'w'::date + 4, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  -- 2 (+1): the gap between headcount and target is where the card vanished.
  (:'s',  :'eva', :'ro', (:'w'::date + 3 + time '09:00') at time zone 'Europe/London',
                         (:'w'::date + 3 + time '17:00') at time zone 'Europe/London', 2, 1, 22, 14, 3),
  -- Another client, where the worker is not qualified (Wave 2).
  (:'s2', :'evb', :'ro', (:'w'::date + 4 + time '09:00') at time zone 'Europe/London',
                         (:'w'::date + 4 + time '17:00') at time zone 'Europe/London', 3, 0, 22, 14, 3),
  -- Started an hour ago, ends in four.
  (:'s3', :'eva', :'ro', now() - interval '1 hour', now() + interval '4 hours', 3, 0, 22, 14, 3),
  -- Over.
  (:'s4', :'eva', :'ro', now() - interval '9 hours', now() - interval '1 hour', 3, 0, 22, 14, 3),
  -- Friday evening: a reopen.
  (:'s5', :'eva', :'ro', (:'w'::date + 4 + time '18:00') at time zone 'Europe/London',
                         (:'w'::date + 4 + time '23:00') at time zone 'Europe/London', 3, 0, 22, 14, 3);

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'me', 'Mia', 'Applicant', 'me@rd617.test', '+447700961701', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'x1', 'Ben', 'First',     'x1@rd617.test', '+447700961702', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'x2', 'Cai', 'Second',    'x2@rd617.test', '+447700961703', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'q',  'Dee', 'Qualified', 'q@rd617.test',  '+447700961704', date '1995-01-01', 'compliant', 'uk_irish');
insert into staff_roles (staff_id, role_id) select id, :'ro' from staff where email like '%@rd617.test';
-- Mia is qualified at client A (Wave 1 there); nobody is at client B yet.
insert into client_qualifications (client_id, role_id, staff_id) values (:'clienta', :'ro', :'me');

insert into bookings (id, shift_id, staff_id, status, source) values
  (:'i1', :'s', :'x1', 'invited', 'auto'),
  (:'i2', :'s', :'x2', 'invited', 'auto');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);

-- ---------------------------------------------------------------------
-- 1 · One threshold
-- ---------------------------------------------------------------------
select is(apply_to_shift(:'s', :'me') ->> 'ok', 'true', 'Mia applies on Radar for 2 (+1)');
select is(accept_invite(:'i1') ->> 'closedApplications', '0',
  'Ben confirms: 1 of 2 — a seat is left, so nothing closes');
select isnt_empty(
  format($$ select 1 from staff_open_shifts(%L) where shift_id = %L and applied_at is not null $$, :'me', :'s'),
  'Mia''s card is on Radar under Applied');

select is(accept_invite(:'i2') ->> 'closedApplications', '1',
  'Cai confirms: 2 of 2 (+1) — no seat left, and Mia''s application closes at that moment');
select is((select status::text || '/' || cancel_cause from bookings where shift_id = :'s' and staff_id = :'me'),
  'closed/slot_taken', 'closed as not taken forward');
select is((select count(*)::int from notification_outbox
            where template = 'N10c' and recipient_staff_id = :'me'
              and payload ->> 'shiftId' = :'s'), 1,
  'and Mia gets N10c then — it used to wait for the buffer seat, while her card had already gone');
select is_empty(
  format($$ select 1 from staff_open_shifts(%L) where shift_id = %L $$, :'me', :'s'),
  'the card leaves Radar once closed (§10.4), at the same moment Radar stops offering the shift');
select is(apply_to_shift(:'s', :'me') ->> 'reason', 'full', 'and applying again says full');
select is((select still_short from shift_fill(:'s')), 1,
  'the buffer seat is still open — for invitations (auto-assign keeps adding, §3.4)');

-- ---------------------------------------------------------------------
-- 2 · The worker's own application stays until it resolves
-- ---------------------------------------------------------------------
select is(apply_to_shift(:'s2', :'me') ->> 'ok', 'true',
  'nobody is qualified at client B, so Mia sees it on Radar and applies (RULE-17)');
insert into client_qualifications (client_id, role_id, staff_id) values (:'clientb', :'ro', :'q');
select isnt_empty(
  format($$ select 1 from staff_open_shifts(%L) where shift_id = %L and applied_at is not null $$, :'me', :'s2'),
  'Dee becomes qualified there — Wave 1 is alive again — but Mia''s pending application does not vanish');
select is_empty(
  format($$ select 1 from staff_open_shifts(%L) where shift_id = %L $$, :'x1', :'s2'),
  'while an unqualified worker who has not applied no longer sees it (RULE-17 still holds)');

insert into bookings (shift_id, staff_id, status, source, applied_at) values
  (:'s3', :'me', 'applied', 'self', now() - interval '3 hours'),
  (:'s4', :'me', 'applied', 'self', now() - interval '12 hours');
select isnt_empty(
  format($$ select 1 from staff_open_shifts(%L) where shift_id = %L $$, :'me', :'s3'),
  'an application on a section that has started but not ended is still pending, and still shown');
select is_empty(
  format($$ select 1 from staff_open_shifts(%L) where shift_id = %L $$, :'me', :'s4'),
  'RULE-16: once the section is over, the stale application leaves Radar');

-- ---------------------------------------------------------------------
-- 3 · Offered again after a reopenable end, never after a self-cancel
-- ---------------------------------------------------------------------
insert into bookings (shift_id, staff_id, status, source, cancelled_at, cancel_cause) values
  (:'s5', :'me', 'cancelled', 'auto', now(), 'office_withdraw');
select isnt_empty(
  format($$ select 1 from staff_open_shifts(%L) where shift_id = %L and applied_at is null $$, :'me', :'s5'),
  'withdrawn by the office is not RULE-04: the shift is on Radar again (D33)');
delete from bookings where shift_id = :'s5' and staff_id = :'me';
insert into bookings (shift_id, staff_id, status, source, cancelled_at, cancel_cause, self_cancelled) values
  (:'s5', :'me', 'cancelled', 'auto', now(), 'self_cancel', true);
select is_empty(
  format($$ select 1 from staff_open_shifts(%L) where shift_id = %L $$, :'me', :'s5'),
  'a self-cancel keeps it off Radar for good (RULE-04)');
select is_empty(
  format($$ select 1 from staff_open_shifts(%L) where event_id = %L and applied_at is null $$, :'me', :'eva'),
  'the whole event, in fact — every section Mia has not applied for');

select * from finish();
rollback;
