-- =====================================================================
-- 930 · Tickets (ADR-0198) — 20261024120000_tickets.sql
--
--   · who can read them (any Back Office login, a viewer too; nobody else)
--     and that no API role can write a table directly;
--   · create_ticket(): numbered TK-<n>, validated, rate-limited, open to a
--     viewer, and queues TK1 to settings.ticket_recipients — never to an
--     address the caller names;
--   · add_ticket_comment() open to a viewer; update_ticket() is not;
--   · every status / severity change is a line on the thread, resolved_at
--     follows Resolved / Closed and clears on a reopen;
--   · a worker and a client reach none of it.
-- =====================================================================
begin;
select plan(33);
\ir _shared/fixtures.psql

\set viewer  '93000000-0000-4000-8000-000000000001'
\set manager '93000000-0000-4000-8000-000000000002'

insert into auth.users (id, email) values
  (:'viewer',  'viewer.930@rls.test'),
  (:'manager', 'manager.930@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'viewer',  'admin', 'viewer',  'Vera Viewer'),
  (:'manager', 'admin', 'manager', 'Mona Manager');

-- ---------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------
select has_table('public', 'tickets', 'tickets exist');
select has_table('public', 'ticket_comments', 'ticket_comments exist');
select ok(not has_table_privilege('authenticated', 'tickets', 'insert')
      and not has_table_privilege('authenticated', 'tickets', 'update')
      and not has_table_privilege('authenticated', 'tickets', 'delete')
      and not has_table_privilege('authenticated', 'ticket_comments', 'insert')
      and not has_table_privilege('authenticated', 'ticket_comments', 'update')
      and not has_table_privilege('authenticated', 'ticket_comments', 'delete'),
  'no API role can write either table directly: every write is an RPC');
select ok(not has_table_privilege('anon', 'tickets', 'select')
      and not has_table_privilege('anon', 'ticket_comments', 'select'),
  'anon reads nothing');
select ok(not has_function_privilege('anon', 'create_ticket(text,text,text,text,text,text)', 'execute')
      and not has_function_privilege('anon', 'add_ticket_comment(uuid,text)', 'execute')
      and not has_function_privilege('anon', 'update_ticket(uuid,text,text,text)', 'execute'),
  'anon calls none of the three RPCs');
select ok(not has_function_privilege('authenticated', 'ticket_recipient_emails()', 'execute'),
  'the recipient lookup is internal');
select is((select value from settings where key = 'ticket_recipients'),
  '["saveezirfan@gmail.com"]'::jsonb, 'tickets are emailed to the product owner by default');

-- ---------------------------------------------------------------------
-- A manager reports
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);

create temporary table made (r jsonb);
grant all on made to authenticated;
insert into made select create_ticket('bug', 'high', '  Card vanishes after a drag  ',
  'Dragged an event on Scheduling and it disappeared.', '/events', 'https://www.loom.com/share/abc');

select is((select r ->> 'ref' from made), 'TK-' || (select ticket_no from tickets where id = (select (r ->> 'id')::uuid from made)),
  'the ticket comes back with its TK- reference');
select is((select title from tickets where id = (select (r ->> 'id')::uuid from made)),
  'Card vanishes after a drag', 'the summary is trimmed');
select is((select reporter_name from tickets where id = (select (r ->> 'id')::uuid from made)),
  'Mona Manager', 'the reporter is the signed-in login, by name');
select is((select status from tickets where id = (select (r ->> 'id')::uuid from made)),
  'new', 'it starts New');

select throws_ok($$ select create_ticket('bug', null, 'ab') $$, '22023', null, 'a summary under 3 characters is refused');
select throws_ok($$ select create_ticket('rant', null, 'A fine summary') $$, '22023', null, 'a kind off the list is refused');
select throws_ok($$ select create_ticket('bug', 'meh', 'A fine summary') $$, '22023', null, 'a severity off the list is refused');
select throws_ok($$ select create_ticket('bug', null, 'A fine summary', null, null, 'javascript:alert(1)') $$,
  '22023', null, 'a link that is not http(s) is refused');
select throws_ok($$ insert into tickets (title, reporter_name) values ('direct', 'x') $$,
  '42501', null, 'a direct insert is refused');

-- The email: one TK1 row, to the setting's address, whatever the caller does.
reset role;
select is((select count(*)::int from notification_outbox
            where key = 'TK1:ticket:' || (select r ->> 'id' from made)), 1, 'one TK1 email is queued for the ticket');
select is((select recipient_emails from notification_outbox
            where key = 'TK1:ticket:' || (select r ->> 'id' from made)),
  array['saveezirfan@gmail.com'], 'it goes to settings.ticket_recipients');
select is((select payload ->> 'ref' from notification_outbox
            where key = 'TK1:ticket:' || (select r ->> 'id' from made)),
  (select r ->> 'ref' from made), 'and names the ticket');

-- ---------------------------------------------------------------------
-- A viewer reports and comments, but changes nothing
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);

select lives_ok($$ select create_ticket('request', null, 'I cannot see the Reports menu') $$,
  'a viewer can report');
select lives_ok(format($$ select add_ticket_comment(%L, 'Same for me.') $$, (select r ->> 'id' from made)),
  'and comment');
select throws_ok(format($$ select update_ticket(%L, 'closed') $$, (select r ->> 'id' from made)),
  '42501', 'read_only', 'but not change a status');
select is((select count(*)::int from tickets where reporter_name in ('Mona Manager', 'Vera Viewer')), 2,
  'a viewer reads every ticket');

-- ---------------------------------------------------------------------
-- A manager follows up
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);

select lives_ok(format($$ select update_ticket(%L, 'in_progress', 'critical', 'On it.') $$, (select r ->> 'id' from made)),
  'a manager changes status and severity with a note');
select is((select count(*)::int from ticket_comments
            where ticket_id = (select (r ->> 'id')::uuid from made) and kind = 'change'), 2,
  'each change is a line on the thread');
select is((select body from ticket_comments
            where ticket_id = (select (r ->> 'id')::uuid from made) and body like 'Status:%'),
  'Status: New → In progress', 'in plain words');

select lives_ok(format($$ select update_ticket(%L, 'resolved') $$, (select r ->> 'id' from made)), 'resolving works');
select isnt((select resolved_at from tickets where id = (select (r ->> 'id')::uuid from made)), null,
  'resolved_at is stamped');
select lives_ok(format($$ select update_ticket(%L, 'in_progress') $$, (select r ->> 'id' from made)), 'reopening works');
select is((select resolved_at from tickets where id = (select (r ->> 'id')::uuid from made)), null,
  'and clears resolved_at');

-- ---------------------------------------------------------------------
-- A worker and a client reach none of it
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select is((select count(*)::int from tickets), 0, 'a worker reads no ticket');
select throws_ok($$ select create_ticket('bug', null, 'A fine summary') $$, '42501', null, 'and cannot report');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select is((select count(*)::int from tickets) + (select count(*)::int from ticket_comments), 0,
  'a client reads no ticket or comment');

select * from finish();
rollback;
