-- =====================================================================
-- 671 · criminal_declarations: a declaration is never edited and never
--       deleted (§1.5; audit D29)
--   20260930120000_declarations_never_edited.sql
--
-- The office's admin_all is FOR ALL; the trigger is what stops it
-- rewriting the worker's statement. The review fields stay writable. The
-- one content edit is the §1.7 scrub on a removed worker, and the one
-- delete is the cascade from a deleted staff row.
-- =====================================================================
begin;
select plan(12);
\ir _shared/fixtures.psql

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ update criminal_declarations set answer = true where id = %L $$, :'decl_a'),
  'P0001', 'declaration_never_edited', '§1.5 the answer is never edited');
select throws_ok(format($$ update criminal_declarations set details = 'rewritten' where id = %L $$, :'decl_a'),
  'P0001', 'declaration_never_edited', 'nor the details');
select throws_ok(format($$ update criminal_declarations set declared_at = now() - interval '1 year' where id = %L $$, :'decl_a'),
  'P0001', 'declaration_never_edited', 'nor when it was declared');
select throws_ok(format($$ update criminal_declarations set source = 'in_employment' where id = %L $$, :'decl_a'),
  'P0001', 'declaration_never_edited', 'nor where it was declared');
select throws_ok(format($$ update criminal_declarations set staff_id = %L where id = %L $$, :'staffb', :'decl_a'),
  'P0001', 'declaration_never_edited', 'nor whose it is');
select lives_ok(format($$ update criminal_declarations set review_status = 'verified', review_note = 'On reflection, fine' where id = %L $$, :'decl_a'),
  'the review fields are the office''s half of the row and stay writable');
select lives_ok(format($$ update criminal_declarations set superseded = true where id = %L $$, :'decl_a'),
  'and so is superseded (Reset to candidate, §2.12)');
select throws_ok(format($$ delete from criminal_declarations where id = %L $$, :'decl_b'),
  'P0001', 'declaration_never_deleted', 'a declaration is never deleted from the office');
reset role;

select throws_ok(format($$ update criminal_declarations set details = 'owner edit' where id = %L $$, :'decl_b'),
  'P0001', 'declaration_never_edited', 'not even by the table owner: the rule is on the row, not on a role');

-- The §1.7 scrub is the one content edit: clearing it, on a removed worker.
\set gone 'd6710000-0000-4000-8000-000000000001'
\set gone_decl 'f6710000-0000-4000-8000-000000000001'
insert into staff (id, first_name, last_name, email, phone, dob, status)
values (:'gone', 'Gone', 'Soon', 'gone.soon@rls.test', '+447700906711', date '1990-01-01', 'compliant');
insert into criminal_declarations (id, staff_id, source, answer, details, conviction_date)
values (:'gone_decl', :'gone', 'in_employment', true, 'Declared content', date '2024-02-02');
select lives_ok(format($$ select remove_worker(%L) $$, :'gone'),
  '§1.7 remove_worker clears the content through the trigger''s one exception');
select throws_ok(format($$ update criminal_declarations set details = 'put back' where id = %L $$, :'gone_decl'),
  'P0001', 'declaration_never_edited', 'and even on a removed worker, only clearing is allowed');

-- The cascade from a deleted staff row is the one delete (nothing in the
-- product deletes a staff row; e2e cleanup does).
\set temp 'd6710000-0000-4000-8000-000000000002'
insert into staff (id, first_name, last_name, email, phone, dob, status)
values (:'temp', 'Temp', 'Row', 'temp.row@rls.test', '+447700906712', date '1990-01-01', 'interview_requested');
insert into criminal_declarations (staff_id, source, answer) values (:'temp', 'onboarding', false);
delete from staff where id = :'temp';
select is((select count(*)::int from criminal_declarations where staff_id = :'temp'), 0,
  'deleting the staff row cascades: the parent is gone, so the trigger lets its declarations follow');

select * from finish();
rollback;
