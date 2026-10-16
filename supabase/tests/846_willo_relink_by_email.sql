-- =====================================================================
-- 846 · A Willo participant we did not create, found by email
--       20261016100000 · ADR-0147 · §2.4
--
-- willo_relink_by_email() moves a candidate's Willo link to a key we never
-- issued only when exactly one candidate still awaiting the interview
-- decision has the delivery's email; the event then lands on the new key.
-- =====================================================================
begin;
select plan(17);
\ir _shared/fixtures.psql

\set c_jo    '84600000-0000-4000-8000-000000000001'
\set c_twin1 '84600000-0000-4000-8000-000000000002'
\set c_twin2 '84600000-0000-4000-8000-000000000003'
\set c_docs  '84600000-0000-4000-8000-000000000004'
\set c_gone  '84600000-0000-4000-8000-000000000005'
\set c_past  '84600000-0000-4000-8000-000000000006'
\set c_wait  '84600000-0000-4000-8000-000000000007'
\set old_key '7880000000000000000000000000000a'
\set new_key 'ef700000000000000000000000000baf'
\set held    'abc00000000000000000000000000def'

insert into staff (id, first_name, last_name, email, phone, dob, status, willo_candidate_id, removed_at) values
  (:'c_jo',    'Jo',  'Self',  'Jo.Self@Willo.test', '+447700946001', date '1990-01-01', 'interview_requested', :'old_key', null),
  (:'c_twin1', 'Tia', 'One',   'twin@willo.test',    '+447700946002', date '1990-02-02', 'interview_requested', null,       null),
  (:'c_twin2', 'Tia', 'Two',   'twin@willo.test',    '+447700946003', date '1990-03-03', 'interview_completed', null,       null),
  (:'c_docs',  'Dan', 'Docs',  'dan@willo.test',     '+447700946004', date '1990-04-04', 'interview_requested', :'held',    null),
  (:'c_gone',  'Gil', 'Gone',  'gil@willo.test',     '+447700946005', date '1990-05-05', 'interview_requested', null,       now()),
  (:'c_past',  'Pat', 'Past',  'pat@willo.test',     '+447700946006', date '1990-06-06', 'documents',           null,       null),
  (:'c_wait',  'Pat', 'Wait',  'pat@willo.test',     '+447700946007', date '1990-07-07', 'interview_completed', null,       null);

-- ---------------------------------------------------------------------
-- Who can call it
-- ---------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.willo_relink_by_email(text, text)', 'execute'),
  'anon cannot call it');
select ok(not has_function_privilege('authenticated', 'public.willo_relink_by_email(text, text)', 'execute'),
  'no signed-in account can call it');
select ok(has_function_privilege('service_role', 'public.willo_relink_by_email(text, text)', 'execute'),
  'the service role — the Edge Function — can');

-- ---------------------------------------------------------------------
-- Nothing moves
-- ---------------------------------------------------------------------
select is(willo_relink_by_email(:'new_key', 'nobody@willo.test'), null::uuid,
  'no candidate with that email: null');
select is(willo_relink_by_email(:'new_key', 'twin@willo.test'), null::uuid,
  'two candidates with that email: null, never a guess');
select is(willo_relink_by_email(:'new_key', 'gil@willo.test'), null::uuid,
  'a removed candidate is not relinked');
select is(willo_relink_by_email(:'held', 'jo.self@willo.test'), null::uuid,
  'a key another candidate holds is not taken from them');
select is(willo_relink_by_email('not-a-willo-key', 'jo.self@willo.test'), null::uuid,
  'only a Willo-shaped key');
select is(willo_relink_by_email(:'new_key', 'not an email'), null::uuid,
  'only an email-shaped email');
select is((select willo_candidate_id from staff where id = :'c_jo'), :'old_key',
  'and the candidate''s link is untouched');

-- ---------------------------------------------------------------------
-- The second participant is ours
-- ---------------------------------------------------------------------
select is(willo_relink_by_email(upper(:'new_key'), '  JO.SELF@willo.test '), :'c_jo'::uuid,
  'one candidate awaiting the decision with that email, in any case: relinked');
select is((select willo_candidate_id from staff where id = :'c_jo'), :'new_key',
  'the link now names the key Willo reports');
select is((select data from audit_log where action = 'willo_relinked' and entity_id = :'c_jo'),
  jsonb_build_object('from', :'old_key', 'to', :'new_key', 'matchedOn', 'email'),
  'audited, with both keys');
select is(willo_relink_by_email(:'new_key', 'jo.self@willo.test'), null::uuid,
  'a repeat finds the key held and moves nothing');

select is((willo_record_event(:'new_key', 'new_response', now(), '{}'::jsonb)) ->> 'outcome',
  'interview_completed', 'the next delivery on the new key moves the card');

select is(willo_relink_by_email('f0000000000000000000000000000001', 'pat@willo.test'), :'c_wait'::uuid,
  'a candidate already past the decision does not count against the one still waiting');
select is((select willo_candidate_id from staff where id = :'c_past'), null,
  'and is left alone');

select * from finish();
rollback;
