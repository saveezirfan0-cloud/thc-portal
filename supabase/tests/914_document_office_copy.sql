-- =====================================================================
-- 914 · The office's hidden copy of every timesheet sent to a client
--       20261022160000 · ADR-0179 (THC 21.10.2026)
--
-- settings.document_office_copy (seeded empty, owner-only to write, unread
-- by a client or a worker, its shape guarded), document_office_copy(), and
-- the two queue functions that put it on the outbox row as payload.bcc —
-- the manual Send (D1 and D2), the automatic D1 and its "(updated)" resend.
-- And the other half of the promise: nothing the Client Portal reads ever
-- names the copy address.
-- =====================================================================
begin;
select plan(50);
\ir _shared/fixtures.psql

select (now() at time zone 'Europe/London')::date as today \gset
create function pg_temp.uk(p_day date, p_time text) returns timestamptz
language sql immutable as $$ select (p_day + p_time::time) at time zone 'Europe/London' $$;

\set ev      '91400000-0000-4000-8000-000000000001'
\set sec     '91410000-0000-4000-8000-000000000001'
\set p_1     '91430000-0000-4000-8000-000000000001'
\set b_1     '91440000-0000-4000-8000-000000000001'
\set manager '91450000-0000-4000-8000-000000000001'
\set sam     'sam.copy@thc-office.test'

insert into auth.users (id, email) values (:'manager', 'manager914@rls.test');
insert into profiles (id, role, office_role, full_name) values (:'manager', 'admin', 'manager', 'Mona Manager');
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'p_1', 91401, 'Luca', 'Moretti', 'r-914@rls.test', '+447700914001', date '1995-01-01', 'compliant');
insert into events (id, client_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer)
values (:'ev', :'clienta', 'Copy Venue', '1 Copy St', st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography,
        150, 'Copied Lunch', :'today'::date + 1, true, true);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'sec', :'ev', :'role_id', pg_temp.uk(:'today'::date + 1, '12:00'), pg_temp.uk(:'today'::date + 1, '16:00'), 1, 0, 22.97, 14.00, 1);
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at)
values (:'b_1', :'sec', :'p_1', 'confirmed', 'manual', now() - interval '7 days');

-- The client's own two addresses for this event (ADR-0089).
update events set document_recipients = array['events@client.test', 'ops@client.test'] where id = :'ev';

-- =====================================================================
-- 1 · Seeded empty, and guarded
-- =====================================================================
select is((select value from settings where key = 'document_office_copy'), '{"emails": []}'::jsonb,
  'seeded: no addresses — the copy is off');
select is(document_office_copy(array['x@y.co']), '{}'::text[], 'and off reads as nobody');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
update settings set value = jsonb_build_object('emails', array['  Sam.Copy@THC-office.test ', 'sam.copy@thc-office.test', '', 'b@x.co'])
 where key = 'document_office_copy';
select is((select value from settings where key = 'document_office_copy'),
  '{"emails": ["sam.copy@thc-office.test", "b@x.co"]}'::jsonb,
  'an owner sets it: trimmed, lower-cased, de-duplicated, blanks dropped, in the order given');
select throws_ok($$ update settings set value = '{"emails": ["a@x.co","b@x.co","c@x.co","d@x.co","e@x.co","f@x.co"]}' where key = 'document_office_copy' $$,
  '22023', 'document_office_copy_too_many', 'six addresses are refused');
select throws_ok($$ update settings set value = '{"emails": ["not-an-email"]}' where key = 'document_office_copy' $$,
  '22023', 'document_office_copy_invalid_email', 'an address that is not an email is refused');
select throws_ok($$ update settings set value = '{"emails": ["a b@x.co"]}' where key = 'document_office_copy' $$,
  '22023', 'document_office_copy_invalid_email', 'so is one with a space');
select throws_ok($$ update settings set value = '{"emails": ["a@x.co, b@x.co"]}' where key = 'document_office_copy' $$,
  '22023', 'document_office_copy_invalid_email', 'and two in one box');
select throws_ok($$ update settings set value = '["a@x.co"]' where key = 'document_office_copy' $$,
  '22023', 'document_office_copy_invalid', 'a bare list is not the shape');
select throws_ok($$ update settings set value = '{"emails": [1]}' where key = 'document_office_copy' $$,
  '22023', 'document_office_copy_invalid', 'nor is a number');
select throws_ok($$ update settings set value = '{"emails": [], "cc": ["a@x.co"]}' where key = 'document_office_copy' $$,
  '22023', 'document_office_copy_invalid', 'nor an extra key');
select throws_ok($$ update settings set value = '{"emails": "a@x.co"}' where key = 'document_office_copy' $$,
  '22023', 'document_office_copy_invalid', 'nor a string for the list');
reset role;
select is((select value from settings where key = 'document_office_copy'),
  '{"emails": ["sam.copy@thc-office.test", "b@x.co"]}'::jsonb, 'a refused write changes nothing');
