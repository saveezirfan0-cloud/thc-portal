-- =====================================================================
-- 939 · Timesheet invoicing in the Back Office; every invoice to Xero
--       — ADR-0210, 20261027100000_timesheet_invoicing.sql and
--       20261027120000_timesheet_invoicing_fixes.sql
--
-- Who may do what (finance owner, scheduler, viewer, client, worker, anon),
-- then ONE job end to end for TS Test Client (timesheet mode, £14 terms,
-- PO required, aggregated format, default role Waiting):
--
--   rates   Waiting 18.98 (alias "Food Waiting Staff M&E"), Bar Staff 20.00,
--           Service Staff 17.77
--   Ann     Food Waiting Staff M&E  18:30-02:00 less 30   = 7.00 h  132.86
--   Bob     waiting                 17:00-21:03           = 4.05 h   76.87 (76.869)
--   Eve     Service Staff           08:00-14:30           = 6.50 h  115.51 (115.505)
--   Train   custom 1 x 13.90                                         13.90
--           PO-1 net 339.14, VAT 67.83 (67.828), total 406.97
--   Gil     Waiting                 09:00-13:00           = 4.00 h   75.92   PO-2
--   Hal     Waiting (worker 93901)  10:00-12:00           = 2.00 h   37.96   PO-3
--
-- Dates are October 2026 (BST until Sun 25 Oct: 18:30 UK = 17:30 UTC).
-- The invoice counter is read, never assumed: the numbers are "the counter
-- as it stood" and the next two.
-- =====================================================================
begin;
select plan(177);
\ir _shared/fixtures.psql

\set sched_uid  '93900000-0000-4000-8000-0000000000f2'
\set viewer_uid '93900000-0000-4000-8000-0000000000f1'
\set tsclient   '93900000-0000-4000-8000-00000000c001'
\set tsclient2  '93900000-0000-4000-8000-00000000c002'
\set j1         '93900000-0000-4000-8000-00000000a001'
\set j2         '93900000-0000-4000-8000-00000000a002'
\set j3         '93900000-0000-4000-8000-00000000a003'
\set j4         '93900000-0000-4000-8000-00000000a004'
\set s_ann      '93900000-0000-4000-8000-000000000101'
\set s_bob      '93900000-0000-4000-8000-000000000102'
\set s_eve      '93900000-0000-4000-8000-000000000103'
\set s_train    '93900000-0000-4000-8000-000000000104'
\set s_gil      '93900000-0000-4000-8000-000000000105'
\set s_hal      '93900000-0000-4000-8000-000000000106'
\set s_cy       '93900000-0000-4000-8000-000000000107'
\set s_dee      '93900000-0000-4000-8000-000000000108'
\set s_hana     '93900000-0000-4000-8000-000000000109'
\set staff_ivy  '93900000-0000-4000-8000-00000000d001'

insert into auth.users (id, email) values
  (:'sched_uid',  'sched.939@rls.test'),
  (:'viewer_uid', 'viewer.939@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'sched_uid',  'admin', 'scheduler', 'Sam Scheduler'),
  (:'viewer_uid', 'admin', 'viewer',    'Vera Viewer');

insert into clients (id, name, contact_name, phone, staff_contact_point, contact_emails, pays_breaks, pays_buffer) values
  (:'tsclient',  'TS Test Client', 'Tess T', '+447700993901', 'Desk', array['accounts@ts.test'], true, true),
  (:'tsclient2', 'TS Client Two',  'Tom T',  '+447700993902', 'Desk', array['two@ts.test'], true, true);
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'staff_ivy', 93901, 'Ivy', 'Ives', 'ts-ivy@rls.test', '+447700993903', date '1996-05-01', 'compliant');

-- Run a statement, report 'ok' or 'SQLSTATE:message'. Invoker rights: the
-- caller's role and claims apply inside.
create function pg_temp.refusal(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ':' || sqlerrm;
end $$;
grant execute on function pg_temp.refusal(text) to authenticated, service_role;

-- =====================================================================
-- A · Shape: RLS, policies, grants (the 001 snapshot, from the angle of
--     who can reach what)
-- =====================================================================
select is((select count(*)::int from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relrowsecurity
              and c.relname in ('timesheet_rates', 'timesheet_jobs', 'timesheet_files', 'timesheet_shifts',
                                'invoice_sends', 'xero_connection', 'xero_sync')), 7,
  'all seven new tables have row level security on');
select bag_eq(
  $$ select c.relname::text || '.' || p.polname::text || ':' || p.polcmd::text
       from pg_policy p join pg_class c on c.oid = p.polrelid
      where c.relname in ('timesheet_rates', 'timesheet_jobs', 'timesheet_files', 'timesheet_shifts',
                          'invoice_sends', 'xero_connection', 'xero_sync') $$,
  $$ values ('timesheet_rates.admin_finance_read:r'::text), ('timesheet_rates.admin_finance_write:*'),
            ('timesheet_files.admin_finance_read:r'), ('timesheet_files.admin_finance_write:*'),
            ('timesheet_shifts.admin_finance_read:r'), ('timesheet_shifts.admin_finance_write:*'),
            ('timesheet_jobs.admin_finance_read:r'), ('timesheet_jobs.admin_finance_write:a'),
            ('timesheet_jobs.admin_finance_update:w'),
            ('invoice_sends.admin_finance_read:r'), ('xero_sync.admin_finance_read:r') $$,
  'finance reads all six; rates, files and review rows are finance-and-write; a job is inserted and updated, never deleted; the send history and the Xero state are read-only; xero_connection has NO policy');
select is_empty(
  $$ select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
      where c.relname in ('timesheet_rates', 'timesheet_jobs', 'timesheet_files', 'timesheet_shifts',
                          'invoice_sends', 'xero_connection', 'xero_sync')
        and (p.polname like 'client%' or p.polname like 'staff%'
             or coalesce(pg_get_expr(p.polqual, p.polrelid), '') ~ 'client|staff') $$,
  'ADR-0004: the client and worker roles hold no policy on any of them (money, and worker names)');
select ok(not exists (
    select 1 from (values ('anon'), ('authenticated')) r(r)
     where has_table_privilege(r.r, 'public.xero_connection', 'select,insert,update,delete,truncate,references,trigger')),
  'xero_connection: no grant to anon or authenticated, so a Xero token never leaves the service role');
select ok(has_table_privilege('service_role', 'public.xero_connection', 'select,insert,update,delete'),
  'and the service role holds it');
select ok(not exists (
    select 1 from unnest(array['timesheet_rates', 'timesheet_jobs', 'timesheet_files', 'timesheet_shifts',
                               'invoice_sends', 'xero_sync']) t
     where has_table_privilege('anon', 'public.' || t, 'select,insert,update,delete')),
  'anon holds no privilege on any of the other six');
select ok(not has_table_privilege('authenticated', 'public.invoice_sends', 'insert,update,delete')
      and not has_table_privilege('authenticated', 'public.xero_sync', 'insert,update,delete')
      and not has_table_privilege('authenticated', 'public.timesheet_jobs', 'delete'),
  'a signed-in caller cannot write the send history or the Xero state, nor delete a job: those are the functions and the job');
select ok(has_table_privilege('authenticated', 'public.timesheet_jobs', 'insert,update')
      and has_table_privilege('authenticated', 'public.timesheet_rates', 'insert,update,delete')
      and has_table_privilege('authenticated', 'public.timesheet_shifts', 'insert,update,delete'),
  'but the office edits rates, review rows and jobs directly (behind the policies and the guards)');
select is((select count(*)::int from pg_trigger t
            where t.tgname = 'office_read_only' and t.tgfoid = 'public.office_read_only_guard()'::regprocedure
              and t.tgrelid in ('public.timesheet_rates'::regclass, 'public.timesheet_jobs'::regclass,
                                'public.timesheet_files'::regclass, 'public.timesheet_shifts'::regclass,
                                'public.invoice_sends'::regclass, 'public.xero_connection'::regclass,
                                'public.xero_sync'::regclass)), 7,
  'ADR-0060: the viewer''s read-only trigger is on every one of the seven (xero_connection since 20261027120000)');

select ok(not exists (
    select 1 from unnest(array[
      'set_client_timesheet_invoicing(uuid,text,text,text,text,text,text,boolean,text,text[],boolean,integer)',
      'timesheet_po_duplicates(uuid,text[])', 'timesheet_job_confirm(uuid,jsonb)',
      'issue_timesheet_invoice(uuid,jsonb)', 'invoice_void(uuid,text)',
      'queue_timesheet_invoice_email(uuid,text[],text[],text[],text,text,text,jsonb)',
      'xero_retry(uuid)', 'xero_status()']) f
     where has_function_privilege('anon', 'public.' || f, 'execute')
        or has_function_privilege('public'::name, 'public.' || f, 'execute') and false),
  'anon cannot execute any of the eight new RPCs');
select ok((select bool_and(has_function_privilege('authenticated', 'public.' || f, 'execute'))
             from unnest(array[
      'set_client_timesheet_invoicing(uuid,text,text,text,text,text,text,boolean,text,text[],boolean,integer)',
      'timesheet_po_duplicates(uuid,text[])', 'timesheet_job_confirm(uuid,jsonb)',
      'issue_timesheet_invoice(uuid,jsonb)', 'invoice_void(uuid,text)',
      'queue_timesheet_invoice_email(uuid,text[],text[],text[],text,text,text,jsonb)',
      'xero_retry(uuid)', 'xero_status()']) f),
  'and a signed-in caller can (each checks its caller in its own body: 892 pins them by name)');
select ok(not exists (
    select 1 from unnest(array[
      'xero_claim_batch(timestamptz,integer)', 'xero_record_result(uuid,boolean,text,text,numeric,text)',
      'invoice_mark_generated(uuid)', 'invoice_document_data(uuid)', 'timesheet_job_transitions()',
      'xero_sync_enqueue()', 'xero_sync_on_void()', 'timesheet_jobs_state_guard()', 'timesheet_shift_compute()',
      'timesheet_shift_delete_guard()']) f
     where has_function_privilege('authenticated', 'public.' || f, 'execute')
        or has_function_privilege('anon', 'public.' || f, 'execute')),
  'the Xero job''s steps, the document data, the state table and the triggers are closed to anon and signed-in callers');
select ok((select bool_and(has_function_privilege('service_role', 'public.' || f, 'execute'))
             from unnest(array['xero_claim_batch(timestamptz,integer)',
                               'xero_record_result(uuid,boolean,text,text,numeric,text)',
                               'invoice_mark_generated(uuid)', 'invoice_document_data(uuid)']) f),
  'and the service role holds the four it runs');
select is(((select value from settings where key = 'xero') - 'sales_account_code' - 'tax_type' - 'attach_pdf'),
  '{"enabled": false, "from_number": 4000, "invoice_status": "DRAFT"}'::jsonb,
  'settings.xero ships switched off, from number 4000, Draft invoices');

-- =====================================================================
-- B · The client card: set_client_timesheet_invoicing and its guard
-- =====================================================================
select is(pg_temp.refusal($$ select set_client_timesheet_invoicing('93900000-0000-4000-8000-00000000c001', 'timesheet',
              'named', null, null, null, null, false, null, '{}', false, null) $$),
  'ok', 'sanity: the owner-side call is valid when made by the table owner with no session (no caller check bites)')
  where false;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(pg_temp.refusal($$ select set_client_timesheet_invoicing('93900000-0000-4000-8000-00000000c001', 'timesheet',
              'named', null, null, null, null, false, null, '{}', false, null) $$),
  '42501:admins_only', 'a client cannot set a client''s timesheet invoicing');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(pg_temp.refusal($$ select set_client_timesheet_invoicing('93900000-0000-4000-8000-00000000c001', 'timesheet',
              'named', null, null, null, null, false, null, '{}', false, null) $$),
  '42501:admins_only', 'nor a worker');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'sched_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(pg_temp.refusal($$ select set_client_timesheet_invoicing('93900000-0000-4000-8000-00000000c001', 'timesheet',
              'named', null, null, null, null, false, null, '{}', false, null) $$),
  '42501:not_permitted', 'nor a scheduler (no money: ADR-0056)');
