-- =====================================================================
-- 430 · The Staff App's Documents tab (§10.4) and the in-employment
--       conviction declaration (§10.7) —
--       20260923150000_staff_documents_hub.sql
--
-- What is easy to get right on the screen and wrong here:
--
--   · an upload changes NOTHING but adds a pending row: no status, no
--     block, no earlier row. A compliant worker stays compliant on their
--     old passport while the new one is in review; a blocked worker stays
--     blocked until the office verifies it (§4.3).
--   · the file is judged by what Storage recorded, under the worker's
--     own folder — never by what the browser claimed.
--   · a manual hold cannot upload or declare its way out (§10.1 case 2,
--     §9.6): block_worker() would rewrite the manual block as a
--     conviction review, which the automatic re-check can lift.
--   · the declaration DETAILS never come back to the worker, and E9 does
--     not carry them (§10.7 steps 5 and 6).
--   · docs/14 O10 (5): declare_conviction(uuid, …) stays service-role
--     only; the worker's door takes no staff id.
--
-- Every row is created inside the transaction and rolled back. Employee
-- ids are 943xx (see 330's note on the 9xxxx convention).
-- =====================================================================
begin;
select plan(50);
\ir _shared/fixtures.psql

\set wk_uid   'd4300000-0000-4000-8000-0000000000a1'
\set hold_uid 'd4300000-0000-4000-8000-0000000000a2'
\set blk_uid  'd4300000-0000-4000-8000-0000000000a3'
\set cand_uid 'd4300000-0000-4000-8000-0000000000a4'
\set dec_uid  'd4300000-0000-4000-8000-0000000000a5'

\set wk    'd4310000-0000-4000-8000-000000000001'
\set hold  'd4310000-0000-4000-8000-000000000002'
\set blk   'd4310000-0000-4000-8000-000000000003'
\set cand  'd4310000-0000-4000-8000-000000000004'
\set dec   'd4310000-0000-4000-8000-000000000005'

\set doc_pp   'd4320000-0000-4000-8000-000000000001'
\set doc_visa 'd4320000-0000-4000-8000-000000000002'
\set doc_sc   'd4320000-0000-4000-8000-000000000003'
\set doc_old  'd4320000-0000-4000-8000-000000000004'
\set doc_blk  'd4320000-0000-4000-8000-000000000005'

\set ev     'd4330000-0000-4000-8000-000000000001'
\set sh1    'd4340000-0000-4000-8000-000000000001'
\set sh2    'd4340000-0000-4000-8000-000000000002'
\set bk_conf 'd4350000-0000-4000-8000-000000000001'
\set bk_inv  'd4350000-0000-4000-8000-000000000002'

insert into auth.users (id, email) values
  (:'wk_uid', 'wk@docs.test'), (:'hold_uid', 'hold@docs.test'), (:'blk_uid', 'blk@docs.test'),
  (:'cand_uid', 'cand@docs.test'), (:'dec_uid', 'dec@docs.test');
insert into profiles (id, role, full_name) values
  (:'wk_uid', 'staff', 'Wren Worker'), (:'hold_uid', 'staff', 'Hal Hold'),
  (:'blk_uid', 'staff', 'Bea Blocked'), (:'cand_uid', 'staff', 'Cal Candidate'),
  (:'dec_uid', 'staff', 'Dev Declares');

insert into staff (id, user_id, employee_id, first_name, last_name, email, phone, dob, status,
                   rtw_branch, right_to_work_until, block_kind, block_reason) values
  (:'wk',   :'wk_uid',   94301, 'Wren', 'Worker',    'wk@docs.test',   '+447700943001', date '1996-03-03',
   'compliant', 'work_visa', current_date + 400, null, null),
  (:'hold', :'hold_uid', 94302, 'Hal',  'Hold',      'hold@docs.test', '+447700943002', date '1995-01-01',
   'blocked', 'uk_irish', null, 'manual', 'Timesheet dispute — see file'),
  (:'blk',  :'blk_uid',  94303, 'Bea',  'Blocked',   'blk@docs.test',  '+447700943003', date '1995-01-01',
   'blocked', 'uk_irish', null, 'auto_document', 'Document expired: Passport'),
  (:'cand', :'cand_uid', null,  'Cal',  'Candidate', 'cand@docs.test', '+447700943004', date '2001-01-01',
   'documents', 'uk_irish', null, null, null),
  (:'dec',  :'dec_uid',  94305, 'Dev',  'Declares',  'dec@docs.test',  '+447700943005', date '1994-04-04',
   'compliant', 'uk_irish', null, null, null);

insert into compliance_docs (id, staff_id, doc_type, file_path, review_status, expiry_date,
                             right_to_work_until, uploaded_at) values
  (:'doc_pp',   :'wk',  'passport',          :'wk' || '/passport/p1.pdf',      'verified',
   current_date + 400, null, now() - interval '200 days'),
  (:'doc_visa', :'wk',  'visa_document',     :'wk' || '/visa-document/v1.pdf', 'verified',
   current_date + 20, null, now() - interval '200 days'),
  (:'doc_sc',   :'wk',  'share_code_report', null,                            'verified',
   null, current_date + 400, now() - interval '200 days'),
  -- An earlier period's passport, superseded by a Reset to candidate.
  (:'doc_old',  :'wk',  'passport',          :'wk' || '/passport/p0.pdf',      'superseded',
   current_date - 30, null, now() - interval '900 days'),
  (:'doc_blk',  :'blk', 'passport',          :'blk' || '/passport/b1.pdf',     'verified',
   current_date - 1, null, now() - interval '3000 days');

insert into criminal_declarations (staff_id, source, answer, review_status, declared_at) values
  (:'wk',  'onboarding', false, 'verified', now() - interval '200 days'),
  (:'dec', 'onboarding', false, 'verified', now() - interval '200 days'),
  (:'blk', 'onboarding', false, 'verified', now() - interval '3000 days');

-- Objects as Storage records them once the Staff App's server code has
-- issued the upload with the service key.
insert into storage.objects (bucket_id, name, metadata) values
  ('documents', :'wk'   || '/passport/p2.pdf',       '{"mimetype":"application/pdf","size":482113}'),
  ('documents', :'wk'   || '/passport/p3.jpg',       '{"mimetype":"image/jpeg","size":120000}'),
  ('documents', :'wk'   || '/visa-document/v2.png',  '{"mimetype":"image/jpeg","size":90000}'),
  ('documents', :'wk'   || '/visa-document/big.pdf', '{"mimetype":"application/pdf","size":10485761}'),
  ('documents', :'blk'  || '/passport/b2.jpg',       '{"mimetype":"image/jpeg","size":90000}'),
  ('documents', :'hold' || '/passport/h1.pdf',       '{"mimetype":"application/pdf","size":1000}'),
  ('documents', :'cand' || '/passport/c1.pdf',       '{"mimetype":"application/pdf","size":1000}');

-- Dev's work: one confirmed shift and one open invitation, both future.
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'ev', :'clienta', :'venue_id', 'The Savoy', '1 Strand, London',
   st_setsrid(st_makepoint(-0.1200, 51.5100), 4326)::geography, 150,
   'Winter Gala', current_date + 10, false, true);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'sh1', :'ev', :'role_id', now() + interval '10 days', now() + interval '10 days 6 hours', 4, 0, 30, 15, 1),
  (:'sh2', :'ev', :'role_id', now() + interval '11 days', now() + interval '11 days 6 hours', 4, 0, 30, 15, 1);
