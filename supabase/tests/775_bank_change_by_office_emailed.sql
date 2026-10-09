-- =====================================================================
-- 775 · Any change to bank details reaches Gisela and Payroll
--       20261005140500 · ADR-0092 (THC 05.10.2026)
--
-- The worker's own save already queues E5 (571, 330). Every OTHER write to
-- bank_details — an office login with the finance permission, the service
-- role — now queues E5b to the same two addresses, naming the worker and who
-- and never the sort code or account number; one change, one email.
-- =====================================================================
begin;
select plan(18);
\ir _shared/fixtures.psql

-- The fixtures insert both workers' bank rows as the owner, which (correctly) queues E5b.
-- Clear those so this file counts only its own changes.
delete from notification_outbox where template = 'E5b';
create temp table before_e5b as
  select count(*)::int as n from notification_outbox where template = 'E5b';

-- =====================================================================
-- 1 · An office login changes a worker's bank details directly
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
update bank_details set sort_code = '11-22-33', account_number = '99887766' where staff_id = :'staffa';
reset role;

select results_eq(
  format($$ select template, channel::text, recipient_emails from notification_outbox
             where template = 'E5b' and key like 'E5b:staff:%s:%%' $$, :'staffa'),
  $$ values ('E5b'::text, 'email', array['gisela@thehospitalitycompany.co.uk', 'thc_payroll@topsourceworldwide.com']) $$,
  'an office login''s change queues E5b to Gisela and Payroll, in the same transaction');
select is((select payload->>'changedBy' from notification_outbox
            where template = 'E5b' and key like 'E5b:staff:' || :'staffa' || ':%'),
  (select full_name from profiles where id = :'admin_uid'),
  'it names who changed it');
select ok((select payload ? 'name' and payload ? 'employeeId' and payload ? 'changedAt'
             from notification_outbox where template = 'E5b' and key like 'E5b:staff:' || :'staffa' || ':%'),
  'and the worker, their Employee ID and when');
select ok((select payload::text !~ '11-22-33|99887766|112233'
             from notification_outbox where template = 'E5b' and key like 'E5b:staff:' || :'staffa' || ':%'),
  'but never the sort code or the account number: the details stay in the platform');

-- =====================================================================
-- 2 · A write that changes nothing sends nothing
-- =====================================================================
set local role authenticated;
update bank_details set sort_code = '11-22-33' where staff_id = :'staffa';
update bank_details set updated_at = now() where staff_id = :'staffa';
reset role;
select is((select count(*)::int from notification_outbox where template = 'E5b' and key like 'E5b:staff:' || :'staffa' || ':%'), 1,
  'saving the same details again is not a change');

-- =====================================================================
-- 3 · The worker's own save is E5 and only E5 — one change, one email
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$ select staff_save_bank('Staff Alpha', '20-00-00', '55779911') $$, 'the worker saves through the Staff App');
reset role;
select is((select count(*)::int from notification_outbox where template = 'E5' and key like 'E5:staff:' || :'staffa' || ':%'), 1,
  'E5 is queued, as before');
select is((select count(*)::int from notification_outbox where template = 'E5b' and key like 'E5b:staff:' || :'staffa' || ':%'), 1,
  'and E5b is not: the trigger stands down for staff_save_bank, so no change is emailed twice');
select lives_ok($$ select staff_save_bank('Staff Alpha', '20-00-00', '55779911') $$ , 'saving again as a worker');
select is((select count(*)::int from notification_outbox where template = 'E5' and key like 'E5:staff:' || :'staffa' || ':%'), 1,
  'saving the same details again is not an update: still one E5 (ADR-0105)');

-- =====================================================================
-- 4 · The service role, with no login behind it
-- =====================================================================
delete from bank_details where staff_id = :'staffb';
select is((select count(*)::int from notification_outbox where template = 'E5b' and key like 'E5b:staff:' || :'staffb' || ':%'), 0,
  'a delete (the GDPR removal) is not a change and sends nothing');
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
insert into bank_details (staff_id, account_holder, sort_code, account_number)
values (:'staffb', 'Staff Beta', '30-00-00', '12345678');
reset role;
select is((select count(*)::int from notification_outbox where template = 'E5b' and key like 'E5b:staff:' || :'staffb' || ':%'), 0,
  'an insert by the service role is a first entry and sends nothing (THC 07.10.2026)');
set local role service_role;
update bank_details set sort_code = '30-00-01' where staff_id = :'staffb';
reset role;
select is((select payload->>'changedBy' from notification_outbox
            where template = 'E5b' and key like 'E5b:staff:' || :'staffb' || ':%'),
  'the system', 'an update by the service role says "the system" changed it');

-- =====================================================================
-- 5 · The totals, and the trigger is nobody's to call
-- =====================================================================
select is((select count(*)::int from notification_outbox where template = 'E5b') - (select n from before_e5b), 2,
  'two changes outside the app, two emails');
select ok(not has_function_privilege('authenticated', 'public.bank_details_notify_change()', 'execute')
          and not has_function_privilege('anon', 'public.bank_details_notify_change()', 'execute'),
  'the trigger function is not callable by anyone');
select is((select tgtype & 1 from pg_trigger where tgname = 'bank_details_notify_change'), 1,
  'a row-level trigger');
select is((select count(*)::int from pg_trigger where tgrelid = 'public.bank_details'::regclass and tgname = 'bank_details_notify_change'), 1,
  'exactly one');
select is((select count(*)::int from notification_outbox where template = 'E5b'
             and (recipient_emails is distinct from array['gisela@thehospitalitycompany.co.uk', 'thc_payroll@topsourceworldwide.com'])), 0,
  'every E5b goes to exactly those two addresses');

select * from finish();
rollback;