select throws_ok($$ update clients set po_required = true where id = '93900000-0000-4000-8000-00000000c001' $$,
  '42501', 'not_permitted', 'and a scheduler cannot update the new columns on the client row directly');
select throws_ok($$ update clients set invoice_cc_emails = array['me@sched.test']
                     where id = '93900000-0000-4000-8000-00000000c001' $$,
  '42501', 'not_permitted', 'nor the CC list (the guard kept 20261022130000''s column)');
select lives_ok($$ update clients set staff_contact_point = 'Front of house' where id = '93900000-0000-4000-8000-00000000c001' $$,
  'but still edits the rest of the client card');
select throws_ok($$ insert into clients (name, contact_name, phone, staff_contact_point, contact_emails, pays_breaks, pays_buffer, po_required)
                    values ('Sneaky', 'S', '+447700993999', 'Desk', array['s@s.test'], true, true, true) $$,
  '42501', 'not_permitted', 'nor create a client already set up for timesheet invoicing');
select lives_ok($$ insert into clients (name, contact_name, phone, staff_contact_point, contact_emails, pays_breaks, pays_buffer, accounts_contact_name, invoice_emails)
                    values ('Plain Ltd', 'P', '+447700993998', 'Desk', array['p@p.test'], true, true, 'Pat P', array['inv@p.test']) $$,
  'but a client created with its accounts contact and invoice emails (create_client) is still allowed');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'viewer_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(pg_temp.refusal($$ select set_client_timesheet_invoicing('93900000-0000-4000-8000-00000000c001', 'timesheet',
              'named', null, null, null, null, false, null, '{}', false, null) $$),
  '42501:not_permitted', 'a viewer reads money but writes nothing: refused');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(pg_temp.refusal($$ select set_client_timesheet_invoicing('93900000-0000-4000-8000-00000000c001', 'bogus',
              'named', null, null, null, null, false, null, '{}', false, null) $$),
  '22023:invalid_invoicing_mode', 'a mode other than events / timesheet is refused');
select is(pg_temp.refusal($$ select set_client_timesheet_invoicing('93900000-0000-4000-8000-00000000c001', 'timesheet',
              'grouped', null, null, null, null, false, null, '{}', false, null) $$),
  '22023:invalid_invoice_format', 'so is a format other than named / aggregated (Grouped Detail is not carried over)');
select is(pg_temp.refusal($$ select set_client_timesheet_invoicing('93900000-0000-4000-8000-00000000c001', 'timesheet',
              'named', null, null, null, null, false, null, '{}', false, 121) $$),
  '22023:invalid_payment_terms', 'and terms over 120 days');
select is(pg_temp.refusal($$ select set_client_timesheet_invoicing('93900000-0000-4000-8000-0000000000ff', 'timesheet',
              'named', null, null, null, null, false, null, '{}', false, 14) $$),
  'P0002:unknown_client', 'and a client that does not exist');
select lives_ok($$ select set_client_timesheet_invoicing('93900000-0000-4000-8000-00000000c001', 'timesheet', 'aggregated',
              ' Jurys Inn Test ', 'Hotel', '1 Hotel Rd', 'W/C Date', true, ' Waiting ',
              array[' Bob Ex ', 'bob ex', '', 'Cy Ex'], true, 14) $$,
  'a finance owner sets a client to timesheet invoicing');
reset role;
select is((select row(invoicing_mode, invoice_format, invoice_display_name, invoice_venue, invoice_date_label,
                      omit_event_dates_in_subject, timesheet_default_role, po_required, payment_terms_days)::text
             from clients where id = :'tsclient'),
  row('timesheet', 'aggregated', 'Jurys Inn Test', 'Hotel', 'W/C Date', true, 'Waiting', true, 14)::text,
  'the settings are stored, trimmed');
select is((select timesheet_excluded_staff from clients where id = :'tsclient'),
  array['Bob Ex', 'Cy Ex'], 'excluded staff are trimmed and de-duplicated, blanks dropped');
