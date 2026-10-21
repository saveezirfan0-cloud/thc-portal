-- =====================================================================
-- 921 · A sign-out more than 15 minutes past the end is paid and charged
--       to the actual finish — ADR-0184,
--       20261022200000_overrun_paid_to_actual_finish.sql
--
-- THC (21.10.2026) in its own times, a 12:00–16:00 role section (here
-- S–E, a four-hour section that ended seven hours ago, so after the
-- rule's 21.10.2026 cutoff whenever this runs):
--   16:10 (E+10) → paid and charged to 16:00 (the 15-minute grace);
--   17:15 (E+75) → paid and charged to 17:15, 75 minutes of overrun,
--           flagged "Signed out late" for the office to verify;
--   pressed off site → the last on-site fix, the same rule;
--   a No check-out resolved with an 18:00 finish (E+2h) → paid to 18:00;
--   a finish typed six hours late → paid only to end + 4 h;
--   a section that ended before the cutoff (Nov 2024) → paid to its end.
-- The overrun is its own invoice line at the same charge rate; the
-- invoice and the log add up; nothing waits for the office's Verify.
--
-- As in 909, invoicing_config()'s go-live floor is lowered (to 2026-01-01)
-- inside this transaction only. Client A, charge £22.97/h, pay £14.00/h.
-- =====================================================================
begin;
select plan(60);
\ir _shared/fixtures.psql

\set r_wait   '92100000-0000-4000-8000-000000000001'
\set w1       '92110000-0000-4000-8000-000000000001'
\set w2       '92110000-0000-4000-8000-000000000002'
\set w3       '92110000-0000-4000-8000-000000000003'
\set w4       '92110000-0000-4000-8000-000000000004'
\set w5       '92110000-0000-4000-8000-000000000005'
\set w6_uid   '92130000-0000-4000-8000-000000000006'
\set w6       '92110000-0000-4000-8000-000000000006'
\set w7       '92110000-0000-4000-8000-000000000007'
\set w8       '92110000-0000-4000-8000-000000000008'
\set sched_uid  '92120000-0000-4000-8000-000000000001'
\set viewer_uid '92120000-0000-4000-8000-000000000002'

insert into auth.users (id, email) values
  (:'sched_uid',  'sched.921@rls.test'),
  (:'viewer_uid', 'viewer.921@rls.test'),
  (:'w6_uid',     'w6.921@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'sched_uid',  'admin', 'scheduler', 'Sam Scheduler'),
  (:'viewer_uid', 'admin', 'viewer',    'Vic Viewer');
insert into profiles (id, role, full_name) values (:'w6_uid', 'staff', 'Fay Field');

insert into roles (id, name, description, pay_rate) values (:'r_wait', 'Overrun Waiting Staff', 'fixture', 14.00);
insert into staff (id, user_id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'w1', null,      92101, 'Ana',  'Ames',  'o-w1@rls.test', '+447700992101', date '1996-05-01', 'compliant'),
  (:'w2', null,      92102, 'Bo',   'Brook', 'o-w2@rls.test', '+447700992102', date '1997-06-02', 'compliant'),
  (:'w3', null,      92103, 'Cy',   'Cole',  'o-w3@rls.test', '+447700992103', date '1995-07-03', 'compliant'),
  (:'w4', null,      92104, 'Di',   'Dunn',  'o-w4@rls.test', '+447700992104', date '1994-08-04', 'compliant'),
  (:'w5', null,      92105, 'Ed',   'Eyre',  'o-w5@rls.test', '+447700992105', date '1993-09-05', 'compliant'),
  (:'w6', :'w6_uid', 92106, 'Fay',  'Field', 'o-w6@rls.test', '+447700992106', date '1992-10-06', 'compliant'),
  (:'w7', null,      92107, 'Gus',  'Gray',  'o-w7@rls.test', '+447700992107', date '1991-11-07', 'compliant'),
  (:'w8', null,      92108, 'Hal',  'Hart',  'o-w8@rls.test', '+447700992108', date '1990-12-08', 'compliant');

-- Go-live lowered to 2026-01-01 for this transaction only (see 909).
update settings set value = value || jsonb_build_object('first_event_date', '2026-01-01')
 where key = 'invoicing';
do $$
begin
  execute replace(pg_get_functiondef('public.invoicing_config()'::regprocedure), '2026-10-26', '2026-01-01');
end $$;

-- S–E: the role section, four hours that ended seven hours ago.
create temp table t as select now() - interval '11 hours' as s, now() - interval '7 hours' as e,
                             ((now() - interval '11 hours') at time zone 'Europe/London')::date as d;

create temp table ev (name text primary key, event_id uuid);
create temp table sh (name text primary key, shift_id uuid);
create temp table bk (name text primary key, id uuid);
grant select on ev, sh, bk, t to authenticated, anon, service_role;

create function pg_temp.event(p_name text, p_date date, p_pays_breaks boolean default false)
returns uuid language plpgsql as $$
declare v_event uuid := gen_random_uuid();
begin
  insert into events (id, client_id, venue_name, venue_address, venue_location, geofence_radius_m,
                      title, event_date, pays_breaks, pays_buffer, po_number)
  values (v_event, 'aaaaaaaa-0000-4000-8000-000000000001', 'Overrun Venue', '1 Overrun St, London',
          st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150,
          'Overrun ' || p_name, p_date, p_pays_breaks, false, null);
  insert into ev values (p_name, v_event);
  return v_event;
end $$;

create function pg_temp.section(p_name text, p_event uuid, p_from timestamptz, p_to timestamptz)
returns uuid language plpgsql as $$
declare v_shift uuid := gen_random_uuid();
begin
  insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                  charge_rate, pay_rate, allocation_per_hour)
  values (v_shift, p_event, '92100000-0000-4000-8000-000000000001', p_from, p_to, 4, 0, 22.97, 14.00, 1);
  insert into sh values (p_name, v_shift);
  return v_shift;
end $$;

create function pg_temp.worked(p_name text, p_shift uuid, p_staff uuid, p_in timestamptz, p_out timestamptz,
                               p_status booking_status default 'worked')
returns uuid language plpgsql as $$
declare v_booking uuid := gen_random_uuid();
begin
  insert into bookings (id, shift_id, staff_id, status, source, confirmed_at)
  values (v_booking, p_shift, p_staff, p_status, 'manual', p_in - interval '7 days');
  insert into check_logs (booking_id, attempted_at, outcome, check_in_at, check_out_at)
  values (v_booking, p_in, 'checked_in', p_in, p_out);
  insert into bk values (p_name, v_booking);
  return v_booking;
end $$;

-- "Tue": one event, one S–E section, no violation anywhere.
select pg_temp.event('Tue', (select d from t));
select pg_temp.section('main',  (select event_id from ev where name = 'Tue'), (select s from t), (select e from t));
select pg_temp.worked('b1610', (select shift_id from sh where name = 'main'), :'w1',
                      (select s from t), (select e + interval '10 minutes' from t));
select pg_temp.worked('b1715', (select shift_id from sh where name = 'main'), :'w2',
                      (select s from t), (select e + interval '75 minutes' from t));
select pg_temp.worked('brk',   (select shift_id from sh where name = 'main'), :'w3',
                      (select s from t), (select e + interval '75 minutes' from t));
insert into breaks (booking_id, started_at, ended_at)
  select id, (select s + interval '1 hour' from t), (select s + interval '90 minutes' from t)
    from bk where name = 'brk';
-- Let in at E−90 (a manager's Get back), out at E+45: 135 minutes worked.
select pg_temp.worked('floor', (select shift_id from sh where name = 'main'), :'w4',
                      (select e - interval '90 minutes' from t), (select e + interval '45 minutes' from t));

-- "Wed": never checked out; the office enters E+2h (the 18:00 finish).
select pg_temp.event('Wed', (select d from t));
select pg_temp.section('wed', (select event_id from ev where name = 'Wed'), (select s from t), (select e from t));
select pg_temp.worked('nco', (select shift_id from sh where name = 'wed'), :'w5', (select s from t), null);
insert into violations (staff_id, booking_id, type)
  select :'w5', id, 'no_checkout' from bk where name = 'nco';

-- "Thu": never checked out; the office types a finish six hours late.
select pg_temp.event('Thu', (select d from t));
select pg_temp.section('thu', (select event_id from ev where name = 'Thu'), (select s from t), (select e from t));
select pg_temp.worked('typo', (select shift_id from sh where name = 'thu'), :'w7', (select s from t), null);
insert into violations (staff_id, booking_id, type)
  select :'w7', id, 'no_checkout' from bk where name = 'typo';

-- Before the cutoff: 12:00–16:00 on 12 Nov 2024, signed out at 17:15.
select pg_temp.event('Old', date '2024-11-12');
select pg_temp.section('old', (select event_id from ev where name = 'Old'),
                       '2024-11-12 12:00+00', '2024-11-12 16:00+00');
select pg_temp.worked('old', (select shift_id from sh where name = 'old'), :'w8',
                      '2024-11-12 12:00+00', '2024-11-12 17:15+00');

-- Today: a section that ended an hour ago, the worker pressing off site.
select pg_temp.event('Today', (now() at time zone 'Europe/London')::date);
select pg_temp.section('today', (select event_id from ev where name = 'Today'),
                       now() - interval '6 hours', now() - interval '1 hour');
select pg_temp.worked('today', (select shift_id from sh where name = 'today'), :'w6',
                      now() - interval '6 hours', null, 'confirmed');
insert into location_pings (booking_id, at, location, inside_geofence)
  select id, now() - interval '30 minutes', st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, true
    from bk where name = 'today';

create function pg_temp.pay(p_name text) returns jsonb language sql as $$
  select ps.pay from payable_shifts_v ps where ps.booking_id = (select id from bk where name = p_name)
$$;
create function pg_temp.line(p_name text) returns report_payroll_lines_v language sql as $$
  select l from report_payroll_lines_v l where l.booking_id = (select id from bk where name = p_name)
$$;
create function pg_temp.as_user(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$$;

-- =====================================================================
-- 1-15 · The pay window
-- =====================================================================
select is((pg_temp.pay('b1610') ->> 'payableMin')::int, 240,
  '16:10 on a 16:00 end is paid to 16:00');
select is(pg_temp.pay('b1610') - 'status' - 'payableMin' - 'workedMin' - 'floorApplied',
  '{"lateCheckOutFlag": false, "overrunMin": 0}'::jsonb,
  '16:10 is not a late sign-out and has no overrun');
select is((pg_temp.pay('b1715') ->> 'payableMin')::int, 315,
  '17:15 on a 16:00 end is paid to 17:15 (ADR-0184)');
select is(pg_temp.pay('b1715') - 'status' - 'payableMin' - 'workedMin' - 'floorApplied',
  '{"lateCheckOutFlag": true, "overrunMin": 75}'::jsonb,
  '17:15 is flagged as a late sign-out with 75 minutes of overrun');
select is((select row(l.status, l.payable_min, l.overrun_min, l.invoicing, l.overrun_invoicing)::text
             from pg_temp.line('b1715') l),
  '(settled,315,75,120.59,28.71)',
  'the payroll line charges 17:15 at the same rate; 75 minutes of it (28.71) are the overrun');
select is((select row(l.base, l.holiday)::text from pg_temp.line('b1715') l),
  row(shift_base_pay(315, 14.00), shift_holiday_pay(shift_base_pay(315, 14.00)))::text,
  'the pay is 315 minutes at the base rate, holiday broken out as always');
select is((select row(l.unpaid_break_min, l.payable_min, l.overrun_min)::text from pg_temp.line('brk') l),
  '(30,285,75)', 'an unpaid break comes off the main part: the overrun stays the 75 minutes past 16:00');
select is((select row(l.worked_min, l.payable_min, l.floor_applied, l.overrun_min)::text from pg_temp.line('floor') l),
  '(135,240,t,45)', 'RULE-14: in at 14:30 and out at 16:45 is floored to four hours on the total, 45 minutes of it overrun');
select is((pg_temp.pay('nco') ->> 'status'), 'undetermined',
  'a No check-out with no finish is still undetermined (RULE-02)');

-- The office enters 18:00 (E+2h) for the No check-out, and E+6h for the typo.
select pg_temp.as_user(:'admin_uid');
set local role authenticated;
select lives_ok($$ select resolve_violation(
    (select v.id from violations v where v.booking_id = (select id from bk where name = 'nco')),
    'Phoned the worker: finished at 18:00', (select e + interval '2 hours' from t), null) $$,
  'a manager resolves the No check-out with an 18:00 finish');
select lives_ok($$ select resolve_violation(
    (select v.id from violations v where v.booking_id = (select id from bk where name = 'typo')),
    'Finish typed six hours late', (select e + interval '6 hours' from t), null) $$,
  'a finish six hours past the end is still accepted (no upper bound, §9.5)');
reset role;
select is(pg_temp.pay('typo') - 'status' - 'workedMin' - 'floorApplied' - 'lateCheckOutFlag',
  '{"payableMin": 480, "overrunMin": 240}'::jsonb,
  'but it is paid only to end + 4 h: 240 minutes of overrun, not 360');
select is(pg_temp.pay('old') - 'status' - 'workedMin' - 'floorApplied',
  '{"payableMin": 240, "overrunMin": 0, "lateCheckOutFlag": true}'::jsonb,
  'a section that ended before 21.10.2026 (UK) is still paid to its scheduled end: no history is re-priced');
select is(pg_temp.pay('nco') - 'status' - 'workedMin' - 'floorApplied' - 'lateCheckOutFlag',
  '{"payableMin": 360, "overrunMin": 120}'::jsonb,
  'the manager-entered 18:00 finish is the check-out: paid to 18:00, 120 minutes of overrun');
select is((select l.status from pg_temp.line('nco') l), 'settled', 'and the line is settled for payroll');

-- =====================================================================
-- 16-22 · Pressed off site: the last on-site fix, the same rule
-- =====================================================================
select pg_temp.as_user(:'w6_uid');
set local role authenticated;
create temp table co as
  select check_out((select id from bk where name = 'today'), 51.6, -0.3) as r;
reset role;
select is((select r ->> 'decision' from co), 'recorded_last_on_site',
  'off site, the check-out records the last on-site fix');
select is((select check_out_at from check_logs where booking_id = (select id from bk where name = 'today')
             and check_in_at is not null),
  (select max(at) from location_pings where booking_id = (select id from bk where name = 'today')),
  'the recorded finish is that fix, 30 minutes past the end');
select is((select (r -> 'pay' ->> 'payableMin')::int from co), 330,
  'and the worker is told it is paid to the fix: five hours and the 30 minutes past the end');
select is((select (r -> 'pay' ->> 'overrunMin')::int from co), 30, 'of which 30 minutes are overrun');
select is((select count(*)::int from violations where booking_id = (select id from bk where name = 'today')),
  0, 'a late sign-out raises no violation');

select pg_temp.as_user(:'admin_uid');
set local role authenticated;
select is((select row(m.status, m.late_check_out, m.late_check_out_verified_at is null)::text
             from checkin_monitor_v m where m.booking_id = (select id from bk where name = 'today')),
  '(checked_out,t,t)', 'the monitor shows it signed out late and not yet verified');
select is((select minutes_past_end from late_check_outs() where booking_id = (select id from bk where name = 'today')),
  30, 'the office''s list to verify carries it, 30 minutes past the end');
reset role;

-- =====================================================================
-- 23-26 · Nothing waits for Verify: payroll and invoice readiness
-- =====================================================================
select pg_temp.as_user(:'admin_uid');
set local role authenticated;
select is((select row(status, payable_min, in_export)::text from payroll_report((select d - 1 from t), (select d + 1 from t))
            where booking_id = (select id from bk where name = 'b1715')),
  '(settled,315,t)', 'an unverified late sign-out is settled and in the payroll export');
reset role;
select is((select row(status, needs_signoff, violations)::text
             from _invoice_event_rows(array[(select event_id from ev where name = 'Tue')], now())),
  '(ready,f,0)', 'an event with unverified late sign-outs is ready to invoice with no sign-off');
create temp table fp0 as select invoice_event_fingerprint((select event_id from ev where name = 'Tue')) as fp;
select pg_temp.as_user(:'admin_uid');
set local role authenticated;
select lives_ok($$ select verify_late_check_out((select id from bk where name = 'b1715'),
                    'Client asked her to stay for the speeches') $$,
  'a manager verifies the 17:15 sign-out');
reset role;
select is(invoice_event_fingerprint((select event_id from ev where name = 'Tue')), (select fp from fp0),
  'verifying changes nothing an invoice sign-off vouches for');

-- =====================================================================
-- 27-40 · Verify: who may, and what it records
-- =====================================================================
select ok(not has_function_privilege('anon', 'public.verify_late_check_out(uuid,text)', 'execute'),
  'anon cannot call Verify');

select pg_temp.as_user(:'w6_uid');
set local role authenticated;
select throws_ok($$ select verify_late_check_out((select id from bk where name = 'today'), 'mine') $$,
  '42501', 'admins_only', 'the worker cannot verify their own late sign-out');
select is((select count(*)::int from check_logs where booking_id = (select id from bk where name = 'today')),
  0, 'nor read the check log the office''s note goes on');
select throws_ok($$ select * from late_check_outs() $$, '42501', 'admins_only',
  'nor read the office''s list');
reset role;

select pg_temp.as_user(:'clienta_uid');
set local role authenticated;
select throws_ok($$ select verify_late_check_out((select id from bk where name = 'today'), 'x') $$,
  '42501', 'admins_only', 'a client cannot verify');
select is((select count(*)::int from check_logs where booking_id = (select id from bk where name = 'today')),
  0, 'nor read the check log');
reset role;

select pg_temp.as_user(:'viewer_uid');
set local role authenticated;
select throws_ok($$ select verify_late_check_out((select id from bk where name = 'today'), 'x') $$,
  '42501', 'not_permitted', 'a viewer cannot verify (office_can(''write''))');
reset role;

select pg_temp.as_user(:'admin_uid');
set local role authenticated;
select throws_ok($$ select verify_late_check_out((select id from bk where name = 'today'), '   ') $$,
  'P0001', 'note_required', 'the note is mandatory');
select throws_ok($$ select verify_late_check_out((select id from bk where name = 'b1610'), 'x') $$,
  'P0001', 'not_signed_out_late', 'a sign-out inside the 15-minute grace has nothing to verify');
reset role;

select pg_temp.as_user(:'sched_uid');
set local role authenticated;
select lives_ok($$ select verify_late_check_out((select id from bk where name = 'today'),
                    '  Stayed to help the client clear the room  ') $$,
  'a scheduler verifies (finance-free)');
select is((select row(m.late_check_out_verified_at is not null, m.late_check_out_verified_by_name,
                      m.late_check_out_note)::text
             from checkin_monitor_v m where m.booking_id = (select id from bk where name = 'today')),
  '(t,"Sam Scheduler","Stayed to help the client clear the room")',
  'the monitor shows who verified it and the note, trimmed');
select is((select count(*)::int from late_check_outs() where booking_id = (select id from bk where name = 'today')),
  0, 'a verified one leaves the list to verify');
select is((select verified_by_name from late_check_outs(14, true)
            where booking_id = (select id from bk where name = 'today')),
  'Sam Scheduler', 'and is listed with who verified it when the resolved are shown');
reset role;
select is((select row(actor, data ->> 'note', (data ->> 'minutesPastEnd')::int)::text from audit_log
            where action = 'booking.late_check_out_verified'
              and entity_id = (select id from bk where name = 'today')),
  row(:'sched_uid'::uuid, 'Stayed to help the client clear the room', 30)::text,
  'each Verify is audited with the note and the minutes past the end');

-- =====================================================================
-- 41-54 · The invoice: the overrun is its own line
-- =====================================================================
create temp table inv as
  select invoice_claim(g.group_key, now() + interval '2 days') as id
    from _invoice_groups(now() + interval '2 days') g
   where (select event_id from ev where name = 'Tue') = any (g.event_ids);
select isnt((select id from inv), null, 'the Tuesday invoice is issued without anybody verifying');

create temp table il as
  select l.*, (select name from bk where bk.id = l.booking_id) as who
    from invoice_lines l where l.invoice_id = (select id from inv);

select is((select count(*)::int from il), 7, 'four shift lines and three overrun lines');
select is((select string_agg(who || ':' || kind, ',' order by sort) from il),
  'b1610:worked,b1715:worked,b1715:overrun,brk:worked,brk:overrun,floor:worked,floor:overrun',
  'each overrun line sits straight after its shift''s own line');
select is((select row(payable_min, rate, amount, break_min, starts_at, ends_at)::text from il
            where who = 'b1715' and kind = 'overrun'),
  (select row(75, 22.97::numeric(8,2), 28.71::numeric(12,2), 0, e, e + interval '75 minutes')::text from t),
  'the overrun: 16:00 to 17:15, 75 minutes at the same charge rate, no break');
select is((select row(payable_min, amount)::text from il where who = 'b1715' and kind = 'worked'),
  '(240,91.88)', 'the shift''s own line keeps 12:00–16:00: 240 minutes, 91.88');
select is((select sum(amount) from il where who = 'b1715'),
  (select l.invoicing from pg_temp.line('b1715') l),
  'the two lines add up to the shift''s charge to the penny');
select is((select row(payable_min, break_min)::text from il where who = 'brk' and kind = 'worked'),
  '(210,30)', 'a break is deducted from the shift''s own line, not the overrun');
select is((select row(payable_min, floor_applied)::text from il where who = 'floor' and kind = 'worked'),
  '(195,t)', 'the four-hour floor''s top-up sits on the shift''s own line');
select is((select row(payable_min, floor_applied)::text from il where who = 'floor' and kind = 'overrun'),
  '(45,f)', 'and the overrun line is the 45 minutes past 16:00');
select is((select payable_min from invoices where id = (select id from inv)),
  (select sum(payable_min)::int from il),
  'the invoice''s total hours are its lines''');
select is((select payable_min from invoices where id = (select id from inv)),
  240 + 315 + 285 + 240, 'which are every shift''s payable minutes, overruns included');
select is((select net from invoices where id = (select id from inv)),
  (select sum(l.invoicing) from report_payroll_lines_v l
    where l.event_id = (select event_id from ev where name = 'Tue')),
  'and the net is every shift''s charge, unchanged by the split');
select is((select count(*)::int
             from jsonb_array_elements(invoice_document_data((select id from inv)) -> 'lines') x
            where x ->> 'bookingId' = (select id::text from bk where name = 'b1715')),
  2, 'the document names each line''s booking, so the sign-in log can fold the overrun back');
select is((select x ->> 'kind'
             from jsonb_array_elements(invoice_document_data((select id from inv)) -> 'lines') with ordinality x(x, n)
            where x ->> 'bookingId' = (select id::text from bk where name = 'b1715')
            order by n desc limit 1),
  'overrun', 'the document carries the overrun line''s kind');

-- =====================================================================
-- 55-60 · The invoicing CSV splits the overrun the same way
-- =====================================================================
-- Wednesday: one resolved No check-out, so it waits for the ADR-0172
-- sign-off; signed off, its CSV rows are the shift and its overrun. The
-- CSV carries only events the system will not invoice itself (before
-- go-live), so go-live goes back to 26 Oct 2026 first.
do $$
begin
  execute replace(pg_get_functiondef('public.invoicing_config()'::regprocedure), '2026-01-01', '2026-10-26');
end $$;
select pg_temp.as_user(:'admin_uid');
set local role authenticated;
select lives_ok($$ select sign_off_event_invoice(
    (select event_id from ev where name = 'Wed'), 'Finish confirmed with the worker',
    (select i.fingerprint from invoice_events((select d from t), (select d from t)) i
      where i.event_id = (select event_id from ev where name = 'Wed'))) $$,
  'the Wednesday event is signed off for invoicing');
create temp table csv as
  select * from invoice_export_rows((select d from t), (select d from t),
                                    (select event_id from ev where name = 'Wed'));
reset role;
select is((select string_agg(kind || ':' || payable_min, ',') from csv),
  'worked:240,overrun:120', 'the CSV has the shift''s own row, then its overrun');
select is((select row(starts_at, ends_at, charge_rate, invoicing)::text from csv where kind = 'overrun'),
  (select row(e, e + interval '2 hours', 22.97::numeric, round(120 * 22.97 / 60.0, 2))::text from t),
  'the overrun row runs from the scheduled end to the entered finish at the same charge rate');
select is((select sum(invoicing) from csv), (select l.invoicing from pg_temp.line('nco') l),
  'and the rows add up to the shift''s charge');
select is((select sum(payable_min)::int from csv), 360, 'and to its 360 payable minutes');
select pg_temp.as_user(:'admin_uid');
set local role authenticated;
select verify_late_check_out((select id from bk where name = 'today'), 'Rang back: confirmed');
reset role;
select is((select row(late_check_out_verified_by, late_check_out_note,
                      (select count(*)::int from audit_log where action = 'booking.late_check_out_verified'
                          and entity_id = (select id from bk where name = 'today')))::text
             from check_logs where booking_id = (select id from bk where name = 'today') and check_in_at is not null),
  row(:'admin_uid'::uuid, 'Rang back: confirmed', 2)::text,
  'verifying again replaces who and the note, and is audited again');

select * from finish();
rollback;
