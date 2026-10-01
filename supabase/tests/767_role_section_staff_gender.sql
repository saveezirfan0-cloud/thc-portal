-- =====================================================================
-- 767 · A staff gender on a role section (ADR-0079)
--   20261002107000_role_section_staff_gender.sql
--
-- Held here:
--   1. the column: off by default, readable by a signed-in session (the
--      per-column SELECT grant 20261001203000 made the rule);
--   2. the pool: on a Male-only section a man is in it, a woman is gated
--      male_only; on a Female-only section the mirror (female_only); a
--      worker with no gender on file is gender_not_recorded on either —
--      and an ordinary section knows nothing of gender;
--   3. wrong_role still wins, and a stronger reason after it does not
--      hide the section's own requirement;
--   4. every booking path refuses by the gate's name: an automatic and a
--      manual invitation, Radar (staff_open_shifts and apply_to_shift), and
--      Accept on an invitation written before the box was ticked — which
--      is left live, never withdrawn;
--   5. set_staff_gender: the office records it and the gate lifts; M or F
--      only; a viewer, a worker and a removed account are refused; the
--      audit row does not carry the value.
-- =====================================================================
begin;
select plan(39);
\ir _shared/fixtures.psql

\set ro      '76750000-0000-4000-8000-000000000001'
\set ro2     '76750000-0000-4000-8000-000000000002'
\set evt     '76750000-0000-4000-8000-00000000000e'
\set mo      '76750000-0000-4000-8000-0000000000a1'
\set plain   '76750000-0000-4000-8000-0000000000a2'
\set fo      '76750000-0000-4000-8000-0000000000a3'
\set man     '76600000-0000-4000-8000-000000000001'
\set woman   '76600000-0000-4000-8000-000000000002'
\set unknown '76600000-0000-4000-8000-000000000003'
\set woman2  '76600000-0000-4000-8000-000000000004'
\set offrole '76600000-0000-4000-8000-000000000005'
\set blkman  '76600000-0000-4000-8000-000000000006'
\set gone    '76600000-0000-4000-8000-000000000007'
\set viewer  '76700000-0000-4000-8000-000000000001'

insert into auth.users (id, email) values (:'viewer', 'viewer.766@rls.test');
insert into profiles (id, role, office_role, full_name) values (:'viewer', 'admin', 'viewer', 'Vic Viewer');

insert into roles (id, name, pay_rate) values
  (:'ro',  'Male-only Security',  14.00),
  (:'ro2', 'Male-only Elsewhere', 14.00);

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer, auto_assign) values
  (:'evt', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Male-only Gala', date '2027-02-10', true, true, true);

-- Three sections on the same event, same role and window: Male only,
-- Female only, and one for anyone. Headcount large enough that no target
-- is met.
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour, auto_assign) values
  (:'plain', :'evt', :'ro', '2027-02-10 17:00+00', '2027-02-10 23:00+00', 6, 0, 30, 15, 6, true);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour, auto_assign, required_gender) values
  (:'mo',    :'evt', :'ro', '2027-02-10 17:00+00', '2027-02-10 23:00+00', 6, 0, 30, 15, 6, true, 'M'),
  (:'fo',    :'evt', :'ro', '2027-02-10 17:00+00', '2027-02-10 23:00+00', 6, 0, 30, 15, 6, true, 'F');

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch, gender) values
  (:'man',     'Mark',   'Man',     'm1@mo.test', '+447700976601', date '1995-01-01', 'compliant', 'uk_irish', 'M'),
  (:'woman',   'Wendy',  'Woman',   'w1@mo.test', '+447700976602', date '1995-01-01', 'compliant', 'uk_irish', 'F'),
  (:'unknown', 'Una',    'Known',   'u1@mo.test', '+447700976603', date '1995-01-01', 'compliant', 'uk_irish', null),
  (:'woman2',  'Wanda',  'Woman',   'w2@mo.test', '+447700976604', date '1995-01-01', 'compliant', 'uk_irish', 'F'),
  (:'offrole', 'Olive',  'Offrole', 'o1@mo.test', '+447700976605', date '1995-01-01', 'compliant', 'uk_irish', 'F'),
  (:'blkman',  'Barry',  'Blocked', 'b1@mo.test', '+447700976606', date '1995-01-01', 'blocked',   'uk_irish', 'M'),
  (:'gone',    'Gary',   'Gone',    'g1@mo.test', '+447700976607', date '1995-01-01', 'compliant', 'uk_irish', 'M');

