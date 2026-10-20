-- =====================================================================
-- 909 · Invoices, sent with the completed timesheet — ADR-0175,
--       20261022100000_invoices_sent.sql
--
-- November 2024 (GMT), go-live moved back to 1 Jan 2024 for the test.
-- Client A, Waiting Staff at £22.97/h, each worked shift 12:00–16:00 = 91.88.
--
--   PO-77   Tue 12 + Thu 14 Nov, clean, two workers each  → ONE invoice,
--           sent 10:00 Fri 15 Nov (the morning after the last)
--   (none)  Wed 13 Nov, clean, one worker                  → its own invoice
--   PO-88   Fri 15 Nov, one Late violation                 → waits for sign-off
--   (none)  Sat 16 Nov, an unresolved No check-out         → missing
--   (none)  Sun 10 Nov 2023 … before go-live              → never invoiced
-- =====================================================================
begin;
select plan(57);
\ir _shared/fixtures.psql

\set r_wait '90900000-0000-4000-8000-000000000001'
\set w1 '90910000-0000-4000-8000-000000000001'
\set w2 '90910000-0000-4000-8000-000000000002'
\set sched_uid '90920000-0000-4000-8000-000000000001'

insert into auth.users (id, email) values (:'sched_uid', 'sched.909@rls.test');
insert into profiles (id, role, office_role, full_name) values (:'sched_uid', 'admin', 'scheduler', 'Sam Scheduler');

insert into roles (id, name, description, pay_rate) values (:'r_wait', 'Invoice Waiting Staff', 'fixture', 14.00);
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'w1', 90901, 'Ana', 'Ames',  'v-w1@rls.test', '+447700990901', date '1996-05-01', 'compliant'),
  (:'w2', 90902, 'Bo',  'Brook', 'v-w2@rls.test', '+447700990902', date '1997-06-02', 'compliant');

update settings set value = value || jsonb_build_object('first_event_date', '2024-01-01')
 where key = 'invoicing';

create temp table ev (name text primary key, event_id uuid, shift_id uuid);
grant select on ev to authenticated, service_role;

create function pg_temp.event(p_name text, p_date date, p_po text)
returns uuid language plpgsql as $$
declare
  v_event uuid := gen_random_uuid();
  v_shift uuid := gen_random_uuid();
begin
  insert into events (id, client_id, venue_name, venue_address, venue_location, geofence_radius_m,
                      title, event_date, pays_breaks, pays_buffer, po_number)
  values (v_event, 'aaaaaaaa-0000-4000-8000-000000000001', 'Invoice Venue', '1 Invoice St, London',
          st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150,
          'Invoice ' || p_name, p_date, true, false, p_po);
  insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                  charge_rate, pay_rate, allocation_per_hour)
  values (v_shift, v_event, '90900000-0000-4000-8000-000000000001',
          p_date + time '12:00', p_date + time '16:00', 2, 0, 22.97, 14.00, 1);
  insert into ev values (p_name, v_event, v_shift);
  return v_shift;
end $$;

create function pg_temp.worked(p_shift uuid, p_staff uuid, p_day date, p_out boolean default true)
returns uuid language plpgsql as $$
declare v_booking uuid := gen_random_uuid();
begin
  insert into bookings (id, shift_id, staff_id, status, source, confirmed_at)
  values (v_booking, p_shift, p_staff, 'worked', 'manual', p_day - 7);
  insert into check_logs (booking_id, attempted_at, outcome, check_in_at, check_out_at)
  values (v_booking, p_day + time '12:00', 'checked_in', p_day + time '12:00',
          case when p_out then p_day + time '16:00' end);
  return v_booking;
end $$;

create temp table bk (name text primary key, id uuid);
grant select on bk to authenticated, service_role;

