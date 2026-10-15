-- =====================================================================
-- 844 · /apply takes a full name, not a first name alone
--       (20261015140000, ADR-0146)
--
--   submit_application() refuses an initial, a dot or a dash for either
--   name, a surname the same as the first name, and a first name ending
--   with the surname — and still takes short, hyphenated, apostrophised,
--   accented and non-Latin names. The form says the same
--   (apps/staff/app/apply/form.ts · nameProblems).
-- =====================================================================
begin;
select plan(11);
\ir _shared/fixtures.psql

select set_config('request.jwt.claims', '', true);
set local role service_role;

select throws_ok(
  $$ select submit_application('Chukwuka', 'I', 'a1.844@rls.test', '+44 7010 844001', (current_date - interval '30 years')::date, true) $$,
  '22023', 'Enter your first name and surname in full, not initials.',
  'a one-letter surname is an initial, not a surname');
select throws_ok(
  $$ select submit_application('Chukwuka', ' . ', 'a2.844@rls.test', '+44 7010 844002', (current_date - interval '30 years')::date, true) $$,
  '22023', 'Enter your first name and surname in full, not initials.',
  'a dot in Surname is not a surname');
select throws_ok(
  $$ select submit_application('Chukwuka', 'I.-', 'a3.844@rls.test', '+44 7010 844003', (current_date - interval '30 years')::date, true) $$,
  '22023', 'Enter your first name and surname in full, not initials.',
  'punctuation around an initial does not make it a name');
select throws_ok(
  $$ select submit_application('C', 'Igbokwe', 'a4.844@rls.test', '+44 7010 844004', (current_date - interval '30 years')::date, true) $$,
  '22023', 'Enter your first name and surname in full, not initials.',
  'nor does an initial for the first name');
select throws_ok(
  $$ select submit_application('Chukwuka', ' chukwuka ', 'a5.844@rls.test', '+44 7010 844005', (current_date - interval '30 years')::date, true) $$,
  '22023', 'Enter your surname. It can''t be the same as your first name.',
  'the first name typed again as the surname is refused, whatever its case');
select throws_ok(
  $$ select submit_application('Chukwuka  Igbokwe', 'IGBOKWE', 'a6.844@rls.test', '+44 7010 844006', (current_date - interval '30 years')::date, true) $$,
  '22023', 'Enter only your first name in First name, and your surname in Surname.',
  'the whole name in First name with the surname repeated is refused');

reset role;
select is((select count(*)::int from staff where email like '%.844@rls.test'), 0,
  'none of the refused applications created anyone');

set local role service_role;
select lives_ok(
  $$ select submit_application('Jo', 'Ng', 'b1.844@rls.test', '+44 7010 844011', (current_date - interval '30 years')::date, true) $$,
  'two-letter names are names');
select lives_ok(
  $$ select submit_application('Siobhán', 'O''Neill-Kalu', 'b2.844@rls.test', '+44 7010 844012', (current_date - interval '30 years')::date, true) $$,
  'accents, apostrophes and hyphens are fine');
select lives_ok(
  $$ select submit_application('美玲', '王', 'b3.844@rls.test', '+44 7010 844013', (current_date - interval '30 years')::date, true) $$,
  'one letter in another script is a whole surname (王), not an initial');
reset role;

select is((select count(*)::int from staff where email like 'b_.844@rls.test'), 3,
  'and each of them is a candidate');

select * from finish();
rollback;
