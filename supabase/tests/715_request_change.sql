-- =====================================================================
-- 715 · Request a change — the worker's RPCs (ADR-0044, docs/19 §3)
--   request_profile_change · withdraw_profile_change ·
--   my_profile_change_requests · 20260930202200
--
--   A. Shape: definer, search_path pinned, not anon/PUBLIC; the list
--      never returns decided_by.
--   B. Every refusal by name: bad_kind, first/last_required, unchanged
--      (the name on file, the photo on file), evidence_required, evidence
--      outside the worker's folder (invalid_path), evidence not uploaded
--      (file_not_found), a foreign photo path (wrong_path), a photo not
--      uploaded (file_not_found), note_too_long.
--   C. A name request: saved pending, staff untouched, RC1 queued to
--      admin@ only with exactly the template's placeholders, `—` for a
--      blank note. A second pending name request is refused.
--   D. A photo request, alongside the pending name one.
--   E. Withdraw: own pending only; not_pending once decided; ask again.
--   F. The wall between workers; a leaver and a removed worker.
--   G. (20260930205100, security review #1) The RC1 flood: request →
--      withdraw looped four times — the fourth request is refused
--      too_many_requests and at most three RC1s are queued. The ceiling
--      is per kind and rolling: a request older than 24 hours does not
--      count, and the other kind is not affected.
-- =====================================================================
begin;
select plan(54);
\ir _shared/fixtures.psql

\set pcr_b '66500000-0000-4000-8000-0000000000b1'

-- What Storage holds. The evidence and the new selfie are Staff Alpha's
-- own uploads; one object sits in Staff Bravo's folder.
insert into storage.objects (bucket_id, name, metadata) values
  ('documents', :'staffa' || '/change-requests/ev-1.pdf', '{"mimetype":"application/pdf","size":2048}'),
  ('documents', :'staffb' || '/change-requests/ev-b.pdf', '{"mimetype":"application/pdf","size":2048}'),
  ('photos',    :'staffa' || '/selfie-old.jpg',            '{"mimetype":"image/jpeg","size":40000}'),
  ('photos',    :'staffa' || '/selfie-new.jpg',            '{"mimetype":"image/jpeg","size":40000}'),
  ('photos',    :'staffb' || '/selfie-b.jpg',              '{"mimetype":"image/jpeg","size":40000}');
update staff set photo_path = :'staffa' || '/selfie-old.jpg' where id = :'staffa';

-- Staff Bravo's own pending photo request.
insert into profile_change_requests (id, staff_id, kind, proposed_photo_path)
values (:'pcr_b', :'staffb', 'photo', :'staffb' || '/selfie-b.jpg');

-- =====================================================================
-- A · Shape
-- =====================================================================
select ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=public, extensions'])
     from pg_proc p
    where p.oid in ('public.request_profile_change(text, text, text, text, text, text)'::regprocedure,
                    'public.withdraw_profile_change(uuid)'::regprocedure,
                    'public.my_profile_change_requests()'::regprocedure)),
  'A: all three are security definer with search_path pinned');
select ok(
  not has_function_privilege('anon', 'public.request_profile_change(text, text, text, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.withdraw_profile_change(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.my_profile_change_requests()', 'execute')
  and not has_function_privilege('public', 'public.request_profile_change(text, text, text, text, text, text)', 'execute'),
  'A: anon and PUBLIC cannot call them');
select ok(
  has_function_privilege('authenticated', 'public.request_profile_change(text, text, text, text, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.withdraw_profile_change(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.my_profile_change_requests()', 'execute'),
  'A: a signed-in worker can');
select unalike(
  pg_get_function_result('public.my_profile_change_requests()'::regprocedure),
  '%decided_by%', 'A: the worker''s list never returns decided_by');
select unalike(
  pg_get_function_result('public.my_profile_change_requests()'::regprocedure),
  '%previous_value%', 'A: nor the office''s snapshot');

select count(*)::int as outbox_before from notification_outbox where template = 'RC1' \gset

-- =====================================================================
-- B · Refusals (Staff Alpha)
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok($$ select request_profile_change('email', 'A', 'B') $$,
  'P0001', 'bad_kind', 'B: only name or photo');
