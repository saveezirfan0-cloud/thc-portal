-- =====================================================================
-- 716 · The office decides a change request (ADR-0044)
--   office_decide_profile_change, office_profile_change_requests
--   20260930203000_office_staff_additions.sql · docs/19 §3
--
--   A. The queue: pending oldest first; a worker filter for the banner.
--   B. Approve a name: staff.first_name/last_name written, previous_value
--      snapshot, applied_at, decided_by; RC2 to the worker and RC4 to
--      admin@ + payroll, each payload carrying exactly the register's keys
--      (packages/notifications templates.test.ts); audit_log; no automatic
--      right-to-work re-check (Q13).
--   C. Approve a photo: photo_path repointed although the worker's own
--      path is locked (§10.1); RC2 only, no RC4.
--   D. Reject: a reason is required (blank refused, > 300 refused), stored
--      and pushed as RC3; the profile does not change.
--   E. A decided request is never decided again — approved, rejected or
--      withdrawn; an unknown id is refused.
--   F. Nothing issued is rewritten: event_documents and report_sends are
--      byte-for-byte unchanged (§1.7; exports never corrected
--      retroactively).
--   G. The decided tab names the manager; a worker, a client and anon
--      cannot decide or read the queue.
--
-- Fixture rows are written as the owner, never through Agent B's
-- request_profile_change (docs/19 §8).
--
-- RC2/RC3 name the kind {field} (20260930206000 — it was {change}, which
-- main's N11b uses for a sentence).
-- =====================================================================
begin;
select plan(39);
\ir _shared/fixtures.psql

\set pcr_photo_a '66600000-0000-4000-8000-000000000001'
\set pcr_name_b  '66600000-0000-4000-8000-000000000002'
\set pcr_name_a  '66600000-0000-4000-8000-000000000003'
\set pcr_photo_b '66600000-0000-4000-8000-000000000004'
\set pcr_wd      '66600000-0000-4000-8000-000000000005'

-- Staff Alpha's selfie is on file, so the worker's own path is locked.
update staff set photo_path = :'staffa' || '/selfie-1.jpg' where id = :'staffa';

insert into profile_change_requests (id, staff_id, kind, proposed_photo_path, worker_note) values
  (:'pcr_photo_a', :'staffa', 'photo', :'staffa' || '/selfie-2.jpg', 'New haircut');
insert into profile_change_requests (id, staff_id, kind, proposed_first_name, proposed_last_name, evidence_path, worker_note) values
  (:'pcr_name_b', :'staffb', 'name', 'Stephanie', 'Bravo-Okafor', :'staffb' || '/change-requests/cert.pdf', 'Married in August');
insert into profile_change_requests (id, staff_id, kind, proposed_first_name, proposed_last_name, evidence_path) values
  (:'pcr_name_a', :'staffa', 'name', 'Stafford', 'Alpha', :'staffa' || '/change-requests/deed.pdf');

-- What is already issued, fingerprinted before any decision.
create temp table issued_before as
select (select coalesce(md5(string_agg(t::text, '|' order by t::text)), '') from event_documents t) as docs,
       (select coalesce(md5(string_agg(t::text, '|' order by t::text)), '') from report_sends t)   as sends,
       (select count(*) from rtw_checks where staff_id = :'staffb')                                as rtw_b;
grant select on issued_before to authenticated;

-- =====================================================================
-- A · The queue, as the office
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select results_eq(
  format($$ select id from office_profile_change_requests() where id in (%L, %L, %L) $$,
         :'pcr_photo_a', :'pcr_name_b', :'pcr_name_a'),
  format($$ values (%L::uuid), (%L::uuid), (%L::uuid) $$, :'pcr_photo_a', :'pcr_name_b', :'pcr_name_a'),
  'A: pending, oldest first');
select results_eq(
  format($$ select current_first_name, current_last_name, proposed_first_name, proposed_last_name, evidence_path
              from office_profile_change_requests() where id = %L $$, :'pcr_name_b'),
  format($$ values ('Staff'::text, 'Bravo'::text, 'Stephanie'::text, 'Bravo-Okafor'::text, %L::text) $$,
         :'staffb' || '/change-requests/cert.pdf'),
  'A: now → requested side by side, with the evidence path');
select results_eq(
  format($$ select id from office_profile_change_requests(%L) $$, :'staffa'),
  format($$ values (%L::uuid), (%L::uuid) $$, :'pcr_photo_a', :'pcr_name_a'),
  'A: filtered to one worker for the /staff/:id banner');

-- =====================================================================
-- B · Approve a name
-- =====================================================================
select is(
  office_decide_profile_change(:'pcr_name_b', true, null),
  '{"ok": true, "status": "approved", "kind": "name"}'::jsonb,
  'B: the office approves the name change');
reset role;

select results_eq(
  format($$ select first_name, last_name from staff where id = %L $$, :'staffb'),
  $$ values ('Stephanie'::text, 'Bravo-Okafor'::text) $$,
  'B: staff.first_name / last_name now carry the new name');
select results_eq(
  format($$ select status, previous_value, decided_by, applied_at is not null, decided_at is not null, decision_reason
              from profile_change_requests where id = %L $$, :'pcr_name_b'),
  format($$ values ('approved'::text, '{"firstName": "Staff", "lastName": "Bravo"}'::jsonb, %L::uuid, true, true, null::text) $$,
         :'admin_uid'),
  'B: approved, applied, decided by the manager, with the name it replaced as the snapshot');
select results_eq(
  format($$ select channel::text, recipient_staff_id, payload from notification_outbox where key = %L $$,
         'RC2:request:' || :'pcr_name_b'),
  format($$ values ('push'::text, %L::uuid, '{"field": "name"}'::jsonb) $$, :'staffb'),
  'B: RC2 "Your name has been updated." to the worker, keyed RC2:request:<id>');
select results_eq(
  format($$ select channel::text, recipient_emails from notification_outbox where key = %L $$,
         'RC4:request:' || :'pcr_name_b'),
  $$ values ('email'::text, array['admin@thehospitalitycompany.co.uk', 'thc_payroll@topsourceworldwide.com']) $$,
  'B: RC4 emails admin@ and payroll — E7''s recipients');
select is(
  (select array_agg(k order by k) from notification_outbox o, jsonb_object_keys(o.payload) k
    where o.key = 'RC4:request:' || :'pcr_name_b'),
  array['approvedAt', 'employeeId', 'name', 'previousName'],
  'B: RC4''s payload carries exactly the register''s placeholders');
select results_eq(
  format($$ select payload ->> 'name', payload ->> 'previousName', payload ->> 'employeeId',
                   payload ->> 'approvedAt' ~ '^\d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}$'
              from notification_outbox where key = %L $$, 'RC4:request:' || :'pcr_name_b'),
  $$ values ('Stephanie Bravo-Okafor'::text, 'Staff Bravo'::text, '90002'::text, true) $$,
  'B: new name, previous name, Employee ID and the UK approval stamp');
select is(
  (select data from audit_log where action = 'profile_change.approve' and entity_id = :'staffb' and actor = :'admin_uid'),
  jsonb_build_object('requestId', :'pcr_name_b', 'kind', 'name'),
  'B: audit_log names the manager and the request');
select is(
  (select count(*) from rtw_checks where staff_id = :'staffb'),
  (select rtw_b from issued_before),
  'B: no right-to-work re-check is started (Q13)');

-- =====================================================================
-- C · Approve a photo, despite the lock
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  office_decide_profile_change(:'pcr_photo_a', true, '  '),
  '{"ok": true, "status": "approved", "kind": "photo"}'::jsonb,
  'C: the office approves the photo');
