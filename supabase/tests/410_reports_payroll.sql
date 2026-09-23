-- =====================================================================
-- 410 · Reports (§9.9) and the Monday send (BG-08)
--       — 20260923130000_reports_and_finance_send.sql
--
-- One fixture week, Mon 3 – Sun 9 March 2025 (GMT, so UK time = UTC),
-- chosen because nothing in seed.sql or any other suite lands in it: the
-- report functions aggregate by date range, so an empty week makes every
-- total below exact.
--
--   W1 Tom Reid      5 shifts at three different rates (§9.9: "5 + 4 + 2")
--   W2 Priya Sharma  4 shifts
--   W3 Luca Moretti  2 shifts, the second short and floored to 4 h
--   W4 Held Worker   1 shift with an unresolved No check-out → PENDING
--   W5 Buffer Worker 2 turn-aways: on time (4 h, RULE-15), late (nothing)
--   W6 Absent Worker 1 no-show (never a payroll row)
--   W7 removed       1 shift, then GDPR-removed (§1.7)
--   W8 Same Day      1 shift on an event cancelled ON the day (§3.3: full
--                    scheduled hours) and 1 on an event cancelled the day
--                    BEFORE (excluded)
--
-- Every figure is worked out by hand in the comments, the way 350 pins the
-- dashboard.
-- =====================================================================
begin;
select plan(68);
\ir _shared/fixtures.psql

\set r_wait '41000000-0000-4000-8000-000000000001'
\set r_bar  '41000000-0000-4000-8000-000000000002'
\set r_host '41000000-0000-4000-8000-000000000003'
\set w1 '41100000-0000-4000-8000-000000000001'
\set w2 '41100000-0000-4000-8000-000000000002'
\set w3 '41100000-0000-4000-8000-000000000003'
\set w4 '41100000-0000-4000-8000-000000000004'
\set w5 '41100000-0000-4000-8000-000000000005'
\set w6 '41100000-0000-4000-8000-000000000006'
\set w7 '41100000-0000-4000-8000-000000000007'
\set w8 '41100000-0000-4000-8000-000000000008'

insert into roles (id, name, description, pay_rate) values
  (:'r_wait', 'Report Waiting Staff', 'fixture', 14.00),
  (:'r_bar',  'Report Bar Staff',     'fixture', 15.50),
  (:'r_host', 'Report Host',          'fixture', 16.00);

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status, home_address, gender) values
  (:'w1', 91001, 'Tom',    'Reid',    'r-w1@rls.test', '+447700941001', date '1996-05-01', 'compliant',
   'Flat 4, 12 Exhibition Rd, London SW7 2HE', 'M'),
  (:'w2', 91002, 'Priya',  'Sharma',  'r-w2@rls.test', '+447700941002', date '1997-06-02', 'compliant', '3 Laurie Grove, London', 'F'),
  (:'w3', 91003, 'Luca',   'Moretti', 'r-w3@rls.test', '+447700941003', date '1995-07-03', 'compliant', null, null),
  (:'w4', 91004, 'Held',   'Worker',  'r-w4@rls.test', '+447700941004', date '1994-08-04', 'compliant', null, null),
  (:'w5', 91005, 'Buffer', 'Worker',  'r-w5@rls.test', '+447700941005', date '1993-09-05', 'compliant', null, null),
  (:'w6', 91006, 'Absent', 'Worker',  'r-w6@rls.test', '+447700941006', date '1992-10-06', 'compliant', null, null),
  (:'w7', 91007, 'Grace',  'Lindqvist','r-w7@rls.test', '+447700941007', date '1991-11-07', 'compliant', null, 'F'),
  (:'w8', 91008, 'Same',   'Day',     'r-w8@rls.test', '+447700941008', date '1990-12-08', 'compliant', null, null);

insert into hmrc_checklists (staff_id, q1_other_job, q2_pension, q3_since_6_april, statement, student_loan, postgraduate_loan, declared) values
  (:'w1', false, false, false, 'B', 'plan2', false, true),
  (:'w2', false, false, true,  'A', 'none',  true,  true);

-- One event + one section per shift. Charge: Waiting £22.97, Bar £24.50, Host £26.00.
create function pg_temp.section(p_title text, p_role uuid, p_start timestamptz, p_hours numeric,
                                p_pays_breaks boolean default true, p_cancelled_at timestamptz default null)
