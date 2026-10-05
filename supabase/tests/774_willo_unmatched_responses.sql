-- =====================================================================
-- 774 · Unmatched Willo responses
--   20261005110000_willo_unmatched_responses.sql, ADR-0087
--   (§2.4, §2.12; the receiver, ADR-0021 and ADR-0066)
--
--   A. Who can reach what: service role / admin (owner, manager,
--      scheduler, viewer) / client / worker / anon, for every new object.
--   B. willo_record_refusal keeps what the delivery said about a stranger
--      (and only a stranger); the old three-argument call still works.
--   C. willo_unmatched_responses: one row per Willo key, events in order,
--      first/last seen, name/email, the review link, resolved or not.
--   D. willo_unmatched_link: refusals, then the replay (New Response,
--      Accept pending, Reject), idempotent, audited, personal data scrubbed.
--   E. willo_unmatched_dismiss: reason required, idempotent, audited, and a
--      newer Willo event opens it again; a linked response cannot be dismissed.
-- =====================================================================
begin;
select plan(86);
\ir _shared/fixtures.psql

\set manager   '77300000-0000-4000-8000-000000000001'
\set scheduler '77300000-0000-4000-8000-000000000002'
\set viewer    '77300000-0000-4000-8000-000000000003'
\set c_req1    '77310000-0000-4000-8000-000000000001'
\set c_req2    '77310000-0000-4000-8000-000000000002'
\set c_req3    '77310000-0000-4000-8000-000000000003'
\set c_req4    '77310000-0000-4000-8000-000000000004'
\set c_comp    '77310000-0000-4000-8000-000000000005'
\set c_have    '77310000-0000-4000-8000-000000000006'
\set c_docs    '77310000-0000-4000-8000-000000000007'
\set c_gone    '77310000-0000-4000-8000-000000000008'
\set c_hold    '77310000-0000-4000-8000-000000000009'
\set c_other   '77310000-0000-4000-8000-00000000000a'

\set k_new     'aaaa0000000000000000000000000001'
\set k_acc     'aaaa0000000000000000000000000002'
\set k_acc1    'aaaa0000000000000000000000000003'
\set k_rej     'aaaa0000000000000000000000000004'
\set k_dis     'aaaa0000000000000000000000000005'
\set k_held    'aaaa0000000000000000000000000006'
\set k_none    'aaaa0000000000000000000000000007'

insert into auth.users (id, email) values
  (:'manager',   'manager@w773.test'),
  (:'scheduler', 'scheduler@w773.test'),
  (:'viewer',    'viewer@w773.test');
insert into profiles (id, role, office_role, full_name) values
  (:'manager',   'admin', 'manager',   'Mo Manager'),
  (:'scheduler', 'admin', 'scheduler', 'Sid Scheduler'),
  (:'viewer',    'admin', 'viewer',    'Vi Viewer');

insert into staff (id, first_name, last_name, email, phone, dob, status, willo_candidate_id, removed_at) values
  (:'c_req1',  'Oluwafunmi', 'Shosanya', 'funmi@w773.test', '+447700773001', date '2000-01-01', 'interview_requested', null,      null),
  (:'c_req2',  'Ben',        'Req',      'ben@w773.test',   '+447700773002', date '2000-02-02', 'interview_requested', null,      null),
  (:'c_req3',  'Cal',        'Rej',      'cal@w773.test',   '+447700773003', date '2000-03-03', 'interview_requested', null,      null),
  (:'c_req4',  'Dan',        'Dis',      'dan@w773.test',   '+447700773004', date '2000-04-04', 'interview_requested', null,      null),
  (:'c_comp',  'Eve',        'Comp',     'eve@w773.test',   '+447700773005', date '2000-05-05', 'interview_completed', null,      null),
  (:'c_have',  'Fay',        'Have',     'fay@w773.test',   '+447700773006', date '2000-06-06', 'interview_requested', 'W-have',  null),
  (:'c_docs',  'Gus',        'Docs',     'gus@w773.test',   '+447700773007', date '2000-07-07', 'documents',           null,      null),
  (:'c_gone',  'Hal',        'Gone',     'hal@w773.test',   '+447700773008', date '2000-08-08', 'interview_requested', null,      now()),
  (:'c_hold',  'Ivy',        'Hold',     'ivy@w773.test',   '+447700773009', date '2000-09-09', 'interview_requested', null,      null),
  (:'c_other', 'Jon',        'Other',    'jon@w773.test',   '+447700773010', date '2000-10-10', 'interview_requested', null,      null);