insert into staff_roles (staff_id, role_id) values (:'dec', :'role_id');
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'bk_conf', :'sh1', :'dec', 'confirmed', 'auto', now()),
  (:'bk_inv',  :'sh2', :'dec', 'invited',   'auto', null);

-- =====================================================================
-- Grants — docs/14 O10 (5)
-- =====================================================================
select ok(has_function_privilege('authenticated', 'public.staff_documents(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.staff_documents(uuid)', 'execute'),
  'staff_documents() is a signed-in worker''s, never anon''s');
select ok(has_function_privilege('authenticated', 'public.submit_document_upload(text, text, text, uuid)', 'execute')
          and not has_function_privilege('anon', 'public.submit_document_upload(text, text, text, uuid)', 'execute'),
  'submit_document_upload() is a signed-in worker''s, never anon''s');
select ok(has_function_privilege('authenticated', 'public.declare_my_conviction(text, date)', 'execute')
          and not has_function_privilege('anon', 'public.declare_my_conviction(text, date)', 'execute'),
  'O10: the worker''s §10.7 door is granted to authenticated and not to anon');
select ok(not has_function_privilege('authenticated',
            'public.declare_conviction(uuid, text, date, timestamptz)', 'execute'),
  'O10: declare_conviction(uuid, …) itself stays service-role only — no worker suspends a colleague by id');
select ok(not exists (select 1 from pg_proc
                       where proname = 'declare_my_conviction'
                         and 'uuid'::regtype::oid = any(proargtypes::oid[])),
  'O10: declare_my_conviction() takes no staff id at all — there is nothing to forge');

-- =====================================================================
-- staff_documents() — what the tab reads
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'wk_uid')::text, true);
set local role authenticated;
create temporary table t_docs on commit drop as select staff_documents() as j;
reset role;