returns uuid language plpgsql as $$
declare
  v_event uuid := gen_random_uuid();
  v_shift uuid := gen_random_uuid();
  v_pay numeric;
begin
  select pay_rate into v_pay from roles where id = p_role;
  insert into events (id, client_id, venue_name, venue_address, venue_location, geofence_radius_m,
                      title, event_date, pays_breaks, pays_buffer, cancelled_at)
  values (v_event, 'aaaaaaaa-0000-4000-8000-000000000001', 'Report Venue', '1 Report St, London',
          st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150,
          p_title, (p_start at time zone 'Europe/London')::date, p_pays_breaks, false, p_cancelled_at);
  insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                  charge_rate, pay_rate, allocation_per_hour)
  values (v_shift, v_event, p_role, p_start, p_start + p_hours * interval '1 hour', 1, 0,
          case v_pay when 14.00 then 22.97 when 15.50 then 24.50 else 26.00 end, v_pay, 1);
  return v_shift;
end $$;

create function pg_temp.worked(p_shift uuid, p_staff uuid, p_in timestamptz, p_out timestamptz,
                               p_break_min int default 0)
returns uuid language plpgsql as $$
declare v_booking uuid := gen_random_uuid();
begin
  insert into bookings (id, shift_id, staff_id, status, source, confirmed_at)
  values (v_booking, p_shift, p_staff, 'worked', 'manual', p_in - interval '2 days');
  insert into check_logs (booking_id, attempted_at, outcome, check_in_at, check_out_at)
  values (v_booking, p_in, 'checked_in', p_in, p_out);
  if p_break_min > 0 then
    insert into breaks (booking_id, started_at, ended_at)
    values (v_booking, p_in + interval '1 hour', p_in + interval '1 hour' + p_break_min * interval '1 minute');
  end if;
  return v_booking;
end $$;

create temp table b (name text primary key, id uuid);
grant select on b to authenticated, service_role;

-- W1 · Tom Reid · five shifts, three rates.
--   s1 Mon Bar 18:00–23:00, in 17:55 out 23:02 → 300 min (capped both ends)
--        base 300×15.50/60 = 77.50 · holiday 9.35 · total 86.85
--   s2 Tue Waiting 10:00–16:00 clean → 360 → 84.00 · 10.14 · 94.14
--   s3 Wed Host 08:00–16:00, in 08:14 (inside the grace: paid from 08:00)
--        → 480 → 128.00 · 15.45 · 143.45, late check-in highlighted
--   s4 Thu Bar 17:00–22:00, client does not pay breaks, 20 min break
--        → 280 → 72.33 · 8.73 · 81.06
--   s5 Sun Waiting 11:00–16:00, out 15:40 + Left early → 280 → 65.33 · 7.89 · 73.22
insert into b values
  ('w1s1', pg_temp.worked(pg_temp.section('Launch',     :'r_bar',  '2025-03-03 18:00+00', 5), :'w1', '2025-03-03 17:55+00', '2025-03-03 23:02+00')),
  ('w1s2', pg_temp.worked(pg_temp.section('Conference', :'r_wait', '2025-03-04 10:00+00', 6), :'w1', '2025-03-04 10:00+00', '2025-03-04 16:00+00')),
  ('w1s3', pg_temp.worked(pg_temp.section('Expo',       :'r_host', '2025-03-05 08:00+00', 8), :'w1', '2025-03-05 08:14+00', '2025-03-05 16:01+00')),
  ('w1s4', pg_temp.worked(pg_temp.section('Drinks',     :'r_bar',  '2025-03-06 17:00+00', 5, false), :'w1', '2025-03-06 17:00+00', '2025-03-06 22:00+00', 20)),
  ('w1s5', pg_temp.worked(pg_temp.section('Brunch',     :'r_wait', '2025-03-09 11:00+00', 5), :'w1', '2025-03-09 10:50+00', '2025-03-09 15:40+00'));
insert into violations (staff_id, booking_id, type, resolved)
  select :'w1', id, 'left_early', true from b where name = 'w1s5';

