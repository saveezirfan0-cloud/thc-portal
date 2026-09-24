-- =====================================================================
-- 522 · "Create candidate in Willo" is idempotent
--   20260926100200_willo_create_is_idempotent.sql, ADR-0021 (26.09)
--   (§2.4, §2.12 step 1, Appendix B B1; docs/14 §4)
--
--   A. Shape and grants: the three staff columns (granted by name,
--      20260923210000), service-only functions, the office's Retry, the
--      claim's `for update skip locked` and lease predicate.
--   B. Claiming is exclusive: one sweep claims, a second in the lease
--      gets nothing; a row with a recorded key comes back as a LINK and
--      never as a create; a linked, stuck or removed row never comes back.
--   C. The key is recorded first and alone, idempotently; the first key
--      wins and a second is audited; the link refuses any other key.
--   D. Outcomes: 'failed' releases the lease (backoff applies), 'unknown'
--      keeps it (the stale path), 'stuck' flags now.
--   E. A lease that expires unanswered is retried 3 times, then the row
--      is flagged for the office — never re-created blindly — and the
--      candidates view carries the flag, the attempts and the last error.
--   F. willo_invite_retry: office only, refuses what is not stuck, and
--      restarts the stale budget.
--   G. A Reset (new period) and a removal forget the attempt.
--
--   Time is simulated through p_now. Each step is ONE call captured into
--   a temp table so several candidates are asserted from the same sweep.
-- =====================================================================
begin;
select plan(73);
\ir _shared/fixtures.psql

\set c_fresh  '52000000-0000-4000-8000-000000000001'
\set c_link   '52000000-0000-4000-8000-000000000002'
\set c_linked '52000000-0000-4000-8000-000000000003'
\set c_stale  '52000000-0000-4000-8000-000000000004'
\set c_stuck  '52000000-0000-4000-8000-000000000005'
\set c_gone   '52000000-0000-4000-8000-000000000006'
\set c_reset  '52000000-0000-4000-8000-000000000007'
\set c_leave  '52000000-0000-4000-8000-000000000008'

insert into staff (id, first_name, last_name, email, phone, dob, status, onboarding_started_at,
                   willo_candidate_id, willo_created_candidate_id, willo_create_claimed_at, willo_create_stuck_at, removed_at) values
  (:'c_fresh',  'Fay', 'Fresh',  'fay@willo.test',  '+447700952001', date '2001-01-01', 'interview_requested', now() - interval '1 hour', null,     null,     null,                    null,  null),
  (:'c_link',   'Lin', 'Link',   'lin@willo.test',  '+447700952002', date '2001-02-02', 'interview_requested', now() - interval '1 hour', null,     'W-link', null,                    null,  null),
  (:'c_linked', 'Don', 'Done',   'don@willo.test',  '+447700952003', date '2001-03-03', 'interview_requested', now() - interval '1 hour', 'W-done', 'W-done', now() - interval '1 day', null,  null),
  (:'c_stale',  'Sal', 'Stale',  'sal@willo.test',  '+447700952004', date '2001-04-04', 'interview_requested', now() - interval '1 hour', null,     null,     null,                    null,  null),
  (:'c_stuck',  'Stu', 'Stuck',  'stu@willo.test',  '+447700952005', date '2001-05-05', 'interview_requested', now() - interval '1 hour', null,     null,     null,                    now(), null),
  (:'c_gone',   'Gus', 'Gone',   'gus@willo.test',  '+447700952006', date '2001-06-06', 'interview_requested', now() - interval '1 hour', null,     null,     null,                    null,  now()),
  (:'c_reset',  'Rae', 'Reset',  'rae@willo.test',  '+447700952007', date '2001-07-07', 'rejected',            now() - interval '1 hour', null,     'W-old',  now() - interval '1 day', now(), null),
  (:'c_leave',  'Lee', 'Leaver', 'lee@willo.test',  '+447700952008', date '2001-08-08', 'interview_requested', now() - interval '1 hour', null,     'W-lee',  now(),                   null,  null);