insert into settings (key, value) values ('willo_review_url_template', '"https://willo.test/review/{id}"')
  on conflict (key) do update set value = excluded.value;
insert into settings (key, value) values
  ('willo_stage_map', '{"new_response":"interview_completed","accepted":"documents","rejected":"rejected"}')
  on conflict (key) do update set value = excluded.value;

-- =====================================================================
-- A · who can reach what
-- =====================================================================
select ok(
  not has_function_privilege('anon', 'public.willo_unmatched_responses(boolean)', 'execute')
  and not has_function_privilege('public', 'public.willo_unmatched_responses(boolean)', 'execute')
  and not has_function_privilege('anon', 'public.willo_unmatched_link(text,uuid)', 'execute')
  and not has_function_privilege('public', 'public.willo_unmatched_link(text,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.willo_unmatched_dismiss(text,text)', 'execute')
  and not has_function_privilege('public', 'public.willo_unmatched_dismiss(text,text)', 'execute'),
  'anon and PUBLIC cannot execute any of the three office functions');
select ok(
  has_function_privilege('authenticated', 'public.willo_unmatched_responses(boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.willo_unmatched_link(text,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.willo_unmatched_dismiss(text,text)', 'execute'),
  'signed-in sessions may call them — each refuses a non-office caller itself');
select ok(
  not has_function_privilege('authenticated', 'public.willo_unmatched_rows()', 'execute')
  and not has_function_privilege('anon', 'public.willo_unmatched_rows()', 'execute')
  and not has_function_privilege('authenticated', 'public.willo_unmatched_events(text)', 'execute')
  and not has_function_privilege('anon', 'public.willo_unmatched_events(text)', 'execute'),
  'the two internal readers are callable by nobody who signs in');
select ok(
  not has_function_privilege('authenticated', 'public.willo_record_refusal(text,text,text,text,text,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.willo_record_refusal(text,text,text,text,text,timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.willo_record_refusal(text,text,text,text,text,timestamptz)', 'execute'),
  'willo_record_refusal stays the Edge Function''s alone');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'willo_record_refusal'),
  1, 'and there is one of it: the three-argument form was replaced, not overloaded');
select is_empty(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('willo_unmatched_responses', 'willo_unmatched_link', 'willo_unmatched_dismiss',
                          'willo_unmatched_rows', 'willo_unmatched_events', 'willo_record_refusal')
        and not (p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=%') $$,
  'every new function is security definer with a pinned search_path');

-- =====================================================================
-- B · what the receiver records
-- =====================================================================
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';

-- the old three-argument call, exactly as 482 and the previous receiver made it
select lives_ok($$ select willo_record_refusal('W-have', 'accepted', 'account_email_mismatch') $$,
  'the three-argument call still works');
select is((select entity_id::text from audit_log where action = 'willo_event_refused' and data ->> 'willoCandidateId' = 'W-have'),
  :'c_have', 'against the candidate who owns the key, as before');

-- a stranger: name, email and Willo's own time are kept
select lives_ok(
  format($$ select willo_record_refusal(%L, 'received', 'unknown_willo_candidate', %L, %L, %L::timestamptz) $$,
         :'k_new', 'Oluwafunmi Shosanya', 'Funmi@W773.test', '2026-10-04T21:50:00+00:00'),
  'an unknown participant is recorded with name, email and when Willo says it happened');
select is(
  (select data ->> 'name' || ' / ' || (data ->> 'email') from audit_log
    where action = 'willo_event_refused' and data ->> 'willoCandidateId' = :'k_new' and data ->> 'event' = 'received'),
  'Oluwafunmi Shosanya / funmi@w773.test', 'the name is kept and the email lower-cased');
select is(
  (select data ->> 'occurredAt' is not null from audit_log
    where action = 'willo_event_refused' and data ->> 'willoCandidateId' = :'k_new' and data ->> 'event' = 'received'),
  true, 'with the time Willo gave');

-- tidied: control characters, a non-address, an over-long name
select lives_ok(
  format($$ select willo_record_refusal(%L, 'x', 'unknown_willo_candidate', %L, 'not an address', null) $$,
         :'k_none', E'Zed\n' || repeat('x', 300)),
  'a messy name and a non-address are tolerated');
select is(
  (select length(data ->> 'name') || '/' || coalesce(data ->> 'email', 'none') from audit_log
    where action = 'willo_event_refused' and data ->> 'willoCandidateId' = :'k_none'),
  '120/none', 'the name is cut to 120 characters and the non-address is dropped');

-- a candidate the portal knows already has a name and email: not copied
select lives_ok($$ select willo_record_refusal('W-have', 'accepted', 'unknown_willo_candidate', 'Fay Have', 'fay@w773.test', null) $$,
  'a known candidate''s refusal is recorded');
select is_empty(
  $$ select 1 from audit_log where action = 'willo_event_refused' and entity_id = '77310000-0000-4000-8000-000000000006' and (data ? 'name' or data ? 'email') $$,
  'but the name and email are not copied into the audit row');

-- the roles that must not write refusals
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select willo_record_refusal(%L, 'x', 'unknown_willo_candidate') $$, :'k_new'),
  '42501', null, 'the office cannot write a refusal');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select willo_record_refusal(%L, 'x', 'unknown_willo_candidate') $$, :'k_new'),
  '42501', null, 'a client cannot write a refusal');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select willo_record_refusal(%L, 'x', 'unknown_willo_candidate') $$, :'k_new'),
  '42501', null, 'a worker cannot write a refusal');
