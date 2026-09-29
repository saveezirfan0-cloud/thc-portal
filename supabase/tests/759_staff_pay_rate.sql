-- =====================================================================
-- 759 · A personal pay rate per worker (20261001215000, ADR-0072)
--
--   1. shape: staff_pay_rates has RLS, one policy (admin_finance_read),
--      the viewer's write guard, SELECT only for a signed-in session and
--      nothing for anon; effective_pay_rate() is security INVOKER and
--      set_staff_pay_rate() the only write path;
--   2. set_staff_pay_rate(): finance only, validated like
--      assert_role_input (not negative, to the penny), null clears,
--      refused on a removed worker and for a viewer;
--   3. precedence: effective_pay_rate() = personal ?? section, and every
--      worker-level reader applies it — payable_shifts_v, the payroll
--      report, staff_bookings, staff_shift_detail, staff_open_shifts,
--      staff_earnings, check_out, the push payload — while the section
--      figures (shift_rates_v, the dashboard) stay the section's;
--   4. who sees it: owner / manager / viewer read it; a scheduler, a
--      worker, a client and anon read nothing, and effective_pay_rate()
--      hands them back only the section rate they passed in; the worker
--      sees their own rate through their RPCs, and a scheduler still sees
--      no money anywhere (ADR-0061).
-- =====================================================================
begin;
select plan(67);
\ir _shared/fixtures.psql

\set manager   '75900000-0000-4000-8000-000000000001'
\set scheduler '75900000-0000-4000-8000-000000000002'
\set viewer    '75900000-0000-4000-8000-000000000003'
\set past_ev   '75900000-0000-4000-8000-000000000004'
\set past_sh   '75900000-0000-4000-8000-000000000005'
\set bk_pa     '75900000-0000-4000-8000-000000000006'
\set bk_pb     '75900000-0000-4000-8000-000000000007'
\set run_ev    '75900000-0000-4000-8000-000000000008'
\set run_sh    '75900000-0000-4000-8000-000000000009'
\set bk_run    '75900000-0000-4000-8000-00000000000a'
\set nobody    '75900000-0000-4000-8000-00000000000b'

insert into auth.users (id, email) values
  (:'manager',   'manager.759@rls.test'),
  (:'scheduler', 'scheduler.759@rls.test'),
  (:'viewer',    'viewer.759@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'manager',   'admin', 'manager',   'Mona Manager'),
  (:'scheduler', 'admin', 'scheduler', 'Sam Scheduler'),
  (:'viewer',    'admin', 'viewer',    'Vic Viewer');

-- Yesterday's finished section, worked by both fixture workers at the
-- section's £14.00 — settled, so the payroll report prices it.
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, po_number)
values (:'past_ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
        st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Yesterday Event',
        ((now() - interval '1 day 6 hours') at time zone 'Europe/London')::date, true, true, '759-P'),
       (:'run_ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
        st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Running Event',
        current_date, true, true, '759-R');
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer, charge_rate, pay_rate) values
  (:'past_sh', :'past_ev', :'role_id', now() - interval '1 day 6 hours', now() - interval '1 day 1 hour', 2, 0, 22.97, 14.00),
  (:'run_sh',  :'run_ev',  :'role_id', now() - interval '2 hours',       now() + interval '3 hours',      1, 0, 22.97, 14.00);
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'bk_pa',  :'past_sh', :'staffa', 'worked', 'manual', now() - interval '3 days'),
  (:'bk_pb',  :'past_sh', :'staffb', 'worked', 'manual', now() - interval '3 days'),
  (:'bk_run', :'run_sh',  :'staffa', 'worked', 'manual', now() - interval '3 days');
insert into check_logs (booking_id, outcome, check_in_at, check_out_at, attempted_at) values
  (:'bk_pa',  'checked_in', now() - interval '1 day 6 hours', now() - interval '1 day 1 hour', now() - interval '1 day 6 hours'),
  (:'bk_pb',  'checked_in', now() - interval '1 day 6 hours', now() - interval '1 day 1 hour', now() - interval '1 day 6 hours'),
  (:'bk_run', 'checked_in', now() - interval '2 hours',       null,                           now() - interval '2 hours');