-- =====================================================================
-- A · shape and grants
-- =====================================================================
select has_column('public', 'staff', 'willo_create_claimed_at',    'the lease is a column on the row');
select has_column('public', 'staff', 'willo_created_candidate_id', 'so is the key Willo answered with');
select has_column('public', 'staff', 'willo_create_stuck_at',      'and the flag the office sees');
select is_empty(
  $$ select a.attname from pg_attribute a
      where a.attrelid = 'public.staff'::regclass and a.attnum > 0 and not a.attisdropped
        and a.attname in ('willo_create_claimed_at', 'willo_created_candidate_id', 'willo_create_stuck_at')
        and not has_column_privilege('authenticated', 'public.staff', a.attname, 'select') $$,
  'the three columns are granted by name (20260923210000: a staff column without a grant breaks every view)');
select is_empty(
  $$ select p.proname::text || ' → ' || r.rolname
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       cross join (values ('anon'), ('authenticated')) r(rolname)
      where n.nspname = 'public'
        and p.proname in ('willo_create_recorded', 'willo_invite_due', 'willo_invite_failed',
                          'willo_link_candidate', 'staff_willo_create_reset')
        and has_function_privilege(r.rolname, p.oid, 'execute') $$,
  'neither anon nor any signed-in account can record a key, lease the queue, end an attempt or link');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('willo_create_recorded', 'willo_invite_due', 'willo_invite_failed', 'willo_link_candidate')
      and has_function_privilege('service_role', p.oid, 'execute')),
  4, 'the service role — what the Edge Function holds — can call all four');
select ok(
  has_function_privilege('authenticated', 'public.willo_invite_retry(uuid, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.willo_invite_retry(uuid, timestamptz)', 'execute'),
  'Retry is a signed-in call (it refuses a non-admin itself); anon cannot reach it');
select is_empty(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('willo_create_recorded', 'willo_invite_due', 'willo_invite_failed',
                          'willo_link_candidate', 'willo_invite_retry', 'staff_willo_create_reset')
        and not (p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=%') $$,
  'every new or restated function is security definer with a pinned search_path');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'willo_invite_failed'),
  1, 'the two-argument willo_invite_failed is gone, so a two-argument call is not ambiguous');
select ok(pg_get_functiondef('public.willo_invite_due(integer, timestamptz)'::regprocedure) ~* 'for update skip locked',
  'the sweep picks rows with `for update skip locked`: two sweeps at once never take the same row');
select ok(pg_get_functiondef('public.willo_invite_due(integer, timestamptz)'::regprocedure) ~ 'willo_create_claimed_at = p_now',
  'and sets the lease on the row inside that same pass');
select ok(pg_get_functiondef('public.willo_invite_due(integer, timestamptz)'::regprocedure) ~ 'willo_create_stuck_at is null',
  'a flagged row is out of the queue by predicate, not by luck');
select has_trigger('public', 'staff', 'staff_willo_create_reset',
  'a Reset and a removal forget the attempt through their own trigger (staff_status_guard is not restated)');

-- =====================================================================
-- B · claiming is exclusive; what is offered and as what
-- =====================================================================
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';

create temp table sweep_0 as select * from willo_invite_due(50);
select is((select kind || '/' || attempt || '/' || coalesce(willo_candidate_id, '-') from sweep_0 where staff_id = :'c_fresh'),
  'create/1/-', 'an unclaimed candidate with no key is offered as a create');
select is((select kind || '/' || attempt || '/' || coalesce(willo_candidate_id, '-') from sweep_0 where staff_id = :'c_link'),
  'link/1/W-link', 'a candidate whose key was recorded but not linked is offered as a LINK, carrying that key');
select is((select count(*)::int from sweep_0 where kind = 'create' and willo_candidate_id is not null), 0,
  'no row with a key is ever offered as a create');
select is((select count(*)::int from sweep_0 where staff_id = :'c_linked'), 0,
  'a linked candidate is never offered again, even with a stale lease still on the row');
select is((select count(*)::int from sweep_0 where staff_id = :'c_stuck'), 0,
  'a flagged candidate is not offered: the office looks first');
select is((select count(*)::int from sweep_0 where staff_id = :'c_gone'), 0,
  'a removed candidate is not offered');
