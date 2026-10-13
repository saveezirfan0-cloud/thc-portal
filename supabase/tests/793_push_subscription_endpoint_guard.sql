-- =====================================================================
-- 793 · a push endpoint is a real push service's, and stays with its
--       device
--       20261012120700 · §10.5, §8
--
-- save_push_subscription() took any endpoint and moved a clashing row to
-- whoever called. Now: https on a known Web Push host; another worker's
-- row moves only with the same keys (the shared phone); ten per worker.
-- =====================================================================
begin;
select plan(16);
\ir _shared/fixtures.psql

\set fcm 'https://fcm.googleapis.com/fcm/send/'

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

-- =====================================================================
-- 1 · Which endpoints
-- =====================================================================
select lives_ok(format($$ select save_push_subscription(%L, 'k-a', 'a-a') $$, :'fcm' || 'alpha-1'),
  'Chrome / Android (fcm.googleapis.com)');
select lives_ok($$ select save_push_subscription('https://updates.push.services.mozilla.com/wpush/v2/gAAA', 'k-m', 'a-m') $$,
  'Firefox (updates.push.services.mozilla.com)');
select lives_ok($$ select save_push_subscription('https://web.push.apple.com/QGuQyavXutnMH', 'k-s', 'a-s') $$,
  'Safari / iOS (web.push.apple.com)');
select lives_ok($$ select save_push_subscription('https://wns2-par02p.notify.windows.com/w/?token=BQYAAA', 'k-w', 'a-w') $$,
  'Edge / Windows (*.notify.windows.com)');
select throws_ok($$ select save_push_subscription('https://attacker.example/collect', 'k', 'a') $$,
  '22023', 'endpoint_not_a_push_service', 'any other host is refused');
select throws_ok($$ select save_push_subscription('http://fcm.googleapis.com/fcm/send/x', 'k', 'a') $$,
  '22023', 'endpoint_not_a_push_service', 'plain http is refused');
select throws_ok($$ select save_push_subscription('https://fcm.googleapis.com.attacker.example/x', 'k', 'a') $$,
  '22023', 'endpoint_not_a_push_service', 'a look-alike suffix is refused');
select throws_ok($$ select save_push_subscription('https://evil.example/fcm.googleapis.com/x', 'k', 'a') $$,
  '22023', 'endpoint_not_a_push_service', 'the host in the path is refused');

-- =====================================================================
-- 2 · Another worker's endpoint
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
select lives_ok(format($$ select save_push_subscription(%L, 'junk', 'junk') $$, :'fcm' || 'alpha-1'),
  'a worker posting someone else''s endpoint with other keys gets no error (no oracle)');
reset role;
select is((select staff_id from push_subscriptions where endpoint = :'fcm' || 'alpha-1'), :'staffa'::uuid,
  'and the endpoint stays with its owner');
select is((select p256dh from push_subscriptions where endpoint = :'fcm' || 'alpha-1'), 'k-a',
  'keys untouched');

set local role authenticated;
select lives_ok(format($$ select save_push_subscription(%L, 'k-a', 'a-a') $$, :'fcm' || 'alpha-1'),
  'the shared phone: the same subscription, keys and all');
reset role;
select is((select staff_id from push_subscriptions where endpoint = :'fcm' || 'alpha-1'), :'staffb'::uuid,
  'follows whoever is signed in now');

-- =====================================================================
-- 3 · Ten per worker
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(format($$ select save_push_subscription(%L || n, 'k' || n, 'a' || n) from generate_series(1, 12) n $$, :'fcm' || 'many-'),
  'twelve more devices');
reset role;
select is((select count(*)::int from push_subscriptions where staff_id = :'staffa'), 10,
  'leave ten rows');
select ok(exists (select 1 from push_subscriptions where endpoint = :'fcm' || 'many-12')
      and not exists (select 1 from push_subscriptions where endpoint = 'https://updates.push.services.mozilla.com/wpush/v2/gAAA'),
  'the newest is kept and the least recently seen went');

select * from finish();
rollback;