reset role;

select is((select photo_path from staff where id = :'staffa'), :'staffa' || '/selfie-2.jpg',
  'C: photo_path is repointed although staff_set_photo would refuse the worker (§10.1)');
select is((select previous_value from profile_change_requests where id = :'pcr_photo_a'),
  jsonb_build_object('photoPath', :'staffa' || '/selfie-1.jpg'),
  'C: the old path is the snapshot — the object itself is kept');
select is((select payload from notification_outbox where key = 'RC2:request:' || :'pcr_photo_a'),
  '{"field": "photo"}'::jsonb, 'C: RC2 "Your photo has been updated."');
select is((select count(*)::int from notification_outbox where key = 'RC4:request:' || :'pcr_photo_a'), 0,
  'C: no RC4 — payroll hears about names, not photos');
select is((select decision_reason from profile_change_requests where id = :'pcr_photo_a'), null,
  'C: an approval stores no reason for the worker to read');

-- =====================================================================
-- D · Reject
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select office_decide_profile_change(%L, false, null) $$, :'pcr_name_a'),
  '22023', 'reason_required', 'D: a rejection without a reason is refused');
select throws_ok(
  format($$ select office_decide_profile_change(%L, false, '   ') $$, :'pcr_name_a'),
  '22023', 'reason_required', 'D: a blank reason is no reason');
select throws_ok(
  format($$ select office_decide_profile_change(%L, false, %L) $$, :'pcr_name_a', repeat('x', 301)),
  '22023', 'reason_too_long', 'D: a reason over 300 characters is refused');
