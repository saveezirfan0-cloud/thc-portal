-- =====================================================================
-- 891 · a disabled login stops reading its own rows at once
--       20261020120100 · ADR-0163 · security review M1
--
-- 790 proved the RPCs refuse a token whose session is gone or whose login
-- is banned. The ten staff_self* policies did not ask, so for up to an
-- hour the same token kept reading the worker's rows straight from
-- PostgREST. Now they match on staff_caller(), and the table path and the
-- RPC path give the same answer.
-- =====================================================================
begin;
select plan(17);
\ir _shared/fixtures.psql

\set sess '89100000-0000-4000-8000-0000000000e1'

insert into onboarding_progress (staff_id) values (:'staffa');
-- push_subscriptions and location_pings come with the fixtures.

insert into auth.sessions (id, user_id, created_at, updated_at) values (:'sess', :'staffa_uid', now(), now());
select set_config('request.jwt.claims', json_build_object(
  'sub', :'staffa_uid', 'role', 'authenticated', 'session_id', :'sess')::text, true);

-- One statement over every table the ten policies guard.
create temp view t891_own with (security_invoker = true) as
  select (select count(*) from staff)               as staff,
         (select count(*) from bank_details)        as bank,
         (select count(*) from bookings)            as bookings,
         (select count(*) from compliance_docs)     as docs,
         (select count(*) from onboarding_progress) as progress,
         (select count(*) from push_subscriptions)  as push,
         (select count(*) from quiz_attempts)       as quiz,
         (select count(*) from staff_references)    as refs,
         (select count(*) from staff_roles)         as roles,
         (select count(*) from location_pings)      as pings;
grant select on t891_own to authenticated;

set local role authenticated;
select is((select staff from t891_own), 1::bigint, 'a live session reads its own staff row');
select ok((select bank = 1 and bookings >= 1 and docs >= 1 and progress = 1 and push >= 1
                  and quiz >= 1 and refs = 1 and pings >= 1 from t891_own),
  'and its own rows in every other staff_self table');
select is((select count(*)::int from staff where id = :'staffb'), 0, 'never another worker''s');
reset role;

-- "Sign out other devices", the reset flow, or the office disabling the
-- login: the session row goes.
delete from auth.sessions where id = :'sess';
set local role authenticated;
select is((select staff from t891_own), 0::bigint, 'the session is gone: the old token reads no staff row');
select is((select bank from t891_own), 0::bigint, 'no bank details');
select is((select bookings from t891_own), 0::bigint, 'no bookings');
select is((select docs from t891_own), 0::bigint, 'no documents');
select is((select progress + push + quiz + refs + roles + pings from t891_own), 0::bigint,
  'and nothing from the other six');
reset role;

-- A banned login (admin_set_login_disabled) is nobody, session or not.
insert into auth.sessions (id, user_id, created_at, updated_at) values (:'sess', :'staffa_uid', now(), now());
update auth.users set banned_until = now() + interval '100 years' where id = :'staffa_uid';
set local role authenticated;
select is((select staff + bank + bookings + docs from t891_own), 0::bigint,
  'a banned login reads none of its rows, though its session row still exists');
reset role;
update auth.users set banned_until = now() - interval '1 minute' where id = :'staffa_uid';
set local role authenticated;
select is((select staff from t891_own), 1::bigint, 'a ban that has run out reads again');
reset role;

-- The office and the client are untouched.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select ok((select count(*) from staff where id in (:'staffa', :'staffb')) = 2, 'the office still reads every worker (admin_all)');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select staff + bank + bookings + docs from t891_own), 0::bigint, 'a client still reads none of it');
reset role;

-- The shape, pinned: ten policies, every one asking staff_caller().
select is((select count(*)::int from pg_policies where schemaname = 'public' and policyname like 'staff\_self%'), 10,
  'there are ten staff_self policies');
select is_empty(
  $$ select tablename || '.' || policyname from pg_policies
      where schemaname = 'public' and policyname like 'staff\_self%'
        and coalesce(qual, '') !~ '\(\s*SELECT staff_caller\(\) AS staff_caller\)' $$,
  'and every one matches on (select staff_caller()) — the session and the ban, once per statement');
select is_empty(
  $$ select tablename || '.' || policyname from pg_policies
      where schemaname = 'public' and policyname like 'staff\_self%' and cmd <> 'SELECT' $$,
  'all of them read-only, as before');
select ok(has_function_privilege('authenticated', 'public.staff_caller(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.staff_caller(uuid)', 'execute'),
  'staff_caller() is callable by the role the policies run as, and not by anon (who holds no table privilege anyway)');
select ok(not exists (select 1 from pg_policies
                       where schemaname = 'public' and policyname like 'staff\_self%'
                         and qual ~ 'user_id = \( SELECT auth.uid'),
  'no staff_self policy is left on user_id = auth.uid() alone');

select * from finish();
rollback;
