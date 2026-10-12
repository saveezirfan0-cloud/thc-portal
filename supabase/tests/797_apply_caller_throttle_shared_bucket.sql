-- =====================================================================
-- 797 · /apply's caller throttle no longer fails open
--       20261012121100 · ADR-0024, §2.12
--
-- A null p_caller_hash (no address on the request, or no
-- APPLY_THROTTLE_SALT in production) skipped the per-caller limit. Now
-- every such call shares one bucket with its own limits
-- (apply_caller_throttle.unidentified_per_hour / _per_day, defaults
-- 30 / 200); the shared key cannot be claimed by a caller.
-- =====================================================================
begin;
select plan(7);

update settings set value = value || '{"unidentified_per_hour": 3}'::jsonb where key = 'apply_caller_throttle';

set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select lives_ok(format($$ select submit_application_as_caller('Nul', 'Hash', 'n%s@t797.test', '+44770097970%s',
                                   date '1995-01-01', true, null) $$, n, n))
  from generate_series(1, 3) n;
select throws_ok(
  $$ select submit_application_as_caller('Nul', 'Four', 'n4@t797.test', '+447700979704', date '1995-01-01', true, null) $$,
  '22023', 'We’ve received several applications from your connection recently. Please try again later — or email admin@thehospitalitycompany.co.uk and we’ll help.',
  'the fourth null-hash application in an hour is refused: the unidentified callers share one bucket');
select lives_ok(
  $$ select submit_application_as_caller('Real', 'Caller', 'r1@t797.test', '+447700979710', date '1995-01-01', true,
       'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') $$,
  'a caller with its own hash is unaffected');
select throws_ok(
  $$ select submit_application_as_caller('Sly', 'Caller', 's1@t797.test', '+447700979711', date '1995-01-01', true,
       repeat('0', 64)) $$,
  'P0001', 'bad_caller_hash', 'nobody may send the shared bucket''s key as their own');
reset role;

select is((select count(*)::int from private.apply_caller_hits where caller_hash = repeat('0', 64) and at > now() - interval '1 minute'), 3,
  'the three accepted null-hash applications were counted');

select * from finish();
rollback;
