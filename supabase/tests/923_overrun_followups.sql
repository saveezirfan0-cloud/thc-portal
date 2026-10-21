-- =====================================================================
-- 923 · ADR-0184 follow-ups — 20261023110000_overrun_followups.sql
--
--   1 · RULE-20: the paid overrun counts against the weekly cap
--       (weekly_booked_hours, the rota guard, the auto-assign pool,
--       staff_directory_v), and the office is warned when it takes a
--       worker past the cap (late_check_outs, checkin_monitor_v).
--   2 · Each invoice line is priced from its own minutes: £17.35/h, 465
--       minutes of which 75 past the end → 112.78 + 21.69 = 134.47.
--   3 · invoice_event_lines shows the split and the late sign-out marker;
--       an overrun line ends at the paid end (end + 4 h at most).
--   4 · check_logs refuses direct writes by an API role; every function
--       path still writes it.
--
-- Times are relative to now(): S–E is a section that ended seven hours
-- ago, after ADR-0184's 21.10.2026 cutoff whenever this runs. The other
-- shifts of the worker's Mon–Sun week sit on the week's other days.
-- =====================================================================
begin;
select plan(46);
\ir _shared/fixtures.psql

\set r_wait     '92200000-0000-4000-8000-000000000001'
\set wa         '92210000-0000-4000-8000-00000000000a'
\set wb         '92210000-0000-4000-8000-00000000000b'
\set wr         '92210000-0000-4000-8000-00000000000c'
\set wt         '92210000-0000-4000-8000-00000000000d'
\set wg         '92210000-0000-4000-8000-00000000000e'
\set wg_uid     '92230000-0000-4000-8000-00000000000e'
\set sched_uid  '92220000-0000-4000-8000-000000000001'
\set viewer_uid '92220000-0000-4000-8000-000000000002'

insert into auth.users (id, email) values
  (:'sched_uid',  'sched.922@rls.test'),
  (:'viewer_uid', 'viewer.922@rls.test'),
  (:'wg_uid',     'wg.922@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'sched_uid',  'admin', 'scheduler', 'Sam Scheduler'),
  (:'viewer_uid', 'admin', 'viewer',    'Vic Viewer');
insert into profiles (id, role, full_name) values (:'wg_uid', 'staff', 'Gil Guard');

insert into roles (id, name, description, pay_rate) values (:'r_wait', 'Followup Waiting Staff', 'fixture', 14.00);
insert into staff (id, user_id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'wa', null,      92201, 'Ada',  'Able',  'f-wa@rls.test', '+447700992201', date '1990-01-01', 'compliant'),
  (:'wb', null,      92202, 'Ben',  'Bold',  'f-wb@rls.test', '+447700992202', date '1990-02-01', 'compliant'),
  (:'wr', null,      92203, 'Rae',  'Round', 'f-wr@rls.test', '+447700992203', date '1990-03-01', 'compliant'),
  (:'wt', null,      92204, 'Tia',  'Typo',  'f-wt@rls.test', '+447700992204', date '1990-04-01', 'compliant'),
  (:'wg', :'wg_uid', 92205, 'Gil',  'Guard', 'f-wg@rls.test', '+447700992205', date '1990-05-01', 'compliant');
insert into staff_roles (staff_id, role_id) values (:'wa', :'r_wait');

-- Go-live lowered for this transaction only (see 909).
update settings set value = value || jsonb_build_object('first_event_date', '2026-01-01')
 where key = 'invoicing';
do $$
begin
  execute replace(pg_get_functiondef('public.invoicing_config()'::regprocedure), '2026-10-26', '2026-01-01');
end $$;

create temp table t as
  select now() - interval '11 hours' as s, now() - interval '7 hours' as e,
         ((now() - interval '11 hours') at time zone 'Europe/London')::date as d;
create temp table ev (name text primary key, event_id uuid);
create temp table sh (name text primary key, shift_id uuid);
create temp table bk (name text primary key, id uuid);
grant select on t, ev, sh, bk to authenticated, anon, service_role;

-- The week's other days (not the late section's), in order.
create function pg_temp.free_day(n int) returns date language sql as $$
  select x.day from (
    select g::date as day, row_number() over (order by g) as rn
      from generate_series(cap_week_start((select d from t)), cap_week_start((select d from t)) + 6, interval '1 day') g
     where g::date <> (select d from t)) x
   where x.rn = n
