-- =====================================================================
-- 806 · SpudBros Express staff skip the Willo interview (20261012150000,
--       ADR-0118)
--
--   A. Who can reach the new functions.
--   B. willo_invite_due() never leases a SpudBros candidate; THC's own
--      still are.
--   C. spudbros_skip_due() leases every SpudBros candidate awaiting the
--      interview (THC shifts on or not), once per backoff, and nobody else:
--      never an address that is an office or client login, never someone
--      refused for good this period.
--   D. spudbros_skip_interview() links the login, moves them to
--      Documents, queues E3 once, audits, in one transaction (a refused
--      login moves nothing); keeps the record of an interview already
--      done; leaves alone anyone who has moved on or is not SpudBros;
--      refuses a link that is not personal.
-- =====================================================================
begin;
select plan(30);
\ir _shared/fixtures.psql

\set c_req   '80500000-0000-4000-8000-000000000001'
\set c_done  '80500000-0000-4000-8000-000000000002'
\set c_thc   '80500000-0000-4000-8000-000000000003'
\set c_docs  '80500000-0000-4000-8000-000000000004'
\set c_gone  '80500000-0000-4000-8000-000000000005'
\set u_req   '80500000-0000-4000-8000-0000000000a1'
\set u_done  '80500000-0000-4000-8000-0000000000a2'
\set u_thc   '80500000-0000-4000-8000-0000000000a3'
\set u_boss  '80500000-0000-4000-8000-0000000000a7'
\set u_mis   '80500000-0000-4000-8000-0000000000a8'
\set u_both  '80500000-0000-4000-8000-0000000000a9'
\set c_off   '80500000-0000-4000-8000-000000000007'
\set c_mis   '80500000-0000-4000-8000-000000000008'
\set c_both  '80500000-0000-4000-8000-000000000009'
\set link1   'https://staff.test/activate/a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'
\set link2   'https://staff.test/activate/b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2'
\set install 'https://staff.test/install'

insert into auth.users (id, email, raw_app_meta_data, encrypted_password) values
  (:'u_req',  'sam@spudskip.test', '{"role":"staff"}', ''),
  (:'u_done', 'dot@spudskip.test', '{"role":"staff"}', ''),
  (:'u_thc',  'tia@spudskip.test', '{"role":"staff"}', ''),
  -- an office login, and a staff login under another address
  (:'u_boss', 'Boss@SpudSkip.test', '{"role":"admin"}', '$2a$10$hash'),
  (:'u_mis',  'someone-else@spudskip.test', '{"role":"staff"}', ''),
  (:'u_both', 'bo@spudskip.test', '{"role":"staff"}', '');

-- Sam applied and is waiting for the interview (already sent to Willo, as
-- the nine were before this); Dot is SpudBros and did the Willo interview
-- but has no decision yet; Tia is THC's own; Dee is SpudBros and already
-- at Documents; Gus is SpudBros and removed.
insert into staff (id, user_id, first_name, last_name, email, phone, dob, status,
                   willo_candidate_id, spudbros_express, removed_at) values
  (:'c_req',  null, 'Sam', 'Spud',  'sam@spudskip.test', '+447700980501', date '2001-03-01', 'interview_requested', 'W-sam', true,  null),
  (:'c_done', null, 'Dot', 'Done',  'dot@spudskip.test', '+447700980502', date '2001-03-02', 'interview_completed', null,    true,  null),
  (:'c_thc',  null, 'Tia', 'Thc',   'tia@spudskip.test', '+447700980503', date '2001-03-03', 'interview_requested', null,    false, null),
  (:'c_docs', null, 'Dee', 'Docs',  'dee@spudskip.test', '+447700980504', date '2001-03-04', 'documents',           null,    true,  null),
  (:'c_gone', null, 'Gus', 'Gone',  'gus@spudskip.test', '+447700980505', date '2001-03-05', 'interview_requested', null,    true,  now());

update staff set willo_completed_at = '2026-10-12 15:03+01' where id = :'c_done';

