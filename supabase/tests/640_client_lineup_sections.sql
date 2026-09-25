-- =====================================================================
-- 640 · The client line-up names its role section (§11.2, §11.3)
--
-- Migration 20260929160000. Two sections of one role are two groups on
-- the event page, as they are two sections on the PDF: client_lineup_v
-- carries shift_id so the portal can key the groups on it rather than on
-- the role name. The key must be the same one client_role_sections_v
-- returns, must not open anything, and the view must keep its ADR-0004
-- shape (owner rights, security barrier, tenancy in the body).
-- =====================================================================
begin;
select plan(9);
\ir _shared/fixtures.psql

\set shift_a2   'ffffffff-0000-4000-8000-0000000000a2'
\set booking_a2 '0a0a0a0a-0000-4000-8000-0000000000a2'

-- A second, evening section of the SAME role on Client A's event, with
-- Staff B confirmed on it.
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour) values
  (:'shift_a2', :'event_a', :'role_id', now() + interval '7 days 10 hours',
   now() + interval '7 days 16 hours', 2, 0, 22.97, 14.00, 'Black tie', 2);
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'booking_a2', :'shift_a2', :'staffb', 'confirmed', 'manual', now());

-- ---- shape ------------------------------------------------------------
select ok(exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'client_lineup_v'
                     and column_name = 'shift_id'),
  'client_lineup_v names the role section each booking is on');
select ok(not (coalesce((select reloptions from pg_class where relname = 'client_lineup_v'), '{}') @> '{security_invoker=true}')
          and (coalesce((select reloptions from pg_class where relname = 'client_lineup_v'), '{}') @> '{security_barrier=true}'),
  'client_lineup_v keeps owner rights and its security barrier (ADR-0004)');
select ok(not has_table_privilege('anon', 'client_lineup_v', 'select')
          and not has_table_privilege('authenticated', 'client_lineup_v', 'insert'),
  'client_lineup_v stays select-only for signed-in callers and closed to anon');

-- ---- as Client A ------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(distinct shift_id)::int from client_lineup_v where event_id = :'event_a'), 2,
  '§11.2 two sections of one role come back as two section keys, not one role');
select is((select count(distinct role)::int from client_lineup_v where event_id = :'event_a'), 1,
  '… while the role name is the same on both, which is why the name cannot be the key');
select is((select shift_id::text from client_lineup_v where booking_id = :'booking_a2'), :'shift_a2',
  'the evening booking is keyed on the evening section');
select is(
  (select count(*)::int from client_lineup_v l
     where l.event_id = :'event_a'
       and not exists (select 1 from client_role_sections_v s where s.shift_id = l.shift_id)),
  0,
  'every line-up key is a section client_role_sections_v returns to the same caller, so the window is found');

-- The key reaches nothing: the base table is still closed (§11.1, no money).
select is((select count(*)::int from shift_requirements where id in (:'shift_a', :'shift_a2')), 0,
  '§11.1 knowing the shift id still reads no shift_requirements row (charge_rate, pay_rate)');
select is((select count(*)::int from client_lineup_v where event_id = :'event_b'), 0,
  'another client''s line-up stays invisible');

reset role;
select * from finish();
rollback;
