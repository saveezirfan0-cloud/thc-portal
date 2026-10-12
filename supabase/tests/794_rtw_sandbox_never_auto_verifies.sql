-- =====================================================================
-- 794 · a SANDBOX right-to-work result is never acted on by itself
--       20261012120800 · §2.6, ADR-0041, ADR-0063
--
-- With settings.rtw_check.admin_confirms = false a `verify` result went
-- straight to Verify. The sandbox provider's results (reference
-- SANDBOX-…) are not Home Office answers: they now always wait for an
-- admin, while a real result keeps ADR-0025's automatic path.
-- =====================================================================
begin;
select plan(9);
\ir _shared/fixtures.psql

\set w1 '79400000-0000-4000-8000-000000000001'
\set w2 '79400000-0000-4000-8000-000000000002'
\set d1 '79410000-0000-4000-8000-000000000001'
\set d2 '79410000-0000-4000-8000-000000000002'
\set w3 '79400000-0000-4000-8000-000000000003'
\set d3 '79410000-0000-4000-8000-000000000003'

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status, rtw_branch, share_code) values
  (:'w1', 97941, 'Sandy', 'Box',  'sandy@rtw794.test', '+447700979401', date '1996-05-05', 'compliant', 'eu_settled', 'W79400001'),
  (:'w2', 97942, 'Real',  'Pass', 'real@rtw794.test',  '+447700979402', date '1995-04-04', 'compliant', 'eu_settled', 'W79400002'),
  (:'w3', 97943, 'Nora',  'Box',  'nora@rtw794.test',  '+447700979403', date '1994-03-03', 'compliant', 'eu_settled', 'W79400003');

update settings set value = value || '{"enabled": true, "admin_confirms": false}'::jsonb where key = 'rtw_check';
insert into compliance_docs (id, staff_id, doc_type, share_code, review_status, needs_manual_review, uploaded_at) values
  (:'d1', :'w1', 'share_code_report', 'W79400001', 'pending', true, clock_timestamp()),
  (:'d2', :'w2', 'share_code_report', 'W79400002', 'pending', true, clock_timestamp()),
  (:'d3', :'w3', 'share_code_report', 'W79400003', 'pending', true, clock_timestamp());

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
create temp table claimed on commit drop as select * from rtw_check_claim(10, 600);
select is((select count(*)::int from claimed where document_id in (:'d1', :'d2', :'d3')), 3, 'the three checks are claimed');

-- A sandbox pass, with the admin's review switched off.
select is(
  rtw_check_record(
    (select check_id from claimed where document_id = :'d1'),
    jsonb_build_object('outcome', 'right_to_work', 'source', 'provider', 'fullName', 'BOX, Sandy',
                       'rightToWorkUntil', null, 'conditions', '[]'::jsonb,
                       'referenceNumber', 'SANDBOX-7940001-20261012', 'checkedAt', now()),
    jsonb_build_object('action', 'verify', 'rightToWorkUntil', null, 'noTimeLimit', true),
    :'w1' || '/share-code-report/rtw-794-1.pdf') ->> 'status',
  'needs_review', 'a SANDBOX pass waits for an admin even with admin_confirms off');
select is((select review_status::text from compliance_docs where id = :'d1'), 'pending',
  'the document is NOT verified');
select is((select recommendation from rtw_checks where compliance_doc_id = :'d1'), 'verify',
  'the recommendation is kept for the admin');
select ok((select review_reason like 'SANDBOX result, not a Home Office check.%' from rtw_checks where compliance_doc_id = :'d1'),
  'and the reason says it is a sandbox result');

-- A sandbox "no right to work" is not an automatic reject either.
select is(
  rtw_check_record(
    (select check_id from claimed where document_id = :'d3'),
    jsonb_build_object('outcome', 'no_right_to_work', 'source', 'provider',
                       'referenceNumber', 'sandbox-7940003-x', 'checkedAt', now()),
    jsonb_build_object('action', 'reject', 'workerReason', 'Sandbox says no')) ->> 'status',
  'needs_review', 'a SANDBOX refusal (any case) waits for an admin too');
select is((select review_status::text from compliance_docs where id = :'d3'), 'pending',
  'and the document is not rejected');

-- A real result keeps the automatic path (ADR-0025).
select is(
  rtw_check_record(
    (select check_id from claimed where document_id = :'d2'),
    jsonb_build_object('outcome', 'right_to_work', 'source', 'govuk', 'fullName', 'PASS, Real',
                       'rightToWorkUntil', null, 'conditions', '[]'::jsonb,
                       'referenceNumber', 'SYNTH-794-2', 'checkedAt', now()),
    jsonb_build_object('action', 'verify', 'rightToWorkUntil', null, 'noTimeLimit', true),
    :'w2' || '/share-code-report/rtw-794-2.pdf') ->> 'status',
  'passed', 'a non-sandbox pass with admin_confirms off still verifies by itself');
select is((select review_status::text from compliance_docs where id = :'d2'), 'verified', 'that document is verified');

select * from finish();
rollback;
