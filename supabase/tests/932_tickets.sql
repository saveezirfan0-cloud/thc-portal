-- =====================================================================
-- 932 · Tickets (ADR-0202) — 20261025110000_tickets.sql
--
--   · who can read them (any Back Office login, a viewer too; nobody else)
--     and that no API role can write a table directly;
--   · create_ticket(): numbered TK-<n>, validated, rate-limited, and queues TK1 to settings.ticket_recipients — never to an
--     address the caller names;
--   · a viewer reads tickets and changes nothing: report, comment and
--     update are all refused read_only (ADR-0060);
--   · every status / severity change is a line on the thread, resolved_at
--     follows Resolved / Closed and clears on a reopen;
--   · a worker and a client reach none of it.
-- =====================================================================
begin;
select plan(92);
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
      and not has_function_privilege('anon', 'add_ticket_comment(uuid,text,text)', 'execute')
      and not has_function_privilege('anon', 'update_ticket(uuid,text,text,text,text)', 'execute'),
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
-- A viewer reads, but changes nothing (ADR-0060)
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);

select throws_ok($$ select create_ticket('request', null, 'I cannot see the Reports menu') $$,
  '42501', 'read_only', 'a viewer cannot report');
select throws_ok(format($$ select add_ticket_comment(%L, 'Same for me.') $$, (select r ->> 'id' from made)),
  '42501', 'read_only', 'or comment');
select throws_ok(format($$ select update_ticket(%L, 'closed') $$, (select r ->> 'id' from made)),
  '42501', 'read_only', 'or change a status');
select is((select count(*)::int from tickets where reporter_name = 'Mona Manager'), 1,
  'but reads every ticket');

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
-- The owner's own tracking (ADR-0202): label and time, nobody else's
-- ---------------------------------------------------------------------
create temporary table tk (id uuid);
grant all on tk to authenticated;
insert into tk select (r ->> 'id')::uuid from made;
create temporary table tk2 (id uuid);
grant all on tk2 to authenticated;

select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
select is(ticket_tracker_allowed(), false, 'a manager is not a tracker');
select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
select is(ticket_tracker_allowed(), false, 'nor a viewer');

reset role;
select is((select value from settings where key = 'ticket_tracking_emails'),
  '["sam@thehospitalitycompany.co.uk","saveezirfan@gmail.com"]'::jsonb,
  'the migration names Sam and Saveez as the logins that keep the time');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
update settings set value = '[]'::jsonb where key = 'ticket_tracking_emails';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select is(ticket_tracker_allowed(), false, 'with nobody named, even an owner is not a tracker');
reset role;
update settings set value = '["gisela@rls.test"]'::jsonb where key = 'ticket_tracking_emails';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select is(ticket_tracker_allowed(), true, 'an owner on the list is');

select lives_ok(format($$ select set_ticket_scope(%L, 'addition', 'Not in the original scope') $$, (select id from tk)),
  'the owner labels a ticket after it is raised');
select is((select label from ticket_scope where ticket_id = (select id from tk)), 'addition', 'and the label is stored');
select throws_ok(format($$ select set_ticket_scope(%L, 'huge') $$, (select id from tk)),
  '22023', null, 'a label off the list is refused');

-- The reporter is told when somebody else comments, never about their own.
select lives_ok(format($$ select add_ticket_comment(%L, 'Which page was it on?') $$, (select id from tk)),
  'the owner replies on the manager''s ticket');
reset role;
select is((select recipient_emails from notification_outbox
            where template = 'TK1' and payload ->> 'variant' = 'reply' and payload ->> 'comment' = 'Which page was it on?'),
  array['manager.930@rls.test'], 'and the reporter is emailed at their own sign-in address');
select is((select payload ->> 'author' from notification_outbox
            where template = 'TK1' and payload ->> 'variant' = 'reply' and payload ->> 'comment' = 'Which page was it on?'),
  'Gisela M.', 'naming who wrote it');
select is((select count(*)::int from notification_outbox
            where template = 'TK1' and payload ->> 'variant' = 'reply'
              and payload ->> 'ref' = (select r ->> 'ref' from made) and payload ->> 'comment' = 'On it.'), 0,
  'the reporter is not emailed about their own note');
