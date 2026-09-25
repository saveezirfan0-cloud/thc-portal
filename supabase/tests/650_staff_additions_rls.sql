-- =====================================================================
-- 650 · The staff additions — who reads and writes what
--   20260930100100_staff_additions_schema.sql · docs/18 §0 · ADR-0036 … 0040
--
--   A. Shape: RLS on all seven, exactly one policy each — admin_read,
--      SELECT — and no staff, client or anon policy (docs/18 §0.1–0.3).
--   B. No client_* view depends on any of the seven (ADR-0004/0026): the
--      client sees none of this, and a view is the only way it could.
--   C. The matrix, as each role: the office reads; a worker reads nothing,
--      not even their own rows (every read is a definer RPC, ADR-0031); a
--      client reads nothing; anon has no privilege at all; nobody but the
--      service role writes a row directly.
--   D. staff_unavailable() is invoker: a worker calling it cannot read
--      another worker's calendar — or their own.
--   E. The emergency contact CHECKs against emergencyContact.vectors.json
--      (the phone is E.164, the /apply rule; name 1–100, relationship 1–40).
--   F. The referral code CHECKs (ADR-0040).
-- =====================================================================
begin;
select plan(50);
\ir _shared/fixtures.psql
\ir _shared/emergency_contact_vectors.psql

\set una    '65000000-0000-4000-8000-000000000001'
\set unb    '65000000-0000-4000-8000-000000000002'
\set pcr_a  '65010000-0000-4000-8000-000000000001'
\set offer  '65020000-0000-4000-8000-000000000001'

-- ---------------------------------------------------------------------
-- Fixtures, written as the owner (the only way in until Phase 1's RPCs).
-- ---------------------------------------------------------------------
insert into staff_unavailability (id, staff_id, period, all_day) values
  (:'una', :'staffa', unavailability_range(current_date + 7), true),
  (:'unb', :'staffb', unavailability_range(current_date + 8), true);

insert into staff_emergency_contacts (staff_id, name, relationship, phone, updated_by) values
  (:'staffa', 'Maria Lopez', 'Parent', '+447700900123', :'staffa_uid'),
  (:'staffb', 'Tom Bravo',   'Sibling', '+447700900124', :'staffb_uid');

insert into profile_change_requests (id, staff_id, kind, proposed_photo_path) values
  (:'pcr_a', :'staffa', 'photo', :'staffa' || '/selfie-2.jpg');

-- shift_id and offered_by_staff_id are filled from the booking.
insert into shift_offers (id, booking_id, expires_at) values
  (:'offer', :'booking_a', now() + interval '1 day');

insert into shift_offer_notices (offer_id, staff_id) values (:'offer', :'staffb');

insert into staff_referral_codes (staff_id, code) values
  (:'staffa', 'ABCDEFGH'),
  (:'staffb', 'HJKMNPQR');

insert into application_referrals (application_id, referrer_staff_id, candidate_staff_id, code)
values (:'applic_a', :'staffb', :'staffa', 'HJKMNPQR');

-- =====================================================================
-- A · Shape
-- =====================================================================
select is_empty(
  $$ select c.relname::text
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('staff_unavailability', 'staff_emergency_contacts',
                          'profile_change_requests', 'shift_offers', 'shift_offer_notices',
                          'staff_referral_codes', 'application_referrals')
        and not c.relrowsecurity $$,
  'A: RLS is enabled on all seven additions');

select bag_eq(
  $$ select c.relname::text || ':' || p.polname::text || ':' || p.polcmd::text
       from pg_policy p join pg_class c on c.oid = p.polrelid
      where c.relname in ('staff_unavailability', 'staff_emergency_contacts',
                          'profile_change_requests', 'shift_offers', 'shift_offer_notices',
                          'staff_referral_codes', 'application_referrals') $$,
  $$ values ('staff_unavailability:admin_read:r'::text),
            ('staff_emergency_contacts:admin_read:r'),
            ('profile_change_requests:admin_read:r'),
            ('shift_offers:admin_read:r'),
            ('shift_offer_notices:admin_read:r'),
            ('staff_referral_codes:admin_read:r'),
            ('application_referrals:admin_read:r') $$,
  'A: each carries exactly one policy — admin_read, SELECT — and nothing for staff, client or anon (docs/18 §0)');

select is_empty(
  $$ select c.relname::text || '.' || p.polname::text
       from pg_policy p join pg_class c on c.oid = p.polrelid
      where c.relname in ('staff_unavailability', 'staff_emergency_contacts',
                          'profile_change_requests', 'shift_offers', 'shift_offer_notices',
                          'staff_referral_codes', 'application_referrals')
        and coalesce(pg_get_expr(p.polqual, p.polrelid), '') !~ '''admin''' $$,
  'A: and that one policy restricts to the admin role — none reads as "any signed-in role"');

select is_empty(
  $$ select c.relname::text || ':' || r.rolname::text || ':' || x.privilege_type
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       cross join lateral aclexplode(c.relacl) x
       join pg_roles r on r.oid = x.grantee
      where n.nspname = 'public'
        and c.relname in ('staff_unavailability', 'staff_emergency_contacts',
                          'profile_change_requests', 'shift_offers', 'shift_offer_notices',
                          'staff_referral_codes', 'application_referrals')
        and r.rolname in ('anon', 'authenticated')
        and x.privilege_type <> 'SELECT' $$,
  'A: anon and authenticated hold no INSERT, UPDATE or DELETE on any of the seven — every write is a definer RPC');

select is_empty(
  $$ select c.relname::text
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('staff_unavailability', 'staff_emergency_contacts',
                          'profile_change_requests', 'shift_offers', 'shift_offer_notices',
                          'staff_referral_codes', 'application_referrals')
        and has_table_privilege('anon', c.oid, 'select') $$,
  'A: anon cannot even select from them');

-- =====================================================================
-- B · No client_* view reads any of the seven (ADR-0004/0026)
-- =====================================================================
select is_empty(
  $$ select distinct v.relname::text || ' -> ' || t.relname::text
       from pg_depend d
       join pg_rewrite rw on rw.oid = d.objid
       join pg_class v    on v.oid = rw.ev_class
       join pg_class t    on t.oid = d.refobjid
      where d.classid = 'pg_rewrite'::regclass
        and d.refclassid = 'pg_class'::regclass
        and v.relname like 'client\_%'
        and t.relname in ('staff_unavailability', 'staff_emergency_contacts',
                          'profile_change_requests', 'shift_offers', 'shift_offer_notices',
                          'staff_referral_codes', 'application_referrals') $$,
  'B: no client_* view depends on a docs/18 table — the client sees none of it');

-- =====================================================================
-- C · The matrix
-- =====================================================================
-- Admin reads everything.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from staff_unavailability where id in (:'una', :'unb')), 2,
  'C admin: reads staff_unavailability');