$$;

create function pg_temp.event(p_name text, p_date date) returns uuid language plpgsql as $$
declare v_event uuid := gen_random_uuid();
begin
  insert into events (id, client_id, venue_name, venue_address, venue_location, geofence_radius_m,
                      title, event_date, pays_breaks, pays_buffer, po_number)
  values (v_event, 'aaaaaaaa-0000-4000-8000-000000000001', 'Followup Venue', '2 Followup St, London',
          st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150,
          'Followup ' || p_name, p_date, true, false, null);
  insert into ev values (p_name, v_event);
  return v_event;
end $$;

create function pg_temp.section(p_name text, p_from timestamptz, p_to timestamptz, p_rate numeric default 22.97)
returns uuid language plpgsql as $$
declare v_shift uuid := gen_random_uuid();
begin
  insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                  charge_rate, pay_rate, allocation_per_hour)
  values (v_shift, pg_temp.event(p_name, (p_from at time zone 'Europe/London')::date),
          '92200000-0000-4000-8000-000000000001', p_from, p_to, 4, 0, p_rate, 14.00, 1);
  insert into sh values (p_name, v_shift);
  return v_shift;
end $$;

create function pg_temp.book(p_name text, p_shift uuid, p_staff uuid, p_in timestamptz, p_out timestamptz,
                             p_status booking_status default 'worked')
returns uuid language plpgsql as $$
declare v_booking uuid := gen_random_uuid();
begin
  insert into bookings (id, shift_id, staff_id, status, source, confirmed_at)
  values (v_booking, p_shift, p_staff, p_status, 'manual', now() - interval '20 days');
  if p_in is not null then
    insert into check_logs (booking_id, attempted_at, outcome, check_in_at, check_out_at)
    values (v_booking, p_in, 'checked_in', p_in, p_out);
  end if;
  insert into bk values (p_name, v_booking);
  return v_booking;
end $$;

-- An 11-hour (or 10-hour) day on the n-th other day of the week, 08:00 UK.
create function pg_temp.long_day(p_name text, p_staff uuid, n int, p_hours int) returns uuid language sql as $$
  select pg_temp.book(p_name,
           pg_temp.section(p_name, (pg_temp.free_day(n) + time '08:00') at time zone 'Europe/London',
                           (pg_temp.free_day(n) + time '08:00') at time zone 'Europe/London' + make_interval(hours => p_hours)),
           p_staff, null, null, 'confirmed')
$$;

-- Ada: 40 h on four other days, then S–E (4 h) signed out 75 minutes late.
select pg_temp.long_day('a' || n, :'wa', n, 10) from generate_series(1, 4) n;
select pg_temp.book('a_late', pg_temp.section('a_late', (select s from t), (select e from t)), :'wa',
                    (select s from t), null);
-- Ben: 44 h on four other days, then S–E signed out 75 minutes late.
select pg_temp.long_day('b' || n, :'wb', n, 11) from generate_series(1, 4) n;
select pg_temp.book('b_late', pg_temp.section('b_late', (select s from t), (select e from t)), :'wb',
                    (select s from t), (select e + interval '75 minutes' from t));
-- A 4-hour section on Ada's fifth other day, for the gates to judge.
select pg_temp.section('extra', (pg_temp.free_day(5) + time '08:00') at time zone 'Europe/London',
                       (pg_temp.free_day(5) + time '12:00') at time zone 'Europe/London');

