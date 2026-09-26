-- =====================================================================
-- 742 · The account invitation email, E11 (20261001200200, ADR-0058)
--
-- queue_account_invite: only an admin queues it; never for a worker's,
-- a switched-off or an already-used login; only for an /auth/invite link
-- with a token; the address and name come from the login, not the
-- caller. Keys E11:invite:<user>:<n>: the same link twice is one row, a
-- new link is a new row and withdraws the older unsent one. The audit row
-- never carries the link. And notification_outbox.queued_at, which /inbox
-- reads, is stamped on insert.
-- =====================================================================
begin;
select plan(47);
\ir _shared/fixtures.psql

\set newadmin  '65200000-0000-4000-8000-000000000001'
\set newclient '65200000-0000-4000-8000-000000000002'
\set usedadmin '65200000-0000-4000-8000-000000000003'
\set offadmin  '65200000-0000-4000-8000-000000000004'
\set noprofile '65200000-0000-4000-8000-000000000005'
\set token1 '0123456789abcdef0123456789abcdef0123456789abcdef01234567'
\set token2 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba98'
\set link1 'https://office.thc.example/auth/invite?token=0123456789abcdef0123456789abcdef0123456789abcdef01234567'
\set link2 'https://office.thc.example/auth/invite?token=fedcba9876543210fedcba9876543210fedcba9876543210fedcba98&type=magiclink'

insert into auth.users (id, email, last_sign_in_at, banned_until) values
  (:'newadmin',  'New.Admin@rls.test', null,                     null),
  (:'newclient', 'new.client@rls.test', null,                    null),
  (:'usedadmin', 'used.admin@rls.test', now() - interval '1 day', null),
  (:'offadmin',  'off.admin@rls.test',  null,                    now() + interval '100 years'),
  (:'noprofile', 'no.profile@rls.test', null,                    null);
insert into profiles (id, role, full_name, client_id) values
  (:'newadmin',  'admin',  'Nadia Admin',  null),
  (:'newclient', 'client', 'Carl Client',  :'clienta'),
  (:'usedadmin', 'admin',  'Uma Used',     null),
  (:'offadmin',  'admin',  'Otto Off',     null);

-- ---------------------------------------------------------------------
-- 1 · Shape and grants
-- ---------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'queue_account_invite(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'account_invite_link_ok(text)', 'execute'),
  'anon can execute neither function');
select ok(has_function_privilege('authenticated', 'queue_account_invite(uuid,text)', 'execute'),
  'a signed-in account may call it; the admin check inside decides');
select ok(
  not exists (select 1 from information_schema.routine_privileges
               where routine_name in ('queue_account_invite', 'account_invite_link_ok')
                 and grantee = 'PUBLIC'),
  'PUBLIC holds no execute on either');
select ok((select prosecdef from pg_proc where oid = 'queue_account_invite(uuid,text)'::regprocedure),
  'queue_account_invite is security definer');
select is((select proconfig from pg_proc where oid = 'queue_account_invite(uuid,text)'::regprocedure),
  array['search_path=public'], 'with a pinned search_path');
select col_not_null('notification_outbox', 'queued_at', 'notification_outbox.queued_at is not null');
select col_default_is('notification_outbox', 'queued_at', 'now()', 'and defaults to now()');

-- ---------------------------------------------------------------------
-- 2 · The link must be a set-up link, and nothing else
-- ---------------------------------------------------------------------
select ok(account_invite_link_ok(:'link1'), 'an https /auth/invite link with a token is accepted');
select ok(account_invite_link_ok(:'link2'), 'with the magiclink type beside the token too');
select ok(account_invite_link_ok('http://127.0.0.1:3002/auth/invite?token=' || :'token1'),
  'http on 127.0.0.1 is accepted, for a local stack');
select ok(account_invite_link_ok('http://localhost:3000/auth/invite?type=magiclink&token=' || :'token1'),
  'and on localhost, with the token anywhere in the query');
select ok(not account_invite_link_ok('http://office.thc.example/auth/invite?token=' || :'token1'),
  'plain http to a real host is refused');
select ok(not account_invite_link_ok('https://office.thc.example/auth/reset?token=' || :'token1'),
  'another path is refused');
select ok(not account_invite_link_ok('https://office.thc.example/auth/invite'),
  'a link with no token is refused');
select ok(not account_invite_link_ok('https://office.thc.example/auth/invite?token=abc123'),
  'a token too short to be GoTrue''s is refused');
select ok(not account_invite_link_ok('https://office.thc.example@evil.example/auth/invite?token=' || :'token1'),
  'userinfo before the host is refused — the visible host would be a lie');
select ok(not account_invite_link_ok('https://office.thc.example/auth/invite?token=' || :'token1' || '#https://evil.example'),
  'a fragment is refused');
select ok(not account_invite_link_ok('https://office.thc.example/auth/invite?token=' || :'token1' || ' click here'),
  'trailing text is refused');
select ok(not account_invite_link_ok('javascript:alert(1)//auth/invite?token=' || :'token1'),
  'a script URL is refused');
select ok(not account_invite_link_ok(null), 'null is refused, not unknown');

-- ---------------------------------------------------------------------
-- 3 · Only an admin queues it
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format('select queue_account_invite(%L, %L)', :'newadmin', :'link1'),
  '42501', 'not_authorised', 'a worker cannot queue an invitation');
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select throws_ok(format('select queue_account_invite(%L, %L)', :'newclient', :'link1'),
  '42501', 'not_authorised', 'nor can a client, even for a login of their own company');
reset role;
select set_config('request.jwt.claims', '{}', true);
set local role anon;
select throws_ok(format('select queue_account_invite(%L, %L)', :'newadmin', :'link1'),
  '42501', null, 'anon is refused by the grant');
