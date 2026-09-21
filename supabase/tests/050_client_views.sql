-- =====================================================================
-- 050 · The Client Portal's views (§11.1, §11.2, ADR-0004)
--
-- Two things are asserted here and they have to hold together:
--   * no client-facing view carries a money column, and
--   * the views that run with the OWNER's rights carry the tenancy rule in
--     their own body, because row level security on the tables underneath
--     is bypassed for the owner.
--
-- ADR-0004 replaced the older shorthand ("client access goes only through
-- security_invoker views"). After 0002 closed the client's reach into
-- shift_requirements and roles, an invoker view is the one thing that
-- cannot deliver §11.2: it resolved to zero rows for the only role it
-- exists to serve.
--
-- 0009 finished the job. client_events_v was still an invoker view, which
-- meant its caller needed select on `event_windows` — and event_windows
-- runs with owner rights over the money-bearing shift_requirements table
-- with Supabase's default world grants still on it. All three client views
-- now run with owner rights and carry client_portal_visible() themselves,
-- and event_windows is reachable only by its owner.
-- =====================================================================
begin;
select plan(30);
\ir _shared/fixtures.psql

-- ---- how each view resolves -------------------------------------------
select ok(not (coalesce((select reloptions from pg_class where relname = 'client_events_v'), '{}') @> '{security_invoker=true}'),
  'client_events_v runs with owner rights (ADR-0004, 0009), so event_windows need not be granted to the caller');
select ok((coalesce((select reloptions from pg_class where relname = 'client_events_v'), '{}') @> '{security_barrier=true}'),
  'client_events_v is a security barrier, so no user-supplied qual runs ahead of the tenancy predicate');

select ok(not (coalesce((select reloptions from pg_class where relname = 'client_lineup_v'), '{}') @> '{security_invoker=true}'),
  'client_lineup_v runs with owner rights (ADR-0004)');
select ok((coalesce((select reloptions from pg_class where relname = 'client_lineup_v'), '{}') @> '{security_barrier=true}'),
  'client_lineup_v is a security barrier, so no user-supplied qual runs ahead of the tenancy predicate');
select ok(not (coalesce((select reloptions from pg_class where relname = 'client_role_sections_v'), '{}') @> '{security_invoker=true}'),
  'client_role_sections_v runs with owner rights (ADR-0004)');
select ok((coalesce((select reloptions from pg_class where relname = 'client_role_sections_v'), '{}') @> '{security_barrier=true}'),
  'client_role_sections_v is a security barrier');

-- event_windows has run with owner rights since 0001: it is how the client
-- gets its min-start/max-end window without a policy on the money-bearing
-- shift_requirements table. Running that way is fine; being GRANTED to the
-- PostgREST roles while doing so is not, and it was until 0009. The guard
-- is the privilege, because the reloption alone says nothing about who can
-- call it.
select ok(not has_table_privilege('anon', 'event_windows', 'select'),
  'anon holds no privilege on event_windows (0009): owner rights over shift_requirements must not be world-granted');
select ok(not has_table_privilege('authenticated', 'event_windows', 'select'),
  'no signed-in role reaches event_windows directly either; the client goes through client_events_v');

-- ---- exactly the columns the scope names -------------------------------
select bag_eq(
  $$ select column_name::text from information_schema.columns
      where table_schema = 'public' and table_name = 'client_events_v' $$,
  $$ values ('id'::text),('client_id'),('title'),('venue_name'),('venue_address'),
            ('event_date'),('po_number'),('starts_at'),('ends_at'),('status') $$,
  'client_events_v exposes exactly the §11.1 columns');

select bag_eq(
  $$ select column_name::text from information_schema.columns
      where table_schema = 'public' and table_name = 'client_lineup_v' $$,
  $$ values ('booking_id'::text),('event_id'),('role'),('starts_at'),('ends_at'),('name'),('photo_path') $$,
  'client_lineup_v exposes exactly the §11.2 columns');

-- headcount and confirmed, never buffer: the buffer is THC's own
-- over-booking, and §11.1 shows the customer "N of M confirmed".
select bag_eq(
  $$ select column_name::text from information_schema.columns
      where table_schema = 'public' and table_name = 'client_role_sections_v' $$,
  $$ values ('shift_id'::text),('event_id'),('role'),('starts_at'),('ends_at'),('headcount'),('confirmed') $$,
  'client_role_sections_v exposes exactly the §11.1 "N of M confirmed" columns');

select is(
  (select count(*)::int
     from information_schema.columns c
     join pg_class k on k.relname = c.table_name and k.relkind = 'v'
    where c.table_schema = 'public'
      and c.table_name like 'client!_%' escape '!'
      and c.column_name ~ '(rate|charge|margin|cost|amount|price|salary|payroll)'),
  0,
  '§11.1 no client-facing view has a money column');

-- ---- who may even reach them (§11.1 read-only, signed in) --------------
select ok(not has_table_privilege('anon', 'client_events_v', 'select'),
  'anon has no privilege on client_events_v: an owner-rights view must not rely on auth.uid() being null');
select ok(has_table_privilege('authenticated', 'client_events_v', 'select'),
  'a signed-in caller may select client_events_v; client_portal_visible() decides what comes back');
select ok(not has_table_privilege('anon', 'client_lineup_v', 'select'),
  'anon has no privilege on client_lineup_v: an owner-rights view must not rely on auth.uid() being null');
select ok(not has_table_privilege('anon', 'client_role_sections_v', 'select'),
  'anon has no privilege on client_role_sections_v');
select ok(has_table_privilege('authenticated', 'client_lineup_v', 'select'),
  'a signed-in caller may select client_lineup_v; the view body decides what comes back');
select ok(has_table_privilege('authenticated', 'client_role_sections_v', 'select'),
  'a signed-in caller may select client_role_sections_v');
select ok(not has_table_privilege('authenticated', 'client_lineup_v', 'insert'),
  '§11.1 read-only: nobody writes through client_lineup_v');
select ok(not has_table_privilege('authenticated', 'client_role_sections_v', 'update'),
  '§11.1 read-only: nobody writes through client_role_sections_v');

-- ---- the admin is inside the predicate too -----------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_lineup_v where booking_id in (:'booking_a', :'booking_b')), 2,
  'client_lineup_v resolves for an admin across both clients, so the Back Office keeps one definition of the line-up');
