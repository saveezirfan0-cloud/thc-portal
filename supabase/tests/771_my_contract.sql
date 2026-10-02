-- =====================================================================
-- 771 · The worker's signed agreement (ADR-0083)
--   my_contract() · 20261002113000
--
--   A. Shape: definer, search_path pinned, not anon/PUBLIC; takes no
--      staff id.
--   B. Not signed yet → null, not an error.
--   C. Signed → the version SIGNED, not the current one: its title and
--      body exactly as published, the placeholder flag, and the stamp in
--      UK time (§1.8) — never the viewer's zone.
--   D. No cross-worker access: each worker reads their own.
--   E. A leaver reads theirs; a removed worker is refused; a client has
--      no worker record.
-- =====================================================================
begin;
select plan(16);
\ir _shared/fixtures.psql

-- =====================================================================
-- A · Shape
-- =====================================================================
select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=public, extensions']
     from pg_proc p where p.oid = 'public.my_contract()'::regprocedure),
  'A: security definer with search_path pinned');
select ok(
  not has_function_privilege('anon', 'public.my_contract()', 'execute')
  and not has_function_privilege('public', 'public.my_contract()', 'execute'),
  'A: anon and PUBLIC cannot call it');
select ok(has_function_privilege('authenticated', 'public.my_contract()', 'execute'),
  'A: a signed-in worker can');
select is(
  (select count(*)::int from pg_proc where proname = 'my_contract' and pronamespace = 'public'::regnamespace and pronargs > 0),
  0, 'A: there is no overload that takes a staff id');

-- =====================================================================
-- B · Not signed yet
-- =====================================================================
update staff set contract_signed_at = null, contract_version = null where id in (:'staffa', :'staffb');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(my_contract(), null::jsonb, 'B: nothing signed — null, not an error');
reset role;

-- =====================================================================
-- C · The version signed, not the current one
-- =====================================================================
-- Alpha signed the September placeholder at 13:42 UTC on 18.09 (BST);
-- THC's own agreement has been published since and is now current.
update staff set contract_version = 'placeholder-2026-09',
                 contract_signed_at = timestamptz '2026-09-18 13:42:00+00'
 where id = :'staffa';
-- Bravo signed THC's agreement.
update staff set contract_version = 'thc-agency-worker-2026-09',
                 contract_signed_at = timestamptz '2026-10-01 09:05:00+00'
 where id = :'staffb';

select isnt(current_contract_version(), 'placeholder-2026-09',
  'C: (setup) the placeholder is no longer the current version');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(my_contract() ->> 'version', 'placeholder-2026-09',
  'C: the version the worker signed, not current_contract_version()');
select is(my_contract() ->> 'body',
  (select body from contract_versions where version = 'placeholder-2026-09'),
  'C: the body exactly as published');
select is(my_contract() ->> 'title',
  (select title from contract_versions where version = 'placeholder-2026-09'),
  'C: and its title');
select is((my_contract() ->> 'isPlaceholder')::boolean, true, 'C: with the placeholder flag');
select is(my_contract() ->> 'signedStamp', '18.09.2026 14:42 UK time',
  'C: the stamp is UK time (BST here), formatted by the database (§1.8)');
select is((my_contract() ->> 'signedAt')::timestamptz, timestamptz '2026-09-18 13:42:00+00',
  'C: beside the instant itself');

-- =====================================================================
-- D · No cross-worker access
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
select is(my_contract() ->> 'version', 'thc-agency-worker-2026-09',
  'D: Bravo reads Bravo''s agreement, not Alpha''s');
reset role;

-- =====================================================================
-- E · Leaver, removed, client
-- =====================================================================
update staff set status = 'inactive', left_at = now() where id = :'staffb';
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(my_contract() ->> 'signedStamp', '01.10.2026 10:05 UK time',
  'E: a leaver can still read what they signed');
reset role;

update staff set status = 'removed' where id = :'staffb';
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select my_contract() $$,
  'P0001', 'account_closed', 'E: a removed worker is refused');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select throws_ok($$ select my_contract() $$,
  'P0001', 'unknown_staff', 'E: a client has no worker record, so nothing to read');

reset role;
select * from finish();
rollback;
