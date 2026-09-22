-- =====================================================================
-- 330 · The device's write path into push_subscriptions (§10.5, §8)
--
-- The table's RLS is already covered (010 admin, 030 staff, 040 anon).
-- What is new in 20260922181000 is the pair of functions the Staff App
-- uses, and the things that can only go wrong there:
--
--   · the endpoint is UNIQUE and STABLE per browser, so the second launch
--     of the app is an upsert, not an insert. If that raises, a worker with
--     a perfectly good subscription is told push failed.
--   · two workers share a phone. The endpoint belongs to the browser, so
--     it must follow whoever is signed in — otherwise the second worker
--     silently receives nothing.
--   · a worker must not be able to retire another worker's endpoint. That
--     is a denial of service on someone else's shift reminders.
--   · a leaver (§10.6) and a removed worker (§1.7) leave the send list, so
--     nothing may put them back on it.
--
-- Everything below runs as `authenticated`, the role PostgREST actually
-- uses. pgTAP itself runs as the table owner, which bypasses RLS and holds
-- every grant, so a test that only sets the JWT proves nothing about the
-- door the app comes through.
-- =====================================================================
begin;
select plan(15);

\set a_uid  'e1e1e1e1-0000-4000-8000-000000000001'
\set b_uid  'e1e1e1e1-0000-4000-8000-000000000002'
\set c_uid  'e1e1e1e1-0000-4000-8000-000000000003'
\set a      'e2e2e2e2-0000-4000-8000-000000000001'
\set b      'e2e2e2e2-0000-4000-8000-000000000002'
\set gone   'e2e2e2e2-0000-4000-8000-000000000003'

insert into auth.users (id, email) values
  (:'a_uid', 'push-a@staff.test'),
  (:'b_uid', 'push-b@staff.test'),
  (:'c_uid', 'push-leaver@staff.test');

insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'a', :'a_uid', 'Push', 'Alpha',  'push-a@staff.test',      '+447700900801', date '1994-03-03', 'compliant', 'uk_irish'),
  (:'b', :'b_uid', 'Push', 'Beta',   'push-b@staff.test',      '+447700900802', date '1993-04-04', 'compliant', 'uk_irish'),
  (:'gone', :'c_uid', 'Push', 'Leaver', 'push-leaver@staff.test', '+447700900803', date '1992-05-05', 'inactive', 'uk_irish');

-- ---------------------------------------------------------------------
-- 1. Structure: definer with a pinned search_path, and the right grants.
--
--    Definer is load-bearing here (the upsert has to cross a unique
--    constraint the caller cannot see past), which is exactly why the
--    search_path pin matters: a definer function resolving `staff` against
--    a caller-controlled search_path is a privilege escalation.
-- ---------------------------------------------------------------------
select bag_eq(
  $$ select p.proname::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('save_push_subscription', 'forget_push_subscription')
        and p.prosecdef
        and array_to_string(p.proconfig, ',') like '%search_path=%' $$,
  $$ values ('save_push_subscription'::text), ('forget_push_subscription') $$,
  'both functions are security definer AND pin their search_path'
);