select is((select count(*)::int from staff_emergency_contacts where staff_id in (:'staffa', :'staffb')), 2,
  'C admin: reads staff_emergency_contacts');
select is((select count(*)::int from profile_change_requests where id = :'pcr_a'), 1,
  'C admin: reads profile_change_requests');
select is((select count(*)::int from shift_offers where id = :'offer'), 1,
  'C admin: reads shift_offers');
select is((select count(*)::int from shift_offer_notices where offer_id = :'offer'), 1,
  'C admin: reads shift_offer_notices');
select is((select count(*)::int from staff_referral_codes where staff_id in (:'staffa', :'staffb')), 2,
  'C admin: reads staff_referral_codes');
select is((select count(*)::int from application_referrals where application_id = :'applic_a'), 1,
  'C admin: reads application_referrals');
select throws_ok(
  format($$ insert into staff_emergency_contacts (staff_id, name, relationship, phone)
            values (%L, 'X', 'Y', '+447700900999') $$, :'staffa'),
  '42501', null,
  'C admin: cannot write a row directly either — office writes are audited definer RPCs (docs/18 §0.3)');
select throws_ok(
  format($$ update profile_change_requests set status = 'approved' where id = %L $$, :'pcr_a'),
  '42501', null,
  'C admin: cannot decide a change request by UPDATE');
select throws_ok(
  format($$ delete from staff_unavailability where id = %L $$, :'una'),
  '42501', null,
  'C admin: cannot delete a worker''s availability by DELETE');
reset role;

-- A worker reads nothing — not even their own rows — and writes nothing.
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (select (select count(*) from staff_unavailability)
        + (select count(*) from staff_emergency_contacts)
        + (select count(*) from profile_change_requests)
        + (select count(*) from shift_offers)
        + (select count(*) from shift_offer_notices)
        + (select count(*) from staff_referral_codes)
        + (select count(*) from application_referrals))::int,
  0,
  'C staff: a worker reads no row of any of the seven — their own included (ADR-0031: reads are definer RPCs)');
select throws_ok(
  format($$ insert into staff_unavailability (staff_id, period, all_day)
            values (%L, unavailability_range(current_date + 9), true) $$, :'staffa'),
  '42501', null, 'C staff: cannot insert their own availability directly');
