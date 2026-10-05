-- =====================================================================
-- 773 · The timesheet says when buffer staff are on it
--       20261005110000 · ADR-0087 (THC 05.10.2026)
--
-- event_document_data() gives each row its role section's headcount;
-- event_document_buffer_count() counts the people listed beyond it; the
-- D1/D2 email payload carries that as `bufferStaff` ('' for none).
-- =====================================================================
begin;
select plan(9);
\ir _shared/fixtures.psql

select (now() at time zone 'Europe/London')::date as today \gset
create function pg_temp.uk(p_day date, p_time text) returns timestamptz
language sql immutable as $$ select (p_day + p_time::time) at time zone 'Europe/London' $$;

\set ev     '77300000-0000-4000-8000-000000000001'
\set ev_ok  '77300000-0000-4000-8000-000000000002'
\set sec_w  '77310000-0000-4000-8000-000000000001'
\set sec_c  '77310000-0000-4000-8000-000000000002'
\set sec_ok '77310000-0000-4000-8000-000000000003'
\set r_c    '77320000-0000-4000-8000-000000000001'
\set p_1    '77330000-0000-4000-8000-000000000001'
\set p_2    '77330000-0000-4000-8000-000000000002'
\set p_3    '77330000-0000-4000-8000-000000000003'
\set p_4    '77330000-0000-4000-8000-000000000004'

insert into roles (id, name, description, pay_rate) values (:'r_c', 'Buf Chef', 'fixture', 19.00);
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'p_1', 97301, 'Ann',  'Aaron',  'b-1@rls.test', '+447700973901', date '1995-01-01', 'compliant'),
  (:'p_2', 97302, 'Ben',  'Baker',  'b-2@rls.test', '+447700973902', date '1995-01-01', 'compliant'),
  (:'p_3', 97303, 'Cara', 'Cole',   'b-3@rls.test', '+447700973903', date '1995-01-01', 'compliant'),
  (:'p_4', 97304, 'Dev',  'Dutta',  'b-4@rls.test', '+447700973904', date '1995-01-01', 'compliant');
insert into events (id, client_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer)
select x.id::uuid, :'clienta'::uuid, 'Buf Venue', '1 Buf St',
       st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150, x.title, :'today'::date + 1, true, true
  from (values (:'ev', 'Buffered Dinner'), (:'ev_ok', 'Exact Lunch')) as x(id, title);
-- ev: Waiting headcount 1 + buffer 1 with two confirmed; Chef headcount 2 with one confirmed.
-- ev_ok: headcount 1, one confirmed.
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'sec_w',  :'ev',    :'role_id', pg_temp.uk(:'today'::date + 1, '17:00'), pg_temp.uk(:'today'::date + 1, '23:30'), 1, 1, 22.97, 14.00, 2),
  (:'sec_c',  :'ev',    :'r_c',     pg_temp.uk(:'today'::date + 1, '07:00'), pg_temp.uk(:'today'::date + 1, '15:00'), 2, 0, 22.97, 14.00, 2),
  (:'sec_ok', :'ev_ok', :'role_id', pg_temp.uk(:'today'::date + 1, '12:00'), pg_temp.uk(:'today'::date + 1, '16:00'), 1, 0, 22.97, 14.00, 1);
insert into bookings (shift_id, staff_id, status, source, confirmed_at) values
  (:'sec_w',  :'p_1', 'confirmed', 'manual', now() - interval '7 days'),
  (:'sec_w',  :'p_2', 'confirmed', 'manual', now() - interval '7 days'),
  (:'sec_c',  :'p_3', 'confirmed', 'manual', now() - interval '7 days'),
  (:'sec_ok', :'p_4', 'confirmed', 'manual', now() - interval '7 days');

-- =====================================================================
-- 1 · Counting
-- =====================================================================
select is(event_document_buffer_count(:'ev'), 1,
  'one more than asked for in Waiting Staff is one buffer; an under-filled Chef section is not negative');
select is(event_document_buffer_count(:'ev_ok'), 0, 'exactly the headcount is no buffer');

-- =====================================================================
-- 2 · The document data carries each role's headcount
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table dd as select event_document_data(:'ev') as d;
select results_eq(
  $$ select (r->>'headcount')::int, count(*)::int
       from dd, jsonb_array_elements(d->'rows') r
      where r->>'roleName' = 'Buf Chef' group by 1 $$,
  $$ values (2, 1) $$,
  'the Chef row carries its section''s headcount (2)');
select results_eq(
  $$ select (r->>'headcount')::int, count(*)::int
       from dd, jsonb_array_elements(d->'rows') r
      where r->>'roleName' <> 'Buf Chef' group by 1 $$,
  $$ values (1, 2) $$,
  'both Waiting Staff rows carry theirs (1): the sheet can print "2 staff (1 required + 1 buffer)"');

-- =====================================================================
-- 3 · The email payload
-- =====================================================================
create temp table man as select record_event_document(:'ev', 'allocation', :'ev' || '/allocation/m.pdf', 'M.pdf', 3, 1) as id;
create temp table man_ok as select record_event_document(:'ev_ok', 'allocation', :'ev_ok' || '/allocation/m.pdf', 'M.pdf', 1, 1) as id;
reset role;
select is(event_document_email_payload((select id from man))->>'bufferStaff', '1', 'the payload names the buffer count');
select is(event_document_email_payload((select id from man_ok))->>'bufferStaff', '', 'and is empty when there is none');
select ok(event_document_email_payload((select id from man)) ? 'staffCount'
          and event_document_email_payload((select id from man)) ? 'updateTag',
  'every earlier key is kept');

-- =====================================================================
-- 4 · Who can call the helper
-- =====================================================================
select is_empty(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'event_document_buffer_count'
        and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute')
          or not has_function_privilege('service_role', p.oid, 'execute')) $$,
  'the service role''s alone, like the rest of the document functions');

-- =====================================================================
-- 5 · A withdrawn worker is not on the sheet, so is not buffer
-- =====================================================================
update bookings set status = 'cancelled', cancelled_at = now(), cancel_cause = 'office_withdraw'
 where shift_id = :'sec_w' and staff_id = :'p_2';
select is(event_document_buffer_count(:'ev'), 0, 'withdraw the extra worker and the buffer is gone');

select * from finish();
rollback;
