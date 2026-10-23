-- =====================================================================
-- 933 · A client left out of invoicing (ADR-0203)
--       — 20261026120000_client_excluded_from_invoicing.sql
-- =====================================================================
begin;
select plan(8);
\ir _shared/fixtures.psql

select col_not_null('public', 'clients', 'exclude_from_invoicing', 'never "not set"');
select col_default_is('public', 'clients', 'exclude_from_invoicing', 'false', 'invoiced from the platform unless a client says otherwise');
select ok(regexp_replace(lower('Leonardo Hotel St Paul’s M&E'), '[^a-z0-9]', '', 'g') = 'leonardohotelstpaulsme',
  'the migration''s name match takes the curly apostrophe and "M&E"');

select ok(not has_function_privilege('anon', 'public.set_client_exclude_from_invoicing(uuid, boolean)', 'execute'),
  'anon cannot call set_client_exclude_from_invoicing');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format('select set_client_exclude_from_invoicing(%L, true)', :'clienta'), '42501', 'admins_only',
  'a client cannot leave itself out of invoicing');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format('select set_client_exclude_from_invoicing(%L, true)', :'clienta'), '42501', 'admins_only',
  'a worker cannot leave a client out of invoicing');
reset role;

-- The switch (as the table owner: the admin gate is current_app_role()).
update clients set exclude_from_invoicing = true where id = :'clienta';
select is((select count(*)::int from _invoice_groups(now() + interval '60 days') g where g.client_id = :'clienta'), 0,
  'an excluded client is never a candidate for an invoice');
select is((select exclude_from_invoicing from clients where id = :'clientb'), false,
  'another client is untouched');

select * from finish();
rollback;
