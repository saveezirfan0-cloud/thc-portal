-- =====================================================================
-- 769 · The Completed Allocation Timesheet goes with the invoice (ADR-0081)
--   20261002109000_completed_timesheet_with_invoicing.sql
--
-- 1. The automatic D2 is switched off; D1 is not.
-- 2. Only a finance login queues a Completed Timesheet, and not while a
--    No check-out leaves a row blank; a scheduler still sends the
--    Allocation Timesheet.
-- 3. The Client Portal serves a Completed Timesheet only once it was sent
--    — an office Download after the event no longer publishes it.
-- 4. invoicing_timesheets(): finance only, finished uncancelled events
--    with somebody confirmed, the sheet's tally, and where the send stands.
-- =====================================================================
begin;
select plan(26);
\ir _shared/fixtures.psql

\set manager   '76900000-0000-4000-8000-000000000001'
\set scheduler '76900000-0000-4000-8000-000000000002'
\set viewer    '76900000-0000-4000-8000-000000000003'
\set ev_done   '76910000-0000-4000-8000-000000000001'
\set ev_open   '76910000-0000-4000-8000-000000000002'
\set ev_off    '76910000-0000-4000-8000-000000000003'
\set ev_empty  '76910000-0000-4000-8000-000000000004'
\set ev_late   '76910000-0000-4000-8000-000000000005'
\set sec_done  '76920000-0000-4000-8000-000000000001'
\set sec_open  '76920000-0000-4000-8000-000000000002'
\set sec_off   '76920000-0000-4000-8000-000000000003'
\set sec_empty '76920000-0000-4000-8000-000000000004'
\set sec_late  '76920000-0000-4000-8000-000000000005'
\set p_1       '76930000-0000-4000-8000-000000000001'
\set p_2       '76930000-0000-4000-8000-000000000002'
\set p_3       '76930000-0000-4000-8000-000000000003'
\set b_1       '76940000-0000-4000-8000-000000000001'
\set b_2       '76940000-0000-4000-8000-000000000002'
\set b_3       '76940000-0000-4000-8000-000000000003'
\set b_4       '76940000-0000-4000-8000-000000000004'
\set b_5       '76940000-0000-4000-8000-000000000005'

insert into auth.users (id, email) values
  (:'manager',   'manager.769@rls.test'),
  (:'scheduler', 'scheduler.769@rls.test'),
  (:'viewer',    'viewer.769@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'manager',   'admin', 'manager',   'Mona Manager'),
  (:'scheduler', 'admin', 'scheduler', 'Sam Scheduler'),
  (:'viewer',    'admin', 'viewer',    'Vic Viewer');

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'p_1', 97691, 'Luca',  'Moretti', 'i-1@rls.test', '+447700976901', date '1995-01-01', 'compliant'),
  (:'p_2', 97692, 'Aisha', 'Bello',   'i-2@rls.test', '+447700976902', date '1995-01-01', 'compliant'),
  (:'p_3', 97693, 'Tom',   'Reid',    'i-3@rls.test', '+447700976903', date '1995-01-01', 'compliant');

-- Two days ago: a finished gala (two worked, one of them with no
-- check-out), a cancelled one, and one with nobody on it. Today: an event
-- still running. Ten days ago: one outside the period asked for.
insert into events (id, client_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, po_number)
select x.id::uuid, :'clienta'::uuid, 'Invoice Venue', '1 Invoice St',
       st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150, x.title, x.day, true, true, x.po
  from (values (:'ev_done',  'Finished Gala', current_date - 2, '769-A'),
               (:'ev_off',   'Called Off',    current_date - 2, null),
               (:'ev_empty', 'Nobody Came',   current_date - 2, null),
               (:'ev_open',  'Still Running', current_date,     null),
               (:'ev_late',  'Long Ago',      current_date - 10, null)) as x(id, title, day, po);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer, charge_rate, pay_rate)
