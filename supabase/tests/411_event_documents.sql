-- =====================================================================
-- 411 · The allocation sheet and the sign-out timesheet (§11.3, §11.4)
--       — 20260923130100_event_documents.sql
--
-- The PDF itself is drawn and paginated in packages/pdf (Vitest: golden
-- files, three pages for 25 and 27 rows). This file holds the database
-- half: who is on the sheet, what the sign-out columns may say, the GDPR
-- rule for a copy generated after a removal, the cancelled-event refusal,
-- the §11.4 email, and who can reach any of it — including the Client
-- Portal's owner-rights view (ADR-0004).
-- =====================================================================
begin;
select plan(40);
\ir _shared/fixtures.psql

\set ev      '41200000-0000-4000-8000-000000000001'
\set ev_off  '41200000-0000-4000-8000-000000000002'
\set ev_b    '41200000-0000-4000-8000-000000000003'
\set sec_chef '41210000-0000-4000-8000-000000000001'
\set sec_wait '41210000-0000-4000-8000-000000000002'
\set sec_b    '41210000-0000-4000-8000-000000000003'
\set r_chef  '41220000-0000-4000-8000-000000000001'
\set r_wait  '41220000-0000-4000-8000-000000000002'
\set p_luca  '41230000-0000-4000-8000-000000000001'
\set p_aisha '41230000-0000-4000-8000-000000000002'
\set p_tom   '41230000-0000-4000-8000-000000000003'
\set p_grace '41230000-0000-4000-8000-000000000004'
\set p_inv   '41230000-0000-4000-8000-000000000005'
\set p_short '41230000-0000-4000-8000-000000000006'
\set bk_luca  '41240000-0000-4000-8000-000000000001'
\set bk_aisha '41240000-0000-4000-8000-000000000002'
\set bk_tom   '41240000-0000-4000-8000-000000000003'
\set bk_grace '41240000-0000-4000-8000-000000000004'
\set bk_inv   '41240000-0000-4000-8000-000000000005'
\set bk_short '41240000-0000-4000-8000-000000000006'

insert into roles (id, name, description, pay_rate) values
  (:'r_chef', 'Doc Chef', 'fixture', 19.00),
  (:'r_wait', 'Doc Waiting Staff', 'fixture', 14.00);

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status, photo_path) values
  (:'p_luca',  92001, 'Luca',   'Moretti',   'd-1@rls.test', '+447700942001', date '1995-01-01', 'compliant', :'p_luca' || '/selfie.jpg'),
  (:'p_aisha', 92002, 'Aisha',  'Bello',     'd-2@rls.test', '+447700942002', date '1995-01-01', 'compliant', :'p_aisha' || '/selfie.jpg'),
  (:'p_tom',   92003, 'Tom',    'Reid',      'd-3@rls.test', '+447700942003', date '1995-01-01', 'compliant', null),
  (:'p_grace', 92004, 'Grace',  'Lindqvist', 'd-4@rls.test', '+447700942004', date '1995-01-01', 'compliant', :'p_grace' || '/selfie.jpg'),
  (:'p_inv',   92005, 'Ivan',   'Invited',   'd-5@rls.test', '+447700942005', date '1995-01-01', 'compliant', null),
  (:'p_short', 92006, 'Sam',    'Short',     'd-6@rls.test', '+447700942006', date '1995-01-01', 'compliant', null);

-- Leonardo-style event, two role sections, the client does NOT pay breaks.
insert into events (id, client_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, po_number) values
  (:'ev', :'clienta', 'Doc Venue', '1 Doc St', st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150,
   'Gala Dinner', date '2025-04-12', false, true, '4471-A'),
  (:'ev_off', :'clienta', 'Doc Venue', '1 Doc St', st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150,
   'Called Off', date '2025-04-13', true, true, null),
  (:'ev_b', :'clientb', 'Doc Venue', '1 Doc St', st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150,
   'Client B Dinner', date '2025-04-14', true, true, null);
