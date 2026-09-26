-- =====================================================================
-- 711 · The office's emergency contact, and the other /staff/:id reads
--   20260930203000_office_staff_additions.sql · docs/19 §1, §2, §5
--   ADR-0043, ADR-0044, ADR-0047
--
--   A. Shape: the seven office functions are definers with a pinned
--      search_path, and none is executable by PUBLIC or anon (190 2e/2f).
--   B. office_save_emergency_contact: separators stripped to E.164, the
--      admin recorded as updated_by, audit_log written with the changed
--      FIELD NAMES and never the values; bad phone / name / relationship
--      refused; a removed or unknown worker refused.
--   C. office_emergency_contact: "by the office" names the manager, "by
--      the worker" names nobody; null when there is none.
--   D. office_clear_emergency_contact: audited when it clears; clearing
--      nothing is a no-op with no audit row.
--   E. office_staff_unavailability: the next 8 weeks only; a repeat series
--      reports its size and last start; a confirmed booking is matched on
--      the ROLE SECTION's window, half-open (RULE-18).
--   F. office_staff_referrals: code, "referred by", everyone who applied
--      with the code; a removed person reads "Deleted account #id".
--   G. Nobody but the office: a worker, a client and anon are refused.
--
-- Fixture rows are written as the owner, never through Agent B's worker
-- RPCs (docs/19 §8: C tests with owner-inserted fixtures).
-- =====================================================================
begin;
select plan(41);
\ir _shared/fixtures.psql

\set removed_staff '66100000-0000-4000-8000-000000000001'
\set cand_c        '66100000-0000-4000-8000-000000000002'
\set cand_d        '66100000-0000-4000-8000-000000000003'
\set app_c         '66110000-0000-4000-8000-000000000001'
\set app_d         '66110000-0000-4000-8000-000000000002'
\set una_day       '66120000-0000-4000-8000-000000000001'
\set una_s1        '66120000-0000-4000-8000-000000000002'
\set una_s2        '66120000-0000-4000-8000-000000000003'
\set una_s3        '66120000-0000-4000-8000-000000000004'
\set una_far       '66120000-0000-4000-8000-000000000005'
\set una_past      '66120000-0000-4000-8000-000000000006'
\set una_edge      '66120000-0000-4000-8000-000000000007'
\set una_over      '66120000-0000-4000-8000-000000000008'
\set series        '66130000-0000-4000-8000-000000000001'

-- A worker already removed under §1.7 (inserted as such: the purge
-- trigger fires on UPDATE of removed_at, and there is nothing to purge).
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status, removed_at) values
  (:'removed_staff', 96101, 'Deleted', 'account', 'removed-661@rls.test', '+447700966101',
   date '1990-01-01', 'removed', now() - interval '1 day');

-- =====================================================================
-- A · Shape
-- =====================================================================
select is_empty(
  $$ select p.proname::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('office_save_emergency_contact', 'office_clear_emergency_contact',
                          'office_decide_profile_change', 'office_profile_change_requests',
                          'office_emergency_contact', 'office_staff_unavailability',
                          'office_staff_referrals')
        and not (p.prosecdef
                 and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) $$,
  'A: every office function is security definer with a pinned search_path');

select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('office_save_emergency_contact', 'office_clear_emergency_contact',
                        'office_decide_profile_change', 'office_profile_change_requests',
                        'office_emergency_contact', 'office_staff_unavailability',
                        'office_staff_referrals')),
  7, 'A: all seven exist, one signature each');

select is_empty(
  $$ select p.proname::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname like 'office\_%'
        and p.proname in ('office_save_emergency_contact', 'office_clear_emergency_contact',
                          'office_decide_profile_change', 'office_profile_change_requests',
                          'office_emergency_contact', 'office_staff_unavailability',
                          'office_staff_referrals')
        and (has_function_privilege('anon', p.oid, 'execute')
             or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                         where x.grantee = 0 and x.privilege_type = 'EXECUTE')) $$,
  'A: none is executable by anon or PUBLIC');

