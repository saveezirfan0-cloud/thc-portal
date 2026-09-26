-- =====================================================================
-- 750 · The viewer office role reads and writes nothing
--       (20260930220000, 20260930220100, ADR-0054)
--
--   * office_can() for the viewer (finance yes; users, settings, write no)
--     and 'write' for the other three roles;
--   * EVERY public table carries the office_read_only statement trigger,
--     with an explicit allow-list (profiles) — a new table that forgets it
--     fails here, not in production;
--   * a viewer reads the office's rows, money included;
--   * a viewer's write is refused on every path: PostgREST insert / update
--     / delete / truncate, a zero-row statement, a security definer RPC,
--     settings and money tables, and the service-key RPCs that name the
--     viewer as p_actor (auth.uid() null);
--   * what a viewer may still do: update_my_profile (/account);
--   * nobody else is touched: owner, manager, scheduler, a worker, a job.
-- =====================================================================
begin;
select plan(40);
\ir _shared/fixtures.psql

\set viewer    '75000000-0000-4000-8000-000000000001'
\set manager   '75000000-0000-4000-8000-000000000002'
\set scheduler '75000000-0000-4000-8000-000000000003'

insert into auth.users (id, email) values
  (:'viewer',    'viewer@rls.test'),
  (:'manager',   'manager.750@rls.test'),
  (:'scheduler', 'scheduler.750@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'viewer',    'admin', 'viewer',    'Vera Viewer'),
  (:'manager',   'admin', 'manager',   'Mona Manager'),
  (:'scheduler', 'admin', 'scheduler', 'Sam Scheduler');

-- ---------------------------------------------------------------------
-- 1 · Shape
-- ---------------------------------------------------------------------
select enum_has_labels('public', 'office_role', array['owner', 'manager', 'scheduler', 'viewer'],
  'office_role has viewer, appended after the three ADR-0050 roles');

-- The future-proofing: every table in public (extension tables aside) has
-- the guard, before insert / update / delete / truncate, per STATEMENT —
-- except the allow-list. audit_log's INSERT is its own trigger (below).
-- A new table fails this until it gets the trigger (copy 20260930220100's
-- loop body) or is argued onto the allow-list in ADR-0054.
select is_empty(
  $$ select c.relname::text
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and not exists (select 1 from pg_depend d
                         where d.classid = 'pg_class'::regclass
                           and d.objid = c.oid and d.deptype = 'e')
        and c.relname not in ('profiles')  -- ALLOW-LIST (ADR-0054)
        and not exists (
              select 1 from pg_trigger t
               where t.tgrelid = c.oid
                 and t.tgname = 'office_read_only'
                 and t.tgfoid = 'public.office_read_only_guard()'::regprocedure
                 and t.tgenabled = 'O'
                 and (t.tgtype & 1) = 0          -- per statement
                 and (t.tgtype & 2) = 2          -- before
                 and (t.tgtype & 56) = 56        -- delete, update, truncate
                 and ((t.tgtype & 4) = 4 or c.relname = 'audit_log')) $$,  -- insert
  'ADR-0054: every public table carries the office_read_only statement trigger (allow-list: profiles)');

select is_empty(
  $$ select tgname::text from pg_trigger
      where tgrelid = 'public.profiles'::regclass and tgname = 'office_read_only' $$,
  'the allow-list is not stale: profiles really has no guard (update_my_profile writes it)');

select ok(exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.audit_log'::regclass
       and t.tgname = 'audit_log_office_read_only'
       and t.tgfoid = 'public.office_read_only_audit_guard()'::regprocedure
       and t.tgenabled = 'O'
       and (t.tgtype & 1) = 0 and (t.tgtype & 2) = 0 and (t.tgtype & 4) = 4),
  'audit_log carries the actor guard: after insert, per statement, over a transition table');

select ok(not has_function_privilege('authenticated', 'office_read_only_guard()', 'execute')
      and not has_function_privilege('authenticated', 'office_read_only_audit_guard()', 'execute')
      and not has_function_privilege('authenticated', 'assert_not_read_only()', 'execute')
      and not has_function_privilege('anon', 'assert_not_read_only()', 'execute'),
  'the guard functions are not RPCs');

-- ---------------------------------------------------------------------
-- 2 · office_can(), per role
-- ---------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"75000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(array[office_can('users'), office_can('settings'), office_can('finance'), office_can('write')],
  array[false, false, true, false],
  'viewer: finance yes (reads money); users, settings and write no');
set local "request.jwt.claims" = '{"sub":"75000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(array[office_can('finance'), office_can('write')], array[false, true],
  'scheduler: write yes, finance still no');
set local "request.jwt.claims" = '{"sub":"75000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(array[office_can('users'), office_can('finance'), office_can('write')], array[false, true, true],
  'manager: finance and write');
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(array[office_can('users'), office_can('settings'), office_can('finance'), office_can('write')],
  array[true, true, true, true], 'owner: all four');
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select is(office_can('write'), false, 'a worker: no office write');

-- ---------------------------------------------------------------------
-- 3 · A viewer reads what a manager reads
-- ---------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"75000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::int from events where id in (:'event_a', :'event_b')), 2,
  'a viewer reads events');
select is((select count(*)::int from shift_requirements where id = :'shift_a' and pay_rate = 14.00), 1,
  'and role sections with their rates');
select is((select count(*)::int from bank_details where staff_id in (:'staffa', :'staffb')), 2,
  'and money-only tables (bank details): a viewer has finance');
select is((select count(*)::int from report_sends where error = 'rls_fixture_probe'), 1,
  'and the finance send log (report_sends, finance-only since ADR-0050)');
