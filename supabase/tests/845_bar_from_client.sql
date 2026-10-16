-- =====================================================================
-- 845 · Bar a worker from a client they have no entry at
--       20261015150000 · ADR-0146 · §9.6
--
-- bar_from_client() bars in one step. With no entry at the client it
-- writes ONE bar-only row that gates and never qualifies; lifting the bar
-- deletes it; "+ Add" over it turns it into a real entry, still barred.
-- =====================================================================
begin;
select plan(25);
\ir _shared/fixtures.psql

-- Staff A has an entry at Client A (qual_a) and none at Client B.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(format($$ select bar_from_client(%L, %L, '  ') $$, :'staffa', :'clientb'),
  '23514', null, 'a bar needs a reason — it is shown on the client''s events');

select lives_ok(format($$ select bar_from_client(%L, %L, 'Client asked: not to return') $$, :'staffa', :'clientb'),
  'an office login bars a worker from a client they have never been cleared at');
reset role;

select is((select count(*)::int from client_qualifications
            where staff_id = :'staffa' and client_id = :'clientb'), 1,
  'one row carries the bar');
select ok((select bar_only and do_not_return from client_qualifications
            where staff_id = :'staffa' and client_id = :'clientb'),
  'it is bar-only, and barred');
select is((select note from client_qualifications
            where staff_id = :'staffa' and client_id = :'clientb'), 'Client asked: not to return',
  'with the reason as its note');
select is((select gate from auto_assign_worker_gate(:'shift_b', :'staffa')), 'do_not_return',
  'the auto-assign gate refuses her on Client B''s shift');
select is((select qualified from auto_assign_worker_gate(:'shift_b', :'staffa')), false,
  'and the row does not put her in Wave 1');
select is((select bar_only from staff_client_qualifications_v
            where staff_id = :'staffa' and client_id = :'clientb'), true,
  'the profile list marks it bar-only');
select is((select bar_only from clients_qualified_staff_v
            where staff_id = :'staffa' and client_id = :'clientb'), true,
  'and so does the client card');
select is((select data ->> 'reason' from audit_log
            where action = 'do_not_return_on'
              and data ->> 'staffId' = :'staffa' and data ->> 'clientId' = :'clientb'),
  'Client asked: not to return', 'audited as a Do-not-return switch-on, with the reason');

-- A second bar is not a second row.
set local role authenticated;
select lives_ok(format($$ select bar_from_client(%L, %L, 'Still barred') $$, :'staffa', :'clientb'),
  'barring again is accepted');
reset role;
select is((select count(*)::int from client_qualifications
            where staff_id = :'staffa' and client_id = :'clientb'), 1,
  'and still one row');

-- Remove refuses it, like any barred row.
select throws_like(format($$ select revoke_client_qualification(%L) $$,
         (select id from client_qualifications where staff_id = :'staffa' and client_id = :'clientb')),
  '%Switch Do not return off%', 'Remove refuses a bar-only row');

-- Lifting the bar deletes the row: she is back to uncleared, not cleared.
select id as bar_row from client_qualifications
 where staff_id = :'staffa' and client_id = :'clientb' \gset
set local role authenticated;
select lives_ok(format($$ select set_do_not_return(%L, false) $$, :'bar_row'),
  'the switch lifts it');
reset role;
select is((select count(*)::int from client_qualifications
            where staff_id = :'staffa' and client_id = :'clientb'), 0,
  'and the bar-only row is gone — lifting a bar does not clear anyone for the client');

-- Where she has entries, the bar goes on them; no extra row.
set local role authenticated;
select lives_ok(format($$ select bar_from_client(%L, %L, 'Complaint 15.10') $$, :'staffa', :'clienta'),
  'barring at a client she is cleared at');
reset role;
select is((select count(*)::int from client_qualifications
            where staff_id = :'staffa' and client_id = :'clienta'), 1,
  'uses her existing entry');
select ok((select do_not_return and not bar_only from client_qualifications where id = :'qual_a'),
  'which is barred and stays a real entry');
set local role authenticated;
select set_do_not_return(:'qual_a', false);
reset role;
select is((select count(*)::int from client_qualifications where id = :'qual_a' and not do_not_return), 1,
  'and lifting it keeps the entry — only bar-only rows go with the bar');

-- "+ Add" over a bar-only row: the row becomes the entry, still barred.
set local role authenticated;
select bar_from_client(:'staffa', :'clientb', 'Kept away');
select lives_ok(format($$ select grant_client_qualification(%L, %L, %L, 'Cleared on site') $$,
         :'staffa', :'clientb', :'role_id'),
  'a manual grant at the client she is barred from');
reset role;
select ok((select do_not_return and not bar_only and note = 'Kept away' and granted_by = :'admin_uid'::uuid
             from client_qualifications where staff_id = :'staffa' and client_id = :'clientb'),
  'turns the bar-only row into the entry — still barred, reason kept: "+ Add" never lifts a bar');

-- Nobody but the office.
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select bar_from_client(%L, %L, 'x') $$, :'staffa', :'clienta'),
  '42501', 'not_authorised', 'a worker cannot bar anybody');
reset role;
select ok(not has_function_privilege('anon', 'public.bar_from_client(uuid, uuid, text)', 'execute'),
  'anon cannot execute it');
select is((select prosecdef from pg_proc where oid = 'public.bar_from_client(uuid, uuid, text)'::regprocedure), true,
  'it is SECURITY DEFINER — it writes audit_log');
select throws_ok($$ insert into client_qualifications (client_id, role_id, staff_id, bar_only)
                    values ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001',
                            'dddddddd-0000-4000-8000-000000000002', true) $$,
  '23514', null, 'a bar-only row that is not barred is refused by the table');

select * from finish();
rollback;
