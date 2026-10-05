-- =====================================================================
-- 773 · Who receives the timesheet is chosen per event
--       20261005140200 · ADR-0089 (THC 05.10.2026)
--
-- events.document_recipients (null = every contact email on the client
-- card), event_document_recipients(), the admin-only
-- set_event_document_recipients(), and the three places that read it: the
-- manual Send, the automatic send, and the job's "no contact email" check.
-- =====================================================================
begin;
select plan(30);
\ir _shared/fixtures.psql

select (now() at time zone 'Europe/London')::date as today \gset
create function pg_temp.uk(p_day date, p_time text) returns timestamptz
language sql immutable as $$ select (p_day + p_time::time) at time zone 'Europe/London' $$;

\set ev     '77200000-0000-4000-8000-000000000001'
\set ev_off '77200000-0000-4000-8000-000000000002'
\set sec    '77210000-0000-4000-8000-000000000001'
\set sec_o  '77210000-0000-4000-8000-000000000002'
\set p_1    '77230000-0000-4000-8000-000000000001'
\set b_1    '77240000-0000-4000-8000-000000000001'

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'p_1', 97201, 'Luca', 'Moretti', 'r-1@rls.test', '+447700972901', date '1995-01-01', 'compliant');
insert into events (id, client_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer)
select x.id::uuid, :'clienta'::uuid, 'Rcpt Venue', '1 Rcpt St',
       st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150, x.title, :'today'::date + 1, true, true
  from (values (:'ev', 'Split Lunch'), (:'ev_off', 'Called Off')) as x(id, title);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'sec',   :'ev',     :'role_id', pg_temp.uk(:'today'::date + 1, '12:00'), pg_temp.uk(:'today'::date + 1, '16:00'), 1, 0, 22.97, 14.00, 1),
  (:'sec_o', :'ev_off', :'role_id', pg_temp.uk(:'today'::date + 1, '12:00'), pg_temp.uk(:'today'::date + 1, '16:00'), 1, 0, 22.97, 14.00, 1);
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at)
values (:'b_1', :'sec', :'p_1', 'confirmed', 'manual', now() - interval '7 days');
update events set cancelled_at = now() - interval '1 day', cancel_reason = 'client cancelled' where id = :'ev_off';

-- =====================================================================
-- 1 · The default is the client card — every existing event
-- =====================================================================
select is(event_document_recipients(:'ev'), array['clienta@rls.test'], 'no override: every contact email on the client card');
select is((select document_recipients from events where id = :'ev'), null::text[], 'the column is null');

-- =====================================================================
-- 2 · An admin picks who gets it
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table set1 as
  select set_event_document_recipients(:'ev', array['  Bob@Example.com ', 'bob@example.com', '', 'carol@example.com']) as r;
select results_eq($$ select r->'recipients', r->'custom' from set1 $$,
  $$ values ('["bob@example.com","carol@example.com"]'::jsonb, 'true'::jsonb) $$,
  'trimmed, lower-cased, de-duplicated, blanks dropped, in the order given');
reset role;
select is((select document_recipients from events where id = :'ev'), array['bob@example.com', 'carol@example.com'],
  'stored on the event');
select is(event_document_recipients(:'ev'), array['bob@example.com', 'carol@example.com'], 'and that is who a timesheet for it goes to');
select is(event_document_recipients(:'ev_off'), array['clienta@rls.test'], 'another event of the same client is untouched');
select results_eq(
  format($$ select data->'recipients', data->'previous' from audit_log
             where action = 'event.document_recipients_set' and entity_id = %L $$, :'ev'),
  $$ values ('["bob@example.com","carol@example.com"]'::jsonb, 'null'::jsonb) $$,
  'audited with the new list and the previous one (none)');

-- =====================================================================
-- 3 · Refusals
-- =====================================================================
set local role authenticated;
select throws_ok(format($$ select set_event_document_recipients(%L, array['not-an-email']) $$, :'ev'), '22023', 'invalid_recipient_email',
  'an address that is not an email is refused');
select throws_ok(format($$ select set_event_document_recipients(%L, array['a b@x.co']) $$, :'ev'), '22023', 'invalid_recipient_email',
  'so is one with a space');
select throws_ok(format($$ select set_event_document_recipients(%L, array['a@x.co','b@x.co','c@x.co','d@x.co','e@x.co','f@x.co','g@x.co','h@x.co','i@x.co','j@x.co','k@x.co']) $$, :'ev'),
  '22023', 'too_many_recipients', 'more than ten is refused');