select is((select jsonb_array_length(j->'documents') from t_docs), 4,
  'the tab gets every row the worker holds, the superseded one included (kept read-only, §2.12)');
select is((select d->>'expiresOn' from t_docs, jsonb_array_elements(j->'documents') d
            where d->>'id' = :'doc_sc'),
  (current_date + 400)::text,
  'a share code''s expiry is its right-to-work date — doc_expires_on(), the date §4.3 blocks on');
select is((select (d->>'isCountedVerified')::boolean from t_docs, jsonb_array_elements(j->'documents') d
            where d->>'id' = :'doc_pp'), true,
  'the verified passport is marked as the one current_verified_docs() counts');
select is((select (d->>'isCurrent')::boolean from t_docs, jsonb_array_elements(j->'documents') d
            where d->>'id' = :'doc_old'), false,
  'the superseded passport is history, not the current row');
select ok((select not (j->'declarations'->0 ? 'details') and not (j->'declarations'->0 ? 'convictionDate')
             from t_docs),
  '§10.7: the declaration history carries no details and no date');
select is((select j->'cap'->>'hours' from t_docs), '48',
  'the RULE-20 cap comes from weekly_cap_for() — a work visa, 48 h');
select is((select j->>'status' from t_docs), 'compliant', 'and the worker''s status');

select set_config('request.jwt.claims', json_build_object('sub', :'wk_uid')::text, true);
select throws_ok(format('select staff_documents(%L)', :'blk'), '42501', 'not_your_worker',
  'a worker cannot read a colleague''s documents by naming their id');

-- =====================================================================
-- submit_document_upload() — every refusal the worker can correct
-- =====================================================================
select is(submit_document_upload('selfie', :'wk' || '/passport/p2.pdf')->>'reason', 'invalid_doc_type',
  'an unknown document type is refused');
select is(submit_document_upload('university_completion_letter', :'wk' || '/passport/p2.pdf')->>'reason',
  'use_completion_letter',
  'the completion letter has its own RPC, because it needs the form and the completion date (§2.1)');
select is(submit_document_upload('status_document', :'wk' || '/passport/p2.pdf')->>'reason', 'not_required',
  'a document that is not part of this worker''s set is refused rather than stored');
select is(submit_document_upload('visa_document', null)->>'reason', 'file_required',
  'a document upload needs a file');
select is(submit_document_upload('visa_document', :'wk' || '/visa-document/v2.png')->>'reason',
  'unsupported_file_type',
  'the type is judged by what Storage recorded — a JPEG named .png is refused');
select is(submit_document_upload('visa_document', :'wk' || '/visa-document/big.pdf')->>'reason',
  'file_too_large', 'over 10 MB is refused');
select is(submit_document_upload('passport', :'blk' || '/passport/b2.jpg')->>'reason', 'invalid_path',
  'a worker cannot attach an object in someone else''s folder');
select is(submit_document_upload('passport', :'wk' || '/passport/missing.pdf')->>'reason', 'file_not_found',
  'a path Storage never recorded is refused');
select is(submit_document_upload('share_code_report', null, 'W98 7ZY')->>'reason', 'share_code_invalid',
  'a share code is nine letters and digits');

-- =====================================================================
-- An upload lands pending and changes nothing else
-- =====================================================================
create temporary table t_up on commit drop as
  select submit_document_upload('passport', :'wk' || '/passport/p2.pdf') as r;
select is((select r->>'status' from t_up), 'pending', 'a replacement passport lands pending');
select is((select review_status::text || '/' || mime_type || '/' || size_bytes
             from compliance_docs where id = ((select r->>'documentId' from t_up))::uuid),
  'pending/application/pdf/482113',
  'with the content type and size Storage recorded, not what the browser said');
select is((select status::text from staff where id = :'wk'), 'compliant',
  'the worker stays compliant while the replacement is in review (§4.3)');
select is((select review_status::text from compliance_docs where id = :'doc_pp'), 'verified',
  'and the old passport is untouched — still verified');
select ok(exists (select 1 from current_verified_docs(:'wk') where doc_id = :'doc_pp'),
  'and still the one expiry is measured off, so a blank upload cannot dodge the expiry-day block');
select ok(exists (select 1 from audit_log
                   where action = 'document.uploaded'
                     and entity_id = ((select r->>'documentId' from t_up))::uuid),
  'the upload is in the audit log');
select is(submit_document_upload('passport', :'wk' || '/passport/p3.jpg')->>'reason', 'already_pending',
  'one pending row per type — a wrong file is rejected and re-uploaded, not stacked');

select is(submit_document_upload('share_code_report', null, 'w98 7zy 6xk')->>'ok', 'true',
  'a new share code is typed, needs no file, and lands pending');