select ok(exists (select 1 from audit_log where action = 'settings.update'
                   and data->>'key' = 'document_office_copy'
                   and data->'to' = '{"emails": ["sam.copy@thc-office.test", "b@x.co"]}'::jsonb
                   and actor = :'admin_uid'),
  'the change is audited like every setting, with who made it');

-- =====================================================================
-- 2 · Only an owner writes it; a client or a worker cannot even read it
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from settings where key = 'document_office_copy'), 1, 'a manager can read it (as every setting)');
update settings set value = '{"emails": ["evil@x.co"]}' where key = 'document_office_copy';
select throws_ok($$ insert into settings (key, value) values ('document_office_copy', '{"emails": ["evil@x.co"]}')
                    on conflict (key) do update set value = excluded.value $$,
  '42501', null, 'a manager''s upsert is refused (settings is owner-only to write)');
select lives_ok($$ delete from settings where key = 'document_office_copy' $$, 'a manager''s delete is not an error…');
reset role;
select is((select value from settings where key = 'document_office_copy'),
  '{"emails": ["sam.copy@thc-office.test", "b@x.co"]}'::jsonb, '…but neither the update nor the delete touched the row');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from settings where key = 'document_office_copy'), 0, 'a client cannot read it');
update settings set value = '{"emails": []}' where key = 'document_office_copy';
select throws_ok($$ insert into settings (key, value) values ('document_office_copy', '{"emails": []}')
                    on conflict (key) do update set value = excluded.value $$,
  '42501', null, 'nor write it');
select throws_ok($$ select document_office_copy('{}') $$, '42501', null, 'nor call its reading');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from settings where key = 'document_office_copy'), 0, 'a worker cannot read it');
update settings set value = '{"emails": []}' where key = 'document_office_copy';
select throws_ok($$ select document_office_copy('{}') $$, '42501', null, 'nor call its reading');
reset role;
select is((select value from settings where key = 'document_office_copy'),
  '{"emails": ["sam.copy@thc-office.test", "b@x.co"]}'::jsonb, 'the client''s and the worker''s writes changed nothing');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select document_office_copy('{}') $$, '42501', null,
  'not even an owner calls it directly — the queue functions are its only callers');
reset role;

-- =====================================================================
-- 3 · The reading: the setting less anyone already in To
-- =====================================================================
select is(document_office_copy(array['events@client.test']), array[:'sam', 'b@x.co'], 'nobody in To: both');
select is(document_office_copy(array['B@X.co ', 'events@client.test']), array[:'sam'],
  'someone in To (whatever the case) is left out, so they do not get it twice');
select is(document_office_copy(null), array[:'sam', 'b@x.co'], 'no To at all: both');

-- One of the copy addresses is also one of the client's: it stays in To only.
update settings set value = jsonb_build_object('emails', array[:'sam', 'ops@client.test'])
 where key = 'document_office_copy';

-- =====================================================================
-- 4 · The manual Send — D1 and D2
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table man as
  select record_event_document(:'ev', 'allocation', :'ev' || '/allocation/man.pdf', 'M.pdf', 1, 1) as id;
create temp table mq as select queue_event_document_email((select id from man)) as q;
create temp table man2 as
  select record_event_document(:'ev', 'signout', :'ev' || '/signout/man.pdf', 'C.pdf', 1, 1) as id;
create temp table mq2 as select queue_event_document_email((select id from man2)) as q;
reset role;
select results_eq($$ select q->'recipients', q->'bcc' from mq $$,
  $$ values ('["events@client.test","ops@client.test"]'::jsonb, '["sam.copy@thc-office.test"]'::jsonb) $$,
  'the Send answers who it went to and who was copied');
select results_eq($$ select template, recipient_emails, payload->'bcc' from notification_outbox where key = (select q->>'key' from mq) $$,
  $$ values ('D1'::text, array['events@client.test', 'ops@client.test'], '["sam.copy@thc-office.test"]'::jsonb) $$,
  'D1: the client in To, the office copy as payload.bcc — and ops@, already in To, not copied');
select results_eq($$ select template, recipient_emails, payload->'bcc' from notification_outbox where key = (select q->>'key' from mq2) $$,
  $$ values ('D2'::text, array['events@client.test', 'ops@client.test'], '["sam.copy@thc-office.test"]'::jsonb) $$,
  'D2 the same');
select ok((select payload ?& array['event', 'date', 'staffCount', 'attachments', 'documentName']
             from notification_outbox where key = (select q->>'key' from mq)),
  'the rest of the payload is as before');
select ok(not exists (select 1 from notification_outbox
                       where key in ((select q->>'key' from mq), (select q->>'key' from mq2))
                         and :'sam' = any (recipient_emails)),
  'the copy address is never a To recipient');
select is((select recipients from event_documents where id = (select id from man)),
  array['events@client.test', 'ops@client.test'], 'the document records the client''s recipients only');

