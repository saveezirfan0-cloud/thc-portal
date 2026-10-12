-- =====================================================================
-- 801 · a new function is not anon's until a migration says so
--       20261012121500 · docs/14 §4
--
-- Default privileges no longer give PUBLIC or anon EXECUTE on a function
-- `postgres` creates; authenticated and service_role keep theirs. The
-- deliberate anon grants are explicit.
-- =====================================================================
begin;
select plan(6);

create function public.t801_probe() returns int language sql set search_path = public as $$ select 1 $$;

select ok(not has_function_privilege('anon', 'public.t801_probe()', 'execute'),
  'a function created now is not executable by anon');
select ok(not exists (select 1 from information_schema.routine_privileges
                       where routine_name = 't801_probe' and grantee = 'PUBLIC'),
  'nor by PUBLIC');
select ok(has_function_privilege('authenticated', 'public.t801_probe()', 'execute')
      and has_function_privilege('service_role', 'public.t801_probe()', 'execute'),
  'authenticated and service_role keep the default grant');
select ok(has_function_privilege('anon', 'public.current_app_role()', 'execute')
      and has_function_privilege('anon', 'public.current_client_id()', 'execute'),
  'the two deliberate anon-callable definers still are');
select is((select count(*)::int from pg_default_acl d
            where d.defaclrole = 'postgres'::regrole and d.defaclobjtype = 'f' and d.defaclnamespace = 0
              and not exists (select 1 from aclexplode(d.defaclacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')), 1,
  'the global default for postgres''s functions grants PUBLIC nothing');
select ok(exists (select 1 from pg_default_acl d
                   where d.defaclrole = 'postgres'::regrole and d.defaclobjtype = 'f'
                     and d.defaclnamespace = 'public'::regnamespace
                     and not exists (select 1 from aclexplode(d.defaclacl) a
                                      where a.grantee = 'anon'::regrole and a.privilege_type = 'EXECUTE')),
  'and the public-schema default grants anon nothing');

select * from finish();
rollback;