-- Ned: a brand-new SpudBros applicant not yet in Willo. Ollie applied on
-- the public SpudBros page with an office login's address. Mia will be
-- refused a login. Bo is SpudBros with THC shifts switched on.
\set c_new '80500000-0000-4000-8000-000000000006'
insert into staff (id, user_id, first_name, last_name, email, phone, dob, status,
                   spudbros_express, thc_shifts_enabled) values
  (:'c_new',  null, 'Ned',   'New',  'ned@spudskip.test',  '+447700980506', date '2001-03-06', 'interview_requested', true, false),
  (:'c_off',  null, 'Ollie', 'Off',  'boss@spudskip.test', '+447700980507', date '2001-03-07', 'interview_requested', true, false),
  (:'c_mis',  null, 'Mia',   'Mis',  'mia@spudskip.test',  '+447700980508', date '2001-03-08', 'interview_requested', true, false),
  (:'c_both', null, 'Bo',    'Both', 'bo@spudskip.test',   '+447700980509', date '2001-03-09', 'interview_requested', true, true);

-- =====================================================================
-- A · who can reach what
-- =====================================================================
select is_empty(
  $$ select p.proname::text || ' → ' || r.rolname
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       cross join (values ('anon'), ('authenticated')) r(rolname)
      where n.nspname = 'public'
        and p.proname in ('spudbros_skip_due', 'spudbros_skip_interview', 'spudbros_skip_failed',
                          'spudbros_skip_blocked')
        and has_function_privilege(r.rolname, p.oid, 'execute') $$,
  'no session can lease, skip or record a SpudBros skip');
select ok(has_function_privilege('service_role', 'spudbros_skip_due(integer, timestamptz)', 'execute')
      and has_function_privilege('service_role', 'spudbros_skip_interview(uuid, uuid, text, text)', 'execute')
      and has_function_privilege('service_role', 'spudbros_skip_failed(uuid, text)', 'execute'),
  'the willo-invite sweep (service role) can');

-- =====================================================================
-- B · no Willo invitation for SpudBros
-- =====================================================================
select is((select array_agg(staff_id order by staff_id) from willo_invite_due(1000)
            where staff_id::text like '80500000-%'),
  array[:'c_thc']::uuid[],
  'willo_invite_due leases THC''s own applicant and no SpudBros one, THC shifts on or not');

-- =====================================================================
-- C · who is due to skip
-- =====================================================================
select is((select array_agg(staff_id order by staff_id) from spudbros_skip_due(50)
            where staff_id::text like '80500000-%'),
  array[:'c_req', :'c_done', :'c_new', :'c_mis', :'c_both']::uuid[],
  'every live SpudBros candidate awaiting the interview, THC shifts on too — not an office login''s address');
select is((select count(*)::int from spudbros_skip_due(50) where staff_id::text like '80500000-%'),
  0, 'a lease holds them for the backoff: the next minute leases nobody twice');
select is((select count(*)::int from spudbros_skip_due(50, now() + interval '6 minutes')
            where staff_id::text like '80500000-%'),
  5, 'after the backoff they are leased again');
select is((select email from spudbros_skip_due(50, now() + interval '2 hours') where staff_id = :'c_req'),
  'sam@spudskip.test', 'the lease carries the email the login is minted for');

-- =====================================================================
-- D · the skip
-- =====================================================================
select throws_ok(
  format($$ select spudbros_skip_interview(%L, %L, 'https://evil.example/x/activate/a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', %L) $$,
         :'c_req', :'u_req', :'install'),
  '22023', 'activation_link_not_personal', 'a link that is not the personal /activate/ one is refused');
select throws_ok(
  format($$ select spudbros_skip_interview(%L, %L, %L, '') $$, :'c_req', :'u_req', :'link1'),
  '22023', 'activation_link_required', 'E3 needs its install link too');

select is(spudbros_skip_interview(:'c_req', :'u_req', :'link1', :'install') ->> 'outcome',
  'documents', 'a SpudBros candidate in Interview requested moves to Documents');
select is((select array[status::text, user_id::text, willo_decision, willo_decided_via,
                        coalesce(willo_completed_at::text, 'none')]
             from staff where id = :'c_req'),
  array['documents', :'u_req', 'accepted', 'spudbros', 'none'],
  'with their login linked, accepted via spudbros, and no interview recorded as done');
