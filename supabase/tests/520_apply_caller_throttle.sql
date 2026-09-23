-- =====================================================================
-- 520 · The per-caller limit on /apply (ADR-0024, docs/14 D2, §1.7, §2.1)
--   20260926100000_apply_caller_throttle.sql
--
-- 120 proves the limits per email and per mobile. This file proves the
-- one they could not give: a bound on a caller who brings a fresh pair
-- every time. Four things, in order:
--
--   1. The table is unreachable: RLS on, no policy, no grant, for anon,
--      staff, client AND admin. The RPC is the only door.
--   2. The RPC is public (anon executes it — /apply has no login) and
--      refuses anything that is not a digest, so the table can never
--      hold an address (§1.7).
--   3. The limit trips on the Nth+1 attempt, in both windows, and lets
--      the caller back in when the window has passed. Time is moved by
--      editing attempted_at as the migration role — the function takes
--      no clock from its caller on purpose.
--   4. Old rows are pruned and the settings row is honoured, key by key.
-- =====================================================================
begin;
select plan(48);
\ir _shared/fixtures.psql

-- Four callers, as the app would hash them. repeat() rather than a literal
-- so the shape (64 hex characters) is visible at every use.
-- a: the ordinary short-window case · b: a bystander · c: the long window
-- d: pruning · e/f/g: the settings override and the defaults behind it.

-- ---------------------------------------------------------------------
-- 1. Structure: RLS on, no policy, no grant, and the §1.7 column CHECK
-- ---------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.apply_caller_attempts'::regclass),
  'RLS is on for apply_caller_attempts');
select is((select count(*)::int from pg_policy where polrelid = 'public.apply_caller_attempts'::regclass), 0,
  'and there is no policy at all, on purpose: the RPC is the only door (001_rls_guard names this table for that reason)');
select ok(not has_table_privilege('anon', 'public.apply_caller_attempts', 'select'),
  'anon holds no SELECT grant either — the default grant Supabase hands a new table is taken back');
select ok(not has_table_privilege('authenticated', 'public.apply_caller_attempts', 'insert'),
  'and authenticated holds no INSERT');

select throws_ok(
  $$ insert into apply_caller_attempts (caller_hash) values ('203.0.113.7') $$,
  '23514', null,
  '§1.7 an address cannot be stored even by the owner: the column CHECK admits only a 64-character hex digest');
select throws_ok(
  $$ insert into apply_caller_attempts (caller_hash) values ('2001:db8::1') $$,
  '23514', null,
  'nor an IPv6 address');

select is((select value from settings where key = 'apply_caller_throttle'),
  '{"short_window_minutes": 10, "short_limit": 5, "long_window_hours": 24, "long_limit": 20}'::jsonb,
  'the limits are settings (§9.12): 5 per 10 minutes and 20 per 24 hours by default');

-- ---------------------------------------------------------------------
-- 1b. Unreachable for all four roles
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select count(*) from apply_caller_attempts $$, '42501', null,
  'anon cannot read the table');
select throws_ok($$ insert into apply_caller_attempts (caller_hash) values (repeat('a', 64)) $$, '42501', null,
  'anon cannot write it');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select count(*) from apply_caller_attempts $$, '42501', null,
  'a worker cannot read the table');
select throws_ok($$ insert into apply_caller_attempts (caller_hash) values (repeat('a', 64)) $$, '42501', null,
  'a worker cannot write it');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select count(*) from apply_caller_attempts $$, '42501', null,
  'a client cannot read the table');
select throws_ok($$ insert into apply_caller_attempts (caller_hash) values (repeat('a', 64)) $$, '42501', null,
  'a client cannot write it');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select count(*) from apply_caller_attempts $$, '42501', null,
  'an admin cannot read the table either: a list of hashes is no use to the office, and the fewer readers of a pseudonymous identifier the better (§1.7)');
select throws_ok($$ insert into apply_caller_attempts (caller_hash) values (repeat('a', 64)) $$, '42501', null,
  'nor write it');
reset role;

-- ---------------------------------------------------------------------
-- 2. The RPC: who may call it, and what it refuses
-- ---------------------------------------------------------------------
select ok(has_function_privilege('anon', 'public.apply_caller_check(text)', 'execute'),
  'anon may call apply_caller_check — /apply is a public URL with no registration (§2.1)');
