-- =====================================================================
-- 925 · close_duplicate_candidate() (20261023140000, ADR-0191)
--
--   A. Service role only: no signed-in caller can run it.
--   B. Pair 1 (a mistyped first application, same date of birth):
--      the Payroll ID and Employee ID move to the live record, the stale
--      one is rejected without any email, its unsent mail is dropped, the
--      sent mail stays, and it is audited.
--   C. Pair 2 (same email, a different birth year): closed too, and
--      the kept record's date of birth is not touched.
--   D. Running it again changes nothing; a kept record's own IDs are never
--      replaced.
--   E. Refused: another person, a stale record that is not a candidate, one
--      with a signed contract, a kept record that is rejected.
-- =====================================================================
begin;
select plan(34);
set local search_path = public, extensions;

\set s_stale '92500000-0000-4000-8000-000000000001'
\set s_keep  '92500000-0000-4000-8000-000000000002'
\set b_stale '92500000-0000-4000-8000-000000000003'
\set b_keep  '92500000-0000-4000-8000-000000000004'
\set o_stale '92500000-0000-4000-8000-000000000005'
\set o_keep  '92500000-0000-4000-8000-000000000006'
\set x_other '92500000-0000-4000-8000-000000000007'
\set x_comp  '92500000-0000-4000-8000-000000000008'
\set x_sign  '92500000-0000-4000-8000-000000000009'
\set x_rej   '92500000-0000-4000-8000-00000000000a'
\set x_live  '92500000-0000-4000-8000-00000000000b'

insert into staff (id, first_name, last_name, email, phone, dob, status, payroll_id, employee_id) values
  -- pair 1: the first application had a mistyped address and phone
  (:'s_stale', 'Sia',   'Jillson', 'sia@dup925.invalid',      '+447700925001', date '2002-03-03', 'interview_requested', 'T925A', 925001),
  (:'s_keep',  'Sia',   'Jillson', 'sia.real@dup925.invalid', '+447700925002', date '2002-03-03', 'documents',           null,    null),
  -- pair 2: the same address and phone, a different birth year
  (:'b_stale', 'Bevin', 'Olsen',      'bevin@dup925.invalid',    '+447700925003', date '2005-09-06', 'interview_requested', 'T925B', null),
  (:'b_keep',  'Bevin', 'Olsen',      'bevin@dup925.invalid',    '+447700925003', date '2004-09-06', 'quiz',                null,    null),
  -- Ola already has her own Payroll ID on the live record
  (:'o_stale', 'Ola',   'Dup',        'ola@dup925.invalid',      '+447700925005', date '2001-01-01', 'interview_requested', 'T925C', 925005),
  (:'o_keep',  'Ola',   'Dup',        'ola@dup925.invalid',      '+447700925006', date '2001-01-01', 'documents',           'T925D', 925006),
  (:'x_other', 'Sam',   'Other',      'sam@dup925.invalid',      '+447700925007', date '2000-05-05', 'documents',           null,    null),
  (:'x_live',  'Cy',    'Comp',       'cy@dup925.invalid',       '+447700925008', date '2000-06-06', 'documents',           null,    null),
  (:'x_sign',  'Cy',    'Comp',       'cy@dup925.invalid',       '+447700925008', date '2000-06-06', 'documents',           null,    null),
  (:'x_comp',  'Cy',    'Comp',       'cy@dup925.invalid',       '+447700925008', date '2000-06-06', 'compliant',           null,    925008),
  (:'x_rej',   'Cy',    'Comp',       'cy@dup925.invalid',       '+447700925008', date '2000-06-06', 'rejected',            null,    null);

update staff set contract_signed_at = now() where id in (:'x_sign', :'x_comp');

insert into notification_outbox (key, channel, template, recipient_staff_id, recipient_emails, payload, sent_at) values
  ('OC1:staff:92500000-0000-4000-8000-000000000001:1:1', 'email', 'OC1', :'s_stale', array['sia@dup925.invalid'], '{}', now());
insert into notification_outbox (key, channel, template, recipient_staff_id, recipient_emails, payload) values
  ('OC1:staff:92500000-0000-4000-8000-000000000001:1:2', 'email', 'OC1', :'s_stale', array['sia@dup925.invalid'], '{}');
-- one the drain has claimed this minute (its lease): it must be left alone
insert into notification_outbox (key, channel, template, recipient_staff_id, recipient_emails, payload, last_attempt_at, attempts) values
  ('OC1:staff:92500000-0000-4000-8000-000000000001:1:3', 'email', 'OC1', :'s_stale', array['sia@dup925.invalid'], '{}', now(), 1);

-- A · who can run it ---------------------------------------------------
select ok(has_function_privilege('service_role', 'public.close_duplicate_candidate(uuid,uuid,uuid)', 'execute'),
          'A1 · service_role can run it');
select ok(not has_function_privilege('authenticated', 'public.close_duplicate_candidate(uuid,uuid,uuid)', 'execute'),
          'A2 · a signed-in caller cannot');
select ok(not has_function_privilege('anon', 'public.close_duplicate_candidate(uuid,uuid,uuid)', 'execute'),
          'A3 · anon cannot');

-- B · Sai --------------------------------------------------------------
select is((close_duplicate_candidate(:'s_stale', :'s_keep'))->>'payrollIdMoved', 'true',
          'B1 · the Payroll ID moved');
