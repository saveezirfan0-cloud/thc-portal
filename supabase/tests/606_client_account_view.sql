-- =====================================================================
-- 606 · client_account_v — the Client Portal's "Your account" (ADR-0036)
--
-- 20260929100000. The account page shows the customer their company and
-- the addresses THC emails its documents to (§9.7, §11.4). Both live on
-- `clients`, where the client role holds no policy and must not be given
-- one (ADR-0004, ADR-0026). They come through an owner-rights client_*
-- view with the tenancy rule in its own body, the client_company_v shape
-- (570). Asserted here:
--   * the ADR-0004 shape (owner rights, security barrier, the predicate in
--     the body, exactly two named columns, no anon privilege, read-only);
--   * a client sees exactly its OWN row, and another client's contact sees
--     theirs and not this one;
--   * an admin, a worker, a client with no company, a former client and
--     anon see nothing;
--   * `clients` is still closed to the client role, and the client role
--     still holds no table policy anywhere.
-- =====================================================================
begin;
select plan(22);
\ir _shared/fixtures.psql

-- ---- shape ------------------------------------------------------------
select has_view('public', 'client_account_v', 'client_account_v exists');
select ok(not (coalesce((select reloptions from pg_class where relname = 'client_account_v'), '{}') @> '{security_invoker=true}'),
  'client_account_v runs with owner rights, so no client policy on clients is needed (ADR-0004)');
select ok((coalesce((select reloptions from pg_class where relname = 'client_account_v'), '{}') @> '{security_barrier=true}'),
  'client_account_v is a security barrier, so no user-supplied qual runs ahead of the tenancy predicate');
select ok(pg_get_viewdef('client_account_v'::regclass) ~ 'client_portal_visible'
      and pg_get_viewdef('client_account_v'::regclass) ~ 'current_client_id',
  'the tenancy rule is in the view''s own body: current_client_id() and client_portal_visible()');
select bag_eq(
  $$ select column_name::text from information_schema.columns
      where table_schema = 'public' and table_name = 'client_account_v' $$,
  $$ values ('name'::text),('contact_emails') $$,
  'client_account_v names exactly two columns: the company name and the document recipients — no terms, no phone, no money, nothing about workers');
select ok(not has_table_privilege('anon', 'client_account_v', 'select'),
  'anon has no privilege on client_account_v');
select ok(has_table_privilege('authenticated', 'client_account_v', 'select'),
  'a signed-in caller may select client_account_v; the body decides what comes back');
select ok(not has_table_privilege('authenticated', 'client_account_v', 'insert')
      and not has_table_privilege('authenticated', 'client_account_v', 'update')
      and not has_table_privilege('authenticated', 'client_account_v', 'delete'),
  '§11.1 read-only: nobody writes through client_account_v — recipients change through the office');

-- ---- client A: exactly its own row -----------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq($$ select name, contact_emails from client_account_v $$,
  $$ values ('RLS Fixture Client A'::text, array['clienta@rls.test']::text[]) $$,
  'client A sees exactly one row: its own company and its own recipients');
select is((select count(*)::int from client_account_v where name = 'RLS Fixture Client B'), 0,
  'client A cannot see client B''s row, even by asking for it by name');
select is((select count(*)::int from client_account_v where 'clientb@rls.test' = any(contact_emails)), 0,
  'client A cannot see client B''s recipients, even by asking for an address');
select is((select count(*)::int from clients), 0,
  'clients itself stays closed to the client role (ADR-0004: no client policy was added)');
select throws_ok($$ update client_account_v set contact_emails = array['attacker@example.com'] $$, '42501', null,
  'a client cannot rewrite its recipients through the view (§11.1 read-only)');

-- ---- client B: its own row, not A's -----------------------------------
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clientb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq($$ select name, contact_emails from client_account_v $$,
  $$ values ('RLS Fixture Client B'::text, array['clientb@rls.test']::text[]) $$,
  'a different client''s contact sees their own row, not client A''s');

-- ---- a worker ---------------------------------------------------------
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_account_v), 0,
  'a worker sees nothing through client_account_v');

-- ---- the admin: no company of their own --------------------------------
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_account_v), 0,
  'an admin has no company, so the view (which is "the caller''s own") returns nothing — the office reads clients directly');

-- ---- a client profile with no client_id --------------------------------
reset role;
insert into auth.users (id, email) values (:'new_id', 'orphan-606@rls.test');
insert into profiles (id, role, full_name, client_id) values (:'new_id', 'client', 'Client with no company', null);
select set_config('request.jwt.claims', json_build_object('sub', :'new_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_account_v), 0,
  'a client profile with a null client_id matches no company rather than every company');

-- ---- a profile whose role is no longer client --------------------------
reset role;
update profiles set role = 'staff' where id = :'clientb_uid';
select set_config('request.jwt.claims', json_build_object('sub', :'clientb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_account_v), 0,
  'a non-client profile that still carries a client_id sees nothing (client_portal_visible)');

-- ---- anon --------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select * from client_account_v $$, '42501', null,
  'anon is refused outright, not handed an empty set');

-- ---- the client role still holds no table policy -----------------------
reset role;
select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid
            where c.relname = 'clients'
              and coalesce(pg_get_expr(p.polqual, p.polrelid), '') ~ 'client'''),
  0, 'no policy on clients names the client role');
select is_empty(
  $$ select c.relname::text from pg_policy p join pg_class c on c.oid = p.polrelid
      where p.polname like 'client\_%' $$,
  'ADR-0026 still holds: the client role has no policy on any table — the account page reads a view');
select is((select count(*)::int
             from information_schema.columns
            where table_schema = 'public' and table_name = 'client_account_v'
              and column_name ~ '(rate|charge|margin|cost|amount|price|salary|payroll|pays_|phone|staff|worker)'),
  0, '§11.1 no money on the account page, and nothing about terms or workers');

select * from finish();
rollback;
