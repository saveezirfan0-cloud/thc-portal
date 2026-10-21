-- =====================================================================
-- 912 · The Home Office check result on the office's side — ADR-0182,
--       20261022190100
--
--   1. office_attach_home_office_check(): this branch only, the worker's
--      own folder, PDF/JPG/PNG up to 10 MB; a renewal is a fresh row, a
--      replacement supersedes the one not yet reviewed; office callers only;
--   2. a renewal verified later replaces the old result as the evidence and
--      moves the right-to-work date; a rejected result sends no "Re-upload";
--   3. the worker can never file this type, nor a share code on this branch;
--   4. expiry: no N1–N3 to the worker (they cannot obtain it), CL4 to the
--      office with the route in words, and N4 — in its "the office is
--      renewing it" variant — with the block on the day; a renewal rejected
--      while the older result is in date does not block or unroster them;
--   5. the Change dialog moves a worker onto and off the branch with the
--      reference (required, checked, editable), and the evidence follows;
--      the reference never outlives the branch;
--   6. RLS: the office sees every result and the reference; a worker their
--      own result rows only, and cannot read the reference from the tables
--      (they see the one they typed in their own onboarding state, as with
--      a share code — 911); a client nothing.
--
-- Every row is created inside the transaction and rolled back.
-- =====================================================================
begin;
select plan(54);
\ir _shared/fixtures.psql

\set hamid     '91210000-0000-4000-8000-000000000001'
\set hamid_uid '91220000-0000-4000-8000-000000000001'
\set lina      '91210000-0000-4000-8000-000000000002'
\set omar      '91210000-0000-4000-8000-000000000003'
\set val       '91210000-0000-4000-8000-000000000004'
\set h_old     '91230000-0000-4000-8000-000000000001'
\set l_doc     '91230000-0000-4000-8000-000000000002'
\set o_doc     '91230000-0000-4000-8000-000000000003'
\set v_share   '91230000-0000-4000-8000-000000000004'

insert into auth.users (id, email) values (:'hamid_uid', 'hamid@ecs.test');
insert into profiles (id, role, full_name) values (:'hamid_uid', 'staff', 'Hamid Karimi');

insert into staff (id, user_id, employee_id, first_name, last_name, email, phone, dob, status,
                   rtw_branch, home_office_ref, right_to_work_until) values
  (:'hamid', :'hamid_uid', 91201, 'Hamid', 'Karimi', 'hamid@ecs.test', '+447700991201', date '1994-02-02',
   'compliant', 'home_office_check', 'H1234567', date '2026-11-22'),
  (:'lina',  null,         91202, 'Lina',  'Saleh',  'lina@ecs.test',  '+447700991202', date '1995-03-03',
   'compliant', 'home_office_check', 'ABC123456', date '2026-11-22'),
  (:'omar',  null,         91203, 'Omar',  'Farah',  'omar@ecs.test',  '+447700991203', date '1993-04-04',
   'compliant', 'home_office_check', 'GWF012345678', date '2026-11-01'),
  (:'val',   null,         91204, 'Val',   'Visa',   'val@ecs.test',   '+447700991204', date '1992-05-05',
   'compliant', 'work_visa', null, date '2026-11-22');

insert into compliance_docs (id, staff_id, doc_type, file_path, share_code, review_status,
                             right_to_work_until, uploaded_at) values
  (:'h_old',   :'hamid', 'home_office_check_result', :'hamid' || '/home-office-check-result/may.pdf',
   'H1234567', 'verified', date '2026-11-22', timestamptz '2026-05-20 10:00+01'),
  (:'l_doc',   :'lina',  'home_office_check_result', :'lina' || '/home-office-check-result/may.pdf',
   'ABC123456', 'verified', date '2026-11-22', timestamptz '2026-05-20 10:00+01'),
  (:'o_doc',   :'omar',  'home_office_check_result', :'omar' || '/home-office-check-result/may.pdf',
   'GWF012345678', 'verified', date '2026-11-01', timestamptz '2026-05-01 10:00+01'),
  (:'v_share', :'val',   'share_code_report', null, 'WV1234567', 'verified', date '2026-11-22',
   timestamptz '2026-05-20 10:00+01');

