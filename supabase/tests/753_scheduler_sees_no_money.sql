-- =====================================================================
-- 753 · Schedulers see no money (20261001203000, ADR-0061)
--
-- For owner, manager, scheduler, client and staff:
--   1. the four rate columns — roles.pay_rate, shift_requirements.pay_rate
--      / charge_rate, client_rate_cards.charge_rate — are not selectable
--      by any API session (select, filter, RETURNING); every other column
--      still is;
--   2. the finance read path (shift_rates_v, role_rates_v,
--      rate_card_rates_v) answers owner and manager, and nobody else
--      signed in; definer code and service_role still read the rates;
--   3. every invoker view that carried a rate (payable_shifts_v,
--      dashboard, client card, roles directory) keeps its rows and
--      withholds the rate from a scheduler only;
--   4. every office RPC that returned a rate — staff_bookings(p_staff),
--      staff_open_shifts(p_staff), check_out, the finance RPCs — answers
--      a scheduler with no rate, and the worker with their own base rate;
--   5. the four invoker functions that read `*` / `excluded.<rate>` work
--      again for every office role;
--   6. a scheduler's role section carries the catalogue rates, set rather
--      than checked — no refusal depends on a rate they cannot see.
-- =====================================================================
begin;
select plan(104);
\ir _shared/fixtures.psql

\set manager   '75300000-0000-4000-8000-000000000001'
\set scheduler '75300000-0000-4000-8000-000000000002'
\set role2     '75300000-0000-4000-8000-000000000003'
\set past_ev   '75300000-0000-4000-8000-000000000004'
\set past_sh   '75300000-0000-4000-8000-000000000005'
\set past_sh2  '75300000-0000-4000-8000-000000000006'
\set bk_sched  '75300000-0000-4000-8000-000000000007'
\set bk_mgr    '75300000-0000-4000-8000-000000000008'
\set bk_noshow '75300000-0000-4000-8000-000000000009'
\set sh_s1     '75300000-0000-4000-8000-00000000000a'
\set sh_s2     '75300000-0000-4000-8000-00000000000b'
\set sh_m      '75300000-0000-4000-8000-00000000000c'
\set started   '75300000-0000-4000-8000-00000000000d'
\set card2     '75300000-0000-4000-8000-00000000000e'

insert into auth.users (id, email) values
  (:'manager',   'manager.753@rls.test'),
  (:'scheduler', 'scheduler.753@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'manager',   'admin', 'manager',   'Mona Manager'),
  (:'scheduler', 'admin', 'scheduler', 'Sam Scheduler');

-- A second catalogue role with no rate card anywhere: a scheduler's
-- section for it is charged 0 (the builder's own default).
insert into roles (id, name, pay_rate) values (:'role2', 'Second Fixture Role', 11.00);

-- A section that has started (for check-out, no-show and payable_shifts_v)
-- and a second one beside it; the fixture's shift_a / shift_b are a week out.
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, po_number)
values (:'past_ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
        st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Running Event', current_date, true, true, '753-R');
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer, charge_rate, pay_rate) values
  (:'past_sh',  :'past_ev', :'role_id', now() - interval '2 hours', now() + interval '3 hours', 3, 0, 22.97, 14.00),
  (:'past_sh2', :'past_ev', :'role_id', now() - interval '2 hours', now() + interval '3 hours', 1, 0, 22.97, 14.00);
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'bk_sched',  :'past_sh',  :'staffa', 'worked',    'manual', now() - interval '1 day'),
  (:'bk_noshow', :'past_sh',  :'staffb', 'confirmed', 'manual', now() - interval '1 day'),
  (:'bk_mgr',    :'past_sh2', :'staffb', 'worked',    'manual', now() - interval '1 day');
insert into check_logs (booking_id, outcome, check_in_at, attempted_at) values
  (:'bk_sched', 'checked_in', now() - interval '2 hours', now() - interval '2 hours'),
  (:'bk_mgr',   'checked_in', now() - interval '2 hours', now() - interval '2 hours');

