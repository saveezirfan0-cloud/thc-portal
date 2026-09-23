-- =====================================================================
-- 512 · Creating a candidate in Willo happens at most once
--   20260924170000_willo_invite_idempotent.sql, ADR-0021 (§2.4, §2.12)
--
-- The defect this holds shut (docs/14 §4): Willo creates the candidate
-- and sends E1, the local link then fails transiently, and the next sweep
-- creates them AGAIN — a second Willo candidate and a second interview
-- invitation to a real person.
--
--   A. Who can call what, and a blank key is refused.
--   B. A first attempt is a `create` with no key to re-link.
--   C. The key is recorded and linked; a repeat is `already_linked`.
--   D. THE DEFECT: a key we hold but could not link comes back as
--      `relink`, and the retry links it instead of creating.
--   E. Terminal is told from transient by an OUTCOME, not an error, and
--      the key is written down before the link is even attempted.
--   F. A key that can never be ours is orphaned, and an orphan releases
--      the candidate to create again rather than re-linking for ever.
--   G. `unknown` (a timeout) recovers with the SAME reference; `no` (a
--      refusal) simply creates again.
--   H. `yes` with no key HOLDS the candidate: no second E1. A Reset is
--      the way back.
--   I. A Reset between the create and the link supersedes the key.
-- =====================================================================
begin;
select plan(36);
\ir _shared/fixtures.psql

\set w_link    '51200000-0000-4000-8000-000000000001'
\set w_lost    '51200000-0000-4000-8000-000000000002'
\set w_gone    '51200000-0000-4000-8000-000000000003'
\set w_reset   '51200000-0000-4000-8000-000000000004'
\set w_held    '51200000-0000-4000-8000-000000000005'
\set w_unknown '51200000-0000-4000-8000-000000000006'
\set w_no      '51200000-0000-4000-8000-000000000007'
\set w_taken   '51200000-0000-4000-8000-000000000008'

insert into staff (id, first_name, last_name, email, phone, dob, status, onboarding_started_at) values
  (:'w_link',    'Lin', 'Ok',      'lin@willo2.test', '+447700951001', date '2000-01-01', 'interview_requested', now() - interval '1 hour'),
  (:'w_lost',    'Lou', 'Lost',    'lou@willo2.test', '+447700951002', date '2000-02-02', 'interview_requested', now() - interval '1 hour'),
  (:'w_gone',    'Gil', 'Gone',    'gil@willo2.test', '+447700951003', date '2000-03-03', 'interview_requested', now() - interval '1 hour'),
  (:'w_reset',   'Rae', 'Reset',   'rae@willo2.test', '+447700951004', date '2000-04-04', 'interview_requested', now() - interval '1 hour'),
  (:'w_held',    'Hal', 'Held',    'hal@willo2.test', '+447700951005', date '2000-05-05', 'interview_requested', now() - interval '1 hour'),
  (:'w_unknown', 'Una', 'Unknown', 'una@willo2.test', '+447700951006', date '2000-06-06', 'interview_requested', now() - interval '1 hour'),
  (:'w_no',      'Ned', 'No',      'ned@willo2.test', '+447700951007', date '2000-07-07', 'interview_requested', now() - interval '1 hour'),
  (:'w_taken',   'Tam', 'Taken',   'tam@willo2.test', '+447700951008', date '2000-08-08', 'interview_requested', now() - interval '1 hour');

-- =====================================================================
-- A · who can call what
-- =====================================================================
select is_empty(
  $$ select p.proname::text || ' → ' || r.rolname
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       cross join (values ('anon'), ('authenticated')) r(rolname)
      where n.nspname = 'public'
        and p.proname in ('willo_invite_due', 'willo_invite_created', 'willo_invite_failed')
        and has_function_privilege(r.rolname, p.oid, 'execute') $$,
  'no signed-in account and no anon key can lease, link or fail a Willo invitation');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('willo_invite_due', 'willo_invite_created', 'willo_invite_failed')
      and has_function_privilege('service_role', p.oid, 'execute')),
  3,
  'and re-creating the two dropped ones did not take the service role''s grant with it');

