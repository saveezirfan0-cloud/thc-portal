-- =====================================================================
-- 916 · The suggested buffer setting (20261022180000, ADR-0181)
--
-- settings.buffer_suggestion ships as one for every five, rounded down, no
-- minimum, switched on. Only those four keys in those shapes can be stored.
-- Every office role reads it (the Shift Builder pre-fills from it); only an
-- owner changes it, and the change is audited; a worker or a client can
-- neither read nor write it.
-- =====================================================================
begin;
select plan(27);
\ir _shared/fixtures.psql

\set manager   '91600000-0000-4000-8000-000000000001'
\set scheduler '91600000-0000-4000-8000-000000000002'

insert into auth.users (id, email) values
  (:'manager',   'manager.916@rls.test'),
  (:'scheduler', 'scheduler.916@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'manager',   'admin', 'manager',   'Mona Manager'),
  (:'scheduler', 'admin', 'scheduler', 'Sam Scheduler');

-- ---------------------------------------------------------------------
-- 1 · Seeded
-- ---------------------------------------------------------------------
select is((select value from settings where key = 'buffer_suggestion'),
  '{"enabled": true, "per": 5, "rounding": "down", "minimum": 0}'::jsonb,
  'the suggestion ships on: one for every five, rounded down, no minimum');

-- ---------------------------------------------------------------------
-- 2 · Only a rule can be stored
-- ---------------------------------------------------------------------
select lives_ok($$ update settings set value = '{"enabled": false, "per": 4, "rounding": "up", "minimum": 1}'
                   where key = 'buffer_suggestion' $$,
  'another valid rule is accepted (off, 1 per 4, rounded up, at least 1)');
select lives_ok($$ update settings set value = '{"enabled": true, "per": 100, "rounding": "down", "minimum": 20}'
                   where key = 'buffer_suggestion' $$,
  'and the upper edges (per 100, minimum 20)');
select lives_ok($$ update settings set value = '{"enabled": true, "per": 1, "rounding": "down", "minimum": 0}'
                   where key = 'buffer_suggestion' $$,
  'and the lower edges (per 1, minimum 0)');

select throws_ok($$ update settings set value = '"1 per 5"' where key = 'buffer_suggestion' $$,
  '22023', 'buffer_suggestion_invalid', 'a string is not a rule');
select throws_ok($$ update settings set value = '{"enabled": true, "per": 5, "rounding": "down"}' where key = 'buffer_suggestion' $$,
  '22023', 'buffer_suggestion_invalid', 'a missing key is refused');
select throws_ok($$ update settings set value = '{"enabled": true, "per": 5, "rounding": "down", "minimum": 0, "max": 9}' where key = 'buffer_suggestion' $$,
  '22023', 'buffer_suggestion_invalid', 'an extra key is refused');
select throws_ok($$ update settings set value = '{"enabled": "yes", "per": 5, "rounding": "down", "minimum": 0}' where key = 'buffer_suggestion' $$,
  '22023', 'buffer_suggestion_invalid', 'on/off is a JSON boolean');
select throws_ok($$ update settings set value = '{"enabled": true, "per": 0, "rounding": "down", "minimum": 0}' where key = 'buffer_suggestion' $$,
  '22023', 'buffer_suggestion_invalid', 'per is at least 1');
select throws_ok($$ update settings set value = '{"enabled": true, "per": 101, "rounding": "down", "minimum": 0}' where key = 'buffer_suggestion' $$,
  '22023', 'buffer_suggestion_invalid', 'and at most 100');
select throws_ok($$ update settings set value = '{"enabled": true, "per": 2.5, "rounding": "down", "minimum": 0}' where key = 'buffer_suggestion' $$,
  '22023', 'buffer_suggestion_invalid', 'per is a whole number');
select throws_ok($$ update settings set value = '{"enabled": true, "per": "5", "rounding": "down", "minimum": 0}' where key = 'buffer_suggestion' $$,
  '22023', 'buffer_suggestion_invalid', 'per is a JSON number');
select throws_ok($$ update settings set value = '{"enabled": true, "per": 5, "rounding": "nearest", "minimum": 0}' where key = 'buffer_suggestion' $$,
  '22023', 'buffer_suggestion_invalid', 'rounding is down or up');
select throws_ok($$ update settings set value = '{"enabled": true, "per": 5, "rounding": "down", "minimum": -1}' where key = 'buffer_suggestion' $$,
  '22023', 'buffer_suggestion_invalid', 'the minimum is not negative');
select throws_ok($$ update settings set value = '{"enabled": true, "per": 5, "rounding": "down", "minimum": 21}' where key = 'buffer_suggestion' $$,
  '22023', 'buffer_suggestion_invalid', 'and at most 20');
select throws_ok($$ insert into settings (key, value) values ('buffer_suggestion', '[]')
                   on conflict (key) do update set value = excluded.value $$,
  '22023', 'buffer_suggestion_invalid', 'an upsert is held to it too');
select lives_ok($$ insert into settings (key, value) values ('buffer_probe_916', '"x"') $$,
  'the guard leaves every other key alone');

update settings set value = '{"enabled": true, "per": 5, "rounding": "down", "minimum": 0}'
 where key = 'buffer_suggestion';

-- ---------------------------------------------------------------------
-- 3 · Who reads and writes it
-- ---------------------------------------------------------------------
set local role authenticated;

select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
select is((select value ->> 'per' from settings where key = 'buffer_suggestion'), '5',
  'a scheduler reads it — the Shift Builder pre-fills from it');
with u as (update settings set value = '{"enabled": false, "per": 5, "rounding": "down", "minimum": 0}'
            where key = 'buffer_suggestion' returning 1)
select is((select count(*)::int from u), 0, 'but a scheduler''s change touches no row');

select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
select is((select count(*)::int from settings where key = 'buffer_suggestion'), 1, 'a manager reads it');
with u as (update settings set value = '{"enabled": false, "per": 5, "rounding": "down", "minimum": 0}'
            where key = 'buffer_suggestion' returning 1)
select is((select count(*)::int from u), 0, 'and cannot change it either');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select is((select count(*)::int from settings where key = 'buffer_suggestion'), 0, 'a worker cannot read it');
with u as (update settings set value = '{"enabled": false, "per": 5, "rounding": "down", "minimum": 0}'
            where key = 'buffer_suggestion' returning 1)
select is((select count(*)::int from u), 0, 'nor change it');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select is((select count(*)::int from settings where key = 'buffer_suggestion'), 0, 'a client cannot read it');
with u as (update settings set value = '{"enabled": false, "per": 5, "rounding": "down", "minimum": 0}'
            where key = 'buffer_suggestion' returning 1)
select is((select count(*)::int from u), 0, 'nor change it');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
with u as (update settings set value = '{"enabled": true, "per": 5, "rounding": "up", "minimum": 0}'
            where key = 'buffer_suggestion' returning 1)
select is((select count(*)::int from u), 1, 'an owner changes it (rounded up)');

reset role;
select is((select count(*)::int from audit_log
            where action = 'settings.update'
              and actor = :'admin_uid'
              and data = jsonb_build_object(
                'key', 'buffer_suggestion',
                'from', '{"enabled": true, "per": 5, "rounding": "down", "minimum": 0}'::jsonb,
                'to',   '{"enabled": true, "per": 5, "rounding": "up", "minimum": 0}'::jsonb)),
  1, 'and the change is in the settings history: who, from and to');

select * from finish();
rollback;
