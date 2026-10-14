-- =====================================================================
-- 822 · Editing safety: the pay floor, a client phone, length caps
--       (20261014160000, release audit D-M2, D-M3, D-M7, ADR-0137)
--
--   1. the floor: settings.minimum_hourly_pay (£12.71, 2026/27) read by
--      minimum_pay_rate(); create_role / update_role (a changed rate
--      only) / set_staff_pay_rate refuse below it and above £1,000/h;
--   2. a client's phone is 7–15 digits once separators are out, UK or
--      international; names capped;
--   3. the caps on the tables: venue and client name 120, a dress code
--      200 (rate card list and event section), office feedback 2,000 —
--      held for a direct write too, as a manager would reach PostgREST.
-- =====================================================================
begin;
select plan(26);
\ir _shared/fixtures.psql

\set manager '82200000-0000-4000-8000-000000000001'
\set old_role '82200000-0000-4000-8000-000000000002'

insert into auth.users (id, email) values (:'manager', 'manager.822@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'manager', 'admin', 'manager', 'Mona Manager');
-- A role priced under an older floor, as a catalogue row from before it.
insert into roles (id, name, pay_rate) values (:'old_role', 'Legacy Fixture Role', 11.44);

-- =====================================================================
-- 1 · The floor
-- =====================================================================
select is((select value from settings where key = 'minimum_hourly_pay'), '12.71'::jsonb,
  'the setting holds the 2026/27 National Living Wage, £12.71');
select is(minimum_pay_rate(), 12.71::numeric, 'minimum_pay_rate() reads it');
select ok(not has_function_privilege('anon', 'minimum_pay_rate()', 'execute'),
  'and it is not anon''s');

select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok($$ select create_role('Below Floor', 12.70, null) $$,
  '23514', 'A pay rate cannot be below the National Living Wage, £12.71/h',
  'create_role refuses a base rate a penny under the floor');
select throws_ok($$ select create_role('Zero', 0.00, null) $$,
  '23514', null, 'and £0.00');
select throws_ok($$ select create_role('Too High', 999999.00, null) $$,
  '23514', 'A pay rate over £1,000.00 an hour is refused — check the figure',
  'and 999999 with a sentence, not a numeric overflow');
select lives_ok($$ select create_role('At Floor', 12.71, null) $$, 'the floor itself is allowed');
select lives_ok(format($$ select update_role(%L, 'Legacy Fixture Role (renamed)', 11.44, null) $$, :'old_role'),
  'a role priced under an older floor can still be renamed — its rate is not being set');
select throws_ok(format($$ select update_role(%L, 'Legacy Fixture Role', 12.00, null) $$, :'old_role'),
  '23514', null, 'but changing its rate meets today''s floor');
select throws_ok(format($$ select set_staff_pay_rate(%L, 0.00) $$, :'staffa'),
  '23514', 'A pay rate cannot be below the National Living Wage, £12.71/h',
  'set_staff_pay_rate refuses a personal rate of £0.00');
select lives_ok(format($$ select set_staff_pay_rate(%L, 12.71) $$, :'staffa'),
  'and accepts the floor');
select lives_ok(format($$ select set_staff_pay_rate(%L, null) $$, :'staffa'),
  'clearing a personal rate is not a rate, and is allowed');

reset role;
update settings set value = '13.00'::jsonb where key = 'minimum_hourly_pay';
set local role authenticated;
select throws_ok($$ select create_role('Under The New Floor', 12.90, null) $$,
  '23514', 'A pay rate cannot be below the National Living Wage, £13.00/h',
  'next April''s figure is a settings change, not a release');
reset role;
update settings set value = '12.71'::jsonb where key = 'minimum_hourly_pay';
set local role authenticated;

-- =====================================================================
-- 2 · A client phone that is a phone; bounded names
-- =====================================================================
select throws_ok($$ select create_client('Phone Ltd', 'P', 'not a phone', 'Desk', array['a@b.co'], true, true) $$,
  '23514', 'Enter the contact phone as a phone number, e.g. 020 7946 0000 or +44 20 7946 0000',
  'create_client refuses "not a phone"');
select throws_ok($$ select create_client('Phone Ltd', 'P', '12345', 'Desk', array['a@b.co'], true, true) $$,
  '23514', null, 'and five digits');
select lives_ok($$ select create_client('UK Phone Ltd', 'P', '020 7946 0000', 'Desk', array['a@b.co'], true, true) $$,
  'a UK number with spaces');
select lives_ok($$ select create_client('Intl Phone Ltd', 'P', '+33 (1) 23-45-67-89', 'Desk', array['a@b.co'], true, true) $$,
  'an international number with brackets and dashes');
select throws_ok(format($$ select create_client(%L, 'P', '020 7946 0000', 'Desk', array['a@b.co'], true, true) $$, repeat('N', 121)),
  '23514', 'A client name is at most 120 characters', 'a 121-character client name is refused');

-- =====================================================================
-- 3 · Caps on the tables, for every path
-- =====================================================================
select throws_ok(format($$ select create_venue(%L, '1 Cap Street, London', 51.5, -0.1, 'hotel', 150) $$, repeat('V', 121)),
  '23514', 'A venue name is at most 120 characters', 'create_venue refuses a 121-character name');
select throws_ok(format($$ update venues set name = %L where id = %L $$, repeat('V', 121), :'venue_id'),
  '23514', null, 'and the table refuses it on any other path');
select throws_ok(format($$ update clients set name = %L where id = %L $$, repeat('C', 121), :'clienta'),
  '23514', null, 'the clients table refuses a 121-character name');
select throws_ok(format($$ select update_client_role(%L, 20.00, array[%L]) $$, :'ratecard_a', repeat('D', 201)),
  '23514', null, 'a rate card dress code of 201 characters is refused');
select lives_ok(format($$ select update_client_role(%L, 20.00, array[%L]) $$, :'ratecard_a', repeat('D', 200)),
  'and 200 is fine');
select throws_ok(format($$ update shift_requirements set dress_code = %L where id = %L $$, repeat('D', 201), :'shift_a'),
  '23514', null, 'an event section''s own dress code is capped too');
select throws_ok(format($$ select add_office_feedback(%L, 4, %L, null) $$, :'staffa', repeat('F', 2001)),
  '23514', null, 'office feedback over 2,000 characters is refused, as a client''s is');

reset role;
select is((select count(*)::int from pg_constraint
            where conname in ('venues_name_length', 'clients_name_length',
                              'client_rate_cards_dress_code_length',
                              'shift_requirements_dress_code_length',
                              'feedback_office_text_length')
              and convalidated), 5,
  'all five caps are validated on today''s data');

select * from finish();
rollback;
