-- =====================================================================
-- 817 · The customer's own comment comes back to them, and only theirs
--       (§11.2, §11.5, §9.10, §1.7; ADR-0004, ADR-0026, ADR-0134 N4)
--       — 20261014140200_client_lineup_feedback_text.sql
--
-- "Feedback you've given" reads client_lineup_v's feedback columns. The
-- new feedback_text must be the customer's OWN words on that entry: never
-- the office's entry on the same worker, never another customer's, null
-- before any feedback, and withheld once the worker is removed (§1.7). The
-- restated view keeps the headcount trim and ADR-0004's shape.
-- =====================================================================
begin;
select plan(12);
\ir _shared/fixtures.psql

-- ---- shape --------------------------------------------------------------
select ok(not (coalesce((select reloptions from pg_class where relname = 'client_lineup_v'), '{}') @> '{security_invoker=true}')
          and (coalesce((select reloptions from pg_class where relname = 'client_lineup_v'), '{}') @> '{security_barrier=true}'),
  'client_lineup_v is still an owner-rights security barrier view (ADR-0004)');
select ok(pg_get_viewdef('client_lineup_v'::regclass) ~ 'client_portal_visible\(e\.client_id\)'
          and pg_get_viewdef('client_lineup_v'::regclass) ~ 'headcount',
  'it still carries client_portal_visible() and the headcount trim (20261014140000)');
select ok(not has_table_privilege('anon', 'client_lineup_v', 'select')
          and not has_table_privilege('authenticated', 'client_lineup_v', 'update'),
  'still closed to anon and read-only for signed-in callers');

-- The office's own entry on the same worker and event, with its own words.
insert into feedback (author_kind, author_id, staff_id, event_id, rating, text)
values ('office', :'admin_uid', :'staffa', :'event_a', 2, 'Office only: late back from break');

-- ---- as Client A: its own words, never the office's ---------------------
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select feedback_text from client_lineup_v where booking_id = :'booking_a'), 'Fixture feedback A',
  '§11.2 the customer reads back the comment it wrote');
select is((select count(*)::int from client_lineup_v where feedback_text ilike '%office only%'), 0,
  '§9.10 the office''s words on the same worker never come through');
select is((select count(*)::int from client_lineup_v where booking_id = :'booking_b'), 0,
  'client B''s booking, and so client B''s comment, is not reachable by client A');
reset role;

-- ---- as Client B: its own, one row --------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'clientb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq($$ select feedback_text from client_lineup_v $$, $$ values ('Fixture feedback B'::text) $$,
  'client B reads exactly its own comment');
reset role;

-- ---- no comment, or no entry --------------------------------------------
update feedback set text = null where id = :'feedback_a';
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq(
  $$ select feedback_given, feedback_rating, feedback_text from client_lineup_v where booking_id = '0a0a0a0a-0000-4000-8000-000000000001' $$,
  $$ values (true, 5, null::text) $$,
  'stars without a comment: the entry is there, the text is null');
reset role;

delete from feedback where id = :'feedback_a';
set local role authenticated;
select results_eq(
  $$ select feedback_given, feedback_text from client_lineup_v where booking_id = '0a0a0a0a-0000-4000-8000-000000000001' $$,
  $$ values (false, null::text) $$,
  'only the office entry left: no feedback, no text');
reset role;

-- ---- a removed worker (§1.7) --------------------------------------------
insert into feedback (author_kind, author_id, staff_id, event_id, rating, text)
values ('client', :'clienta_uid', :'staffa', :'event_a', 4, 'Staff Alpha was brilliant with the top table');
update staff set removed_at = now() where id = :'staffa';
set local role authenticated;
select results_eq(
  $$ select feedback_given, feedback_rating, feedback_text, name like 'Deleted account%' from client_lineup_v
      where booking_id = '0a0a0a0a-0000-4000-8000-000000000001' $$,
  $$ values (true, 4, null::text, true) $$,
  '§1.7 a removed worker keeps the stars, but a comment that may name them is withheld');
reset role;

-- ---- a worker reads nothing ---------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_lineup_v), 0, 'a worker reads no row, so no comment');
reset role;

select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name like 'client\_%'
              and column_name in ('text', 'read_at', 'read_by', 'author_id')),
  0, 'no client_* view carries the office''s read marks or who wrote an entry');

select * from finish();
rollback;