-- W2 · four clean 4-hour waiting shifts → 56.00 · 6.76 · 62.76 each.
insert into b values
  ('w2s1', pg_temp.worked(pg_temp.section('Lunch A', :'r_wait', '2025-03-03 12:00+00', 4), :'w2', '2025-03-03 12:00+00', '2025-03-03 16:00+00')),
  ('w2s2', pg_temp.worked(pg_temp.section('Lunch B', :'r_wait', '2025-03-04 12:00+00', 4), :'w2', '2025-03-04 12:00+00', '2025-03-04 16:00+00')),
  ('w2s3', pg_temp.worked(pg_temp.section('Lunch C', :'r_wait', '2025-03-05 12:00+00', 4), :'w2', '2025-03-05 12:00+00', '2025-03-05 16:00+00')),
  ('w2s4', pg_temp.worked(pg_temp.section('Lunch D', :'r_wait', '2025-03-06 12:00+00', 4), :'w2', '2025-03-06 12:00+00', '2025-03-06 16:00+00'));

-- W3 · Fri Bar 4 h → 62.00 · 7.48 · 69.48; Sat Waiting 10:00–16:00 but out
-- at 12:30 with no violation → worked 150, RULE-14 floor → 240 → 56.00 · 6.76.
insert into b values
  ('w3s1', pg_temp.worked(pg_temp.section('Gala',  :'r_bar',  '2025-03-07 18:00+00', 4), :'w3', '2025-03-07 18:00+00', '2025-03-07 22:00+00')),
  ('w3s2', pg_temp.worked(pg_temp.section('Fair',  :'r_wait', '2025-03-08 10:00+00', 6), :'w3', '2025-03-08 10:00+00', '2025-03-08 12:30+00'));

-- W4 · checked in, never checked out, No check-out unresolved → pending.
insert into b values
  ('w4s1', pg_temp.worked(pg_temp.section('Party', :'r_bar', '2025-03-08 18:00+00', 5), :'w4', '2025-03-08 18:00+00', null));
insert into violations (staff_id, booking_id, type) select :'w4', id, 'no_checkout' from b where name = 'w4s1';

-- W5 · two turn-aways (RULE-15). On time → 240 × 15.50 = 62.00 · 7.48; late → 0.
insert into b select 'w5s1', gen_random_uuid();
insert into b select 'w5s2', gen_random_uuid();
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at)
  select (select id from b where name = 'w5s1'), pg_temp.section('Buffer Night', :'r_bar', '2025-03-07 18:00+00', 5),
         :'w5', 'turned_away', 'manual', '2025-03-01 10:00+00';
insert into check_logs (booking_id, attempted_at, outcome)
  select id, '2025-03-07 17:50+00', 'turned_away' from b where name = 'w5s1';
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at)
  select (select id from b where name = 'w5s2'), pg_temp.section('Buffer Late', :'r_bar', '2025-03-08 18:00+00', 5),
         :'w5', 'turned_away', 'manual', '2025-03-01 10:00+00';
insert into check_logs (booking_id, attempted_at, outcome)
  select id, '2025-03-08 18:35+00', 'turned_away' from b where name = 'w5s2';

-- W6 · confirmed, never came: a no-show is nobody's payroll row.
insert into b select 'w6s1', gen_random_uuid();
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at)
  select (select id from b where name = 'w6s1'), pg_temp.section('No Show Night', :'r_wait', '2025-03-05 18:00+00', 4),
         :'w6', 'confirmed', 'manual', '2025-03-01 10:00+00';

-- W7 · one shift, then removed (§1.7): the row stays, anonymised.
insert into b values
  ('w7s1', pg_temp.worked(pg_temp.section('Breakfast', :'r_wait', '2025-03-04 09:00+00', 4), :'w7', '2025-03-04 09:00+00', '2025-03-04 13:00+00'));
update staff set first_name = 'Deleted', last_name = 'account', removed_at = now() where id = :'w7';

-- W8 · §3.3. Cancelled ON the day at 08:00 → full scheduled 5 h:
--   300 × 14.00 = 70.00 · 8.45 · 78.45; invoiced 300 × 22.97/60 = 114.85.
-- Cancelled the day BEFORE → excluded, no money at all.
insert into b select 'w8s1', gen_random_uuid();
insert into b select 'w8s2', gen_random_uuid();
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at, cancelled_at, cancel_cause)
  select (select id from b where name = 'w8s1'),
         pg_temp.section('Same Day Cancel', :'r_wait', '2025-03-05 17:00+00', 5, true, '2025-03-05 08:00+00'),
         :'w8', 'cancelled', 'manual', '2025-03-01 10:00+00', '2025-03-05 08:00+00', 'event_cancelled';
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at, cancelled_at, cancel_cause)
  select (select id from b where name = 'w8s2'),
         pg_temp.section('Cancelled Before', :'r_wait', '2025-03-06 17:00+00', 5, true, '2025-03-05 12:00+00'),
         :'w8', 'cancelled', 'manual', '2025-03-01 10:00+00', '2025-03-05 12:00+00', 'event_cancelled';