select is((select count(*)::int from notification_outbox
            where template = 'TK1' and payload ->> 'variant' = 'reply'
              and payload ->> 'ref' = (select r ->> 'ref' from made)), 1,
  'nor about the status and severity lines: one reply email so far');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);

-- A manager sees and does none of it.
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
select is((select count(*)::int from ticket_scope) + (select count(*)::int from ticket_time), 0,
  'a manager reads no label and no time');
select throws_ok(format($$ select set_ticket_scope(%L, 'fix') $$, (select id from tk)),
  '42501', 'not_permitted', 'and cannot label');
select throws_ok(format($$ select start_ticket_timer(%L) $$, (select id from tk)),
  '42501', 'not_permitted', 'or start a timer');
select is((select count(*)::int from ticket_comments
            where ticket_id = (select id from tk) and (body ilike '%addition%' or body ilike '%scope%')), 0,
  'the thread everyone reads never mentions the label');

-- The timer.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
-- a second, still-New ticket, so we see the status move
insert into tk2 select (create_ticket('request', null, 'Add an export button') ->> 'id')::uuid;

select lives_ok(format($$ select start_ticket_timer(%L, 'claude') $$, (select id from tk2)), 'the owner starts a timer, worked by claude');
select is((select status from tickets where id = (select id from tk2)), 'in_progress',
  'starting it moves a New ticket to In progress');
select throws_ok(format($$ select start_ticket_timer(%L) $$, (select id from tk)),
  'P0001', 'timer_running', 'only one timer runs at a time');
select lives_ok($$ select stop_ticket_timer('looked at it') $$, 'stopping it logs the time');
select ok((select minutes >= 1 and ended_at is not null and worked_by = 'claude' and note = 'looked at it'
             from ticket_time where ticket_id = (select id from tk2)),
  'at least a minute, an end time, who worked, and the note');
select throws_ok($$ select stop_ticket_timer() $$, 'P0002', 'no_timer', 'stopping with none running says so');

-- Billable follows the label: this one is an Addition.
select lives_ok(format($$ select start_ticket_timer(%L, 'owner') $$, (select id from tk)), 'a timer on the labelled ticket');
select is((select billable from ticket_time where ticket_id = (select id from tk) and ended_at is null), true,
  'is billable by default, because an addition is');
-- Resolving the ticket stops the owner's own timer and logs it.
select lives_ok(format($$ select update_ticket(%L, 'resolved') $$, (select id from tk)), 'the owner resolves it');
select ok((select ended_at is not null and minutes >= 1 from ticket_time
            where ticket_id = (select id from tk) and started_at is not null),
  'which stopped the running timer');

-- Manual entries: the 5, 10, 15 minutes after an email.
create temporary table entry (id bigint);
grant all on entry to authenticated;
insert into entry select (log_ticket_time((select id from tk), 15, 'claude', null, 'after the email') ->> 'id')::bigint;
select is((select minutes from ticket_time where id = (select id from entry)), 15, 'a manual entry is stored');
select throws_ok(format($$ select log_ticket_time(%L, 0) $$, (select id from tk)), '22023', null, 'zero minutes is refused');
select throws_ok(format($$ select log_ticket_time(%L, 10, 'owner', current_date + 2) $$, (select id from tk)),
  '22023', null, 'and so is a date in the future');
select lives_ok(format($$ select update_ticket_time(%s, 20, 'owner', current_date, 'corrected', false) $$, (select id from entry)),
  'an entry can be corrected');
select is((select minutes || ':' || worked_by || ':' || billable from ticket_time where id = (select id from entry)),
  '20:owner:false', 'minutes, who and billable follow the correction');
select lives_ok(format($$ select delete_ticket_time(%s) $$, (select id from entry)), 'or removed');

-- Who may track can be narrowed to named logins (sign-in email).
reset role;
update settings set value = '["somebody.else@rls.test"]'::jsonb where key = 'ticket_tracking_emails';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select is(ticket_tracker_allowed(), false, 'with a list that names somebody else, the owner is not a tracker');
reset role;
update settings set value = '["GISELA@rls.test"]'::jsonb where key = 'ticket_tracking_emails';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select is(ticket_tracker_allowed(), true, 'and is again when the list names them (any case)');

