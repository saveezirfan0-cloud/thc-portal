-- =====================================================================
-- 931 · the office sets a passport's expiry after the fact (ADR-0201)
--   20261025100000_set_passport_expiry.sql
--
--   A · shape: closed to anon, open to a signed-in session.
--   B · a pending passport and a VERIFIED passport with no expiry both take
--       one; the date lands on the document and one document.expiry_set
--       audit row records it.
--   C · refusals: a date that has passed, one more than 15 years away, a
--       document that is not a passport.
--   D · nobody but the office calls it.
--
-- Every row is created inside the transaction and rolled back.
-- =====================================================================
begin;
select plan(11);
\ir _shared/fixtures.psql

\set w_one   'c9310000-0000-4000-8000-000000000001'
\set d_pend  'c9311000-0000-4000-8000-000000000001'
\set d_ver   'c9311000-0000-4000-8000-000000000002'
\set d_visa  'c9311000-0000-4000-8000-000000000003'

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'w_one', 97931, 'Pass', 'Port', 'pp@931.test', '+447700993101', date '1999-01-01', 'compliant');
insert into compliance_docs (id, staff_id, doc_type, uploaded_at, review_status, file_path) values
  (:'d_pend', :'w_one', 'passport',      now() - interval '2 days', 'pending', 'documents/931/p1.pdf'),
  (:'d_ver',  :'w_one', 'passport',      now() - interval '3 days', 'pending', 'documents/931/p2.pdf'),
  (:'d_visa', :'w_one', 'visa_document', now() - interval '2 days', 'pending', 'documents/931/visa.pdf');

-- =====================================================================
-- A · shape
-- =====================================================================
select ok(not has_function_privilege('anon', 'public.set_passport_expiry(uuid,date)', 'execute'),
  'A: anon cannot execute set_passport_expiry');
select ok(has_function_privilege('authenticated', 'public.set_passport_expiry(uuid,date)', 'execute'),
  'A: a signed-in session can (its own body decides who)');

-- =====================================================================
-- B · the office sets it
-- =====================================================================
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  format('select set_passport_expiry(%L, current_date + 400)', :'d_pend'),
  'B: a pending passport takes an expiry');
select is((select expiry_date from compliance_docs where id = :'d_pend'), current_date + 400,
  'B: the date is on the document');
select is((select count(*)::int from audit_log
            where action = 'document.expiry_set' and entity_id = :'d_pend'::uuid
              and (data ->> 'expiryAfter')::date = current_date + 400),
  1, 'B: audited with the date after');

-- a passport verified with no expiry (as before ADR-0201) can be dated later
select lives_ok(format('select compliance_verify_document(%L)', :'d_ver'),
  'B: a passport is verified with no expiry (the old path)');
select lives_ok(
  format('select set_passport_expiry(%L, current_date + 900)', :'d_ver'),
  'B: and the office then adds the expiry to the verified passport');

-- =====================================================================
-- C · refusals
-- =====================================================================
select throws_like(
  format('select set_passport_expiry(%L, current_date - 1)', :'d_pend'),
  'already_expired%', 'C: a date that has passed is refused');
select throws_like(
  format('select set_passport_expiry(%L, current_date + 6000)', :'d_pend'),
  'passport_expiry_implausible%', 'C: a date more than 15 years away is refused');
select throws_like(
  format('select set_passport_expiry(%L, current_date + 400)', :'d_visa'),
  'not_a_passport%', 'C: a document that is not a passport is refused');

-- =====================================================================
-- D · nobody but the office
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format('select set_passport_expiry(%L, current_date + 400)', :'d_pend'),
  '42501', 'not_authorised', 'D: a worker cannot');
reset role;

select * from finish();
rollback;