-- =====================================================================
-- 1-4 · Who may read the payroll
-- =====================================================================
select ok(not has_function_privilege('anon', 'public.payroll_report(date,date)', 'execute'),
  'anon cannot call payroll_report');
select ok(not has_function_privilege('authenticated', 'public.prepare_finance_reports(timestamptz)', 'execute'),
  'a signed-in caller cannot stamp a payroll run: BG-08 is the service role''s');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select * from payroll_report('2025-03-03', '2025-03-09') $$, '42501', 'admins_only',
  'a worker cannot read the payroll through the definer function, whatever their self policies allow');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select * from finance_report('2025-03-03', '2025-03-09', 'day') $$, '42501', 'admins_only',
  'a client cannot read the financial report — the Client Portal carries no money (§11.1)');
reset role;

-- Everything below reads as the admin unless it says otherwise.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table pr as select * from payroll_report('2025-03-03', '2025-03-09');
reset role;

-- =====================================================================
-- 5-22 · Tab 2 · the shift lines
-- =====================================================================
select is((select count(*)::int from pr where staff_id in (:'w1', :'w2', :'w3') and in_export), 11,
  '§9.9 "5 + 4 + 2 shifts = 11 rows, not 3": one CSV row per SHIFT for the three workers');
select is((select count(distinct rate)::int from pr where staff_id = :'w1'), 3,
  'W1 worked at three different rates in one week and every line keeps its own rate');
select is((select row(base, holiday, total)::text from pr where booking_id = (select id from b where name = 'w1s1')),
  row(77.50, 9.35, 86.85)::text,
  'W1 Mon: 17:55–23:02 on an 18:00–23:00 section pays 300 min: base £77.50, holiday +12.07% £9.35 in its own column, total £86.85');
select is((select payable_min from pr where booking_id = (select id from b where name = 'w1s2')), 360,
  'W1 Tue: a clean six hours is 360 payable minutes');
select ok((select late_check_in from pr where booking_id = (select id from b where name = 'w1s3')),
  'W1 Wed: checked in 08:14 — highlighted late (amber)');
select is((select payable_min from pr where booking_id = (select id from b where name = 'w1s3')), 480,
  'W1 Wed: …but inside the 30-minute grace, so paid from the scheduled 08:00 (RULE-01)');
select is((select row(unpaid_break_min, payable_min, base)::text from pr where booking_id = (select id from b where name = 'w1s4')),
  row(20, 280, 72.33)::text,
  'W1 Thu: the client does not pay breaks, so the 20-minute break is deducted and shown (§5.2b)');
select ok((select early_check_out from pr where booking_id = (select id from b where name = 'w1s5')),
  'W1 Sun: checked out 15:40 on a 16:00 finish — highlighted early');
select is((select row(payable_min, total)::text from pr where booking_id = (select id from b where name = 'w1s5')),
  row(280, 73.22)::text,
  'W1 Sun: paid to the actual 15:40, from the scheduled 11:00 — 280 min, £73.22');
select is((select row(worked_min, payable_min, floor_applied)::text from pr where booking_id = (select id from b where name = 'w3s2')),
  row(150, 240, true)::text,
  'W3 Sat: 150 minutes worked with no violation is floored to four hours (RULE-14)');

-- The held-row rule.
select is((select status from pr where booking_id = (select id from b where name = 'w4s1')), 'pending',
  'W4: an unresolved No check-out is Pending (RULE-02)');
select ok((select payable_min is null and base is null and holiday is null and total is null
             from pr where booking_id = (select id from b where name = 'w4s1')),
  'W4: …with NO figure — not 0, not the scheduled finish (RULE-02: no silent default)');
select ok(not (select in_export from pr where booking_id = (select id from b where name = 'w4s1')),
  'W4: …and it is held out of the CSV export (§9.9, BG-08)');
select ok((select no_check_out_unresolved from pr where booking_id = (select id from b where name = 'w4s1')),
  'W4: the row says why it is pending');

