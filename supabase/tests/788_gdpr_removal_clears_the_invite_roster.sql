-- =====================================================================
-- 788 · §1.7 removal also clears the invite list
--       20261012120200 · ADR-0107
--
-- invite_roster holds a loaded person's email, name and Payroll ID.
-- remove_worker() scrubbed every other copy and left this one. Now every
-- roster row matching the worker's email, an application's email or
-- their Payroll ID goes, and other people's rows stay.
-- =====================================================================
begin;
select plan(6);
\ir _shared/fixtures.psql

-- The fixture's application for Staff Alpha, under the address they applied with.
update applications set email = 'alpha.applied@rls.test' where id = :'applic_a';
update staff set payroll_id = 'AL-788' where id = :'staffa';

insert into invite_roster (email, first_name, last_name, grp, payroll_id) values
  ('staffa@rls.test',        'Staff', 'Alpha', 'thc', null),
  ('alpha.applied@rls.test', 'Staff', 'Alpha', 'spudbros', null),
  ('alpha.other@rls.test',   'Staff', 'Alpha', 'thc', 'AL-788'),
  ('staffb@rls.test',        'Staff', 'Bravo', 'thc', 'BR-788');

select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
select lives_ok(format($$ select remove_worker(%L, now(), %L) $$, :'staffa', :'admin_uid'),
  'the worker is removed (§1.7)');
reset role;
select set_config('request.jwt.claims', '', true);

select is((select count(*)::int from invite_roster where email = 'staffa@rls.test'), 0,
  'the roster row under their staff email is gone');
select is((select count(*)::int from invite_roster where email = 'alpha.applied@rls.test'), 0,
  'so is the one under the email they applied with');
select is((select count(*)::int from invite_roster where payroll_id = 'AL-788'), 0,
  'and the one carrying their Payroll ID under another address');
select is((select count(*)::int from invite_roster where email = 'staffb@rls.test'), 1,
  'somebody else''s row stays');
select ok(not has_function_privilege('authenticated', 'public.staff_removed_purge_invite_roster()', 'execute'),
  'the purge is a trigger function, not an RPC');

select * from finish();
rollback;
