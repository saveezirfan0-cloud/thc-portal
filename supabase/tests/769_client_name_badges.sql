-- =====================================================================
-- 769 · Name badges with the Allocation Timesheet (ADR-0081)
--       — 20261002112000_client_name_badges.sql
--
-- The badge PDF is drawn in packages/pdf (Vitest: badges.test.ts). This
-- file holds the database half: the client card's switch and who may turn
-- it, event_document_data() telling the Back Office to draw badges, the
-- badges joining one Allocation Timesheet copy before its email is queued
-- (and never after), the D1 payload carrying them as a second attachment,
-- and nothing of it reaching the client role.
-- =====================================================================
begin;
select plan(42);
\ir _shared/fixtures.psql

\set viewer  '76900000-0000-4000-8000-000000000001'
\set ev      '76910000-0000-4000-8000-000000000001'
\set ev_off  '76910000-0000-4000-8000-000000000002'
\set sec     '76920000-0000-4000-8000-000000000001'
\set r_wait  '76930000-0000-4000-8000-000000000001'
\set p_luca  '76940000-0000-4000-8000-000000000001'
\set bk_luca '76950000-0000-4000-8000-000000000001'

insert into auth.users (id, email) values (:'viewer', 'viewer.769@rls.test');
insert into profiles (id, role, office_role, full_name) values (:'viewer', 'admin', 'viewer', 'Vera Viewer');

insert into roles (id, name, description, pay_rate) values (:'r_wait', 'Badge Waiting Staff', 'fixture', 14.00);
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'p_luca', 97601, 'Luca', 'Moretti', 'b-1@rls.test', '+447700976001', date '1995-01-01', 'compliant');

-- Client A will switch badges on; client B keeps them off.
insert into events (id, client_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, po_number) values
  (:'ev', :'clienta', 'Badge Venue', '1 Badge St', st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150,
   'Gala Dinner', date '2026-10-20', false, true, '4471-A'),
  (:'ev_off', :'clientb', 'Badge Venue', '1 Badge St', st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150,
   'No Badges Dinner', date '2026-10-21', true, true, null);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'sec', :'ev', :'r_wait', '2026-10-20 16:00+00', '2026-10-20 22:30+00', 1, 0, 22.97, 14.00, 1);
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'bk_luca', :'sec', :'p_luca', 'confirmed', 'manual', '2026-10-01 10:00+00');

-- =====================================================================
-- 1-3 · The column, and the migration's name match
-- =====================================================================
select col_not_null('public', 'clients', 'name_badges', 'clients.name_badges is never "not set"');
select col_default_is('public', 'clients', 'name_badges', 'false', 'name badges are off unless a client asks');
select ok(regexp_replace(lower('Leonardo Hotel St Paul’s M and E'), '[^a-z0-9]', '', 'g') = 'leonardohotelstpaulsmande'
          and regexp_replace(lower('Leonardo Hotel St. Pauls M&E'), '[^a-z0-9]', '', 'g') = 'leonardohotelstpaulsme',
  'the migration''s match takes the curly apostrophe, "M and E" and "M&E" in its stride');

-- =====================================================================
-- 4-15 · The switch, and who may turn it
-- =====================================================================
select ok(not has_function_privilege('anon', 'public.set_client_name_badges(uuid, boolean)', 'execute'),
  'anon cannot call set_client_name_badges');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format('select set_client_name_badges(%L, true)', :'clienta'), '42501', 'admins_only',
  'a worker cannot turn name badges on');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format('select set_client_name_badges(%L, true)', :'clienta'), '42501', 'admins_only',
  'a client cannot turn name badges on for itself');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_like(format('select set_client_name_badges(%L, true)', :'clienta'), '%read_only%',
  'a viewer cannot (ADR-0060)');
reset role;
select is((select name_badges from clients where id = :'clienta'), false, 'and nothing changed');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(format('select set_client_name_badges(%L, true)', :'clienta'), 'the office turns name badges on');
select lives_ok(format('select set_client_name_badges(%L, true)', :'clienta'), 'turning it on again is a no-op');
select throws_ok(format('select set_client_name_badges(%L, null)', :'clienta'), '22004', 'name_badges_must_be_on_or_off',
  'the switch has no "not set" state');
select throws_ok(format('select set_client_name_badges(%L, true)', '00000000-0000-4000-8000-000000000000'), 'P0002', null,
  'an unknown client is refused');
reset role;

select is((select name_badges from clients where id = :'clienta'), true, 'client A has name badges on');
select is((select count(*)::int from audit_log
            where action = 'client.name_badges' and entity = 'client' and entity_id = :'clienta'),
  1, 'one History row for the change, none for the no-op');
select is((select data from audit_log where action = 'client.name_badges' and entity_id = :'clienta'),
  '{"from": false, "to": true}'::jsonb, 'the History row says what it was and what it became');

-- =====================================================================
-- 16-17 · event_document_data tells the Back Office to draw them
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select (event_document_data(:'ev'))->'event'->'nameBadges'), 'true'::jsonb,
  'event_document_data says draw name badges for a client that has them');