update events set cancelled_at = '2025-04-10 10:00+00', cancel_reason = 'client cancelled' where id = :'ev_off';

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'sec_wait', :'ev',   :'r_wait', '2025-04-12 16:00+00', '2025-04-12 22:30+00', 4, 1, 22.97, 14.00, 5),
  (:'sec_chef', :'ev',   :'r_chef', '2025-04-12 06:00+00', '2025-04-12 14:00+00', 2, 0, 28.00, 19.00, 2),
  (:'sec_b',    :'ev_b', :'r_wait', '2025-04-14 16:00+00', '2025-04-14 22:00+00', 1, 0, 22.97, 14.00, 1);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'bk_luca',  :'sec_chef', :'p_luca',  'worked',    'manual', '2025-04-01 10:00+00'),
  (:'bk_aisha', :'sec_wait', :'p_aisha', 'worked',    'manual', '2025-04-01 10:00+00'),
  (:'bk_tom',   :'sec_wait', :'p_tom',   'worked',    'manual', '2025-04-01 10:00+00'),
  (:'bk_grace', :'sec_wait', :'p_grace', 'worked',    'manual', '2025-04-01 10:00+00'),
  (:'bk_inv',   :'sec_wait', :'p_inv',   'invited',   'auto',   null),
  (:'bk_short', :'sec_wait', :'p_short', 'worked',    'manual', '2025-04-01 10:00+00');

insert into check_logs (booking_id, attempted_at, outcome, check_in_at, check_out_at) values
  (:'bk_luca',  '2025-04-12 06:00+00', 'checked_in', '2025-04-12 06:00+00', '2025-04-12 14:05+00'),
  (:'bk_aisha', '2025-04-12 16:00+00', 'checked_in', '2025-04-12 16:00+00', '2025-04-12 22:42+00'),
  (:'bk_tom',   '2025-04-12 16:00+00', 'checked_in', '2025-04-12 16:00+00', null),
  (:'bk_grace', '2025-04-12 16:00+00', 'checked_in', '2025-04-12 16:00+00', '2025-04-12 22:30+00'),
  (:'bk_short', '2025-04-12 16:00+00', 'checked_in', '2025-04-12 16:00+00', '2025-04-12 18:30+00');
insert into breaks (booking_id, started_at, ended_at) values
  (:'bk_aisha', '2025-04-12 19:00+00', '2025-04-12 19:20+00');
insert into violations (staff_id, booking_id, type) values (:'p_tom', :'bk_tom', 'no_checkout');

-- Grace is removed AFTER the event (§1.7).
update staff set first_name = 'Deleted', last_name = 'account', photo_path = null, removed_at = now()
 where id = :'p_grace';

-- =====================================================================
-- 1-3 · Who may draw a sheet
-- =====================================================================
select ok(not has_function_privilege('anon', 'public.event_document_data(uuid)', 'execute'),
  'anon cannot read a timesheet');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format('select event_document_data(%L)', :'ev'), '42501', 'admins_only',
  'a worker cannot read a whole event''s sheet');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format('select event_document_data(%L)', :'ev'), '42501', 'admins_only',
  'a client does not call the data function; the portal downloads the stored PDF through client_event_documents_v');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table doc as select event_document_data(:'ev') as d;
create temp table r as
  select x.* from doc, jsonb_to_recordset(d->'rows') as x(
    "bookingId" uuid, "employeeId" int, name text, surname text, removed boolean, "photoPath" text,
    "roleName" text, "startsAt" timestamptz, "endsAt" timestamptz, "finishAt" timestamptz,
    "workedMin" int, status text, "breakMin" int);
reset role;

-- =====================================================================
-- 4-8 · The header
-- =====================================================================
select is((select d->'event'->>'clientName' from doc), 'RLS Fixture Client A', 'the client name, for "Client – Event"');
select is((select d->'event'->>'title' from doc), 'Gala Dinner', 'the event name');
select is((select d->'event'->>'poNumber' from doc), '4471-A', 'the PO number carries into the document (§3.2, §11.3)');
select is((select d->'event'->>'eventDate' from doc), '2025-04-12', 'the event date');
select is((select d->'event'->'contactEmails' from doc), '["clienta@rls.test"]'::jsonb,
  'the client card''s contact emails, for §11.4');

