-- =====================================================================
-- 773 · The office email log (20261005120500, ADR-0086)
--
--   1. Shape: security definer, search_path pinned, no anon grant.
--   2. Only a Back Office login reads it: a worker, a client and anon get
--      nothing (and 001_rls_guard's policy set on notification_outbox is
--      untouched — this adds no policy).
--   3. Email rows only, never a push.
--   4. The recipient resolves: by the row's staff id, by the key, by the
--      application behind an E2 key, by the address; a removed profile is
--      "Deleted account #id" with no address; an unknown address is left
--      unresolved (the "she is not in the system" case).
--   5. No link leaves it: the payload comes back reduced to the values that
--      fill the subject line, and a URL in an error is stripped.
--   6. Search by address, name and Employee ID; LIKE wildcards are literal.
--   7. Filters: audience codes, status, period, paging.
--   8. The failed-in-period count.
-- =====================================================================
begin;
select plan(39);
\ir _shared/fixtures.psql

\set unknown_staff '9f9f9f9f-0000-4000-8000-0000007730aa'

-- Keep seed.sql's rows out of the way: every assertion below looks only at
-- the keys this file inserts.
insert into notification_outbox (key, channel, template, recipient_staff_id, recipient_emails, payload, sent_at, failed_at, error) values
  -- E3 to a candidate, named by its key; carries a live activation link.
  ('E3:staff:' || :'staffa' || ':773', 'email', 'E3', null, array['staffa@rls.test'],
   jsonb_build_object('name', 'Staff', 'link', 'https://app.example/activate/SECRET773TOKEN',
                      'installLink', 'https://app.example/install'),
   now(), null, null),
  -- E2 rejection: no staff id, only the application behind the key.
  ('E2:application:' || :'applic_a', 'email', 'E2', null, array['staffa@rls.test'],
   jsonb_build_object('name', 'Staff'), null, null, null),
  -- An address nobody holds: she is not in the system.
  ('E3:resend:' || :'unknown_staff' || ':1', 'email', 'E3', null, array['Nobody773@Example.com'],
   jsonb_build_object('name', 'Nova', 'link', 'https://app.example/activate/SECRET773B'),
   null, null, 'not configured: RESEND_API_KEY is not set'),
  -- A login invitation to a Back Office user: link in the payload.
  ('E11:invite:' || :'new_id' || ':1', 'email', 'E11', null, array['new.login773@example.com'],
   jsonb_build_object('name', 'Pat', 'app', 'Back Office',
                      'link', 'https://office.example/auth/invite?token=SECRET773C'),
   null, now(), 'Resend answered 422: see https://resend.com/docs/x?token=SECRET773D now'),
  -- A removed worker's quiz email.
  ('E4:quiz_attempt:773', 'email', 'E4', :'staffb', array['staffb@rls.test'],
   jsonb_build_object('name', 'Staff'), now(), null, null),
  -- A client's timesheet, with a storage-path attachment.
  ('D1:document:773', 'email', 'D1', null, array['events@clienta.test'],
   jsonb_build_object('event', 'Gala Dinner', 'client', 'RLS Fixture Client A',
                      'date', 'Friday 9 October 2026', 'poSuffix', ' (PO 4471-A)',
                      'attachments', '[{"bucket":"timesheets","path":"secret/path.pdf"}]'),
   now(), null, null),
  -- A push: never in the email log.
  ('N5:invite:773', 'push', 'N5', :'staffa', null,
   jsonb_build_object('rate', '£14.00'), null, null, null);

update staff set removed_at = now() where id = :'staffb';

create temporary table t_keys as
  select key from notification_outbox where key in (
    'E3:staff:' || :'staffa' || ':773', 'E2:application:' || :'applic_a',
    'E3:resend:' || :'unknown_staff' || ':1', 'E11:invite:' || :'new_id' || ':1',
    'E4:quiz_attempt:773', 'D1:document:773', 'N5:invite:773');
grant select on t_keys to authenticated, anon;

-- ---------------------------------------------------------------------
-- 1 · Shape and grants
-- ---------------------------------------------------------------------
select ok((select p.prosecdef from pg_proc p where p.oid =
  'public.office_email_log(text[],text,timestamptz,bigint,text,integer)'::regprocedure),
  'office_email_log is security definer');
select ok((select p.proconfig @> array['search_path=public'] from pg_proc p where p.oid =
  'public.office_email_log(text[],text,timestamptz,bigint,text,integer)'::regprocedure),
  'with its search_path pinned');
select ok(not has_function_privilege('anon',
  'public.office_email_log(text[],text,timestamptz,bigint,text,integer)', 'execute'),
  'anon cannot execute it');
select ok(not has_function_privilege('anon',
  'public.office_email_failures(text[],timestamptz,text)', 'execute'),
  'nor the failure count');

-- ---------------------------------------------------------------------
-- 2 · Who may read it
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from office_email_log() l join t_keys k on k.key = l.key), 0,
  'a worker reads no email');
select is(office_email_failures(array['E3', 'E11']), 0, 'and counts no failures');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select is((select count(*)::int from office_email_log() l join t_keys k on k.key = l.key), 0,
  'a client reads no email');
select is(office_email_failures(array['E3', 'E11']), 0, 'and counts no failures');
reset role;

select set_config('request.jwt.claims', '{}', true);
set local role anon;
select throws_ok($$ select * from office_email_log() $$, '42501', null, 'anon is refused');
reset role;