create function pg_temp.as_user(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$$;

-- =====================================================================
-- 1-17 · RULE-20 counts the paid overrun
-- =====================================================================
select is(weekly_booked_hours(:'wa', (select d from t)), 44.0::numeric,
  'before Ada signs out, her week counts 44 scheduled hours');
select is((select verdict from (select rota_guard_verdict(:'wa', (select shift_id from sh where name = 'extra')) ->> 'verdict' as verdict) x),
  'ok', 'and a 4-hour shift that week still fits her 48 h');
select is((select gate from auto_assign_worker_gate((select shift_id from sh where name = 'extra'), :'wa')),
  null, 'the auto-assign pool lets her through too');
select pg_temp.as_user(:'admin_uid');
set local role authenticated;
select is((select gate from auto_assign_candidates((select shift_id from sh where name = 'extra'), false)
            where staff_id = :'wa'),
  null, 'and so does the board''s agency-wide pool');
reset role;

-- Ada signs out 75 minutes late (the finish recorded, as check_out() writes it).
update check_logs set check_out_at = (select e + interval '75 minutes' from t)
 where booking_id = (select id from bk where name = 'a_late');

select is((select overrun_min from booking_overruns(array[(select id from bk where name = 'a_late')])), 75,
  'her paid overrun is 1 h 15, read as a set (booking_overruns)');
select is(weekly_booked_hours(:'wa', (select d from t)), 45.25::numeric,
  'and counts against her week: 45 h 15');
select is(weekly_booked_hours_except(:'wa', (select d from t), (select shift_id from sh where name = 'extra')),
  45.25::numeric, 'the rota guard''s count has it too');
select is((select verdict from (select rota_guard_verdict(:'wa', (select shift_id from sh where name = 'extra')) ->> 'verdict' as verdict) x),
  'block', 'so the 4-hour shift that week no longer fits (45 h 15 + 4 h > 48 h)');
select is((select gate from auto_assign_worker_gate((select shift_id from sh where name = 'extra'), :'wa')),
  'hours_limit', 'and the auto-assign pool gates her on hours');
select pg_temp.as_user(:'admin_uid');
set local role authenticated;
select is((select gate from auto_assign_candidates((select shift_id from sh where name = 'extra'), false)
            where staff_id = :'wa'),
  'hours_limit', 'the board''s agency-wide pool counts the overrun too');
reset role;
set local role service_role;
select is((select gate from auto_assign_candidates((select shift_id from sh where name = 'extra'), false)
            where staff_id = :'wa'),
  'hours_limit', 'and so does the hourly round''s (service role)');
reset role;

-- Sections that cannot carry a paid overrun are not read: one that ended
-- ten minutes ago (a finish recorded 20 minutes after its end, as a job
-- might), and one before ADR-0184's cutoff.
select pg_temp.book('recent', pg_temp.section('recent', now() - interval '4 hours 10 minutes', now() - interval '10 minutes'),
                    :'wt', now() - interval '4 hours 10 minutes', now() + interval '10 minutes');
select pg_temp.book('old', pg_temp.section('old', '2026-10-20 14:00+00', '2026-10-20 18:00+00'),
                    :'wt', '2026-10-20 14:00+00', '2026-10-20 19:15+00');
select is((select count(*)::int from booking_overruns(array[(select id from bk where name = 'recent')])), 0,
  'a section that ended less than 15 minutes ago has no paid overrun yet');
select is((select count(*)::int from booking_overruns(array[(select id from bk where name = 'old')])), 0,
  'nor does one that ended before 21.10.2026 (UK)');
select is((select weekly_booked_hours from staff_directory_v where id = :'wa'),
  round(weekly_booked_hours(:'wa', (now() at time zone 'Europe/London')::date), 2)::numeric,
  'the staff directory''s "this week" counts the same way');
select is(cap_overrun_minutes((select s from t), (select e from t), (select s from t),
                              (select e + interval '75 minutes' from t), 0, 'unresolved'),
  0, 'an overrun whose No check-out is still open counts nothing until it is resolved');

select pg_temp.as_user(:'admin_uid');
set local role authenticated;
select is((select count(*)::int from late_check_outs() where booking_id = (select id from bk where name = 'b_late')),
  1, 'Ben''s late sign-out is on the office''s list');
select is((select row(week_hours, week_cap_hours)::text
             from late_check_out_weeks(array[(select id from bk where name = 'b_late')])),
  '(49.25,48)', 'and /checkin''s one read for the list''s and the monitor''s late rows gives his week: 49 h 15 counted against 48 h');
reset role;

-- =====================================================================
-- 18-25 · Each line priced from its own minutes
-- =====================================================================
-- £17.35/h, a 6.5-hour section ending at E, signed out at E+75.
select pg_temp.book('round', pg_temp.section('round', (select e - interval '390 minutes' from t), (select e from t), 17.35),
                    :'wr', (select e - interval '390 minutes' from t), (select e + interval '75 minutes' from t));
create function pg_temp.line(p_name text) returns report_payroll_lines_v language sql as $$
  select l from report_payroll_lines_v l where l.booking_id = (select id from bk where name = p_name)
$$;
select is((select row(l.payable_min, l.overrun_min, l.overrun_invoicing, l.invoicing)::text from pg_temp.line('round') l),
  '(465,75,21.69,134.47)',
  'the shift is charged 390 min (112.78) + 75 min (21.69) = 134.47, not 465 min at once (134.46)');

select pg_temp.as_user(:'admin_uid');
set local role authenticated;
select is((select row(payable_min, invoicing, overrun_min, overrun_invoicing, late_check_out, late_check_out_verified)::text
             from invoice_event_lines((select event_id from ev where name = 'round'))),
  '(465,134.47,75,21.69,t,f)', 'the office''s review carries the split and the unverified late sign-out');
select verify_late_check_out((select id from bk where name = 'round'), 'Client asked for clearing up');
select is((select late_check_out_verified from invoice_event_lines((select event_id from ev where name = 'round'))),
  true, 'and shows it verified once the office has');
reset role;

create temp table inv as
  select invoice_claim(g.group_key, now() + interval '2 days') as id
    from _invoice_groups(now() + interval '2 days') g
   where (select event_id from ev where name = 'round') = any (g.event_ids);
select isnt((select id from inv), null, 'the invoice is issued');
select is((select string_agg(kind || ':' || payable_min || ':' || amount, ',' order by sort)
             from invoice_lines where invoice_id = (select id from inv)),
  'worked:390:112.78,overrun:75:21.69', 'each line is its own minutes × £17.35');
select is((select net from invoices where id = (select id from inv)), 134.47::numeric,
  'and the invoice net is the shift''s charge');
select is((select sum(invoicing) from report_payroll_lines_v
            where event_id = (select event_id from ev where name = 'round')), 134.47::numeric,
  'the same figure ready-to-invoice and the financial report sum');
select is((select payable_min from invoices where id = (select id from inv)), 465,
  'the hours are unchanged');

-- =====================================================================
-- 26-28 · An overrun line ends at the paid end
-- =====================================================================
select pg_temp.book('typo', pg_temp.section('typo', (select s from t), (select e from t)), :'wt',
                    (select s from t), null);
insert into violations (staff_id, booking_id, type)
  select :'wt', id, 'no_checkout' from bk where name = 'typo';
select pg_temp.as_user(:'admin_uid');
set local role authenticated;
select lives_ok($$ select resolve_violation(
    (select v.id from violations v where v.booking_id = (select id from bk where name = 'typo')),
    'Finish typed six hours late', (select e + interval '6 hours' from t)) $$,
  'resolve_violation (now a definer) still writes the entered finish');
-- A resolved violation: the event waits for the ADR-0172 sign-off.
select sign_off_event_invoice((select event_id from ev where name = 'typo'), 'Finish checked',
         (select i.fingerprint from invoice_events((select d from t), (select d from t)) i
           where i.event_id = (select event_id from ev where name = 'typo')));
reset role;
create temp table inv2 as
  select invoice_claim(g.group_key, now() + interval '2 days') as id
    from _invoice_groups(now() + interval '2 days') g
   where (select event_id from ev where name = 'typo') = any (g.event_ids);
select is((select row(payable_min, starts_at, ends_at)::text from invoice_lines
            where invoice_id = (select id from inv2) and kind = 'overrun'),
  (select row(240, e, e + interval '4 hours')::text from t),
  'a finish entered six hours late: the overrun line is 4 h, from the end to end + 4 h');
select is((select manager_finish_at from check_logs where booking_id = (select id from bk where name = 'typo')),
  (select e + interval '6 hours' from t), 'the entered finish is still recorded as typed');

-- =====================================================================
-- 29-46 · check_logs refuses direct writes; every function path works
-- =====================================================================
select ok((select prosecdef from pg_proc where oid = 'public.resolve_violation(uuid,text,timestamptz,timestamptz)'::regprocedure),
  'resolve_violation is SECURITY DEFINER');
select ok(not has_function_privilege('anon', 'public.resolve_violation(uuid,text,timestamptz,timestamptz)', 'execute'),
  'and anon cannot call it');

select pg_temp.as_user(:'admin_uid');
set local role authenticated;
select throws_ok(format($$ update check_logs set check_out_at = now() where booking_id = %L $$,
                        (select id from bk where name = 'a_late')),
  '42501', 'not_permitted', 'a manager cannot PATCH a check-out');
select throws_ok(format($$ update check_logs set late_check_out_verified_at = now() where booking_id = %L $$,
                        (select id from bk where name = 'b_late')),
  '42501', 'not_permitted', 'nor mark a late sign-out verified without the audited RPC');
select throws_ok(format($$ insert into check_logs (booking_id, outcome, check_in_at) values (%L, 'checked_in', now()) $$,
                        (select id from bk where name = 'a1')),
  '42501', 'not_permitted', 'nor insert a check-in');
select throws_ok(format($$ delete from check_logs where booking_id = %L $$, (select id from bk where name = 'a_late')),
  '42501', 'not_permitted', 'nor delete one');
reset role;

select pg_temp.as_user(:'sched_uid');
set local role authenticated;
select throws_ok(format($$ update check_logs set manager_finish_at = now() where booking_id = %L $$,
                        (select id from bk where name = 'a_late')),
  '42501', 'not_permitted', 'a scheduler cannot PATCH a finish either');
reset role;

select pg_temp.as_user(:'staffa_uid');
set local role authenticated;
with u as (update check_logs set check_out_at = now() where booking_id = (select id from bk where name = 'a_late') returning 1)
  select is((select count(*)::int from u), 0, 'a worker reaches no check log at all (RLS)');
reset role;

set local role service_role;
with u as (update check_logs set on_site_verified = true
            where booking_id = (select id from bk where name = 'a_late') returning 1)
  select is((select count(*)::int from u), 1, 'the service role (jobs) still writes check logs');
reset role;

-- The worker's own presses: check in, then check out, through the RPCs.
select pg_temp.book('guard', pg_temp.section('guard', now() - interval '10 minutes', now() + interval '4 hours'),
                    :'wg', null, null, 'confirmed');
select pg_temp.as_user(:'wg_uid');
set local role authenticated;
select is(attempt_check_in((select id from bk where name = 'guard'), 51.5000, -0.1000) ->> 'decision',
  'checked_in_late', 'attempt_check_in still writes the check-in');
select is(check_out((select id from bk where name = 'guard'), 51.5000, -0.1000) ->> 'decision',
  'recorded_on_site', 'check_out still writes the check-out');
reset role;
select isnt((select check_out_at from check_logs where booking_id = (select id from bk where name = 'guard')
              and check_in_at is not null), null, 'and the row carries both');

-- Get back (board) → resolve_violation, which writes the arrival.
select pg_temp.book('noshow', pg_temp.section('noshow', now() - interval '1 hour', now() + interval '4 hours'),
                    :'wg', null, null, 'confirmed');
insert into violations (staff_id, booking_id, type)
  select :'wg', id, 'no_show' from bk where name = 'noshow';
select pg_temp.as_user(:'viewer_uid');
set local role authenticated;
select throws_ok(format($$ select get_back(%L) $$, (select id from bk where name = 'noshow')),
  '42501', null, 'a viewer still cannot Get back (office_read_only)');
reset role;
select pg_temp.as_user(:'staffa_uid');
set local role authenticated;
select throws_ok(format($$ select resolve_violation((select id from violations where booking_id = %L), 'x') $$,
                        (select id from bk where name = 'noshow')),
  '42501', 'admins_only', 'a worker still cannot resolve a violation');
reset role;
select pg_temp.as_user(:'admin_uid');
set local role authenticated;
select lives_ok(format($$ select get_back(%L) $$, (select id from bk where name = 'noshow')),
  'a manager''s Get back still registers the arrival');
reset role;
select isnt((select check_in_at from check_logs where booking_id = (select id from bk where name = 'noshow')),
  null, 'through check_logs');

-- Verify (definer) still writes, audited.
select pg_temp.as_user(:'sched_uid');
set local role authenticated;
select lives_ok($$ select verify_late_check_out((select id from bk where name = 'b_late'), 'Phoned Ben') $$,
  'verify_late_check_out still writes the verification');
reset role;
select is((select late_check_out_note from check_logs where booking_id = (select id from bk where name = 'b_late')),
  'Phoned Ben', 'on the check log');

select * from finish();
rollback;