-- ---------------------------------------------------------------------
-- Triage: category, owner, resolution note, activity types, delete
-- ---------------------------------------------------------------------
create temporary table tk3 (id uuid);
grant all on tk3 to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
insert into tk3 select (create_ticket('bug', 'low', 'Triage target') ->> 'id')::uuid;

select lives_ok(format($$ select set_ticket_kind(%L, 'idea') $$, (select id from tk3)), 'a manager re-files a ticket');
select is((select kind from tickets where id = (select id from tk3)), 'idea', 'its category changes');
select ok(exists (select 1 from ticket_comments where ticket_id = (select id from tk3) and body = 'Category: Bug → Idea'),
  'and the thread says so');
select throws_ok(format($$ select set_ticket_kind(%L, 'rant') $$, (select id from tk3)), '22023', null, 'a category off the list is refused');

select ok(exists (select 1 from ticket_assignees() where full_name = 'Mona Manager'), 'the owner picker lists the office logins');
select lives_ok(format($$ select assign_ticket(%L, %L) $$, (select id from tk3), :'admin_uid'), 'a ticket is given an owner');
select is((select assignee_name from tickets where id = (select id from tk3)), 'Gisela M.', 'by name');
select ok(exists (select 1 from ticket_comments where ticket_id = (select id from tk3) and body = 'Owner: Unassigned → Gisela M.'),
  'with a line on the thread');
select throws_ok(format($$ select assign_ticket(%L, %L) $$, (select id from tk3), :'clienta_uid'),
  '22023', null, 'but never to a client login');
select lives_ok(format($$ select assign_ticket(%L, null) $$, (select id from tk3)), 'and taken off again');
select is((select assignee_id from tickets where id = (select id from tk3)), null, 'leaving it unassigned');

select lives_ok(format($$ select update_ticket(%L, 'in_progress', 'none') $$, (select id from tk3)),
  'severity can be cleared');
select is((select severity from tickets where id = (select id from tk3)), null, 'back to not set');

select throws_ok(format($$ select update_ticket(%L, null, null, null, 'All done') $$, (select id from tk3)),
  '22023', null, 'a resolution note only goes with Resolved or Closed');
select lives_ok(format($$ select update_ticket(%L, 'resolved', null, null, 'Fixed in the next release.') $$, (select id from tk3)),
  'closing a ticket with a resolution note');
select is((select resolution from tickets where id = (select id from tk3)), 'Fixed in the next release.', 'keeps the note');

reset role;
select is((select recipient_emails from notification_outbox
            where template = 'TK1' and payload ->> 'variant' = 'resolved'
              and payload ->> 'ref' = (select 'TK-' || ticket_no from tickets where id = (select id from tk3))),
  array['manager.930@rls.test'], 'and it is emailed to the reporter''s own sign-in address, not the owner list');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);

select lives_ok(format($$ select add_ticket_comment(%L, 'Rang them back', 'call') $$, (select id from tk3)), 'an update can be a call');
select is((select activity from ticket_comments where ticket_id = (select id from tk3) and body = 'Rang them back'),
  'call', 'and is stored as one');
select throws_ok(format($$ select add_ticket_comment(%L, 'x', 'fax') $$, (select id from tk3)), '22023', null,
  'an activity type off the list is refused');

select throws_ok(format($$ select delete_ticket(%L) $$, (select id from tk3)), '42501', 'not_permitted',
  'a manager cannot delete a report');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select throws_ok(format($$ select delete_ticket(%L) $$, (select id from tk)), 'P0001', 'ticket_has_time',
  'an owner cannot delete one with time logged: the bill must trace back');
select lives_ok(format($$ select delete_ticket(%L) $$, (select id from tk3)), 'but can delete one with none');
select is((select count(*)::int from tickets where id = (select id from tk3)), 0, 'and it is gone');

-- ---------------------------------------------------------------------
-- A worker and a client reach none of it
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select is((select count(*)::int from tickets), 0, 'a worker reads no ticket');
select throws_ok($$ select create_ticket('bug', null, 'A fine summary') $$, '42501', null, 'and cannot report');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select is((select count(*)::int from tickets) + (select count(*)::int from ticket_comments)
        + (select count(*)::int from ticket_scope) + (select count(*)::int from ticket_time), 0,
  'a client reads no ticket, comment, label or time');

select * from finish();
rollback;