select x.id::uuid, x.ev::uuid, :'role_id'::uuid, x.s, x.s + interval '6 hours', 2, 0, 22.97, 14.00
  from (values (:'sec_done',  :'ev_done',  now() - interval '2 days'),
               (:'sec_off',   :'ev_off',   now() - interval '2 days'),
               (:'sec_empty', :'ev_empty', now() - interval '2 days'),
               (:'sec_open',  :'ev_open',  now() - interval '1 hour'),
               (:'sec_late',  :'ev_late',  now() - interval '10 days')) as x(id, ev, s);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b_1', :'sec_done', :'p_1', 'worked',    'manual', now() - interval '9 days'),
  (:'b_2', :'sec_done', :'p_2', 'worked',    'manual', now() - interval '9 days'),
  (:'b_3', :'sec_off',  :'p_3', 'confirmed', 'manual', now() - interval '9 days'),
  (:'b_4', :'sec_open', :'p_3', 'confirmed', 'manual', now() - interval '9 days'),
  (:'b_5', :'sec_late', :'p_1', 'worked',    'manual', now() - interval '14 days');
update events set cancelled_at = now() - interval '3 days', cancel_reason = 'client cancelled' where id = :'ev_off';

insert into check_logs (booking_id, attempted_at, outcome, check_in_at, check_out_at) values
  (:'b_1', now() - interval '2 days', 'checked_in', now() - interval '2 days', now() - interval '2 days' + interval '6 hours'),
  (:'b_2', now() - interval '2 days', 'checked_in', now() - interval '2 days', null),
  (:'b_5', now() - interval '10 days', 'checked_in', now() - interval '10 days', now() - interval '10 days' + interval '6 hours');
insert into violations (staff_id, booking_id, type) values (:'p_2', :'b_2', 'no_checkout');

-- =====================================================================
-- 1 · The switches
-- =====================================================================
select is((select value->'completed'->'enabled' from settings where key = 'document_autosend'), 'false'::jsonb,
  'the automatic Completed Allocation Timesheet (D2) is switched off');
select is((select value->'allocation'->'enabled' from settings where key = 'document_autosend'), 'true'::jsonb,
  'the automatic Allocation Timesheet (D1) is not');
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
select is((select verdict from event_documents_due(now(), :'ev_done') where kind = 'signout'), 'disabled',
  'so the job''s verdict for a finished event''s D2 is disabled');
reset role;

-- =====================================================================
-- 2 · Who may queue a Completed Timesheet
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table s_alloc as
  select record_event_document(:'ev_done', 'allocation', :'ev_done' || '/allocation/s.pdf', 'A.pdf', 2, 1) as id;
create temp table s_sign as
  select record_event_document(:'ev_done', 'signout', :'ev_done' || '/signout/s.pdf', 'S.pdf', 2, 1) as id;
select lives_ok(format('select queue_event_document_email(%L)', (select id from s_alloc)),
  'a scheduler still sends the Allocation Timesheet');
select throws_ok(format('select queue_event_document_email(%L)', (select id from s_sign)),
  '42501', 'not_permitted', 'but not the Completed Timesheet: it goes with the invoice');
reset role;
select is((select queued_at from event_documents where id = (select id from s_sign)), null,
  'and nothing was queued for it');

select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format('select queue_event_document_email(%L)', (select id from s_sign)),
  'P0001', 'timesheet_has_blank_hours',
  'a manager neither, while a No check-out leaves a blank Finish Time and Hours Worked (RULE-02)');
reset role;
update check_logs set manager_finish_at = now() - interval '2 days' + interval '6 hours' where booking_id = :'b_2';
update violations set resolved = true, resolved_at = now(), resolution_note = 'fixture' where booking_id = :'b_2';

select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format('select queue_event_document_email(%L)', (select id from s_sign)),
  '42501', 'read_only', 'a viewer reads the invoicing figures and sends nothing (ADR-0060)');
reset role;

-- =====================================================================
-- 3 · The client sees it once it was sent, not before
-- =====================================================================
-- s_sign was drawn after ev_done ended: before ADR-0081 that alone put it
-- on the portal.
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select array_agg(kind order by kind) from client_event_documents_v where event_id = :'ev_done'),
  array['allocation'], 'an unsent Completed Timesheet drawn after the event is not on the portal');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table m_q as select queue_event_document_email((select id from s_sign)) as q;