select is((select role from client_lineup_v where booking_id = :'booking_a'), 'RLS Fixture Role',
  'client_lineup_v shows the role name, not the rate');
select is((select name from client_lineup_v where booking_id = :'booking_a'), 'Staff Alpha',
  'client_lineup_v shows the worker name');
select is((select count(*)::int from client_role_sections_v where event_id in (:'event_a', :'event_b')), 2,
  'client_role_sections_v resolves for an admin across both clients');

-- ---- a worker is not a Client Portal user ------------------------------
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_lineup_v), 0,
  'a worker sees nothing through client_lineup_v, not even the shift they are booked on');
select is((select count(*)::int from client_role_sections_v), 0,
  'a worker sees nothing through client_role_sections_v');

-- ---- a client profile with no client_id sees nothing, not everything ---
-- The predicate compares against current_client_id(); an unset one must not
-- collapse into "no filter".
reset role;
insert into auth.users (id, email) values (:'new_id', 'orphan@rls.test');
insert into profiles (id, role, full_name, client_id) values (:'new_id', 'client', 'Client with no company', null);
select set_config('request.jwt.claims', json_build_object('sub', :'new_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_lineup_v), 0,
  'a client profile with a null client_id matches no event rather than every event');

-- ---- GDPR removal (§1.7) ------------------------------------------------
-- The history row stays; the person disappears from the customer's view.
reset role;
update staff set photo_path = 'photos/a/selfie.jpg' where id = :'staffa';
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select photo_path from client_lineup_v where booking_id = :'booking_a'), 'photos/a/selfie.jpg',
  'the customer sees the worker''s photo, so they recognise the person by face (§11.1)');

reset role;
update staff set removed_at = now() where id = :'staffa';
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select name from client_lineup_v where booking_id = :'booking_a'), 'Deleted account #90001',
  '§1.7 a removed worker reads as "Deleted account #id" and the booking row survives');
select is((select photo_path from client_lineup_v where booking_id = :'booking_a'), null::text,
  '§1.7 a removed worker''s photo is gone from the line-up');

reset role;
select * from finish();
rollback;