reset role;

-- fixtures for the rest: the 4 Oct story, plus a spread of keys. Rows are
-- inserted with explicit times so the order is the test's, not the clock's.
insert into audit_log (at, actor, action, entity, entity_id, data) values
  ('2026-10-04 21:50:00+00', null, 'willo_event_refused', 'staff', null,
   jsonb_build_object('willoCandidateId', :'k_new', 'event', 'new_response', 'code', 'unknown_willo_candidate',
                      'occurredAt', '2026-10-04T21:58:00+00:00', 'name', 'Oluwafunmi Shosanya', 'email', 'funmi@w773.test')),
  -- accepted + new_response for k_acc (the reviewer accepted in Willo)
  ('2026-10-02 09:00:00+00', null, 'willo_event_refused', 'staff', null,
   jsonb_build_object('willoCandidateId', :'k_acc', 'event', 'new_response', 'code', 'unknown_willo_candidate')),
  ('2026-10-02 09:30:00+00', null, 'willo_event_refused', 'staff', null,
   jsonb_build_object('willoCandidateId', :'k_acc', 'event', 'accepted', 'code', 'unknown_willo_candidate')),
  -- accepted only
  ('2026-10-03 10:00:00+00', null, 'willo_event_refused', 'staff', null,
   jsonb_build_object('willoCandidateId', :'k_acc1', 'event', 'accepted', 'code', 'unknown_willo_candidate')),
  -- rejected only
  ('2026-10-03 11:00:00+00', null, 'willo_event_refused', 'staff', null,
   jsonb_build_object('willoCandidateId', :'k_rej', 'event', 'rejected', 'code', 'unknown_willo_candidate')),
  -- one to dismiss (with a name to scrub)
  ('2026-10-03 12:00:00+00', null, 'willo_event_refused', 'staff', null,
   jsonb_build_object('willoCandidateId', :'k_dis', 'event', 'new_response', 'code', 'unknown_willo_candidate',
                      'name', 'Test Person', 'email', 'test@w773.test')),
  -- one a staff row will hold
  ('2026-10-03 13:00:00+00', null, 'willo_event_refused', 'staff', null,
   jsonb_build_object('willoCandidateId', :'k_held', 'event', 'new_response', 'code', 'unknown_willo_candidate')),
  -- not an unmatched response: another refusal code, and a failure
  ('2026-10-03 14:00:00+00', null, 'willo_event_refused', 'staff', null,
   jsonb_build_object('willoCandidateId', 'W-other', 'event', 'accepted', 'code', 'account_email_mismatch')),
  ('2026-10-03 14:10:00+00', null, 'willo_event_failed', 'staff', null,
   jsonb_build_object('willoCandidateId', 'W-other2', 'event', 'accepted', 'code', 'plan_failed'));
-- a second delivery for k_new, later: last_seen moves, two events counted
insert into audit_log (at, actor, action, entity, entity_id, data) values
  ('2026-10-04 21:59:10+00', null, 'willo_event_refused', 'staff', null,
   jsonb_build_object('willoCandidateId', :'k_new', 'event', 'received', 'code', 'unknown_willo_candidate'));