select throws_ok($$ select request_profile_change('name', '  ', 'Alpha', null, 'x') $$,
  'P0001', 'first_required', 'B: a blank first name');
select throws_ok($$ select request_profile_change('name', 'Staff', '', null, 'x') $$,
  'P0001', 'last_required', 'B: a blank last name');
select throws_ok(
  format($$ select request_profile_change('name', ' Staff ', 'Alpha', null, %L) $$,
         :'staffa' || '/change-requests/ev-1.pdf'),
  'P0001', 'unchanged', 'B: the name already on file, after trimming');
select throws_ok($$ select request_profile_change('name', 'Stafford', 'Alpha') $$,
  'P0001', 'evidence_required', 'B: a name change needs evidence (Q13)');
select throws_ok(
  format($$ select request_profile_change('name', 'Stafford', 'Alpha', null, %L) $$,
         :'staffb' || '/change-requests/ev-b.pdf'),
  'P0001', 'invalid_path', 'B: evidence in another worker''s folder is refused');
select throws_ok(
  format($$ select request_profile_change('name', 'Stafford', 'Alpha', null, %L) $$,
         :'staffa' || '/change-requests/never-uploaded.pdf'),
  'P0001', 'file_not_found', 'B: evidence that was never uploaded is refused');
select throws_ok(
  format($$ select request_profile_change('name', 'Stafford', 'Alpha', null, %L, repeat('x', 501)) $$,
         :'staffa' || '/change-requests/ev-1.pdf'),
  'P0001', 'note_too_long', 'B: a note over 500 characters');
select throws_ok($$ select request_profile_change('photo') $$,
  'P0001', 'photo_required', 'B: a photo request needs the photo');
select throws_ok(
  format($$ select request_profile_change('photo', null, null, %L) $$, :'staffb' || '/selfie-b.jpg'),
  'P0001', 'wrong_path', 'B: another worker''s selfie is refused');
select throws_ok(
  format($$ select request_profile_change('photo', null, null, %L) $$, :'staffa' || '/../x.jpg'),
  'P0001', 'wrong_path', 'B: a path climbing out of the folder is refused');
select throws_ok(
  format($$ select request_profile_change('photo', null, null, %L) $$, :'staffa' || '/nothing-here.jpg'),
  'P0001', 'file_not_found', 'B: a photo that was never uploaded is refused');
select throws_ok(
  format($$ select request_profile_change('photo', null, null, %L) $$, :'staffa' || '/selfie-old.jpg'),
  'P0001', 'unchanged', 'B: the photo already on file is refused');

-- =====================================================================
-- C · A name request
-- =====================================================================
select request_profile_change('name', ' Stafford ', 'Alpha-Smith', null,
                              :'staffa' || '/change-requests/ev-1.pdf', '   ') ->> 'id' as pcr_name \gset

select results_eq(
  format($$ select kind, status, proposed_first_name, proposed_last_name, worker_note
              from my_profile_change_requests() where id = %L $$, :'pcr_name'),
  $$ values ('name'::text, 'pending'::text, 'Stafford'::text, 'Alpha-Smith'::text, null::text) $$,
  'C: saved pending, trimmed, a blank note stored as none');

select throws_ok(
  format($$ select request_profile_change('name', 'Staff', 'Alpha-Jones', null, %L) $$,
         :'staffa' || '/change-requests/ev-1.pdf'),
  'P0001', 'already_pending', 'C: a second pending name request is refused');

reset role;
select results_eq(
  format($$ select first_name, last_name from staff where id = %L $$, :'staffa'),
  $$ values ('Staff'::text, 'Alpha'::text) $$,
  'C: the name on file is untouched — the lock holds until the office decides');

select results_eq(
  format($$ select channel::text, recipient_emails, recipient_staff_id from notification_outbox
             where key = 'RC1:request:' || %L $$, :'pcr_name'),
  $$ values ('email'::text, array['admin@thehospitalitycompany.co.uk']::text[], null::uuid) $$,
  'C: RC1 queued once, keyed RC1:request:<id>, an email to admin@ only');

