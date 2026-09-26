-- =====================================================================
-- 710 · The worker's emergency contact RPCs (ADR-0043, docs/19 §2)
--   my_emergency_contact · save_my_emergency_contact ·
--   clear_my_emergency_contact · 20260930202100
--
--   A. Shape: definer, search_path pinned, not anon/PUBLIC; the table
--      still has admin_read only.
--   B. save → read → clear, with nothing queued (no notification).
--   C. Every phone and contact vector (emergencyContact.vectors.json)
--      through the RPC: accepted exactly when validateEmergencyContact()
--      accepts, stored exactly as it normalises. A bad phone is refused
--      by name.
--   D. No cross-worker access: the RPCs take no staff id, the table is
--      unreadable and unwritable directly.
--   E. A leaver reads but cannot write; a removed worker is refused;
--      admin and a client have no contact of their own here.
-- =====================================================================
begin;
select plan(30);
\ir _shared/fixtures.psql
\ir _shared/emergency_contact_vectors.psql

-- =====================================================================
-- A · Shape
-- =====================================================================
select ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=public, extensions'])
     from pg_proc p
    where p.oid in ('public.my_emergency_contact()'::regprocedure,
                    'public.save_my_emergency_contact(text, text, text)'::regprocedure,
                    'public.clear_my_emergency_contact()'::regprocedure)),
  'A: all three are security definer with search_path pinned');

select ok(
  not has_function_privilege('anon', 'public.my_emergency_contact()', 'execute')
  and not has_function_privilege('anon', 'public.save_my_emergency_contact(text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.clear_my_emergency_contact()', 'execute')
  and not has_function_privilege('public', 'public.save_my_emergency_contact(text, text, text)', 'execute'),
  'A: anon and PUBLIC cannot call them');

select ok(
  has_function_privilege('authenticated', 'public.my_emergency_contact()', 'execute')
  and has_function_privilege('authenticated', 'public.save_my_emergency_contact(text, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.clear_my_emergency_contact()', 'execute'),
  'A: a signed-in worker can');

select is_empty(
  $$ select polname from pg_policy where polrelid = 'public.staff_emergency_contacts'::regclass
      and polname <> 'admin_read' $$,
  'A: staff_emergency_contacts carries admin_read only — no staff or client policy');

-- Staff Bravo has a contact Staff Alpha must never reach.
insert into staff_emergency_contacts (staff_id, name, relationship, phone)
values (:'staffb', 'Tom Bravo', 'Sibling', '+447700900132');

select count(*)::int as outbox_before from notification_outbox \gset

-- =====================================================================
-- B · save → read → clear (Staff Alpha, through PostgREST's role)
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(my_emergency_contact(), null::jsonb, 'B: none yet — null, not an error (optional, Q11)');

select is(
  (save_my_emergency_contact(' Grace Kalu ', 'Parent', '+44 7700 900456') ->> 'phone'),
  '+447700900456', 'B: save trims, drops the separators and stores E.164');

select results_eq(
  $$ select my_emergency_contact() ->> 'name', my_emergency_contact() ->> 'relationship',
            my_emergency_contact() ->> 'phone' $$,
  $$ values ('Grace Kalu'::text, 'Parent'::text, '+447700900456'::text) $$,
  'B: and reads back what was saved');

select is(my_emergency_contact() ? 'updatedBy', false,
  'B: the read never returns who wrote it (updated_by)');

select lives_ok(
  $$ select save_my_emergency_contact('Grace Okafor', 'Mother', '+33612345678') $$,
  'B: a second save replaces the first (one contact per worker)');
select is(my_emergency_contact() ->> 'phone', '+33612345678', 'B: any country, E.164');

reset role;
select is((select updated_by from staff_emergency_contacts where staff_id = :'staffa'), :'staffa_uid'::uuid,
  'B: updated_by is the worker''s own auth uid');
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((clear_my_emergency_contact() ->> 'cleared')::boolean, true, 'B: Remove clears it');
select is(my_emergency_contact(), null::jsonb, 'B: and it is gone');
select is((clear_my_emergency_contact() ->> 'cleared')::boolean, false,
  'B: removing nothing is not an error');

reset role;
select is((select count(*)::int from notification_outbox), :outbox_before,
  'B: nothing was queued — the emergency contact sends no notification');

-- =====================================================================
-- C · The vectors, through the RPC
-- =====================================================================
create function pg_temp.try_save(p_name text, p_rel text, p_phone text) returns text
language plpgsql as $$
begin
  perform save_my_emergency_contact(p_name, p_rel, p_phone);
  return (select phone from staff_emergency_contacts
           where staff_id = 'dddddddd-0000-4000-8000-000000000001');
exception when others then
  return null;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);

select is_empty(
  $$ select name from emergency_phone_vectors
      where pg_temp.try_save('Grace Kalu', 'Parent', input) is distinct from normalised $$,
  'C: every phone vector — accepted exactly when normaliseEmergencyPhone() accepts, stored as it normalises');

select is_empty(
  $$ select name from emergency_contact_vectors
      where (pg_temp.try_save(contact_name, relationship, phone) is not null) <> valid $$,
  'C: every contact vector — accepted exactly when validateEmergencyContact() accepts');

select throws_ok($$ select save_my_emergency_contact('Grace', 'Parent', '07700 900456') $$,
  'P0001', 'bad_phone', 'C: a number without its country code is refused as bad_phone');
select throws_ok($$ select save_my_emergency_contact('Grace', 'Parent', '+44 7700') $$,
  'P0001', 'bad_phone', 'C: a number too short is refused as bad_phone');
select throws_ok($$ select save_my_emergency_contact('  ', 'Parent', '+447700900456') $$,
  'P0001', 'name_required', 'C: a blank name is refused');
select throws_ok($$ select save_my_emergency_contact('Grace', '', '+447700900456') $$,
  'P0001', 'relationship_required', 'C: a blank relationship is refused');

-- =====================================================================
-- D · No cross-worker access
-- =====================================================================
set local role authenticated;
select is((select count(*)::int from staff_emergency_contacts), 0,
  'D: the staff role reads no rows directly — not Bravo''s, not its own');
select throws_ok(
  format($$ insert into staff_emergency_contacts (staff_id, name, relationship, phone)
            values (%L, 'X', 'Friend', '+447700900999') $$, :'staffb'),
  '42501', null, 'D: nor writes directly');
select isnt(my_emergency_contact() ->> 'name', 'Tom Bravo',
  'D: Staff Alpha''s read is Alpha''s own, never Bravo''s');
reset role;
select is((select name from staff_emergency_contacts where staff_id = :'staffb'), 'Tom Bravo',
  'D: Bravo''s contact is untouched by everything Alpha did');

-- =====================================================================
-- E · Leaver, removed, admin, client
-- =====================================================================
update staff set status = 'inactive', left_at = now() where id = :'staffb';
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(my_emergency_contact() ->> 'name', 'Tom Bravo', 'E: a leaver can still read theirs');
select throws_ok($$ select save_my_emergency_contact('Tom', 'Brother', '+447700900133') $$,
  'P0001', 'not_editable', 'E: but cannot change it');
select throws_ok($$ select clear_my_emergency_contact() $$,
  'P0001', 'not_editable', 'E: or remove it');

reset role;
update staff set status = 'removed' where id = :'staffb';
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select my_emergency_contact() $$,
  'P0001', 'account_closed', 'E: a removed worker is refused even a read');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select throws_ok($$ select my_emergency_contact() $$,
  'P0001', 'unknown_staff', 'E: a client has no worker record, so nothing to read');

reset role;
select * from finish();
rollback;