select throws_ok(
  $$ select willo_invite_created('51200000-0000-4000-8000-000000000001', '   ') $$,
  '22023', null,
  'a blank Willo key is refused: a candidate that looked linked would have every webhook refused as unknown');

-- =====================================================================
-- B · sweep A — every one of them is a first attempt
-- =====================================================================
create temp table sweep_a as select * from willo_invite_due(200, now());

select is((select invite_mode from sweep_a where staff_id = :'w_link'), 'create',
  'a candidate nothing has reached Willo for is offered as a create');
select is((select created_candidate_id from sweep_a where staff_id = :'w_link'), null::text,
  'and carries no key to re-link');

-- =====================================================================
-- C · the happy path: recorded, linked, and idempotent on a repeat
-- =====================================================================
select is(
  willo_invite_created(:'w_link', 'W-link-1', (select invite_ref from sweep_a where staff_id = :'w_link')) ->> 'outcome',
  'linked',
  'the key Willo returned is recorded and linked');
select is((select willo_candidate_id from staff where id = :'w_link'), 'W-link-1',
  'the candidate now carries it');
select is(
  willo_invite_created(:'w_link', 'W-link-1', (select invite_ref from sweep_a where staff_id = :'w_link')) ->> 'outcome',
  'already_linked',
  'a repeat — the nudge and the schedule both landing it — is a no-op, not an error');
select is(
  (select count(*)::int from audit_log where entity_id = :'w_link' and action = 'willo_invite_orphan'),
  0,
  'and nothing is orphaned by a link that worked');

-- =====================================================================
-- D · THE DEFECT · created in Willo, link lost to something transient
-- =====================================================================
-- What the Edge Function writes when every retry of the record-and-link
-- call failed: the key, on the failure path, so it is not lost.
select is(
  willo_invite_failed(:'w_lost', 'created W-lost-1, not linked: deadlock detected',
                      p_willo_candidate_id => 'W-lost-1',
                      p_ref                => (select invite_ref from sweep_a where staff_id = :'w_lost'),
                      p_phase              => 'link',
                      p_created_in_willo   => 'yes',
                      p_retry              => true) ->> 'held',
  'false',
  'a failure that still holds the key does not hold the candidate: there is something to re-link');

-- The candidates that failed for each of the three certainties.
select lives_ok(
  $$ select willo_invite_failed('51200000-0000-4000-8000-000000000006', 'network: timed out',
                                p_created_in_willo => 'unknown', p_retry => true) $$,
  'a timeout is recorded as unknown, never as "not created"');
select lives_ok(
  $$ select willo_invite_failed('51200000-0000-4000-8000-000000000007', 'http_401: bad key',
                                p_created_in_willo => 'no', p_retry => false) $$,
  'a refusal is recorded as "not created"');
select is(
  willo_invite_failed(:'w_held', 'response_without_candidate_key', p_created_in_willo => 'yes') ->> 'held',
  'true',
  'Willo created them and we cannot name them: the candidate is held');

-- Rejected between the create and the link — the terminal case.
update staff set status = 'rejected' where id = :'w_gone';
create temp table gone_said as
  select willo_invite_created(:'w_gone', 'W-gone-1',
                              (select invite_ref from sweep_a where staff_id = :'w_gone')) as said;

-- Somebody else's key.
create temp table taken_said as
  select willo_invite_created(:'w_taken', 'W-link-1',
                              (select invite_ref from sweep_a where staff_id = :'w_taken')) as said;

create temp table sweep_b as select * from willo_invite_due(200, now() + interval '6 minutes');

select is((select invite_mode from sweep_b where staff_id = :'w_lost'), 'relink',
  'the next sweep re-links the candidate Willo already created — it does NOT create a second one');
select is((select created_candidate_id from sweep_b where staff_id = :'w_lost'), 'W-lost-1',
  'and hands back the key it kept');
select is(
  willo_invite_created(:'w_lost', 'W-lost-1', (select invite_ref from sweep_b where staff_id = :'w_lost')) ->> 'outcome',
  'linked',
  'the retry links it');
select is((select willo_candidate_id from staff where id = :'w_lost'), 'W-lost-1',
  'so one Willo candidate, one E1, however often the link failed first');