-- Turn-aways, no-shows, removal, cancellations.
select is((select row(kind, payable_min, base, in_export)::text from pr where booking_id = (select id from b where name = 'w5s1')),
  row('turned_away', 240, 62.00, true)::text,
  'W5: turned away on time — a fixed four hours (RULE-15), exported');
select is((select row(payable_min, in_export)::text from pr where booking_id = (select id from b where name = 'w5s2')),
  row(0, false)::text,
  'W5: turned away late — nothing, and no £0 line in the CSV');
select is((select count(*)::int from pr where staff_id = :'w6'), 0,
  'W6: a no-show is not a payroll row');
select is((select row(staff_name, employee_id, photo_path is null)::text from pr where staff_id = :'w7'),
  row('Deleted account #91007', 91007, true)::text,
  'W7: a removed worker''s row stays, as "Deleted account #id" with the Employee ID kept and no photo (§1.7)');
select is((select row(kind, payable_min, total)::text from pr where booking_id = (select id from b where name = 'w8s1')),
  row('cancelled_on_day', 300, 78.45)::text,
  'W8: an event cancelled ON the day pays the full scheduled hours (§3.3 resolved edge case)');
select is((select count(*)::int from pr where booking_id = (select id from b where name = 'w8s2')), 0,
  'W8: an event cancelled the day before pays nothing and is not listed (§3.3 point 4)');

-- =====================================================================
-- 23-27 · Tab 2 · per person and the period summary
--
-- Base:    W1 427.16 + W2 224.00 + W3 118.00 + W5 62.00 + W7 56.00 + W8 70.00 = 957.16
-- Holiday: W1  51.56 + W2  27.04 + W3  14.24 + W5  7.48 + W7  6.76 + W8  8.45 = 115.53
-- Shifts:  5 + 4 + 2 + 1 (W4) + 2 (W5) + 1 + 1 = 16; workers 7 (W6 is not one)
-- =====================================================================
set local role authenticated;
create temp table pp as select * from payroll_report_people('2025-03-03', '2025-03-09');
reset role;

select is((select row(shifts, payable_min, base, holiday, total)::text from pp where staff_id = :'w1'),
  row(5, 1700, 427.16, 51.56, 478.72)::text,
  'W1 summary row: 5 shifts · 28.33 h · base £427.16 · holiday £51.56 · total £478.72 — base and holiday never blended');
select is((select row(shifts, pending, total)::text from pp where staff_id = :'w4'),
  row(1, 1, 0)::text,
  'W4 summary row: one shift, pending, and nothing priced');
select is((select row(workers, shifts, pending, turned_away)::text from pp where is_total),
  row(7, 16, 1, 2)::text,
  'Period summary: 7 workers on shifts · 16 shifts · 1 pending · 2 turned away');
select is((select row(base, holiday, total)::text from pp where is_total),
  row(957.16, 115.53, 1072.69)::text,
  'Period summary: total to be paid £1,072.69 = base £957.16 + holiday £115.53');
select is((select payable_min from pp where is_total), 3920,
  'Period summary: 3,920 payable minutes after break deductions');

-- =====================================================================
-- 28-33 · Tab 1 · Financial
--
-- Invoicing at the charge rate, turn-aways never invoiced:
--   W1 122.50 + 137.82 + 208.00 + 114.33 + 107.19 = 689.84
--   W2 4 × 91.88 = 367.52 · W3 98.00 + 91.88 = 189.88 · W7 91.88 · W8 114.85
--   = 1,453.97; margin 1,453.97 − 1,072.69 = 381.28 (26.2%)
-- =====================================================================
set local role authenticated;
create temp table fr as select * from finance_report('2025-03-03', '2025-03-09', 'day');
reset role;

select is((select row(base, holiday, payroll)::text from fr where is_total),
  row(957.16, 115.53, 1072.69)::text,
  'Financial KPI Staff payroll: base £957.16 and holiday £115.53 separately, £1,072.69 including holiday — the same money as the Payroll tab');
select is((select invoicing from fr where is_total), 1453.97,
  'Financial KPI Client invoicing: payable hours at each section''s charge rate; the RULE-15 turn-away is absorbed by THC, not invoiced');
select is((select row(margin, margin_pct)::text from fr where is_total), row(381.28, 26.2)::text,
  'Financial KPI Gross margin: invoicing − payroll including holiday');