select pg_temp.event('Tue', date '2024-11-12', 'PO-77');
select pg_temp.event('Wed', date '2024-11-13', null);
select pg_temp.event('Thu', date '2024-11-14', ' po-77 ');   -- the same PO, typed differently
select pg_temp.event('Fri', date '2024-11-15', 'PO-88');
select pg_temp.event('Sat', date '2024-11-16', null);
select pg_temp.event('Old', date '2023-11-10', null);
insert into bk values
  ('tue1', pg_temp.worked((select shift_id from ev where name = 'Tue'), :'w1', date '2024-11-12')),
  ('tue2', pg_temp.worked((select shift_id from ev where name = 'Tue'), :'w2', date '2024-11-12')),
  ('wed1', pg_temp.worked((select shift_id from ev where name = 'Wed'), :'w1', date '2024-11-13')),
  ('thu1', pg_temp.worked((select shift_id from ev where name = 'Thu'), :'w1', date '2024-11-14')),
  ('thu2', pg_temp.worked((select shift_id from ev where name = 'Thu'), :'w2', date '2024-11-14')),
  ('fri1', pg_temp.worked((select shift_id from ev where name = 'Fri'), :'w1', date '2024-11-15')),
  ('sat1', pg_temp.worked((select shift_id from ev where name = 'Sat'), :'w2', date '2024-11-16', false)),
  ('old1', pg_temp.worked((select shift_id from ev where name = 'Old'), :'w2', date '2023-11-10'));
insert into violations (staff_id, booking_id, type, minutes_late)
  select :'w1', id, 'late', 0 from bk where name = 'fri1';
insert into violations (staff_id, booking_id, type)
  select :'w2', id, 'no_checkout' from bk where name = 'sat1';

create function pg_temp.verdict(p_name text, p_now timestamptz) returns text language sql as $$
  select g.verdict from _invoice_groups(p_now) g
   where (select event_id from ev where name = p_name) = any (g.event_ids)
$$;
create function pg_temp.gkey(p_name text, p_now timestamptz) returns text language sql as $$
  select g.group_key from _invoice_groups(p_now) g
   where (select event_id from ev where name = p_name) = any (g.event_ids)
$$;
grant execute on function pg_temp.gkey(text, timestamptz) to authenticated, service_role;
grant execute on function pg_temp.verdict(text, timestamptz) to authenticated, service_role;

-- =====================================================================
-- 1-7 · The client card's accounts contact
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select set_client_invoice_details('aaaaaaaa-0000-4000-8000-000000000001', 'x', '{}', null) $$,
  '42501', 'admins_only', 'a worker cannot set a client''s invoice details');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select set_client_invoice_details('aaaaaaaa-0000-4000-8000-000000000001', 'Paul Jordan',
                     array['not-an-email'], null) $$,
  '22023', 'invalid_invoice_email', 'an address that is not an email is refused');
select lives_ok($$ select set_client_invoice_details('aaaaaaaa-0000-4000-8000-000000000001', ' Paul Jordan ',
                     array[' PJordan@Client.test ', 'accounts@client.test', ''], '66 Knightsbridge, London SW1X 7LA') $$,
  'an office manager sets the accounts contact, emails and address');
