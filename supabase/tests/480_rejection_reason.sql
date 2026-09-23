-- =====================================================================
-- 480 · The office's rejection reason is internal (§2.9, ADR-0017)
--                  — 20260923220000_rejection_reason_is_internal.sql
--
-- The sibling of 360, in the column next door, and defended the same way
-- and for the same reason: `staff` carried a table-wide SELECT grant for
-- `authenticated` and a row policy (staff_self, 0001_init.sql:482) giving
-- the candidate their own row, so
--
--     GET /rest/v1/staff?select=rejection_reason
--
-- returned the office's free-text note to the person it was written
-- about, whatever any screen asked for. ADR-0017 settles that it is
-- internal: E2 and E2b are both mandatory and "never carry the office's
-- reason", and §2.9's E4 carries none either.
--
-- So the assertions are written as the raw roles, in the shapes a
-- hand-written PostgREST call produces — a named column, `select *`, and
-- the column named only in a WHERE — never through a view or a function.
-- The owner owns `staff` and bypasses both RLS and column privileges, so
-- a test of this written as the owner would pass with the leak open.
--
-- THE DISTINCTION THIS FILE ALSO DEFENDS: `compliance_docs.rejection_reason`
-- is a different column with the OPPOSITE rule. §2.6 requires a rejected
-- document to carry its reason to the worker so they can re-upload, and
-- N8 sends it. A future tidy-up that "makes rejection_reason consistent"
-- by revoking both would break that, so section 5 asserts the worker can
-- still read it.
--
-- Employee IDs are in the 9xxxx range by the convention 290, 220, 330 and
-- 360 use.
-- =====================================================================
begin;
select plan(20);
\ir _shared/fixtures.psql

-- The candidate under test was rejected by the office with exactly the
-- kind of note §2.3's board invites and ADR-0017 keeps out of the email.
update staff
   set status           = 'rejected',
       rejection_reason = 'Internal: turned up to the interview an hour late, do not progress'
 where id = :'staffa';

-- =====================================================================
-- 1. Structure — the privilege, not the query
-- =====================================================================
select has_view('staff_rejection_reason_v',
  'the office has an owner-rights view to read the reason through (ADR-0004)');

select ok(
  (select not coalesce('security_invoker=true' = any(reloptions), false)
      and coalesce('security_barrier=true' = any(reloptions), false)
     from pg_class where relname = 'staff_rejection_reason_v'),
  'staff_rejection_reason_v runs with OWNER rights and security_barrier: the column privilege below does not bind it, and no user-supplied qual is evaluated ahead of its admin gate');

select ok(
  (select coalesce('security_invoker=true' = any(reloptions), false)
     from pg_class where relname = 'onboarding_candidates_v'),
  'onboarding_candidates_v is still security_invoker: `staff`''s own RLS remains what decides which candidates a caller sees through it');

select ok(not has_column_privilege('authenticated', 'public.staff', 'rejection_reason', 'select'),
  '§2.9 no signed-in PostgREST role holds SELECT on staff.rejection_reason — the assertion that goes red if somebody re-grants the table');
select ok(not has_column_privilege('anon', 'public.staff', 'rejection_reason', 'select'),
  'and neither does anon');

select ok(not has_column_privilege('authenticated', 'public.staff', 'block_reason', 'select'),
  '#44''s cut survives this one: re-granting by name must not widen back to block_reason (§10.1)');

select ok(has_column_privilege('authenticated', 'public.staff', 'id', 'select'),
  'the rest of the row is untouched: staff_self (0001) still has a column to select');
select ok(has_column_privilege('authenticated', 'public.staff', 'dob', 'select'),
  'including the personal columns a worker legitimately reads about themselves — the cut is one column wide');

select ok(has_table_privilege('authenticated', 'public.staff_rejection_reason_v', 'select'),
  'the view is granted to authenticated, because admin and candidate are the same Postgres role; the gate is in its body, per ADR-0004');
select ok(not has_table_privilege('anon', 'public.staff_rejection_reason_v', 'select'),
  'anon holds nothing on it at all');

-- =====================================================================
-- 2. The candidate — no route to the column
-- =====================================================================
select set_config('request.jwt.claims',
  json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  format('select rejection_reason from staff where id = %L', :'staffa'),
  '42501',
  null,
  'the candidate naming the column is refused: a column privilege, not a policy, so there is no row to filter');

select throws_ok(
  format('select * from staff where id = %L', :'staffa'),
  '42501',
  null,
  '`select *` is refused too — the leak was never about which columns a screen asked for');

select throws_ok(
  format('select id from staff where id = %L and rejection_reason is not null', :'staffa'),
  '42501',
  null,
  'and naming it only in a WHERE is refused: a column privilege is checked on every reference, so it cannot be used as an oracle');

select is(
  (select count(*)::int from staff where id = :'staffa'),
  1,
  'the candidate still reaches their own row (staff_self, 0001): this cut is one column wide, not a narrowing of `staff`');

select is(
  (select rejection_reason from onboarding_candidates_v where id = :'staffa'),
  null,
  'and through the office''s own board view the reason reads null for them — the sub-view''s gate is empty for a non-admin');

reset role;

-- =====================================================================
-- 3. The office — still sees it
-- =====================================================================
select set_config('request.jwt.claims',
  json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select rejection_reason from staff_rejection_reason_v where staff_id = :'staffa'),
  'Internal: turned up to the interview an hour late, do not progress',
  '§2.3: the office reads the reason through the owner-rights view when deciding what to do with a candidate');

select is(
  (select rejection_reason from onboarding_candidates_v where id = :'staffa'),
  'Internal: turned up to the interview an hour late, do not progress',
  'and the board row carries it, so no office column list had to move');

reset role;

-- =====================================================================
-- 4. The client — nothing, as before
-- =====================================================================
select set_config('request.jwt.claims',
  json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select count(*)::int from staff_rejection_reason_v),
  0,
  '§11.1 a client reaches no worker personal data, and the reason is not an exception');

reset role;

-- =====================================================================
-- 5. The OTHER rejection_reason, which must stay readable
--
-- `compliance_docs.rejection_reason` carries the opposite rule: §2.6
-- requires a rejected document to tell the worker why so they can
-- re-upload, and N8 sends that text. These two assertions exist so that a
-- later tidy-up which "makes rejection_reason consistent" by revoking
-- both has to delete a test that says in one line why it must not.
-- =====================================================================
select ok(has_column_privilege('authenticated', 'public.compliance_docs', 'rejection_reason', 'select'),
  '§2.6 a worker still holds SELECT on compliance_docs.rejection_reason: a rejected DOCUMENT must tell them why, and N8 sends it');

select ok(
  (select count(*)::int from pg_attribute
    where attrelid = 'public.staff'::regclass
      and attname = 'rejection_reason'
      and not attisdropped) = 1,
  'the two columns are genuinely different columns on different tables, not one thing read two ways');

select * from finish();
rollback;