insert into storage.objects (bucket_id, name, metadata) values
  ('documents', :'hamid' || '/home-office-check-result/nov.pdf',  '{"mimetype":"application/pdf","size":150000}'),
  ('documents', :'hamid' || '/home-office-check-result/nov2.jpg', '{"mimetype":"image/jpeg","size":150000}'),
  ('documents', :'hamid' || '/home-office-check-result/dec.png',  '{"mimetype":"image/png","size":150000}'),
  ('documents', :'hamid' || '/home-office-check-result/big.pdf',  '{"mimetype":"application/pdf","size":10485761}'),
  ('documents', :'hamid' || '/home-office-check-result/odd.png',  '{"mimetype":"image/gif","size":1000}'),
  ('documents', :'hamid' || '/passport/mine.pdf',                 '{"mimetype":"application/pdf","size":1000}'),
  ('documents', :'val'   || '/home-office-check-result/ecs.pdf',  '{"mimetype":"application/pdf","size":150000}'),
  ('documents', :'val'   || '/home-office-check-result/ecs2.pdf', '{"mimetype":"application/pdf","size":150000}');

-- =====================================================================
-- 1 · The office attaches the result
-- =====================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(office_attach_home_office_check(:'val', :'val' || '/home-office-check-result/ecs.pdf') ->> 'reason',
  'not_home_office_branch', 'only for a worker on the Home Office check branch');
select is(office_attach_home_office_check(:'hamid', :'val' || '/home-office-check-result/ecs.pdf') ->> 'reason',
  'invalid_path', 'the file must sit in that worker''s own home-office-check-result folder');
select is(office_attach_home_office_check(:'hamid', :'hamid' || '/passport/mine.pdf') ->> 'reason',
  'invalid_path', 'and in that folder, not another document''s');
select is(office_attach_home_office_check(:'hamid', :'hamid' || '/home-office-check-result/none.pdf') ->> 'reason',
  'file_not_found', 'a file Storage never recorded is refused');
select is(office_attach_home_office_check(:'hamid', :'hamid' || '/home-office-check-result/odd.png') ->> 'reason',
  'unsupported_file_type', 'PDF, JPG or PNG only — judged on what Storage recorded');
select is(office_attach_home_office_check(:'hamid', :'hamid' || '/home-office-check-result/big.pdf') ->> 'reason',
  'file_too_large', 'up to 10 MB');

select is(office_attach_home_office_check(:'hamid', :'hamid' || '/home-office-check-result/nov.pdf') ->> 'mode',
  'new', 'a renewal: the last result is verified, so the new one is a fresh row');
select is(office_attach_home_office_check(:'hamid', :'hamid' || '/home-office-check-result/nov.pdf') ->> 'reason',
  'invalid_path', 'one object, one row');
select is(office_attach_home_office_check(:'hamid', :'hamid' || '/home-office-check-result/nov2.jpg') ->> 'mode',
  'replaced', 'attaching again before review replaces the pending one');
reset role;

select results_eq(
  format($$ select review_status::text, share_code, mime_type from compliance_docs
             where staff_id = %L and doc_type = 'home_office_check_result' order by uploaded_at $$, :'hamid'),
  $$ values ('verified'::text, 'H1234567'::text, null::text),
            ('superseded', 'H1234567', 'application/pdf'),
            ('pending', 'H1234567', 'image/jpeg') $$,
  'the old result still verified, the replaced one superseded and kept, the new one pending — each carrying the reference');
select is((select right_to_work_until from staff where id = :'hamid'), date '2026-11-22',
  'nothing moves the date until a Verify');
select results_eq(
  format($$ select data ->> 'mode', data ->> 'actorName' from audit_log
             where action = 'rtw.home_office_check_attached' and data ->> 'staffId' = %L
             order by at, id $$, :'hamid'),
  $$ values ('new'::text, 'Gisela M.'::text), ('replaced', 'Gisela M.') $$,
  'each attach is audited under the admin''s name');
select is((select share_code from compliance_review_queue_v
            where staff_id = :'hamid' and item_type = 'home_office_check_result'), 'H1234567',
  'the queue carries the reference for the reviewer');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select throws_ok(
  format($$ select office_attach_home_office_check(%L, %L) $$, :'hamid', :'hamid' || '/home-office-check-result/dec.png'),
  '42501', 'not_authorised', 'a worker cannot attach a result');
