-- =====================================================================
-- 522 · /apply throttled per caller
--   20260926100200_apply_caller_throttle.sql, ADR-0024 (§2.1, §1.7)
--
--   A. Nobody but the service role can call it, and no API role can see
--      the hash table — not the rows, not the schema.
--   B. 5 per hash per hour, 20 per 24 hours, from settings; another hash
--      is unaffected; a refused application is not counted.
--   C. §1.7: only a 64-hex digest is stored, never an address; hashes
--      older than the retention are purged by the next call.
-- =====================================================================
begin;
select plan(22);
\ir _shared/fixtures.psql

\set h_one   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
\set h_two   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
\set h_day   'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
\set h_old   'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'

-- =====================================================================
-- A · who can reach what
-- =====================================================================
select ok(not has_function_privilege('anon', 'public.submit_application_as_caller(text,text,text,text,date,boolean,text,text)', 'execute')
      and not has_function_privilege('authenticated', 'public.submit_application_as_caller(text,text,text,text,date,boolean,text,text)', 'execute'),
  'neither anon nor a signed-in account can call it — a hash anyone could send would be a limit anyone could dodge');
select ok(has_function_privilege('service_role', 'public.submit_application_as_caller(text,text,text,text,date,boolean,text,text)', 'execute'),
  'the Staff App server action (service key) can');
select ok(not has_schema_privilege('anon', 'private', 'usage')
      and not has_schema_privilege('authenticated', 'private', 'usage'),
  'the private schema is not usable by either API role');
select ok(not has_table_privilege('anon', 'private.apply_caller_hits', 'select')
      and not has_table_privilege('authenticated', 'private.apply_caller_hits', 'select')
      and not has_table_privilege('anon', 'private.apply_caller_hits', 'insert')
      and not has_table_privilege('authenticated', 'private.apply_caller_hits', 'insert'),
  'and the hash table grants them nothing');
select ok((select relrowsecurity from pg_class where oid = 'private.apply_caller_hits'::regclass),
  'RLS is on as well, with no policy');
select is((select count(*)::int from pg_policies where schemaname = 'private' and tablename = 'apply_caller_hits'), 0,
  'no policy at all');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select throws_ok($$ select count(*) from private.apply_caller_hits $$, '42501', null,
  'a signed-in worker reading the table is refused');
reset role;
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok(
  $$ select submit_application_as_caller('A','B','a@t522.test','+447700952201', date '1995-01-01', true,
       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') $$,
  '42501', null, 'anon calling it is refused');
reset role;

-- =====================================================================
-- B · the limits
-- =====================================================================
select is((select value from settings where key = 'apply_caller_throttle'),
  '{"per_day": 20, "per_hour": 5, "retention_hours": 48}'::jsonb, 'the limits are settings, not constants');

set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select lives_ok(format($$ select submit_application_as_caller('Cal', 'One', 'c%s@t522.test', '+44770095221%s',
                                   date '1995-01-01', true, %L) $$, n, n, :'h_one'))
  from generate_series(1, 5) n;
select throws_ok(
  $$ select submit_application_as_caller('Cal', 'Six', 'c6@t522.test', '+447700952216', date '1995-01-01', true,
       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') $$,
  '22023', 'We’ve received several applications from your connection recently. Please try again later — or email admin@thehospitalitycompany.co.uk and we’ll help.',
  'the sixth in an hour from one caller is refused, in words written for the applicant');
select lives_ok(
  $$ select submit_application_as_caller('Other', 'Caller', 'o1@t522.test', '+447700952230', date '1995-01-01', true,
       'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb') $$,
  'a different caller is unaffected');
select throws_ok(
  $$ select submit_application_as_caller('Too', 'Young', 'y@t522.test', '+447700952231', current_date - 365, true,
       'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb') $$,
  '22023', 'You must be 18 or over to apply.', 'every rule of submit_application still applies');
reset role;
select is((select count(*)::int from private.apply_caller_hits where caller_hash = :'h_two'), 1,
  'a refused application is not counted — only accepted ones are');

-- 20 in the last day, none in the last hour
insert into private.apply_caller_hits (caller_hash, at)
select :'h_day', now() - make_interval(hours => 2 + n) from generate_series(1, 20) n;
set local role service_role;
select throws_ok(
  $$ select submit_application_as_caller('Day', 'Cap', 'd@t522.test', '+447700952240', date '1995-01-01', true,
       'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc') $$,
  '22023', null, 'the day cap holds even with a quiet last hour');

-- =====================================================================
-- C · §1.7
-- =====================================================================
select throws_ok(
  $$ select submit_application_as_caller('Raw', 'Ip', 'r@t522.test', '+447700952250', date '1995-01-01', true,
       '203.0.113.7') $$,
  'P0001', 'bad_caller_hash', 'a raw address is refused, never stored');
reset role;

insert into private.apply_caller_hits (caller_hash, at) values (:'h_old', now() - interval '3 days');
set local role service_role;
select lives_ok(
  $$ select submit_application_as_caller('Purge', 'Run', 'p@t522.test', '+447700952260', date '1995-01-01', true,
       'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') $$,
  'another application');
reset role;
select is((select count(*)::int from private.apply_caller_hits where caller_hash = :'h_old'), 0,
  'and hashes older than two days are gone');

select * from finish();
rollback;
