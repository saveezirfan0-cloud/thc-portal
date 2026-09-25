-- =====================================================================
-- 330 · The worker's own profile (§10.1) and Request my P45 (§10.6)
--       — 20260922180000_staff_self_service.sql
--
-- The weight of this file is on the things that are easy to get right on
-- a screen and wrong in the database, where it matters:
--
--   · staff_me() must never hand back the manager's block reason. §10.1
--     is unambiguous — "internal and never shown to the worker" — and the
--     only durable way to keep it is for the function not to select it.
--   · Name, NI and the avatar are locked. There is no function here that
--     writes a name at all, NI is set-once, and a photo that already
--     exists cannot be replaced from the app.
--   · E5, E6 and E7 are queued in the SAME transaction as the save they
--     describe. A bank change that saved without telling payroll is the
--     failure §2.10 exists to prevent.
--   · request_my_p45() takes no staff id. request_p45(uuid, …) granted to
--     `authenticated` would let any signed-in worker retire a colleague;
--     190_job_function_grants.sql asserts that grant stays absent, and
--     this file asserts the wrapper is what replaces it.
--   · staff_earnings() returns no charge rate and no holiday element. A
--     worker sees the base rate only (§9.8).
--
-- Every row is created inside the transaction and rolled back.
--
-- employee_id is 93xxx, not a number near the seed's. `staff.employee_id`
-- is unique and seed.sql already holds 412-1042, so a plausible-looking
-- 417 collides and takes the whole file down before assertion 1 — which
-- is exactly what it did the first time this ran. 220 and 230 use the
-- same 9xxxx convention; keep to it.
-- =====================================================================
begin;
select plan(47);

\set cl       'b1b1b1b1-0000-4000-8000-000000000001'
\set ro       'b2b2b2b2-0000-4000-8000-000000000001'
\set ve       'b3b3b3b3-0000-4000-8000-000000000001'
\set ev       'b4b4b4b4-0000-4000-8000-000000000001'
\set past     'b4b4b4b4-0000-4000-8000-000000000002'
\set sh       'b5b5b5b5-0000-4000-8000-000000000001'
\set shpast   'b5b5b5b5-0000-4000-8000-000000000002'
\set me       'b6b6b6b6-0000-4000-8000-000000000001'
\set mate     'b6b6b6b6-0000-4000-8000-000000000002'
\set me_uid   'b7b7b7b7-0000-4000-8000-000000000001'
\set mate_uid 'b7b7b7b7-0000-4000-8000-000000000002'
\set bk       'b8b8b8b8-0000-4000-8000-000000000001'
\set bkpast   'b8b8b8b8-0000-4000-8000-000000000002'

insert into auth.users (id, email) values
  (:'me_uid',   'me@selfservice.test'),
  (:'mate_uid', 'mate@selfservice.test');

insert into clients (id, name, contact_name, phone, staff_contact_point, contact_emails)
values (:'cl', 'Self Service Client', 'Cara C', '+447700900401', 'Front desk',
        array['c@selfservice.test']);
insert into roles (id, name, pay_rate) values (:'ro', 'Self Service Waiting Staff', 14.00);
insert into venues (id, name, address, location, venue_type, geofence_radius_m)
values (:'ve', 'Self Service Venue', '7 Test Street, London',
        st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 'hotel', 150);

insert into staff (id, user_id, first_name, last_name, email, phone, dob, home_address,
                   home_location, status, employee_id, rtw_branch)
values
  (:'me', :'me_uid', 'Amara', 'Kalu', 'me@selfservice.test', '+447700900321',
   date '1996-04-02', 'Flat 4, 22 Roman Road, London E2 0RY',
   st_setsrid(st_makepoint(-0.1010, 51.5005), 4326)::geography, 'compliant', 93301,
   'uk_irish'),
  (:'mate', :'mate_uid', 'Tom', 'Reid', 'mate@selfservice.test', '+447700900322',
   date '1994-01-09', '9 Other Road, London', null, 'compliant', 93302, 'uk_irish');