reset role;

-- =====================================================================
-- 2 · Verify and reject
-- =====================================================================
-- Six months from the date approved, the same day of the month, clamped
-- to a shorter month's end — the vectors of homeOfficeCheckUntil().
select results_eq(
  $$ select home_office_check_until(a) from (values (date '2026-10-21'), (date '2026-08-31'),
       (date '2027-08-31'), (date '2026-12-31'), (date '2026-07-15'), (date '2026-02-28')) v(a) $$,
  $$ values (date '2027-04-21'), (date '2027-02-28'), (date '2028-02-29'), (date '2027-06-30'),
            (date '2027-01-15'), (date '2026-08-28') $$,
  'home_office_check_until(): the same six months as packages/domain');

-- The renewal was approved three days ago; the office types a different
-- end date because this result says so.
select (current_date - 3) as approved, (current_date + 170) as typed \gset

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  compliance_verify_home_office_check(
    (select id from compliance_docs where staff_id = :'hamid' and review_status = 'pending'),
    :'approved'::date, :'typed'::date) ->> 'rightToWorkUntil',
  :'typed', 'the renewal verified with the date the office typed becomes the right-to-work date');
reset role;

select is((select doc_id from current_verified_docs(:'hamid') where doc_type = 'home_office_check_result'),
  (select id from compliance_docs where staff_id = :'hamid' and right_to_work_until = :'typed'::date),
  'the renewal is now the result that counts');
select is((select home_office_approved_on from compliance_docs
            where staff_id = :'hamid' and right_to_work_until = :'typed'::date), :'approved'::date,
  'with its date approved on the row');
select is((select review_status::text from compliance_docs where id = :'h_old'), 'verified',
  'the old one stays on file as it was');
select is(doc_expires_on('home_office_check_result', null, date '2027-05-20', date '2026-11-22', now(), null),
  date '2027-05-20', 'a result expires on the right-to-work-until confirmed on it, as a share code report does');
select throws_ok($$ update compliance_docs set home_office_approved_on = current_date
                     where id = '91230000-0000-4000-8000-000000000004' $$,
  '23514', null, 'only a Home Office check result carries a date approved');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(office_attach_home_office_check(:'hamid', :'hamid' || '/home-office-check-result/dec.png') ->> 'mode',
  'new', 'another result, which the office then rejects');
select lives_ok(
  format($$ select compliance_reject_document(%L, 'Negative verification notice') $$,
         (select id from compliance_docs where staff_id = :'hamid' and review_status = 'pending')),
  'Reject');
reset role;
select is((select count(*)::int from notification_outbox
            where template = 'N8' and recipient_staff_id = :'hamid'), 0,
  'no "Document rejected — Re-upload" push: the worker cannot obtain this document');
select is((select count(*)::int from compliance_blockers(:'hamid')), 0,
  'the rejected renewal is no blocker while the result before it is verified and in date');
select ok(can_roster_staff(:'hamid', current_date + 1), 'and they can still be rostered on it');
select is((select status::text from staff where id = :'hamid'), 'compliant', 'still compliant');

-- =====================================================================
-- 3 · Never the worker's to file
-- =====================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"91220000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(submit_document_upload('home_office_check_result', :'hamid' || '/home-office-check-result/dec.png') ->> 'reason',
  'office_only', 'the Documents hub refuses the type');
select is(submit_document_upload('share_code_report', null, 'W123AB4CD') ->> 'reason',
  'not_required', 'and there is no share code to enter on this branch');
reset role;

-- =====================================================================
-- 4 · Expiry
-- =====================================================================
select lives_ok($$ select compliance_daily(timestamptz '2026-11-02 08:00 Europe/London') $$,
  'the daily compliance job runs');
select is((select count(*)::int from notification_outbox where key = 'N1:doc:' || :'l_doc'), 0,
  'no N1 "Update your …" to a worker whose Home Office result expires in 20 days');
select is((select count(*)::int from notification_outbox where key = 'N1:doc:' || :'v_share'), 1,
  'the ladder still runs for a share code expiring the same day');
