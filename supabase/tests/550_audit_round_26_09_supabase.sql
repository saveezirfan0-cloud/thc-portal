-- =====================================================================
-- 530 · The 26.09 audit round, the supabase half — what the named files
--       could not hold without a fixture of their own:
--
--   A · N15 when a conviction-review block is lifted LATER by a document
--       (§10.7, §4.3 — 20260926111000 §4)
--   B · Referee 1 / Referee 2 keep the order they were entered in
--       (§2.10 — 20260926111000 §3)
--   C · A worker's evidence upload is the worker's own: an admin session
--       cannot file it in their name (Invariant 4 — 20260926111000 §1)
--   D · settings.edge_base_url can only be a Supabase Functions base
--       (Invariant 8 — 20260926110200)
--   E · The wizard's NI entry queues no E6; the profile's still does
--       (§2.10 — 20260926111000 §2; 330 pins the profile route)
-- =====================================================================
begin;
select plan(16);
\ir _shared/fixtures.psql

\set w_conv  'c5300000-0000-4000-8000-000000000001'
\set w_refs  'c5300000-0000-4000-8000-000000000002'
\set u_refs  'c5300000-0000-4000-8000-0000000000a2'
\set d_dead  'c5310000-0000-4000-8000-000000000001'
\set d_new   'c5310000-0000-4000-8000-000000000002'
\set c_emp   'c5320000-0000-4000-8000-000000000001'

insert into auth.users (id, email) values (:'u_refs', 'refs@audit.test');

insert into staff (id, user_id, employee_id, first_name, last_name, email, phone, dob, status, block_kind, block_reason, rtw_branch) values
  (:'w_conv', null,     95301, 'Dara', 'Later',  'dl@audit.test', '+447700953001', date '1990-01-01', 'blocked', 'conviction_review',
   'Criminal conviction declared — under review', 'uk_irish'),
  (:'w_refs', :'u_refs', null,  'Rita', 'Refs',   'rr@audit.test', '+447700953002', date '1999-01-01', 'contract', null, null, 'uk_irish');

-- =====================================================================
-- A · N15 owed since Verify, paid when the re-check finally passes
-- =====================================================================
-- Dara's passport ran out while they were blocked (§4.3's own example),
-- and their in-employment declaration is waiting for the office.
insert into compliance_docs (id, staff_id, doc_type, uploaded_at, expiry_date, review_status) values
  (:'d_dead', :'w_conv', 'passport', now() - interval '3 years', current_date - 5, 'verified');
insert into criminal_declarations (id, staff_id, source, answer, details, review_status, superseded, declared_at) values
  (:'c_emp', :'w_conv', 'in_employment', true, 'Declared from the app', 'pending', false, now() - interval '1 day');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid')::text, true);

select is(compliance_verify_declaration(:'c_emp') ->> 'unblocked', 'false',
  '§10.7 Verify accepts the declaration, but the full re-check fails on the expired passport, so the block stays');
select is((select block_kind::text from staff where id = :'w_conv'), 'conviction_review',
  'and the block it keeps is still the conviction review''s');
select is((select count(*)::int from notification_outbox where key = 'N15:declaration:' || :'c_emp'), 0,
  'no N15 yet: their shifts are not open again');

-- The passport is re-uploaded and verified — the ordinary §4.3 document
-- path, which used to lift the block silently.
insert into compliance_docs (id, staff_id, doc_type, uploaded_at, expiry_date, review_status) values
  (:'d_new', :'w_conv', 'passport', now() - interval '1 hour', current_date + 3000, 'pending');
update compliance_docs set review_status = 'verified', reviewed_at = now() where id = :'d_new';

select is((select status::text from staff where id = :'w_conv'), 'compliant',
  '§4.3 the verified document lifts the block through unblock_if_compliant()');
select is((select count(*)::int from notification_outbox where key = 'N15:declaration:' || :'c_emp'), 1,
  '§10.7 and N15 "your shifts are open again" goes out NOW, keyed on the accepted declaration — once (20260926111000)');
select set_config('request.jwt.claims', '', true);

-- =====================================================================
-- B · Referee 1, Referee 2 — the order entered, not the alphabet
-- =====================================================================
insert into staff_references (staff_id, name, relationship, phone, email) values
  (:'w_refs', 'Zoe Ward', 'Former manager', '+447700953101', 'zoe@audit.test'),
  (:'w_refs', 'Adam Bell', 'Colleague',      '+447700953102', 'adam@audit.test');
set local "request.jwt.claims" = '{"sub":"c5300000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select is((select (onboarding_state()->'references'->0->>'name')), 'Zoe Ward',
  '§2.10 Referee 1 is the first one entered, even though the alphabet says otherwise');
select is((select (onboarding_state()->'references'->1->>'name')), 'Adam Bell',
  'and Referee 2 the second — the pills on step 8/11 keep their people');
select set_config('request.jwt.claims', '', true);

-- =====================================================================
-- C · A write is the worker's own (staff_writer)
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select throws_ok(
  format('select submit_document_upload(%L, %L, null, %L)', 'passport', :'staffa' || '/passport/planted.pdf', :'staffa'),
  '42501', 'not_your_worker',
  'Invariant 4: an admin session cannot file evidence in a worker''s name and have it audited as the worker''s own upload');
select throws_ok(
  format('select submit_completion_letter(%L, %L, %L, null, %L)', :'staffa' || '/completion-letter/planted.pdf', current_date, 'letter', :'staffa'),
  '42501', 'not_your_worker',
  'nor a completion letter, which would queue CL3 attributing the upload to the worker');
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select is(submit_document_upload('passport', null, null, :'staffa')->>'ok', 'false',
  'the worker naming their OWN id is still themselves (and is refused for the ordinary reason: no file)');
select set_config('request.jwt.claims', '', true);

-- =====================================================================
-- D · Where the service-role bearer may be posted
-- =====================================================================
select throws_ok(
  $$ insert into settings (key, value) values ('edge_base_url', '"https://attacker.example/functions/v1"')
     on conflict (key) do update set value = excluded.value $$,
  '22023', null,
  'Invariant 8: settings.edge_base_url refuses anything but a Supabase Functions base — an admin session cannot redirect the pg_cron bearer');
select lives_ok(
  $$ insert into settings (key, value) values ('edge_base_url', '"https://abcdefghijklmnopqrst.supabase.co/functions/v1"')
     on conflict (key) do update set value = excluded.value $$,
  'the project''s own functions base is accepted');
select is(edge_base_url(), 'https://abcdefghijklmnopqrst.supabase.co/functions/v1',
  'and edge_base_url() — what every cron command and the Willo nudge read — returns it');
select lives_ok(
  $$ insert into settings (key, value) values ('edge_base_url', '"http://host.docker.internal:54321/functions/v1"')
     on conflict (key) do update set value = excluded.value $$,
  'as is a local development base');
select ok(not has_function_privilege('authenticated', 'public.edge_base_url()', 'execute')
      and not has_function_privilege('anon', 'public.edge_base_url()', 'execute'),
  'the reader is not an RPC');

-- =====================================================================
-- E · No E6 from the wizard (392 pins the wizard; the profile route is
--     330's). Here: the wizard's NI write holds the same regex.
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'u_refs', 'role', 'authenticated')::text, true);
select throws_ok(
  $$ select submit_hmrc_checklist(false, false, false, 'none', false, 'ZZ 99 99 99 Z', true) $$,
  'P0001', 'invalid_ni',
  '§2.8 the wizard validates the NI number with staff_set_ni_number()''s own rule, without queueing E6');

select * from finish();
rollback;
