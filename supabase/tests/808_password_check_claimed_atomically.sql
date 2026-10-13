-- =====================================================================
-- 808 · Change password: the attempt is claimed and counted in one call
--   20261013100200_password_check_claimed_atomically.sql (ADR-0051, review 12.10)
--
--   608 holds the table and the two original functions. This file holds
--   what replaced check-then-record:
--   A. password_check_begin / password_check_release are definer, pin
--      search_path, closed to anon and PUBLIC, open to authenticated.
--   B. begin counts THIS attempt before the password is checked: five
--      begins without a release and the sixth is refused, so parallel
--      attempts cannot all read "allowed".
--   C. release un-counts only the caller's own row; a released attempt
--      (right password, or not a wrong-password failure) frees its slot.
--   D. a null uid is refused and records nothing.
-- =====================================================================
begin;
select plan(14);
\ir _shared/fixtures.psql

-- =====================================================================
-- A · the functions
-- =====================================================================
select ok((select bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%'))
             from pg_proc p
            where p.oid in ('public.password_check_begin()'::regprocedure,
                            'public.password_check_release(bigint)'::regprocedure)),
  'both are security definer and pin their search_path');
select ok(not has_function_privilege('anon', 'public.password_check_begin()', 'execute')
      and not has_function_privilege('anon', 'public.password_check_release(bigint)', 'execute')
      and not has_function_privilege('public', 'public.password_check_begin()', 'execute')
      and not has_function_privilege('public', 'public.password_check_release(bigint)', 'execute'),
  'neither anon nor PUBLIC can execute them');
select ok(has_function_privilege('authenticated', 'public.password_check_begin()', 'execute')
      and has_function_privilege('authenticated', 'public.password_check_release(bigint)', 'execute'),
  'a signed-in caller can');

-- =====================================================================
-- B · five claimed attempts and the sixth is refused
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

create temporary table t808 (attempt bigint) on commit drop;
insert into t808 select password_check_begin() from generate_series(1, 5);
select is((select count(*)::int from t808 where attempt is not null), 5,
  'five attempts in flight are each given a slot');
select is(password_check_begin(), null::bigint,
  'the sixth is refused before any password is checked — nothing was recorded "after", so a burst cannot all read allowed');
select ok(not password_check_allowed(),
  'and the older check (kept one release) reads the same rows');

-- =====================================================================
-- C · release
-- =====================================================================
select lives_ok(format($$ select password_check_release(%s) $$, (select min(attempt) from t808)),
  'releasing one attempt (the password was right) lives');
select isnt(password_check_begin(), null::bigint, 'and frees its slot');
select is(password_check_begin(), null::bigint, 'one slot, not two');

reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clientb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(format($$ select password_check_release(%s) $$, (select max(attempt) from t808)),
  'client B releasing client A''s attempt id does not raise…');
reset role;
select is((select count(*)::int from private.password_check_failures
            where user_id = :'clienta_uid' and failed_at > now() - interval '15 minutes'), 5,
  '…and changes nothing: an attempt id is not a capability');

select set_config('request.jwt.claims', json_build_object('sub', :'clientb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select isnt(password_check_begin(), null::bigint, 'client A''s five do not lock client B out');

-- =====================================================================
-- D · no uid
-- =====================================================================
reset role;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
set local role authenticated;
select is(password_check_begin(), null::bigint, 'a caller with no uid is refused');
reset role;
select is((select count(*)::int from private.password_check_failures where user_id is null), 0,
  'and nothing is written for it');

select * from finish();
rollback;