select is((select pending from fr where is_total), 1, 'Financial: the pending shift is counted, not priced');
select ok((select 'Cancelled Before' = any(cancelled_events) from fr where group_key = '2025-03-06'),
  'Financial by day: an event cancelled before its day is listed as excluded (§3.3)');
select is((select count(*)::int from fr where not is_total), 7, 'Financial by day: one row per day Mon–Sun');

-- =====================================================================
-- 34-39 · Tab 3 · New Starter (HMRC)
-- =====================================================================
set local role authenticated;
create temp table ns as select * from new_starter_report('2025-03-10');
reset role;

select is((select count(*)::int from ns where staff_id in (:'w1',:'w2',:'w3',:'w4',:'w5',:'w6',:'w7',:'w8')), 7,
  'Picking Mon 10 Mar previews the new workers whose first paid shift was in Mon 3 – Sun 9 Mar: everyone but the no-show');
select ok((select period_start = '2025-03-03' and period_end = '2025-03-09' from ns limit 1),
  'The preview period is the Mon–Sun week before the picked date''s week');
select is((select row(postcode, gender, first_shift_date, hmrc_statement, student_loan)::text from ns where staff_id = :'w1'),
  row('SW7 2HE', 'M', date '2025-03-03', 'B', 'Plan 2')::text,
  'W1: postcode read off the end of the address, gender, first shift, the HMRC statement letter and the loan plan');
select is((select student_loan from ns where staff_id = :'w2'), 'Postgraduate',
  'W2: no undergraduate plan but a postgraduate loan reads "Postgraduate"');
select is((select row(staff_name, date_of_birth, gender)::text from ns where staff_id = :'w7'),
  row('Deleted account #91007', null::date, null::text)::text,
  'W7: the removed worker is anonymised, with no date of birth and the gender wiped by the removal trigger');
select is((select count(*)::int from ns where staff_id = :'w6'), 0,
  'W6: a no-show never "actually worked" and is not a new starter');

-- =====================================================================
-- 40-44 · BG-08 · when it runs
-- =====================================================================
select ok(not finance_reports_due('2025-03-10 08:55+00'), 'BG-08 is not due at 08:55 UK on the Monday');
select ok(finance_reports_due('2025-03-10 09:00+00'), 'BG-08 is due from 09:00 UK on the Monday');
select ok(not finance_reports_due('2025-03-31 07:59+00'),
  'After the clocks go forward, 07:59 UTC is 08:59 BST — not due yet (pg_cron is UTC, the rule is London)');
select ok(finance_reports_due('2025-03-31 08:00+00'), '…and 08:00 UTC is 09:00 BST — due');
select ok(finance_reports_due('2025-03-12 15:00+00'),
  'A Monday that was missed is caught up later in the week, not skipped');

-- =====================================================================
-- 45-58 · BG-08 · run 1, for Mon 3 – Sun 9 Mar
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
create temp table run1 as select prepare_finance_reports('2025-03-10 09:05+00') as r;
reset role;

select is((select (r->>'rows')::int from run1), 14,
  'Run 1 exports 14 shifts: W1 5 + W2 4 + W3 2 + the on-time turn-away + W7 + the same-day cancellation');
select is((select (r->>'held')::int from run1), 1, 'Run 1 holds 1: the unresolved No check-out');
select is((select state from payroll_export_lines
            where booking_id = (select id from b where name = 'w4s1')), 'held',
  'W4 is recorded as HELD, not exported with a guessed figure');
select is((select row(payable_min, base, holiday)::text from payroll_export_lines
            where booking_id = (select id from b where name = 'w1s2')),
  row(360, 84.00, 10.14)::text,
  'The exported line carries the figures as sent');
select ok((select payroll_exported_at is not null from events e
            join shift_requirements sr on sr.event_id = e.id
            join bookings bk on bk.shift_id = sr.id where bk.id = (select id from b where name = 'w1s1')),
  'events.payroll_exported_at is set on exported events, so the No-show / Get-back warnings fire (§3.3)');
select ok((select payroll_exported_at is null from events e
            join shift_requirements sr on sr.event_id = e.id
            join bookings bk on bk.shift_id = sr.id where bk.id = (select id from b where name = 'w4s1')),
  '…and not on the event whose only shift was held');