select is((select exclude_from_invoicing from clients where id = :'tsclient'), true,
  'a timesheet client is also left out of event invoicing (ADR-0203)');
select is((select count(*)::int from _invoice_groups(now() + interval '90 days') g where g.client_id = :'tsclient'), 0,
  'so the daily job never issues it an event invoice');
select is((select count(*)::int from audit_log where action = 'client.timesheet_invoicing' and entity_id = :'tsclient'), 1,
  'the change is audited');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$ select set_client_timesheet_invoicing('93900000-0000-4000-8000-00000000c002', 'events', 'named',
              null, null, null, null, false, null, null, false, null) $$,
  'setting a client back to events does not need an excluded list');
reset role;
select is((select exclude_from_invoicing from clients where id = :'tsclient2'), false,
  'and leaves its ADR-0203 switch alone');

-- =====================================================================
-- C · The rate card and the compute trigger
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'sched_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from timesheet_rates), 0, 'sanity: a scheduler reads no rate');
select ok(left(pg_temp.refusal($$ insert into timesheet_rates (client_id, role_name, charge_rate)
              values ('93900000-0000-4000-8000-00000000c001', 'Waiting', 1) $$), 6) = '42501:',
  'a scheduler cannot add a rate (policy: finance and write)');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'viewer_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(pg_temp.refusal($$ insert into timesheet_rates (client_id, role_name, charge_rate)
              values ('93900000-0000-4000-8000-00000000c001', 'Waiting', 1) $$),
  '42501:read_only', 'nor a viewer (ADR-0060)');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into timesheet_rates (client_id, role_name, aliases, charge_rate) values
  (:'tsclient', 'Waiting', array['Food Waiting Staff M&E'], 18.98),
  (:'tsclient', 'Bar Staff', '{}', 20.00),
  (:'tsclient', 'Service Staff', '{}', 17.77),
  (:'tsclient2', 'Housekeeping', '{}', 15.00);
select throws_ok($$ insert into timesheet_rates (client_id, role_name, charge_rate)
                    values ('93900000-0000-4000-8000-00000000c001', '  WAITING ', 19) $$,
  '23505', null, 'a role is on the card once, whatever its case and spacing');
select throws_ok($$ insert into timesheet_rates (client_id, role_name, charge_rate)
                    values ('93900000-0000-4000-8000-00000000c001', 'Negative', -1) $$,
  '23514', null, 'and a rate is never negative');
select is(timesheet_rate_for(:'tsclient', 'WAITING '), 18.98::numeric, 'the rate is found by role name, case and spacing ignored');
select is(timesheet_rate_for(:'tsclient', ' food waiting staff m&e'), 18.98::numeric, 'or by an alias');
select is(timesheet_rate_for(:'tsclient', 'Bar Staff'), 20.00::numeric, 'each role has its own rate');
select is(timesheet_rate_for(:'tsclient', 'Zebra Handler'), null::numeric,
  'an unknown role has no rate when the card holds different rates');
select is(timesheet_rate_for(:'tsclient2', 'Anything on the sheet'), 15.00::numeric,
  'a client charged one rate for every role needs no alias for each wording (single-rate fallback)');
reset role;

-- =====================================================================
-- D · A job: upload -> extracting -> reviewing, the state guard, the rows
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'sched_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select ok(left(pg_temp.refusal($$ insert into timesheet_jobs (id, client_id)
              values ('93900000-0000-4000-8000-00000000a001', '93900000-0000-4000-8000-00000000c001') $$), 6) = '42501:',
  'a scheduler cannot upload a timesheet (finance and write)');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'viewer_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(pg_temp.refusal($$ insert into timesheet_jobs (id, client_id)
              values ('93900000-0000-4000-8000-00000000a001', '93900000-0000-4000-8000-00000000c001') $$),
  '42501:read_only', 'nor a viewer');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into timesheet_jobs (id, client_id) values (:'j1', :'tsclient');
insert into timesheet_files (id, job_id, storage_path, file_name, mime_type, size_bytes)
  values ('93900000-0000-4000-8000-00000000b001', :'j1', 'timesheet-jobs/j1/sheet.pdf', 'sheet.pdf', 'application/pdf', 1234);
select is((select status from timesheet_jobs where id = :'j1'), 'uploaded', 'a new job is uploaded');
select is((select created_by from timesheet_jobs where id = :'j1'), :'admin_uid'::uuid, 'and records who uploaded it');
select is(pg_temp.refusal($$ update timesheet_jobs set status = 'reviewing' where id = '93900000-0000-4000-8000-00000000a001' $$),
  'P0001:illegal_timesheet_job_transition', 'a signed-in finance admin cannot skip extraction (the guard reads the transition table with definer rights)');
select lives_ok($$ update timesheet_jobs set status = 'extracting' where id = '93900000-0000-4000-8000-00000000a001' $$,
  'uploaded -> extracting');
select lives_ok($$ update timesheet_jobs set status = 'reviewing' where id = '93900000-0000-4000-8000-00000000a001' $$,
  'extracting -> reviewing');
select is(pg_temp.refusal($$ update timesheet_jobs set status = 'uploaded' where id = '93900000-0000-4000-8000-00000000a001' $$),
  'P0001:illegal_timesheet_job_transition', 'and nothing goes back to uploaded');
select is(pg_temp.refusal($$ delete from timesheet_jobs where id = '93900000-0000-4000-8000-00000000a001' $$),
  '42501:permission denied for table timesheet_jobs', 'a job is never deleted through the API');

-- the rows
insert into timesheet_shifts (id, job_id, staff_name, work_date, role_name, start_time, end_time, break_min, status) values
  (:'s_ann', :'j1', 'Ann', '2026-10-17', 'Food Waiting Staff M&E', '18:30', '02:00', 30, 'extracted'),
  (:'s_bob', :'j1', 'Bob', '2026-10-17', 'waiting', '17:00', '21:03', 0, 'extracted'),
  (:'s_eve', :'j1', 'Eve', '2026-10-19', 'Service Staff', '08:00', '14:30', 0, 'extracted'),
  (:'s_gil', :'j1', 'Gil', '2026-10-18', 'Waiting', '09:00', '13:00', 0, 'extracted'),
  (:'s_cy',  :'j1', 'Cy',  '2026-10-18', null, '09:00', '17:00', 60, 'extracted'),
  (:'s_dee', :'j1', 'Dee', '2026-10-18', 'Bar Staff', '10:00', '12:00', 0, 'extracted');
update timesheet_shifts set staff_count = 3 where id = :'s_dee';
insert into timesheet_shifts (id, job_id, staff_name, staff_ref, work_date, role_name, start_time, end_time, status) values
  (:'s_hal', :'j1', 'Hal', '93901', '2026-10-18', 'Waiting', '10:00', '12:00', 'extracted');
insert into timesheet_shifts (id, job_id, kind, work_date, description, quantity, rate, status) values
  (:'s_train', :'j1', 'custom', '2026-10-17', 'Train Ticket', 1, 13.90, 'extracted');
insert into timesheet_shifts (id, job_id, staff_name, work_date, role_name, status) values
  (:'s_hana', :'j1', 'Hana', '2026-10-18', 'Zebra Handler', 'extracted');

select is((select hours from timesheet_shifts where id = :'s_ann'), 7.00::numeric, 'overnight 18:30-02:00 less 30 minutes is 7.00 hours');
select is((select hours from timesheet_shifts where id = :'s_bob'), 4.05::numeric, '17:00-21:03 is 4h03 = 4.05 hours, to the minute');
select is((select hours from timesheet_shifts where id = :'s_eve'), 6.50::numeric, '08:00-14:30 is 6.50 hours');
select is((select rate from timesheet_shifts where id = :'s_ann'), 18.98::numeric, 'the rate comes from an alias on the card');
select is((select rate from timesheet_shifts where id = :'s_bob'), 18.98::numeric, 'or the role name in any case');
select is((select rate from timesheet_shifts where id = :'s_cy'), 18.98::numeric,
  'a row with no role takes the client''s default role (Waiting)');