select is(
  office_decide_profile_change(:'pcr_name_a', false, ' The document shows a different surname. ') ->> 'status',
  'rejected', 'D: with a reason, the office rejects');
reset role;

select results_eq(
  format($$ select status, decision_reason, decided_by from profile_change_requests where id = %L $$, :'pcr_name_a'),
  format($$ values ('rejected'::text, 'The document shows a different surname.'::text, %L::uuid) $$, :'admin_uid'),
  'D: rejected, the trimmed reason stored for the worker, the manager recorded');
select is(
  (select payload from notification_outbox where key = 'RC3:request:' || :'pcr_name_a'),
  '{"field": "name", "reason": "The document shows a different surname."}'::jsonb,
  'D: RC3 carries exactly {change, reason} — "We couldn''t update your name: …"');
select results_eq(
  format($$ select first_name, last_name from staff where id = %L $$, :'staffa'),
  $$ values ('Staff'::text, 'Alpha'::text) $$,
  'D: the name on the profile is unchanged');
select is(
  (select count(*)::int from audit_log where action = 'profile_change.reject' and entity_id = :'staffa'),
  1, 'D: the rejection is audited');

-- =====================================================================
-- E · Decided once
-- =====================================================================
insert into profile_change_requests (id, staff_id, kind, proposed_photo_path) values
  (:'pcr_wd', :'staffb', 'photo', :'staffb' || '/selfie-9.jpg');
update profile_change_requests set status = 'withdrawn' where id = :'pcr_wd';

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select office_decide_profile_change(%L, true) $$, :'pcr_name_b'),
  'P0001', 'already_decided', 'E: an approved request cannot be approved again');
select throws_ok(
  format($$ select office_decide_profile_change(%L, false, 'Changed my mind') $$, :'pcr_photo_a'),
  'P0001', 'already_decided', 'E: nor rejected after approval');
select throws_ok(
  format($$ select office_decide_profile_change(%L, true) $$, :'pcr_name_a'),
  'P0001', 'already_decided', 'E: a rejected request cannot be approved');
select throws_ok(
  format($$ select office_decide_profile_change(%L, true) $$, :'pcr_wd'),
  'P0001', 'already_decided', 'E: a withdrawn request cannot be decided');
select throws_ok(
  format($$ select office_decide_profile_change(%L, true) $$, :'new_id'),
  'P0002', 'request_not_found', 'E: an unknown request is refused');

-- =====================================================================
-- G · The decided tab
-- =====================================================================
select results_eq(
  format($$ select id, status, decided_by_name from office_profile_change_requests(null, true)
             where id in (%L, %L, %L) order by id $$, :'pcr_photo_a', :'pcr_name_b', :'pcr_name_a'),
  format($$ values (%L::uuid, 'approved'::text, 'Gisela M.'::text),
                   (%L::uuid, 'approved'::text, 'Gisela M.'::text),
                   (%L::uuid, 'rejected'::text, 'Gisela M.'::text) $$,
         :'pcr_photo_a', :'pcr_name_b', :'pcr_name_a'),
  'G: the Decided tab names the manager who decided');
select is(
  (select decided_by_name from office_profile_change_requests(null, true) where id = :'pcr_wd'),
  null, 'G: a withdrawal names no manager');
reset role;

-- =====================================================================
-- F · Nothing issued is rewritten
-- =====================================================================
select ok(
  (select docs = (select coalesce(md5(string_agg(t::text, '|' order by t::text)), '') from event_documents t)
      and sends = (select coalesce(md5(string_agg(t::text, '|' order by t::text)), '') from report_sends t)
     from issued_before),
  'F: event_documents and report_sends are exactly as they were (§1.7)');

-- =====================================================================
-- G · Nobody but the office
-- =====================================================================
insert into profile_change_requests (id, staff_id, kind, proposed_photo_path) values
  (:'pcr_photo_b', :'staffb', 'photo', :'staffb' || '/selfie-3.jpg');

select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select office_decide_profile_change(%L, true) $$, :'pcr_photo_b'),
  '42501', 'not_authorised', 'G staff: a worker cannot approve their own request');
select throws_ok(
  $$ select * from office_profile_change_requests() $$,
  '42501', 'not_authorised', 'G staff: nor read the queue');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select office_decide_profile_change(%L, false, 'No') $$, :'pcr_photo_b'),
  '42501', 'not_authorised', 'G client: a client cannot decide');
reset role;

select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok(
  format($$ select office_decide_profile_change(%L, true) $$, :'pcr_photo_b'),
  '42501', null, 'G anon: no execute privilege');
reset role;

select is((select status from profile_change_requests where id = :'pcr_photo_b'), 'pending',
  'G: and the request is still pending after every refusal');

select * from finish();
rollback;