select throws_ok(
  format($$ insert into staff_emergency_contacts (staff_id, name, relationship, phone)
            values (%L, 'X', 'Y', '+447700900999') $$, :'staffa'),
  '42501', null, 'C staff: cannot insert their own emergency contact directly');
select throws_ok(
  format($$ insert into profile_change_requests (staff_id, kind, proposed_photo_path)
            values (%L, 'photo', %L) $$, :'staffa', :'staffa' || '/x.jpg'),
  '42501', null, 'C staff: cannot file a change request directly');
select throws_ok(
  format($$ insert into shift_offers (booking_id, expires_at) values (%L, now() + interval '1 day') $$,
         :'booking_a'),
  '42501', null, 'C staff: cannot offer a shift directly');
select throws_ok(
  format($$ insert into shift_offer_notices (offer_id, staff_id) values (%L, %L) $$, :'offer', :'staffa'),
  '42501', null, 'C staff: cannot write an offer notice');
select throws_ok(
  format($$ insert into staff_referral_codes (staff_id, code) values (%L, 'ZZZZZZZZ') $$, :'staffa'),
  '42501', null, 'C staff: cannot mint their own referral code directly');
select throws_ok(
  format($$ insert into application_referrals (application_id, referrer_staff_id, candidate_staff_id, code)
            values (%L, %L, %L, 'ABCDEFGH') $$, :'applic_a', :'staffa', :'staffb'),
  '42501', null, 'C staff: cannot record a referral');
select throws_ok(
  format($$ update shift_offers set status = 'withdrawn' where id = %L $$, :'offer'),
  '42501', null, 'C staff: cannot withdraw an offer by UPDATE');
reset role;

-- A client reads nothing.
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (select (select count(*) from staff_unavailability)
        + (select count(*) from staff_emergency_contacts)
        + (select count(*) from profile_change_requests)
        + (select count(*) from shift_offers)
        + (select count(*) from shift_offer_notices)
        + (select count(*) from staff_referral_codes)
        + (select count(*) from application_referrals))::int,
  0,
  'C client: a client reads no row of any of the seven — not even the offers on its own event');
select throws_ok(
  format($$ insert into staff_emergency_contacts (staff_id, name, relationship, phone)
            values (%L, 'X', 'Y', '+447700900999') $$, :'staffb'),
  '42501', null, 'C client: cannot write one either');
reset role;

-- Anon has no privilege at all.
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select 1 from staff_unavailability $$,     '42501', null, 'C anon: staff_unavailability is not readable');
select throws_ok($$ select 1 from staff_emergency_contacts $$, '42501', null, 'C anon: staff_emergency_contacts is not readable');
select throws_ok($$ select 1 from profile_change_requests $$,  '42501', null, 'C anon: profile_change_requests is not readable');
select throws_ok($$ select 1 from shift_offers $$,             '42501', null, 'C anon: shift_offers is not readable');
select throws_ok($$ select 1 from shift_offer_notices $$,      '42501', null, 'C anon: shift_offer_notices is not readable');
select throws_ok($$ select 1 from staff_referral_codes $$,     '42501', null, 'C anon: staff_referral_codes is not readable');
select throws_ok($$ select 1 from application_referrals $$,    '42501', null, 'C anon: application_referrals is not readable');
reset role;

-- The service role (Edge Functions, the jobs) writes.
set local role service_role;
select lives_ok(
  format($$ insert into shift_offer_notices (offer_id, staff_id) values (%L, %L) $$, :'offer', :'staffa'),
  'C service_role: writes an offer notice (the auto-staffing job, Agent A)');
reset role;

-- =====================================================================
-- D · staff_unavailable() does not leak a calendar
-- =====================================================================
select is(staff_unavailable(:'staffa', lower(unavailability_range(current_date + 7)) + interval '10 hours',
                                       lower(unavailability_range(current_date + 7)) + interval '14 hours'),
  true, 'D: as the owner (the engine''s definer context) the entry gates the section');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(staff_unavailable(:'staffa', lower(unavailability_range(current_date + 7)) + interval '10 hours',
                                       lower(unavailability_range(current_date + 7)) + interval '14 hours'),
  true, 'D: the office sees it too (admin_read)');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(staff_unavailable(:'staffa', lower(unavailability_range(current_date + 7)) + interval '10 hours',
                                       lower(unavailability_range(current_date + 7)) + interval '14 hours'),
  false, 'D: another worker calling it learns nothing — invoker, and the staff role has no policy');
reset role;
select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.staff_unavailable(uuid, timestamptz, timestamptz)'::regprocedure),
  false, 'D: staff_unavailable is security invoker');
