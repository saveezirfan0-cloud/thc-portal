-- =====================================================================
-- 910 · A new client is created with its invoicing contact — ADR-0176
--       (amended 21.10.2026), 20261022130000_client_invoicing_contact_required.sql
--
-- THC, 21.10.2026: the invoicing contact is compulsory on a new client,
-- many clients take the invoice at several addresses, and a client with
-- no invoice email is invoiced at the main contact's.
-- =====================================================================
begin;
select plan(20);
\ir _shared/fixtures.psql

\set sched_uid '91020000-0000-4000-8000-000000000001'
insert into auth.users (id, email) values (:'sched_uid', 'sched.910@rls.test');
insert into profiles (id, role, office_role, full_name) values (:'sched_uid', 'admin', 'scheduler', 'Sam Scheduler');

-- =====================================================================
-- 1-4 · No client without somewhere to send its invoices
-- =====================================================================
select hasnt_function('public', 'create_client',
  array['text', 'text', 'text', 'text', 'text[]', 'boolean', 'boolean'],
  'the seven-argument create_client is gone, so no caller can skip the invoicing contact');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select create_client('No Invoice Ltd', 'Nia N', '020 7946 0000', 'Desk',
                     array['nia@noinv.test'], true, true, '{}'::text[]) $$,
  '22023', 'invoice_email_required', 'a client with no invoice email is refused');
select throws_ok($$ select create_client('No Invoice Ltd', 'Nia N', '020 7946 0000', 'Desk',
                     array['nia@noinv.test'], true, true, array['  ', '']) $$,
  '22023', 'invoice_email_required', 'blanks are not an invoice email');
select throws_ok($$ select create_client('No Invoice Ltd', 'Nia N', '020 7946 0000', 'Desk',
                     array['nia@noinv.test'], true, true, null) $$,
  '22023', 'invoice_email_required', 'nor is none at all');

-- =====================================================================
-- 5-8 · Several addresses, checked like the card's panel checks them
-- =====================================================================
select throws_ok($$ select create_client('Bad Invoice Ltd', 'B', '020 7946 0000', 'Desk',
                     array['b@bad.test'], true, true, array['accounts@bad.test', 'not-an-email']) $$,
  '22023', 'invalid_invoice_email', 'an invoice address that is not one is refused');
select throws_ok($$ select create_client('Eleven Ltd', 'E', '020 7946 0000', 'Desk', array['e@eleven.test'], true, true,
                     array['i1@e.test','i2@e.test','i3@e.test','i4@e.test','i5@e.test','i6@e.test',
                           'i7@e.test','i8@e.test','i9@e.test','i10@e.test','i11@e.test']) $$,
  '22023', 'too_many_invoice_emails', 'eleven invoice emails are refused');
select lives_ok($$ select create_client('Ten Ltd', 'T', '020 7946 0000', 'Desk', array['t@ten.test'], true, true,
                     array['i1@t.test','i2@t.test','i3@t.test','i4@t.test','i5@t.test','i6@t.test',
                           'i7@t.test','i8@t.test','i9@t.test','i10@t.test']) $$,
  'ten are accepted — many clients send the invoice to several people');
select throws_ok($$ insert into clients (name, contact_name, phone, staff_contact_point, contact_emails,
                                         pays_breaks, pays_buffer, invoice_emails)
                   values ('Direct Ltd', 'D', '020 7946 0000', 'Desk', array['d@d.test'], true, true,
                           array['i1@d.test','i2@d.test','i3@d.test','i4@d.test','i5@d.test','i6@d.test',
                                 'i7@d.test','i8@d.test','i9@d.test','i10@d.test','i11@d.test']) $$,
  '23514', null, 'and the table holds the same ceiling (clients_invoice_emails_max)');

-- =====================================================================
-- 9-14 · What a new client keeps
-- =====================================================================
select create_client('Savoy Events', 'Helena Ash', '020 7836 4343', 'Banqueting office',
                     array['helena@savoy.test'], false, true,
                     array[' Accounts@Savoy.test ', 'ap@savoy.test', 'accounts@savoy.test'],
                     ' Accounts Payable ', ' The Strand, London WC2R 0EZ ') as savoy \gset
reset role;
select is((select invoice_emails from clients where id = :'savoy'),
  array['accounts@savoy.test', 'ap@savoy.test'], 'invoice emails are trimmed, lower-cased and de-duplicated');
select is((select accounts_contact_name from clients where id = :'savoy'), 'Accounts Payable',
  'the accounts contact is kept, trimmed');
select is((select billing_address from clients where id = :'savoy'), 'The Strand, London WC2R 0EZ',
  'and the billing address');
select is((select data -> 'invoiceEmails' from audit_log where action = 'client.created' and entity_id = :'savoy'),
  '["accounts@savoy.test", "ap@savoy.test"]'::jsonb, 'client.created records where its invoices go');

set local role authenticated;
select create_client('Name Optional Ltd', 'Omar O', '020 7946 0000', 'Desk',
                     array['omar@opt.test'], true, true, array['ledger@opt.test']) as optional \gset
reset role;
select is((select accounts_contact_name from clients where id = :'optional'), null,
  'the accounts contact name is optional');
select is((select billing_address from clients where id = :'optional'), null, 'and so is the billing address');

-- =====================================================================
-- 15-17 · A scheduler adds a client with its invoicing contact, but
--         changing it afterwards is still finance's (ADR-0056)
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'sched_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$ select create_client('Sched Added Ltd', 'S', '020 7946 0000', 'Desk',
                     array['s@sched.test'], true, true, array['accounts@sched.test']) $$,
  'whoever may add a client may say where its invoices go');
select throws_ok(format($$ update clients set invoice_emails = array['me@sched.test'] where id = %L $$, :'savoy'),
  '42501', 'not_permitted', 'but a scheduler still cannot change them afterwards');
select throws_ok(format($$ select set_client_invoice_details(%L, 'x', array['me@sched.test'], null) $$, :'savoy'),
  '42501', 'not_permitted', 'nor through the card''s panel');
reset role;

-- =====================================================================
-- 18-20 · Ten on the card's panel; a client with none falls back to the
--         main contact (every client created before 22.10.2026)
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(format($$ select set_client_invoice_details(%L, null,
                     array['i1@s.test','i2@s.test','i3@s.test','i4@s.test','i5@s.test','i6@s.test',
                           'i7@s.test','i8@s.test','i9@s.test','i10@s.test'], null) $$, :'savoy'),
  'the card''s panel takes ten invoice emails too');
select throws_ok(format($$ select set_client_invoice_details(%L, null,
                     array['i1@s.test','i2@s.test','i3@s.test','i4@s.test','i5@s.test','i6@s.test',
                           'i7@s.test','i8@s.test','i9@s.test','i10@s.test','i11@s.test'], null) $$, :'savoy'),
  '22023', 'too_many_invoice_emails', 'and refuses eleven');
reset role;

select is((select invoice_emails from clients where id = :'clienta'), '{}'::text[],
  'a client from before this rule has no invoice email; it is invoiced at its contact emails (909)');

select * from finish();
rollback;