select ok(has_function_privilege('authenticated', 'public.apply_caller_check(text)', 'execute'),
  'and so may a signed-in visitor');
select ok(not has_function_privilege('public', 'public.apply_caller_check(text)', 'execute'),
  'the grant is named, not inherited from PUBLIC');
select ok(exists (select 1 from pg_proc p
                   where p.proname = 'apply_caller_check'
                     and p.prosecdef
                     and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')),
  'it is SECURITY DEFINER with its search_path pinned — the table has no grant, so the definer is how anon reaches it');

select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select apply_caller_check('203.0.113.7') $$, '22023', null,
  '§1.7 an address is refused outright: the function takes a digest and nothing else');
select throws_ok($$ select apply_caller_check(null) $$, '22023', null,
  'and so is nothing at all');
select throws_ok($$ select apply_caller_check(repeat('a', 63)) $$, '22023', null,
  'and a digest of the wrong length');

-- ---------------------------------------------------------------------
-- 3. The short window: five in, the sixth refused, back in after ten
--    minutes
-- ---------------------------------------------------------------------
select is(apply_caller_check(repeat('a', 64)),
  '{"allowed": true, "retry_after_seconds": 0}'::jsonb,
  'the first attempt from a caller is allowed, with nothing to wait for');
-- The call sits in a target list, not in an uncorrelated subquery: the
-- planner evaluates the latter once and hands every row the same answer.
select is(
  (select count(*)::int
     from (select apply_caller_check(repeat('a', 64)) as r from generate_series(2, 5)) x
    where (x.r ->> 'allowed')::boolean),
  4,
  'and so are the second to the fifth');

-- Kept in a session setting so one call can be inspected twice: anon may
-- not create a temp table on every Postgres, but may always set a GUC.
select set_config('t520.sixth', apply_caller_check(repeat('a', 64))::text, true);
select is((current_setting('t520.sixth')::jsonb ->> 'allowed')::boolean, false,
  'the sixth attempt inside ten minutes is refused');
select ok((current_setting('t520.sixth')::jsonb ->> 'retry_after_seconds')::int between 1 and 600,
  'with a wait of at most the window — the time until the oldest counted attempt leaves it');
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('t520.sixth')::jsonb) k),
  array['allowed', 'retry_after_seconds'],
  'the answer carries exactly those two keys: nothing about the limits themselves');

select is(apply_caller_check(repeat('b', 64)) ->> 'allowed', 'true',
  'a different caller is untouched by it');

select is(
  (select count(*)::int from pg_locks
    where locktype = 'advisory' and pid = pg_backend_pid()
      and classid = hashtext('apply:caller')
      and objid = hashtext(repeat('a', 64))),
  1,
  'the caller is locked under its own advisory key while the count is read, so two requests racing from one address cannot both pass on n-1');
reset role;

select is((select count(*)::int from apply_caller_attempts where caller_hash = repeat('a', 64)), 5,
  'five allowed attempts are recorded; the refused sixth is not, so the wait it was told is exact');
select is((select count(*)::int from apply_caller_attempts where caller_hash = repeat('b', 64)), 1,
  'and the bystander''s one');

-- Move time: the function takes no clock from its caller (anon could set
-- it to last week), so the window is advanced by ageing the rows.
update apply_caller_attempts
   set attempted_at = attempted_at - interval '10 minutes 1 second'
 where caller_hash = repeat('a', 64);

set local role anon;
select is(apply_caller_check(repeat('a', 64)) ->> 'allowed', 'true',
  'once the five are older than the window the caller is let back in');
reset role;
select is((select count(*)::int from apply_caller_attempts where caller_hash = repeat('a', 64)), 6,
  'and that attempt is recorded too: the day''s count keeps growing towards the long limit');

-- ---------------------------------------------------------------------
-- 3b. The long window: twenty in a day, spread out so the short window
--     never trips, and the twenty-first refused
-- ---------------------------------------------------------------------
insert into apply_caller_attempts (caller_hash, attempted_at)
select repeat('c', 64), now() - make_interval(hours => g)
  from generate_series(1, 20) g;