select ok(
  not has_function_privilege('anon', 'save_push_subscription(text,text,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'forget_push_subscription(text)', 'execute'),
  'anon cannot execute either: a subscription belongs to a signed-in worker'
);

select ok(
  has_function_privilege('authenticated', 'save_push_subscription(text,text,text,text,text)', 'execute')
  and has_function_privilege('authenticated', 'forget_push_subscription(text)', 'execute'),
  'the signed-in worker can, which is the only caller the Staff App has'
);

-- ---------------------------------------------------------------------
-- 2. Worker A registers a device.
-- ---------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e1e1e1e1-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok(
  $$ select save_push_subscription('https://push.example/aaa', 'p256-a', 'auth-a', 'iPhone/17') $$,
  'a worker registers their own endpoint'
);

-- The same browser returns the same endpoint on every launch. This is the
-- assertion that stops 23505 being reported to the worker as "push failed".
select lives_ok(
  $$ select save_push_subscription('https://push.example/aaa', 'p256-a2', 'auth-a2', 'iPhone/17') $$,
  're-registering the SAME endpoint is an upsert, not a unique violation'
);

select is(
  (select count(*)::int from push_subscriptions where endpoint = 'https://push.example/aaa'),
  1,
  'and leaves exactly one row, not two'
);

select is(
  (select p256dh from push_subscriptions where endpoint = 'https://push.example/aaa'),
  'p256-a2',
  'the refreshed keys replace the old ones — a stale p256dh is an undeliverable push'
);

-- ---------------------------------------------------------------------
-- 3. Rotation (`pushsubscriptionchange`, §10.5): the retired endpoint goes
--    in the same call, so the drain never posts to a dead one.
-- ---------------------------------------------------------------------
select lives_ok(
  $$ select save_push_subscription('https://push.example/aaa2', 'p256-a3', 'auth-a3', 'iPhone/17',
                                   'https://push.example/aaa') $$,
  'a rotated endpoint is saved and the old one named'
);

select is(
  (select count(*)::int from push_subscriptions
    where staff_id = 'e2e2e2e2-0000-4000-8000-000000000001'
      and endpoint = 'https://push.example/aaa'),
  0,
  'the retired endpoint is gone, so nothing keeps posting to it'
);

-- ---------------------------------------------------------------------
-- 4. The shared phone. Worker B signs into the same browser, so the SAME
--    endpoint arrives under a different session and must follow them.
-- ---------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"e1e1e1e1-0000-4000-8000-000000000002","role":"authenticated"}';

select lives_ok(
  $$ select save_push_subscription('https://push.example/aaa2', 'p256-b', 'auth-b', 'iPhone/17') $$,
  'the second worker on a shared device re-registers the same endpoint'
);

select is(
  (select staff_id from push_subscriptions where endpoint = 'https://push.example/aaa2'),
  'e2e2e2e2-0000-4000-8000-000000000002'::uuid,
  'and it now belongs to whoever is signed in — otherwise they get no pushes at all'
);

-- B registers a second device of their own, then tries to retire it while
-- signed in as... themselves. The interesting case is the next one.
select lives_ok(
  $$ select save_push_subscription('https://push.example/bbb', 'p256-b2', 'auth-b2', 'Pixel/7') $$,
  'a worker may hold more than one device'
);

-- ---------------------------------------------------------------------
-- 5. A worker cannot retire someone else's device. Silent, not an error:
--    a distinct error would itself confirm another worker's endpoint.
-- ---------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"e1e1e1e1-0000-4000-8000-000000000001","role":"authenticated"}';
select save_push_subscription('https://push.example/ccc', 'p256-a4', 'auth-a4', 'iPad/17');

set local "request.jwt.claims" = '{"sub":"e1e1e1e1-0000-4000-8000-000000000002","role":"authenticated"}';
select forget_push_subscription('https://push.example/ccc');

reset role;
select is(
  (select staff_id from push_subscriptions where endpoint = 'https://push.example/ccc'),
  'e2e2e2e2-0000-4000-8000-000000000001'::uuid,
  'one worker cannot unsubscribe another worker''s device'
);

-- ---------------------------------------------------------------------
-- 6. A leaver is off the send list (§10.6, §2.12) and nothing puts them
--    back on it.
-- ---------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e1e1e1e1-0000-4000-8000-000000000003","role":"authenticated"}';

select throws_ok(
  $$ select save_push_subscription('https://push.example/ddd', 'p256-c', 'auth-c', 'Pixel/7') $$,
  '42501',
  'account_closed',
  'a leaver cannot register a device: they have left the scoring pool and every send'
);

-- ---------------------------------------------------------------------
-- 7. A signed-in account that is not a worker at all (an admin session
--    hitting the staff API) gets nothing.
-- ---------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"e1e1e1e1-0000-4000-8000-000000000009","role":"authenticated"}';

select throws_ok(
  $$ select save_push_subscription('https://push.example/eee', 'p256-x', 'auth-x', 'Chrome') $$,
  '42501',
  'not_a_worker',
  'a session with no staff row cannot register a device'
);

reset role;
select * from finish();
rollback;
