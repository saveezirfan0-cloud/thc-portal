-- =====================================================================
-- 802 · a staff row is created, linked and removed only through its RPCs
--       20261012121600 · §1.7, §2.1, §2.7
--
-- admin_all let a Back Office session mark a worker removed without the
-- GDPR scrub, re-point their login, insert a person who never applied, or
-- hard-delete one. Each is now 42501 from an API session; remove_worker()
-- and the service role are unaffected.
-- =====================================================================
begin;
select plan(13);
\ir _shared/fixtures.psql

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ update staff set removed_at = now() where id = %L $$, :'staffa'),
  '42501', 'staff_removal_rpc_only', 'an admin cannot mark a worker removed without remove_worker()');
select throws_ok(format($$ update staff set user_id = %L where id = %L $$, :'admin_uid', :'staffa'),
  '42501', 'staff_login_rpc_only', 'nor point a worker''s record at another login');
select throws_ok(format($$ update staff set user_id = null where id = %L $$, :'staffa'),
  '42501', 'staff_login_rpc_only', 'nor unlink it');
select throws_ok(format($$ insert into staff (id, first_name, last_name, email, phone, dob, status)
                           values (%L, 'Never', 'Applied', 'never802@rls.test', '+447700980299', date '1990-01-01', 'interview_requested') $$, :'new_id'),
  '42501', 'staff_insert_rpc_only', 'nor insert a person who never applied');
select throws_ok(format($$ delete from staff where id = %L $$, :'staffb'),
  '42501', 'staff_delete_refused', 'nor hard-delete a worker (§1.7 anonymises, it never deletes)');
select lives_ok(format($$ update staff set first_name = 'Stafford' where id = %L $$, :'staffa'),
  'ordinary profile fields stay the office''s to correct');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
with u as (update staff set removed_at = now() where id = :'staffa' returning 1)
select is((select count(*)::int from u), 0, 'a worker has no write policy on their own row at all');
reset role;

select is((select removed_at from staff where id = :'staffa'), null::timestamptz, 'nothing was removed');
select is((select count(*)::int from staff where id = :'staffb'), 1, 'nothing was deleted');

-- The real doors.
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
select lives_ok(format($$ select remove_worker(%L, now(), %L) $$, :'staffa', :'admin_uid'),
  'remove_worker() still removes (service role)');
reset role;
select results_eq(format($$ select removed_at is not null, user_id, first_name from staff where id = %L $$, :'staffa'),
  $$ values (true, null::uuid, 'Deleted'::text) $$, 'with its scrub: removed, unlinked, anonymised');

select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
select lives_ok($$ select submit_application('Ada', 'Applicant', 'ada802@rls.test', '+447700980201', date '1995-01-01', true) $$,
  '/apply''s submit_application() still creates the candidate');
reset role;
select is((select status::text from staff where email = 'ada802@rls.test'), 'interview_requested', 'at interview_requested');

select * from finish();
rollback;