-- =====================================================================
-- 1 · Shape
-- =====================================================================
select is(
  (select count(*)::int
     from (values ('roles', 'pay_rate'), ('shift_requirements', 'pay_rate'),
                  ('shift_requirements', 'charge_rate'), ('client_rate_cards', 'charge_rate')) m(t, c),
          (values ('anon'), ('authenticated')) r(role)
    where has_column_privilege(r.role, format('public.%I', m.t), m.c, 'select')),
  0, 'neither anon nor authenticated may SELECT any of the four rate columns');
select is(
  (select count(*)::int
     from pg_attribute a
    where a.attrelid in ('public.roles'::regclass, 'public.shift_requirements'::regclass, 'public.client_rate_cards'::regclass)
      and a.attnum > 0 and not a.attisdropped
      and a.attname not in ('pay_rate', 'charge_rate')
      and not (has_column_privilege('authenticated', a.attrelid, a.attname, 'select')
               and has_column_privilege('anon', a.attrelid, a.attname, 'select'))),
  0, 'every other column of the three tables is still selectable (a new column needs its grant — this fails until it has one)');
select ok(has_table_privilege('authenticated', 'public.shift_requirements', 'insert')
      and has_table_privilege('authenticated', 'public.shift_requirements', 'update')
      and has_column_privilege('authenticated', 'public.roles', 'pay_rate', 'update')
      and has_column_privilege('authenticated', 'public.client_rate_cards', 'charge_rate', 'insert'),
  'writes are unchanged — RLS and the finance policies still decide who may write a rate');
select ok(has_column_privilege('service_role', 'public.shift_requirements', 'pay_rate', 'select')
      and has_column_privilege('service_role', 'public.roles', 'pay_rate', 'select'),
  'service_role (Edge Functions, cron) still reads the rates');

select is(
  (select count(*)::int from pg_class
    where relname in ('shift_rates_v', 'role_rates_v', 'rate_card_rates_v')
      and relkind = 'v'
      and not (coalesce(reloptions, '{}') @> '{security_invoker=true}')
      and reloptions @> '{security_barrier=true}'),
  3, 'the three rate views run with owner rights, as security barriers');
select is(
  (select count(*)::int
     from (values ('shift_rates_v'), ('role_rates_v'), ('rate_card_rates_v')) v(n),
          (values ('select'), ('insert'), ('update'), ('delete')) p(priv)
    where has_table_privilege('anon', v.n, p.priv)
       or (p.priv <> 'select' and has_table_privilege('authenticated', v.n, p.priv))),
  0, 'anon holds nothing on the rate views and a signed-in session only SELECT — an owner-rights view must never be written through');
select ok(not (select prosecdef from pg_proc where oid = 'office_rates_visible()'::regprocedure)
      and not has_function_privilege('anon', 'office_rates_visible()', 'execute'),
  'office_rates_visible is security INVOKER (it reads current_user) and not anon''s');
select ok(not has_table_privilege('anon', 'payable_shifts_v', 'select')
      and not has_table_privilege('anon', 'staff_shift_history_v', 'select'),
  'anon holds no grant on payable_shifts_v or staff_shift_history_v');

select is(
  (select array_agg(tgname::text order by tgname) from pg_trigger
    where tgrelid = 'shift_requirements'::regclass and not tgisinternal
      and tgname in ('shift_requirements_catalogue_rates', 'shift_requirements_edit_lock', 'shift_requirements_rates_office')),
  array['shift_requirements_catalogue_rates', 'shift_requirements_edit_lock'],
  'the catalogue-rate trigger replaced 20261001200100''s and sorts (so fires) before the edit lock');
select ok((select prosecdef from pg_proc where oid = 'shift_rates_office_guard()'::regprocedure)
      and not has_function_privilege('authenticated', 'shift_rates_office_guard()', 'execute'),
  'the trigger function reads the catalogue as its owner and is still not an RPC');
select is(
  (select count(*)::int from pg_proc
    where oid in ('resolve_violation(uuid,text,timestamptz,timestamptz)'::regprocedure,
                  'office_mark_no_show(uuid)'::regprocedure,
                  'remove_client_role(uuid)'::regprocedure,
                  'add_client_role(uuid,uuid,numeric,text[])'::regprocedure)
      and (prosrc ~* 'select\s+\*\s+into\s+(sr|v)\s+from\s+(shift_requirements|client_rate_cards)'
           or prosrc ~* 'excluded\.charge_rate')),
  0, 'no invoker function left reads a whole role section / rate-card row, or excluded.charge_rate');