select is((select willo_create_claimed_at from staff where id = :'c_fresh'), now(),
  'the claim stamps the lease on the row');
select is((select data ->> 'kind' || '/' || (data ->> 'afterTimeout') from audit_log
            where action = 'willo_invite_claim' and entity_id = :'c_fresh'),
  'create/false', 'and audits the claim: what kind, and that no lease had expired before it');

create temp table sweep_0b as select * from willo_invite_due(50);
select is((select count(*)::int from sweep_0b where staff_id in (:'c_fresh', :'c_link', :'c_stale')), 0,
  'a second sweep inside the lease gets none of them: claiming is exclusive');
reset role;

-- A row the sweep is still working on is not the office's to retry.
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok($$ select willo_invite_retry('52000000-0000-4000-8000-000000000004') $$, 'P0001', 'willo_create_not_stuck',
  'the office cannot retry a candidate the sweep has not given up on');
reset role;
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';

-- =====================================================================
-- C · the key is recorded first, alone, idempotently
-- =====================================================================
select is(willo_create_recorded(:'c_fresh', 'W-fresh'), 'W-fresh', 'Willo''s key is recorded the moment the create returns');
select is((select coalesce(willo_created_candidate_id, '-') || '/' || coalesce(willo_candidate_id, '-') || '/'
                  || (willo_create_claimed_at is not null)::text from staff where id = :'c_fresh'),
  'W-fresh/-/true', 'recorded, not yet linked, and the lease still stands: recording is not the end of the attempt');
select is(willo_create_recorded(:'c_fresh', 'W-fresh'), 'W-fresh', 'recording the same key again is a no-op');
select is((select count(*)::int from audit_log where action = 'willo_invite_duplicate' and entity_id = :'c_fresh'), 0,
  'and audits nothing');
select is(willo_create_recorded(:'c_fresh', 'W-second'), 'W-fresh',
  'a second key (a stale retry that created twice) does not replace the first');
select is((select data ->> 'duplicate' from audit_log where action = 'willo_invite_duplicate' and entity_id = :'c_fresh'),
  'W-second', 'the duplicate is audited so the office can delete it in Willo');
select throws_ok($$ select willo_create_recorded('52000000-0000-4000-8000-000000000001', '  ') $$,
  '22023', 'willo_candidate_id_required', 'an empty key is refused');
select throws_ok($$ select willo_create_recorded('52000000-0000-4000-8000-0000000000ff', 'W-x') $$,
  'P0002', 'unknown_staff', 'an unknown candidate is refused');

-- =====================================================================
-- D · outcomes
-- =====================================================================
select lives_ok($$ select willo_invite_failed('52000000-0000-4000-8000-000000000002', 'http_503: down', 'failed') $$,
  'Willo refused (or was never reached): recorded as failed');
select is((select willo_create_claimed_at from staff where id = :'c_link'), null::timestamptz,
  'a failed attempt releases the lease');

create temp table sweep_4 as select * from willo_invite_due(50, now() + interval '4 minutes');
select is((select count(*)::int from sweep_4 where staff_id in (:'c_fresh', :'c_link', :'c_stale')), 0,
  'four minutes on, nothing: the leased rows are still leased and the released one is inside its 5-minute backoff');

create temp table sweep_6 as select * from willo_invite_due(50, now() + interval '6 minutes');
select is((select kind || '/' || attempt || '/' || willo_candidate_id from sweep_6 where staff_id = :'c_fresh'),
  'link/2/W-fresh', 'after the lease, the candidate whose key was recorded is offered as a LINK with that key — the create is never repeated');
select is((select data ->> 'kind' || '/' || (data ->> 'afterTimeout') from audit_log
            where action = 'willo_invite_claim' and entity_id = :'c_fresh' and (data ->> 'attempt')::int = 2),
  'link/true', 'and the claim records that a lease expired unanswered before it');
select is((select kind || '/' || attempt || '/' || (select data ->> 'afterTimeout' from audit_log
             where action = 'willo_invite_claim' and entity_id = :'c_link' and (data ->> 'attempt')::int = 2)
           from sweep_6 where staff_id = :'c_link'),
  'link/2/false', 'the released row is retried after its backoff, and that is not counted as an expired lease');
