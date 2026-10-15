-- =====================================================================
-- 841 · /staff/roster: why an applicant has no Payroll ID, and Link for
--       them (20261015120000, ADR-0142)
--
--   A. Who can reach the new helper.
--   B. The reason for each kept row, first that fits, and the holder of a
--      taken Payroll ID; the report carries them as `kept`.
--   C. Link: a different name is refused until the office confirms it is
--      the same person; a taken Payroll ID or another one already carried
--      is refused even then; the row is consumed and audited.
-- =====================================================================
begin;
select plan(14);
\ir _shared/fixtures.psql

\set s_name '84100000-0000-4000-8000-000000000001'
\set s_take '84100000-0000-4000-8000-000000000002'
\set s_hold '84100000-0000-4000-8000-000000000003'
\set s_othr '84100000-0000-4000-8000-000000000004'
\set s_has  '84100000-0000-4000-8000-000000000005'
\set s_none '84100000-0000-4000-8000-000000000006'
\set s_plan '84100000-0000-4000-8000-000000000007'

delete from invite_roster;

insert into invite_roster (email, first_name, last_name, payroll_id, grp) values
  ('andrea@k841.test', 'Andrea', 'Gaviria', '7053',  'thc'),  -- applied as Andreu
  ('tim@k841.test',    'Tim',    'Taken',   '8001',  'thc'),  -- 8001 is Holly's
  ('ola@k841.test',    'Ola',    'Other',   '8002',  'thc'),  -- already carries Z9
  ('hal@k841.test',    'Hal',    'Has',     '8003',  'thc'),  -- already carries 8003
  ('nat@k841.test',    'Nat',    'None',    null,    'thc'),  -- the sheet gives none
  ('pia@k841.test',    'Pia',    'Plain',   '8004',  'thc'),  -- simply never applied
  ('wes@k841.test',    'Wes',    'Waiting', '8005',  'thc');  -- has not applied

insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, payroll_id) values
  (:'s_name', null, 'Andreu', 'Gaviria', 'andrea@k841.test', '+447700984101', date '2001-06-01', 'interview_requested', null),
  (:'s_take', null, 'Tim',    'Taken',   'tim@k841.test',    '+447700984102', date '2001-06-02', 'interview_requested', null),
  (:'s_hold', null, 'Holly',  'Holder',  'holly@k841.test',  '+447700984103', date '2001-06-03', 'compliant',           '8001'),
  (:'s_othr', null, 'Ola',    'Other',   'ola@k841.test',    '+447700984104', date '2001-06-04', 'compliant',           'Z9'),
  (:'s_has',  null, 'Hal',    'Has',     'hal@k841.test',    '+447700984105', date '2001-06-05', 'compliant',           '8003'),
  (:'s_none', null, 'Nat',    'None',    'nat@k841.test',    '+447700984106', date '2001-06-06', 'interview_requested', null),
  (:'s_plan', null, 'Pia',    'Plain',   'pia@k841.test',    '+447700984107', date '2001-06-07', 'interview_requested', null);

-- =====================================================================
-- A · who can reach it
-- =====================================================================
select ok(not has_function_privilege('authenticated', 'invite_roster_kept()', 'execute')
      and not has_function_privilege('anon', 'invite_roster_kept()', 'execute'),
  'the reasons are internal: read through the report');
select ok(not has_function_privilege('anon', 'link_invite_roster_entry(uuid, uuid, boolean)', 'execute')
      and has_function_privilege('authenticated', 'link_invite_roster_entry(uuid, uuid, boolean)', 'execute'),
  'Link: an office session (its own checks decide who), never the public');

-- =====================================================================
-- B · the reasons
-- =====================================================================
select is(
  (select array_agg(r.email || '=' || k.reason order by r.email)
     from invite_roster_kept() k join invite_roster r on r.id = k.entry_id),
  array['andrea@k841.test=name_differs', 'hal@k841.test=already_has', 'nat@k841.test=no_payroll_id',
        'ola@k841.test=other_payroll_id', 'pia@k841.test=not_applied', 'tim@k841.test=payroll_id_taken'],
  'each applied row has its reason; Wes, who has not applied, is not among them');
select is(
  (select array[k.staff_name, k.holder_id::text, k.holder_name]
     from invite_roster_kept() k join invite_roster r on r.id = k.entry_id where r.email = 'tim@k841.test'),
  array['Tim Taken', :'s_hold', 'Holly Holder'], 'a taken Payroll ID names who holds it');
select is(
  (select k.staff_name from invite_roster_kept() k join invite_roster r on r.id = k.entry_id
    where r.email = 'andrea@k841.test'),
  'Andreu Gaviria', 'and the name they applied under');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table rep on commit drop as select invite_roster_report() as r;
reset role;
select is((select jsonb_array_length(r -> 'kept') from rep), 6, 'the report carries all six');
select is((select k ->> 'reason' from rep, jsonb_array_elements(r -> 'kept') k where k ->> 'staffId' = :'s_take'),
  'payroll_id_taken', 'with the reason');

-- =====================================================================
-- C · Link
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(format($$ select link_invite_roster_entry((select id from invite_roster where email = 'andrea@k841.test'), %L) $$, :'s_name'),
  'P0001', 'name_mismatch', 'a different name is refused without the office''s word');
select is(link_invite_roster_entry((select id from invite_roster where email = 'andrea@k841.test'), :'s_name', true) ->> 'payrollId',
  '7053', 'with it, Andreu gets 7053');
select throws_ok(format($$ select link_invite_roster_entry((select id from invite_roster where email = 'tim@k841.test'), %L, true) $$, :'s_take'),
  'P0001', 'payroll_id_taken', 'a Payroll ID somebody else holds is refused, even confirmed');
select throws_ok(format($$ select link_invite_roster_entry((select id from invite_roster where email = 'ola@k841.test'), %L, true) $$, :'s_othr'),
  'P0001', 'has_other_payroll_id', 'and so is one when they already carry another');
select is(link_invite_roster_entry((select id from invite_roster where email = 'hal@k841.test'), :'s_has') ->> 'payrollId',
  '8003', 'a left-over row links as it is');
reset role;

select ok((select payroll_id = '7053' from staff where id = :'s_name')
      and not exists (select 1 from invite_roster where email in ('andrea@k841.test', 'hal@k841.test')),
  'the Payroll ID is theirs and both rows are consumed, so the reminders stop');
select is((select array[data ->> 'listName', data ->> 'appliedName', data ->> 'nameConfirmed']
             from audit_log where action = 'roster.linked' and entity_id = :'s_name'),
  array['Andrea Gaviria', 'Andreu Gaviria', 'true'], 'audited with both names, and that the office confirmed them');

select * from finish();
rollback;