-- =====================================================================
-- 1 · Shape
-- =====================================================================
select has_table('public', 'staff_pay_rates', 'staff_pay_rates exists');
select ok((select relrowsecurity from pg_class where oid = 'public.staff_pay_rates'::regclass),
  'staff_pay_rates has row level security');
select is(
  (select array_agg(polname::text || ':' || polcmd::text order by polname) from pg_policy
    where polrelid = 'public.staff_pay_rates'::regclass),
  array['admin_finance_read:r'],
  'one policy — admin_finance_read, SELECT only; no staff, client or anon policy, and no write policy');
select ok((select pg_get_expr(polqual, polrelid) ~ 'office_can\(''finance''' from pg_policy
            where polrelid = 'public.staff_pay_rates'::regclass),
  'and it asks office_can(''finance'')');
select ok(has_table_privilege('authenticated', 'public.staff_pay_rates', 'select')
      and not has_table_privilege('authenticated', 'public.staff_pay_rates', 'insert')
      and not has_table_privilege('authenticated', 'public.staff_pay_rates', 'update')
      and not has_table_privilege('authenticated', 'public.staff_pay_rates', 'delete'),
  'a signed-in session holds SELECT only — set_staff_pay_rate() is the one write path');
select ok(not has_table_privilege('anon', 'public.staff_pay_rates', 'select')
      and not has_table_privilege('anon', 'public.staff_pay_rates', 'insert'),
  'anon holds nothing on staff_pay_rates');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.staff_pay_rates'::regclass
                   and tgname = 'office_read_only' and not tgisinternal),
  'the viewer''s write guard is on the table (ADR-0060)');
select ok(not (select prosecdef from pg_proc where oid = 'effective_pay_rate(uuid,numeric)'::regprocedure)
      and not has_function_privilege('anon', 'effective_pay_rate(uuid,numeric)', 'execute'),
  'effective_pay_rate is security INVOKER (RLS decides what it adds) and not anon''s');
select ok((select prosecdef from pg_proc where oid = 'set_staff_pay_rate(uuid,numeric)'::regprocedure)
      and not has_function_privilege('anon', 'set_staff_pay_rate(uuid,numeric)', 'execute'),
  'set_staff_pay_rate is security definer and not anon''s');
select ok(not exists (select 1 from information_schema.columns
                       where table_schema = 'public' and table_name = 'staff' and column_name ~ 'rate'),
  'no rate column on staff, which every office role reads (ADR-0061)');
select throws_ok(format($$ insert into staff_pay_rates (staff_id, pay_rate) values (%L, -1) $$, :'staffb'),
  '23514', null, 'the table refuses a negative rate even from the owner');

-- Before any personal rate: everything is the section's.
select is(effective_pay_rate(:'staffa', 14.00), 14.00::numeric, 'no personal rate: the section rate');
select is(effective_pay_rate(null, 14.00), 14.00::numeric, 'no worker: the section rate');

-- =====================================================================
-- 2 · Setting it (manager)
-- =====================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);

select throws_ok(format($$ select set_staff_pay_rate(%L, -0.01) $$, :'staffa'),
  '23514', 'A pay rate cannot be negative', 'a negative rate is refused');
select throws_ok(format($$ select set_staff_pay_rate(%L, 12.715) $$, :'staffa'),
  '23514', 'A pay rate is set to the penny', 'a third decimal is refused, not rounded');
select throws_ok(format($$ select set_staff_pay_rate(%L, 12.71) $$, :'nobody'),
  'P0002', null, 'an unknown worker is refused');