select lives_ok($$ select * from finance_report(current_date - 7, current_date) $$,
  'and runs the finance report');
select is((select count(*)::int from notification_outbox where key = 'RLS:fixture:outbox'), 1,
  'and the outbox (the Inbox)');
select is((select count(*)::int from audit_log where action = 'rls_fixture_probe'), 1,
  'and the activity log');

-- ---------------------------------------------------------------------
-- 4 · … and writes nothing, by any path
-- ---------------------------------------------------------------------
select throws_ok(format($$ update events set title = 'Viewer was here' where id = %L $$, :'event_a'),
  '42501', 'read_only', 'PostgREST UPDATE is refused (admin_all would have allowed it)');
select throws_ok($$ insert into clients (name, contact_name, phone, staff_contact_point, contact_emails)
                    values ('Viewer Co', 'V', '+447700900999', 'Desk', array['v@rls.test']) $$,
  '42501', 'read_only', 'PostgREST INSERT is refused');
select throws_ok(format($$ delete from feedback where id = %L $$, :'feedback_a'),
  '42501', 'read_only', 'PostgREST DELETE is refused');
select throws_ok($$ update events set title = title where false $$,
  '42501', 'read_only', 'a statement matching no rows is refused too: the guard is per statement');
select throws_ok($$ truncate location_pings $$,
  '42501', 'read_only', 'TRUNCATE is refused (RLS does not see it; the trigger does)');
select throws_ok($$ update settings set value = '{"x":1}' where key = 'rls_fixture_probe' $$,
  '42501', null, 'settings stay closed');
select throws_ok(format($$ update bank_details set account_holder = 'X' where staff_id = %L $$, :'staffa'),
  '42501', 'read_only', 'money tables: reading is not writing');
select throws_ok(format($$ update roles set pay_rate = 99 where id = %L $$, :'role_id'),
  '42501', 'read_only', 'the rate catalogue: office_can(''finance'') is true, the trigger still refuses');
select throws_ok(
  $$ select queue_office_notifications(jsonb_build_array(jsonb_build_object(
       'key', 'N12:viewer', 'channel', 'push', 'template', 'N12',
       'recipient_staff_id', 'dddddddd-0000-4000-8000-000000000001'))) $$,
  '42501', 'read_only', 'a security definer RPC is refused: the trigger fires inside it, past RLS');
select throws_ok(format($$ select add_staff_role(%L, %L) $$, :'staffb', :'role_id'),
  '42501', 'read_only', 'an invoker RPC is refused');
select throws_ok(format($$ select onboarding_resend_activation_check(%L) $$, :'staffa'),
  '42501', 'read_only',
  'Resend activation is refused BEFORE the service key mints a token that would kill the candidate''s link');

-- What a viewer may still do: their own name, on /account.
select lives_ok($$ select update_my_profile('Vera V. Viewer', null, 'Auditor') $$,
  'update_my_profile still works for a viewer (profiles is the allow-list)');
reset role;
select is((select full_name from profiles where id = :'viewer'), 'Vera V. Viewer', 'and the name changed');
select is((select count(*)::int from audit_log where actor = :'viewer' and action = 'profile.updated'), 1,
  'with its audit row, the one audit action a viewer may write');

-- ---------------------------------------------------------------------
-- 5 · The service-key paths: auth.uid() is null, the viewer is p_actor
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
set local role service_role;
select throws_ok(format($$ select block_worker_manually(%L, 'viewer tried', now(), %L) $$, :'staffb', :'viewer'),
  '42501', 'read_only',
  'Block on the service key with the viewer as p_actor is refused (the audit row names them)');
reset role;
select is((select status::text from staff where id = :'staffb'), 'compliant',
  'and nothing of it happened: the worker is not blocked');
select throws_ok(format($$ insert into audit_log (actor, action, entity, entity_id) values (%L, 'block_manual', 'staff', %L) $$,
                        :'viewer', :'staffb'),
  '42501', 'read_only', 'any audit row naming a viewer as actor is refused, whoever writes it');

-- ---------------------------------------------------------------------
-- 6 · Nobody else is touched
-- ---------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"75000000-0000-4000-8000-000000000003","role":"authenticated"}';
select lives_ok(format($$ update events set title = 'Scheduler edit' where id = %L $$, :'event_a'),
  'a scheduler still edits an event');
set local "request.jwt.claims" = '{"sub":"75000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok(format($$ update roles set pay_rate = 14.50 where id = %L $$, :'role_id'),
  'a manager still re-prices a role');
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select lives_ok(format($$ update push_subscriptions set auth = 'auth-a2' where id = %L $$, :'push_a'),
  'a worker still writes their own rows');
reset role;
select set_config('request.jwt.claims', '', true);
select lives_ok(format($$ insert into audit_log (actor, action, entity, entity_id) values (null, 'job_probe', 'staff', %L) $$, :'staffa'),
  'a job (no session, no actor) writes as before');
set local role service_role;
select lives_ok(format($$ select block_worker_manually(%L, 'owner blocks', now(), %L) $$,
                       :'staffb', '11111111-1111-1111-1111-111111111111'),
  'and the service-key Block with an owner as p_actor still works');
reset role;

-- A viewer promoted back to manager writes again on the next statement.
update profiles set office_role = 'manager' where id = :'viewer';
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"75000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(format($$ update events set title = 'Promoted' where id = %L $$, :'event_b'),
  'the role is read live: a former viewer made manager writes at once');
reset role;

select * from finish();
rollback;