-- =====================================================================
-- 5 · The automatic D1, and its "(updated)" resend
-- =====================================================================
update settings
   set value = jsonb_set(jsonb_set(value, '{allocation,time}', '"00:00"'), '{completed,not_before}', 'null')
 where key = 'document_autosend';
-- The manual copy a week back, so it does not stand the automatic one down.
update event_documents set queued_at = now() - interval '8 days' where id = (select id from man);
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
select is((select verdict from event_documents_due(now(), :'ev') where kind = 'allocation'), 'due', 'the automatic D1 is due');
select ok(event_document_autosend_claim(:'ev', 'allocation'), 'claimed');
create temp table auto1 as
  select record_event_document_autosend(:'ev', 'allocation', :'ev' || '/allocation/auto.pdf', 'A.pdf', 1, 1) as id;
create temp table aq as select queue_event_document_autosend((select id from auto1)) as q;
reset role;
select results_eq($$ select q->>'queued', q->'bcc' from aq $$,
  $$ values ('true'::text, '["sam.copy@thc-office.test"]'::jsonb) $$, 'queued, and the answer names the copy');
select results_eq(format($$ select recipient_emails, payload->'bcc' from notification_outbox where key = 'D1:auto:%s' $$, :'ev'),
  $$ values (array['events@client.test', 'ops@client.test'], '["sam.copy@thc-office.test"]'::jsonb) $$,
  'the automatic D1 carries the office copy');

-- The line-up's window moves after the send: an updated sheet is due.
update shift_requirements set ends_at = pg_temp.uk(:'today'::date + 1, '17:00') where id = :'sec';
set local role service_role;
select is((select verdict from event_documents_due(now(), :'ev') where kind = 'allocation'), 'due', 'changed after the send: due again');
select ok(event_document_autosend_claim(:'ev', 'allocation'), 'claimed again');
create temp table auto2 as
  select record_event_document_autosend(:'ev', 'allocation', :'ev' || '/allocation/auto2.pdf', 'A2.pdf', 1, 1) as id;
create temp table aq2 as select queue_event_document_autosend((select id from auto2)) as q;
reset role;
select results_eq(format($$ select payload->>'updateTag', payload->'bcc' from notification_outbox where key = 'D1:auto:%s:2' $$, :'ev'),
  $$ values (' (updated)'::text, '["sam.copy@thc-office.test"]'::jsonb) $$,
  'the "(updated)" resend carries it too');

-- =====================================================================
-- 6 · Off again: no bcc key at all
-- =====================================================================
update settings set value = '{"emails": []}' where key = 'document_office_copy';
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table man3 as
  select record_event_document(:'ev', 'allocation', :'ev' || '/allocation/man3.pdf', 'M3.pdf', 1, 1) as id;
create temp table mq3 as select queue_event_document_email((select id from man3)) as q;
reset role;
select is((select q->'bcc' from mq3), '[]'::jsonb, 'the Send answers nobody copied');
select ok((select not payload ? 'bcc' from notification_outbox where key = (select q->>'key' from mq3)),
  'and the row has no bcc key');
-- Only the client's own addresses, which are never copied.
update settings set value = '{"emails": ["events@client.test"]}' where key = 'document_office_copy';
select is(document_office_copy(event_document_recipients(:'ev')), '{}'::text[],
  'a copy list wholly inside To copies nobody');
update settings set value = jsonb_build_object('emails', array[:'sam']) where key = 'document_office_copy';

-- =====================================================================
-- 7 · Nothing the Client Portal reads ever names the copy address
-- =====================================================================
-- Every client_* view, read as the client, row by row as text.
create function pg_temp.mentions(p_needle text) returns int
language plpgsql as $$
declare
  v record;
  n int := 0;
  c int;
begin
  for v in select viewname from pg_views where schemaname = 'public' and viewname like 'client\_%' loop
    begin
      execute format('select count(*) from public.%I t where t::text ilike %L', v.viewname, '%' || p_needle || '%') into c;
      n := n + c;
    exception when insufficient_privilege then
      null;   -- a view the client cannot read at all cannot show it either
    end;
  end loop;
  return n;
end $$;
grant execute on function pg_temp.mentions(text) to authenticated;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select timesheet_recipients from client_events_v where id = :'ev'),
  array['events@client.test', 'ops@client.test'], 'the client sees its own timesheet recipients, and only those');
select ok((select count(*) from client_account_v) > 0, 'its account row is there to read');
select is(pg_temp.mentions('thc-office.test'), 0, 'no client_* view row names the copy address');
select is(pg_temp.mentions('events@client.test') > 0, true, 'while the same search finds the client''s own address (not vacuous)');
select is((select count(*)::int from notification_outbox where payload ? 'bcc'), 0, 'the outbox rows are not the client''s to read');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from notification_outbox where payload ? 'bcc'), 0, 'nor a worker''s');
reset role;

select is(event_document_recipients(:'ev'), array['events@client.test', 'ops@client.test'],
  'event_document_recipients() is the client''s list, unchanged');

select * from finish();
rollback;