insert into staff_roles (staff_id, role_id) values (:'me', :'ro');

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer)
values
  (:'ev', :'cl', :'ve', 'Self Service Venue', '7 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Self Service Gala', (now() + interval '10 days')::date, false, false),
  (:'past', :'cl', :'ve', 'Self Service Venue', '7 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Self Service Board Dinner', (now() - interval '20 days')::date, false, false);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour)
values
  (:'sh', :'ev', :'ro', now() + interval '10 days', now() + interval '10 days 8 hours',
   2, 0, 22.97, 14.00, 2),
  -- A shift that ended on Saturday 5 September 2026 at 23:00 UK: the
  -- wireframe's own earnings card, paid on Friday 11 September.
  (:'shpast', :'past', :'ro',
   timestamptz '2026-09-05 15:00+01', timestamptz '2026-09-05 23:00+01',
   2, 0, 22.97, 14.00, 2);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'bk',     :'sh',     :'me', 'confirmed', 'auto', now()),
  (:'bkpast', :'shpast', :'me', 'worked',    'auto', timestamptz '2026-09-01 09:00+01');
insert into check_logs (booking_id, attempted_at, outcome, check_in_at, check_out_at)
values (:'bkpast', timestamptz '2026-09-05 15:00+01', 'checked_in',
        timestamptz '2026-09-05 15:00+01', timestamptz '2026-09-05 23:00+01');

-- The worker is the caller for everything below: none of these functions
-- takes an id, which is the property most of this file is about.
set local "request.jwt.claims" = '{"sub":"b7b7b7b7-0000-4000-8000-000000000001","role":"authenticated"}';

-- =====================================================================
-- 1. staff_me() — the sheet, and what it must not carry
-- =====================================================================
select is(staff_me()->>'staffId', :'me'::text,
  'staff_me() resolves the caller''s own row from the session, with no id to forge');
select is(staff_me()->>'firstName', 'Amara', 'and carries the name the sheet prints');
select is((staff_me()->>'employeeId')::int, 93301, 'and the Employee ID');
select is(staff_me()->>'checkedIn', 'false', 'not checked in, so Request my P45 is available');

select ok(not (staff_me() ? 'blockReason'),
  '§10.1: the manager''s block reason is internal and has no field to leak through');

update staff set status = 'blocked', block_kind = 'manual',
                 block_reason = 'Internal: repeated lateness' where id = :'me';
select is(staff_me()->>'blockKind', 'manual',
  'the KIND of block reaches the app, because it decides which lock screen shows');
select ok(staff_me()::text not like '%repeated lateness%',
  'but the reason itself never does, even on a manually blocked worker');
update staff set status = 'compliant', block_kind = null, block_reason = null where id = :'me';

-- =====================================================================
-- 2. Profile details — what may move, and what may not
-- =====================================================================
select lives_ok(
  $$ select staff_update_contact('+447700900999', 'Flat 4, 22 Roman Road, London E2 0RY') $$,
  'a worker may change their own phone number');
select is((select phone from staff where id = :'me'), '+447700900999', 'and it is saved');
select is((select first_name || ' ' || last_name from staff where id = :'me'), 'Amara Kalu',
  'their name is untouched: no function here writes one (§10.1)');

select is_empty(
  $$ select 1 from notification_outbox
      where template = 'E7' and payload->>'employeeId' = '93301' $$,
  '§8: a phone-only change is silent — E7 is for an email or an address');

select lives_ok(
  $$ select staff_update_contact('+447700900999', '12 New Street, London E1 6AN') $$,
  'and their home address');
select isnt_empty(
  $$ select 1 from notification_outbox where template = 'E7'
      and payload->>'employeeId' = '93301' and payload->>'changed' = 'home address' $$,
  'which DOES queue E7, in the same transaction as the save (§10.1, §8)');