-- =====================================================================
-- 9-11 · Who is on the sheet
-- =====================================================================
select is((select count(*)::int from r), 5, 'five rows: confirmed and worked bookings only');
select is((select count(*)::int from r where "bookingId" = :'bk_inv'), 0, 'an invitation is not the line-up');
select is((select string_agg(t.v->>'roleName', ',' order by t.ord) from doc,
             jsonb_array_elements(doc.d->'rows') with ordinality as t(v, ord)),
  'Doc Chef,Doc Waiting Staff,Doc Waiting Staff,Doc Waiting Staff,Doc Waiting Staff',
  'rows come back in role-section order, by each section''s own start (RULE-18) — Chef 06:00 before Waiting 16:00');

-- =====================================================================
-- 12-19 · The sign-out columns
-- =====================================================================
select is((select row(status, "finishAt", "workedMin", "breakMin")::text from r where "bookingId" = :'bk_aisha'),
  row('settled', timestamptz '2025-04-12 22:42+00', 370, 20)::text,
  'Aisha: finish 22:42 printed as recorded; hours = 16:00–22:30 capped at the end (RULE-01) − 20 min break = 370 min (6h 10m); the break goes in Comments');
select is((select row(status, "finishAt", "workedMin")::text from r where "bookingId" = :'bk_luca'),
  row('settled', timestamptz '2025-04-12 14:05+00', 480)::text,
  'Luca: the client does not pay breaks and none were taken — eight hours');
select is((select status from r where "bookingId" = :'bk_tom'), 'pending',
  'Tom: an unresolved No check-out is pending (RULE-02)…');
select ok((select "finishAt" is null and "workedMin" is null from r where "bookingId" = :'bk_tom'),
  '…so his Finish Time and Hours Worked come back empty rather than guessed (§11.3)');
select is((select "workedMin" from r where "bookingId" = :'bk_short'), 150,
  'Sam: 2h 30m worked is printed as 2h 30m — the four-hour floor is a pay rule, not hours worked');

update check_logs set manager_finish_at = '2025-04-12 22:30+00' where booking_id = :'bk_tom';
update violations set resolved = true, resolved_at = now(), resolution_note = 'fixture' where booking_id = :'bk_tom';
set local role authenticated;
select is((select (x->>'workedMin')::int from jsonb_array_elements(event_document_data(:'ev')->'rows') x
            where x->>'bookingId' = :'bk_tom'), 390,
  'Regenerating after the manager resolves it fills the cells from the manager-entered finish (§11.3)');
reset role;

-- §1.7: a copy generated after the removal.
select is((select row(name, surname, "photoPath", "employeeId")::text from r where "bookingId" = :'bk_grace'),
  row('Deleted account #92004', null::text, null::text, 92004)::text,
  'Grace, removed: "Deleted account #id", no surname to sort by and NO photo; the Employee ID stays for reconciliation (§1.7)');
select is((select "photoPath" from r where "bookingId" = :'bk_luca'), :'p_luca' || '/selfie.jpg',
  'a worker who is not removed keeps their photo');

-- =====================================================================
-- 20-21 · Cancelled events have no document (§3.3 point 5)
-- =====================================================================
set local role authenticated;
select throws_ok(format('select event_document_data(%L)', :'ev_off'), 'P0001', 'event_cancelled',
  'no allocation sheet or timesheet is generated for a cancelled event');
select throws_ok(format($$ select record_event_document(%L, 'allocation', %L, 'x.pdf', 1, 1) $$,
                        :'ev_off', :'ev_off' || '/allocation/x.pdf'), 'P0001', 'event_cancelled',
  '…and none can be recorded for one either');

-- =====================================================================
-- 22-26 · Recording a copy and sending it (§11.4)
-- =====================================================================
select throws_ok(format($$ select record_event_document(%L, 'allocation', %L, 'x.pdf', 1, 1) $$,
                        :'ev', :'ev_b' || '/allocation/x.pdf'), '22023', 'storage_path_outside_event',
  'a copy cannot be recorded against another event''s file');

create temp table d1 as
  select record_event_document(:'ev', 'allocation', :'ev' || '/allocation/2025-04-11T17-42-00Z.pdf',
                               'RLS Fixture Client A – Gala Dinner.pdf', 5, 1) as id;
