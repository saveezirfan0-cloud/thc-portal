-- =====================================================================
-- 896 · "Sign out other devices" stops their push notifications
--       (20261020130100, ADR-0164)
--
-- forget_other_push_subscriptions(keep) deletes the calling worker's
-- subscriptions except this device's, never another worker's, and only for
-- a live session.
-- =====================================================================
begin;
select plan(9);
\ir _shared/fixtures.psql

\set sess '89600000-0000-4000-8000-000000000001'
insert into auth.sessions (id, user_id, created_at, updated_at) values (:'sess', :'staffa_uid', now(), now());

-- Staff Alpha has the fixture's device plus two more; Staff Bravo has one.
insert into push_subscriptions (staff_id, endpoint, p256dh, auth) values
  (:'staffa', 'https://push.rls.test/896-stolen-phone', 'k', 'a'),
  (:'staffa', 'https://push.rls.test/896-old-tablet',   'k', 'a');

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', :'staffa_uid', 'role', 'authenticated', 'session_id', :'sess')::text, true);

select is(forget_other_push_subscriptions('https://push.rls.test/fixture-a'), 2,
  'the two other devices'' subscriptions are removed');
reset role;
select results_eq(
  format($$ select endpoint from push_subscriptions where staff_id = %L order by endpoint $$, :'staffa'),
  $$ values ('https://push.rls.test/fixture-a'::text) $$,
  'this device''s subscription stays');
select is((select count(*)::int from push_subscriptions where staff_id = :'staffb'), 1,
  'another worker''s subscriptions are untouched');

set local role authenticated;
select is(forget_other_push_subscriptions('https://push.rls.test/fixture-a'), 0,
  'running it again removes nothing more');
select is(forget_other_push_subscriptions('   '), 1,
  'a device with no subscription of its own (a blank endpoint) removes every one of the worker''s');
select is(forget_other_push_subscriptions(null), 0, 'and so does null — nothing is left');

-- An ended session reaches nothing.
reset role;
insert into push_subscriptions (staff_id, endpoint, p256dh, auth) values
  (:'staffa', 'https://push.rls.test/896-again', 'k', 'a');
delete from auth.sessions where id = :'sess';
set local role authenticated;
select throws_ok($$ select forget_other_push_subscriptions(null) $$, '42501', 'not_a_worker',
  'a signed-out session cannot remove anything');

-- An office login is not a worker.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated', 'aal', 'aal2')::text, true);
select throws_ok($$ select forget_other_push_subscriptions(null) $$, '42501', 'not_a_worker',
  'an office login has no push subscriptions to forget');
reset role;

select ok(not has_function_privilege('anon', 'public.forget_other_push_subscriptions(text)', 'execute'),
  'anon cannot call it');

select * from finish();
rollback;