select is(
  (select count(*)::int from pg_proc
    where oid in ('resolve_violation(uuid,text,timestamptz,timestamptz)'::regprocedure,
                  'office_mark_no_show(uuid)'::regprocedure)
      and prosrc ~ 'office_mark_no_show|note_required|admins_only'),
  2, 'the two re-created violation functions keep their bodies (their own checks are still in them)');

-- =====================================================================
-- 2 · Per role: the columns directly, the rate views, the invoker views
-- =====================================================================
set local role authenticated;

-- ---- owner ------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select throws_ok(format('select pay_rate from shift_requirements where id = %L', :'shift_a'),
  '42501', null, 'owner: a rate column is not selectable on the table — not even for an owner');
select throws_ok($$ select id from roles where pay_rate > 0 $$,
  '42501', null, 'owner: nor usable in a filter');
select is((select pay_rate from shift_rates_v where shift_id = :'shift_a'), 14.00::numeric, 'owner reads a section''s pay rate through shift_rates_v');
select is((select charge_rate from rate_card_rates_v where id = :'ratecard_a'), 22.97::numeric, 'and a rate card''s charge through rate_card_rates_v');
select is((select pay_rate from role_rates_v where role_id = :'role_id'), 14.00::numeric, 'and a role''s base pay through role_rates_v');
select is((select pay_rate from payable_shifts_v where booking_id = :'bk_sched'), 14.00::numeric, 'owner: payable_shifts_v carries the pay rate');

-- ---- manager ----------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
select throws_ok(format('select charge_rate from client_rate_cards where id = %L', :'ratecard_a'),
  '42501', null, 'manager: not selectable on the table');
select is((select charge_rate from shift_rates_v where shift_id = :'shift_a'), 22.97::numeric, 'manager reads a section''s charge rate through shift_rates_v');
select is((select pay_rate from role_rates_v where role_id = :'role_id'), 14.00::numeric, 'manager reads role_rates_v');
select is((select charge_rate from rate_card_rates_v where id = :'ratecard_a'), 22.97::numeric, 'manager reads rate_card_rates_v');
select is((select pay_rate from role_directory_v where id = :'role_id'), 14.00::numeric, 'manager: Roles & rates shows the base pay (role_directory_v)');
select is((select holiday_rate from role_directory_v where id = :'role_id'), 1.69::numeric, 'with the 12.07% holiday broken out');
select is((select charge_rate from clients_rate_card_v where id = :'ratecard_a'), 22.97::numeric, 'manager: the client card''s rate card shows the charge');
select is((select base_pay_rate from clients_rate_card_v where id = :'ratecard_a'), 14.00::numeric, 'and the base pay beside it');
select is((select charge_rate from payable_shifts_v where booking_id = :'bk_sched'), 22.97::numeric, 'manager: payable_shifts_v carries the charge rate');
select ok((select base_rate is not null and margin_per_hour is not null from dashboard_upcoming_v where shift_id = :'shift_a'),
  'manager: the dashboard''s ten-day list carries rate and margin');
select isnt((select margin_gbp from clients_event_list_v where id = :'event_a'), null, 'manager: the client''s events carry a margin');

-- ---- scheduler --------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
select throws_ok(format('select pay_rate from shift_requirements where id = %L', :'shift_a'),
  '42501', null, 'scheduler: shift_requirements.pay_rate is refused');
select throws_ok(format('select charge_rate from shift_requirements where id = %L', :'shift_a'),
  '42501', null, 'scheduler: shift_requirements.charge_rate is refused');
select throws_ok(format('select pay_rate from roles where id = %L', :'role_id'),
  '42501', null, 'scheduler: roles.pay_rate is refused');
select throws_ok(format('select charge_rate from client_rate_cards where id = %L', :'ratecard_a'),
  '42501', null, 'scheduler: client_rate_cards.charge_rate is refused');
select throws_ok($$ select count(*) from shift_requirements where charge_rate > 20 $$,
  '42501', null, 'scheduler: nor can a rate be filtered on, which would answer "is it over 20?"');