select throws_ok(format($$ select set_event_document_recipients(%L, array['a@x.co']) $$, :'ev_off'), 'P0001', 'event_cancelled',
  'a cancelled event has no document, so no recipients to choose');
select throws_ok(format($$ select set_event_document_recipients(%L, array['a@x.co']) $$, '77200000-0000-4000-8000-0000000000ff'), 'P0002', 'event_not_found',
  'an unknown event');
reset role;
select is(event_document_recipients(:'ev'), array['bob@example.com', 'carol@example.com'], 'a refused write changes nothing');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select set_event_document_recipients(%L, array['a@x.co']) $$, :'ev'), '42501', null,
  'a client cannot choose who gets its own timesheets');
select is((select count(*)::int from events where id = :'ev'), 0, 'and cannot read the event row at all (ADR-0026)');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select set_event_document_recipients(%L, array['a@x.co']) $$, :'ev'), '42501', null, 'nor can a worker');
reset role;

-- =====================================================================
-- 4 · The manual Send uses it
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table man as
  select record_event_document(:'ev', 'allocation', :'ev' || '/allocation/man.pdf', 'M.pdf', 1, 1) as id;
create temp table mq as select queue_event_document_email((select id from man)) as q;
reset role;
select is((select q->'recipients' from mq), '["bob@example.com","carol@example.com"]'::jsonb, 'the manual Send reports the chosen recipients');
select is((select recipient_emails from notification_outbox where key = (select q->>'key' from mq)),
  array['bob@example.com', 'carol@example.com'], 'and the email goes to them, not the client card');
select is((select recipients from event_documents where id = (select id from man)),
  array['bob@example.com', 'carol@example.com'], 'recorded on the document');

-- =====================================================================
-- 5 · The automatic send uses it, and the job counts it
-- =====================================================================
update settings
   set value = jsonb_set(jsonb_set(value, '{allocation,time}', '"00:00"'), '{completed,not_before}', 'null')
 where key = 'document_autosend';
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
select results_eq(
  format($$ select contacts, verdict from event_documents_due(now(), %L) where kind = 'allocation' $$, :'ev'),
  $$ values (2, 'manual_sent'::text) $$,
  'the job counts the event''s two recipients (and sees the manager''s copy)');
reset role;
-- Put the manual copy a week back so it does not suppress the automatic one.
update event_documents set queued_at = now() - interval '8 days' where id = (select id from man);
set local role service_role;
select is((select verdict from event_documents_due(now(), :'ev') where kind = 'allocation'), 'due', 'due');
select ok(event_document_autosend_claim(:'ev', 'allocation'), 'claimed');
create temp table auto1 as
  select record_event_document_autosend(:'ev', 'allocation', :'ev' || '/allocation/auto.pdf', 'A.pdf', 1, 1) as id;
create temp table aq as select queue_event_document_autosend((select id from auto1)) as q;
select is((select q->'recipients' from aq), '["bob@example.com","carol@example.com"]'::jsonb,
  'the automatic send goes to the chosen recipients');
select is((select recipient_emails from notification_outbox where key = 'D1:auto:' || :'ev'),
  array['bob@example.com', 'carol@example.com'], 'on the outbox row');
reset role;

-- =====================================================================
-- 6 · Back to the client card
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table set2 as select set_event_document_recipients(:'ev', null) as r;
select results_eq($$ select r->'recipients', r->'custom' from set2 $$,
  $$ values ('["clienta@rls.test"]'::jsonb, 'false'::jsonb) $$,
  'null puts the event back on the client card''s contacts');
create temp table set3 as select set_event_document_recipients(:'ev', array['  ', '']) as r;
select is((select r->'custom' from set3), 'false'::jsonb, 'so does a list with nothing in it');
reset role;
select is((select document_recipients from events where id = :'ev'), null::text[], 'the column is null again');
select is(event_document_recipients(:'ev'), array['clienta@rls.test'], 'and the client card is who gets it');
select throws_ok(format($$ update events set document_recipients = array[]::text[] where id = %L $$, :'ev'), '23514', null,
  'the column itself refuses an empty list (check constraint)');
select throws_ok(format($$ update events set document_recipients = array['1@x.co','2@x.co','3@x.co','4@x.co','5@x.co','6@x.co','7@x.co','8@x.co','9@x.co','10@x.co','11@x.co'] where id = %L $$, :'ev'),
  '23514', null, 'and more than ten');

select * from finish();
rollback;
