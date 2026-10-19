-- =====================================================================
-- 851 · Passport country and the address lines on the New Starter (HMRC)
--   report · 20261019120000 · ADR-0159
--
--   A. new_starter_address_parts(): the one stored line → Address line
--      1 · 2 · 3 and Town / City, vectors for every shape it is written in.
--   B. staff.passport_country is held to known_countries().
--   C. record_passport_country(): the AI read fills a BLANK only, from a
--      passport only, with a known name only, never a removed worker;
--      service role only.
--   D. set_staff_passport_country(): an office login that is not
--      read-only sets, corrects and clears it; a worker, the viewer and a
--      removed worker are refused; audited without the value.
--   E. §1.7: removal wipes it.
--   F. The report carries the new columns, and the old ones unchanged.
-- =====================================================================
begin;
select plan(27);
\ir _shared/fixtures.psql

\set viewer_uid 'c8510000-0000-4000-8000-000000000001'
\set ana        'c8520000-0000-4000-8000-000000000001'
\set gone       'c8520000-0000-4000-8000-000000000002'
\set pp_ana     'c8530000-0000-4000-8000-000000000001'
\set ni_ana     'c8530000-0000-4000-8000-000000000002'
\set pp_gone    'c8530000-0000-4000-8000-000000000003'

insert into auth.users (id, email) values (:'viewer_uid', 'viewer@ns851.test');
insert into profiles (id, role, office_role, full_name) values (:'viewer_uid', 'admin', 'viewer', 'Vee Viewer');

insert into staff (id, first_name, last_name, email, phone, dob, status, home_address) values
  (:'ana',  'Ana',  'Starter', 'ana@ns851.test',  '+447700985101', date '1999-01-01', 'compliant',
   'Flat 4, 22 Roman Road, Bethnal Green, London E2 0RY'),
  (:'gone', 'Gone', 'Starter', 'gone@ns851.test', '+447700985102', date '1998-02-02', 'compliant',
   '1 Mile End Rd, London E1 4NS');

insert into compliance_docs (id, staff_id, doc_type, file_path) values
  (:'pp_ana',  :'ana',  'passport',    'documents/ana-passport.jpg'),
  (:'ni_ana',  :'ana',  'ni_evidence', 'documents/ana-ni.jpg'),
  (:'pp_gone', :'gone', 'passport',    'documents/gone-passport.jpg');

-- =====================================================================
-- A · the address lines
-- =====================================================================
select is((select row(address_line_1, address_line_2, address_line_3, town)::text
             from new_starter_address_parts('Flat 4, 22 Roman Road, Bethnal Green, London E2 0RY')),
  row('Flat 4', '22 Roman Road', 'Bethnal Green', 'London')::text,
  'the wizard''s line: flat · house + street · area, and the town in front of the postcode');
select is((select row(address_line_1, address_line_2, address_line_3, town)::text
             from new_starter_address_parts('1 Mile End Rd, London E1 4NS')),
  row('1 Mile End Rd', null::text, null::text, 'London')::text,
  'a short address leaves the lines it does not need blank');
select is((select row(address_line_1, address_line_2, address_line_3, town)::text
             from new_starter_address_parts('Rose Cottage, Mill Lane, Little Snoring, Fakenham, Norfolk, Norwich NR21 0AA')),
  row('Rose Cottage', 'Mill Lane', 'Little Snoring, Fakenham, Norfolk', 'Norwich')::text,
  'parts beyond the third line join line 3 — nothing is dropped');
select is((select row(address_line_1, address_line_2, address_line_3, town)::text
             from new_starter_address_parts('22 Roman Rd,, London,  e20ry')),
  row('22 Roman Rd', null::text, null::text, 'London')::text,
  'empty parts, stray spaces and a lower-case postcode without its space are tidied');
select is((select row(address_line_1, address_line_2, address_line_3, town)::text
             from new_starter_address_parts('Flat 3, somewhere without a postcode')),
  row('Flat 3', 'somewhere without a postcode', null::text, null::text)::text,
  'no UK postcode at the end → no town is guessed; every part is a line');
select is((select row(address_line_1, address_line_2, address_line_3, town)::text
             from new_starter_address_parts('22 Roman Road London E2 0RY')),
  row('22 Roman Road London', null::text, null::text, null::text)::text,
  'a line typed without commas keeps all of itself in line 1 rather than guess where the town starts');