select throws_ok($$ select id from roles order by pay_rate $$,
  '42501', null, 'nor ordered by');
select throws_ok($$ select * from shift_requirements $$,
  '42501', null, 'nor read with *');
select throws_ok(format($$ update roles set name = name where id = %L returning pay_rate $$, :'role_id'),
  '42501', null, 'nor returned from a write');
select is((select headcount from shift_requirements where id = :'shift_a'), 6, 'scheduler still reads a section''s headcount, times and role');
select is((select name from roles where id = :'role_id'), 'RLS Fixture Role', 'and role names');
select is((select dress_codes from client_rate_cards where id = :'ratecard_a'), array['Black tie'], 'and a client''s dress codes for the role');
select is((select count(*)::int from shift_rates_v), 0, 'scheduler reads no row of shift_rates_v');
select is((select count(*)::int from role_rates_v), 0, 'nor of role_rates_v');
select is((select count(*)::int from rate_card_rates_v), 0, 'nor of rate_card_rates_v');
select is((select count(*)::int from payable_shifts_v where booking_id = :'bk_sched' and pay_rate is null and charge_rate is null), 1,
  'scheduler: payable_shifts_v keeps the row, without either rate');
select ok((select pay ? 'status' from payable_shifts_v where booking_id = :'bk_sched'),
  'and still carries the pay verdict (minutes, status) the check-in screen and timesheets read');
select is((select count(*)::int from staff_shift_history_v where booking_id = :'bk_sched'), 1,
  'the staff profile''s shift history still reads (it is minutes, not money)');
select is((select count(*)::int from role_directory_v), 0, 'role_directory_v: no row');
select is((select count(*)::int from clients_rate_card_v), 0, 'clients_rate_card_v: no row');
select is((select count(*)::int from clients_margins_v), 0, 'clients_margins_v: no row');
select is((select count(*)::int from dashboard_week_finance_v), 0, 'dashboard_week_finance_v: no row');
select is((select count(*)::int from dashboard_upcoming_v where shift_id = :'shift_a'
            and charge_rate is null and base_rate is null and final_pay_rate is null and margin_per_hour is null), 1,
  'the ten-day list keeps the section with every rate NULL');
select is((select count(*)::int from clients_event_list_v where id = :'event_a' and margin_gbp is null and margin_pct is null), 1,
  'the client''s events keep the event without its margin');
select is((select avg_margin_pct from clients_directory_v where id = :'clienta'), null, 'the client directory has no margin');

-- ---- client -----------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select throws_ok(format('select charge_rate from shift_requirements where id = %L', :'shift_a'),
  '42501', null, 'client: the column is refused (it read no row before; now it cannot even ask)');
select is((select count(*)::int from shift_rates_v) + (select count(*)::int from role_rates_v)
          + (select count(*)::int from rate_card_rates_v), 0, 'client reads no row of any rate view');
select is((select count(*)::int from payable_shifts_v), 0, 'nor of payable_shifts_v');

-- ---- staff ------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select throws_ok(format('select pay_rate from roles where id = %L', :'role_id'),
  '42501', null, 'worker: roles.pay_rate is refused');
select is((select count(*)::int from shift_rates_v) + (select count(*)::int from role_rates_v)
          + (select count(*)::int from rate_card_rates_v), 0, 'worker reads no row of any rate view');

-- =====================================================================
-- 3 · The office RPCs
-- =====================================================================

-- ---- the worker's own base rate (Staff App) — unchanged ----------------
select is((select pay_rate from staff_bookings() where booking_id = :'booking_a'), 14.00::numeric,
  'worker: My shifts shows their own base rate (staff_bookings)');
select is((select pay_rate from staff_shift_detail(:'booking_a')), 14.00::numeric,
  'worker: shift detail shows it (staff_shift_detail)');
select ok((select count(*) > 0 and count(*) = count(pay_rate) from staff_open_shifts()),
  'worker: every open shift offered carries its base rate (staff_open_shifts)');

-- ---- scheduler: the office-callable worker RPCs withhold it -----------
select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
select ok((select count(*) > 0 and count(pay_rate) = 0 from staff_bookings(:'staffa')),
  'scheduler: staff_bookings(any worker) returns the shifts without a pay rate');
