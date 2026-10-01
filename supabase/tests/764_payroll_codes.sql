-- =====================================================================
-- 764 · People already on payroll keep their payroll code as their
--       Employee ID (20261002104000, ADR-0076)
--
--   1. shape: payroll_codes has RLS, one policy (admin_read), the
--      viewer's write guard; nobody signed in can load or apply;
--   2. the name key: case, spacing, hyphens, apostrophes and the
--      first/last split do not matter;
--   3. load_payroll_codes(): "A" codes, blanks and out-of-range codes are
--      skipped and handed back; a code somebody holds is not loaded;
--   4. issuing at contract signature: a match gets the payroll code and
--      consumes the row; no match, a name on the list twice, or a name
--      two workers share gets a system ID; an ID already held is kept;
--   5. the backfill: a system-issued ID on a matching worker becomes the
--      payroll code; a removed worker and an ambiguous name are left;
--   6. who reads the list: the office, nobody else.
-- =====================================================================
begin;
select plan(32);
\ir _shared/fixtures.psql

\set gisela   '76400000-0000-4000-8000-000000000001'
\set harish   '76400000-0000-4000-8000-000000000002'
\set nomatch  '76400000-0000-4000-8000-000000000003'
\set twinlist '76400000-0000-4000-8000-000000000004'
\set twinapp1 '76400000-0000-4000-8000-000000000005'
\set twinapp2 '76400000-0000-4000-8000-000000000006'
\set returner '76400000-0000-4000-8000-000000000007'
\set early    '76400000-0000-4000-8000-000000000008'
\set gone     '76400000-0000-4000-8000-000000000009'
\set dandre   '76400000-0000-4000-8000-00000000000a'

-- =====================================================================
-- 1 · Shape
-- =====================================================================
select has_table('public', 'payroll_codes', 'payroll_codes exists');
select ok((select relrowsecurity from pg_class where oid = 'public.payroll_codes'::regclass),
  'payroll_codes has row level security');
select is(
  (select array_agg(polname::text || ':' || polcmd::text order by polname) from pg_policy
    where polrelid = 'public.payroll_codes'::regclass),
  array['admin_read:r'],
  'one policy — admin_read, SELECT only; no staff, client or write policy');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.payroll_codes'::regclass
                    and tgname = 'office_read_only'),
  'carries the viewer''s write guard (ADR-0060)');
select ok(not has_function_privilege('authenticated', 'public.load_payroll_codes(jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.load_payroll_codes(jsonb)', 'execute')
      and not has_function_privilege('authenticated', 'public.apply_payroll_codes()', 'execute')
      and not has_function_privilege('authenticated', 'public.issue_employee_id(uuid, text, text)', 'execute'),
  'no signed-in session can load the list, apply it, or issue an ID');

-- =====================================================================
-- 2 · The name key
-- =====================================================================
select is(payroll_name_key('Harish', 'Kumar Paidi'), payroll_name_key('  HARISH kumar ', ' paidi'),
  'case, spacing and the first/last split do not matter');
select is(payroll_name_key('Mary-Jane', 'O''Brien'), payroll_name_key('Mary Jane', 'O' || chr(8217) || 'Brien'),
  'a hyphen reads as a space; straight and curly apostrophes alike');
select is(payroll_name_key('Mary Jane', 'OBrien'), 'mary jane obrien',
  'an apostrophe is dropped, so O''Brien and OBrien match');
select is(payroll_name_key('', ' '), null, 'an empty name has no key, so it matches nothing');

-- =====================================================================
-- 3 · Loading
-- =====================================================================
create temp table loaded as
select load_payroll_codes($$[
  {"code": 183,    "first_name": "Gisela",  "last_name": "Duncan"},
  {"code": "2622", "first_name": "Harish",  "last_name": "Kumar Paidi"},
  {"code": 6133,   "first_name": "D'Andre Jomari", "last_name": "Shaquille Jack"},
  {"code": 3001,   "first_name": "Sam",     "last_name": "Twin"},
  {"code": 3002,   "first_name": "Sam",     "last_name": "Twin"},
  {"code": 3003,   "first_name": "Alex",    "last_name": "Double"},
  {"code": 3004,   "first_name": "Early",   "last_name": "Signer"},
  {"code": 3005,   "first_name": "Gone",    "last_name": "Away"},
  {"code": 3006,   "first_name": "Kept",    "last_name": "Mine"},
  {"code": "1641A","first_name": "Gokul",   "last_name": "Raveendra"},
  {"code": 12000,  "first_name": "Too",     "last_name": "High"},
  {"code": 4000,   "first_name": "",        "last_name": "Blank"}
]$$::jsonb) as r;

select is((select (r->>'loaded')::int from loaded), 9, 'nine rows loaded');
select is((select jsonb_array_length(r->'skipped') from loaded), 3,
  'three handed back as skipped: an "A" code, a code above 10000 and a blank name');
select ok((select r->'skipped' @> '[{"code": "1641A"}]' from loaded), 'the "A" code is among them');
select is((select r->'ambiguousNames' from loaded), '["sam twin"]'::jsonb,
  'a name on the list twice is reported');