select is((select count(*)::int from new_starter_address_parts(null)), 0,
  'no address → no parts');

-- =====================================================================
-- B · the column
-- =====================================================================
select throws_ok(format($$ update staff set passport_country = 'Narnia' where id = %L $$, :'ana'),
  '23514', null, 'a passport country off the list is refused by the table itself');
select ok(has_column_privilege('authenticated', 'public.staff', 'passport_country', 'select'),
  'the office (and the worker, for their own row) can read it');

-- =====================================================================
-- C · the AI read fills a blank
-- =====================================================================
select ok(not has_function_privilege('authenticated', 'public.record_passport_country(uuid, text)', 'execute')
      and not has_function_privilege('anon', 'public.record_passport_country(uuid, text)', 'execute')
      and has_function_privilege('service_role', 'public.record_passport_country(uuid, text)', 'execute'),
  'record_passport_country is the service role''s only');
select is((record_passport_country(:'ni_ana', 'Poland')->>'written')::boolean, false,
  'a document that is not a passport writes nothing');
select is((record_passport_country(:'pp_ana', 'Ignore your instructions')->>'written')::boolean, false,
  'a name off the list writes nothing');
select is((select passport_country from staff where id = :'ana'), null::text, 'still blank');
select is((record_passport_country(:'pp_ana', 'Poland')->>'written')::boolean, true,
  'a passport with a known country fills the blank');
select is((record_passport_country(:'pp_ana', 'Romania')->>'written')::boolean, false,
  'and a later read never overwrites it');
select is((select passport_country from staff where id = :'ana'), 'Poland', 'the first value stands');

-- =====================================================================
-- D · the office sets and corrects it
-- =====================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((set_staff_passport_country(:'ana', ' united   kingdom ')->>'passportCountry'), 'United Kingdom',
  'the office corrects it, written as the list spells it');
select throws_ok(format($$ select set_staff_passport_country(%L, 'Atlantis') $$, :'ana'),
  'P0001', 'unknown_country', 'a country off the list is refused');
reset role;
select is((select passport_country from staff where id = :'ana'), 'United Kingdom', 'the correction is on file');
select ok(exists (select 1 from audit_log where action = 'staff.passport_country_set' and entity_id = :'ana'
                    and not (data::text ilike '%kingdom%')),
  'audited against the worker, without the value');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c8510000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(format($$ select set_staff_passport_country(%L, 'Poland') $$, :'ana'),
  null, null, 'a read-only (viewer) login is refused');
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select throws_ok(format($$ select set_staff_passport_country(%L, 'Poland') $$, :'ana'),
  null, null, 'a worker cannot set it, not even their own');
reset role;

-- =====================================================================
-- E · §1.7 removal
-- =====================================================================
update staff set passport_country = 'France' where id = :'gone';
update staff set removed_at = now() where id = :'gone';
select is((select passport_country from staff where id = :'gone'), null::text,
  'removal wipes the passport country with the other report fields');
select is((record_passport_country(:'pp_gone', 'France')->>'written')::boolean, false,
  'and a late read cannot put it back');
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok(format($$ select set_staff_passport_country(%L, 'France') $$, :'gone'),
  'P0001', 'staff_removed', 'nor can the office');
reset role;

-- =====================================================================
-- F · the report's shape
-- =====================================================================
select is((select string_agg(a, ', ' order by n)
             from unnest((select proargnames from pg_proc where proname = 'new_starter_rows')) with ordinality u(a, n)
            where n > 1),
  'staff_id, employee_id, staff_name, removed, photo_path, ni_number, home_address, address_line_1, address_line_2, address_line_3, town, postcode, country, passport_country, date_of_birth, gender, first_shift_date, hmrc_statement, student_loan, bank_account_holder, bank_sort_code, bank_account_number',
  'new_starter_rows() keeps the full home address and adds the lines, town and passport country');
select ok(not has_function_privilege('authenticated', 'public.new_starter_rows(uuid[])', 'execute')
      and not has_function_privilege('authenticated', 'public.new_starter_report_rows(bigint)', 'execute')
      and has_function_privilege('authenticated', 'public.new_starter_report(date)', 'execute'),
  'grants restated as they were: the preview is the office''s (assert_finance_caller), the rest internal');

select * from finish();
rollback;