reset role;
select is((select count(*)::int from notification_outbox where template = 'E11'), 0,
  'none of those queued anything');

-- ---------------------------------------------------------------------
-- 4 · Refusals, as an admin
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format('select queue_account_invite(%L, %L)', :'newadmin', 'https://evil.example/phish'),
  '22023', 'invite_link_invalid', 'a link that is not a set-up link is refused');
select throws_ok(format('select queue_account_invite(%L, %L)', :'staffa_uid', :'link1'),
  'P0001', 'role_not_allowed', 'a worker''s login is refused — their link is E3, from Accept');
select throws_ok(format('select queue_account_invite(%L, %L)', :'offadmin', :'link1'),
  'P0001', 'login_disabled', 'a switched-off login is refused');
select throws_ok(format('select queue_account_invite(%L, %L)', :'usedadmin', :'link1'),
  'P0001', 'already_signed_in', 'a login that has been signed in to gets no link (ADR-0055 3a)');
select throws_ok(format('select queue_account_invite(%L, %L)', :'noprofile', :'link1'),
  'P0001', 'unknown_account', 'a login with no profile is refused');
select throws_ok(format('select queue_account_invite(%L, %L)', :'new_id', :'link1'),
  'P0001', 'unknown_account', 'an unknown login is refused');

-- ---------------------------------------------------------------------
-- 5 · Queued: to the login's own address, from the register's copy
-- ---------------------------------------------------------------------
select is(queue_account_invite(:'newadmin', :'link1') - 'superseded',
  jsonb_build_object('queued', true, 'outboxKey', 'E11:invite:' || :'newadmin' || ':1', 'n', 1,
                     'email', 'New.Admin@rls.test'),
  'an admin queues the invitation; the key is E11:invite:<user>:1');
select is(queue_account_invite(:'newadmin', :'link1') ->> 'queued', 'false',
  'the same link again — a double-click — queues nothing');
reset role;

select is((select count(*)::int from notification_outbox where template = 'E11' and payload ->> 'link' = :'link1'), 1,
  'one row for one link');
select is((select recipient_emails from notification_outbox where key = 'E11:invite:' || :'newadmin' || ':1'),
  array['new.admin@rls.test'], 'addressed to the login''s own email, read from auth.users');
select is((select channel::text || ' · ' || coalesce(recipient_staff_id::text, '-') from notification_outbox
            where key = 'E11:invite:' || :'newadmin' || ':1'),
  'email · -', 'an email, to nobody on the staff table');
-- The same keys the register asks for (packages/notifications invite.test.ts).
select is((select array_agg(k order by k) from notification_outbox o, jsonb_object_keys(o.payload) k
            where o.key = 'E11:invite:' || :'newadmin' || ':1'),
  array['app', 'link', 'name'], 'the payload is the values map E11 renders: app, link, name');
select is((select payload - 'link' from notification_outbox where key = 'E11:invite:' || :'newadmin' || ':1'),
  '{"app": "Back Office", "name": "Nadia"}'::jsonb, 'naming the app and the person''s first name');
select ok((select queued_at is not null and queued_at <= now() from notification_outbox
            where key = 'E11:invite:' || :'newadmin' || ':1'),
  'queued_at is stamped on insert');

-- ---------------------------------------------------------------------
-- 6 · A new link is a new row, and withdraws the older unsent one
-- ---------------------------------------------------------------------
set local role authenticated;
select is(queue_account_invite(:'newadmin', :'link2') - 'email',
  jsonb_build_object('queued', true, 'outboxKey', 'E11:invite:' || :'newadmin' || ':2', 'n', 2, 'superseded', 1),
  'a re-sent invite with a new link is a new row, n + 1, and supersedes one');
select is(queue_account_invite(:'newclient', 'http://127.0.0.1:3002/auth/invite?token=' || :'token1') ->> 'outboxKey',
  'E11:invite:' || :'newclient' || ':1', 'a Client Portal login is queued too, keyed to its own user');
reset role;
select ok((select failed_at is not null and sent_at is null and error like 'superseded:%'
             from notification_outbox where key = 'E11:invite:' || :'newadmin' || ':1'),
  'the first email, whose token no longer works, is failed as superseded');
select ok((select failed_at is null and sent_at is null
             from notification_outbox where key = 'E11:invite:' || :'newadmin' || ':2'),
  'the second is waiting for the drain');
select is((select payload ->> 'app' from notification_outbox where key = 'E11:invite:' || :'newclient' || ':1'),
  'Client Portal', 'and names the Client Portal');
select throws_ok(
  format($$insert into notification_outbox (key, channel, template, recipient_emails)
           values (%L, 'email', 'E11', array['x@rls.test'])$$, 'E11:invite:' || :'newadmin' || ':2'),
  '23505', null, 'the key is unique: a second row with it cannot exist');

-- ---------------------------------------------------------------------
-- 7 · Audited, without the link; the outbox stays admin-read
-- ---------------------------------------------------------------------
select is((select count(*)::int from audit_log
            where action = 'account.invite_emailed' and entity_id = :'newadmin' and actor = :'admin_uid'), 2,
  'each queued email is audited with the manager as actor; the repeat is not');
select ok(not exists (select 1 from audit_log
                       where action = 'account.invite_emailed'
                         and (data::text like '%' || :'token1' || '%' or data::text like '%' || :'token2' || '%')),
  'no audit row carries the link');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from notification_outbox where template = 'E11'), 0,
  'a client cannot read the invitations (or any outbox row)');
reset role;

select * from finish();
rollback;