select is((select status::text from staff where id = :'s_stale'), 'rejected', 'B2 · the stale record is rejected');
select is((select rejection_cause from staff where id = :'s_stale'), 'manager', 'B3 · cause manager');
select is((select payroll_id from staff where id = :'s_keep'), 'T925A', 'B4 · the live record holds the Payroll ID');
select is((select employee_id from staff where id = :'s_keep'), 925001, 'B5 · and the Employee ID');
select ok((select payroll_id is null and employee_id is null from staff where id = :'s_stale'),
          'B6 · the stale record holds neither');
select is((select status::text from staff where id = :'s_keep'), 'documents', 'B7 · the live record has not moved stage');
select is((select count(*)::int from notification_outbox where key like 'E2%:staff:' || :'s_stale' || '%'), 0,
          'B8 · no rejection email was queued');
select is((select count(*)::int from notification_outbox where recipient_staff_id = :'s_stale' and sent_at is null and last_attempt_at is null), 0,
          'B9 · its unsent email is dropped');
select is((select count(*)::int from notification_outbox where recipient_staff_id = :'s_stale' and sent_at is null and last_attempt_at is not null), 1,
          'B9b · but not one the drain has just claimed');
select is((select count(*)::int from notification_outbox where recipient_staff_id = :'s_stale' and sent_at is not null), 1,
          'B10 · the sent record stays');
select is((select data->>'keptStaffId' from audit_log where action = 'staff.duplicate_closed' and entity_id = :'s_stale'),
          :'s_keep', 'B11 · audited with the kept record');

-- C · Bivek ------------------------------------------------------------
select is((select count(*)::int from audit_log where action = 'staff.duplicate_merged_in' and entity_id = :'s_keep'), 1,
          'B12 · the kept record''s own history says it gained the IDs');

select is((close_duplicate_candidate(:'b_stale', :'b_keep'))->>'payrollIdMoved', 'true',
          'C1 · same address, different birth year: closed, ID moved');
select is((select payroll_id from staff where id = :'b_keep'), 'T925B', 'C2 · the live record holds the Payroll ID');
select is((select employee_id from staff where id = :'b_keep'), null, 'C3 · no Employee ID was invented');
select is((select dob from staff where id = :'b_keep'), date '2004-09-06', 'C4 · the kept date of birth is untouched');
select is((select status::text from staff where id = :'b_keep'), 'quiz', 'C5 · the live record stays at the quiz');

select is((select data->>'fromStaffId' from audit_log where action = 'staff.duplicate_merged_in' and entity_id = :'b_keep'),
          :'b_stale', 'C6 · and so does the second pair''s');

-- D · again, and a kept record's own IDs -------------------------------
select is((close_duplicate_candidate(:'s_stale', :'s_keep'))->>'alreadyClosed', 'true', 'D1 · a second run is a no-op');
select is((select count(*)::int from audit_log where action = 'staff.duplicate_closed' and entity_id = :'s_stale'), 1,
          'D2 · and does not audit twice');
select is((close_duplicate_candidate(:'o_stale', :'o_keep'))->>'payrollIdMoved', 'false',
          'D3 · a kept record that has its own Payroll ID keeps it');
select is((select payroll_id from staff where id = :'o_keep'), 'T925D', 'D4 · its own Payroll ID is unchanged');
select is((select employee_id from staff where id = :'o_keep'), 925006, 'D5 · and its own Employee ID');
select is((select payroll_id from staff where id = :'o_stale'), 'T925C', 'D6 · the stale record keeps the one it could not hand over');

-- E · refusals ---------------------------------------------------------
select throws_ok($$ select close_duplicate_candidate('92500000-0000-4000-8000-000000000007', '92500000-0000-4000-8000-00000000000b') $$,
                 'P0001', 'not_the_same_person', 'E1 · another person is refused');
select throws_ok($$ select close_duplicate_candidate('92500000-0000-4000-8000-000000000008', '92500000-0000-4000-8000-00000000000b') $$,
                 'P0001', 'not_a_candidate: compliant', 'E2 · a stale record past the candidate stages is refused');
select throws_ok($$ select close_duplicate_candidate('92500000-0000-4000-8000-000000000009', '92500000-0000-4000-8000-00000000000b') $$,
                 'P0001', 'stale_has_history', 'E3 · a stale record with a signed contract is refused');
select throws_ok($$ select close_duplicate_candidate('92500000-0000-4000-8000-00000000000b', '92500000-0000-4000-8000-00000000000a') $$,
                 'P0001', 'keep_not_live: rejected', 'E4 · a rejected record cannot be the one kept');
select throws_ok($$ select close_duplicate_candidate('92500000-0000-4000-8000-000000000001', '92500000-0000-4000-8000-000000000001') $$,
                 'P0001', 'same_record', 'E5 · a record cannot be closed into itself');

-- the same name alone is not enough: another address AND another date of birth
update staff set email = 'cy.other@dup925.invalid', dob = date '1999-09-09' where id = '92500000-0000-4000-8000-00000000000b';
select throws_ok($$ select close_duplicate_candidate('92500000-0000-4000-8000-00000000000b', '92500000-0000-4000-8000-000000000009') $$,
                 'P0001', 'not_the_same_person', 'E6 · the same name with another email and another date of birth is refused');

select * from finish();
rollback;