select is((select array[template, recipient_emails[1], payload ->> 'link', payload ->> 'installLink', payload ->> 'name']
             from notification_outbox where key like 'E3:staff:' || :'c_req' || ':%'),
  array['E3', 'sam@spudskip.test', :'link1', :'install', 'Sam'],
  'E3 is queued with their personal link and the install link');
select is((select count(*)::int from audit_log
            where entity_id = :'c_req' and action = 'spudbros_interview_skipped'
              and data ->> 'fromStatus' = 'interview_requested'),
  1, 'audited, with the stage they skipped from');

select is(spudbros_skip_interview(:'c_done', :'u_done', :'link1', :'install') ->> 'outcome',
  'documents', 'one already in Interview completed moves too');
select is((select willo_completed_at from staff where id = :'c_done'),
  '2026-10-12 15:03+01'::timestamptz, 'and keeps the record of the interview they did');

-- One transaction: a login the database refuses moves nothing and sends nothing.
select throws_ok(
  format($$ select spudbros_skip_interview(%L, %L, %L, %L) $$, :'c_mis', :'u_mis', :'link1', :'install'),
  'P0001', 'account_email_mismatch', 'a login under another address is refused');
select is((select array[status::text, coalesce(user_id::text, 'none')] from staff where id = :'c_mis'),
  array['interview_requested', 'none'], 'and the candidate has not moved');
select is((select count(*)::int from notification_outbox where key like 'E3:staff:' || :'c_mis' || ':%'),
  0, 'and no E3 was queued');

select is(spudbros_skip_interview(:'c_both', :'u_both', :'link1', :'install') ->> 'outcome',
  'documents', 'SpudBros with THC shifts on skip it too');
select throws_ok(
  format($$ select spudbros_skip_interview(%L, %L, %L, %L) $$, :'c_off', :'u_boss', :'link1', :'install'),
  'P0001', 'account_not_staff', 'an office login is never linked (the lease keeps the sweep from minting on it at all)');

-- A repeat (the nudge and the schedule racing) changes nothing and sends nothing twice.
select is(spudbros_skip_interview(:'c_req', :'u_req', :'link2', :'install') ->> 'outcome',
  'unchanged', 'a repeat for someone already at Documents is a no-op');
select is((select count(*)::int from notification_outbox where key like 'E3:staff:' || :'c_req' || ':%'),
  1, 'and queues no second E3');
select is((select payload ->> 'link' from notification_outbox where key like 'E3:staff:' || :'c_req' || ':%'),
  :'link2', 'but the unsent E3 now carries the token that call minted (the old one is dead)');

select is(spudbros_skip_interview(:'c_thc', :'u_thc', :'link1', :'install') ->> 'outcome',
  'unchanged', 'THC''s own applicant is never moved by it');
select is((select array[status::text, coalesce(user_id::text, 'none')] from staff where id = :'c_thc'),
  array['interview_requested', 'none'], 'and keeps their interview and no login');

select throws_ok(
  format($$ select spudbros_skip_interview(%L, %L, %L, %L) $$, :'c_gone', :'u_thc', :'link1', :'install'),
  'P0002', 'unknown_staff', 'a removed candidate is refused');

select is((select count(*)::int from spudbros_skip_due(50, now() + interval '7 hours')
            where staff_id in (:'c_req', :'c_done')),
  0, 'once at Documents they are never leased again');

select spudbros_skip_failed(:'c_new', 'activation_link_required');
select is((select data ->> 'error' from audit_log where entity_id = :'c_new' and action = 'spudbros_skip_failed'),
  'activation_link_required', 'a failure is recorded for the office to see');
select is((select count(*)::int from spudbros_skip_due(50, now() + interval '8 hours') where staff_id = :'c_new'),
  1, 'a failure retries can fix (STAFF_APP_URL unset) is retried');

select spudbros_skip_failed(:'c_mis', 'spudbros_skip_interview: account_email_mismatch');
select is((select count(*)::int from spudbros_skip_due(50, now() + interval '9 hours') where staff_id = :'c_mis'),
  0, 'a refusal no retry can fix is not retried: the office decides');

select * from finish();
rollback;