-- The email path. Auth has verified the code and swapped the address on
-- auth.users; staff_sync_email() reads it off THERE — never off an
-- argument — moves staff.email, and queues E7 naming what changed.
update auth.users set email = 'amara.new@selfservice.test' where id = :'me_uid';
select is(staff_sync_email()->>'changed', 'true',
  'a verified new address on auth.users is picked up by staff_sync_email()');
select is((select email from staff where id = :'me'), 'amara.new@selfservice.test',
  'and staff.email moves to it — only now, after the code, never before (§10.1)');
select isnt_empty(
  $$ select 1 from notification_outbox where template = 'E7'
      and payload->>'employeeId' = '93301' and payload->>'changed' = 'email address' $$,
  'which queues E7 saying the email address changed (§8)');
select is(staff_sync_email()->>'changed', 'false',
  'a second call with nothing new is a no-op');
select is((select count(*)::int from notification_outbox where template = 'E7'
            and payload->>'employeeId' = '93301' and payload->>'changed' = 'email address'), 1,
  'and queues no second E7 for it');

-- =====================================================================
-- 3. NI number — set once, E6 on the way in
-- =====================================================================
select throws_ok($$ select staff_set_ni_number('not-an-ni') $$, 'P0001', 'invalid_ni',
  'a malformed National Insurance number is refused, not stored');
select lives_ok($$ select staff_set_ni_number('ab 12 34 56 c') $$,
  'a worker who joined without one may add it (§2.10)');
select is((select ni_number from staff where id = :'me'), 'AB123456C',
  'normalised: upper case, spaces stripped, one value however it was typed');
select isnt_empty($$ select 1 from notification_outbox
      where template = 'E6' and payload->>'employeeId' = '93301' $$,
  'and E6 goes to payroll');
select throws_ok($$ select staff_set_ni_number('AB123456C') $$, 'P0001', 'ni_locked',
  'it is locked from then on — a correction goes through the office');
-- The NI set two assertions above is AB123456C, so the mask is seven
-- dots and '6C'. The expected string here originally ended '2B', which
-- is the mask of a different number — the implementation was right.
select is(staff_me()->>'niMasked', '●●●●●●●6C',
  'the app only ever sees it masked, last two characters visible');

-- =====================================================================
-- 4. The avatar — set once (§10.1), and only in the caller's own folder
-- =====================================================================
select throws_ok(
  format($$ select staff_set_photo(%L) $$, :'mate' || '/selfie-1.jpg'),
  'P0001', 'wrong_path',
  'a worker cannot attach a file from somebody else''s folder to their profile');
select lives_ok(format($$ select staff_set_photo(%L) $$, :'me' || '/selfie-1.jpg'),
  'a worker with no photo may supply one');
select is((select photo_path from staff where id = :'me'), :'me' || '/selfie-1.jpg',
  'and it lands on the profile, which is what the whole system renders (§1.6)');
select throws_ok(format($$ select staff_set_photo(%L) $$, :'me' || '/selfie-2.jpg'),
  'P0001', 'photo_locked',
  '§10.1: set once and then locked — changing it afterwards goes through the office');

-- =====================================================================
-- 5. Bank & payroll — §2.10's E5 is part of the save
-- =====================================================================
select throws_ok($$ select staff_save_bank('Amara Kalu', '4047', '31926819') $$,
  'P0001', 'bad_sort_code', 'a sort code that is not six digits is refused');
select lives_ok($$ select staff_save_bank('Amara Kalu', '40-47-84', '31926819') $$,
  'a worker may change their own bank details from the app (§10.1)');
select is((select sort_code from bank_details where staff_id = :'me'), '40-47-84',
  'stored in the form payroll reads');
select isnt_empty($$ select 1 from notification_outbox
      where template = 'E5' and payload->>'employeeId' = '93301' $$,
  'and E5 is queued in the same transaction — §2.10''s "same notification as at onboarding"');

