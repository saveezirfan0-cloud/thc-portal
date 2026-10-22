-- =====================================================================
-- 926 · The office corrects a name to the passport's (ADR-0193)
--   20261024100000_office_correct_name.sql
--
--   A. Shape: the two RPCs are authenticated-only definers; the removal
--      trigger function is no RPC.
--   B. office_names_to_review(): who may read it; what it lists (an
--      initial, a lower-case name); what it leaves out (a full name, a
--      removed worker); a corrected name leaves it.
--   C. office_correct_name — who: owner and manager yes; scheduler
--      not_permitted, viewer read_only, a worker, a client and anon no.
--   D. office_correct_name — refusals: an initial, symbols, a blank, the
--      name already on file, the reason (required, >= 10, <= 300), an
--      unknown and a removed profile.
--   E. office_correct_name — effect: the names written tidied, one
--      staff.name_corrected audit row (reason, actorName, from / to), the
--      payroll RC4 email, a capitalisation fix allowed.
--   F. Request a change → name takes the same rule.
--   G. §1.7: removal strips the names and the reason from the audit row
--      and strips the names from the RC4 copy.
-- =====================================================================
begin;
select plan(48);
\ir _shared/fixtures.psql

\set manager   '92600000-0000-4000-8000-000000000001'
\set scheduler '92600000-0000-4000-8000-000000000002'
\set viewer    '92600000-0000-4000-8000-000000000003'
\set w_init    '92610000-0000-4000-8000-000000000001'
\set w_lower   '92610000-0000-4000-8000-000000000002'
\set w_full    '92610000-0000-4000-8000-000000000003'
\set w_gone    '92610000-0000-4000-8000-000000000004'

insert into auth.users (id, email) values
  (:'manager',   'manager.926@rls.test'),
  (:'scheduler', 'scheduler.926@rls.test'),
  (:'viewer',    'viewer.926@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'manager',   'admin', 'manager',   'Mona Manager'),
  (:'scheduler', 'admin', 'scheduler', 'Sam Scheduler'),
  (:'viewer',    'admin', 'viewer',    'Vera Viewer');

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'w_init',  97261, 'Marc',   'M.',      'marc@n926.test',   '+447700972601', date '1998-05-04', 'compliant'),
  (:'w_lower', 97262, 'carlos', 'garcia',  'carlos@n926.test', '+447700972602', date '1997-03-03', 'compliant'),
  (:'w_full',  97263, 'Amara',  'Kalu',    'amara@n926.test',  '+447700972603', date '1996-02-02', 'compliant'),
  (:'w_gone',  97264, 'Gone',   'G.',      'gone@n926.test',   '+447700972604', date '1995-01-01', 'compliant');
select set_config('request.jwt.claims', '', true);
select remove_worker(:'w_gone', now(), :'admin_uid');

-- =====================================================================
-- A · shape
-- =====================================================================
select ok(not has_function_privilege('anon', 'public.office_correct_name(uuid,text,text,text)', 'execute'),
  'A: anon cannot execute office_correct_name');
select ok(has_function_privilege('authenticated', 'public.office_correct_name(uuid,text,text,text)', 'execute'),
  'A: a signed-in session can (its own body decides who)');
select ok(not has_function_privilege('anon', 'public.office_names_to_review()', 'execute'),
  'A: anon cannot execute office_names_to_review');
select ok(has_function_privilege('authenticated', 'public.office_names_to_review()', 'execute'),
  'A: a signed-in session can (its own body decides who)');
select ok(not has_function_privilege('authenticated', 'public.staff_removed_purge_name_audit()', 'execute'),
  'A: the removal trigger function is no RPC');

-- =====================================================================
-- B · office_names_to_review — what is listed
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$ select * from office_names_to_review() $$,
  'B: any office login may read the list, a viewer included');
select is((select reasons from office_names_to_review() where staff_id = :'w_init'), array['initial'],
  'B: a surname that is an initial is listed as one');
select is((select reasons from office_names_to_review() where staff_id = :'w_lower'), array['lower_case'],
  'B: a name in all lower case is listed as that');