select lives_ok(format($$ select set_staff_pay_rate(%L, 12.00) $$, :'staffa'), 'manager sets a personal rate');
select lives_ok(format($$ select set_staff_pay_rate(%L, 12.71) $$, :'staffa'), 'and changes it (one row per worker)');
select is((select count(*)::int from staff_pay_rates where staff_id = :'staffa'), 1, 'still one row');
select is((select pay_rate from staff_pay_rates where staff_id = :'staffa'), 12.71::numeric, 'manager reads the new rate');
select is((select set_by from staff_pay_rates where staff_id = :'staffa'), :'manager'::uuid, 'the row names who set it');

-- =====================================================================
-- 3 · Precedence — every worker-level reader, as a manager
-- =====================================================================
select is(effective_pay_rate(:'staffa', 14.00), 12.71::numeric, 'effective_pay_rate: the personal rate wins');
select is(effective_pay_rate(:'staffb', 14.00), 14.00::numeric, 'and a worker without one keeps the section''s');
select is((select pay_rate from payable_shifts_v where booking_id = :'bk_pa'), 12.71::numeric,
  'payable_shifts_v prices the worker at their personal rate');
select is((select pay_rate from payable_shifts_v where booking_id = :'bk_pb'), 14.00::numeric,
  'and their colleague on the same section at the section''s');
select is((select charge_rate from payable_shifts_v where booking_id = :'bk_pa'), 22.97::numeric,
  'the charge rate is the section''s either way — it is what the client pays');
select is((select rate from payroll_report(current_date - 3, current_date) where booking_id = :'bk_pa'), 12.71::numeric,
  'payroll report: the personal rate');
select is((select base from payroll_report(current_date - 3, current_date) where booking_id = :'bk_pa'),
          shift_base_pay(300, 12.71),
  'and the line is priced at it (5 h × £12.71)');
select is((select holiday from payroll_report(current_date - 3, current_date) where booking_id = :'bk_pa'),
          shift_holiday_pay(shift_base_pay(300, 12.71)),
  'holiday broken out from it, never blended');
select is((select rate from payroll_report(current_date - 3, current_date) where booking_id = :'bk_pb'), 14.00::numeric,
  'payroll report: the colleague at the section rate');
select is((select pay_rate from staff_bookings(:'staffa') where booking_id = :'booking_a'), 12.71::numeric,
  'manager: staff_bookings(worker) carries the personal rate');
select is((select pay_rate from staff_open_shifts(:'staffa') limit 1), 12.71::numeric,
  'manager: staff_open_shifts(worker) too');
select is((select check_out(:'bk_run', 51.5, -0.1) ->> 'payRate'), '12.71',
  'manager: check_out answers the personal payRate');
select is((select pay_rate from shift_rates_v where shift_id = :'shift_a'), 14.00::numeric,
  'section figures stay the section''s: shift_rates_v');
select is((select base_rate from dashboard_upcoming_v where shift_id = :'shift_a'), 14.00::numeric,
  'and the dashboard forecast rate');

-- ---- the viewer reads it and changes nothing ---------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
select is((select pay_rate from staff_pay_rates where staff_id = :'staffa'), 12.71::numeric, 'viewer (finance) reads the rate');
select throws_ok(format($$ select set_staff_pay_rate(%L, 13.00) $$, :'staffa'),
  '42501', 'read_only', 'viewer: set_staff_pay_rate is refused by the write guard');

-- =====================================================================
-- 4 · Nobody else sees it
-- =====================================================================

-- ---- scheduler ----------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
select is((select count(*)::int from staff_pay_rates), 0, 'scheduler reads no row of staff_pay_rates');
select is(effective_pay_rate(:'staffa', 14.00), 14.00::numeric,
  'scheduler: effective_pay_rate hands back only the section rate passed in — no oracle');
select is(effective_pay_rate(:'staffa', null), null, 'and NULL for NULL');
select is((select count(*)::int from payable_shifts_v where booking_id = :'bk_pa' and pay_rate is null and charge_rate is null), 1,
  'scheduler: payable_shifts_v still carries no rate (ADR-0061)');
select ok((select count(*) > 0 and count(pay_rate) = 0 from staff_bookings(:'staffa')),
  'scheduler: staff_bookings(worker) carries no rate');
