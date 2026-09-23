-- =====================================================================
-- 521 · The New Starter (HMRC) report's Gender, Postcode and Country
--   20260926100100_new_starter_gender_and_address.sql, ADR-0024
--   (§2.8, §9.9 Tab 3)
--
--   A. Step 7's 8-argument checklist: gender required as M or F, written
--      with the checklist in one transaction; refused with it; the
--      7-argument function unchanged; grants as the step's.
--   B. Postcode and country follow home_address — the wizard's step 2 and
--      a later Profile edit — and are never guessed.
--   C. The report reads all three.
-- =====================================================================
begin;
select plan(17);
\ir _shared/fixtures.psql

\set ana_uid 'c5210000-0000-4000-8000-000000000001'
\set ben_uid 'c5210000-0000-4000-8000-000000000002'
\set ana     'c5220000-0000-4000-8000-000000000001'
\set ben     'c5220000-0000-4000-8000-000000000002'

insert into auth.users (id, email) values (:'ana_uid', 'ana@ns521.test'), (:'ben_uid', 'ben@ns521.test');
insert into profiles (id, role, full_name) values (:'ana_uid', 'staff', 'Ana'), (:'ben_uid', 'staff', 'Ben');
insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, rtw_branch, home_address) values
  (:'ana', :'ana_uid', 'Ana', 'Starter', 'ana@ns521.test', '+447700952101', date '1999-01-01', 'contract', 'uk_irish',
   '1 Mile End Rd, London E1 4NS'),
  (:'ben', :'ben_uid', 'Ben', 'Starter', 'ben@ns521.test', '+447700952102', date '1998-02-02', 'contract', 'uk_irish',
   null);

-- =====================================================================
-- A · gender on step 7
-- =====================================================================
select ok(has_function_privilege('authenticated',
            'public.submit_hmrc_checklist(boolean, boolean, boolean, text, boolean, text, boolean, text)', 'execute')
      and not has_function_privilege('anon',
            'public.submit_hmrc_checklist(boolean, boolean, boolean, text, boolean, text, boolean, text)', 'execute'),
  'the 8-argument checklist is the worker''s, as the 7-argument one is; anon cannot call it');
select is((select count(*)::int from pg_proc where proname = 'submit_hmrc_checklist'
             and pg_get_function_identity_arguments(oid) =
                 'p_q1_other_job boolean, p_q2_pension boolean, p_q3_since_april boolean, p_student_loan text, p_postgraduate boolean, p_ni_number text, p_declared boolean'),
  1, 'the 7-argument function is still there, arguments unchanged');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c5210000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ select submit_hmrc_checklist(false, false, false, 'none', false, null, true, null) $$,
  'P0001', 'gender_required', 'gender is required on the new form');
select throws_ok($$ select submit_hmrc_checklist(false, false, false, 'none', false, null, true, 'X') $$,
  'P0001', 'gender_required', 'and only HMRC''s two values are accepted');
select throws_ok($$ select submit_hmrc_checklist(false, false, false, 'none', false, null, false, 'F') $$,
  'P0001', 'declaration_required', 'every rule of the checklist still applies');
reset role;
select is((select gender from staff where id = :'ana'), null::text,
  'a refused checklist writes no gender');

set local role authenticated;
select lives_ok($$ select submit_hmrc_checklist(false, false, false, 'none', false, null, true, ' female ') $$,
  'a complete checklist with a gender is accepted');
select ok(not (submit_hmrc_checklist(false, false, false, 'none', false, null, true, 'F') ? 'statement'),
  'the answer still never carries the statement letter (§2.8)');
reset role;
select is((select gender from staff where id = :'ana'), 'F', 'gender is on the staff row, as the report''s M/F');
select is((select statement::text from hmrc_checklists where staff_id = :'ana' and not superseded), 'A',
  'and the checklist itself was written by the same call');
select is((select hmrc_at is not null from onboarding_progress where staff_id = :'ana'), true,
  'step 7 is complete');

-- =====================================================================
-- B · postcode and country follow the address
-- =====================================================================
select is((select home_postcode || ' / ' || home_country from staff where id = :'ana'), 'E1 4NS / United Kingdom',
  'an address ending in a UK postcode gives both, on insert');
update staff set home_address = '22 Princes St, Edinburgh EH2 2AN' where id = :'ana';
select is((select home_postcode from staff where id = :'ana'), 'EH2 2AN',
  'a later edit moves the postcode with it — never the one they left');
update staff set home_address = '5 Pier Rd, Brighton BN1 1AA', home_postcode = 'BN1 1AB' where id = :'ana';
select is((select home_postcode from staff where id = :'ana'), 'BN1 1AB',
  'a writer that sets the postcode itself in the same statement wins');
update staff set home_address = 'Flat 3, somewhere without a postcode' where id = :'ana';
select is((select coalesce(home_postcode, '-') || ' / ' || coalesce(home_country, '-') from staff where id = :'ana'), '- / -',
  'no UK postcode → both blank, never guessed');
update staff set home_address = '9 Castle St, Cardiff CF10 1BH' where id = :'ben';
select is((select home_postcode || ' / ' || home_country from staff where id = :'ben'), 'CF10 1BH / United Kingdom',
  'a first address written later (the wizard''s step 2) fills both');

-- =====================================================================
-- C · what the report reads
-- =====================================================================
select is((select row(a.gender, b.home_postcode, b.home_country)::text
             from staff a, staff b where a.id = :'ana' and b.id = :'ben'),
  '(F,"CF10 1BH","United Kingdom")',
  'the three columns new_starter_rows() reads are filled');

select * from finish();
rollback;
