-- =====================================================================
-- 897 · A Willo delivery is applied once (20261020130200, ADR-0164)
--
-- The receiver passes each delivery's key (sha256 of its raw body); a key
-- already applied changes nothing, however much later it comes back. A
-- delivery that failed leaves no key, so Willo's retry still applies.
-- willo_deliveries: admin read only; workers, clients and anon see none.
-- =====================================================================
begin;
select plan(24);
\ir _shared/fixtures.psql

\set c_req  '89700000-0000-4000-8000-000000000001'
\set c_acc  '89700000-0000-4000-8000-000000000002'
\set c_plain '89700000-0000-4000-8000-000000000003'
\set u_acc  '89700000-0000-4000-8000-0000000000a2'
\set link1  'https://staff.test/activate/c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1'
\set link2  'https://staff.test/activate/d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2'
\set k1 'sha256:8970000000000000000000000000000000000000000000000000000000000001'
\set k2 'sha256:8970000000000000000000000000000000000000000000000000000000000002'
\set k3 'sha256:8970000000000000000000000000000000000000000000000000000000000003'
\set k4 'sha256:8970000000000000000000000000000000000000000000000000000000000004'
\set k5 'sha256:8970000000000000000000000000000000000000000000000000000000000005'

insert into auth.users (id, email, raw_app_meta_data, encrypted_password) values
  (:'u_acc', 'acc897@willo.test', '{"role":"staff"}', '');

insert into staff (id, first_name, last_name, email, phone, dob, status, willo_candidate_id) values
  (:'c_req',   'Rae', 'Req',   'req897@willo.test',   '+447700989701', date '2001-01-01', 'interview_requested', 'W-897-req'),
  (:'c_acc',   'Abe', 'Acc',   'acc897@willo.test',   '+447700989702', date '2001-02-02', 'interview_completed', 'W-897-acc'),
  (:'c_plain', 'Pat', 'Plain', 'plain897@willo.test', '+447700989703', date '2001-03-03', 'interview_requested', 'W-897-plain');

-- ---------------------------------------------------------------------
-- 1 · Once, and only once
-- ---------------------------------------------------------------------
select is(willo_record_event('W-897-req', 'new_response', now(), '{}', :'k1') ->> 'outcome',
  'interview_completed', 'a delivery is applied');
select is(willo_record_event('W-897-req', 'new_response', now(), '{}', :'k1') ->> 'outcome',
  'duplicate', 'the same delivery again is a duplicate');
select is((select count(*)::int from willo_deliveries where delivery_key = :'k1'), 1, 'recorded once');
select is((select staff_id from willo_deliveries where delivery_key = :'k1'), :'c_req'::uuid,
  'against the candidate it moved');

-- The case the state machine alone did not cover: a captured "rejected"
-- replayed after the office had put the candidate back.
select is(willo_record_event('W-897-req', 'rejected', now(), '{}', :'k2') ->> 'outcome',
  'rejected', 'a Willo rejection rejects');
-- The office's way back is a flow of its own; the fixture just puts the
-- row there, past the transition trigger.
set local session_replication_role = replica;
update staff set status = 'interview_completed' where id = :'c_req';
set local session_replication_role = origin;
select is(willo_record_event('W-897-req', 'rejected', now(), '{}', :'k2') ->> 'outcome',
  'duplicate', 'replayed later, it is refused as a duplicate');
select is((select status::text from staff where id = :'c_req'), 'interview_completed',
  'and the candidate the office put back stays where they are');

-- Progress: a replay cannot rewrite the answer count.
select is(willo_record_event('W-897-req', 'progress', now(), '{"answersDone":3,"answersTotal":5}', :'k3') ->> 'outcome',
  'tracked', 'progress is tracked');
update staff set willo_answers_done = 4 where id = :'c_req';
select is(willo_record_event('W-897-req', 'progress', now(), '{"answersDone":3,"answersTotal":5}', :'k3') ->> 'outcome',
  'duplicate', 'and a replayed progress delivery is a duplicate');
select is((select willo_answers_done from staff where id = :'c_req'), 4, 'the newer count stands');

-- ---------------------------------------------------------------------
-- 2 · A delivery that failed leaves no key behind
-- ---------------------------------------------------------------------
update settings set value = value || '{"bogus_897":"nowhere"}' where key = 'willo_stage_map';
select throws_ok(format($$ select willo_record_event('W-897-req', 'bogus_897', now(), '{}', %L) $$, :'k4'),
  '22023', null, 'a refused delivery raises');
select is(willo_delivery_seen(:'k4'), false, 'and its key is rolled back with it, so Willo''s retry can still apply');
select throws_ok(format($$ select willo_record_event('W-897-nobody', 'new_response', now(), '{}', %L) $$, :'k5'),
  'P0002', 'unknown_willo_candidate', 'an unknown candidate is refused');
select is(willo_delivery_seen(:'k5'), false, 'leaving no key either');

-- Without a key (the office's own paths) nothing changes.
select is(willo_record_event('W-897-plain', 'new_response') ->> 'outcome', 'interview_completed',
  'a call without a key applies as before');
select is(willo_record_event('W-897-plain', 'new_response') ->> 'outcome', 'unchanged',
  'and repeats as before: the state machine''s own no-op');

-- ---------------------------------------------------------------------
-- 3 · Accept with a login: the receiver asks first, and so does the DB
-- ---------------------------------------------------------------------
select is(willo_delivery_seen(:'k1'), true, 'willo_delivery_seen() knows an applied delivery');
select is(
  willo_accept_with_account('W-897-acc', 'accepted', now(),
    jsonb_build_object('activationLink', :'link1', 'installLink', 'https://staff.test/install'), :'u_acc', :'k5') ->> 'outcome',
  'documents', 'a Willo Accept with its key moves the candidate to Documents');
select is(
  willo_accept_with_account('W-897-acc', 'accepted', now(),
    jsonb_build_object('activationLink', :'link2', 'installLink', 'https://staff.test/install'), :'u_acc', :'k5') ->> 'outcome',
  'duplicate', 'the same delivery again is a duplicate');
select is((select array_agg(payload ->> 'link') from notification_outbox where template = 'E3' and recipient_emails = array['acc897@willo.test']),
  array[:'link2'], 'and the one E3 points at the token that call minted, so no live link is left dead');

-- ---------------------------------------------------------------------
-- 4 · Who can read and call it
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select is((select count(*)::int from willo_deliveries), 0, 'a worker reads no deliveries');
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select is((select count(*)::int from willo_deliveries), 0, 'nor does a client');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated', 'aal', 'aal2')::text, true);
select ok((select count(*)::int from willo_deliveries) >= 4, 'the office can read them');
reset role;

select is_empty(
  $$ select f || ' → ' || r from unnest(array[
       'public.willo_record_event(text, text, timestamptz, jsonb, text)',
       'public.willo_accept_with_account(text, text, timestamptz, jsonb, uuid, text)',
       'public.willo_delivery_seen(text)']) f
     cross join unnest(array['anon', 'authenticated']) r
     where has_function_privilege(r, f, 'execute')
     union all
     select 'willo_deliveries select → anon' where has_table_privilege('anon', 'public.willo_deliveries', 'select')
     union all
     select 'willo_deliveries write → authenticated'
      where has_table_privilege('authenticated', 'public.willo_deliveries', 'insert')
         or has_table_privilege('authenticated', 'public.willo_deliveries', 'update')
         or has_table_privilege('authenticated', 'public.willo_deliveries', 'delete') $$,
  'only the service role can apply a delivery or ask about one, and nobody signed in can write the table');

select * from finish();
rollback;
