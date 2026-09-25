-- =====================================================================
-- 601 · The office's four privileged buttons name the manager who
--       pressed them (§1.7, §9.6 — 20260927160400 §4), and the pool
--       and radius are closed to PUBLIC (20260928110800)
--
-- Block, Unblock, Reset to candidate and Remove are service-role-only
-- definers; the office reaches them through the service key, whose JWT
-- has no sub, so `coalesce(p_actor, auth.uid())` is NULL unless the
-- server action passes the manager's id. The 27.09 security audit found
-- the app half unshipped: apps/office/app/staff/[id]/actions.ts now
-- passes the session's user id as p_actor (its Vitest pins that); this
-- file pins the database half — with p_actor the audit row carries it
-- and staff_block_audit_v names the manager, and without it (the
-- service key's own view of the world) the row names nobody, which is
-- exactly why the office must never call these four bare.
-- =====================================================================
begin;
select plan(13);
-- In the past on purpose: block/reset/remove take p_now, unblock stamps
-- now(), and staff_block_audit_v shows the LATEST row — so the fixture
-- clock has to sit before the wall clock for the unblock to be latest.
\set now '2026-09-20 12:00:00+01'
\ir _shared/fixtures.psql

\set clean 'd6010000-0000-4000-8000-000000000001'

-- 20260926120000: blanking a verified right-to-work date needs the owner-only escape.
set local thc.allow_rtw_date_clear = 'on';
update compliance_docs set expiry_date = null, right_to_work_until = null, uploaded_at = :'now'::timestamptz;
set local thc.allow_rtw_date_clear = 'off';
update staff set right_to_work_until = null, term_dates = '{}';

-- A worker Unblock will accept back (220's `clean`): one live passport,
-- contract signed, nothing outstanding.
insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch,
                   employee_id, graduated_at, term_dates, wtr_optout, share_code,
                   contract_signed_at, contract_version, quiz_attempts) values
  (:'clean','Clean','One', 'a601@rls.test','+447700960101', date '1995-01-01','compliant','uk_irish',
   96011, null, '{}', false, null, '2026-01-01 10:00+00','v1.2', 2);
insert into compliance_docs (id, staff_id, doc_type, review_status, expiry_date, uploaded_at) values
  ('e6010000-0000-4000-8000-000000000001', :'clean','passport','verified', date '2031-01-01', :'now'::timestamptz);

-- No JWT: this is what the service key looks like from inside the database.
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------
-- 1 · Block, with the manager's id
-- ---------------------------------------------------------------------
select lives_ok(
  format('select block_worker_manually(%L, %L, %L::timestamptz, %L)', :'clean', 'Late twice in a week', :'now', :'admin_uid'),
  '§9.6 Block with p_actor');
select is((select actor from audit_log where entity = 'staff' and entity_id = :'clean' and action = 'block_manual'),
  :'admin_uid'::uuid,
  'the block_manual audit row carries the manager as actor');
select is((select actor_name from staff_block_audit_v where staff_id = :'clean'), 'Gisela M.',
  'and staff_block_audit_v names them, so the §9.6 banner can say who blocked');

-- ---------------------------------------------------------------------
-- 2 · Unblock, with the manager's id
-- ---------------------------------------------------------------------
select is((unblock_worker(:'clean', date '2026-09-20', :'admin_uid'))->>'unblocked', 'true',
  '§9.6 Unblock with p_actor lifts the block (nothing outstanding)');
select is((select actor from audit_log where entity = 'staff' and entity_id = :'clean' and action = 'unblock'),
  :'admin_uid'::uuid,
  'the unblock audit row carries the manager as actor');
select is((select actor_name || ' · ' || action from staff_block_audit_v where staff_id = :'clean'), 'Gisela M. · unblock',
  'and the banner view now shows the unblock, by the same manager');

-- ---------------------------------------------------------------------
-- 3 · Reset to candidate, with the manager's id
-- ---------------------------------------------------------------------
select lives_ok(
  format('select block_worker_manually(%L, %L, %L::timestamptz, %L)', :'clean', 'Left mid-shift', :'now', :'admin_uid'),
  'blocked again, so a reset is allowed');
select lives_ok(
  format('select reset_to_candidate(%L, %L, %L::timestamptz, %L)', :'clean', 'Returning next season', :'now', :'admin_uid'),
  '§9.6 Reset to candidate with p_actor');
select is((select actor from audit_log where entity = 'staff' and entity_id = :'clean' and action = 'reset_to_candidate'),
  :'admin_uid'::uuid,
  'the reset_to_candidate audit row carries the manager as actor');

-- ---------------------------------------------------------------------
-- 4 · Remove (§1.7), with the manager's id
-- ---------------------------------------------------------------------
select lives_ok(
  format('select remove_worker(%L, %L::timestamptz, %L)', :'staffb', :'now', :'admin_uid'),
  '§1.7 Remove with p_actor');
select is((select actor from audit_log where entity = 'staff' and entity_id = :'staffb' and action = 'gdpr_remove'),
  :'admin_uid'::uuid,
  'the irreversible gdpr_remove audit row carries the manager as actor');

-- ---------------------------------------------------------------------
-- 5 · The contrast the office must never ship: bare, through the
--     service key, the row names nobody. Pinned so the meaning of
--     "actor is null" stays "the caller forgot p_actor", not "the
--     database dropped it".
-- ---------------------------------------------------------------------
select block_worker_manually(:'staffa', 'No p_actor', :'now'::timestamptz);
select is((select actor_name is null and actor is null from staff_block_audit_v where staff_id = :'staffa'), true,
  'without p_actor and without a JWT sub the audit row has no actor — the service key alone cannot name a manager');

-- ---------------------------------------------------------------------
-- 6 · 20260928110800: the pool and its radius are revoked from PUBLIC
--     and anon, and still callable by the office and the jobs.
-- ---------------------------------------------------------------------
select ok(
      not has_function_privilege('anon',          'public.auto_assign_candidates(uuid, boolean)', 'execute')
  and not has_function_privilege('public',        'public.auto_assign_candidates(uuid, boolean)', 'execute')
  and not has_function_privilege('anon',          'public.escalation_radius_miles()',            'execute')
  and not has_function_privilege('public',        'public.escalation_radius_miles()',            'execute')
  and     has_function_privilege('authenticated', 'public.auto_assign_candidates(uuid, boolean)', 'execute')
  and     has_function_privilege('service_role',  'public.auto_assign_candidates(uuid, boolean)', 'execute')
  and     has_function_privilege('authenticated', 'public.escalation_radius_miles()',            'execute')
  and     has_function_privilege('service_role',  'public.escalation_radius_miles()',            'execute'),
  'auto_assign_candidates(uuid, boolean) and escalation_radius_miles() are closed to PUBLIC and anon, open to authenticated and service_role');

select * from finish();
rollback;