select is((select amount from timesheet_shifts where id = :'s_ann'), 132.86::numeric, 'amount = hours x rate: 7.00 x 18.98');
select is((select amount from timesheet_shifts where id = :'s_bob'), 76.87::numeric, 'rounded to the penny per line: 4.05 x 18.98 = 76.869 -> 76.87');
select is((select amount from timesheet_shifts where id = :'s_eve'), 115.51::numeric, 'half a penny rounds up: 6.50 x 17.77 = 115.505 -> 115.51');
select is((select amount from timesheet_shifts where id = :'s_dee'), 120.00::numeric, 'staff count multiplies: 2.00 x 20.00 x 3');
select is((select amount from timesheet_shifts where id = :'s_train'), 13.90::numeric, 'an expense line is quantity x unit price');
select is((select issues from timesheet_shifts where id = :'s_ann'), '{}'::text[], 'a complete row has no issues');
select is((select issues from timesheet_shifts where id = :'s_hana'), array['no_hours', 'no_rate'],
  'a row with no times and a role the card does not know is flagged no_hours, no_rate');
select is((select amount from timesheet_shifts where id = :'s_hana'), null::numeric, 'and has no amount');
select is(pg_temp.refusal($$ update timesheet_shifts set status = 'approved' where id = '93900000-0000-4000-8000-000000000109' $$),
  'P0001:shift_incomplete', 'a row with issues cannot be approved');
select is(pg_temp.refusal($$ insert into timesheet_shifts (job_id, staff_name, work_date, role_name, status)
              values ('93900000-0000-4000-8000-00000000a001', '', null, 'Waiting', 'approved') $$),
  'P0001:shift_incomplete', 'not even when inserted already approved (no name, no hours, no date)');
update timesheet_shifts set start_time = '09:00', end_time = '11:00', rate = 12 where id = :'s_hana';
select is((select row(hours, amount, issues)::text from timesheet_shifts where id = :'s_hana'),
  row(2.00::numeric, 24.00::numeric, '{}'::text[])::text, 'fixing the row in review clears its issues and prices it');
update timesheet_shifts set status = 'approved' where id in (:'s_ann', :'s_bob', :'s_eve', :'s_train', :'s_gil', :'s_hal');
select is((select count(*)::int from timesheet_shifts where status = 'approved' and job_id = :'j1'), 6, 'complete rows are approved');
select is((select reviewed_by from timesheet_shifts where id = :'s_ann'), :'admin_uid'::uuid, 'and record who approved them');
reset role;

-- A scheduler sees none of it and changes none of it.
select set_config('request.jwt.claims', json_build_object('sub', :'sched_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((with u as (update timesheet_shifts set status = 'rejected' returning 1) select count(*)::int from u), 0,
  'a scheduler''s update of the review rows reaches no row');
reset role;
select is((select count(*)::int from timesheet_shifts where status = 'rejected'), 0, 'and nothing changed');

-- =====================================================================
-- E · Confirm
-- =====================================================================
insert into timesheet_jobs (id, client_id, status) values (:'j2', null, 'reviewing'), (:'j3', :'clienta', 'reviewing'),
  (:'j4', :'tsclient', 'uploaded');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select string_agg(distinct pg_temp.refusal(q), ' | ') from unnest(array[
    $$ select timesheet_job_confirm('93900000-0000-4000-8000-00000000a001', '[]') $$,
    $$ select issue_timesheet_invoice('93900000-0000-4000-8000-00000000a001', '{}') $$,
    $$ select invoice_void('93900000-0000-4000-8000-00000000a001', 'x') $$,
    $$ select queue_timesheet_invoice_email('93900000-0000-4000-8000-00000000a001', array['a@b.co'], '{}', '{}', 's', 'b', null, '[]') $$,
    $$ select xero_retry('93900000-0000-4000-8000-00000000a001') $$,
    $$ select xero_status() $$,
    $$ select * from timesheet_po_duplicates('93900000-0000-4000-8000-00000000c001', array['PO-1']) $$]) q),
  '42501:admins_only', 'a client is refused by every invoicing RPC');
select is((select count(*)::int from timesheet_jobs), 0, 'and reads no job (ADR-0004: no money, no worker names)');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select string_agg(distinct pg_temp.refusal(q), ' | ') from unnest(array[
    $$ select timesheet_job_confirm('93900000-0000-4000-8000-00000000a001', '[]') $$,
    $$ select issue_timesheet_invoice('93900000-0000-4000-8000-00000000a001', '{}') $$,
    $$ select invoice_void('93900000-0000-4000-8000-00000000a001', 'x') $$,
    $$ select queue_timesheet_invoice_email('93900000-0000-4000-8000-00000000a001', array['a@b.co'], '{}', '{}', 's', 'b', null, '[]') $$,
    $$ select xero_retry('93900000-0000-4000-8000-00000000a001') $$,
    $$ select xero_status() $$,
    $$ select * from timesheet_po_duplicates('93900000-0000-4000-8000-00000000c001', array['PO-1']) $$]) q),
  '42501:admins_only', 'a worker is refused by every invoicing RPC');
select is((select count(*)::int from timesheet_shifts) + (select count(*)::int from timesheet_rates), 0,
  'and reads no review row or rate');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'sched_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select string_agg(distinct pg_temp.refusal(q), ' | ') from unnest(array[
    $$ select timesheet_job_confirm('93900000-0000-4000-8000-00000000a001', '[]') $$,
    $$ select issue_timesheet_invoice('93900000-0000-4000-8000-00000000a001', '{}') $$,
    $$ select invoice_void('93900000-0000-4000-8000-00000000a001', 'x') $$,
    $$ select queue_timesheet_invoice_email('93900000-0000-4000-8000-00000000a001', array['a@b.co'], '{}', '{}', 's', 'b', null, '[]') $$,
    $$ select xero_retry('93900000-0000-4000-8000-00000000a001') $$,
    $$ select xero_status() $$,
    $$ select * from timesheet_po_duplicates('93900000-0000-4000-8000-00000000c001', array['PO-1']) $$]) q),
  '42501:not_permitted', 'a scheduler is refused by every invoicing RPC (finance)');
select is((select count(*)::int from timesheet_jobs) + (select count(*)::int from timesheet_files)
        + (select count(*)::int from timesheet_shifts) + (select count(*)::int from invoice_sends)
        + (select count(*)::int from xero_sync), 0, 'and reads none of the five tables');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'viewer_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select string_agg(distinct pg_temp.refusal(q), ' | ') from unnest(array[
    $$ select timesheet_job_confirm('93900000-0000-4000-8000-00000000a001', '[]') $$,
    $$ select issue_timesheet_invoice('93900000-0000-4000-8000-00000000a001', '{}') $$,
    $$ select invoice_void('93900000-0000-4000-8000-00000000a001', 'x') $$,
    $$ select queue_timesheet_invoice_email('93900000-0000-4000-8000-00000000a001', array['a@b.co'], '{}', '{}', 's', 'b', null, '[]') $$,
    $$ select xero_retry('93900000-0000-4000-8000-00000000a001') $$]) q),
  '42501:not_permitted', 'a viewer is refused by every RPC that writes');
select is((select count(*)::int from timesheet_shifts where job_id = '93900000-0000-4000-8000-00000000a001'), 9,
  'but reads the review rows (finance read)');
select is((select string_agg(distinct pg_temp.refusal(q), ' | ') from unnest(array[
    $$ select * from timesheet_po_duplicates('93900000-0000-4000-8000-00000000c001', array['PO-1']) $$,
    $$ select xero_status() $$]) q),
  'ok', 'and may ask the two read-only ones');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(pg_temp.refusal($$ select timesheet_job_confirm('93900000-0000-4000-8000-0000000000ff', '[]') $$),
  'P0002:job_not_found', 'confirm: an unknown job');
select is(pg_temp.refusal($$ select timesheet_job_confirm('93900000-0000-4000-8000-00000000a004', '[]') $$),
  'P0001:job_not_reviewing', 'confirm: a job still at uploaded');
select is(pg_temp.refusal($$ select timesheet_job_confirm('93900000-0000-4000-8000-00000000a002', '[]') $$),
  'P0001:job_has_no_client', 'confirm: a job with no client');