insert into staff_roles (staff_id, role_id)
select id, :'ro' from staff where id in (:'man', :'woman', :'unknown', :'woman2', :'blkman', :'gone');
insert into staff_roles (staff_id, role_id) values (:'offrole', :'ro2');

-- ---------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------
select is((select required_gender from shift_requirements where id = :'plain'), null,
  'a section is for anyone unless a gender is chosen');
select throws_ok(format($$ update shift_requirements set required_gender = 'X' where id = %L $$, :'plain'),
  '23514', null, 'M or F only');
select ok(has_column_privilege('authenticated', 'public.shift_requirements', 'required_gender', 'select'),
  'a signed-in session may read required_gender (20261001203000 grants SELECT column by column)');

-- ---------------------------------------------------------------------
-- 2. The pool
-- ---------------------------------------------------------------------
select is(
  (select array_agg(gate order by staff_id) from auto_assign_candidates(:'plain')
    where staff_id in (:'man', :'woman', :'unknown')),
  array[null, null, null]::text[],
  'an ordinary section knows nothing of gender');

select is((select gate from auto_assign_candidates(:'mo') where staff_id = :'man'), null,
  'male_only: a man is in the pool');
select is((select gate from auto_assign_candidates(:'mo') where staff_id = :'woman'), 'male_only',
  'male_only: a woman is gated male_only');
select is((select gate from auto_assign_candidates(:'mo') where staff_id = :'unknown'), 'gender_not_recorded',
  'male_only: a worker with no gender on file is gated gender_not_recorded — not shown to be male');
select is((select gate from auto_assign_candidates(:'mo', true) where staff_id = :'woman'), 'male_only',
  'and the escalation pool gates her too');

select is((select gate from auto_assign_candidates(:'fo') where staff_id = :'woman'), null,
  'female_only: a woman is in the pool');
select is((select gate from auto_assign_candidates(:'fo') where staff_id = :'man'), 'female_only',
  'female_only: a man is gated female_only');
select is((select gate from auto_assign_candidates(:'fo') where staff_id = :'unknown'), 'gender_not_recorded',
  'female_only: no gender on file is gated gender_not_recorded too');

-- ---------------------------------------------------------------------
-- 3. Order
-- ---------------------------------------------------------------------
select is((select gate from auto_assign_candidates(:'mo') where staff_id = :'offrole'), 'wrong_role',
  'wrong_role still comes first');
select is((select gate from auto_assign_candidates(:'mo') where staff_id = :'blkman'), 'blocked',
  'a blocked man reads blocked — male_only is not a reason for him');
update staff set gender = 'F' where id = :'blkman';
select is((select gate from auto_assign_candidates(:'mo') where staff_id = :'blkman'), 'male_only',
  'the section''s requirement sits before blocked, like wrong_role');
update staff set gender = 'M' where id = :'blkman';

select is(
  (select count(*)::int
     from auto_assign_candidates(:'plain') p
     join auto_assign_candidates(:'mo') m using (staff_id)
    where p.gate is distinct from m.gate
      and m.gate not in ('male_only', 'gender_not_recorded')),
  0, 'a gender changes nothing but adding its gates — every other gate is the same row for row');

-- ---------------------------------------------------------------------
-- 4. Every booking path
-- ---------------------------------------------------------------------
-- Radar names a worker; the office may name any (staff_caller).
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select ok(exists (select 1 from staff_open_shifts(:'man') where shift_id = :'mo'),
  'Radar shows the section to a man');