select is((select (event_document_data(:'ev_off'))->'event'->'nameBadges'), 'false'::jsonb,
  'and not for a client that does not');

-- =====================================================================
-- 18-30 · The badges join one Allocation Timesheet copy
-- =====================================================================
create temp table d as
  select record_event_document(:'ev', 'allocation', :'ev' || '/allocation/a.pdf', 'Client A – Gala Dinner.pdf', 1, 1) as id;
create temp table d_late as
  select record_event_document(:'ev', 'allocation', :'ev' || '/allocation/b.pdf', 'Client A – Gala Dinner.pdf', 1, 1) as id;
create temp table d_out as
  select record_event_document(:'ev', 'signout', :'ev' || '/signout/a.pdf', 'Client A – Gala Dinner.pdf', 1, 1) as id;
create temp table d_off as
  select record_event_document(:'ev_off', 'allocation', :'ev_off' || '/allocation/a.pdf', 'Client B – No Badges Dinner.pdf', 1, 1) as id;

select throws_ok(format($$ select attach_event_document_badges(%L, %L, 'B.pdf', 1) $$,
                        (select id from d_off), :'ev_off' || '/badges/a.pdf'),
  'P0001', 'client_has_no_name_badges', 'no badges for a client that has them off');
select throws_ok(format($$ select attach_event_document_badges(%L, %L, 'B.pdf', 1) $$,
                        (select id from d_out), :'ev' || '/badges/x.pdf'),
  '22023', 'badges_only_with_allocation', 'no badges on the Completed Allocation Timesheet: it goes after the event');
select throws_ok(format($$ select attach_event_document_badges(%L, %L, 'B.pdf', 1) $$,
                        (select id from d), :'ev_off' || '/badges/a.pdf'),
  '22023', 'storage_path_outside_event', 'the badges must sit under their own event''s folder');
select throws_ok(format($$ select attach_event_document_badges(%L, %L, 'B.pdf', 0) $$,
                        (select id from d), :'ev' || '/badges/a.pdf'),
  '22023', 'badges_need_someone_on_them', 'an empty set of badges is not attached');
select throws_ok(format($$ select attach_event_document_badges(%L, %L, ' ', 1) $$,
                        (select id from d), :'ev' || '/badges/a.pdf'),
  '22023', 'badges_need_a_file_name', 'the attachment needs a file name');
select lives_ok(format($$ select attach_event_document_badges(%L, %L, 'Client A – Gala Dinner – Name Badges.pdf', 1) $$,
                       (select id from d), :'ev' || '/badges/a.pdf'),
  'the office attaches the badges to its Allocation Timesheet copy');
select throws_ok(format($$ select attach_event_document_badges(%L, %L, 'B.pdf', 1) $$,
                        (select id from d), :'ev' || '/badges/again.pdf'),
  'P0001', 'badges_already_attached', 'a copy carries one set of badges');

-- The email: a second attachment with its own note, and the count.
create temp table q as select queue_event_document_email((select id from d)) as q;
create temp table q_late as select queue_event_document_email((select id from d_late)) as q;
reset role;

select is((select (payload->>'attachments')::jsonb from notification_outbox where key = (select q->>'key' from q)),
  jsonb_build_array(
    jsonb_build_object('bucket', 'timesheets', 'path', :'ev' || '/allocation/a.pdf', 'filename', 'Client A – Gala Dinner.pdf'),
    jsonb_build_object('bucket', 'timesheets', 'path', :'ev' || '/badges/a.pdf',
                       'filename', 'Client A – Gala Dinner – Name Badges.pdf', 'role', 'badges')),
  'D1 carries the Allocation Timesheet and the name badges, in that order');
select is((select payload->>'nameBadges' from notification_outbox where key = (select q->>'key' from q)), '1',
  'the payload says how many badges are attached');
select is((select (payload->>'attachments')::jsonb from notification_outbox where key = (select q->>'key' from q_late)),
  jsonb_build_array(jsonb_build_object('bucket', 'timesheets', 'path', :'ev' || '/allocation/b.pdf',
                                       'filename', 'Client A – Gala Dinner.pdf')),
  'a copy without badges still sends its one attachment, unchanged');
select is((select payload->>'nameBadges' from notification_outbox where key = (select q->>'key' from q_late)), '',
  'and says there are none');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select attach_event_document_badges(%L, %L, 'B.pdf', 1) $$,
                        (select id from d_late), :'ev' || '/badges/late.pdf'),
  'P0001', 'document_already_queued', 'what a client was sent is never changed: no badges after the email is queued');
reset role;

-- The event-documents job attaches as the service role (ADR-0074).
select record_event_document(:'ev', 'allocation', :'ev' || '/allocation/job.pdf', 'J.pdf', 1, 1) as d_job \gset
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
select lives_ok(format($$ select attach_event_document_badges(%L, %L, 'JB.pdf', 1) $$,
                       :'d_job', :'ev' || '/badges/job.pdf'),
  'the automatic 16:00 send attaches them as the service role');