-- =====================================================================
-- B · office_save_emergency_contact, as the office
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  office_save_emergency_contact(:'staffa', '  Maria Lopez ', 'Parent', ' +44 (7700) 900-123 ') ->> 'created',
  'true', 'B: the office saves a contact the worker never set');
select results_eq(
  format($$ select name, relationship, phone, updated_by from staff_emergency_contacts where staff_id = %L $$, :'staffa'),
  format($$ values ('Maria Lopez'::text, 'Parent'::text, '+447700900123'::text, %L::uuid) $$, :'admin_uid'),
  'B: trimmed, separators stripped to E.164, and the manager recorded as updated_by');
select is(
  (select count(*)::int from audit_log
    where action = 'emergency_contact.office_save' and entity = 'staff'
      and entity_id = :'staffa' and actor = :'admin_uid'),
  1, 'B: one audit_log row naming the manager (docs/19 §0.3)');
select is(
  (select data from audit_log
    where action = 'emergency_contact.office_save' and entity_id = :'staffa'),
  '{"created": true, "changed": ["name", "relationship", "phone"]}'::jsonb,
  'B: the audit row records which fields — never the values (a third party''s personal data)');

select is(
  office_save_emergency_contact(:'staffa', 'Maria Lopez', 'Parent', '+447700900999') -> 'changed',
  '["phone"]'::jsonb, 'B: a second save reports only what moved');
select is(
  (select count(*)::int from audit_log
    where action = 'emergency_contact.office_save' and entity_id = :'staffa'
      and data::text ~ '(Maria|Lopez|7700900)'),
  0, 'B: no audit row carries the contact''s name or number');

select throws_ok(
  format($$ select office_save_emergency_contact(%L, 'Maria', 'Parent', '07700900123') $$, :'staffa'),
  '22023', 'bad_phone', 'B: a number without its country code is refused (E.164, the /apply rule)');
select throws_ok(
  format($$ select office_save_emergency_contact(%L, '   ', 'Parent', '+447700900123') $$, :'staffa'),
  '22023', 'bad_name', 'B: an empty name is refused');
select throws_ok(
  format($$ select office_save_emergency_contact(%L, 'Maria', %L, '+447700900123') $$, :'staffa', repeat('x', 41)),
  '22023', 'bad_relationship', 'B: a relationship over 40 characters is refused');
select throws_ok(
  format($$ select office_save_emergency_contact(%L, 'Maria', 'Parent', '+447700900123') $$, :'removed_staff'),
  'P0001', 'staff_removed', 'B: a removed worker''s contact cannot be put back (§1.7)');
select throws_ok(
  format($$ select office_save_emergency_contact(%L, 'Maria', 'Parent', '+447700900123') $$, :'new_id'),
  'P0002', 'staff_not_found', 'B: an unknown worker is refused');

-- =====================================================================
-- C · office_emergency_contact
-- =====================================================================
select is(
  office_emergency_contact(:'staffa') - 'updatedAt',
  '{"name": "Maria Lopez", "relationship": "Parent", "phone": "+447700900999", "updatedBy": "office", "updatedByName": "Gisela M."}'::jsonb,
  'C: the card reads the contact and "by the office · Gisela M."');

reset role;
insert into staff_emergency_contacts (staff_id, name, relationship, phone, updated_by)
values (:'staffb', 'Tom Bravo', 'Sibling', '+447700900124', :'staffb_uid');
set local role authenticated;

select is(
  office_emergency_contact(:'staffb') ->> 'updatedBy', 'worker',
  'C: a contact the worker saved reads "by the worker"');
select ok(
  (office_emergency_contact(:'staffb') -> 'updatedByName') = 'null'::jsonb,
  'C: and names nobody');

-- =====================================================================
-- D · office_clear_emergency_contact
-- =====================================================================
select is(office_clear_emergency_contact(:'staffa') ->> 'cleared', 'true', 'D: Clear removes the contact');
select is((select count(*)::int from staff_emergency_contacts where staff_id = :'staffa'), 0,
  'D: the row is gone');