update staff set willo_candidate_id = :'k_held' where id = :'c_hold';

-- =====================================================================
-- C · the read
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select * from willo_unmatched_responses() $$, '42501', 'not_authorised',
  'a client reads nothing');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select * from willo_unmatched_responses() $$, '42501', 'not_authorised',
  'a worker reads nothing');
select throws_ok($$ select * from willo_unmatched_rows() $$, '42501', null,
  'a worker cannot reach the internal reader either');
reset role;
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok($$ select * from willo_unmatched_responses() $$, '42501', null, 'anon reads nothing');
reset role;

-- every office role may read (it is the board's own audience)
select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
set local role authenticated;
select ok((select count(*) from willo_unmatched_responses()) > 0, 'a viewer can read the list');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select array_agg(willo_candidate_id order by willo_candidate_id) from willo_unmatched_responses()),
  array[:'k_new', :'k_acc', :'k_acc1', :'k_rej', :'k_dis', :'k_none']::text[],
  'one row per Willo key — not the other refusal codes, not a failure, not a key a staff row holds');

select is((select event_count from willo_unmatched_responses() where willo_candidate_id = :'k_new'), 3,
  'the deliveries for a key are counted (the function-written one, the 4 Oct response, the later one)');
select is((select events from willo_unmatched_responses() where willo_candidate_id = :'k_new'),
  array['received', 'new_response'],
  'the distinct events, oldest first by the time Willo gave');
select is((select first_seen::text from willo_unmatched_responses() where willo_candidate_id = :'k_acc'),
  '2026-10-02 09:00:00+00', 'first seen');
select is((select last_seen::text from willo_unmatched_responses() where willo_candidate_id = :'k_acc'),
  '2026-10-02 09:30:00+00', 'last seen');
select is((select name || ' / ' || email from willo_unmatched_responses() where willo_candidate_id = :'k_new'),
  'Oluwafunmi Shosanya / funmi@w773.test', 'the name and email the delivery carried');
select is((select name is null and email is null from willo_unmatched_responses() where willo_candidate_id = :'k_acc'),
  true, 'and none when it carried none');
select is((select review_url from willo_unmatched_responses() where willo_candidate_id = :'k_acc'),
  'https://willo.test/review/' || :'k_acc', 'the Willo review link from settings.willo_review_url_template');
select is((select bool_or(resolved) from willo_unmatched_responses()), false, 'nothing is resolved yet');
select is((select willo_candidate_id from willo_unmatched_responses() limit 1), :'k_new',
  'newest first');
select is((select willo_candidate_id || ' ' || resolution from willo_unmatched_responses(true) where resolved), :'k_held' || ' linked',
  'asking for resolved ones too adds only the key a candidate already holds');

-- the template unset: no link, never a half-built one
reset role;
update settings set value = 'null'::jsonb where key = 'willo_review_url_template';
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select review_url from willo_unmatched_responses() where willo_candidate_id = :'k_acc'), null,
  'no template, no link');
reset role;
update settings set value = '"https://willo.test/review/{id}"' where key = 'willo_review_url_template';

-- =====================================================================
-- D · link
-- =====================================================================
-- who may
select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select willo_unmatched_link(%L, %L) $$, :'k_new', :'c_req1'), '42501', 'not_permitted',
  'a scheduler cannot link');
select throws_ok(format($$ select willo_unmatched_dismiss(%L, 'no') $$, :'k_new'), '42501', 'not_permitted',
  'a scheduler cannot dismiss');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select willo_unmatched_link(%L, %L) $$, :'k_new', :'c_req1'), '42501', 'not_permitted',
  'a viewer cannot link');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select willo_unmatched_link(%L, %L) $$, :'k_new', :'c_req1'), '42501', 'not_authorised',
  'a client cannot link');
select throws_ok(format($$ select willo_unmatched_dismiss(%L, 'no') $$, :'k_new'), '42501', 'not_authorised',
  'a client cannot dismiss');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select willo_unmatched_link(%L, %L) $$, :'k_new', :'c_req1'), '42501', 'not_authorised',
  'a worker cannot link');
select throws_ok(format($$ select willo_unmatched_dismiss(%L, 'no') $$, :'k_new'), '42501', 'not_authorised',
  'a worker cannot dismiss');