select is_empty(
  format($$ select 1 from office_names_to_review() where staff_id in (%L, %L, %L) $$, :'w_full', :'staffa', :'w_gone'),
  'B: a name in full is not listed, and neither is a removed worker');
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select throws_ok($$ select * from office_names_to_review() $$, '42501', 'not_authorised',
  'B: a worker cannot read the list');
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select throws_ok($$ select * from office_names_to_review() $$, '42501', 'not_authorised',
  'B: a client cannot');
reset role;

-- =====================================================================
-- C · office_correct_name — who may
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select office_correct_name(%L, 'Marc Antoni', 'Martinez', 'Passport checked in the office') $$, :'w_init'),
  '42501', 'not_permitted', 'C: a scheduler is refused (ADR-0056: identity is owner and manager)');
select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
select throws_ok(
  format($$ select office_correct_name(%L, 'Marc Antoni', 'Martinez', 'Passport checked in the office') $$, :'w_init'),
  '42501', 'read_only', 'C: a viewer is told it is read-only (ADR-0060)');
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select throws_ok(
  format($$ select office_correct_name(%L, 'Marc Antoni', 'Martinez', 'Passport checked in the office') $$, :'w_init'),
  '42501', 'not_authorised', 'C: a worker cannot correct a name, even their own');
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select throws_ok(
  format($$ select office_correct_name(%L, 'Marc Antoni', 'Martinez', 'Passport checked in the office') $$, :'w_init'),
  '42501', 'not_authorised', 'C: a client cannot');
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  format($$ select office_correct_name(%L, 'Marc Antoni', 'Martinez', 'Passport checked in the office') $$, :'w_init'),
  '42501', null, 'C: anon cannot execute it at all');
reset role;
select is((select first_name || '|' || last_name from staff where id = :'w_init'), 'Marc|M.',
  'C: none of them changed anything');

-- =====================================================================
-- D · office_correct_name — refusals (as the manager)
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select office_correct_name(%L, 'Marc', 'M.', 'Passport checked in the office') $$, :'w_init'),
  'P0001', 'last_initial', 'D: a surname that is an initial is refused');
select throws_ok(
  format($$ select office_correct_name(%L, 'J', 'Martinez', 'Passport checked in the office') $$, :'w_init'),
  'P0001', 'first_initial', 'D: so is a first name that is an initial');
select throws_ok(
  format($$ select office_correct_name(%L, 'Marc', 'Mar7inez', 'Passport checked in the office') $$, :'w_init'),
  'P0001', 'last_characters', 'D: so are digits and symbols');
select throws_ok(
  format($$ select office_correct_name(%L, '   ', 'Martinez', 'Passport checked in the office') $$, :'w_init'),
  'P0001', 'first_required', 'D: and a blank first name');
select throws_ok(
  format($$ select office_correct_name(%L, 'Amara', 'Kalu', 'Passport checked in the office') $$, :'w_full'),
  'P0001', 'unchanged', 'D: the name already on file is not a correction');
select throws_ok(
  format($$ select office_correct_name(%L, 'Marc Antoni', 'Martinez', '   ') $$, :'w_init'),
  '22023', 'reason_required', 'D: a reason is required');
select throws_ok(
  format($$ select office_correct_name(%L, 'Marc Antoni', 'Martinez', 'too short') $$, :'w_init'),
  '22023', 'reason_too_short', 'D: of at least 10 characters');
select throws_ok(
  format($$ select office_correct_name(%L, 'Marc Antoni', 'Martinez', %L) $$, :'w_init', repeat('x', 301)),
  '22023', 'reason_too_long', 'D: and at most 300');
select throws_ok(
  $$ select office_correct_name('92619999-0000-4000-8000-000000000000', 'Marc', 'Martinez', 'Passport checked in the office') $$,
  'P0002', 'staff_not_found', 'D: an unknown profile');
select throws_ok(
  format($$ select office_correct_name(%L, 'Gone', 'Person', 'Passport checked in the office') $$, :'w_gone'),
  'P0001', 'staff_removed', 'D: a removed profile is never filled back in (§1.7)');
reset role;
select is((select first_name || '|' || last_name from staff where id = :'w_init'), 'Marc|M.',
  'D: none of the refusals changed anything');