select is((select share_code from compliance_docs
            where staff_id = :'wk' and doc_type = 'share_code_report' and review_status = 'pending'),
  'W987ZY6XK', 'normalised to the nine characters gov.uk issues');

-- Rejected → Re-upload (§4.1, N8).
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
select compliance_reject_document(((select r->>'documentId' from t_up))::uuid, 'Photo is blurred — please re-take');
select set_config('request.jwt.claims', json_build_object('sub', :'wk_uid')::text, true);
select is((select d->>'rejectionReason'
             from jsonb_array_elements(staff_documents()->'documents') d
            where d->>'id' = (select r->>'documentId' from t_up)),
  'Photo is blurred — please re-take',
  'the tab shows the manager''s rejection reason on the row, word for word');
create temporary table t_re on commit drop as
  select submit_document_upload('passport', :'wk' || '/passport/p3.jpg') as r;
select is((select r->>'ok' from t_re), 'true', 'and the worker re-uploads after a rejection');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);
select compliance_reject_document(((select r->>'documentId' from t_re))::uuid, 'Wrong document');
select set_config('request.jwt.claims', json_build_object('sub', :'wk_uid')::text, true);
select is(submit_document_upload('passport', :'wk' || '/passport/p2.pdf')->>'reason', 'invalid_path',
  'a path already attached to a row is refused — one object, one document');

-- A worker blocked on an expired passport uploads a new one.
select set_config('request.jwt.claims', json_build_object('sub', :'blk_uid')::text, true);
select is(submit_document_upload('passport', :'blk' || '/passport/b2.jpg')->>'ok', 'true',
  '§10.1 case 1: a worker locked to Documents can upload the document that locked them');
select is((select status::text || '/' || block_kind::text from staff where id = :'blk'),
  'blocked/auto_document',
  'and stays blocked — only the office''s verification plus the full re-check unblocks (§4.3)');

-- =====================================================================
-- Who may not
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'hold_uid')::text, true);
select is(submit_document_upload('passport', :'hold' || '/passport/h1.pdf')->>'reason', 'not_eligible',
  '§10.1 case 2: a manual hold has nothing to upload');
select is(declare_my_conviction('Something')->>'reason', 'not_eligible',
  'nor can it declare — block_worker() would turn a manual block into one the automatic re-check can lift');
select is((select block_kind::text || '/' || block_reason from staff where id = :'hold'),
  'manual/Timesheet dispute — see file', 'the manual block is exactly as the manager left it');

select set_config('request.jwt.claims', json_build_object('sub', :'cand_uid')::text, true);
select is(submit_document_upload('passport', :'cand' || '/passport/c1.pdf')->>'reason', 'not_eligible',
  'a candidate uploads inside the onboarding wizard (§10.3), not here');
select is(declare_my_conviction('Something')->>'reason', 'not_eligible',
  'and declares at step 4/11, not here');

-- =====================================================================
-- §10.7 · declare_my_conviction()
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'dec_uid')::text, true);
select is(declare_my_conviction('   ')->>'reason', 'details_required', 'the details are required');
select is(declare_my_conviction('Something', current_date + 3)->>'reason', 'conviction_date_in_future',
  'the date is optional but cannot be in the future');
select is((select status::text from staff where id = :'dec'), 'compliant',
  'a refused declaration changes nothing');

set local role authenticated;
create temporary table t_dec on commit drop as
  select declare_my_conviction('Driving while disqualified — Thames Magistrates'' Court, community order',
                               current_date - 14) as r;
reset role;

select is((select r->>'ok' from t_dec), 'true', 'a compliant worker declares through their own session');
select is((select status::text || '/' || block_kind::text || '/' || block_reason from staff where id = :'dec'),
  'blocked/conviction_review/Criminal conviction declared — under review',
  '§10.7 step 2: blocked immediately, with the internal reason word for word');
select is((select status::text from bookings where id = :'bk_conf')
          || '|' || (select status::text from bookings where id = :'bk_inv'),
  'cancelled|cancelled',
  '§10.7 step 3: the future booking is released and the invitation withdrawn');
select is((select source::text || '/' || review_status::text from criminal_declarations
            where staff_id = :'dec' and source = 'in_employment'),
  'in_employment/pending', '§10.7 step 1: an in-employment declaration is added, pending review');
select ok((select payload::text not like '%Thames%' from notification_outbox
            where key = 'E9:declaration:' || (select id from criminal_declarations
                                               where staff_id = :'dec' and source = 'in_employment')),
  '§10.7 step 6: E9 is queued and does not carry the declaration text');
select ok(position('Thames' in staff_documents()::text) = 0,
  '§10.7 step 5: the details are never handed back to the worker''s screen');

select * from finish();
rollback;