select is((select payload ->> 'variant' from notification_outbox where key = 'N4:doc:' || :'o_doc'),
  'home_office', 'on the day: N4, in its variant that says the office is renewing it');
select results_eq(
  format($$ select status::text, block_kind::text from staff where id = %L $$, :'omar'),
  $$ values ('blocked'::text, 'auto_document'::text) $$,
  'and the automatic block');

select lives_ok($$ select rtw_daily(timestamptz '2026-11-02 08:00 Europe/London') $$,
  'the daily right-to-work job runs');
select is((select payload ->> 'route' from notification_outbox
            where template = 'CL4' and payload ->> 'name' = 'Lina Saleh'),
  'Home Office check (Employer Checking Service)',
  'the office is told by CL4, with the route in words');

-- =====================================================================
-- 5 · The Change dialog, and the reference
-- =====================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok($$ select record_right_to_work_change('91210000-0000-4000-8000-000000000004', 'home_office_check', null) $$,
  'P0001', 'home_office_ref_required', 'onto the branch, the office gives the Home Office reference');
select throws_ok($$ select record_right_to_work_change('91210000-0000-4000-8000-000000000004', 'home_office_check', null, null, 'X1') $$,
  'P0001', 'bad_home_office_ref', 'checked like the worker''s own');
select is(record_right_to_work_change(:'val', 'home_office_check', null, null, E'arc\u00a0778899') ->> 'evidenceSuperseded', '1',
  'moving a worker onto the branch supersedes their share code report');
select is((select home_office_ref from staff_identity_v where staff_id = :'val'), 'ARC 778899',
  'the reference is stored, normalised, for the office''s Employer Checking Service form');
reset role;
select results_eq(
  format($$ select rtw_branch::text, right_to_work_until, (select review_status::text from compliance_docs where id = %L)
              from staff where id = %L $$, :'v_share', :'val'),
  $$ values ('home_office_check'::text, null::date, 'superseded'::text) $$,
  'kept read-only, and no date until the result is verified');
select ok(not can_roster_staff(:'val', date '2026-11-03'), 'meanwhile no shift can be rostered');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(office_attach_home_office_check(:'val', :'val' || '/home-office-check-result/ecs.pdf') ->> 'mode',
  'new', 'the office attaches their Home Office result');
select lives_ok($$ select record_right_to_work_change('91210000-0000-4000-8000-000000000004', 'home_office_check', null, null, 'ARC 778890') $$,
  'the office corrects the reference, staying on the branch');
reset role;
select is((select share_code from compliance_docs
            where staff_id = :'val' and doc_type = 'home_office_check_result' and review_status = 'pending'),
  'ARC 778890', 'the result waiting for review carries the corrected reference');
select is((select (data ->> 'homeOfficeRefChanged')::boolean from audit_log
            where action = 'rtw.changed' and data ->> 'staffId' = :'val' order by at desc, id desc limit 1),
  true, 'audited as changed — whether, never what');
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(record_right_to_work_change(:'val', 'work_visa', null, 'W111AA2BB') ->> 'evidenceSuperseded', '1',
  'moving them off the branch again supersedes the result');
reset role;

update staff set removed_at = now() where id = :'lina';
select is((select home_office_ref from staff where id = :'lina'), null,
  'a removed worker keeps no reference (§1.7)');

-- =====================================================================
-- 6 · RLS: the office, the worker, a client
-- =====================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select count(*)::int from compliance_docs
            where doc_type = 'home_office_check_result'
              and staff_id in (:'hamid', :'lina', :'omar', :'val')), 7,
  'admin: every result on file');
select is((select home_office_ref from staff_identity_v where staff_id = :'hamid'), 'H1234567',
  'admin: the reference');

set local "request.jwt.claims" = '{"sub":"91220000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::int from compliance_docs where doc_type = 'home_office_check_result'), 4,
  'staff: their own results only');
select throws_ok($$ select share_code from compliance_docs where doc_type = 'home_office_check_result' $$,
  '42501', null, 'staff: never the reference on the row');

set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*)::int from compliance_docs where doc_type = 'home_office_check_result'), 0,
  'client: no result at all');
select is((select count(*)::int from staff_identity_v), 0, 'client: no reference');
reset role;

select * from finish();
rollback;
