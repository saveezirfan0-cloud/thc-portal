-- =====================================================================
-- 814 · A SpudBros person who applied under another email skips the
--       interview too (20261013190000, ADR-0125)
--
--   A. Nobody but the sweep reaches the new functions.
--   B. Who is paired: a candidate awaiting the interview, not SpudBros, no
--      Payroll ID, not on the list by address, never placed by the list or
--      the office, with the name of a SpudBros row nobody applied for.
--   C. willo_invite_due() never invites them; THC's own still are.
--   D. spudbros_skip_due() marks them SpudBros first (audited, no Payroll
--      ID, the row stays) and leases them; spudbros_skip_interview() then
--      takes them to Documents. The office's Link still works afterwards.
-- =====================================================================
begin;
select plan(17);
\ir _shared/fixtures.psql

\set s_char '81400000-0000-4000-8000-000000000001'
\set s_new  '81400000-0000-4000-8000-000000000002'
\set s_thc  '81400000-0000-4000-8000-000000000003'
\set s_off  '81400000-0000-4000-8000-000000000004'
\set s_docs '81400000-0000-4000-8000-000000000005'
\set s_own  '81400000-0000-4000-8000-000000000006'
\set u_char '81400000-0000-4000-8000-0000000000a1'
\set link1  'https://staff.test/activate/c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1'
\set install 'https://staff.test/install'

delete from invite_roster;

insert into invite_roster (email, first_name, last_name, payroll_id, grp) values
  ('charlottecs@r814.test', 'Charlotte', 'Crossley-Smith', '4162', 'spudbros'),  -- applied as cc@, Willo already sent
  ('paddy@r814.test',       'Paddy',     'Potato',         '4170', 'spudbros'),  -- applied as pp@, not yet in Willo
  ('tom@r814.test',         'Tom',       'Tater',          '4180', 'thc'),       -- THC's own, applied as tt@
  ('olga@r814.test',        'Olga',      'Office',         '4190', 'spudbros'),  -- the office said: not SpudBros
  ('dan@r814.test',         'Dan',       'Docs',           '4200', 'spudbros'),  -- already past the interview
  ('owen@r814.test',        'Owen',      'Own',            '4210', 'spudbros'),  -- a namesake, but Owen's own
  ('owen.own@r814.test',    'Owen',      'Own',            null,   'thc');       -- address is on the list as THC

insert into auth.users (id, email, raw_app_meta_data, encrypted_password) values
  (:'u_char', 'cc@r814.test', '{"role":"staff"}', '');

insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, willo_candidate_id) values
  (:'s_char', null, 'Charlotte', 'Crossley-Smith', 'cc@r814.test',       '+447700981401', date '2003-04-01', 'interview_requested', 'W-char'),
  (:'s_new',  null, 'Paddy',     'Potato',         'pp@r814.test',       '+447700981402', date '2003-04-02', 'interview_requested', null),
  (:'s_thc',  null, 'Tom',       'Tater',          'tt@r814.test',       '+447700981403', date '2003-04-03', 'interview_requested', null),
  (:'s_off',  null, 'Olga',      'Office',         'oo@r814.test',       '+447700981404', date '2003-04-04', 'interview_requested', null),
  (:'s_docs', null, 'Dan',       'Docs',           'dd@r814.test',       '+447700981405', date '2003-04-05', 'documents',           null),
  (:'s_own',  null, 'Owen',      'Own',            'owen.own@r814.test', '+447700981406', date '2003-04-06', 'interview_requested', null);

-- The office unticked SpudBros on Olga's profile.
insert into audit_log (actor, action, entity, entity_id, data)
values (:'admin_uid', 'staff.scheduling_set', 'staff', :'s_off',
        jsonb_build_object('staffId', :'s_off', 'spudbrosExpress', false, 'thcShiftsEnabled', false));

-- =====================================================================
-- A · who can reach them
-- =====================================================================
select is_empty(
  $$ select p.proname::text || ' → ' || r.rolname
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       cross join (values ('anon'), ('authenticated')) r(rolname)
      where n.nspname = 'public'
        and p.proname in ('spudbros_listed_by_name', 'spudbros_mark_listed_by_name')
        and has_function_privilege(r.rolname, p.oid, 'execute') $$,
  'no session can read the pairing or mark anyone');

-- =====================================================================
-- B · who is paired
-- =====================================================================
select is((select array_agg(staff_id order by staff_id) from spudbros_listed_by_name()
            where staff_id::text like '81400000-%'),
  array[:'s_char', :'s_new']::uuid[],
  'the SpudBros people who applied under another address, and nobody the list, the office or the stage rules out');
select is((select entry_email from spudbros_listed_by_name() where staff_id = :'s_char'),
  'charlottecs@r814.test', 'paired with their row on the list');

-- =====================================================================
-- C · no Willo invitation for them
-- =====================================================================
select is((select array_agg(staff_id order by staff_id) from willo_invite_due(1000)
            where staff_id::text like '81400000-%'),
  array[:'s_thc', :'s_off', :'s_own']::uuid[],
  'willo_invite_due leaves out the SpudBros applicant listed under another address; THC''s own are still invited');

-- =====================================================================
-- D · marked, then moved to Documents
-- =====================================================================
select is((select array_agg(staff_id order by staff_id) from spudbros_skip_due(50)
            where staff_id::text like '81400000-%'),
  array[:'s_char', :'s_new']::uuid[],
  'the sweep marks them and leases them to skip the interview — the one already sent Willo too');
select is((select count(*)::int from staff
            where id in (:'s_char', :'s_new') and spudbros_express and not thc_shifts_enabled),
  2,
  'they are SpudBros Express now, THC shifts off');
select is((select data -> 'listEmails' from audit_log
            where entity_id = :'s_char' and action = 'roster.spudbros_by_name'),
  '["charlottecs@r814.test"]'::jsonb, 'audited with the list address they were paired on');
select is((select array[coalesce(s.payroll_id, 'none'), (select count(*)::text from invite_roster where email = 'charlottecs@r814.test')]
             from staff s where s.id = :'s_char'),
  array['none', '1'], 'no Payroll ID moves and the row stays for the office''s Link');
select is((select count(*)::int from staff
            where id in (:'s_thc', :'s_off', :'s_docs', :'s_own') and spudbros_express),
  0, 'THC''s own, the one the office placed, one past the interview, and one listed by address are not marked');
select is(spudbros_mark_listed_by_name(), 0, 'marking again marks nobody');

select is(spudbros_skip_interview(:'s_char', :'u_char', :'link1', :'install') ->> 'outcome',
  'documents', 'the skip takes them to Documents');
select is((select array[status::text, willo_decided_via] from staff where id = :'s_char'),
  array['documents', 'spudbros'], 'as a SpudBros skip');
select is((select count(*)::int from notification_outbox where key like 'E3:staff:' || :'s_char' || ':%'),
  1, 'and E3 is queued');
select is((select count(*)::int from spudbros_listed_by_name() where staff_id = :'s_char'),
  0, 'once past the interview they are paired no more');

-- The office still gives the Payroll ID with Link.
select is((select count(*)::int from invite_roster_possible_matches() where staff_id = :'s_char'),
  1, 'the row is still offered to the office as a possible match');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(link_invite_roster_entry((select id from invite_roster where email = 'charlottecs@r814.test'), :'s_char') ->> 'spudbros',
  'unchanged', 'Link applies the row and finds them SpudBros already');
reset role;
select is((select payroll_id from staff where id = :'s_char'), '4162', 'with their Payroll ID');

select * from finish();
rollback;
