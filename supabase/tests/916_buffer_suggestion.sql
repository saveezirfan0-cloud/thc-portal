-- =====================================================================
-- 916 · The suggested buffer setting (20261022180000, ADR-0181)
--
-- settings.buffer_suggestion ships as the client's answer of 21.10.2026:
-- one for every five, rounded up; roles under five get none unless they
-- start before 08:00, then one. Only those six keys in those shapes can be
-- stored — the accepted and refused cases are the ones in
-- packages/domain/src/bufferSuggestion.vectors.json. Every office role
-- reads it (the Shift Builder pre-fills from it), the viewer included;
-- only an owner changes it, and the change is audited; a worker or a
-- client can neither read nor write it.
-- =====================================================================
begin;
select plan(43);
\ir _shared/fixtures.psql

\set manager   '91600000-0000-4000-8000-000000000001'
\set scheduler '91600000-0000-4000-8000-000000000002'
\set viewer    '91600000-0000-4000-8000-000000000003'

insert into auth.users (id, email) values
  (:'manager',   'manager.916@rls.test'),
  (:'scheduler', 'scheduler.916@rls.test'),
  (:'viewer',    'viewer.916@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'manager',   'admin', 'manager',   'Mona Manager'),
  (:'scheduler', 'admin', 'scheduler', 'Sam Scheduler'),
  (:'viewer',    'admin', 'viewer',    'Vic Viewer');

\set seed '{"enabled": true, "per": 5, "rounding": "up", "from_headcount": 5, "early_start_before": "08:00", "early_start_extra": 1}'

-- The seed, where a function body can read it (psql does not expand
-- :'seed' inside dollar quotes).
select set_config('t916.seed', :'seed', true);
-- The seed with one key replaced, for the refusals below.
create function pg_temp.with_key(k text, val jsonb) returns jsonb language sql as $$
  select jsonb_set(current_setting('t916.seed')::jsonb, array[k], val)
$$;
-- True when the guard refuses `val` with buffer_suggestion_invalid.
create function pg_temp.refused(val jsonb) returns boolean language plpgsql as $$
begin
  update settings set value = val where key = 'buffer_suggestion';
  return false;
exception when sqlstate '22023' then
  return sqlerrm = 'buffer_suggestion_invalid';
end $$;

-- ---------------------------------------------------------------------
-- 1 · Seeded
-- ---------------------------------------------------------------------
select is((select value from settings where key = 'buffer_suggestion'), :'seed'::jsonb,
  'the suggestion ships as the client asked: 1 per 5 rounded up, none under 5 unless before 08:00, then 1');

-- ---------------------------------------------------------------------
-- 2 · Only a rule can be stored (bufferSuggestion.vectors.json "rules")
-- ---------------------------------------------------------------------
select lives_ok($$ update settings set value = '{"enabled": false, "per": 4, "rounding": "down", "from_headcount": 0, "early_start_before": null, "early_start_extra": 0}'
                   where key = 'buffer_suggestion' $$,
  'accepted: off, rounded down, no early start (null)');
select lives_ok($$ update settings set value = '{"enabled": true, "per": 100, "rounding": "up", "from_headcount": 100, "early_start_before": "23:59", "early_start_extra": 20}'
                   where key = 'buffer_suggestion' $$,
  'accepted: the upper edges');
select lives_ok($$ update settings set value = '{"enabled": true, "per": 1, "rounding": "up", "from_headcount": 0, "early_start_before": "00:00", "early_start_extra": 0}'
                   where key = 'buffer_suggestion' $$,
  'accepted: the lower edges');

select throws_ok($$ update settings set value = '"1 per 5"' where key = 'buffer_suggestion' $$,
  '22023', 'buffer_suggestion_invalid', 'refused: a string');
select ok(pg_temp.refused('[]'), 'refused: a list');
select ok(pg_temp.refused('null'), 'refused: a JSON null');
select ok(pg_temp.refused('{}'), 'refused: an empty object');
select ok(pg_temp.refused(current_setting('t916.seed')::jsonb - 'early_start_extra'), 'refused: a missing key');
select ok(pg_temp.refused(current_setting('t916.seed')::jsonb - 'early_start_before'),
  'refused: no early-start key at all (no rule is a JSON null, not a missing key)');
select ok(pg_temp.refused(current_setting('t916.seed')::jsonb || '{"minimum": 0}'), 'refused: an extra key (the old "minimum")');
select ok(pg_temp.refused(pg_temp.with_key('enabled', '"yes"')), 'refused: enabled as text');
select ok(pg_temp.refused(pg_temp.with_key('enabled', 'null')), 'refused: enabled null');
select ok(pg_temp.refused(pg_temp.with_key('per', '0')), 'refused: per 0');
select ok(pg_temp.refused(pg_temp.with_key('per', '101')), 'refused: per 101');
select ok(pg_temp.refused(pg_temp.with_key('per', '2.5')), 'refused: per a fraction');
select ok(pg_temp.refused(pg_temp.with_key('per', '"5"')), 'refused: per as text');
select ok(pg_temp.refused(pg_temp.with_key('rounding', '"nearest"')), 'refused: another rounding');
select ok(pg_temp.refused(pg_temp.with_key('rounding', '1')), 'refused: rounding not a string');
select ok(pg_temp.refused(pg_temp.with_key('rounding', 'null')), 'refused: rounding null');
select ok(pg_temp.refused(pg_temp.with_key('from_headcount', '-1')), 'refused: from_headcount negative');
select ok(pg_temp.refused(pg_temp.with_key('from_headcount', '101')), 'refused: from_headcount 101');
select ok(pg_temp.refused(pg_temp.with_key('early_start_before', '"8am"')), 'refused: early start "8am"');
select ok(pg_temp.refused(pg_temp.with_key('early_start_before', '"24:00"')), 'refused: early start 24:00');
select ok(pg_temp.refused(pg_temp.with_key('early_start_before', '"08:00:00"')), 'refused: early start with seconds');
select ok(pg_temp.refused(pg_temp.with_key('early_start_before', '""')), 'refused: early start blank text');
select ok(pg_temp.refused(pg_temp.with_key('early_start_before', '800')), 'refused: early start a number');
select ok(pg_temp.refused(pg_temp.with_key('early_start_extra', '-1')), 'refused: early extra negative');
select ok(pg_temp.refused(pg_temp.with_key('early_start_extra', '21')), 'refused: early extra 21');
select ok(pg_temp.refused(pg_temp.with_key('early_start_extra', '0.5')), 'refused: early extra a fraction');
select throws_ok($$ insert into settings (key, value) values ('buffer_suggestion', '[]')
                   on conflict (key) do update set value = excluded.value $$,
  '22023', 'buffer_suggestion_invalid', 'an upsert is held to it too');
select lives_ok($$ insert into settings (key, value) values ('buffer_probe_916', '"x"') $$,
  'the guard leaves every other key alone');

update settings set value = :'seed'::jsonb where key = 'buffer_suggestion';

-- ---------------------------------------------------------------------
-- 3 · Who reads and writes it
-- ---------------------------------------------------------------------
set local role authenticated;

select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
select is((select value ->> 'early_start_before' from settings where key = 'buffer_suggestion'), '08:00',
  'a scheduler reads it — the Shift Builder pre-fills from it');
with u as (update settings set value = jsonb_set(value, '{enabled}', 'false')
            where key = 'buffer_suggestion' returning 1)
select is((select count(*)::int from u), 0, 'but a scheduler''s change touches no row');

select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
select is((select count(*)::int from settings where key = 'buffer_suggestion'), 1, 'a manager reads it');
with u as (update settings set value = jsonb_set(value, '{enabled}', 'false')
            where key = 'buffer_suggestion' returning 1)
select is((select count(*)::int from u), 0, 'and cannot change it either');

select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
select is((select value ->> 'per' from settings where key = 'buffer_suggestion'), '5',
  'a viewer reads it (the builder opens read-only for them)');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select is((select count(*)::int from settings where key = 'buffer_suggestion'), 0, 'a worker cannot read it');
with u as (update settings set value = jsonb_set(value, '{enabled}', 'false')
            where key = 'buffer_suggestion' returning 1)
select is((select count(*)::int from u), 0, 'nor change it');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select is((select count(*)::int from settings where key = 'buffer_suggestion'), 0, 'a client cannot read it');
with u as (update settings set value = jsonb_set(value, '{enabled}', 'false')
            where key = 'buffer_suggestion' returning 1)
select is((select count(*)::int from u), 0, 'nor change it');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
with u as (update settings set value = jsonb_set(value, '{rounding}', '"down"')
            where key = 'buffer_suggestion' returning 1)
select is((select count(*)::int from u), 1, 'an owner changes it (rounded down)');

reset role;
select is((select count(*)::int from audit_log
            where action = 'settings.update'
              and actor = :'admin_uid'
              and data = jsonb_build_object(
                'key', 'buffer_suggestion',
                'from', :'seed'::jsonb,
                'to',   jsonb_set(:'seed'::jsonb, '{rounding}', '"down"'))),
  1, 'and the change is in the settings history: who, from and to');

select * from finish();
rollback;