-- =====================================================================
-- E · office_correct_name — the effect (as the manager)
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (select office_correct_name(:'w_init', '  Marc   Antoni ', ' Martinez ', '  Passport checked in the office  ') ->> 'ok'),
  'true', 'E: an owner or manager corrects the name');
reset role;
select is((select first_name || '|' || last_name from staff where id = :'w_init'), 'Marc Antoni|Martinez',
  'E: both parts are written, tidied');
select is((select count(*)::int from audit_log where action = 'staff.name_corrected' and entity_id = :'w_init'), 1,
  'E: one audit row');
select is((select data ->> 'reason' from audit_log where action = 'staff.name_corrected' and entity_id = :'w_init'),
  'Passport checked in the office', 'E: it carries the manager''s reason');
select is((select data ->> 'actorName' from audit_log where action = 'staff.name_corrected' and entity_id = :'w_init'),
  'Mona Manager', 'E: and who did it');
select is((select data #>> '{lastName,from}' from audit_log where action = 'staff.name_corrected' and entity_id = :'w_init'),
  'M.', 'E: and what the name was');
select is((select count(*)::int from notification_outbox
            where template = 'RC4' and key like 'RC4:correction:' || :'w_init' || ':%'), 1,
  'E: payroll is told, as when an approved request changes a name');
select is((select payload ->> 'previousName' from notification_outbox
            where template = 'RC4' and key like 'RC4:correction:' || :'w_init' || ':%'), 'Marc M.',
  'E: with the name it replaces');
select is_empty(format($$ select 1 from office_names_to_review() where staff_id = %L $$, :'w_init'),
  'E: a corrected name leaves the list');
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select office_correct_name(%L, 'Marc Antoni', 'Martinez', 'Passport checked in the office') $$, :'w_init'),
  'P0001', 'unchanged', 'E: saying it again is refused');
select is(
  (select office_correct_name(:'w_lower', 'Carlos', 'Garcia', 'Passport checked in the office') ->> 'ok'),
  'true', 'E: a capitalisation fix is a correction');
reset role;

-- =====================================================================
-- F · Request a change → name takes the same rule
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select request_profile_change('name', 'Maria', 'L.', null, %L, null) $$, :'staffa' || '/change-requests/e.pdf'),
  'P0001', 'last_initial', 'F: a worker cannot ask for a surname that is an initial');
select throws_ok(
  format($$ select request_profile_change('name', 'M', 'Lopez', null, %L, null) $$, :'staffa' || '/change-requests/e.pdf'),
  'P0001', 'first_initial', 'F: nor a first name that is');
select throws_ok(
  format($$ select request_profile_change('name', 'Staff', 'Alpha', null, %L, null) $$, :'staffa' || '/change-requests/e.pdf'),
  'P0001', 'unchanged', 'F: the refusals that were there still are');
reset role;
select is((select count(*)::int from profile_change_requests where staff_id = :'staffa'), 0,
  'F: none of them filed a request');

-- =====================================================================
-- G · §1.7 — removal keeps what happened, not what anyone wrote about it
-- =====================================================================
select set_config('request.jwt.claims', '', true);
select lives_ok(format($$ select remove_worker(%L, now(), %L) $$, :'w_init', :'admin_uid'),
  'G: remove_worker() runs with a corrected name in place');
select is((select data ->> 'reason' from audit_log where action = 'staff.name_corrected' and entity_id = :'w_init'),
  'Removed under GDPR (§1.7)', 'G: the reason is overwritten');
select is((select data ? 'firstName' or data ? 'lastName'
             from audit_log where action = 'staff.name_corrected' and entity_id = :'w_init'),
  false, 'G: and the names are gone from the row');
select is((select count(*)::int from notification_outbox
            where template = 'RC4' and key like 'RC4:correction:' || :'w_init' || ':%'),
  0, 'G: the payroll copy does not outlive the removal');
select is((select count(*)::int from notification_outbox
            where template = 'RC4' and payload::text ~* 'Marc|Martinez'),
  0, 'G: and no payroll email anywhere still carries either name');

select * from finish();
rollback;