-- =====================================================================
-- 6. Earnings history — base pay only, and a derived pay date
-- =====================================================================
select is((select count(*)::int from staff_earnings()), 1,
  'staff_earnings() returns the worker''s own completed shifts');
select is((select pay_rate from staff_earnings()), 14.00,
  'with the BASE rate the worker is paid');
-- `returns table` puts the column names in proargnames, not in a
-- composite type, so that is where this has to look. Asserting the
-- ABSENCE of the column is stronger than asserting a screen does not
-- render it: a column that is never returned cannot be leaked by a later
-- screen either.
select is_empty(
  $$ select p.proname::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'staff_earnings'
        and p.proargnames && array['charge_rate', 'holiday_rate', 'final_rate'] $$,
  '§9.8: the charge rate has no column on this function, so it cannot reach a worker');
select is((select payable->>'payableMin' from staff_earnings())::int, 480,
  'the payable figure is payable_minutes() — the same one §9.9''s payroll export uses');
select is((select pay_date from staff_earnings()), date '2026-09-11',
  'paid the Friday after the Mon-Sun week worked: Sat 5 Sep 2026 pays on Fri 11 Sep');

-- =====================================================================
-- 7. Request my P45 — §10.6
-- =====================================================================
insert into check_logs (booking_id, attempted_at, outcome, check_in_at)
values (:'bk', now(), 'checked_in', now());
update shift_requirements set starts_at = now() - interval '1 hour',
                              ends_at   = now() + interval '7 hours' where id = :'sh';

select is(staff_me()->>'checkedIn', 'true',
  '§10.6 step 3: checked in, so the app greys the action out');
select throws_ok($$ select request_my_p45('Moving away') $$, 'P0001', 'on_shift',
  'and the database refuses it too — the button and the server share one rule');

delete from check_logs where booking_id = :'bk';
update shift_requirements set starts_at = now() + interval '10 days',
                              ends_at   = now() + interval '10 days 8 hours' where id = :'sh';

select lives_ok($$ select request_my_p45('Moving away') $$,
  'once checked out, a worker may retire themselves');
select is((select status::text from staff where id = :'me'), 'inactive',
  'status → inactive, which is the leaver state (§2.12)');
select is((select status::text from bookings where id = :'bk'), 'cancelled',
  'every future booking is released back to auto-assign (§10.6 step 2)');
select is((select status::text from bookings where id = :'bkpast'), 'worked',
  'and a shift already worked is not touched — it is still paid and billed (step 3)');
select isnt_empty($$ select 1 from notification_outbox
      where template = 'E8' and payload->>'employeeId' = '93301' $$,
  'E8 goes to the office immediately, not batched (step 6)');

-- =====================================================================
-- 8. The grants
--
-- request_p45(uuid, …) stays service-role only; 190_job_function_grants
-- asserts that. What `authenticated` gets is the wrapper with no id in
-- it, so there is nothing to point at a colleague.
-- =====================================================================
reset role;
select is_empty(
  $$ select p.proname::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('staff_me', 'staff_update_contact', 'staff_sync_email',
                          'staff_set_ni_number', 'staff_set_photo', 'staff_save_bank',
                          'staff_earnings', 'request_my_p45', 'queue_contact_change')
        and has_function_privilege('anon', p.oid, 'execute') $$,
  'no signed-out caller can reach any of the profile write paths');

select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'queue_contact_change'
        and has_function_privilege('authenticated', p.oid, 'execute') $$,
  'E7 is queued by the two functions that change a contact detail, never called directly');

select is_empty(
  $$ select p.proname::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('staff_me', 'staff_update_contact', 'staff_set_ni_number',
                          'staff_set_photo', 'staff_save_bank', 'staff_earnings',
                          'request_my_p45')
        and not has_function_privilege('authenticated', p.oid, 'execute') $$,
  'and a signed-in worker can reach all seven of their own — a missing grant is a dead screen');

select * from finish();
rollback;