reset role;
select is((select accounts_contact_name from clients where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'Paul Jordan', 'the contact is trimmed');
select is((select invoice_emails from clients where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  array['accounts@client.test', 'pjordan@client.test'], 'emails are trimmed, lower-cased, de-duplicated, blanks dropped');
select is((select billing_address from clients where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  '66 Knightsbridge, London SW1X 7LA', 'the billing address is kept');
select is((select count(*)::int from audit_log where action = 'client.invoice_details'
            and entity_id = 'aaaaaaaa-0000-4000-8000-000000000001'), 1, 'the change is audited');

-- =====================================================================
-- 8-19 · The groups and the 10:00 rule
-- =====================================================================
select is((select next_number from invoice_counter), 4000, 'numbering starts at 4000');

select is(pg_temp.verdict('Tue', '2024-11-13 09:00+00'), 'waiting',
  'Tue''s PO waits while Thu, on the same PO, has not happened');
select is(pg_temp.gkey('Tue', '2024-11-13 09:00+00'), pg_temp.gkey('Thu', '2024-11-13 09:00+00'),
  'Tue and Thu are one group: the PO matches whatever its case and spacing');
select is(pg_temp.verdict('Wed', '2024-11-14 09:59+00'), 'scheduled',
  'an event without a PO is its own invoice, scheduled for 10:00 the morning after');
select is(pg_temp.verdict('Wed', '2024-11-14 10:00+00'), 'due', 'and due at 10:00 UK');
select is(pg_temp.verdict('Tue', '2024-11-15 09:00+00'), 'scheduled',
  'once Thu has closed, the PO is scheduled for 10:00 the morning after Thu');
select is((select due_at from _invoice_groups('2024-11-15 09:00+00') g where g.group_key = pg_temp.gkey('Tue', '2024-11-15 09:00+00')),
  '2024-11-15 10:00+00'::timestamptz, 'at 10:00 UK on Fri 15');
select is(pg_temp.verdict('Tue', '2024-11-15 10:05+00'), 'due', 'and due at 10:05');
select is((select array_length(event_ids, 1) from _invoice_groups('2024-11-15 10:05+00') g
            where g.group_key = pg_temp.gkey('Tue', '2024-11-15 10:05+00')), 2, 'the PO invoice covers both days');
select is((select net from _invoice_groups('2024-11-15 10:05+00') g
            where g.group_key = pg_temp.gkey('Tue', '2024-11-15 10:05+00')), 367.52::numeric, 'four shifts × 91.88');
select is(pg_temp.verdict('Fri', '2024-11-16 10:05+00'), 'review',
  'an event with a violation waits for a manager''s sign-off');
select is(pg_temp.verdict('Sat', '2024-11-17 10:05+00'), 'missing', 'an unresolved No check-out holds its invoice');
select is(pg_temp.verdict('Old', '2024-11-17 10:05+00'), null, 'an event before go-live is never invoiced');

-- =====================================================================
-- 20-31 · Issuing: numbers, lines, totals, the email
-- =====================================================================
create temp table inv (name text primary key, id uuid);
grant all on inv to authenticated, service_role;

set local role service_role;
insert into inv values ('po77', invoice_claim(pg_temp.gkey('Tue', '2024-11-15 10:05+00'), '2024-11-15 10:05+00'));
reset role;
select is((select number from invoices where id = (select id from inv where name = 'po77')), 4000,
  'the first invoice is number 4000');
set local role service_role;
select is(invoice_claim(pg_temp.gkey('Wed', '2024-11-15 10:06+00'), '2024-11-15 10:06+00') is not null, true,
  'the next group is issued too');
reset role;
select is((select max(number) from invoices), 4001, 'and numbered 4001: no gaps');
select is((select count(*)::int from invoice_event_links where invoice_id = (select id from inv where name = 'po77')),
  2, 'both PO days are linked to the invoice');
select is((select count(*)::int from invoice_lines where invoice_id = (select id from inv where name = 'po77')),
  4, 'one line per shift');
select is((select row(net, vat_rate, vat, total)::text from invoices where id = (select id from inv where name = 'po77')),
  row(367.52::numeric(12,2), 20.00::numeric(5,2), 73.50::numeric(12,2), 441.02::numeric(12,2))::text,
  'net, VAT at 20% and total');
select is((select row(invoice_date, due_date)::text from invoices where id = (select id from inv where name = 'po77')),
  row(date '2024-11-15', date '2024-11-22')::text, 'dated the day it is sent, payable within 7 days');
select is((select bill_to ->> 'contact' from invoices where id = (select id from inv where name = 'po77')),
  'Paul Jordan', 'addressed to the accounts contact');
select is((select recipients from invoices where id = (select id from inv where name = 'po77')),
  array['accounts@client.test', 'pjordan@client.test'], 'sent to the invoice emails');
select is((select seller -> 'bank' ->> 'sort_code' from invoices where id = (select id from inv where name = 'po77')),
  '30-15-99', 'THC''s bank details are on it as issued');

set local role service_role;
select is(invoice_claim(pg_temp.gkey('Tue', '2024-11-15 10:05+00'), '2024-11-15 10:10+00'), null::uuid,
  'a group already invoiced cannot be issued twice');
select throws_ok(format($$ select queue_invoice_email(%L) $$, (select id from inv where name = 'po77')),
  'P0001', 'invoice_has_no_files', 'no email before the PDF is stored');
select lives_ok(format($$ select invoice_record_files(%L, 'invoices/4000/x.pdf', 'Invoice 4000.pdf',
                   '[{"bucket":"timesheets","path":"invoices/4000/x.pdf","filename":"Invoice 4000.pdf"}]') $$,
                   (select id from inv where name = 'po77')), 'the files are recorded');
select is((queue_invoice_email((select id from inv where name = 'po77')) ->> 'queued')::boolean, true, 'the email is queued');
select is((queue_invoice_email((select id from inv where name = 'po77')) ->> 'queued')::boolean, false,
  'once: a second call queues nothing');
reset role;
select is((select row(template, recipient_emails, payload ->> 'invoiceNumber', payload ->> 'total')::text
             from notification_outbox where key = 'INV1:4000'),
  row('INV1', array['accounts@client.test', 'pjordan@client.test'], '4000', '441.02')::text,
  'INV1:4000 carries the number and the total to the accounts emails');
select is((select status from invoices where id = (select id from inv where name = 'po77')), 'queued', 'and the invoice is queued');

-- =====================================================================
-- 32-38 · The office's list and the sign-off
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table il as
  select i.*, e.name from invoice_events('2024-11-01', '2024-11-30') i join ev e on e.event_id = i.event_id;
reset role;
select is((select status from il where name = 'Tue'), 'invoiced', 'an invoiced event says so');
select is((select invoice_number from il where name = 'Thu'), 4000, 'with its invoice number');
select is((select needs_signoff from il where name = 'Fri'), true, 'an event with a violation needs a sign-off');
select is((select status from il where name = 'Fri'), 'review', 'and waits for it');
select is((select status from il where name = 'Sat'), 'missing', 'a missing check-out is missing');

set local role authenticated;
select throws_ok(format($$ select sign_off_event_invoice(%L, 'checked', %L) $$,
         (select event_id from il where name = 'Tue'), (select fingerprint from il where name = 'Tue')),
  'P0001', 'already_invoiced', 'an invoiced event cannot be signed off again');
select is((sign_off_event_invoice((select event_id from il where name = 'Fri'), 'Late agreed',
           (select fingerprint from il where name = 'Fri')) ->> 'decision'), 'signed_off', 'Fri is signed off');
reset role;
select is(pg_temp.verdict('Fri', '2024-11-16 10:05+00'), 'due', 'and its invoice is then due');

-- =====================================================================
-- 40-43 · A failed run and the retry
-- =====================================================================
set local role service_role;
insert into inv values ('po88', invoice_claim(pg_temp.gkey('Fri', '2024-11-16 10:05+00'), '2024-11-16 10:05+00'));
select lives_ok(format($$ select invoice_release(%L, 'storage down') $$, (select id from inv where name = 'po88')),
  'a run that failed releases its invoice');
reset role;
select is((select row(number, status, attempts)::text from invoices where id = (select id from inv where name = 'po88')),
  row(4002, 'failed', 1)::text, 'which keeps its number and says it failed');
set local role service_role;
select is((select count(*)::int from invoices_unfinished('2024-11-16 10:20+00') x
            where x in ((select id from inv where name = 'po88'),
                        (select id from invoices where number = 4001))), 2,
  'the next run picks up the failed one, and 4001 whose lease ran out while it was still drawing');
reset role;

-- =====================================================================
-- 44-52 · Who may see and do what
-- =====================================================================
select ok(not has_function_privilege('authenticated', 'public.invoice_claim(text,timestamptz)', 'execute'),
  'a signed-in caller cannot issue an invoice');
select ok(not has_function_privilege('authenticated', 'public.queue_invoice_email(uuid)', 'execute'),
  'nor queue its email');
select ok(not has_function_privilege('anon', 'public.invoice_file(uuid)', 'execute'), 'anon cannot download one');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from invoices), 0, 'a worker reads no invoice');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from invoices), 0, 'nor a client (ADR-0004: the portal carries no money)');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'sched_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from invoice_lines), 0, 'nor a scheduler (ADR-0056)');
select throws_ok(format($$ select * from invoice_file(%L) $$, (select id from inv where name = 'po77')),
  '42501', 'not_permitted', 'and a scheduler cannot download one');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select file_name from invoice_file((select id from inv where name = 'po77'))), 'Invoice 4000.pdf',
  'a finance admin can');
reset role;

update settings set value = value || jsonb_build_object('enabled', false) where key = 'invoicing';
select is(pg_temp.verdict('Sat', '2024-11-17 10:05+00'), 'disabled', 'switched off in settings, nothing is due');

select * from finish();
rollback;