select ok((select count(*) > 0 and count(pay_rate) = 0 from staff_open_shifts(:'staffa')),
  'scheduler: staff_open_shifts(any worker) returns the open shifts without a pay rate');
select is((with r as (select check_out(:'bk_sched', 51.5, -0.1) as j) select (j ? 'payRate') and j -> 'payRate' = 'null'::jsonb from r), true,
  'scheduler: check_out answers no payRate');
select throws_ok($$ select * from finance_report(current_date, current_date) $$, '42501', 'not_permitted',
  'scheduler: finance_report is refused');
select throws_ok($$ select * from payroll_report(current_date, current_date) $$, '42501', 'not_permitted',
  'scheduler: payroll_report is refused');
select ok((select event_document_data(:'past_ev')::text !~* '(rate|charge|margin|holiday|pay)'),
  'scheduler: the §11.3 document data carries no money');

-- The functions that read `*` still work for a scheduler.
select lives_ok(format($$ select resolve_violation(%L, 'Traffic on the A40') $$, :'violation_a'),
  'scheduler resolves a violation (resolve_violation no longer reads the rate columns)');
select lives_ok(format($$ select office_mark_no_show(%L) $$, :'bk_noshow'),
  'scheduler marks a no-show (office_mark_no_show no longer reads the rate columns)');

-- ---- manager: the same RPCs show the rate -----------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
select is((select pay_rate from staff_bookings(:'staffa') where booking_id = :'booking_a'), 14.00::numeric,
  'manager: staff_bookings(any worker) carries the pay rate');
select is((select check_out(:'bk_mgr', 51.5, -0.1) ->> 'payRate'), '14.00',
  'manager: check_out answers the payRate');
select lives_ok($$ select * from finance_report(current_date - 1, current_date + 14) $$, 'manager runs the financial report');
select ok((select count(*) > 0 and count(rate) = count(*) from payroll_report(current_date, current_date)),
  'manager: the payroll report prices every line (the engine reads payable_shifts_v as its owner)');
select lives_ok(format($$ select resolve_violation(%L, 'Signal lost') $$, :'violation_b'),
  'manager resolves a violation');

-- ---- owner ------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select ok((select count(*) > 0 and count(rate) = count(*) from payroll_report(current_date, current_date)),
  'owner: the payroll report prices every line');
select ok((select count(*) > 0 and count(*) = count(pay_rate) from staff_open_shifts(:'staffb')),
  'owner: staff_open_shifts(any worker) carries the rate');

-- ---- client and staff: the finance RPCs stay refused --------------------
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select throws_ok($$ select * from finance_report(current_date, current_date) $$, '42501', null, 'client: finance_report is refused');
select throws_ok(format($$ select * from staff_bookings(%L) $$, :'staffa'), '42501', null,
  'client: cannot read a worker''s shifts at all');
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select throws_ok($$ select * from payroll_report(current_date, current_date) $$, '42501', null, 'worker: payroll_report is refused');
select throws_ok(format($$ select * from staff_bookings(%L) $$, :'staffb'), '42501', null,
  'worker: cannot read another worker''s shifts (and so their rate)');

-- =====================================================================
-- 4 · The rate-card and role functions still work for a manager
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
select lives_ok(format($$ select add_client_role(%L, %L, 24.10, array['Black tie', 'Whites']) $$, :'clienta', :'role_id'),
  'manager re-saves an existing rate-card row (add_client_role''s ON CONFLICT no longer reads excluded.charge_rate)');
select is((select charge_rate from rate_card_rates_v where id = :'ratecard_a'), 24.10::numeric, 'and the new charge is stored');
select lives_ok(format($$ select update_client_role(%L, 24.20, array['Black tie']) $$, :'ratecard_a'),
  'manager edits a rate-card row');
select lives_ok(format($$ select add_client_role(%L, %L, 18.00, null) $$, :'clientb', :'role2'),
  'manager adds a new rate-card row');
select lives_ok(format($$ select remove_client_role((select id from client_rate_cards where client_id = %L and role_id = %L)) $$, :'clientb', :'role2'),
  'manager removes it (remove_client_role no longer reads the whole row)');
