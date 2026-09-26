-- =====================================================================
-- 730 · Refer a friend — the worker's code and count (ADR-0046, docs/19 §5)
--   my_referral_code · my_referral_summary · 20260930202300
--
--   A. Shape: definer, search_path pinned, not anon/PUBLIC; the tables
--      still carry admin_read only.
--   B. Minted once and stable: the right alphabet, one row, the same code
--      on every call; a different worker gets a different code.
--   C. Compliant only: a leaver is refused and nothing is minted; a
--      revoked code is never reissued; a removed worker is refused.
--   D. The summary is a count: {code, applied} and nothing else — no
--      names, no outcomes (Q20) — and it mints nothing.
--   E. The staff role reads and writes neither table directly.
-- =====================================================================
begin;
select plan(22);
\ir _shared/fixtures.psql

\set app_b '68000000-0000-4000-8000-0000000000b1'
\set app_c '68000000-0000-4000-8000-0000000000c1'

-- =====================================================================
-- A · Shape
-- =====================================================================
select ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=public, extensions'])
     from pg_proc p
    where p.oid in ('public.my_referral_code()'::regprocedure,
                    'public.my_referral_summary()'::regprocedure)),
  'A: both are security definer with search_path pinned');
select ok(
  not has_function_privilege('anon', 'public.my_referral_code()', 'execute')
  and not has_function_privilege('anon', 'public.my_referral_summary()', 'execute')
  and not has_function_privilege('public', 'public.my_referral_code()', 'execute'),
  'A: anon and PUBLIC cannot call them');
select ok(
  has_function_privilege('authenticated', 'public.my_referral_code()', 'execute')
  and has_function_privilege('authenticated', 'public.my_referral_summary()', 'execute'),
  'A: a signed-in worker can');
select is_empty(
  $$ select c.relname, p.polname from pg_policy p join pg_class c on c.oid = p.polrelid
      where c.relname in ('staff_referral_codes', 'application_referrals')
        and p.polname <> 'admin_read' $$,
  'A: both tables carry admin_read only — no staff or client policy');

-- =====================================================================
-- B · Minted once, stable
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(my_referral_summary(), '{"code": null, "applied": 0}'::jsonb,
  'B: before the first visit there is no code, and the summary mints none');

select my_referral_code() as code_a \gset
select matches(:'code_a'::text, '^[A-HJ-NP-Z2-9]{8}$', 'B: eight characters, no I, O, 0 or 1');
select is(my_referral_code(), :'code_a'::text, 'B: the same code on the second call');
select is(my_referral_code(), :'code_a'::text, 'B: and the third');

select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
select my_referral_code() as code_b \gset
select isnt(:'code_b'::text, :'code_a'::text, 'B: another worker gets another code');

reset role;
select is((select count(*)::int from staff_referral_codes where staff_id = :'staffa'), 1,
  'B: one row per worker, however often they open the screen');

-- =====================================================================
-- D · The summary is a count
-- =====================================================================
-- Two applications arrived with Staff Alpha's code (Agent D records
-- them; written here as the owner).
insert into applications (id, first_name, last_name, email, phone, dob, age_band, outcome, staff_id, consented_at) values
  (:'app_b', 'Staff', 'Bravo', 'staffb@rls.test', '+447700900012', date '1994-02-02', '31_40', 'returning_applicant', :'staffb', now());
insert into application_referrals (application_id, referrer_staff_id, candidate_staff_id, code) values
  (:'app_b', :'staffa', :'staffb', :'code_a');
-- …and one arrived with Bravo's, which is not Alpha's to see.
insert into application_referrals (application_id, referrer_staff_id, candidate_staff_id, code) values
  (:'applic_a', :'staffb', :'staffa', :'code_b');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(my_referral_summary(), jsonb_build_object('code', :'code_a', 'applied', 1),
  'D: {code, applied} — Alpha''s own count only');
select bag_eq($$ select jsonb_object_keys(my_referral_summary()) $$,
  $$ values ('code'), ('applied') $$,
  'D: and nothing else — no names, no outcomes (Q20)');

-- =====================================================================
-- E · No direct access
-- =====================================================================
select is((select count(*)::int from staff_referral_codes), 0,
  'E: the staff role reads no code rows directly, not even its own');
select is((select count(*)::int from application_referrals), 0,
  'E: nor any referral row');
select throws_ok(
  format($$ insert into staff_referral_codes (staff_id, code) values (%L, 'ZZZZZZZZ') $$, :'staffa'),
  '42501', null, 'E: nor mints a code of its choosing');

-- =====================================================================
-- C · Compliant only; revoked; removed
-- =====================================================================
reset role;
update staff set status = 'inactive', left_at = now() where id = :'staffb';
delete from staff_referral_codes where staff_id = :'staffb';
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select my_referral_code() $$,
  'P0001', 'not_compliant', 'C: a leaver is not given a code');
reset role;
select is((select count(*)::int from staff_referral_codes where staff_id = :'staffb'), 0,
  'C: and none was minted');
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((my_referral_summary() ->> 'applied')::int, 1,
  'C: a leaver can still see their count');

reset role;
update staff_referral_codes set revoked_at = now() where staff_id = :'staffa';
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select my_referral_code() $$,
  'P0001', 'code_revoked', 'C: a revoked code is never reissued');
select is(my_referral_summary() -> 'code', 'null'::jsonb,
  'C: and the summary stops showing it');

reset role;
update staff set status = 'removed' where id = :'staffa';
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select my_referral_summary() $$,
  'P0001', 'account_closed', 'C: a removed worker is refused');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select throws_ok($$ select my_referral_code() $$,
  'P0001', 'unknown_staff', 'C: a client has no code');

reset role;
select * from finish();
rollback;
