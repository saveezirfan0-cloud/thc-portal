-- =====================================================================
-- 777 · The office can reject a profile selfie
--       20261007110000 · ADR-0097 (§10.1, §10.3 3/11, §2.7)
--
--   A. Shape: a definer with a pinned search_path, not for anon / PUBLIC.
--   B. Rejecting: the photo comes down, the lock goes with it, the wizard's
--      "3/11 done" is cleared and the rest of the progress is untouched, the
--      worker is told (RC5, reason word for word) and the audit row names
--      the manager without the reason. The object is kept (§1.7).
--   C. The worker retakes: staff_set_photo() takes a new one, the wizard
--      confirms it, and a second rejection is a second RC5.
--   D. Refusals: no reason, a blank one, one over 300, no photo, an unknown
--      worker, a worker who has been removed or rejected.
--   E. Nobody but the office: a worker, a client and anon are refused, and a
--      viewer (ADR-0060) is stopped by the read-only trigger with the photo
--      intact. A pending photo change request is left alone by a rejection.
-- =====================================================================
begin;
select plan(33);
\ir _shared/fixtures.psql

\set cand     '77600000-0000-4000-8000-000000000001'
\set gone     '77600000-0000-4000-8000-000000000002'
\set rejected '77600000-0000-4000-8000-000000000003'

-- A candidate in Documents who has done 1–4 and submitted: the case where
-- selfie_at matters. staffa (a working worker) is the other case.
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status, photo_path) values
  (:'cand', 97601, 'Cora', 'Candidate', 'cora@776.test', '+447700976001', date '2002-02-02', 'documents',
   :'cand' || '/selfie-1.jpg'),
  (:'gone', 97602, 'Gus',  'Gone',      'gus@776.test',  '+447700976002', date '1990-03-03', 'inactive',
   :'gone' || '/selfie-1.jpg'),
  (:'rejected', 97603, 'Rae', 'Rejected', 'rae@776.test', '+447700976003', date '1991-04-04', 'rejected',
   :'rejected' || '/selfie-1.jpg');
insert into onboarding_progress (staff_id, rtw_at, address_at, selfie_at, documents_at, updated_at)
values (:'cand', now(), now(), now(), now(), now());
update staff set photo_path = :'staffa' || '/selfie-1.jpg' where id = :'staffa';
insert into storage.objects (bucket_id, name) values
  ('photos', :'cand' || '/selfie-1.jpg'),
  ('photos', :'staffa' || '/selfie-1.jpg');

-- =====================================================================
-- A · Shape
-- =====================================================================
select ok((select p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
             from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'office_reject_selfie'),
  'A: office_reject_selfie is security definer with a pinned search_path');
select ok(not has_function_privilege('anon', 'public.office_reject_selfie(uuid, text)', 'execute')
          and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                           where p.proname = 'office_reject_selfie' and x.grantee = 0 and x.privilege_type = 'EXECUTE'),
  'A: and is executable by neither anon nor PUBLIC');

-- =====================================================================
-- B · Rejecting a candidate's selfie
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(office_reject_selfie(:'cand', '  Face not visible — please retake  ') ->> 'ok', 'true',
  'B: the office rejects the selfie, with a reason');
reset role;

select is((select photo_path from staff where id = :'cand'), null,
  'B: the photo is gone — initials everywhere (§2.7), and photo_path is the §10.1 lock, so the lock is gone');
select is((select selfie_at from onboarding_progress where staff_id = :'cand'), null,
  'B: step 3 is no longer done — the wizard asks for it again');
select ok((select documents_at is not null and rtw_at is not null and address_at is not null
             from onboarding_progress where staff_id = :'cand'),
  'B: and nothing else in their progress moves');
select is((select count(*)::int from storage.objects where bucket_id = 'photos' and name = :'cand' || '/selfie-1.jpg'), 1,
  'B: the object stays — an issued allocation sheet printed it (§1.7)');
select results_eq(
  format($$ select channel::text, template, recipient_staff_id, payload from notification_outbox
             where template = 'RC5' and recipient_staff_id = %L $$, :'cand'),
  $$ select 'push'::text, 'RC5'::text, '77600000-0000-4000-8000-000000000001'::uuid,
            '{"reason": "Face not visible — please retake"}'::jsonb $$,
  'B: RC5 goes to the candidate as a push carrying exactly {reason}, trimmed');
select ok((select key like 'RC5:selfie:' || :'cand' || ':%' from notification_outbox
            where template = 'RC5' and recipient_staff_id = :'cand'),
  'B: keyed RC5:selfie:<staff>:<moment>');
select results_eq(
  format($$ select actor, data from audit_log where action = 'staff.selfie_rejected' and entity_id = %L $$, :'cand'),
  format($$ select %L::uuid, '{}'::jsonb $$, :'admin_uid'),
  'B: the audit row names the manager and carries no reason');