select bag_eq(
  format($$ select jsonb_object_keys(payload) from notification_outbox where key = 'RC1:request:' || %L $$,
         :'pcr_name'),
  $$ values ('name'), ('employeeId'), ('change'), ('requestedAt'), ('current'), ('proposed'), ('note') $$,
  'C: RC1''s payload keys are exactly the template''s placeholders');

select results_eq(
  format($$ select payload ->> 'name', payload ->> 'employeeId', payload ->> 'change',
                   payload ->> 'current', payload ->> 'proposed', payload ->> 'note'
              from notification_outbox where key = 'RC1:request:' || %L $$, :'pcr_name'),
  $$ values ('Staff Alpha'::text, '90001'::text, 'name'::text, 'Staff Alpha'::text,
             'Stafford Alpha-Smith'::text, '—'::text) $$,
  'C: who, what, now → requested, and — for the blank note');

select matches(
  (select payload ->> 'requestedAt' from notification_outbox where key = 'RC1:request:' || :'pcr_name'),
  '^\d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}$',
  'C: requestedAt is a UK wall-clock stamp (the template says "(UK time)")');

-- =====================================================================
-- D · A photo request, alongside
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select request_profile_change('photo', null, null, :'staffa' || '/selfie-new.jpg', null, 'New haircut') ->> 'id'
  as pcr_photo \gset
select is(
  (select count(*)::int from my_profile_change_requests() where status = 'pending'),
  2, 'D: one pending per KIND — a name and a photo may wait together');
reset role;
select results_eq(
  format($$ select payload ->> 'change', payload ->> 'current', payload ->> 'note'
              from notification_outbox where key = 'RC1:request:' || %L $$, :'pcr_photo'),
  $$ values ('photo'::text, 'The current profile photo'::text, 'New haircut'::text) $$,
  'D: RC1 for a photo names the change and carries the note');
select is((select photo_path from staff where id = :'staffa'), :'staffa' || '/selfie-old.jpg',
  'D: the current photo stays until the office approves');

-- =====================================================================
-- E · Withdraw
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select withdraw_profile_change(%L) $$, :'pcr_b'),
  'P0001', 'not_found', 'E: another worker''s request cannot be withdrawn');
select is((withdraw_profile_change(:'pcr_name') ->> 'ok')::boolean, true,
  'E: the worker withdraws their own pending request');
select results_eq(
  format($$ select status, decided_at is not null from my_profile_change_requests() where id = %L $$, :'pcr_name'),
  $$ values ('withdrawn'::text, true) $$,
  'E: it is withdrawn, stamped by the state guard');
select throws_ok(format($$ select withdraw_profile_change(%L) $$, :'pcr_name'),
  'P0001', 'not_pending', 'E: a second withdraw is refused');
select lives_ok(
  format($$ select request_profile_change('name', 'Stafford', 'Alpha', null, %L) $$,
         :'staffa' || '/change-requests/ev-1.pdf'),
  'E: and they can ask again');
reset role;
select is((select decided_by from profile_change_requests where id = :'pcr_name'), null::uuid,
  'E: a withdrawal has no decider');

update profile_change_requests set status = 'rejected', decision_reason = 'Photo too dark — please retake.'
 where id = :'pcr_photo';
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select withdraw_profile_change(%L) $$, :'pcr_photo'),
  'P0001', 'not_pending', 'E: a decided request cannot be withdrawn');
select is(
  (select decision_reason from my_profile_change_requests() where id = :'pcr_photo'),
  'Photo too dark — please retake.', 'E: the office''s reason reaches the worker (shown as written)');

-- =====================================================================
-- F · The wall, leavers, removed
-- =====================================================================
select is((select count(*)::int from my_profile_change_requests() where id = :'pcr_b'), 0,
  'F: Staff Bravo''s request is not in Staff Alpha''s list');
select is((select count(*)::int from profile_change_requests), 0,
  'F: the staff role reads no rows directly, not even its own');
select throws_ok(
  format($$ insert into profile_change_requests (staff_id, kind, proposed_photo_path)
            values (%L, 'photo', %L) $$, :'staffa', :'staffa' || '/selfie-new.jpg'),
  '42501', null, 'F: nor inserts directly — no RC1 without the RPC');