select ok((select count(*) > 0 and count(pay_rate) = 0 from staff_open_shifts(:'staffa')),
  'scheduler: staff_open_shifts(worker) carries no rate');
select throws_ok(format($$ select set_staff_pay_rate(%L, 13.00) $$, :'staffa'),
  '42501', 'not_permitted', 'scheduler: set_staff_pay_rate is refused');
select throws_ok(format($$ insert into staff_pay_rates (staff_id, pay_rate) values (%L, 13.00) $$, :'staffb'),
  '42501', null, 'scheduler: nor may the table be written directly');

-- ---- the worker ---------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select is((select count(*)::int from staff_pay_rates), 0, 'worker reads no row of staff_pay_rates, not even their own');
select is(effective_pay_rate(:'staffa', 1.00), 1.00::numeric, 'worker: effective_pay_rate reveals nothing directly');
select is((select pay_rate from staff_bookings() where booking_id = :'booking_a'), 12.71::numeric,
  'worker: My shifts shows their personal base rate (staff_bookings)');
select is((select pay_rate from staff_shift_detail(:'booking_a')), 12.71::numeric,
  'worker: shift detail shows it (staff_shift_detail)');
select ok((select count(*) > 0 and bool_and(pay_rate = 12.71) from staff_open_shifts()),
  'worker: every open shift offered carries it (staff_open_shifts)');
select is((select pay_rate from staff_earnings() where booking_id = :'bk_pa'), 12.71::numeric,
  'worker: earnings price the shift at it (staff_earnings)');
select throws_ok(format($$ select set_staff_pay_rate(%L, 99.00) $$, :'staffa'),
  '42501', 'admins_only', 'worker: cannot set their own rate');
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
select is((select pay_rate from staff_bookings() where booking_id = :'booking_b'), 13.50::numeric,
  'the other worker keeps the section rate');

-- ---- client -------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select is((select count(*)::int from staff_pay_rates), 0, 'client reads no row of staff_pay_rates');
select throws_ok(format($$ select set_staff_pay_rate(%L, 99.00) $$, :'staffa'),
  '42501', 'admins_only', 'client: cannot set a rate');

-- ---- anon ---------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select count(*) from staff_pay_rates $$, '42501', null, 'anon: no privilege on the table');
select throws_ok(format($$ select effective_pay_rate(%L, 1) $$, :'staffa'), '42501', null,
  'anon: may not execute effective_pay_rate');

-- ---- the push payload (definer code, as the owner) ----------------------
reset role;
select is(booking_push_payload(:'booking_a') ->> 'rate', '£12.71', 'the N5 push payload carries the personal base rate');
select lives_ok(format($$ select queue_booking_push('N759', %L) $$, :'booking_a'), 'a booking push is queued');
select is((select payload ->> 'rate' from notification_outbox where key = 'N759:booking:' || :'booking_a'), '£12.71',
  'with the personal rate in its payload');
select is(booking_push_payload(:'booking_b') ->> 'rate', '£13.50', 'a worker without one: the section rate');

-- =====================================================================
-- 5 · Clearing it, and a removed worker
-- =====================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select lives_ok(format($$ select set_staff_pay_rate(%L, null) $$, :'staffa'), 'owner clears the personal rate');
select is((select count(*)::int from staff_pay_rates where staff_id = :'staffa'), 0, 'the row is gone');
select is((select pay_rate from payable_shifts_v where booking_id = :'bk_pa'), 14.00::numeric,
  'payable_shifts_v is back to the section rate');
select is((select pay_rate from staff_bookings(:'staffa') where booking_id = :'booking_a'), 14.00::numeric,
  'and so is staff_bookings');
select lives_ok(format($$ select set_staff_pay_rate(%L, null) $$, :'staffa'), 'clearing twice is harmless');

reset role;
update staff set removed_at = now() where id = :'staffb';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select throws_ok(format($$ select set_staff_pay_rate(%L, 12.71) $$, :'staffb'),
  'P0001', 'staff_removed', 'a removed worker''s rate is not changed');

select * from finish();
rollback;