reset role;

-- =====================================================================
-- 31-34 · Who else may attach, and the table's own guard
-- =====================================================================
select ok(not has_function_privilege('anon', 'public.attach_event_document_badges(uuid, text, text, int)', 'execute'),
  'anon cannot call attach_event_document_badges');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select attach_event_document_badges(%L, %L, 'B.pdf', 1) $$,
                        (select id from d_late), :'ev' || '/badges/w.pdf'),
  '42501', 'admins_only', 'a worker cannot attach badges');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select attach_event_document_badges(%L, %L, 'B.pdf', 1) $$,
                        (select id from d_late), :'ev' || '/badges/c.pdf'),
  '42501', 'admins_only', 'a client cannot attach badges');
reset role;

select throws_ok(format($$ update event_documents set badges_storage_path = 'x', badges_file_name = 'x', badges_count = 1 where id = %L $$,
                        (select id from d_out)),
  '23514', null, 'the table itself holds badges to the Allocation Timesheet');

-- =====================================================================
-- 35-37 · Nothing reaches the client role (ADR-0004, ADR-0026)
-- =====================================================================
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name = 'client_event_documents_v'
              and column_name like 'badges%'),
  0, 'the Client Portal''s document view does not gain the badge columns');
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name like 'client\_%'
              and column_name = 'name_badges'),
  0, 'no client_ view exposes the switch');
select is((select count(*)::int from pg_policies
            where schemaname = 'public' and tablename in ('clients', 'event_documents')
              and (qual ilike '%client%' and qual not ilike '%admin%')),
  0, 'the client role still holds no policy on clients or event_documents');

-- =====================================================================
-- 38 · A viewer cannot attach badges either (ADR-0060)
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select record_event_document(:'ev', 'allocation', :'ev' || '/allocation/v.pdf', 'V.pdf', 1, 1) as d_view \gset
select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_like(format($$ select attach_event_document_badges(%L, %L, 'B.pdf', 1) $$,
                          :'d_view', :'ev' || '/badges/v.pdf'),
  '%read_only%', 'a viewer cannot attach badges (the read-only guard on event_documents)');
reset role;

-- =====================================================================
-- 39-42 · The automatic D1 (ADR-0074) carries them too
--
-- Tomorrow's event for client A; D1 at 00:00 so "the day before" has
-- begun whatever the time of day this runs (as 760 does).
-- =====================================================================
\set ev_auto  '76910000-0000-4000-8000-000000000003'
\set sec_auto '76920000-0000-4000-8000-000000000002'
\set bk_auto  '76950000-0000-4000-8000-000000000002'
select set_config('request.jwt.claims', '', true);  -- fixtures below, as no session
select (now() at time zone 'Europe/London')::date + 1 as tomorrow \gset
insert into events (id, client_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, po_number) values
  (:'ev_auto', :'clienta', 'Badge Venue', '1 Badge St', st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150,
   'Auto Badges Dinner', :'tomorrow'::date, true, true, null);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'sec_auto', :'ev_auto', :'r_wait', (:'tomorrow'::date + time '17:00') at time zone 'Europe/London',
   (:'tomorrow'::date + time '23:00') at time zone 'Europe/London', 1, 0, 22.97, 14.00, 1);
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'bk_auto', :'sec_auto', :'p_luca', 'confirmed', 'manual', now() - interval '1 day');
update settings set value = jsonb_set(value, '{allocation,time}', '"00:00"') where key = 'document_autosend';

select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
select ok(event_document_autosend_claim(:'ev_auto', 'allocation'), 'the job claims tomorrow''s D1');
select record_event_document_autosend(:'ev_auto', 'allocation', :'ev_auto' || '/allocation/auto.pdf',
                                      'Client A – Auto Badges Dinner.pdf', 1, 1) as d_auto \gset
select lives_ok(format($$ select attach_event_document_badges(%L, %L, 'Client A – Auto Badges Dinner – Name Badges.pdf', 1) $$,
                       :'d_auto', :'ev_auto' || '/badges/auto.pdf'),
  'and attaches the badges to its automatic copy');
select is((queue_event_document_autosend(:'d_auto'))->>'queued', 'true', 'the automatic D1 is queued');
reset role;
select is((select (payload->>'attachments')::jsonb from notification_outbox where key = 'D1:auto:' || :'ev_auto'),
  jsonb_build_array(
    jsonb_build_object('bucket', 'timesheets', 'path', :'ev_auto' || '/allocation/auto.pdf',
                       'filename', 'Client A – Auto Badges Dinner.pdf'),
    jsonb_build_object('bucket', 'timesheets', 'path', :'ev_auto' || '/badges/auto.pdf',
                       'filename', 'Client A – Auto Badges Dinner – Name Badges.pdf', 'role', 'badges')),
  'the automatic D1 carries the sheet and the badges, like the manual one');

select * from finish();
rollback;