select is((select (r->>'newStarters')::int from run1), 6,
  'Run 1 New Starter CSV: the six whose first paid shift went out in this run (W4''s is held, so W4 waits)');
select is((select status from report_sends where kind = 'new_starter' and period_start = '2025-03-03'), 'preparing',
  'There are new starters, so the HMRC CSV is due with this email');

set local role service_role;
select is((select (prepare_finance_reports('2025-03-10 09:10+00')->>'alreadyPrepared')::boolean), true,
  'A second call for the same week resumes the first run');
reset role;
select is((select count(*)::int from payroll_export_lines x join report_sends r on r.id = x.report_send_id
            where r.period_start = '2025-03-03'), 15,
  '…and stamps nothing twice');

set local role service_role;
select is((select count(*)::int from payroll_export_rows((select (r->>'payrollSendId')::bigint from run1))), 14,
  'The CSV rows for the run are exactly the 14 exported shifts');
select is((select count(*)::int from new_starter_export_rows((select (r->>'newStarterSendId')::bigint from run1))), 6,
  'The New Starter CSV rows for the run are the six new starters');
select lives_ok(format($$ select queue_finance_report_email(%s, 'payroll/2025-03-03.csv', 'new-starter/2025-03-03.csv') $$,
                       (select r->>'payrollSendId' from run1)),
  'Queueing the email succeeds');
reset role;

select is((select row(template, channel::text, jsonb_array_length((payload->>'attachments')::jsonb))::text
             from notification_outbox where key = 'BG08:2025-03-03'),
  row('BG08', 'email', 2)::text,
  'One email in the outbox for the week, with two CSV attachments (payroll + HMRC)');

-- =====================================================================
-- 59-61 · Send status follows the email (§9.9 "Last sent" / "Failed")
-- =====================================================================
select ok(not finance_reports_due('2025-03-10 09:15+00'), 'Once queued, the week is no longer due');
select complete_outbox_send((select id from notification_outbox where key = 'BG08:2025-03-03'), true);
select is((select string_agg(status, ',' order by kind) from report_sends where period_start = '2025-03-03'),
  'sent,sent', 'When the drain sends it, both report rows read "sent"');
select ok((select sent_at is not null from report_sends where kind = 'payroll' and period_start = '2025-03-03'),
  '…with the time it went, for "Last sent: [date], [time]"');

-- =====================================================================
-- 62-66 · Never corrected retroactively; held shifts roll forward
-- =====================================================================
-- After the export, W1's Tuesday check-out is corrected to 14:00 (240 min).
update check_logs set check_out_at = '2025-03-04 14:00+00'
 where booking_id = (select id from b where name = 'w1s2');
-- …and W4's No check-out is resolved with a 23:00 finish (300 min at £15.50).
update check_logs set manager_finish_at = '2025-03-08 23:00+00'
 where booking_id = (select id from b where name = 'w4s1');
update violations set resolved = true, resolved_at = now(), resolution_note = 'fixture'
 where booking_id = (select id from b where name = 'w4s1');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select is((select row(changed_since_export, exported_total, total)::text
             from payroll_report('2025-03-03', '2025-03-09') where booking_id = (select id from b where name = 'w1s2')),
  row(true, 94.14, 62.76)::text,
  'A change after export shows both figures and a warning; the export itself is not corrected');
reset role;
select is((select base from payroll_export_lines where booking_id = (select id from b where name = 'w1s2')), 84.00,
  'The exported line still reads what finance was sent');

select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
create temp table run2 as select prepare_finance_reports('2025-03-17 09:05+00') as r;
reset role;
select is((select row((r->>'rows')::int, (r->>'held')::int)::text from run2), row(1, 0)::text,
  'Run 2 (Mon 10 – Sun 16 Mar, an empty week) exports exactly the rolled-forward shift, and holds nothing');
select is((select row(state, payable_min, base)::text from payroll_export_lines x
            join report_sends r on r.id = x.report_send_id
           where r.period_start = '2025-03-10' and x.booking_id = (select id from b where name = 'w4s1')),
  row('exported', 300, 77.50)::text,
  'W4''s resolved shift goes out with the following Monday''s run, priced from the manager-entered finish (BG-08)');
select is((select (r->>'newStarters')::int from run2), 1,
  'W4 is a new starter in the run that first pays them, not the one that held them');

select * from finish();
rollback;
