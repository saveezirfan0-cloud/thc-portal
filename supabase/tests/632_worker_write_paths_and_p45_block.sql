-- =====================================================================
-- 632 · Worker write paths behind their RPCs, and a manual block that
--       Request my P45 cannot erase (audit D51, D52)
--   20260929140200_worker_write_paths_and_p45_block.sql
-- =====================================================================
begin;
select plan(20);
\ir _shared/fixtures.psql

-- ---------------------------------------------------------------------
-- 1. D51 · §10.1 lock case 2: "Only a manager pressing Unblock lifts it."
-- ---------------------------------------------------------------------
select block_worker_manually(:'staffa', 'Repeated lateness — see notes', now(), :'admin_uid');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select request_my_p45('Leaving') $$, 'P0001', 'blocked_manual',
  '§10.6/§10.1 a manually blocked worker cannot leave their way out of the block through the API');
reset role;
select is((select status::text || '/' || block_kind::text || '/' || block_reason from staff where id = :'staffa'),
  'blocked/manual/Repeated lateness — see notes',
  'the block, its kind and the manager''s reason all stand');
select is_empty($$ select 1 from notification_outbox where template = 'E8' and key like 'E8:staff:' || 'dddddddd-0000-4000-8000-000000000001' || ':%' $$,
  'and no E8 went to the office');
select throws_ok(format($$ select request_p45(%L, null, now()) $$, :'staffa'), 'P0001', 'blocked_manual',
  'the service-role entry point refuses the same');

-- An automatic block is the worker's to fix or to walk away from. (A
-- date past the fixture's open check-in, so `on_shift` does not answer
-- first.)
update staff set status = 'blocked', block_kind = 'auto_document', block_reason = null where id = :'staffb';
select lives_ok(format($$ select request_p45(%L, 'Moving away', now() + interval '60 days') $$, :'staffb'),
  'a worker on an automatic document block may still request their P45');
select is((select status::text from staff where id = :'staffb'), 'inactive', 'and leaves');

-- ---------------------------------------------------------------------
-- 2. D52 · no direct worker writes on staff_references / push_subscriptions
-- ---------------------------------------------------------------------
select is_empty(
  $$ select p.polname from pg_policy p
      where p.polrelid = 'public.staff_references'::regclass
        and p.polname like 'staff\_self%' and p.polcmd <> 'r' $$,
  'staff_references: the worker holds a SELECT policy only (writes via onboarding_save_references)');
select is_empty(
  $$ select p.polname from pg_policy p
      where p.polrelid = 'public.push_subscriptions'::regclass
        and p.polname like 'staff\_self%' and p.polcmd <> 'r' $$,
  'push_subscriptions: the worker holds a SELECT policy only (writes via save/forget_push_subscription)');
select is(
  (select count(*)::int from pg_policy p
    where p.polrelid = 'public.push_subscriptions'::regclass and p.polname = 'staff_self_push' and p.polcmd = 'r'), 1,
  'and still reads their own devices');

-- ---------------------------------------------------------------------
-- 3. D52 · staff_set_photo takes exactly <own id>/<name>.jpg, and only a
--    real object
-- ---------------------------------------------------------------------
\set me   'd6320000-0000-4000-8000-000000000001'
\set me_uid 'd6320000-0000-4000-8000-0000000000aa'
insert into auth.users (id, email) values (:'me_uid', 'photo.me@rls.test');
insert into profiles (id, role, full_name) values (:'me_uid', 'staff', 'Photo Me');
insert into staff (id, user_id, first_name, last_name, email, phone, dob, status)
values (:'me', :'me_uid', 'Photo', 'Me', 'photo.me@rls.test', '+447700906321', date '1995-01-01', 'documents');

select set_config('request.jwt.claims', json_build_object('sub', :'me_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into storage.objects (bucket_id, name) values
  ('photos', :'me' || '/selfie-1.png'),
  ('photos', :'me' || '/nested/selfie-1.jpg'),
  ('photos', :'me' || '/selfie-2.jpg');

select throws_ok(format($$ select staff_set_photo(%L) $$, :'me' || '/selfie-1.png'), 'P0001', 'wrong_path',
  'a file that is not a .jpg is refused');
select throws_ok(format($$ select staff_set_photo(%L) $$, :'me' || '/nested/selfie-1.jpg'), 'P0001', 'wrong_path',
  'a path more than one level under the worker''s folder is refused');
select throws_ok(format($$ select staff_set_photo(%L) $$, :'me' || '/../' || :'staffb' || '/selfie.jpg'), 'P0001', 'wrong_path',
  'a path that climbs out of the worker''s folder is refused, though it starts with their id');
select throws_ok(format($$ select staff_set_photo(%L) $$, :'me' || '/selfie-9.jpg'), 'P0001', 'wrong_path',
  'a well-formed path to nothing is refused: no avatar is locked without a picture behind it');
select throws_ok(format($$ select staff_set_photo(%L) $$, 'x' || :'me' || '/selfie-2.jpg'), 'P0001', 'wrong_path',
  'the id must be the whole first segment');
select is((select photo_path from staff where id = :'me'), null, 'none of those set a photo');
select lives_ok(format($$ select staff_set_photo(%L) $$, :'me' || '/selfie-2.jpg'),
  'the exact <own id>/<name>.jpg of an uploaded object is accepted');
select is((select photo_path from staff where id = :'me'), :'me' || '/selfie-2.jpg', 'and becomes the avatar');

-- ---------------------------------------------------------------------
-- 4. D52 · one E5 per bank save, even two in one second
-- ---------------------------------------------------------------------
select lives_ok($$ select staff_save_bank('P Me', '40-47-84', '12345678') $$, 'first save');
select lives_ok($$ select staff_save_bank('P Me', '40-47-85', '12345678') $$, 'second save, same transaction');
reset role;
select is((select count(*)::int from notification_outbox
            where template = 'E5' and key like 'E5:staff:' || 'd6320000-0000-4000-8000-000000000001' || ':%'), 2,
  '§2.10 both saves queued their own E5: the key carries microseconds, so the second is not swallowed by on conflict');

select * from finish();
rollback;