-- =====================================================================
-- C · The worker takes a new one; a second rejection is a second RC5
-- =====================================================================
-- The candidate is exactly where the wizard's unlocked step 3 expects them.
select ok((select s.photo_path is null and p.selfie_at is null
             from staff s join onboarding_progress p on p.staff_id = s.id where s.id = :'cand'),
  'C: the candidate has no photo and no step-3 stamp — SelfieStep draws the camera, not the locked photo');

-- A working worker (no onboarding_progress row to clear) is rejected the same way.
set local role authenticated;
select is(office_reject_selfie(:'staffa', 'Not a photo of you') ->> 'ok', 'true',
  'C: a working worker''s selfie is rejected the same way');
reset role;
select is((select photo_path from staff where id = :'staffa'), null, 'C: and their photo is gone');

-- Through their own session the lock is no longer in the way.
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(format($$ select staff_set_photo(%L) $$, :'staffa' || '/selfie-1.jpg'),
  'C: staff_set_photo() takes a photo again — the lock was photo_path, and it is clear');
select throws_ok(format($$ select staff_set_photo(%L) $$, :'staffa' || '/selfie-1.jpg'),
  'P0001', 'photo_locked', 'C: and it locks again once set');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(format($$ select office_reject_selfie(%L, 'Still not clear') $$, :'staffa'),
  'C: the new photo is rejected too');
reset role;
select is((select count(*)::int from notification_outbox where template = 'RC5' and recipient_staff_id = :'staffa'), 2,
  'C: told again — two RC5 rows, even inside one transaction');

-- =====================================================================
-- D · Refusals
-- =====================================================================
set local role authenticated;
select throws_ok(format($$ select office_reject_selfie(%L, null) $$, :'staffb'),
  '22023', 'reason_required', 'D: a reason is required');
select throws_ok(format($$ select office_reject_selfie(%L, '   ') $$, :'staffb'),
  '22023', 'reason_required', 'D: a blank one is none');
select throws_ok(format($$ select office_reject_selfie(%L, %L) $$, :'staffb', repeat('x', 301)),
  '22023', 'reason_too_long', 'D: and it is at most 300 characters');
select throws_ok(format($$ select office_reject_selfie(%L, 'x') $$, '00000000-0000-4000-8000-00000000dead'),
  'P0002', 'staff_not_found', 'D: an unknown worker');
select throws_ok(format($$ select office_reject_selfie(%L, 'x') $$, :'cand'),
  'P0001', 'no_photo', 'D: a worker with no photo (already rejected) — there is nothing to reject');
select throws_ok(format($$ select office_reject_selfie(%L, 'x') $$, :'gone'),
  'P0001', 'not_active', 'D: a worker who has left');
select throws_ok(format($$ select office_reject_selfie(%L, 'x') $$, :'rejected'),
  'P0001', 'not_active', 'D: a rejected applicant');
reset role;
select is((select photo_path from staff where id = :'gone'), :'gone' || '/selfie-1.jpg',
  'D: and the refused ones keep their photo');
select is((select count(*)::int from notification_outbox where template = 'RC5' and recipient_staff_id in (:'gone', :'rejected', :'staffb')),
  0, 'D: no RC5 for a refused rejection');

-- =====================================================================
-- D2 · A viewer is stopped by the read-only trigger; a pending request is left alone
-- =====================================================================
\set viewer '77600000-0000-4000-8000-0000000000a1'
insert into auth.users (id, email) values (:'viewer', 'viewer.776@rls.test');
insert into profiles (id, role, office_role, full_name) values (:'viewer', 'admin', 'viewer', 'Vera Viewer');
update staff set photo_path = :'staffb' || '/selfie-1.jpg' where id = :'staffb';
insert into profile_change_requests (staff_id, kind, proposed_photo_path)
values (:'staffb', 'photo', :'staffb' || '/selfie-9.jpg');

select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select office_reject_selfie(%L, 'x') $$, :'staffb'),
  '42501', 'read_only', 'D2: a viewer is refused read_only — the function writes, so the ADR-0060 trigger stops it');
reset role;
select is((select photo_path from staff where id = :'staffb'), :'staffb' || '/selfie-1.jpg',
  'D2: and the photo stays');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(format($$ select office_reject_selfie(%L, 'Not clear') $$, :'staffb'), 'D2: the office rejects it');
reset role;
select is((select status::text from profile_change_requests where staff_id = :'staffb' and kind = 'photo'), 'pending',
  'D2: a pending photo change request is not touched — approving it later is an office decision');

-- =====================================================================
-- E · Nobody but the office
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select office_reject_selfie(%L, 'x') $$, :'staffa'),
  '42501', 'not_authorised', 'E staff: a worker cannot reject anyone''s selfie');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select office_reject_selfie(%L, 'x') $$, :'staffa'),
  '42501', 'not_authorised', 'E client: nor a client');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok(format($$ select office_reject_selfie(%L, 'x') $$, :'staffa'),
  '42501', null, 'E anon: nor anon — no execute privilege at all');
reset role;

select * from finish();
rollback;
