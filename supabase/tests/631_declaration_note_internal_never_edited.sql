-- =====================================================================
-- 631 · criminal_declarations: the manager's note is internal (§10.1,
--       §10.7; audit D8) and a declaration is never edited (§1.5; D29)
--   20260929140000_declaration_review_note_is_internal_and_never_edited.sql
--
-- The worker reads their own declarations off the table (staff_self_decl)
-- — every column except review_note and reviewed_by, which no PostgREST
-- role holds. The office reads them through the owner-rights
-- criminal_declarations_office_v, gated on admin in its body (ADR-0004).
-- And whatever the role, what the worker declared is never rewritten.
-- =====================================================================
begin;
select plan(31);
\ir _shared/fixtures.psql

update criminal_declarations
   set review_status = 'rejected', reviewed_at = now(), reviewed_by = :'admin_uid',
       review_note = 'Internal: the manager''s reason'
 where id = :'decl_a';

-- ---------------------------------------------------------------------
-- 1. The privilege (D8)
-- ---------------------------------------------------------------------
select ok(not has_column_privilege('authenticated', 'public.criminal_declarations', 'review_note', 'select'),
  '§10.1/§10.7 authenticated holds no SELECT on review_note — the worker and the admin are the same Postgres role');
select ok(not has_column_privilege('authenticated', 'public.criminal_declarations', 'reviewed_by', 'select'),
  'nor on reviewed_by');
select ok(not has_column_privilege('anon', 'public.criminal_declarations', 'review_note', 'select'),
  'anon neither');
select is_empty(
  $$ select a.attname from pg_attribute a
      where a.attrelid = 'public.criminal_declarations'::regclass and a.attnum > 0 and not a.attisdropped
        and a.attname not in ('review_note', 'reviewed_by')
        and not has_column_privilege('authenticated', 'public.criminal_declarations', a.attname, 'select') $$,
  'every other column is granted, so the worker''s own reads keep working');
select is(
  (select array_agg(distinct c.relname::text) from pg_depend d
     join pg_rewrite r on r.oid = d.objid join pg_class c on c.oid = r.ev_class
     join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
    where d.refobjid = 'public.criminal_declarations'::regclass and a.attname = 'review_note'),
  array['criminal_declarations_office_v'],
  'criminal_declarations_office_v is the only view that reads review_note: a new invoker view reading it directly fails here, not in production');
select is((select c.relkind::text || ':' || coalesce(array_to_string(c.reloptions, ','), '')
             from pg_class c where c.oid = 'public.criminal_declarations_office_v'::regclass),
  'v:security_barrier=true',
  'the office view runs with owner rights (no security_invoker) behind a security barrier (ADR-0004)');

-- ---------------------------------------------------------------------
-- 2. The worker (Staff Alpha, whose declaration was just rejected)
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select review_note from criminal_declarations $$, '42501', null,
  'GET /criminal_declarations?select=review_note is refused for the worker (the D8 leak)');
select throws_ok($$ select reviewed_by from criminal_declarations $$, '42501', null,
  'and ?select=reviewed_by');
select throws_ok($$ select * from criminal_declarations $$, '42501', null,
  'select * names the column too, so it is refused rather than silently leaking');
select throws_ok($$ select id from criminal_declarations where review_note is not null $$, '42501', null,
  'and the column cannot be probed through a WHERE clause');
select is((select review_status::text from criminal_declarations where id = :'decl_a'), 'rejected',
  'the worker still reads their own declaration and its status');
select is((select count(*)::int from criminal_declarations where id = :'decl_b'), 0,
  'and still not anybody else''s');
select is((select count(*)::int from criminal_declarations_office_v), 0,
  'the office view gives a worker nothing: the admin gate is in its body');
reset role;

-- A client.
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from criminal_declarations_office_v), 0, 'nor a client');
reset role;

-- anon.
set local role anon;
select throws_ok($$ select count(*) from criminal_declarations_office_v $$, '42501', null,
  'and anon cannot reach the view at all');
reset role;

-- ---------------------------------------------------------------------
-- 3. The office
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select review_note from criminal_declarations_office_v where id = :'decl_a'),
  'Internal: the manager''s reason',
  'the office reads the note through criminal_declarations_office_v (/onboarding/:id)');
select is((select reviewed_by from criminal_declarations_office_v where id = :'decl_a'), :'admin_uid'::uuid,
  'and who reviewed it');
select is((select count(*)::int from criminal_declarations_office_v where id in (:'decl_a', :'decl_b')), 2,
  'every worker''s declarations');
select throws_ok($$ select review_note from criminal_declarations $$, '42501', null,
  'not off the table: the privilege is the role''s, so the view is the one route');

-- ---------------------------------------------------------------------
-- 4. Never edited (§1.5, D29) — the office's admin_all is FOR ALL, and
--    the trigger is what stops it rewriting the worker's statement.
-- ---------------------------------------------------------------------
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
\set gone 'd6310000-0000-4000-8000-000000000001'
\set gone_decl 'f6310000-0000-4000-8000-000000000001'
insert into staff (id, first_name, last_name, email, phone, dob, status)
values (:'gone', 'Gone', 'Soon', 'gone.soon@rls.test', '+447700906311', date '1990-01-01', 'compliant');
insert into criminal_declarations (id, staff_id, source, answer, details, conviction_date)
values (:'gone_decl', :'gone', 'in_employment', true, 'Declared content', date '2024-02-02');
select lives_ok(format($$ select remove_worker(%L) $$, :'gone'),
  '§1.7 remove_worker clears the content through the trigger''s one exception');
select throws_ok(format($$ update criminal_declarations set details = 'put back' where id = %L $$, :'gone_decl'),
  'P0001', 'declaration_never_edited', 'and even on a removed worker, only clearing is allowed');

-- The cascade from a deleted staff row is the one delete (nothing in the
-- product deletes a staff row; e2e cleanup does).
\set temp 'd6310000-0000-4000-8000-000000000002'
insert into staff (id, first_name, last_name, email, phone, dob, status)
values (:'temp', 'Temp', 'Row', 'temp.row@rls.test', '+447700906312', date '1990-01-01', 'interview_requested');
insert into criminal_declarations (staff_id, source, answer) values (:'temp', 'onboarding', false);
delete from staff where id = :'temp';
select is((select count(*)::int from criminal_declarations where staff_id = :'temp'), 0,
  'deleting the staff row cascades: the parent is gone, so the trigger lets its declarations follow');

select * from finish();
rollback;
