-- =====================================================================
-- 570 · client_company_v — the portal header's company name (§11.1)
--
-- 20260927120000. The Client Portal read `clients` directly and always got
-- null, because the client role holds no policy there (ADR-0004, and it
-- must not be given one). The name now comes through an owner-rights
-- client_* view with the tenancy rule in its own body. Asserted here:
--   * the ADR-0004 shape (owner rights, security barrier, named columns,
--     no anon privilege, read-only);
--   * a client sees its OWN name and nobody else's;
--   * an admin, a worker, a client with no company and anon see nothing;
--   * `clients` itself is still closed to the client role.
-- =====================================================================
begin;
select plan(17);
\ir _shared/fixtures.psql

-- ---- shape ------------------------------------------------------------
select ok(not (coalesce((select reloptions from pg_class where relname = 'client_company_v'), '{}') @> '{security_invoker=true}'),
  'client_company_v runs with owner rights, so no client policy on clients is needed (ADR-0004)');
select ok((coalesce((select reloptions from pg_class where relname = 'client_company_v'), '{}') @> '{security_barrier=true}'),
  'client_company_v is a security barrier, so no user-supplied qual runs ahead of the tenancy predicate');
select ok(pg_get_viewdef('client_company_v'::regclass) ~ 'client_portal_visible'
      and pg_get_viewdef('client_company_v'::regclass) ~ 'current_client_id',
  'the tenancy rule is in the view''s own body: current_client_id() and client_portal_visible()');
select bag_eq(
  $$ select column_name::text from information_schema.columns
      where table_schema = 'public' and table_name = 'client_company_v' $$,
  $$ values ('client_id'::text),('name') $$,
  'client_company_v names exactly two columns: no terms, no contacts, no money');
select ok(not has_table_privilege('anon', 'client_company_v', 'select'),
  'anon has no privilege on client_company_v');
select ok(has_table_privilege('authenticated', 'client_company_v', 'select'),
  'a signed-in caller may select client_company_v; the body decides what comes back');
select ok(not has_table_privilege('authenticated', 'client_company_v', 'insert')
      and not has_table_privilege('authenticated', 'client_company_v', 'update'),
  '§11.1 read-only: nobody writes through client_company_v');

-- ---- client A: its own name, only ------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq($$ select client_id, name from client_company_v $$,
  format($$ values (%L::uuid, 'RLS Fixture Client A'::text) $$, :'clienta'),
  'client A sees exactly one row: its own company name');
select is((select count(*)::int from client_company_v where client_id = :'clientb'), 0,
  'client A cannot see client B''s name, even by asking for it');
select is((select count(*)::int from clients), 0,
  'clients itself stays closed to the client role (ADR-0004: no client policy was added)');

-- ---- client B: its own name ------------------------------------------
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clientb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select name from client_company_v), 'RLS Fixture Client B',
  'client B sees its own name, not A''s');

-- ---- a worker ---------------------------------------------------------
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_company_v), 0,
  'a worker sees nothing through client_company_v');

-- ---- the admin: no company of their own --------------------------------
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_company_v), 0,
  'an admin has no company, so the view (which is "the caller''s own") returns nothing — the office reads clients directly');

-- ---- a client profile with no client_id --------------------------------
reset role;
insert into auth.users (id, email) values (:'new_id', 'orphan-570@rls.test');
insert into profiles (id, role, full_name, client_id) values (:'new_id', 'client', 'Client with no company', null);
select set_config('request.jwt.claims', json_build_object('sub', :'new_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_company_v), 0,
  'a client profile with a null client_id matches no company rather than every company');

-- ---- a client whose role has changed -----------------------------------
-- client_portal_visible() is in the body as well as current_client_id():
-- a profile that still carries a client_id but is no longer a client role
-- sees nothing.
reset role;
update profiles set role = 'staff' where id = :'clientb_uid';
select set_config('request.jwt.claims', json_build_object('sub', :'clientb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_company_v), 0,
  'a non-client profile that still carries a client_id sees nothing (client_portal_visible)');

-- ---- anon --------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select * from client_company_v $$, '42501', null,
  'anon is refused outright, not handed an empty set');

reset role;
select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid
            where c.relname = 'clients'
              and coalesce(pg_get_expr(p.polqual, p.polrelid), '') ~ 'client'''),
  0, 'no policy on clients names the client role');

select * from finish();
rollback;
