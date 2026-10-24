-- =====================================================================
-- 940 · Claude's ticket classification and time (ADR-0202) —
--       20261027120000_claude_ticket_tracking.sql
--
--   · neither function is callable by an API role, only by the service role;
--   · a label is set by ticket number, from the list only, with a short note;
--   · a label a person set is never overwritten; Claude's own can be revised;
--   · time is finished minutes, worked by claude, logged by nobody, billable
--     following the label (against scope and addition are billed).
-- =====================================================================
begin;
select plan(17);
\ir _shared/fixtures.psql

\set manager '93900000-0000-4000-8000-000000000002'
insert into auth.users (id, email) values (:'manager', 'manager.939@rls.test');
insert into profiles (id, role, office_role, full_name) values (:'manager', 'admin', 'manager', 'Mona Manager');

select ok(not has_function_privilege('authenticated', 'claude_set_ticket_scope(integer,text,text)', 'execute')
      and not has_function_privilege('anon', 'claude_set_ticket_scope(integer,text,text)', 'execute')
      and not has_function_privilege('authenticated', 'claude_log_ticket_time(integer,integer,text,boolean,date)', 'execute')
      and not has_function_privilege('anon', 'claude_log_ticket_time(integer,integer,text,boolean,date)', 'execute'),
  'no API role calls either function');
select ok(has_function_privilege('service_role', 'claude_set_ticket_scope(integer,text,text)', 'execute')
      and has_function_privilege('service_role', 'claude_log_ticket_time(integer,integer,text,boolean,date)', 'execute'),
  'the service role does');

-- A ticket from a manager.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
create temporary table made (r jsonb);
grant all on made to authenticated;
insert into made select create_ticket('bug', 'medium', 'Something is broken');
reset role;
create temporary table tk as select ticket_no::int as no, id from tickets where title = 'Something is broken';

select throws_ok($$ select claude_set_ticket_scope(999999, 'fix') $$, 'P0002', 'unknown_ticket', 'an unknown ticket is refused');
select throws_ok(format($$ select claude_set_ticket_scope(%s, 'huge') $$, (select no from tk)), '22023', null,
  'a label off the list is refused');
select throws_ok(format($$ select claude_set_ticket_scope(%s, null) $$, (select no from tk)), '22023', null,
  'and so is no label');

select is(claude_set_ticket_scope((select no from tk), 'fix', 'Regression in the last release') ->> 'label', 'fix',
  'Claude labels a ticket by its number');
select is((select label || '|' || note from ticket_scope where ticket_id = (select id from tk)),
  'fix|Regression in the last release', 'the label and its note are stored');
select is((select updated_by from ticket_scope where ticket_id = (select id from tk)), null,
  'and say nobody signed in set it');
select is(claude_set_ticket_scope((select no from tk), 'update', 'On second thought') ->> 'label', 'update',
  'Claude can revise its own label');

-- A person's label stands.
update ticket_scope set updated_by = :'manager' where ticket_id = (select id from tk);
update ticket_scope set label = 'addition' where ticket_id = (select id from tk);
select is(claude_set_ticket_scope((select no from tk), 'issue') ->> 'kept', 'true',
  'a label a person set is kept');
select is((select label from ticket_scope where ticket_id = (select id from tk)), 'addition',
  'and not overwritten');

-- Time.
select throws_ok(format($$ select claude_log_ticket_time(%s, 0) $$, (select no from tk)), '22023', null, 'no time is refused');
select throws_ok(format($$ select claude_log_ticket_time(%s, 10, null, null, current_date + 3) $$, (select no from tk)), '22023', null,
  'time on a future day is refused');
select is(claude_log_ticket_time((select no from tk), 25, 'Fixed it') ->> 'billable', 'true',
  'time on an addition is billable by default');
select is((select worked_by || '|' || minutes || '|' || coalesce(logged_by::text, 'nobody') from ticket_time
            where ticket_id = (select id from tk)),
  'claude|25|nobody', 'worked by claude, logged by nobody');
update ticket_scope set label = 'fix' where ticket_id = (select id from tk);
select is(claude_log_ticket_time((select no from tk), 5) ->> 'billable', 'false', 'and not billable on a fix');
select is(claude_log_ticket_time((select no from tk), 5, null, true) ->> 'billable', 'true', 'unless it says so');

select * from finish();
rollback;