select is((select kind || '/' || attempt from sweep_6 where staff_id = :'c_stale'),
  'create/2', 'a create whose lease expired with no answer is tried again (the first of at most three)');

select throws_ok($$ select willo_link_candidate('52000000-0000-4000-8000-000000000001', 'W-second') $$,
  '22023', 'willo_candidate_id_mismatch', 'the link refuses any key but the recorded one: a second create can never overwrite the first');
select lives_ok($$ select willo_link_candidate('52000000-0000-4000-8000-000000000001', 'W-fresh') $$,
  'the link with the recorded key completes');
select is((select willo_candidate_id || '/' || (willo_create_claimed_at is null)::text || '/' || (willo_create_stuck_at is null)::text
             from staff where id = :'c_fresh'),
  'W-fresh/true/true', 'linked, lease closed, nothing flagged');

select lives_ok($$ select willo_invite_failed('52000000-0000-4000-8000-000000000002', 'network after send: reset', 'unknown') $$,
  'an attempt whose outcome is unknown is recorded as such');
select is((select willo_create_claimed_at from staff where id = :'c_link'), now() + interval '6 minutes',
  'and KEEPS the lease: the row takes the bounded stale path instead of being tried again as if nothing happened');
select throws_ok($$ select willo_invite_failed('52000000-0000-4000-8000-000000000004', 'x', 'bogus') $$,
  '22023', 'willo_invite_outcome_invalid', 'an outcome the sweep does not know is refused');

create temp table sweep_17 as select * from willo_invite_due(50, now() + interval '17 minutes');
select is((select count(*)::int from sweep_17 where staff_id = :'c_fresh'), 0,
  'the linked candidate is never offered again');
select is((select kind || '/' || attempt || '/' || (select data ->> 'afterTimeout' from audit_log
             where action = 'willo_invite_claim' and entity_id = :'c_link' and (data ->> 'attempt')::int = 3)
           from sweep_17 where staff_id = :'c_link'),
  'link/3/true', 'the unknown-outcome row comes back after its lease (10 min, doubled) as a stale link retry');
select is((select kind || '/' || attempt from sweep_17 where staff_id = :'c_stale'),
  'create/3', 'the unanswered create: second stale retry');

select lives_ok($$ select willo_invite_failed('52000000-0000-4000-8000-000000000002',
                     'created W-link, not linked: duplicate key value violates unique constraint', 'stuck') $$,
  'a link refused for good is recorded as stuck');
select is((select (willo_create_stuck_at is not null)::text || '/' || (select data ->> 'outcome' from audit_log
             where action = 'willo_invite_failed' and entity_id = :'c_link' order by id desc limit 1)
           from staff where id = :'c_link'),
  'true/stuck', 'flagged on the row and in the audit trail');

-- =====================================================================
-- E · the stale path is bounded, then the office
-- =====================================================================
create temp table sweep_38 as select * from willo_invite_due(50, now() + interval '38 minutes');
select is((select count(*)::int from sweep_38 where staff_id = :'c_link'), 0,
  'a flagged row is not offered');
select is((select kind || '/' || attempt from sweep_38 where staff_id = :'c_stale'),
  'create/4', 'the unanswered create: third and last stale retry');

create temp table sweep_80 as select * from willo_invite_due(50, now() + interval '80 minutes');
select is((select count(*)::int from sweep_80 where staff_id = :'c_stale'), 0,
  'the fourth expired lease is not retried: the create is not repeated blindly');
select isnt((select willo_create_stuck_at from staff where id = :'c_stale'), null::timestamptz,
  'the row is flagged for the office instead');
select is((select data ->> 'outcome' || ': '
                  || (data ->> 'error' like 'no answer from create attempts in a row (lease expired 3 times); check Willo for sal@willo.test%')::text
             from audit_log
            where action = 'willo_invite_failed' and entity_id = :'c_stale' order by id desc limit 1),
  'stuck: true', 'with an audit row saying why, and whom to look for in Willo');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select willo_create_stuck_at is not null from onboarding_candidates_v where id = :'c_stale'), true,
  'the office''s candidate card carries the flag');