select is(pg_temp.refusal($$ select timesheet_job_confirm('93900000-0000-4000-8000-00000000a003', '[]') $$),
  'P0001:client_not_timesheet', 'confirm: a client invoiced from events');
select is(pg_temp.refusal($$ select timesheet_job_confirm('93900000-0000-4000-8000-00000000a001', '[]') $$),
  '22023:no_invoice_groups', 'confirm: no groups');
select is(pg_temp.refusal($$ select timesheet_job_confirm('93900000-0000-4000-8000-00000000a001',
              '[{"poNumber":"PO-1","shiftIds":[]}]') $$),
  '22023:empty_invoice_group', 'confirm: a group with no rows');
select is(pg_temp.refusal($$ select timesheet_job_confirm('93900000-0000-4000-8000-00000000a001',
              '[{"poNumber":"","shiftIds":["93900000-0000-4000-8000-000000000101"]}]') $$),
  'P0001:po_required', 'confirm: a PO is required for this client');
select is(pg_temp.refusal($$ select timesheet_job_confirm('93900000-0000-4000-8000-00000000a001',
              '[{"poNumber":"A","shiftIds":["93900000-0000-4000-8000-000000000101"]},
                {"poNumber":"B","shiftIds":["93900000-0000-4000-8000-000000000101"]}]') $$),
  '22023:shift_in_two_groups', 'confirm: a row in two invoices');
select is(pg_temp.refusal($$ select timesheet_job_confirm('93900000-0000-4000-8000-00000000a001',
              '[{"poNumber":"A","shiftIds":["93900000-0000-4000-8000-000000000101","93900000-0000-4000-8000-000000000107"]}]') $$),
  'P0001:shift_not_approved', 'confirm: a row that is not approved (Cy is only extracted)');
select is(pg_temp.refusal($$ select issue_timesheet_invoice('93900000-0000-4000-8000-00000000a002', '{}') $$),
  'P0001:job_not_confirmed', 'issue: a job that has not been confirmed');
select is((select count(*)::int from timesheet_po_duplicates(:'tsclient', array['PO-1'])), 0, 'no PO is a duplicate before anything is invoiced');
select is((select count(*)::int from invoices where source = 'timesheet'), 0, 'and no failed attempt took a number');

create temp table ctr (n int);
grant all on ctr to authenticated, service_role;
reset role;
insert into ctr select next_number from invoice_counter;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$ select timesheet_job_confirm('93900000-0000-4000-8000-00000000a001', jsonb_build_array(
    jsonb_build_object('poNumber', 'PO-1', 'invoiceDate', '2026-10-30', 'eventDateEnd', '2026-10-20', 'format', 'named',
      'shiftIds', jsonb_build_array('93900000-0000-4000-8000-000000000101', '93900000-0000-4000-8000-000000000102',
                                    '93900000-0000-4000-8000-000000000103', '93900000-0000-4000-8000-000000000104')),
    jsonb_build_object('poNumber', 'PO-2', 'invoiceDate', '2026-10-30',
      'shiftIds', jsonb_build_array('93900000-0000-4000-8000-000000000105')),
    jsonb_build_object('poNumber', 'PO-3', 'invoiceDate', '2026-10-30',
      'shiftIds', jsonb_build_array('93900000-0000-4000-8000-000000000106')))) $$,
  'confirm: three invoices, each with its own PO');
select is((select status from timesheet_jobs where id = :'j1'), 'confirmed', 'the job is confirmed');
select is((select jsonb_array_length(confirmed_groups) from timesheet_jobs where id = :'j1'), 3, 'and records the three groups');
select is((select count(*)::int from audit_log where action = 'timesheet.confirmed' and entity_id = :'j1'), 1, 'confirm is audited');
select is(pg_temp.refusal($$ update timesheet_shifts set break_min = 5 where id = '93900000-0000-4000-8000-000000000101' $$),
  'P0001:job_not_reviewing', 'a confirmed job''s rows are not edited (back to review first)');

-- =====================================================================
-- F · Issue
-- =====================================================================
select is(pg_temp.refusal($$ select issue_timesheet_invoice('93900000-0000-4000-8000-00000000a001',
              '{"poNumber":"PO-1","shiftIds":["93900000-0000-4000-8000-000000000101","93900000-0000-4000-8000-000000000102"]}') $$),
  'P0001:group_not_confirmed', 'issue: only a group Confirm recorded may be issued (a subset is not)');
select is(pg_temp.refusal($$ select issue_timesheet_invoice('93900000-0000-4000-8000-00000000a001',
              '{"poNumber":"PO-9","shiftIds":["93900000-0000-4000-8000-000000000107"]}') $$),
  'P0001:shift_not_approved', 'issue: a row that is not approved');
select is(pg_temp.refusal(format($$ select issue_timesheet_invoice('93900000-0000-4000-8000-00000000a001', %L::jsonb) $$,
              ((select confirmed_groups -> 0 from timesheet_jobs where id = :'j1') || '{"poNumber":""}')::text)),
  'P0001:po_required', 'issue: the PO is required at issue as well');
select is(pg_temp.refusal(format($$ select issue_timesheet_invoice('93900000-0000-4000-8000-00000000a001', %L::jsonb) $$,
              ((select confirmed_groups -> 0 from timesheet_jobs where id = :'j1') || '{"format":"grouped"}')::text)),
  '22023:invalid_invoice_format', 'issue: a format the card does not offer');
select is((select count(*)::int from invoices where source = 'timesheet'), 0, 'none of the refusals took a number');

create temp table iss (po text primary key, id uuid, number int);
grant all on iss to authenticated, service_role;
insert into iss (po, id, number)
  select 'PO-1', (r ->> 'id')::uuid, (r ->> 'number')::int
    from (select issue_timesheet_invoice(:'j1', (select confirmed_groups -> 0 from timesheet_jobs where id = :'j1')) r) x;
select is((select number from iss where po = 'PO-1'), (select n from ctr), 'the first invoice takes the number the counter stood at');
select is((select next_number from invoice_counter), (select n + 1 from ctr), 'and the counter moves on by one');
select is((select row(source, status, timesheet_job_id, po_number, invoice_date, due_date, terms_days, period_from, period_to)::text
             from invoices where id = (select id from iss where po = 'PO-1')),
  row('timesheet', 'drawing', :'j1'::uuid, 'PO-1', date '2026-10-30', date '2026-11-13', 14, date '2026-10-17', date '2026-10-20')::text,
  'the invoice is drawing, dated as typed, due 14 days on (the client''s terms), the period from the rows (end overridden)');
select is((select row(net, vat_rate, vat, total)::text from invoices where id = (select id from iss where po = 'PO-1')),
  row(339.14::numeric, 20.00::numeric, 67.83::numeric, 406.97::numeric)::text,
  'net is the sum of the printed lines (132.86 + 76.87 + 115.51 + 13.90), VAT is 20% of that rounded (67.828 -> 67.83)');
select is((select payable_min from invoices where id = (select id from iss where po = 'PO-1')), 420 + 243 + 390,
  'payable minutes are the shifts'' minutes (7.00 + 4.05 + 6.50 hours)');
select is((select bill_to ->> 'name' || '|' || (bill_to ->> 'format') || '|' || (bill_to ->> 'dateLabel') || '|' || (bill_to ->> 'venue')
             from invoices where id = (select id from iss where po = 'PO-1')),
  'Jurys Inn Test|named|W/C Date|Hotel', 'bill-to is snapshotted from the card (display name, the group''s format, date label, venue)');
select is((select recipients from invoices where id = (select id from iss where po = 'PO-1')), array['accounts@ts.test'],
  'sent to the main contact when the card has no invoice emails');
select is((select seller -> 'bank' ->> 'sort_code' from invoices where id = (select id from iss where po = 'PO-1')), '30-15-99',
  'THC''s bank details are on it as issued');
select is((select count(*)::int from invoice_lines where invoice_id = (select id from iss where po = 'PO-1')), 4, 'one line per row');
select is((select sum(amount) from invoice_lines where invoice_id = (select id from iss where po = 'PO-1')), 339.14::numeric,
  'the lines add up to the subtotal to the penny');