select lives_ok($$ select create_role('Fixture Cloakroom', 12.40, null) $$, 'manager creates a role');
select lives_ok(format($$ select update_role(%L, 'Second Fixture Role', 11.00, null) $$, :'role2'), 'and edits one');

-- =====================================================================
-- 5 · A scheduler's role sections carry the catalogue rates
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
select lives_ok(format($$ insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer, charge_rate, pay_rate)
                          values (%L, %L, %L, now() + interval '7 days', now() + interval '7 days 5 hours', 2, 0, 99.00, 99.00) $$,
                       :'sh_s1', :'event_a', :'role_id'),
  'scheduler adds a section with rates of their own — not refused (a refusal would be an oracle)');
select lives_ok(format($$ insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer)
                          values (%L, %L, %L, now() + interval '7 days', now() + interval '7 days 5 hours', 1, 0) $$,
                       :'sh_s2', :'event_a', :'role2'),
  'scheduler adds a section with no rates at all (what the builder sends for them)');
select lives_ok(format($$ update shift_requirements set pay_rate = 1.00, charge_rate = 1.00, headcount = 3 where id = %L $$, :'shift_a'),
  'scheduler''s re-price of an existing section is not refused');
select lives_ok(format($$ update shift_requirements set pay_rate = 2.00 where id = %L $$, :'past_sh'),
  'nor on a STARTED event — the edit lock sees the kept rate, so its answer cannot depend on the value typed');
select lives_ok(format($$ update shift_requirements set pay_rate = 3.00 where id = %L $$, :'past_sh'),
  'whatever the value');
select lives_ok(format($$ update shift_requirements set role_id = %L where id = %L $$, :'role2', :'sh_s1'),
  'scheduler changes a section''s role');

select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
select lives_ok(format($$ insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer, charge_rate, pay_rate)
                          values (%L, %L, %L, now() + interval '7 days', now() + interval '7 days 5 hours', 1, 0, 30.00, 15.50) $$,
                       :'sh_m', :'event_a', :'role_id'),
  'manager adds a section at their own rates');

reset role;
select is((select array[pay_rate, charge_rate] from shift_requirements where id = :'sh_s2'), array[11.00, 0.00]::numeric[],
  'the scheduler''s rate-less section got the catalogue pay and 0 charge (no rate card for that role at this client)');
select is((select array[pay_rate, charge_rate] from shift_requirements where id = :'shift_a'), array[14.00, 22.97]::numeric[],
  'the re-price left the stored rates as they were (headcount changed)');
select is((select headcount from shift_requirements where id = :'shift_a'), 3, 'while the headcount edit applied');
select is((select array[pay_rate, charge_rate] from shift_requirements where id = :'past_sh'), array[14.00, 22.97]::numeric[],
  'the started section kept its rates');
select is((select array[pay_rate, charge_rate] from shift_requirements where id = :'sh_s1'), array[11.00, 0.00]::numeric[],
  'the role change took the new role''s catalogue rates, not the 99.00 first typed');
select is((select array[pay_rate, charge_rate] from shift_requirements where id = :'sh_m'), array[15.50, 30.00]::numeric[],
  'the manager''s own rates stood');
select is((select charge_rate from client_rate_cards where id = :'ratecard_a'), 24.20::numeric,
  'the manager''s rate-card edit stood');

-- A write by the table owner (seed, migrations, definer functions) is not
-- the scheduler's, even with a scheduler's claims still set.
select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
update shift_requirements set pay_rate = 14.25 where id = :'sh_m';
select is((select pay_rate from shift_requirements where id = :'sh_m'), 14.25::numeric,
  'a write with no signed-in role (owner, service) is untouched by the trigger');

-- A scheduler's scheduling still works end to end for their own section.
set local role authenticated;
select is((select count(*)::int from shift_requirements where id in (:'sh_s1', :'sh_s2')), 2,
  'the scheduler sees the sections they built');
select is((select count(*)::int from shift_rates_v where shift_id in (:'sh_s1', :'sh_s2')), 0,
  'and still not their rates');
reset role;

select * from finish();
rollback;