select ok(not exists (select 1 from staff_open_shifts(:'woman2') where shift_id = :'mo'),
  'Radar never shows it to a woman');
select ok(exists (select 1 from staff_open_shifts(:'woman2') where shift_id = :'plain'),
  'while the ordinary section beside it is on her Radar');
select ok(exists (select 1 from staff_open_shifts(:'woman2') where shift_id = :'fo'),
  'a Female-only section is on her Radar');
select ok(not exists (select 1 from staff_open_shifts(:'man') where shift_id = :'fo'),
  'and never on a man''s');

select is((invite_worker(:'mo', :'woman', 'auto'))->>'reason', 'male_only',
  'an automatic invitation to a woman is refused at the insert');
select is((invite_worker(:'mo', :'woman', 'manual'))->>'reason', 'male_only',
  'and so is a manager''s own: it is the client''s requirement, not the machine''s');
select is((invite_worker(:'mo', :'unknown', 'auto'))->>'reason', 'gender_not_recorded',
  'no gender on file is refused by name');
select ok(not exists (select 1 from bookings where shift_id = :'mo' and staff_id in (:'woman', :'unknown')),
  'and no booking is written for either');
select is((invite_worker(:'mo', :'man', 'auto'))->>'invited', 'true',
  'a man is invited');

select is(apply_to_shift(:'mo', :'woman2')->>'reason', 'male_only',
  'a Radar application is refused by name');
select is((invite_worker(:'fo', :'man', 'manual'))->>'reason', 'female_only',
  'a man is refused on a Female-only section, manual invite included');
select is((invite_worker(:'fo', :'woman', 'auto'))->>'invited', 'true',
  'and a woman is invited to it');

-- An invitation written before the box was ticked stays live; Accept
-- refuses it, and nothing withdraws it (§3.4).
update shift_requirements set required_gender = null where id = :'mo';
select is((invite_worker(:'mo', :'woman2', 'auto'))->>'invited', 'true',
  'with the box clear, a woman is invited');
update shift_requirements set required_gender = 'M' where id = :'mo';
select is(accept_invite((select id from bookings where shift_id = :'mo' and staff_id = :'woman2'))->>'reason',
  'male_only', 'ticked afterwards: her Accept is refused by name');
select is((select status::text from bookings where shift_id = :'mo' and staff_id = :'woman2'), 'invited',
  'and the invitation is left as it was — never withdrawn');
select is(accept_invite((select id from bookings where shift_id = :'mo' and staff_id = :'man'))->>'ok',
  'true', 'the man accepts');

-- ---------------------------------------------------------------------
-- 5. set_staff_gender
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select is(set_staff_gender(:'unknown', 'male')->>'gender', 'M',
  'the office records it, in HMRC''s letter');
select throws_ok(format($$ select set_staff_gender(%L, 'X') $$, :'unknown'),
  'P0001', 'gender_m_or_f', 'M or F only');

select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
select throws_ok(format($$ select set_staff_gender(%L, 'F') $$, :'unknown'),
  '42501', 'read_only', 'a viewer is refused by the write guard');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select throws_ok(format($$ select set_staff_gender(%L, 'M') $$, :'staffa'),
  '42501', 'not_authorised', 'a worker cannot call it');
reset role;

select is((select gate from auto_assign_candidates(:'mo') where staff_id = :'unknown'), null,
  'once recorded M, the gate lifts');

update staff set removed_at = now() where id = :'gone';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select throws_ok(format($$ select set_staff_gender(%L, 'F') $$, :'gone'),
  'P0001', 'staff_removed', 'refused on a removed worker');
reset role;

select is(
  (select data from audit_log where action = 'staff.gender_set' and entity_id = :'unknown'),
  jsonb_build_object('staffId', :'unknown'),
  'audited, without the value');

select * from finish();
rollback;
