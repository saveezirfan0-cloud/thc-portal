-- =====================================================================
-- 908 · Payroll holds a stale-fix No check-out — ADR-0174,
--       20261022090000_payroll_holds_stale_fix.sql
--
-- Week Mon 5 – Sun 11 Feb 2024 (GMT), empty in every other suite.
--
--   W1 Clean    Tue 12:00–16:00, in 12:00 out 16:00 → settled, exported
--   W2 Stale    Tue 12:00–16:00, in 12:00, pressed Check out off-site:
--               the last on-site fix 12:05 is the finish and a No
--               check-out is raised for review (D15) → PENDING, held
--
-- Then a manager resolves W2 with the real finish (16:00) → settled, and
-- the next Monday's run exports it.
-- =====================================================================
begin;
select plan(17);
\ir _shared/fixtures.psql

\set r_wait '90800000-0000-4000-8000-000000000001'
\set w1 '90810000-0000-4000-8000-000000000001'
\set w2 '90810000-0000-4000-8000-000000000002'

insert into roles (id, name, description, pay_rate) values
  (:'r_wait', 'Stale Fix Waiting Staff', 'fixture', 14.00);

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'w1', 90801, 'Cleo', 'Clean', 's-w1@rls.test', '+447700990801', date '1996-05-01', 'compliant'),
  (:'w2', 90802, 'Fia',  'Stale', 's-w2@rls.test', '+447700990802', date '1997-06-02', 'compliant');

create temp table bk (name text primary key, id uuid);
grant select on bk to authenticated, service_role;

create function pg_temp.shift(p_staff uuid, p_out timestamptz, p_title text)
returns uuid language plpgsql as $$
declare
  v_event uuid := gen_random_uuid();
  v_shift uuid := gen_random_uuid();
  v_booking uuid := gen_random_uuid();
begin
  insert into events (id, client_id, venue_name, venue_address, venue_location, geofence_radius_m,
                      title, event_date, pays_breaks, pays_buffer)
  values (v_event, 'aaaaaaaa-0000-4000-8000-000000000001', 'Stale Venue', '1 Stale St, London',
          st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150,
          p_title, date '2024-02-06', true, false);
  insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                  charge_rate, pay_rate, allocation_per_hour)
  values (v_shift, v_event, '90800000-0000-4000-8000-000000000001',
          '2024-02-06 12:00+00', '2024-02-06 16:00+00', 1, 0, 22.97, 14.00, 1);
  insert into bookings (id, shift_id, staff_id, status, source, confirmed_at)
  values (v_booking, v_shift, p_staff, 'worked', 'manual', '2024-02-01 10:00+00');
  insert into check_logs (booking_id, attempted_at, outcome, check_in_at, check_out_at)
  values (v_booking, '2024-02-06 12:00+00', 'checked_in', '2024-02-06 12:00+00', p_out);
  return v_booking;
end $$;

insert into bk values
  ('clean', pg_temp.shift(:'w1', '2024-02-06 16:00+00', 'Stale Fix Clean')),
  ('stale', pg_temp.shift(:'w2', '2024-02-06 12:05+00', 'Stale Fix Off-site'));
-- D15: the off-site press recorded the stale fix and raised the review.
insert into violations (staff_id, booking_id, type, detected_at, stale_fix_review)
  select :'w2', id, 'no_checkout', '2024-02-06 16:00+00', true from bk where name = 'stale';

-- =====================================================================
-- 1-8 · The Payroll tab and the CSV rule, as the office reads them
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table pr as select * from payroll_report('2024-02-05', '2024-02-11');
reset role;

select is((select status from pr where booking_id = (select id from bk where name = 'clean')), 'settled',
  'a clean shift is settled');
select is((select total from pr where booking_id = (select id from bk where name = 'clean')), 62.76::numeric,
  'and priced: 4 h × £14 = 56.00 + holiday 6.76');
select is((select status from pr where booking_id = (select id from bk where name = 'stale')), 'pending',
  'a stale-fix No check-out is Pending, though a finish is recorded (§9.9, RULE-02)');
select is((select total from pr where booking_id = (select id from bk where name = 'stale')), null::numeric,
  'with no figure — never the 5 minutes the stale fix would pay');
select is((select payable_min from pr where booking_id = (select id from bk where name = 'stale')), 5,
  'the stale fix would have paid 5 minutes — that figure is held, not paid');
select is((select in_export from pr where booking_id = (select id from bk where name = 'stale')), false,
  'and it is left out of the CSV');
select is((select no_check_out_unresolved from pr where booking_id = (select id from bk where name = 'stale')), true,
  'the line says the No check-out is unresolved');
select is((select in_export from pr where booking_id = (select id from bk where name = 'clean')), true,
  'the clean shift is in the CSV');

-- =====================================================================
-- 9-11 · BG-08 holds it
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
create temp table run1 as select prepare_finance_reports('2024-02-12 09:05+00') as r;
reset role;

select is((select state from payroll_export_lines where booking_id = (select id from bk where name = 'stale')),
  'held', 'the Monday run records the stale-fix shift as HELD');
select is((select state from payroll_export_lines where booking_id = (select id from bk where name = 'clean')),
  'exported', 'and exports the clean one');
select is((select count(*)::int from payroll_export_rows((select (r->>'payrollSendId')::bigint from run1)) x
            where x.booking_id = (select id from bk where name = 'stale')), 0,
  'the held shift is not in the CSV sent to payroll');

-- =====================================================================
-- 12-14 · Invoicing (ADR-0172) agrees
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select status from invoice_event_lines((select sr.event_id from bookings b
            join shift_requirements sr on sr.id = b.shift_id where b.id = (select id from bk where name = 'stale')))),
  'pending', 'the invoice line is pending too');
select is((select invoicing from invoice_event_lines((select sr.event_id from bookings b
            join shift_requirements sr on sr.id = b.shift_id where b.id = (select id from bk where name = 'stale')))),
  null::numeric, 'and charges nothing yet');
select is((select i.status from invoice_events('2024-02-06', '2024-02-06') i
            join shift_requirements sr on sr.event_id = i.event_id
            join bookings b on b.shift_id = sr.id where b.id = (select id from bk where name = 'stale')),
  'missing', 'its event is Missing check-out');
reset role;

-- =====================================================================
-- 15-17 · Resolved with the real finish → settled, and paid next Monday
-- =====================================================================
update check_logs set manager_finish_at = '2024-02-06 16:00+00'
 where booking_id = (select id from bk where name = 'stale');
update violations set resolved = true, resolved_at = '2024-02-13 10:00+00', resolution_note = 'phoned: left at 16:00',
       actual_finish_at = '2024-02-06 16:00+00'
 where booking_id = (select id from bk where name = 'stale');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select row(status, total, in_export)::text from payroll_report('2024-02-05', '2024-02-11')
            where booking_id = (select id from bk where name = 'stale')),
  row('settled', 62.76::numeric, true)::text,
  'once a manager resolves it with the real finish, it is settled and priced on that finish');
reset role;

select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
create temp table run2 as select prepare_finance_reports('2024-02-19 09:05+00') as r;
reset role;
select is((select state from payroll_export_lines where booking_id = (select id from bk where name = 'stale')
             and state = 'exported'), 'exported', 'the following Monday exports it');
select is((select count(*)::int from payroll_export_lines where booking_id = (select id from bk where name = 'clean')),
  1, 'and the clean shift is not exported twice');

select * from finish();
rollback;