select is(office_emergency_contact(:'staffa'), null, 'D: the card then reads "Not provided" (null)');
select is(office_clear_emergency_contact(:'staffa') ->> 'cleared', 'false',
  'D: clearing nothing is a no-op, not an error');
select is(
  (select count(*)::int from audit_log
    where action = 'emergency_contact.office_clear' and entity_id = :'staffa' and actor = :'admin_uid'),
  1, 'D: exactly one audit row — the clear that cleared something');
reset role;

-- =====================================================================
-- E · office_staff_unavailability (ADR-0043, RULE-18)
-- =====================================================================
-- Staff Alpha: an all-day entry on the UK date booking_a starts, a weekly
-- series of three evenings, one entry past 8 weeks, one in the past.
insert into staff_unavailability (id, staff_id, period, all_day) values
  (:'una_day', :'staffa',
   unavailability_range(((select starts_at from shift_requirements where id = :'shift_a') at time zone 'Europe/London')::date),
   true),
  (:'una_far',  :'staffa', unavailability_range(current_date + 70), true),
  (:'una_past', :'staffa', unavailability_range(current_date - 10), true);
insert into staff_unavailability (id, staff_id, period, all_day, series_id) values
  (:'una_s1', :'staffa', unavailability_range(current_date + 14, null, '18:00', '23:00'), false, :'series'),
  (:'una_s2', :'staffa', unavailability_range(current_date + 21, null, '18:00', '23:00'), false, :'series'),
  (:'una_s3', :'staffa', unavailability_range(current_date + 28, null, '18:00', '23:00'), false, :'series');
-- Staff Bravo: one entry ending exactly as shift_b's section starts (no
-- overlap, half-open), one ending a minute into it (overlap).
insert into staff_unavailability (id, staff_id, period, all_day)
select :'una_edge', :'staffb', tstzrange(sr.starts_at - interval '2 hours', sr.starts_at, '[)'), false
  from shift_requirements sr where sr.id = :'shift_b';
insert into staff_unavailability (id, staff_id, period, all_day)
select :'una_over', :'staffb', tstzrange(sr.starts_at - interval '3 hours', sr.starts_at + interval '1 minute', '[)'), false
  from shift_requirements sr where sr.id = :'shift_b';

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select results_eq(
  format($$ select id from office_staff_unavailability(%L) $$, :'staffa'),
  format($$ values (%L::uuid), (%L::uuid), (%L::uuid), (%L::uuid) $$, :'una_day', :'una_s1', :'una_s2', :'una_s3'),
  'E: the next 8 weeks, in start order — not the entry 10 weeks out, not the past one');
select is(
  (select bookings -> 0 ->> 'bookingId' from office_staff_unavailability(:'staffa') where id = :'una_day'),
  :'booking_a',
  'E: the all-day entry names the confirmed booking it overlaps');
select is(
  (select bookings -> 0 ->> 'eventTitle' from office_staff_unavailability(:'staffa') where id = :'una_day'),
  'Fixture Event A', 'E: with the event title for the link');
select results_eq(
  format($$ select series_count, series_last_start = (select lower(period) from staff_unavailability where id = %L)
              from office_staff_unavailability(%L) where series_id = %L $$, :'una_s3', :'staffa', :'series'),
  $$ values (3, true), (3, true), (3, true) $$,
  'E: every row of a weekly series reports its size and its last start ("weekly · 3 (to …)")');
select is(
  (select bookings from office_staff_unavailability(:'staffb') where id = :'una_edge'),
  '[]'::jsonb, 'E: an entry ending exactly at the section start overlaps nothing (half-open, RULE-18)');
select is(
  (select bookings -> 0 ->> 'bookingId' from office_staff_unavailability(:'staffb') where id = :'una_over'),
  :'booking_b', 'E: one ending a minute into the section overlaps it');
select throws_ok(
  format($$ select * from office_staff_unavailability(%L, now(), now() - interval '1 day') $$, :'staffa'),
  '22023', 'bad_window', 'E: an empty window is refused');