reset role;
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok(format($$ select willo_unmatched_link(%L, %L) $$, :'k_new', :'c_req1'), '42501', null,
  'anon cannot link');
reset role;
select is((select willo_candidate_id from staff where id = :'c_req1'), null,
  'after every refusal the candidate has not been touched');

-- what is refused
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select willo_unmatched_link('  ', '77310000-0000-4000-8000-000000000001') $$, '22023',
  'willo_candidate_id_required', 'a blank key is refused');
select throws_ok(format($$ select willo_unmatched_link('aaaa0000000000000000000000000099', %L) $$, :'c_req1'),
  'P0002', 'unknown_unmatched_response', 'a key nobody refused is refused');
select throws_ok(format($$ select willo_unmatched_link(%L, '77310000-0000-4000-8000-0000000000ff') $$, :'k_new'),
  'P0002', 'unknown_staff', 'a candidate that does not exist is refused');
select throws_ok(format($$ select willo_unmatched_link(%L, %L) $$, :'k_new', :'c_gone'),
  'P0002', 'unknown_staff', 'a removed candidate is refused');
select throws_like(format($$ select willo_unmatched_link(%L, %L) $$, :'k_new', :'c_docs'),
  'not_awaiting_interview%', 'a candidate already in Documents is refused — a stale Reject must not reach them');
select throws_ok(format($$ select willo_unmatched_link(%L, %L) $$, :'k_new', :'c_have'),
  'P0001', 'candidate_already_linked', 'a candidate already linked to a Willo interview is refused');
select throws_ok(format($$ select willo_unmatched_link(%L, %L) $$, :'k_held', :'c_other'),
  'P0001', 'key_linked_elsewhere', 'a key another candidate holds is refused');
select is(willo_unmatched_link(:'k_held', :'c_hold') ->> 'outcome', 'already_linked',
  'and linking it to the one that holds it is a repeat, not a replay');
reset role;
select is((select status::text from staff where id = :'c_other'), 'interview_requested',
  'none of those refusals moved anyone');

-- the 4 Oct story: New Response → Interview completed, at Willo's time
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(willo_unmatched_link(:'k_new', :'c_req1') ->> 'outcome', 'linked', 'a manager links the response to the candidate');
reset role;
select is((select status::text || ' ' || willo_candidate_id from staff where id = :'c_req1'),
  'interview_completed ' || :'k_new', 'the candidate holds the Willo key and moved to Interview completed');
select is((select willo_completed_at::text from staff where id = :'c_req1'), '2026-10-04 21:58:00+00',
  'stamped with the time Willo gave, not the time of the click');
select isnt((select willo_invited_at from staff where id = :'c_req1'), null, 'and the invitation is on record');
select results_eq(
  format($$ select actor::text, data ->> 'byName', data ->> 'staffId' from audit_log
             where action = 'willo_unmatched_linked' and data ->> 'willoCandidateId' = %L $$, :'k_new'),
  format($$ values (%L, 'Mo Manager', %L) $$, :'manager', :'c_req1'),
  'one audit row: who linked it and to whom');
select is_empty(
  format($$ select 1 from audit_log where action = 'willo_event_refused'
             and data ->> 'willoCandidateId' = %L and (data ? 'name' or data ? 'email') $$, :'k_new'),
  'the stranger''s name and email are gone from the refusal rows — they are on the staff row now');
select is((select resolution from willo_unmatched_rows() where willo_candidate_id = :'k_new'), 'linked',
  'the response reads as resolved (linked)');
select is((select staff_id::text from willo_unmatched_rows() where willo_candidate_id = :'k_new'), :'c_req1',
  'naming the candidate');

select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from willo_unmatched_responses() where willo_candidate_id = :'k_new'), 0,
  'and it leaves the list');
select is((select resolution from willo_unmatched_responses(true) where willo_candidate_id = :'k_new'), 'linked',
  'but is there when resolved ones are asked for');
-- idempotent: nothing replayed twice, nothing audited twice
select is(willo_unmatched_link(:'k_new', :'c_req1') ->> 'outcome', 'already_linked', 'linking again is a repeat');
select throws_ok(format($$ select willo_unmatched_link(%L, %L) $$, :'k_new', :'c_req2'),
  'P0001', 'key_linked_elsewhere', 'and linking it to somebody else is refused');