-- ---------------------------------------------------------------------
-- 3-5 · As the office
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*)::int from office_email_log() l join t_keys k on k.key = l.key), 6,
  'the office reads the six emails, and the push is not among them');
select is((select count(*)::int from office_email_log() l where l.template = 'N5'), 0,
  'no push row');

select is((select l.staff_id from office_email_log() l where l.key = 'E3:staff:' || :'staffa' || ':773'),
  :'staffa'::uuid, 'an E3 resolves to the worker its key names');
select is((select l.recipient_name from office_email_log() l where l.key = 'E3:staff:' || :'staffa' || ':773'),
  'Staff Alpha', 'with their name');
select is((select l.staff_status from office_email_log() l where l.key = 'E3:staff:' || :'staffa' || ':773'),
  'compliant', 'and status, which the screen turns into the right profile link');
select is((select l.staff_id from office_email_log() l where l.key = 'E2:application:' || :'applic_a'),
  :'staffa'::uuid, 'an E2 resolves through the application behind its key');

select is((select l.staff_id from office_email_log() l where l.key = 'E3:resend:' || :'unknown_staff' || ':1'),
  null, 'an address nobody holds resolves to no record (the candidate who is not in the system)');
select is((select l.recipient_emails from office_email_log() l where l.key = 'E3:resend:' || :'unknown_staff' || ':1'),
  array['Nobody773@Example.com'], 'and the address it was sent to is shown as sent');

select is((select l.recipient_name from office_email_log() l where l.key = 'E4:quiz_attempt:773'),
  'Deleted account #90002', 'a removed worker reads Deleted account #id');
select is((select l.recipient_emails from office_email_log() l where l.key = 'E4:quiz_attempt:773'),
  null, 'and shows no address');

select is((select count(*)::int from office_email_log() l
            where l.payload::text ~* '(SECRET773|activate/|installLink|"link"|rate|secret/path|attachments)'), 0,
  'no link, install link, attachment path or rate leaves the log, in any row');
select is((select l.payload from office_email_log() l where l.key = 'E11:invite:' || :'new_id' || ':1'),
  jsonb_build_object('name', 'Pat', 'app', 'Back Office'),
  'an E11 comes back as its name and app only: what the subject needs');
select is((select l.payload ->> 'poSuffix' from office_email_log() l where l.key = 'D1:document:773'),
  ' (PO 4471-A)', 'a client email keeps the values its subject needs');
select is((select l.error from office_email_log() l where l.key = 'E11:invite:' || :'new_id' || ':1'),
  'Resend answered 422: see [link removed] now', 'a URL in an error is stripped');
select is((select l.error from office_email_log() l where l.key = 'E3:resend:' || :'unknown_staff' || ':1'),
  'not configured: RESEND_API_KEY is not set', 'and an error without one is untouched');

-- ---------------------------------------------------------------------
-- 6 · Search
-- ---------------------------------------------------------------------
select is((select array_agg(l.key order by l.key) from office_email_log(p_search => 'nobody773') l
            join t_keys k on k.key = l.key),
  array['E3:resend:' || :'unknown_staff' || ':1'], 'search finds an address, whatever its case');
select is((select count(*)::int from office_email_log(p_search => 'Alpha') l
            join t_keys k on k.key = l.key), 2, 'search finds a worker by name: both emails to them');
select is((select count(*)::int from office_email_log(p_search => '90001') l
            join t_keys k on k.key = l.key), 2, 'and by Employee ID');
select is((select count(*)::int from office_email_log(p_search => 'Nova') l
            join t_keys k on k.key = l.key), 1, 'and by the name the email carried when no record matches');
select is((select count(*)::int from office_email_log(p_search => '%') l
            join t_keys k on k.key = l.key), 0, 'a % in the search is a character, not a wildcard');
select is((select count(*)::int from office_email_log(p_search => 'no_ody773') l
            join t_keys k on k.key = l.key), 0, 'and so is an underscore');
select is((select count(*)::int from office_email_log(p_search => 'staffb') l
            join t_keys k on k.key = l.key), 0, 'a removed profile is not found by its address');

-- ---------------------------------------------------------------------
-- 7 · Filters
-- ---------------------------------------------------------------------
select is((select array_agg(l.key order by l.key) from office_email_log(p_templates => array['E3']) l
            join t_keys k on k.key = l.key),
  array['E3:resend:' || :'unknown_staff' || ':1', 'E3:staff:' || :'staffa' || ':773'],
  'by code');
select is((select count(*)::int from office_email_log(p_status => 'failed') l join t_keys k on k.key = l.key), 1,
  'by status: failed');
select is((select count(*)::int from office_email_log(p_status => 'sent') l join t_keys k on k.key = l.key), 3,
  'sent');
select is((select count(*)::int from office_email_log(p_status => 'queued') l join t_keys k on k.key = l.key), 2,
  'queued, which includes the held one');
select is((select count(*)::int from office_email_log(p_since => now() + interval '1 hour') l), 0,
  'by period: nothing since an hour from now');
select is((select count(*)::int from office_email_log(p_limit => 2)), 2, 'a page is as long as asked');

-- ---------------------------------------------------------------------
-- 8 · The failure count
-- ---------------------------------------------------------------------
select is(office_email_failures(array['E11'], now()), 1, 'one E11 failed this transaction');
select is(office_email_failures(array['E11'], now(), 'Resend answered 422: see https://resend.com/docs/x?token=SECRET773D now'),
  0, 'unless the office switched it off: that error is not counted');
reset role;

select * from finish();
rollback;