reset role;

-- =====================================================================
-- F · office_staff_referrals (ADR-0047)
-- =====================================================================
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'cand_c', 96102, 'Priya', 'Sharma', 'cand-c-661@rls.test', '+447700966102', date '1999-03-03', 'compliant');
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status, removed_at) values
  (:'cand_d', 96103, 'Deleted', 'account', 'cand-d-661@rls.test', '+447700966103', date '1998-04-04', 'removed', now());
insert into applications (id, first_name, last_name, email, phone, dob, age_band, outcome, staff_id, consented_at) values
  (:'app_c', 'Priya', 'Sharma', 'cand-c-661@rls.test', '+447700966102', date '1999-03-03', '31_40', 'returning_applicant', :'cand_c', now()),
  (:'app_d', 'Jonah', 'W', 'cand-d-661@rls.test', '+447700966103', date '1998-04-04', '31_40', 'returning_applicant', :'cand_d', now());
insert into staff_referral_codes (staff_id, code) values (:'staffa', 'K7M4Q2XP'), (:'staffb', 'HJKMNPQR');
insert into application_referrals (application_id, referrer_staff_id, candidate_staff_id, code, recorded_at) values
  (:'applic_a', :'staffb', :'staffa', 'HJKMNPQR', now() - interval '30 days'),
  (:'app_c',    :'staffa', :'cand_c', 'K7M4Q2XP', now() - interval '2 days'),
  (:'app_d',    :'staffa', :'cand_d', 'K7M4Q2XP', now() - interval '1 day');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(office_staff_referrals(:'staffa') ->> 'code', 'K7M4Q2XP', 'F: the worker''s own code');
select is(
  (office_staff_referrals(:'staffa') -> 'referredBy') - 'recordedAt' - 'staffId',
  '{"name": "Staff Bravo", "employeeId": 90002, "status": "compliant", "removed": false}'::jsonb,
  'F: "Referred by" names the referrer and their Employee ID');
select is(jsonb_array_length(office_staff_referrals(:'staffa') -> 'referred'), 2,
  'F: everyone who applied with the code is listed');
select is(
  office_staff_referrals(:'staffa') -> 'referred' -> 0 ->> 'name', 'Priya Sharma',
  'F: oldest first, by name');
select is(
  office_staff_referrals(:'staffa') -> 'referred' -> 1 ->> 'name', deleted_account_label(96103),
  'F: a removed candidate reads "Deleted account #id" (§1.7)');
select ok(
  (office_staff_referrals(:'cand_c') -> 'referredBy' ->> 'employeeId') = '90001'
  and (office_staff_referrals(:'cand_c') ->> 'code') is null,
  'F: the candidate''s own card: referred by Staff Alpha, no code of their own yet');
reset role;

-- =====================================================================
-- G · Nobody but the office
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select office_save_emergency_contact(%L, 'X', 'Y', '+447700900555') $$, :'staffa'),
  '42501', 'not_authorised', 'G staff: a worker cannot use the office''s save — not even on themselves');
select throws_ok(
  format($$ select office_clear_emergency_contact(%L) $$, :'staffb'),
  '42501', 'not_authorised', 'G staff: nor clear another worker''s');
select throws_ok(
  format($$ select office_emergency_contact(%L) $$, :'staffb'),
  '42501', 'not_authorised', 'G staff: nor read another worker''s contact');
select throws_ok(
  format($$ select * from office_staff_unavailability(%L) $$, :'staffb'),
  '42501', 'not_authorised', 'G staff: nor read another worker''s calendar');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select office_staff_referrals(%L) $$, :'staffa'),
  '42501', 'not_authorised', 'G client: a client reads nothing of this (ADR-0004/0026)');
reset role;

select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok(
  format($$ select office_emergency_contact(%L) $$, :'staffb'),
  '42501', null, 'G anon: no execute privilege at all');
reset role;

select * from finish();
rollback;
