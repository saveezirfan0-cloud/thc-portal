-- =====================================================================
-- 786 · Client Portal sign-in and reset-email throttle
--   20261012120200_client_auth_throttles.sql, ADR-0115 (§1.4, §10.2, §1.7)
--
--   A. Only the service role can take a slot; no API role can see the
--      table or the schema; the limits are settings.
--   B. login: 10 per email and 30 per caller in 15 minutes; a refused
--      attempt is not counted; another key is unaffected.
--   C. reset: 3 per email in an hour; older hits age out; login and reset
--      count separately.
--   D. §1.7: only 64-hex digests are stored; a null key is not checked
--      and writes nothing; rows older than a day are trimmed.
-- =====================================================================
begin;
select plan(28);
\ir _shared/fixtures.psql

\set e_one    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
\set e_two    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
\set c_one    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
\set c_two    'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
\set e_reset  'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
\set e_old    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'

-- =====================================================================
-- A · who can reach what
-- =====================================================================
select ok(not has_function_privilege('anon', 'public.auth_attempt_take(text,text,text)', 'execute')
      and not has_function_privilege('authenticated', 'public.auth_attempt_take(text,text,text)', 'execute')
      and not has_function_privilege('public', 'public.auth_attempt_take(text,text,text)', 'execute'),
  'neither anon, a signed-in account nor PUBLIC can take a slot — a digest anyone could send would be a limit anyone could fill for somebody else');
select ok(has_function_privilege('service_role', 'public.auth_attempt_take(text,text,text)', 'execute'),
  'the Client Portal''s server actions (service key) can');
select ok((select p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%')
             from pg_proc p where p.oid = 'public.auth_attempt_take(text,text,text)'::regprocedure),
  'it is security definer with a pinned search_path');
select ok(not has_table_privilege('anon', 'private.auth_attempt_hits', 'select,insert,update,delete')
      and not has_table_privilege('authenticated', 'private.auth_attempt_hits', 'select,insert,update,delete')
      and not has_table_privilege('public', 'private.auth_attempt_hits', 'select,insert,update,delete'),
  'the hit table grants no API role and not PUBLIC anything');
select ok((select relrowsecurity from pg_class where oid = 'private.auth_attempt_hits'::regclass)
      and (select count(*) from pg_policy where polrelid = 'private.auth_attempt_hits'::regclass) = 0,
  'RLS is on, with no policy');
select hasnt_table('public', 'auth_attempt_hits', 'and it is not in public, where PostgREST would publish it');
select is((select value from settings where key = 'auth_throttle'),
  '{"login": {"per_email": 10, "per_caller": 30, "window_minutes": 15},
    "reset": {"per_email": 3, "per_caller": 10, "window_minutes": 60}}'::jsonb,
  '§9.12 the limits are settings, not constants');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select auth_attempt_take('login', %L, null) $$, :'e_one'), '42501', null,
  'a signed-in client calling it is refused outright');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(format($$ select auth_attempt_take('login', %L, null) $$, :'e_one'), '42501', null,
  'anon calling it is refused outright');
select throws_ok($$ select count(*) from private.auth_attempt_hits $$, '42501', null,
  'and anon cannot read the table');
reset role;

-- =====================================================================
-- B · login
-- =====================================================================
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select is((select bool_and(auth_attempt_take('login', :'e_one', null)) from generate_series(1, 10)), true,
  'ten sign-in attempts for one email in 15 minutes are allowed');
select is(auth_attempt_take('login', :'e_one', null), false, 'the eleventh is refused');
select is(auth_attempt_take('login', :'e_one', null), false, 'and so is the twelfth');
reset role;
select is((select count(*)::int from private.auth_attempt_hits where key_hash = :'e_one'), 10,
  'a refused attempt is not counted, so the window drains on its own');
set local role service_role;
select is(auth_attempt_take('login', :'e_two', null), true, 'another email is unaffected');

-- 30 per caller, each with a different email.
select is((select bool_and(auth_attempt_take('login', encode(sha256(('786-' || g)::bytea), 'hex'), :'c_one'))
             from generate_series(1, 30) g), true,
  'thirty sign-in attempts from one caller in 15 minutes are allowed, whatever the emails');
select is(auth_attempt_take('login', :'e_two', :'c_one'), false,
  'the thirty-first from that caller is refused, even for an email under its own limit');
reset role;
select is((select count(*)::int from private.auth_attempt_hits where key_hash = :'e_two'), 1,
  'and refusing on the caller counts nothing against the email either');
set local role service_role;
select is(auth_attempt_take('login', :'e_two', :'c_two'), true, 'another caller is unaffected');

-- =====================================================================
-- C · reset
-- =====================================================================
select is((select bool_and(auth_attempt_take('reset', :'e_reset', null)) from generate_series(1, 3)), true,
  'three reset emails for one address in an hour are allowed');
select is(auth_attempt_take('reset', :'e_reset', null), false, 'the fourth is refused');
select is(auth_attempt_take('login', :'e_reset', null), true,
  'sign-in and reset count separately: a refused reset does not block signing in');

reset role;
insert into private.auth_attempt_hits (action, key_kind, key_hash, at)
  select 'reset', 'email', :'e_old', now() - interval '61 minutes' from generate_series(1, 3);
insert into private.auth_attempt_hits (action, key_kind, key_hash, at)
  values ('login', 'email', :'e_old', now() - interval '2 days');
set local role service_role;
select is(auth_attempt_take('reset', :'e_old', null), true,
  'three reset emails 61 minutes ago no longer count');

-- =====================================================================
-- D · digests only, null keys, retention
-- =====================================================================
select throws_ok($$ select auth_attempt_take('login', 'venue@client.example', null) $$, '22023', 'bad_key_hash',
  '§1.7 a raw email is refused — only a 64-hex digest is stored');
select throws_ok(format($$ select auth_attempt_take('login', null, '203.0.113.7') $$), '22023', 'bad_key_hash',
  '§1.7 a raw address is refused');
select throws_ok(format($$ select auth_attempt_take('signup', %L, null) $$, :'e_one'), '22023', 'bad_action',
  'only login and reset are throttled here');
select is(auth_attempt_take('login', null, null) and auth_attempt_take('login', '', '  '), true,
  'with no key there is nothing to limit (a request that carried no address, locally)');
reset role;
select is((select count(*)::int from private.auth_attempt_hits where at < now() - interval '1 day'), 0,
  'every call trims rows older than a day');

select * from finish();
rollback;