select is((select willo_create_attempts from onboarding_candidates_v where id = :'c_stale'), 4,
  'and how many times the sweep tried this period');
select alike((select willo_create_last_error from onboarding_candidates_v where id = :'c_stale'), 'no answer from create attempts%',
  'and the last error');
select is((select willo_created_candidate_id from onboarding_candidates_v where id = :'c_link'), 'W-link',
  'and, for a link that could not complete, the key to look for in Willo');
set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*)::int from onboarding_candidates_v where id in (:'c_stale', :'c_link')), 0,
  'a client sees none of it (staff is admin_all; the view is security_invoker)');
reset role;

-- =====================================================================
-- F · Retry
-- =====================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok($$ select willo_invite_retry('52000000-0000-4000-8000-000000000004') $$, '42501', null,
  'a client cannot press Retry');
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select throws_ok($$ select willo_invite_retry('52000000-0000-4000-8000-000000000004') $$, '42501', null,
  'nor can a worker');
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok($$ select willo_invite_retry('52000000-0000-4000-8000-000000000001') $$, 'P0001', 'not_awaiting_interview',
  'the office cannot retry a candidate already in Willo');
select is(willo_invite_retry(:'c_link', now() + interval '80 minutes') ->> 'kind', 'link',
  'Retry on a stuck link says the link will be retried');
select is(willo_invite_retry(:'c_stale', now() + interval '80 minutes') ->> 'kind', 'create',
  'Retry on a stuck create says the create will be');
select is((select (willo_create_stuck_at is null)::text || '/' || (willo_create_claimed_at is null)::text from staff where id = :'c_stale'),
  'true/true', 'the flag and the lease are cleared');
select is((select actor from audit_log where action = 'willo_invite_retry' and entity_id = :'c_stale'), :'admin_uid'::uuid,
  'audited with the manager as actor');
select throws_ok($$ select willo_invite_retry('52000000-0000-4000-8000-000000000004') $$, 'P0001', 'willo_create_not_stuck',
  'a second press has nothing to do');
reset role;

set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
create temp table sweep_81 as select * from willo_invite_due(50, now() + interval '81 minutes');
select is((select kind || '/' || attempt || '/' || (select data ->> 'afterTimeout' from audit_log
             where action = 'willo_invite_claim' and entity_id = :'c_stale' and (data ->> 'attempt')::int = 5)
           from sweep_81 where staff_id = :'c_stale'),
  'create/5/false', 'after Retry the sweep takes the row again — a fresh claim, not a stale one');
select is((select kind || '/' || attempt from sweep_81 where staff_id = :'c_link'),
  'link/4', 'and retries the stuck link, with the recorded key, not a create');
create temp table sweep_162 as select * from willo_invite_due(50, now() + interval '162 minutes');
select is((select kind || '/' || attempt || '/' || (select data ->> 'afterTimeout' from audit_log
             where action = 'willo_invite_claim' and entity_id = :'c_stale' and (data ->> 'attempt')::int = 6)
           from sweep_162 where staff_id = :'c_stale'),
  'create/6/true', 'the stale budget restarted at Retry: an expired lease is retried again rather than flagged at once');
reset role;

-- =====================================================================
-- G · a new period, or a removal, forgets the attempt
-- =====================================================================
update staff set status = 'interview_requested' where id = :'c_reset';
select is((select (willo_created_candidate_id is null)::text || '/' || (willo_create_claimed_at is null)::text || '/' || (willo_create_stuck_at is null)::text
             from staff where id = :'c_reset'),
  'true/true/true', 'a Reset (§2.12 step 1: a fresh interview is due) forgets the old key, lease and flag');
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select is((select kind || '/' || attempt from willo_invite_due(50, now() + interval '1 day') where staff_id = :'c_reset'),
  'create/1', 'and the new period starts with a create, attempt 1');
reset role;
update staff set status = 'removed', removed_at = now() where id = :'c_leave';
select is((select (willo_created_candidate_id is null)::text || '/' || (willo_create_claimed_at is null)::text
             from staff where id = :'c_leave'),
  'true/true', 'a removal (§1.7) takes the recorded key and the lease with it');

select * from finish();
rollback;