select throws_ok(format($$ select willo_unmatched_dismiss(%L, 'changed my mind') $$, :'k_new'),
  'P0001', 'already_resolved', 'a linked response cannot be dismissed');
reset role;
select is((select count(*)::int from audit_log where action = 'willo_unmatched_linked' and data ->> 'willoCandidateId' = :'k_new'), 1,
  'the repeats wrote no second audit row');

-- Accept: the card walks to Interview completed; E3 stays the office's
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(willo_unmatched_link(:'k_acc', :'c_comp') ->> 'acceptPending', 'true',
  'Willo accepted them: the office is told the Accept is still to press');
select is(willo_unmatched_link(:'k_acc1', :'c_req2') ->> 'status', 'interview_completed',
  'an Accept with no New Response walks an interview_requested candidate to Interview completed');
reset role;
select is((select status::text from staff where id = :'c_comp'), 'interview_completed',
  'an owner links; the candidate waits for the office''s Accept (no shortcut to Documents)');
select is((select willo_completed_at::text from staff where id = :'c_req2'), '2026-10-03 10:00:00+00',
  'stamped with the Accept''s time');
select is((select count(*)::int from notification_outbox where template = 'E3' and recipient_emails && array['eve@w773.test', 'ben@w773.test']), 0,
  'and no E3 was queued — it needs the candidate''s login and a personal link, which the Accept mints');
select is((select willo_decision from staff where id = :'c_req2'), null, 'the decision is not recorded either: the office decides');

-- Reject: rejected, E2b because no interview was done
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(willo_unmatched_link(:'k_rej', :'c_req3') ->> 'status', 'rejected', 'a Reject Willo sent is replayed: the candidate is rejected');
reset role;
select is((select willo_decision || ' ' || willo_decided_via from staff where id = :'c_req3'), 'rejected willo',
  'recorded as decided in Willo');
select is((select count(*)::int from notification_outbox where recipient_emails = array['cal@w773.test'] and template in ('E2', 'E2b')), 1,
  'with the rejection email, once');

-- =====================================================================
-- E · dismiss
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select willo_unmatched_dismiss(%L, '   ') $$, :'k_dis'), '22023', 'reason_required',
  'a reason is mandatory');
select throws_ok($$ select willo_unmatched_dismiss('aaaa0000000000000000000000000099', 'x') $$, 'P0002',
  'unknown_unmatched_response', 'an unknown key is refused');
select is(willo_unmatched_dismiss(:'k_dis', '  A test from the Willo reviewer  ') ->> 'outcome', 'dismissed',
  'a manager dismisses a response');
select is(willo_unmatched_dismiss(:'k_dis', 'again') ->> 'outcome', 'already_dismissed', 'dismissing again is a repeat');
select is((select count(*)::int from willo_unmatched_responses() where willo_candidate_id = :'k_dis'), 0,
  'it leaves the list');
select is((select resolution || ' / ' || resolution_reason || ' / ' || resolved_by_name
             from willo_unmatched_responses(true) where willo_candidate_id = :'k_dis'),
  'dismissed / A test from the Willo reviewer / Mo Manager', 'and keeps who, what and why');
reset role;
select is((select count(*)::int from audit_log where action = 'willo_unmatched_dismissed' and data ->> 'willoCandidateId' = :'k_dis'), 1,
  'one audit row, however many times it was pressed');
select is_empty(
  format($$ select 1 from audit_log where action = 'willo_event_refused'
             and data ->> 'willoCandidateId' = %L and (data ? 'name' or data ? 'email') $$, :'k_dis'),
  'the stranger''s name and email are scrubbed on dismissal too');

-- a Willo event after the dismissal opens it again; it can then be linked
insert into audit_log (at, actor, action, entity, entity_id, data)
values (now() + interval '1 minute', null, 'willo_event_refused', 'staff', null,
        jsonb_build_object('willoCandidateId', :'k_dis', 'event', 'accepted', 'code', 'unknown_willo_candidate'));
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from willo_unmatched_responses() where willo_candidate_id = :'k_dis'), 1,
  'a newer Willo event opens a dismissed response again');
select is(willo_unmatched_link(:'k_dis', :'c_req4') ->> 'outcome', 'linked', 'and a dismissed response can still be linked');
reset role;

select * from finish();
rollback;
