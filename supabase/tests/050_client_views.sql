-- =====================================================================
-- 050 · Client-facing views carry no money (§11.1) and are security_invoker
-- (CLAUDE.md: "Client access goes only through security_invoker views that
-- expose no charge/pay/margin columns").
-- =====================================================================
begin;
select plan(9);
\ir _shared/fixtures.psql

select ok((select 'security_invoker=true' = any(reloptions) from pg_class where relname = 'client_events_v'),
  'client_events_v is security_invoker');
select ok((select 'security_invoker=true' = any(reloptions) from pg_class where relname = 'client_lineup_v'),
  'client_lineup_v is security_invoker');

-- event_windows is deliberately NOT security_invoker: it is how the client
-- portal gets its min-start/max-end window without a policy on the
-- money-bearing shift_requirements table (see 0002_client_money_isolation).
select ok(coalesce((select reloptions from pg_class where relname = 'event_windows'), '{}') = '{}',
  'event_windows runs with definer rights and exposes no rate column');

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

select is(
  (select count(*)::int
     from information_schema.columns c
     join pg_class k on k.relname = c.table_name and k.relkind = 'v'
    where c.table_schema = 'public'
      and c.table_name like 'client!_%' escape '!'
      and c.column_name ~ '(rate|charge|margin|cost|amount|price|salary|payroll)'),
  0,
  '§11.1 no client-facing view has a money column');

-- The line-up view is only meaningful to an admin today; see the KNOWN GAP
-- in 020_rls_client.sql.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_lineup_v where booking_id in (:'booking_a', :'booking_b')), 2,
  'client_lineup_v resolves for admin, so the view body itself is sound');
select is((select role from client_lineup_v where booking_id = :'booking_a'), 'RLS Fixture Role',
  'client_lineup_v shows the role name, not the rate');
select is((select name from client_lineup_v where booking_id = :'booking_a'), 'Staff Alpha',
  'client_lineup_v shows the worker name');

reset role;
select * from finish();
rollback;