select is((select generated_by from event_documents where id = (select id from d1)), :'admin_uid'::uuid,
  'the copy records who generated it');
create temp table q1 as select queue_event_document_email((select id from d1)) as q;
select is((select row(template, recipient_emails)::text from notification_outbox where key = (select q->>'key' from q1)),
  row('D1', array['clienta@rls.test'])::text,
  'Send allocation sheet: one email (D1) to the contact emails on the client card, from timesheets@ (§11.4)');
select is((select payload->>'poSuffix' from notification_outbox where key = (select q->>'key' from q1)), ' (PO 4471-A)',
  'the subject carries the PO number');
select lives_ok(format('select queue_event_document_email(%L)', (select id from d1)),
  'pressing Send twice on the same copy…');
select is((select count(*)::int from notification_outbox where key like 'D1:document:%' and key = (select q->>'key' from q1)), 1,
  '…is still one email');
reset role;

-- =====================================================================
-- 27-28 · The send status follows the outbox
-- =====================================================================
select complete_outbox_send((select id from notification_outbox where key = (select q->>'key' from q1)), true);
select ok((select sent_at is not null from event_documents where id = (select id from d1)),
  'when the drain sends it, the document row says so');
select ok((select recipients = array['clienta@rls.test'] from event_documents where id = (select id from d1)),
  'and records who it went to');

-- =====================================================================
-- 29-35 · Who can see the copies
-- =====================================================================
insert into event_documents (event_id, kind, storage_path, file_name, row_count, page_count)
values (:'ev_b', 'allocation', :'ev_b' || '/allocation/b.pdf', 'Client B.pdf', 1, 1);

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from event_documents), 0, 'a worker reads no document rows');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from event_documents), 0, 'a client reads no document rows from the table itself');
select is((select string_agg(event_id::text, ',') from client_event_documents_v where event_id in (:'ev', :'ev_b')), :'ev',
  'client A sees its own event''s sheet through client_event_documents_v, and not client B''s');
reset role;

select ok(not has_table_privilege('anon', 'client_event_documents_v', 'select'),
  'anon has no privilege on client_event_documents_v');
-- ADR-0004 rule (d): SELECT to authenticated and nothing else. The view was
-- revoked from public and anon only, so Supabase's default grant had left
-- INSERT/UPDATE/DELETE with authenticated (20260926130000 takes them back).
select ok(not has_table_privilege('authenticated', 'client_event_documents_v', 'insert')
      and not has_table_privilege('authenticated', 'client_event_documents_v', 'update')
      and not has_table_privilege('authenticated', 'client_event_documents_v', 'delete'),
  '§11.1 read-only: nobody writes through client_event_documents_v — the privilege itself is absent, not merely the view non-updatable');

set local role anon;
select is((select count(*)::int from event_documents where event_id in (:'ev', :'ev_b')), 0,
  'anon reads no event_documents row from the table: a timesheet path carries names and pay lines (§11.3)');
select throws_ok(
  format($$ insert into event_documents (event_id, kind, storage_path, file_name, row_count, page_count)
            values (%L, 'timesheet', 'forged/t.pdf', 'Forged.pdf', 1, 1) $$, :'ev'),
  '42501', null, 'and cannot register a copy');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ insert into event_documents (event_id, kind, storage_path, file_name, row_count, page_count)
            values (%L, 'timesheet', 'forged/t.pdf', 'Forged.pdf', 1, 1) $$, :'ev'),
  '42501', null, 'a client cannot register a copy of its own event''s sheet either — the send job writes them');
with u as (update event_documents set file_name = 'x' returning 1)
  select is((select count(*)::int from u), 0, 'nor rename one');
reset role;
select bag_eq(
  $$ select column_name::text from information_schema.columns
      where table_schema = 'public' and table_name = 'client_event_documents_v' $$,
  $$ values ('id'::text),('event_id'),('kind'),('file_name'),('storage_path'),('issued_at') $$,
  'client_event_documents_v names its columns, and none of them is money (§11.1)');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from event_documents where event_id in (:'ev', :'ev_b')), 2, 'the admin reads every copy');
reset role;

select * from finish();
rollback;