reset role;
update staff set status = 'inactive', left_at = now() where id = :'staffa';
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select request_profile_change('photo', null, null, %L) $$, :'staffa' || '/selfie-new.jpg'),
  'P0001', 'not_editable', 'F: a leaver cannot ask for a change');
select isnt_empty($$ select 1 from my_profile_change_requests() $$,
  'F: but can still read what they asked');

reset role;
update staff set status = 'removed' where id = :'staffa';
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select * from my_profile_change_requests() $$,
  'P0001', 'account_closed', 'F: a removed worker is refused');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select throws_ok($$ select request_profile_change('photo', null, null, 'x/y.jpg') $$,
  'P0001', 'unknown_staff', 'F: admin has no staff row — the office decides on its own screen');

reset role;
select is(
  (select count(*)::int from notification_outbox where template = 'RC1'), :outbox_before + 3,
  'F: three requests made, three RC1s — none for any refusal');

-- =====================================================================
-- G · The RC1 flood (Staff Bravo, compliant, with a pending PHOTO request)
-- =====================================================================
reset role;
select count(*)::int as rc1_before from notification_outbox where template = 'RC1' \gset
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select request_profile_change('name', 'Stafford', 'Bravo', null,
                              :'staffb' || '/change-requests/ev-b.pdf') ->> 'id' as g1 \gset
select is((withdraw_profile_change(:'g1') ->> 'ok')::boolean, true, 'G: request 1, withdrawn');
select request_profile_change('name', 'Stafford', 'Bravo', null,
                              :'staffb' || '/change-requests/ev-b.pdf') ->> 'id' as g2 \gset
select is((withdraw_profile_change(:'g2') ->> 'ok')::boolean, true, 'G: request 2, withdrawn');
select request_profile_change('name', 'Stafford', 'Bravo', null,
                              :'staffb' || '/change-requests/ev-b.pdf') ->> 'id' as g3 \gset
select is((withdraw_profile_change(:'g3') ->> 'ok')::boolean, true, 'G: request 3, withdrawn');
select throws_ok(
  format($$ select request_profile_change('name', 'Stafford', 'Bravo', null, %L) $$,
         :'staffb' || '/change-requests/ev-b.pdf'),
  'P0001', 'too_many_requests', 'G: the fourth name request in 24 hours is refused');

reset role;
select is(
  (select count(*)::int from notification_outbox where template = 'RC1'), :rc1_before + 3,
  'G: three RC1s queued for four attempts — the refusal emailed nobody');
select is(
  (select count(*)::int from profile_change_requests where staff_id = :'staffb' and kind = 'name'), 3,
  'G: and wrote no fourth request');

-- Withdrawn requests still count: each one's RC1 email already went.
select is(
  (select count(*)::int from profile_change_requests
    where staff_id = :'staffb' and kind = 'name' and status = 'withdrawn'), 3,
  'G: (all three were withdrawn, and still counted)');

-- Per kind: the photo request is its own count. Withdraw Bravo's pending
-- one (inserted above) and ask again — one photo request in 24 hours.
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((withdraw_profile_change(:'pcr_b') ->> 'ok')::boolean, true, 'G: Bravo withdraws the photo request');
select lives_ok(
  format($$ select request_profile_change('photo', null, null, %L) $$, :'staffb' || '/selfie-b.jpg'),
  'G: a photo request is not held back by the name ceiling');

-- Rolling, not per calendar day: age the oldest name request past 24
-- hours (the state guard fixes created_at, so as the table owner with
-- the trigger set aside) and the fourth goes through.
reset role;
alter table profile_change_requests disable trigger profile_change_requests_state_guard;
update profile_change_requests set created_at = now() - interval '25 hours' where id = :'g1';
alter table profile_change_requests enable trigger profile_change_requests_state_guard;
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(
  format($$ select request_profile_change('name', 'Stafford', 'Bravo', null, %L) $$,
         :'staffb' || '/change-requests/ev-b.pdf'),
  'G: once one of the three is older than 24 hours, the worker can ask again');

reset role;
select * from finish();
rollback;
