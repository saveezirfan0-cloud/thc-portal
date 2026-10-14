-- =====================================================================
-- 816 · THC's phone, the dress code per role, and who gets the timesheets
--       (§11.2; ADR-0004, ADR-0026, ADR-0089, ADR-0134 N1–N3)
--       — 20261014140100_client_portal_phone_dress_code_recipients.sql
--
-- 050 owns the column lists of the two restated views and 001 the set of
-- owner-rights views; this file holds the behaviour of what was added:
--   N1 client_portal_contact_v: one column, one row for a linked client
--      user, none for anybody else, closed to anon, the setting only;
--   N2 client_role_sections_v.dress_code: the section's own, never the
--      event's notes;
--   N3 client_events_v.timesheet_recipients: the event's list, else the
--      card's — event_document_recipients() to the letter.
-- =====================================================================
begin;
select plan(22);
\ir _shared/fixtures.psql

-- ---------------------------------------------------------------------
-- N1 · shape
-- ---------------------------------------------------------------------
select ok(not (coalesce((select reloptions from pg_class where relname = 'client_portal_contact_v'), '{}') @> '{security_invoker=true}')
          and (coalesce((select reloptions from pg_class where relname = 'client_portal_contact_v'), '{}') @> '{security_barrier=true}'),
  'client_portal_contact_v is an owner-rights security barrier view (ADR-0004)');
select ok(pg_get_viewdef('client_portal_contact_v'::regclass) ~ 'client_portal_visible\(c\.id\)'
          and pg_get_viewdef('client_portal_contact_v'::regclass) ~ 'current_client_id\(\)',
  'its body carries current_client_id() and client_portal_visible() itself');
select bag_eq(
  $$ select column_name::text from information_schema.columns
      where table_schema = 'public' and table_name = 'client_portal_contact_v' $$,
  $$ values ('phone'::text) $$,
  'one named column: phone — no other setting, nothing of the client card');
select ok(not has_table_privilege('anon', 'client_portal_contact_v', 'select')
          and has_table_privilege('authenticated', 'client_portal_contact_v', 'select')
          and not has_table_privilege('authenticated', 'client_portal_contact_v', 'insert')
          and not has_table_privilege('authenticated', 'client_portal_contact_v', 'update')
          and not has_table_privilege('authenticated', 'client_portal_contact_v', 'delete'),
  'SELECT to authenticated and nothing else to anybody (ADR-0004 rule (d))');
select is((select value from settings where key = 'client_portal_phone'), '""'::jsonb,
  'the setting is seeded empty, editable on /settings');

-- ---------------------------------------------------------------------
-- N1 · behaviour
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq($$ select phone from client_portal_contact_v $$, $$ values (null::text) $$,
  'empty setting: one row, phone null, so the page hides the line');
reset role;

update settings set value = '"  020 7946 0000  "' where key = 'client_portal_phone';

set local role authenticated;
select results_eq($$ select phone from client_portal_contact_v $$, $$ values ('020 7946 0000'::text) $$,
  'a client user reads THC''s number, trimmed, in one row');
select is((select count(*)::int from settings), 0,
  'and still no row of settings itself (ADR-0026: no client policy on settings)');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clientb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq($$ select phone from client_portal_contact_v $$, $$ values ('020 7946 0000'::text) $$,
  'the other client reads the same single number, one row');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_portal_contact_v), 0, 'a worker reads no row');
reset role;

insert into auth.users (id, email) values (:'new_id', 'orphan-816@rls.test');
insert into profiles (id, role, full_name, client_id) values (:'new_id', 'client', 'Unlinked', null);
select set_config('request.jwt.claims', json_build_object('sub', :'new_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_portal_contact_v), 0,
  'a client login linked to no company reads no row');
reset role;

update settings set value = '{"phone":"020"}' where key = 'client_portal_phone';
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq($$ select phone from client_portal_contact_v $$, $$ values (null::text) $$,
  'a value that is not a JSON string is no number, not its JSON text');
reset role;

set local role anon;
select throws_ok($$ select count(*) from client_portal_contact_v $$, '42501', null,
  'anon holds no privilege at all on client_portal_contact_v');
reset role;

-- ---------------------------------------------------------------------
-- N2 · dress code per section; the event's notes stay out
-- ---------------------------------------------------------------------
update events set notes = 'Office only: client is slow to pay' where id = :'event_a';
update shift_requirements set dress_code = '  ' where id = :'shift_b';

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select dress_code from client_role_sections_v where shift_id = :'shift_a'), 'Black tie',
  'the section''s own dress code reaches the customer');
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name like 'client\_%'
              and column_name in ('notes', 'cancel_reason', 'pays_buffer', 'buffer')),
  0, 'no client_* view carries the event''s notes, the cancel reason or the buffer');
select is((select count(*)::int from client_role_sections_v where shift_id = :'shift_b'), 0,
  'another client''s section, dress code and all, stays invisible');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clientb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select dress_code from client_role_sections_v where shift_id = :'shift_b'), null,
  'a blank dress code is null, so the panel draws no empty line');
reset role;

-- ---------------------------------------------------------------------
-- N3 · timesheet_recipients
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select timesheet_recipients from client_events_v where id = :'event_a'), array['clienta@rls.test'],
  'no list of the event''s own: the client card''s addresses');
reset role;

update events set document_recipients = array['banqueting@rls.test', 'events@rls.test'] where id = :'event_a';

set local role authenticated;
select is((select timesheet_recipients from client_events_v where id = :'event_a'),
          array['banqueting@rls.test', 'events@rls.test'],
  'an event with its own list: that list (ADR-0089)');
select is((select count(*)::int from client_events_v where id = :'event_b'), 0,
  'another client''s event, and its recipients, stay invisible');
reset role;
select is((select timesheet_recipients from client_events_v where id = :'event_a'),
          event_document_recipients(:'event_a'),
  'the column says exactly what event_document_recipients() — the send path — uses');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_events_v), 0,
  'a worker reads no event, so no recipient list');
reset role;

select * from finish();
rollback;
