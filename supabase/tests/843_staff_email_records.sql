-- =====================================================================
-- 843 · /staff/roster: the records behind each email count
--       (20261015130000, ADR-0144)
--
--   A. Who can read them: any office login, not a worker, not the public;
--      an unknown email or kind is refused.
--   B. Each kind: sent today, sent, people (one row per address), failed
--      (with why), queued (soonest first); named from the staff record or
--      the invite list; a page at a time, with the total.
-- =====================================================================
begin;
select plan(13);
\ir _shared/fixtures.psql

\set viewer '84300000-0000-4000-8000-0000000000a1'
\set s_lou  '84300000-0000-4000-8000-000000000001'
\set now    '2026-10-15 12:00+01'

insert into auth.users (id, email) values (:'viewer', 'viewer.843@rls.test');
insert into profiles (id, role, office_role, full_name) values (:'viewer', 'admin', 'viewer', 'Vic Viewer');

delete from notification_outbox where template in ('IR1', 'OC1');
delete from invite_roster;
insert into invite_roster (email, first_name, last_name, payroll_id, grp) values
  ('ann@r843.test', 'Ann', 'Listed', '9431', 'thc');
insert into staff (id, user_id, first_name, last_name, email, phone, dob, status) values
  (:'s_lou', null, 'Lou', 'Staff', 'lou@r843.test', '+447700984301', date '2001-07-01', 'interview_requested');

insert into notification_outbox (key, channel, template, recipient_staff_id, recipient_emails, payload, queued_at, sent_at, failed_at, error, send_after) values
  ('IR1:r:1', 'email', 'IR1', null, array['ann@r843.test'], '{"variant":"named","name":"Ann"}', '2026-10-14 10:07+01', '2026-10-14 10:08+01', null, null, '2026-10-14 10:07+01'),
  ('IR1:r:2', 'email', 'IR1', null, array['ann@r843.test'], '{"variant":"named","name":"Ann"}', '2026-10-15 10:07+01', '2026-10-15 10:08+01', null, null, '2026-10-15 10:07+01'),
  ('IR1:r:3', 'email', 'IR1', null, array['bob@r843.test'], '{"variant":"named","name":"Bob"}', '2026-10-15 10:07+01', '2026-10-15 10:09+01', null, null, '2026-10-15 10:07+01'),
  ('IR1:r:4', 'email', 'IR1', null, array['bad@r843.test'], '{"variant":"unnamed"}',            '2026-10-15 10:07+01', null, '2026-10-15 10:10+01', 'Resend answered 422: invalid address', '2026-10-15 10:07+01'),
  ('IR1:r:5', 'email', 'IR1', null, array['late@r843.test'], '{"variant":"named","name":"Lee"}', '2026-10-15 11:59+01', null, null, null, '2026-10-15 13:00+01'),
  ('IR1:r:6', 'email', 'IR1', null, array['soon@r843.test'], '{"variant":"named","name":"Sue"}', '2026-10-15 11:59+01', null, null, null, '2026-10-15 12:30+01'),
  ('OC1:notice:x', 'email', 'OC1', :'s_lou', array['lou@r843.test'], '{"variant":"existing_notice","name":"Lou"}', '2026-10-14 20:39+01', '2026-10-15 10:00+01', null, null, '2026-10-15 10:00+01'),
  ('OC1:staff:y:1:1', 'email', 'OC1', :'s_lou', array['lou@r843.test'], '{"variant":"first","name":"Lou"}', '2026-10-15 10:07+01', '2026-10-15 10:08+01', null, null, '2026-10-15 10:07+01');

-- =====================================================================
-- A · who can read them
-- =====================================================================
select ok(not has_function_privilege('anon', 'staff_email_records(text, text, integer, integer, timestamptz)', 'execute'),
  'the public cannot');
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select staff_email_records('IR1', 'sent') $$, '42501', 'not_authorised', 'a worker cannot');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select staff_email_records('OC1:first', 'sent') $$, '22023', 'unknown_email',
  'only the emails the page lists');
select throws_ok($$ select staff_email_records('IR1', 'everything') $$, '22023', 'unknown_kind',
  'only the counts the page shows');

create temporary table r on commit drop as
  select k, staff_email_records('IR1', k, 100, 0, :'now') as v
    from unnest(array['sent_today', 'sent', 'people', 'failed', 'queued']) k;
create temporary table rp on commit drop as
  select staff_email_records('IR1', 'sent', 2, 2, :'now') as v;
create temporary table rn on commit drop as
  select staff_email_records('OC1:existing_notice', 'sent', 100, 0, :'now') as v;
reset role;

-- =====================================================================
-- B · the records
-- =====================================================================
select is((select array_agg(e ->> 'email') from r, jsonb_array_elements(v -> 'rows') e where k = 'sent_today'),
  array['bob@r843.test', 'ann@r843.test'], 'sent today: latest first');
select is((select (v ->> 'total')::int from r where k = 'sent'), 3, 'sent: three in all');
select is((select array_agg((e ->> 'email') || ':' || (e ->> 'times')) from r, jsonb_array_elements(v -> 'rows') e where k = 'people'),
  array['bob@r843.test:1', 'ann@r843.test:2'], 'people: one row per address, with how many');
select is((select v -> 'rows' -> 0 ->> 'name' from r where k = 'people' and v -> 'rows' -> 1 ->> 'email' = 'ann@r843.test'),
  'Bob', 'named from the email when nobody holds the address');
select is((select e ->> 'name' from r, jsonb_array_elements(v -> 'rows') e where k = 'people' and e ->> 'email' = 'ann@r843.test'),
  'Ann Listed', 'and from the invite list when it names them');
select is((select array[v -> 'rows' -> 0 ->> 'email', v -> 'rows' -> 0 ->> 'error'] from r where k = 'failed'),
  array['bad@r843.test', 'Resend answered 422: invalid address'], 'not delivered: who, and why');
select is((select array_agg(e ->> 'email') from r, jsonb_array_elements(v -> 'rows') e where k = 'queued'),
  array['soon@r843.test', 'late@r843.test'], 'waiting: soonest first');
select is((select array[(v ->> 'total')::text, jsonb_array_length(v -> 'rows')::text, v -> 'rows' -> 0 ->> 'email'] from rp),
  array['3', '1', 'ann@r843.test'], 'a page at a time, with the total');
select is((select array[(v ->> 'total')::text, v -> 'rows' -> 0 ->> 'staffId', v -> 'rows' -> 0 ->> 'name'] from rn),
  array['1', :'s_lou', 'Lou Staff'],
  'the one-off notice: the existing-staff variant only, linked to their staff record');

select * from finish();
rollback;