select is((select row(l.hours, l.staff_count, l.rate, l.amount, l.payable_min, l.break_min, l.role_name, l.kind, l.event_id, l.booking_id)::text
             from invoice_lines l join timesheet_shifts s on s.id = l.timesheet_shift_id where s.id = :'s_ann'),
  row(7.00::numeric, 1, 18.98::numeric, 132.86::numeric, 420, 30, 'Food Waiting Staff M&E', 'timesheet', null::uuid, null::uuid)::text,
  'a line keeps the timesheet''s own wording of the role and has no event or booking');
select is((select row(l.starts_at, l.ends_at)::text from invoice_lines l where l.timesheet_shift_id = :'s_ann'),
  row('2026-10-17 17:30+00'::timestamptz, '2026-10-18 01:00+00'::timestamptz)::text,
  'the times are UK clock times (BST) and a finish before the start is the next day');
select is((select row(l.kind, l.quantity, l.role_name, l.staff_name, l.starts_at, l.payable_min, l.amount)::text
             from invoice_lines l where l.timesheet_shift_id = :'s_train'),
  row('custom', 1.00::numeric, 'Train Ticket', '', null::timestamptz, 0, 13.90::numeric)::text,
  'an expense is a custom line: its description, quantity and unit price');
select is((select count(*)::int from timesheet_shifts where invoice_id = (select id from iss where po = 'PO-1')), 4,
  'the four rows are marked invoiced');
select is((select status from timesheet_jobs where id = :'j1'), 'confirmed', 'the job waits while two groups are still to issue');
select is(pg_temp.refusal($$ update timesheet_shifts set break_min = 5 where id = '93900000-0000-4000-8000-000000000101' $$),
  'P0001:shift_invoiced', 'an invoiced row is locked');
select is(pg_temp.refusal($$ delete from timesheet_shifts where id = '93900000-0000-4000-8000-000000000101' $$),
  'P0001:shift_invoiced', 'and cannot be deleted');
select is(pg_temp.refusal(format($$ select issue_timesheet_invoice('93900000-0000-4000-8000-00000000a001', %L::jsonb) $$,
              (select confirmed_groups -> 0 from timesheet_jobs where id = :'j1')::text)),
  'P0001:shift_not_approved', 'the same group cannot be issued twice');
select is((select count(*)::int from audit_log where action = 'invoice.issued' and entity_id = (select id from iss where po = 'PO-1')), 1,
  'issuing is audited');
select is((select count(*)::int from timesheet_po_duplicates(:'tsclient', array[' po-1 ', 'PO-9'])), 1,
  'a PO already invoiced for the client is reported (whatever its case and spacing)');
select is((select row(invoice_number, status)::text from timesheet_po_duplicates(:'tsclient', array['PO-1'])),
  row((select number from iss where po = 'PO-1'), 'drawing')::text, 'with its invoice number and status');
reset role;
select is((select count(*)::int from xero_sync where invoice_id = (select id from iss where po = 'PO-1')), 0,
  'a drawing invoice is not queued for Xero yet');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into iss (po, id, number)
  select 'PO-2', (r ->> 'id')::uuid, (r ->> 'number')::int
    from (select issue_timesheet_invoice(:'j1', (select confirmed_groups -> 1 from timesheet_jobs where id = :'j1')) r) x;
select is((select status from timesheet_jobs where id = :'j1'), 'confirmed', 'the job still waits for the last group');
insert into iss (po, id, number)
  select 'PO-3', (r ->> 'id')::uuid, (r ->> 'number')::int
    from (select issue_timesheet_invoice(:'j1', (select confirmed_groups -> 2 from timesheet_jobs where id = :'j1')) r) x;
select is((select array_agg(number order by po) from iss), array[(select n from ctr), (select n + 1 from ctr), (select n + 2 from ctr)],
  'the shared counter is gapless across the three invoices');
select is((select status from timesheet_jobs where id = :'j1'), 'complete',
  'the job is complete once every approved row is invoiced (the unapproved ones stay out)');
select is((select format) from (select bill_to ->> 'format' as format from invoices where id = (select id from iss where po = 'PO-2')) f),
  'aggregated', 'a group with no format takes the client''s (aggregated)');
select is((select row(net, vat, total)::text from invoices where id = (select id from iss where po = 'PO-2')),
  row(75.92::numeric, 15.18::numeric, 91.10::numeric)::text, 'PO-2: 4.00 x 18.98 = 75.92, VAT 15.184 -> 15.18');
select is((select employee_id from invoice_lines where invoice_id = (select id from iss where po = 'PO-3')), 93901,
  'a worker''s Employee ID on the sheet is kept on the line');
select is(pg_temp.refusal($$ select issue_timesheet_invoice('93900000-0000-4000-8000-00000000a001', '{}') $$),
  'P0001:job_not_confirmed', 'a complete job issues no more');
reset role;

-- GDPR removal reaches the timesheet line by Employee ID, and an unissued row
-- of a job that is no longer being reviewed (Cy is extracted; Hal is on PO-3)
update timesheet_shifts set staff_ref = '93901' where id = :'s_cy';
update staff set removed_at = now() where id = :'staff_ivy';
select is((select staff_name from invoice_lines where invoice_id = (select id from iss where po = 'PO-3')),
  'Deleted account #93901', 'GDPR: a removed worker''s name on an issued timesheet line becomes Deleted account #id');
select is((select row(staff_name, staff_ref)::text from timesheet_shifts where id = :'s_cy'),
  row('Deleted account #93901', null)::text, 'and so does an unissued row, even in a job that is complete');
select is((select staff_name from timesheet_shifts where id = :'s_hal'), 'Hal',
  'the invoiced row keeps the sheet''s own name: it is the source record the issued PDF came from');

-- =====================================================================
-- G · Generate, send
-- =====================================================================
set local role service_role;
select is(pg_temp.refusal(format($$ select invoice_mark_generated(%L) $$, (select id from iss where po = 'PO-1'))),
  'P0001:invoice_not_open', 'generate: nothing is generated before its PDF is stored');
reset role;
update invoices set storage_path = 'invoices/' || number || '/x.pdf', file_name = 'Invoice ' || number || '.pdf'
 where id in (select id from iss);

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(pg_temp.refusal(format($$ select queue_timesheet_invoice_email(%L, array['a@b.co'], '{}', '{}', 'S', 'B', null, '[]') $$,
              (select id from iss where po = 'PO-1'))),
  'P0001:invoice_not_sendable', 'send: a drawing invoice is not sent');
select is(pg_temp.refusal(format($$ select invoice_void(%L, 'too early') $$, (select id from iss where po = 'PO-1'))),
  'P0001:invoice_not_voidable', 'void: nor voided before it is generated');
reset role;
set local role service_role;
select lives_ok(format($$ select invoice_mark_generated(%L) $$, (select id from iss where po = 'PO-1')), 'generate: PO-1 (drawing -> generated)');
reset role;
select is((select status from invoices where id = (select id from iss where po = 'PO-1')), 'generated', 'and is generated');
select is((select row(status, attempts)::text from xero_sync where invoice_id = (select id from iss where po = 'PO-1')),
  row('pending', 0)::text, 'a generated invoice is queued for Xero');

-- the floor: numbers below settings.xero.from_number are never pushed
update settings set value = value || jsonb_build_object('from_number', (select number + 1 from iss where po = 'PO-3'))
 where key = 'xero';
set local role service_role;
select lives_ok(format($$ select invoice_mark_generated(%L) $$, (select id from iss where po = 'PO-3')), 'generate: PO-3');
select lives_ok(format($$ select invoice_mark_generated(%L) $$, (select id from iss where po = 'PO-2')), 'generate: PO-2');
reset role;
select is((select status from xero_sync where invoice_id = (select id from iss where po = 'PO-3')), 'skipped',
  'a number below from_number is skipped, so the history is never sent');
select is((select status from xero_sync where invoice_id = (select id from iss where po = 'PO-2')), 'skipped',
  'PO-2 sits below the floor too');
