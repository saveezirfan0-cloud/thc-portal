-- =====================================================================
-- 792 · three Client Portal gaps closed
--       20261012120600 · §9.10, §11.1, ADR-0004, ADR-0026
--
--   1 · a client's feedback comment is at most 2,000 characters
--       (submit_client_feedback and a CHECK on client rows);
--   2 · a client login cannot rename itself through update_my_profile();
--   3 · contract_versions is read by staff (and the office), not clients.
-- =====================================================================
begin;
select plan(13);
\ir _shared/fixtures.psql

-- The fixture's own client entry would make a second one a duplicate, and
-- the event must have started for feedback to open.
delete from feedback where id = :'feedback_a';
update shift_requirements set starts_at = now() - interval '9 hours', ends_at = now() - interval '1 hour'
 where id = :'shift_a';

-- =====================================================================
-- 1 · feedback text
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select submit_client_feedback(%L, 5, %L) $$, :'booking_a', repeat('a', 2001)),
  '22023', 'Feedback text must be at most 2000 characters',
  'a 2,001-character comment is refused, with the sentence apps/client maps');
select lives_ok(format($$ select submit_client_feedback(%L, 5, %L) $$, :'booking_a', '  ' || repeat('a', 2000) || '  '),
  '2,000 characters (after the trim) is accepted');
reset role;
select is((select char_length(text) from feedback
            where author_kind = 'client' and event_id = :'event_a' and staff_id = :'staffa'), 2000,
  'and stored trimmed');

select throws_ok(format($$ insert into feedback (author_kind, author_id, staff_id, event_id, rating, text)
                           values ('client', %L, %L, %L, 4, %L) $$, :'clientb_uid', :'staffb', :'event_b', repeat('b', 2001)),
  '23514', null, 'the table holds the same line for any client row, whatever wrote it');
select lives_ok(format($$ insert into feedback (author_kind, author_id, staff_id, rating, text)
                          values ('office', %L, %L, 4, %L) $$, :'admin_uid', :'staffb', repeat('o', 3000)),
  'an office entry is not bound by it');
select ok((select convalidated from pg_constraint where conname = 'feedback_client_text_length'),
  'the constraint is validated (no historical client row is longer)');

-- =====================================================================
-- 2 · update_my_profile()
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select update_my_profile('The Office', null, null) $$,
  'P0001', 'client_profile_read_only', 'a client login cannot rename itself (§11.1: the portal has no editing)');
reset role;
select is((select full_name from profiles where id = :'clienta_uid'), 'Client A user', 'the name is unchanged');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$ select update_my_profile('Gisela M.', null, 'Operations') $$,
  'a Back Office login still edits its own /account details');
reset role;

-- =====================================================================
-- 3 · contract_versions
-- =====================================================================
insert into contract_versions (version, title, body, published_at)
values ('rls-792', 'Probe', 'You must declare any unspent criminal conviction.', now() - interval '1 day');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from contract_versions), 0, 'a client reads no contract text');
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select ok((select count(*)::int from contract_versions) >= 1, 'a worker still reads the agreement they sign');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select ok((select count(*)::int from contract_versions) >= 1, 'and the office reads it');
reset role;
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select is((select count(*)::int from contract_versions), 0, 'anon reads none');
reset role;

select * from finish();
rollback;
