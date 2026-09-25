-- =====================================================================
-- 520 · Willo "create candidate" is idempotent across a lost link
--   20260926100000_willo_invite_idempotent.sql, ADR-0024 (§2.4, §2.12)
--
--   A. Only the service role reaches willo_invite_created; the new
--      functions are definer with a pinned search_path.
--   B. willo_invite_created records the key and links it in one call;
--      repeats are no-ops; a candidate who moved on keeps the record.
--   C. willo_invite_due hands an unlinked recorded key back as
--      known_candidate_id — the sweep links it instead of creating (and
--      Willo sending E1) again.
--   D. A Reset retires the old key into prior_candidate_ids, so a lookup
--      never re-links last period's interview; a GDPR removal does not
--      write the key down again.
-- =====================================================================
begin;
select plan(23);
\ir _shared/fixtures.psql

\set c_one   '52000000-0000-4000-8000-000000000001'
\set c_two   '52000000-0000-4000-8000-000000000002'
\set c_gone  '52000000-0000-4000-8000-000000000003'
\set c_rst   '52000000-0000-4000-8000-000000000004'
\set c_rm    '52000000-0000-4000-8000-000000000005'

insert into staff (id, first_name, last_name, email, phone, dob, status, willo_candidate_id) values
  (:'c_one',  'Una', 'One',   'una@w520.test',  '+447700952001', date '2001-01-01', 'interview_requested', null),
  (:'c_two',  'Tod', 'Two',   'tod@w520.test',  '+447700952002', date '2001-02-02', 'interview_requested', null),
  (:'c_gone', 'Gil', 'Gone',  'gil@w520.test',  '+447700952003', date '2001-03-03', 'interview_completed', 'W-gil'),
  (:'c_rst',  'Rae', 'Reset', 'rae@w520.test',  '+447700952004', date '2001-04-04', 'rejected',            'W-rae-old'),
  (:'c_rm',   'Rem', 'Moved', 'rem@w520.test',  '+447700952005', date '2001-05-05', 'interview_completed', 'W-rem');

-- =====================================================================
-- A · privileges
-- =====================================================================
select is_empty(
  $$ select p.proname::text || ' → ' || r.rolname
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       cross join (values ('anon'), ('authenticated')) r(rolname)
      where n.nspname = 'public'
        and p.proname in ('willo_invite_created', 'willo_invite_due', 'staff_willo_candidate_retired')
        and has_function_privilege(r.rolname, p.oid, 'execute') $$,
  'neither anon nor a signed-in account can record a Willo key or lease the queue');
select ok(has_function_privilege('service_role', 'public.willo_invite_created(uuid, text, timestamptz)', 'execute')
      and has_function_privilege('service_role', 'public.willo_invite_due(integer, timestamptz)', 'execute'),
  'the service role (the Edge Function) can call both');
select is_empty(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('willo_invite_created', 'willo_invite_due', 'staff_willo_candidate_retired')
        and not (p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=%') $$,
  'every function here is security definer with a pinned search_path');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select throws_ok($$ select willo_invite_created('52000000-0000-4000-8000-000000000001', 'W-x') $$,
  '42501', null, 'a worker cannot attach a Willo interview to anybody');
reset role;

-- =====================================================================
-- B · record + link
-- =====================================================================
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select throws_ok($$ select willo_invite_created('52000000-0000-4000-8000-000000000001', '  ') $$,
  '22023', 'willo_candidate_id_required', 'a blank key is refused');
select is(willo_invite_created(:'c_one', 'W-una') ->> 'outcome', 'linked',
  'the key Willo returned is linked');
select is(willo_invite_created(:'c_one', 'W-una') ->> 'outcome', 'already_linked',
  'the same answer twice (a retried record) is a no-op');
select is(willo_invite_created(:'c_gone', 'W-gil-2') ->> 'code', 'has_other_candidate',
  'a second key for someone already linked is not linked over the first');
select is(willo_invite_created(:'c_two', 'W-una') ->> 'code', 'key_in_use',
  'a key somebody else holds is never linked to a second person');
reset role;
select is((select willo_candidate_id from staff where id = :'c_one'), 'W-una', 'the link is on the staff row');
select is((select count(*)::int from audit_log
            where entity_id = :'c_one' and action = 'willo_invite_created'), 1,
  'recorded once, however many times Willo''s answer is replayed');
select is((select count(*)::int from audit_log
            where entity_id = :'c_gone' and action = 'willo_invite_created'
              and data ->> 'willoCandidateId' = 'W-gil-2'), 1,
  'an unlinked key is still on file, so the office can find the duplicate in Willo');

-- =====================================================================
-- C · the lost link — the defect in docs/14 §4
--   Make the link itself fail (a trigger that raises on Tod's row, standing
--   in for a lock timeout) and show the record survives it.
-- =====================================================================
update staff set onboarding_started_at = now() - interval '1 hour' where id = :'c_two';
create function pg_temp.w520_fail_link() returns trigger language plpgsql as $f$
begin
  raise exception 'lock_timeout (simulated)';
end $f$;
create trigger w520_fail_link before update of willo_candidate_id on staff
  for each row when (new.id = '52000000-0000-4000-8000-000000000002')
  execute function pg_temp.w520_fail_link();

set local role service_role;
select is(willo_invite_created(:'c_two', 'W-tod') ->> 'code', 'link_failed',
  'a link that fails answers not_linked/link_failed instead of raising');
reset role;
drop trigger w520_fail_link on staff;
select is((select willo_candidate_id from staff where id = :'c_two'), null::text,
  'Tod is not linked…');

set local role service_role;
select is((select known_candidate_id from willo_invite_due(50) where staff_id = :'c_two'), 'W-tod',
  'the next lease hands the recorded key back: link it, do not create again');
select is(willo_invite_created(:'c_two', 'W-tod') ->> 'outcome', 'linked',
  'and linking it succeeds');
select is((select count(*)::int from willo_invite_due(50, now() + interval '1 day') where staff_id = :'c_two'), 0,
  'after which Tod is no longer due');
reset role;

-- =====================================================================
-- D · Reset and removal
-- =====================================================================
select lives_ok($$ select reset_to_candidate('52000000-0000-4000-8000-000000000004', 'Returning, fresh interview') $$,
  'a rejected candidate is reset');
select is((select willo_candidate_id from staff where id = :'c_rst'), null::text,
  'the reset clears the old Willo key, as before');
select is((select data ->> 'willoCandidateId' from audit_log
            where entity_id = :'c_rst' and action = 'willo_candidate_retired'), 'W-rae-old',
  'and the key it dropped is written down');
set local role service_role;
select is((select prior_candidate_ids from willo_invite_due(50) where staff_id = :'c_rst'), array['W-rae-old'],
  'so the sweep''s lookup refuses to re-link last period''s interview (§2.12: a fresh one)');
select is((select known_candidate_id from willo_invite_due(50, now() + interval '1 day') where staff_id = :'c_rst'), null::text,
  'and nothing from the old period is offered as this period''s key');
reset role;

update staff set willo_candidate_id = null, removed_at = now() where id = :'c_rm';
select is((select count(*)::int from audit_log where entity_id = :'c_rm' and action = 'willo_candidate_retired'), 0,
  'a GDPR removal clearing the key does not write it down again (§1.7)');

select * from finish();
rollback;