update settings set value = value || '{"from_number": 4000}'::jsonb where key = 'xero';
update xero_sync set status = 'pending' where invoice_id = (select id from iss where po = 'PO-2');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(pg_temp.refusal(format($$ select queue_timesheet_invoice_email(%L, array['not-an-email'], '{}', '{}', 'S', 'B', null, '[]') $$,
              (select id from iss where po = 'PO-1'))),
  '22023:invalid_invoice_email', 'send: a bad address is refused');
select is(pg_temp.refusal(format($$ select queue_timesheet_invoice_email(%L, array['a@b.co'], array['bad cc'], '{}', 'S', 'B', null, '[]') $$,
              (select id from iss where po = 'PO-1'))),
  '22023:invalid_invoice_email', 'in Cc too');
select is(pg_temp.refusal(format($$ select queue_timesheet_invoice_email(%L, array[' ', ''], '{}', '{}', 'S', 'B', null, '[]') $$,
              (select id from iss where po = 'PO-1'))),
  'P0001:invoice_has_no_recipients', 'send: at least one To address');
select is(pg_temp.refusal(format($$ select queue_timesheet_invoice_email(%L, array['a@b.co'], '{}', '{}', '  ', 'B', null, '[]') $$,
              (select id from iss where po = 'PO-1'))),
  '22023:subject_required', 'send: a subject');
select is(pg_temp.refusal($$ select queue_timesheet_invoice_email('93900000-0000-4000-8000-0000000000ff', array['a@b.co'], '{}', '{}', 'S', 'B', null, '[]') $$),
  'P0002:invoice_not_found', 'send: an unknown invoice');
select is((select count(*)::int from notification_outbox where template = 'INV2'), 0, 'none of the refusals queued an email');
select is((queue_timesheet_invoice_email((select id from iss where po = 'PO-1'),
            array['Accounts@TS.test', ' accounts@ts.test', 'two@ts.test'], array['cc@ts.test'], '{}',
            'Invoice for PO-1', '<p>Hello</p>', 'admin@thc.test', '[{"path":"invoices/x.pdf","name":"Invoice.pdf"}]'::jsonb) ->> 'key'),
  'INV2:' || (select number from iss where po = 'PO-1') || ':1', 'send: the first email is keyed INV2:<number>:1');
reset role;
select is((select row(channel::text, template, recipient_emails, payload ->> 'subject', payload ->> 'bodyHtml',
                      payload -> 'cc', payload -> 'bcc', payload ->> 'replyTo', payload -> 'attachments' -> 0 ->> 'name')::text
             from notification_outbox where key = 'INV2:' || (select number from iss where po = 'PO-1') || ':1'),
  row('email', 'INV2', array['accounts@ts.test', 'two@ts.test'], 'Invoice for PO-1', '<p>Hello</p>',
      '["cc@ts.test"]'::jsonb, '[]'::jsonb, 'admin@thc.test', 'Invoice.pdf')::text,
  'INV2 carries the composed message: addresses lower-cased and de-duplicated, Cc, subject, body, reply-to and attachments');
select is((select row(status, outbox_key, recipients)::text from invoices where id = (select id from iss where po = 'PO-1')),
  row('queued', 'INV2:' || (select number from iss where po = 'PO-1') || ':1', array['accounts@ts.test', 'two@ts.test'])::text,
  'the invoice is queued (sent) and records who it went to');
select ok((select sent_at is not null and queued_at is not null from invoices where id = (select id from iss where po = 'PO-1')),
  'with the time it was sent');
select is((select row(to_emails, cc_emails, bcc_emails, subject, sent_by)::text from invoice_sends
            where invoice_id = (select id from iss where po = 'PO-1')),
  row(array['accounts@ts.test', 'two@ts.test'], array['cc@ts.test'], '{}'::text[], 'Invoice for PO-1', :'admin_uid'::uuid)::text,
  'the send history records it, and who sent it');
select is((select count(*)::int from audit_log where action = 'invoice.sent' and entity_id = (select id from iss where po = 'PO-1')), 1, 'and the send is audited');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((queue_timesheet_invoice_email((select id from iss where po = 'PO-1'), array['accounts@ts.test'], '{}', '{}', 'Again', '', null, '[]') ->> 'key'),
  'INV2:' || (select number from iss where po = 'PO-1') || ':2', 'send again: the second email is :2');
reset role;
select is((select count(*)::int from invoice_sends where invoice_id = (select id from iss where po = 'PO-1')), 2, 'and the history has both');
select is((select status from invoices where id = (select id from iss where po = 'PO-1')), 'queued', 'the invoice stays queued');