-- =====================================================================
-- E · terminal is an outcome, not an error — and the key is written down
--     before anything decides not to link it
-- =====================================================================
select is((select said ->> 'outcome' from gone_said), 'not_awaiting_interview',
  'a candidate rejected between the create and the link is answered, not raised at');
select is((select said ->> 'terminal' from gone_said), 'true',
  'and is marked terminal: no retry can change it, so the sweep must not treat it as a blip');
select is((select said ->> 'linked' from gone_said), 'false',
  'nothing is linked');
select is((select willo_candidate_id from staff where id = :'w_gone'), null::text,
  'a rejected candidate is not quietly given a Willo interview');
select is(
  (select count(*)::int from audit_log
    where entity_id = :'w_gone' and action = 'willo_invite_created'
      and data ->> 'willoCandidateId' = 'W-gone-1'),
  1,
  'the key is recorded BEFORE the link is attempted, so a link that fails cannot lose it');
select is(
  (select count(*)::int from audit_log
    where entity_id = :'w_gone' and action = 'willo_invite_orphan'
      and data ->> 'willoCandidateId' = 'W-gone-1'),
  1,
  'and the Willo candidate that now belongs to nobody is audited for removal there');

-- =====================================================================
-- F · a key that is somebody else's, and what an orphan releases
-- =====================================================================
select is((select said ->> 'outcome' from taken_said), 'candidate_taken',
  'a key another person already carries is an outcome, not a unique-violation exception');
select is((select willo_candidate_id from staff where id = :'w_taken'), null::text,
  'and nothing is linked');
select is((select invite_mode from sweep_b where staff_id = :'w_taken'), 'create',
  'the orphan releases the candidate to create again, so a terminal outcome cannot wedge the sweep in a re-link loop');

-- =====================================================================
-- G · a timeout recovers with the same reference; a refusal just creates
-- =====================================================================
select is((select invite_mode from sweep_b where staff_id = :'w_unknown'), 'recover',
  'an attempt that left the create in doubt is offered again as a recovery, not as a fresh create');
select is(
  (select invite_ref from sweep_b where staff_id = :'w_unknown'),
  (select invite_ref from sweep_a where staff_id = :'w_unknown'),
  'reusing the SAME reference, so an API that honours an idempotency key returns the first candidate');
select is((select invite_mode from sweep_b where staff_id = :'w_no'), 'create',
  'an attempt Willo refused outright created nothing, so the next one is an ordinary create');
select isnt(
  (select invite_ref from sweep_b where staff_id = :'w_no'),
  (select invite_ref from sweep_a where staff_id = :'w_no'),
  'with a reference of its own');

-- =====================================================================
-- H · held: never a second E1, and Reset is the way back
-- =====================================================================
select is((select count(*)::int from sweep_b where staff_id = :'w_held'), 0,
  'a held candidate is not offered again: a second create would be a second E1 to a real person');
select is(
  (select count(*)::int from willo_invite_due(200, now() + interval '9 hours') where staff_id = :'w_held'),
  0,
  'not at any backoff — being held is not waiting');

-- §2.12: a Reset is a new onboarding period, and the hold belonged to the
-- old one. This is the office's way back for a candidate Willo has and we
-- cannot name.
update staff set onboarding_started_at = now() + interval '2 days' where id = :'w_held';
select is(
  (select attempt from willo_invite_due(200, now() + interval '2 days 1 minute') where staff_id = :'w_held'),
  1,
  'a Reset lifts the hold: a new period invites again, from attempt 1');

-- =====================================================================
-- I · a Reset between the create and the link supersedes the key
-- =====================================================================
update staff set onboarding_started_at = now() + interval '4 days' where id = :'w_reset';
select is(
  willo_invite_created(:'w_reset', 'W-reset-1', (select invite_ref from sweep_b where staff_id = :'w_reset')) ->> 'outcome',
  'superseded',
  'a key claimed before a Reset belongs to the previous interview and is not attached to the new one');
select is((select willo_candidate_id from staff where id = :'w_reset'), null::text,
  'so the new period starts with no Willo candidate');
select is(
  (select attempt from willo_invite_due(200, now() + interval '4 days 1 minute') where staff_id = :'w_reset'),
  1,
  'and §2.12 step 1 gets its fresh interview: a new period, attempt 1');

select * from finish();
rollback;