-- =====================================================================
-- 4 · Issuing at contract signature
-- =====================================================================
insert into staff (id, first_name, last_name, email, phone, dob, status, employee_id) values
  (:'gisela',   'gisela',  'DUNCAN',  'g@764.test', '+447700976401', date '1990-01-01', 'contract', null),
  (:'harish',   'Harish Kumar', 'Paidi', 'h@764.test', '+447700976402', date '1990-01-01', 'contract', null),
  (:'nomatch',  'Nobody',  'Listed',  'n@764.test', '+447700976403', date '1990-01-01', 'contract', null),
  (:'twinlist', 'Sam',     'Twin',    't@764.test', '+447700976404', date '1990-01-01', 'contract', null),
  (:'twinapp1', 'Alex',    'Double',  'a@764.test', '+447700976405', date '1990-01-01', 'contract', null),
  (:'twinapp2', 'Alex',    'Double',  'b@764.test', '+447700976406', date '1990-01-01', 'documents', null),
  (:'returner', 'Kept',    'Mine',    'k@764.test', '+447700976407', date '1990-01-01', 'contract', 19970),
  (:'dandre',   'D' || chr(8217) || 'Andre', 'Jomari Shaquille Jack', 'd@764.test', '+447700976410', date '1990-01-01', 'contract', null);

update staff set status = 'compliant', contract_signed_at = now(), contract_version = 'v1'
 where id in (:'gisela', :'harish', :'nomatch', :'twinlist', :'twinapp1', :'returner', :'dandre');

select is((select employee_id from staff where id = :'gisela'), 183,
  'a name on payroll is issued its payroll code at signature');
select is((select employee_id from staff where id = :'harish'), 2622,
  'however the name is split between first and last');
select is((select employee_id from staff where id = :'dandre'), 6133,
  'and a curly apostrophe in the app matches a straight one on the list');
select is((select count(*)::int from payroll_codes where code in (183, 2622, 6133)), 0,
  'the matched rows are consumed');
select is((select count(*)::int from audit_log where action = 'employee_id_from_payroll'
             and entity_id = :'gisela' and data->>'employeeId' = '183' and data->>'when' = 'issued'), 1,
  'audit_log records the match');
select ok((select employee_id >= 10001 from staff where id = :'nomatch'),
  'a name not on payroll gets a system ID, as before');
select ok((select employee_id >= 10001 from staff where id = :'twinlist'),
  'a name on the list twice gets a system ID — name alone cannot say which code');
select ok((select employee_id >= 10001 from staff where id = :'twinapp1'),
  'so does a name two workers share');
select is((select employee_id from staff where id = :'returner'), 19970,
  'an Employee ID the person already holds is never replaced (§2.12)');
select is((select count(*)::int from payroll_codes where code in (3001, 3002, 3003, 3006)), 4,
  'and none of those consumed a row');

-- =====================================================================
-- 5 · The backfill
-- =====================================================================
-- Signed before the list was loaded: a system ID already.
delete from payroll_codes where code in (3004, 3005);
insert into staff (id, first_name, last_name, email, phone, dob, status, employee_id, contract_signed_at, removed_at) values
  (:'early', 'Early', 'Signer', 'e@764.test', '+447700976408', date '1990-01-01', 'compliant', 19980, now(), null),
  (:'gone',  'Gone',  'Away',   'x@764.test', '+447700976409', date '1990-01-01', 'compliant', 19990, now(), now());

create temp table reloaded as
select load_payroll_codes($$[
  {"code": 183,  "first_name": "Gisela", "last_name": "Duncan"},
  {"code": 3004, "first_name": "Early",  "last_name": "Signer"},
  {"code": 3005, "first_name": "Gone",   "last_name": "Away"}
]$$::jsonb) as r;

select is((select r->'alreadyHeld' from reloaded), '[183]'::jsonb,
  'a code somebody already holds is not loaded again');
select is((select employee_id from staff where id = :'early'), 3004,
  'a worker who signed before the list was loaded is moved to their payroll code');
select is((select r->'changed'->0->>'from' from reloaded), '19980',
  'and the load reports the ID it replaced');
select is((select count(*)::int from audit_log where action = 'employee_id_from_payroll'
             and entity_id = :'early' and data->>'replaced' = '19980'), 1,
  'audit_log records the change and the old ID');
select is((select employee_id from staff where id = :'gone'), 19990,
  'a removed worker''s ID is left alone — it names their "Deleted account #"');
select ok((select employee_id >= 10001 from staff where id = :'twinapp1')
      and exists (select 1 from payroll_codes where code = 3003),
  'a name two workers share is left on its system ID by the backfill too');

-- =====================================================================
-- 6 · Who reads the list
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select ok((select count(*) from payroll_codes) > 0, 'the office reads the list');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from payroll_codes), 0, 'a worker reads nothing');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from payroll_codes), 0, 'a client reads nothing');
reset role;

select * from finish();
rollback;