reset role;
select is((select q->>'key' from m_q), 'D2:document:' || (select id::text from s_sign),
  'a manager queues it, under the manual key');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select array_agg(kind order by kind) from client_event_documents_v where event_id = :'ev_done'),
  array['allocation'], 'queued is not yet sent: still not on the portal');
reset role;

update notification_outbox set sent_at = now() where key = (select q->>'key' from m_q);
set local role authenticated;
select is((select storage_path from client_event_documents_v where event_id = :'ev_done' and kind = 'signout'),
  :'ev_done' || '/signout/s.pdf', 'once the email went, the client downloads that copy');
reset role;

-- A newer Download (unsent) does not replace the copy the client was sent.
insert into event_documents (event_id, kind, storage_path, file_name, row_count, page_count, generated_at)
values (:'ev_done', 'signout', :'ev_done' || '/signout/later.pdf', 'S2.pdf', 2, 1, now() + interval '1 minute');
set local role authenticated;
select is((select storage_path from client_event_documents_v where event_id = :'ev_done' and kind = 'signout'),
  :'ev_done' || '/signout/s.pdf', 'a later office Download does not replace it');
reset role;

-- =====================================================================
-- 4 · invoicing_timesheets
-- =====================================================================
select ok(not has_function_privilege('anon', 'invoicing_timesheets(date,date)', 'execute')
      and not has_function_privilege('public', 'invoicing_timesheets(date,date)', 'execute')
      and has_function_privilege('authenticated', 'invoicing_timesheets(date,date)', 'execute'),
  'invoicing_timesheets: a signed-in session may call it, anon may not');
select ok((select prosecdef and proconfig is not null from pg_proc where proname = 'invoicing_timesheets'),
  'it is security definer with a pinned search_path');

select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select * from invoicing_timesheets(current_date - 7, current_date) $$,
  '42501', 'not_permitted', 'a scheduler does not see the invoicing list');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select * from invoicing_timesheets(current_date - 7, current_date) $$,
  '42501', 'admins_only', 'nor does a client');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select * from invoicing_timesheets(current_date - 7, current_date) $$,
  '42501', 'admins_only', 'nor a worker');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select * from invoicing_timesheets(current_date, current_date - 1) $$,
  '22023', 'bad_period', 'a period that ends before it starts is refused');
select is(
  (select array_agg(event_id order by event_id) from invoicing_timesheets(current_date - 7, current_date)
    where event_id in (:'ev_done', :'ev_open', :'ev_off', :'ev_empty', :'ev_late')),
  array[:'ev_done'::uuid],
  'only the finished event with staff on it: not one still running, cancelled, empty or outside the period');
select results_eq(
  format($$ select event_title, po_number, confirmed, undetermined, worked_min, contacts
             from invoicing_timesheets(current_date - 7, current_date) where event_id = %L $$, :'ev_done'),
  $$ values ('Finished Gala'::text, '769-A'::text, 2, 0, 720, 1) $$,
  'the sheet''s own tally: two on it, none blank once the No check-out was resolved, 12h worked, one contact email');
select ok(
  (select queued_at is not null and sent_at is not null and send_failed_at is null and not automatic
     from invoicing_timesheets(current_date - 7, current_date) where event_id = :'ev_done'),
  'and the Completed Timesheet is shown queued and sent, by hand');
select is(
  (select count(*)::int from invoicing_timesheets(current_date - 12, current_date - 8) where event_id = :'ev_late'),
  1, 'an older period finds the older event');
select ok(
  (select queued_at is null from invoicing_timesheets(current_date - 12, current_date - 8) where event_id = :'ev_late'),
  'with nothing sent for it yet');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$ select * from invoicing_timesheets(current_date - 7, current_date) $$,
  'a viewer reads it (finance), as they read the report it sits beside');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from invoicing_timesheets(current_date - 7, current_date) where event_id = :'ev_done'), 1,
  'an owner reads it');
reset role;

select * from finish();
rollback;