select ok(
  not has_function_privilege('anon', 'public.staff_unavailable(uuid, timestamptz, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.unavailability_range(date, date, time, time)', 'execute'),
  'D: anon cannot call staff_unavailable or unavailability_range');
select ok(
  not has_function_privilege('authenticated', 'public.staff_removed_purge_additions()', 'execute')
  and not has_function_privilege('authenticated', 'public.profile_change_requests_state_guard()', 'execute')
  and not has_function_privilege('authenticated', 'public.shift_offers_state_guard()', 'execute'),
  'D: the three new trigger functions are not RPCs (20260927161000)');

-- =====================================================================
-- E · Emergency contact CHECKs against emergencyContact.vectors.json
-- =====================================================================
create function pg_temp.contact_ok(p_staff uuid, p_name text, p_rel text, p_phone text)
returns boolean language plpgsql as $$
begin
  delete from staff_emergency_contacts where staff_id = p_staff;
  begin
    insert into staff_emergency_contacts (staff_id, name, relationship, phone)
    values (p_staff, p_name, p_rel, p_phone);
    return true;
  exception when check_violation then
    return false;
  end;
end $$;

select is((select count(*)::int from emergency_phone_vectors), :emergency_phone_count,
  format('E: all %s phone cases loaded from emergencyContact.vectors.json', :emergency_phone_count));

select is_empty(
  format($$ select name from emergency_phone_vectors
             where pg_temp.contact_ok(%L, 'Maria Lopez', 'Parent', input) <> storable $$, :'staffb'),
  'E: staff_emergency_contacts_phone accepts exactly the raw strings the vectors call storable (E.164)');

select is_empty(
  format($$ select name from emergency_phone_vectors
             where normalised is not null
               and not pg_temp.contact_ok(%L, 'Maria Lopez', 'Parent', normalised) $$, :'staffb'),
  'E: and every value normaliseEmergencyPhone() produces is storable');

select is((select count(*)::int from emergency_contact_vectors), :emergency_contact_count,
  format('E: all %s contact cases loaded', :emergency_contact_count));

select is_empty(
  format($$ select name from emergency_contact_vectors
             where pg_temp.contact_ok(%L, btrim(contact_name), btrim(relationship),
                                      coalesce(stored_phone, phone)) <> valid $$, :'staffb'),
  'E: the name (1–100) and relationship (1–40) CHECKs agree with validateEmergencyContact() on every case');

select throws_ok(
  format($$ insert into staff_emergency_contacts (staff_id, name, relationship, phone)
            values (%L, ' Maria', 'Parent', '+447700900123')
            on conflict (staff_id) do update set name = excluded.name $$, :'staffb'),
  '23514', null,
  'E: an untrimmed name is refused — the form trims before it saves');

-- =====================================================================
-- F · Referral codes (ADR-0040)
-- =====================================================================
create function pg_temp.code_ok(p_staff uuid, p_code text)
returns boolean language plpgsql as $$
begin
  delete from staff_referral_codes where staff_id = p_staff;
  begin
    insert into staff_referral_codes (staff_id, code) values (p_staff, p_code);
    return true;
  exception when check_violation then
    return false;
  end;
end $$;

select results_eq(
  format($$ select c, pg_temp.code_ok(%L, c)
              from unnest(array['BCDEFGHJ', '23456789', 'ABCDEFGI', 'ABCDEFGO',
                                'ABCDEFG0', 'ABCDEFG1', 'abcdefgh', 'ABCDEFG', 'ABCDEFGHJ']) c $$,
         :'staffb'),
  $$ values ('BCDEFGHJ', true), ('23456789', true), ('ABCDEFGI', false), ('ABCDEFGO', false),
            ('ABCDEFG0', false), ('ABCDEFG1', false), ('abcdefgh', false), ('ABCDEFG', false),
            ('ABCDEFGHJ', false) $$,
  'F: a code is eight of A–Z / 2–9 with no I, O, 0 or 1, upper case (REFERRAL_CODE_PATTERN)');

select throws_ok(
  format($$ insert into staff_referral_codes (staff_id, code) values (%L, 'ABCDEFGH')
            on conflict (staff_id) do update set code = excluded.code $$, :'staffb'),
  '23505', null,
  'F: a code belongs to one worker');

select throws_ok(
  format($$ insert into application_referrals (application_id, referrer_staff_id, candidate_staff_id, code)
            values (%L, %L, %L, 'ABCDEFGH')
            on conflict (application_id) do update set referrer_staff_id = excluded.referrer_staff_id $$,
         :'applic_a', :'staffa', :'staffa'),
  '23514', null,
  'F: nobody refers themselves (application_referrals_not_self)');

select * from finish();
rollback;