-- the viewer reads the send history
select set_config('request.jwt.claims', json_build_object('sub', :'viewer_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from invoice_sends) + (select count(*)::int from xero_sync), 5,
  'a viewer reads the send history (2) and the Xero state (3 invoices)');
reset role;

-- =====================================================================
-- H · Xero: claim, record, retry
-- =====================================================================
set local role service_role;
select is((select count(*)::int from xero_claim_batch(now(), 10)), 0, 'Xero is switched off: the job claims nothing');
reset role;
update settings set value = value || '{"enabled": true}'::jsonb where key = 'xero';
set local role service_role;
select is((select count(*)::int from xero_claim_batch(now(), 10)), 0, 'switched on but not connected: still nothing');
reset role;
insert into xero_connection (tenant_id, tenant_name, access_token, refresh_token, expires_at)
  values ('tenant-1', 'THC Ltd', 'at', 'rt', now() + interval '30 minutes');
select throws_ok($$ insert into xero_connection (tenant_id, access_token, refresh_token, expires_at)
                    values ('tenant-2', 'at', 'rt', now()) $$,
  '23505', null, 'there is one connection, never two');

set local role service_role;
select is((select array_agg(x) from xero_claim_batch(now(), 1) x), array[(select id from iss where po = 'PO-1')],
  'connected and enabled: the job claims the lowest number first, up to its limit');
select is((select count(*)::int from xero_claim_batch(now(), 10) x where x = (select id from iss where po = 'PO-1')), 0,
  'and a claimed invoice is leased: not claimed twice');
select lives_ok(format($$ select xero_record_result(%L, false, null, null, null, 'Xero said no') $$, (select id from iss where po = 'PO-1')),
  'a failed push is recorded');
reset role;
select is((select row(status, attempts, last_error)::text from xero_sync where invoice_id = (select id from iss where po = 'PO-1')),
  row('failed', 1, 'Xero said no')::text, 'as failed, with the error and the attempt');
select set_config('request.jwt.claims', json_build_object('sub', :'sched_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(pg_temp.refusal(format($$ select xero_retry(%L) $$, (select id from iss where po = 'PO-1'))),
  '42501:not_permitted', 'a scheduler cannot retry a push');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(format($$ select xero_retry(%L) $$, (select id from iss where po = 'PO-1')), 'a finance owner retries it');
select is(pg_temp.refusal(format($$ select xero_retry(%L) $$, (select id from iss where po = 'PO-3'))),
  'P0001:xero_nothing_to_retry', 'but there is nothing to retry on a skipped invoice');
reset role;
select is((select row(status, attempts)::text from xero_sync where invoice_id = (select id from iss where po = 'PO-1')),
  row('pending', 0)::text, 'back to pending with its attempts reset');
set local role service_role;
select is((select count(*)::int from xero_claim_batch(now(), 1) x where x = (select id from iss where po = 'PO-1')), 1, 'it is claimed again');
select lives_ok(format($$ select xero_record_result(%L, true, 'XID-1', 'DRAFT', 400.00, null) $$, (select id from iss where po = 'PO-1')),
  'Xero answers with a total a penny-or-more different from ours');
reset role;
select is((select row(status, xero_invoice_id, xero_status, xero_total, last_error)::text from xero_sync
            where invoice_id = (select id from iss where po = 'PO-1')),
  row('mismatch', 'XID-1', 'DRAFT', 400.00::numeric, 'Xero total 400.00 differs from ours 406.97.')::text,
  'it is marked mismatch for the office, not silently accepted');
select ok((select synced_at is not null from xero_sync where invoice_id = (select id from iss where po = 'PO-1')),
  'with the time it reached Xero');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(format($$ select xero_retry(%L) $$, (select id from iss where po = 'PO-1')), 'a mismatch can be retried');
reset role;
set local role service_role;
select is((select count(*)::int from xero_claim_batch(now(), 1) x where x = (select id from iss where po = 'PO-1')), 1, 'claimed');
select lives_ok(format($$ select xero_record_result(%L, true, 'XID-1', 'DRAFT', 406.97, null) $$, (select id from iss where po = 'PO-1')),
  'and this time the totals agree');
reset role;
select is((select row(status, last_error)::text from xero_sync where invoice_id = (select id from iss where po = 'PO-1')),
  row('synced', null)::text, 'synced, no error');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(pg_temp.refusal(format($$ select xero_retry(%L) $$, (select id from iss where po = 'PO-1'))),
  'P0001:xero_nothing_to_retry', 'a synced invoice has nothing to retry');
select is((select xero_status() ->> 'tenantName'), 'THC Ltd', 'xero_status tells /settings which organisation');
select is((select xero_status() -> 'connected'), 'true'::jsonb, 'that it is connected');
select is((select xero_status() -> 'open'), '1'::jsonb, 'and how many invoices are still to reach Xero (PO-2 is pending)');
select ok(not (xero_status() ? 'access_token') and not (xero_status() ? 'refresh_token'), 'and never a token');
select is(pg_temp.refusal($$ select count(*) from xero_connection $$), '42501:permission denied for table xero_connection',
  'a signed-in caller cannot read the connection table at all');
reset role;
set local role anon;
select throws_ok($$ select count(*) from timesheet_jobs $$, '42501', null, 'anon cannot read a job');
select throws_ok($$ select xero_status() $$, '42501', null, 'nor ask for the Xero status');
reset role;

-- =====================================================================
-- I · Void: the number is retired, the rows are released
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(pg_temp.refusal(format($$ select invoice_void(%L, '   ') $$, (select id from iss where po = 'PO-2'))),
  '22023:void_reason_required', 'void: a reason is required');
select is(pg_temp.refusal($$ select invoice_void('93900000-0000-4000-8000-0000000000ff', 'x') $$),
  'P0002:invoice_not_found', 'void: an unknown invoice');
select lives_ok(format($$ select invoice_void(%L, 'Wrong PO') $$, (select id from iss where po = 'PO-2')), 'void: PO-2 (generated)');
reset role;
select is((select row(status, void_reason, voided_at is not null, number)::text from invoices where id = (select id from iss where po = 'PO-2')),
  row('void', 'Wrong PO', true, (select number from iss where po = 'PO-2'))::text, 'the invoice is void with its reason and keeps its number');
select is((select row(invoice_id is null, status)::text from timesheet_shifts where id = :'s_gil'), row(true, 'approved')::text,
  'its row is released, still approved');
select is((select status from timesheet_jobs where id = :'j1'), 'reviewing', 'the job is back in review');
select is((select row(status, last_error)::text from xero_sync where invoice_id = (select id from iss where po = 'PO-2')),
  row('skipped', null)::text, 'a void that never reached Xero is skipped there');
select is((select count(*)::int from audit_log where action = 'invoice.voided' and entity_id = (select id from iss where po = 'PO-2')), 1, 'void is audited');
select is((select count(*)::int from timesheet_po_duplicates(:'tsclient', array['PO-2'])), 0, 'a voided invoice''s PO is not a duplicate');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(pg_temp.refusal(format($$ select invoice_void(%L, 'again') $$, (select id from iss where po = 'PO-2'))),
  'P0001:invoice_not_voidable', 'a void invoice cannot be voided again');
select is(pg_temp.refusal(format($$ select queue_timesheet_invoice_email(%L, array['a@b.co'], '{}', '{}', 'S', 'B', null, '[]') $$,
              (select id from iss where po = 'PO-2'))),
  'P0001:invoice_not_sendable', 'nor sent');
select lives_ok(format($$ select invoice_void(%L, 'Customer cancelled') $$, (select id from iss where po = 'PO-1')), 'void: PO-1 (queued, and already in Xero)');
reset role;
select is((select row(status, last_error)::text from xero_sync where invoice_id = (select id from iss where po = 'PO-1')),
  row('synced', 'Void this invoice in Xero too.')::text, 'a void that reached Xero says so: the office voids it there too');
select is((select count(*)::int from timesheet_shifts where invoice_id = (select id from iss where po = 'PO-1')), 0, 'its four rows are released');
select throws_ok(format($$ update invoices set status = 'queued' where id = %L $$, (select id from iss where po = 'PO-1')),
  'P0001', 'illegal_invoice_transition', 'void is terminal');
select throws_ok(format($$ update invoices set net = net + 1 where id = %L $$, (select id from iss where po = 'PO-1')),
  'P0001', 'invoice_issued', 'and a void invoice''s money never changes either');

-- the number is never reused: the freed row is confirmed and issued again
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$ select timesheet_job_confirm('93900000-0000-4000-8000-00000000a001', jsonb_build_array(
    jsonb_build_object('poNumber', 'PO-2b', 'invoiceDate', '2026-10-31',
      'shiftIds', jsonb_build_array('93900000-0000-4000-8000-000000000105')))) $$,
  'a voided invoice''s row goes back through Confirm');
insert into iss (po, id, number)
  select 'PO-2b', (r ->> 'id')::uuid, (r ->> 'number')::int
    from (select issue_timesheet_invoice(:'j1', (select confirmed_groups -> 0 from timesheet_jobs where id = :'j1')) r) x;
select is((select number from iss where po = 'PO-2b'), (select n + 3 from ctr), 'and takes the next number');
select isnt((select number from iss where po = 'PO-2b'), (select number from iss where po = 'PO-2'), 'never the voided one');
select is((select count(*)::int from invoices where number = (select number from iss where po = 'PO-2')), 1, 'which stays on the books as void');
select is((select status from timesheet_jobs where id = :'j1'), 'confirmed',
  'the job is confirmed again: PO-1''s four released rows are approved and not yet invoiced');
reset role;

-- =====================================================================
-- J · The document, and the event invoices' job
-- =====================================================================
set local role service_role;
select is((select invoice_document_data((select id from iss where po = 'PO-3')) ->> 'source'), 'timesheet', 'the document says it is a timesheet invoice');
select is((select jsonb_array_length(invoice_document_data((select id from iss where po = 'PO-1')) -> 'lines')), 4, 'and carries its lines');
select is((select sum((l ->> 'hours')::numeric) from jsonb_array_elements(invoice_document_data((select id from iss where po = 'PO-1')) -> 'lines') l),
  17.55::numeric, 'with their hours (7.00 + 4.05 + 6.50), staff count and quantity');
select ok((select bool_and(l ? 'checkInAt' and l ? 'checkOutAt' and l ? 'late' and l ? 'leftEarly' and l ? 'bookingId' and l ? 'eventId')
             from jsonb_array_elements(invoice_document_data((select id from iss where po = 'PO-1')) -> 'lines') l),
  'and every field the event invoices'' sign-in log reads (20261022110000, 20261022200000)');
reset role;

-- an event invoice that is drawing, beside the timesheet one that is drawing (PO-2b)
update settings set value = value || '{"enabled": true}'::jsonb where key = 'invoicing';
insert into invoices (number, client_id, group_key, invoice_date, due_date, period_from, period_to, payable_min,
                      net, vat_rate, vat, total, terms_days, bill_to, seller, recipients, status)
  select max(number) + 1, :'clienta', 'ev:939', date '2026-10-30', date '2026-11-06', date '2026-10-30', date '2026-10-30',
         0, 0, 20, 0, 0, 7, '{}', '{}', array['e@e.test'], 'drawing'
    from invoices;
set local role service_role;
select is((select count(*)::int from invoices_unfinished(now() + interval '1 hour', 50) x
            where x = (select id from invoices where group_key = 'ev:939')), 1,
  'the event invoices'' job picks up an event invoice that is still drawing');
select is((select count(*)::int from invoices_unfinished(now() + interval '2 hours', 50) x
            where x in (select id from invoices where source = 'timesheet')), 0,
  'but never a timesheet invoice (ADR-0210: the office draws those on Generate)');
reset role;

select * from finish();
rollback;