set local role anon;
select set_config('t520.long', apply_caller_check(repeat('c', 64))::text, true);
select is((current_setting('t520.long')::jsonb ->> 'allowed')::boolean, false,
  'twenty attempts in the last day refuse the twenty-first even though none is in the last ten minutes');
select is((current_setting('t520.long')::jsonb ->> 'retry_after_seconds')::int, 14400,
  'the wait is until the oldest of the twenty leaves the day: four hours');
reset role;

delete from apply_caller_attempts
 where caller_hash = repeat('c', 64)
   and attempted_at = (select min(attempted_at) from apply_caller_attempts where caller_hash = repeat('c', 64));

set local role anon;
select is(apply_caller_check(repeat('c', 64)) ->> 'allowed', 'true',
  'at nineteen the caller is allowed again');
reset role;

-- ---------------------------------------------------------------------
-- 4. Pruning: a call sweeps rows older than the long window, whoever
--    they belong to, and leaves the rest
-- ---------------------------------------------------------------------
insert into apply_caller_attempts (caller_hash, attempted_at) values
  (repeat('d', 64), now() - interval '25 hours'),
  (repeat('d', 64), now() - interval '23 hours');

set local role anon;
select lives_ok($$ select apply_caller_check(repeat('b', 64)) $$,
  'a call from an unrelated caller');
reset role;
select is((select count(*)::int from apply_caller_attempts
            where caller_hash = repeat('d', 64) and attempted_at < now() - interval '24 hours'), 0,
  'prunes the row older than 24 hours, which nothing would ever read again');
select is((select count(*)::int from apply_caller_attempts where caller_hash = repeat('d', 64)), 1,
  'and keeps the one inside the day');

-- ---------------------------------------------------------------------
-- 5. The settings row is honoured, key by key, and the defaults stand
--    behind every key that is missing
-- ---------------------------------------------------------------------
update settings set value = '{"short_limit": 2}'::jsonb where key = 'apply_caller_throttle';

set local role anon;
select is(apply_caller_check(repeat('e', 64)) ->> 'allowed', 'true', 'short_limit 2: the first is allowed');
select is(apply_caller_check(repeat('e', 64)) ->> 'allowed', 'true', 'and the second');
select is(apply_caller_check(repeat('e', 64)) ->> 'allowed', 'false',
  'the third is refused — an office running a recruitment day changes the number in settings, not in a release');
reset role;

-- long_limit is absent from that row, so the default 20 still applies.
insert into apply_caller_attempts (caller_hash, attempted_at)
select repeat('f', 64), now() - make_interval(hours => g)
  from generate_series(1, 20) g;
set local role anon;
select is(apply_caller_check(repeat('f', 64)) ->> 'allowed', 'false',
  'a key missing from the settings row falls back to the migration''s default: twenty a day still refuses');
reset role;

-- No row at all: the same defaults, so deleting the setting cannot turn
-- the limit off.
delete from settings where key = 'apply_caller_throttle';
set local role anon;
select is(
  (select count(*)::int
     from (select apply_caller_check(repeat('9', 64)) as r from generate_series(1, 5)) x
    where (x.r ->> 'allowed')::boolean),
  5,
  'with no settings row, five in ten minutes are allowed');
select is(apply_caller_check(repeat('9', 64)) ->> 'allowed', 'false',
  'and the sixth is refused: the defaults live in the function as well as the row');
reset role;

-- ---------------------------------------------------------------------
-- 6. Nothing here touched what 120 proves: the table under the applicant
--    is untouched by the check, and the copy is the action's, not ours
-- ---------------------------------------------------------------------
select doesnt_match(
  (select prosrc from pg_proc where proname = 'apply_caller_check'),
  'applications|staff',
  'apply_caller_check touches neither applications nor staff: it counts attempts, submit_application() still owns the write');
select doesnt_match(
  (select prosrc from pg_proc where proname = 'apply_caller_check'),
  'Too many',
  'the refusal copy is not in the database: the action owns it, and the RPC answers only allowed/retry_after (§2.12: the endpoint says nothing it need not)');
select matches(
  (select prosrc from pg_proc where proname = 'apply_caller_check'),
  'pg_advisory_xact_lock',
  'the per-caller advisory lock is in the body, not left to the caller');

select * from finish();
rollback;
