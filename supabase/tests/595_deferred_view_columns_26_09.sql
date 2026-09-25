-- =====================================================================
-- 595 · The database half of the 26.09 "shared_change_needed" deferrals
--       — 20260927170000_deferred_view_columns_26_09.sql
--
--   A. Both office views stay security_invoker (ADR-0004).
--   B. The office reads every appended column, and each one says what
--      its header promises: quiz_scores in attempt order; the
--      additional-info stamp only once all three steps are in; an
--      activation date only once the password exists; the cap's end
--      only for a calendar-driven band; the last WORKED shift; released
--      shifts counted by cause; the P45 stamp only while inactive.
--   C. A client sees no row of either view; a worker sees nobody else.
--   D. staff_me() carries rejectionCause and still never the reason.
--   E. activation_preview() says whether the link is spent.
--   F. The new definer helper is pinned and granted like its sibling.
--
-- employee_id is 95xxx (330's convention: the seed holds 412-1042).
-- =====================================================================
begin;
select plan(31);
\ir _shared/fixtures.psql

\set c_quiz   '59500000-0000-4000-8000-000000000001'
\set c_add    '59500000-0000-4000-8000-000000000002'
\set c_half   '59500000-0000-4000-8000-000000000003'
\set c_act    '59500000-0000-4000-8000-000000000004'
\set c_wait   '59500000-0000-4000-8000-000000000005'
\set u_quiz   '59500000-0000-4000-8000-0000000000a1'
\set u_act    '59500000-0000-4000-8000-0000000000a4'
\set u_wait   '59500000-0000-4000-8000-0000000000a5'
\set w_left   '59510000-0000-4000-8000-000000000001'
\set w_stud   '59510000-0000-4000-8000-000000000002'
\set ev_old   '59520000-0000-4000-8000-000000000001'
\set ev_fut   '59520000-0000-4000-8000-000000000002'
\set sh_old1  '59530000-0000-4000-8000-000000000001'
\set sh_old2  '59530000-0000-4000-8000-000000000002'
\set sh_f1    '59530000-0000-4000-8000-000000000011'
\set sh_f2    '59530000-0000-4000-8000-000000000012'
\set sh_f3    '59530000-0000-4000-8000-000000000013'
\set sh_f4    '59530000-0000-4000-8000-000000000014'
\set sh_f5    '59530000-0000-4000-8000-000000000015'
-- 56 hex characters: the shape of GoTrue's hashed token (sha224).
\set tok_act  'd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4'
\set tok_wait 'e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5'

-- ---- logins -------------------------------------------------------
-- u_act verified the invite (confirmed) AND set a password: activated.
-- u_wait is confirmed but has no password: the link was opened, nothing
-- more. u_quiz is a rejected candidate's login, for staff_me().
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, confirmation_token) values
  (:'u_act',  'act@deferred.test',  '$2a$10$notarealhashbutnotemptyeither', timestamptz '2026-09-13 09:41:00+01', '{"role":"staff"}', :'tok_act'),
  (:'u_wait', 'wait@deferred.test', null,                                   timestamptz '2026-09-14 10:00:00+01', '{"role":"staff"}', :'tok_wait'),
  (:'u_quiz', 'quiz@deferred.test', '$2a$10$notarealhashbutnotemptyeither', now() - interval '20 days',            '{"role":"staff"}', '');
insert into profiles (id, role, full_name) values
  (:'u_act',  'staff', 'Ines Activated'),
  (:'u_wait', 'staff', 'Wen Waiting'),
  (:'u_quiz', 'staff', 'Quinn Failed');

-- ---- candidates -----------------------------------------------------
insert into staff (id, user_id, employee_id, first_name, last_name, email, phone, dob, status, rtw_branch,
                   onboarding_started_at, stage_entered_at, rejected_at, rejected_from, rejection_cause, rejection_reason) values
  (:'c_quiz', :'u_quiz', null, 'Quinn', 'Failed',    'quiz@deferred.test', '+447700959001', date '2001-01-01', 'rejected', 'uk_irish',
   now() - interval '10 days', now() - interval '1 day', now() - interval '1 day', 'quiz', 'quiz_failed', 'Internal: did not read the deck'),
  (:'c_add',  null,      null, 'Ada',   'Complete',  'add@deferred.test',  '+447700959002', date '2001-02-02', 'contract', 'uk_irish',
   now() - interval '10 days', now() - interval '3 days', null, null, null, null),
  (:'c_half', null,      null, 'Hal',   'Halfway',   'half@deferred.test', '+447700959003', date '2001-03-03', 'contract', 'uk_irish',
   now() - interval '10 days', now() - interval '3 days', null, null, null, null),
  (:'c_act',  :'u_act',  null, 'Ines',  'Activated', 'act@deferred.test',  '+447700959004', date '2001-04-04', 'documents', 'uk_irish',
   now() - interval '10 days', now() - interval '5 days', null, null, null, null),
  (:'c_wait', :'u_wait', null, 'Wen',   'Waiting',   'wait@deferred.test', '+447700959005', date '2001-05-05', 'documents', 'uk_irish',
   now() - interval '10 days', now() - interval '5 days', null, null, null, null);

-- Three attempts, inserted OUT of attempt order and with the best one in
-- the middle, so "in attempt order" is what the assertion proves.
insert into quiz_attempts (staff_id, attempt_no, score, passed, answers, taken_at) values
  (:'c_quiz', 2, 75, false, '{}', now() - interval '2 days'),
  (:'c_quiz', 3, 70, false, '{}', now() - interval '1 day'),
  (:'c_quiz', 1, 65, false, '{}', now() - interval '3 days');

-- ADR-0013: the three wizard stamps. The bank stamp is deliberately the
-- latest, and not the last inserted column, so greatest() is what is read.
insert into onboarding_progress (staff_id, hmrc_at, references_at, bank_at) values
  (:'c_add',  timestamptz '2026-09-17 11:03:00+01', timestamptz '2026-09-17 11:20:00+01', timestamptz '2026-09-18 08:12:00+01'),
  (:'c_half', timestamptz '2026-09-17 11:03:00+01', null, null);

-- ---- workers --------------------------------------------------------
-- w_left left through the app (§10.6): inactive, left_at stamped by
-- request_p45(). staffb gets a stale left_at on a compliant row — the
-- shape Reset to candidate leaves behind (20260921192246) — and must NOT
-- read as a P45 request.
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status, left_at, leave_reason, rtw_branch) values
  (:'w_left', 95101, 'Rosa', 'Leaver', 'rosa@deferred.test', '+447700959101', date '1996-06-06', 'inactive',
   timestamptz '2026-09-17 21:14:00+01', 'Moving back to Spain in October', 'uk_irish');
update staff set left_at = now() - interval '1 year' where id = :'staffb';

-- An International student in term time whose holiday starts the week
-- after next, so the 20 h band has a Sunday it holds until (§4.4).
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status, rtw_branch, right_to_work_until, term_dates) values
  (:'w_stud', 95102, 'Amara', 'Term', 'amara@deferred.test', '+447700959102', date '2002-05-05', 'compliant', 'international_student',
   current_date + 400,
   array[daterange(cap_week_start((now() at time zone 'Europe/London')::date) + 14,
                   cap_week_start((now() at time zone 'Europe/London')::date) + 28)]);

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, po_number) values
  (:'ev_old', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Corporate Lunch', current_date - 3, true, true, '5950-A'),
  (:'ev_fut', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Gala Dinner', current_date + 9, true, true, '5950-B');

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour) values
  (:'sh_old1', :'ev_old', :'role_id', now() - interval '3 days 8 hours',  now() - interval '3 days',           4, 0, 22.97, 14.00, 'Black tie', 4),
  (:'sh_old2', :'ev_old', :'role_id', now() - interval '10 days 8 hours', now() - interval '10 days',          4, 0, 22.97, 14.00, 'Black tie', 4),
  (:'sh_f1',   :'ev_fut', :'role_id', now() + interval '9 days',          now() + interval '9 days 6 hours',   4, 0, 22.97, 14.00, 'Black tie', 4),
  (:'sh_f2',   :'ev_fut', :'role_id', now() + interval '9 days 7 hours',  now() + interval '9 days 13 hours',  4, 0, 22.97, 14.00, 'Black tie', 4),
  (:'sh_f3',   :'ev_fut', :'role_id', now() + interval '10 days',         now() + interval '10 days 6 hours',  4, 0, 22.97, 14.00, 'Black tie', 4),
  (:'sh_f4',   :'ev_fut', :'role_id', now() + interval '10 days 7 hours', now() + interval '10 days 13 hours', 4, 0, 22.97, 14.00, 'Black tie', 4),
  (:'sh_f5',   :'ev_fut', :'role_id', now() + interval '11 days',         now() + interval '11 days 6 hours',  4, 0, 22.97, 14.00, 'Black tie', 4);

-- Two worked shifts (the later one is the answer); four released by the
-- system — two with the leaving, one at the cutoff, one by a block; and
-- three that are NOT releases: the worker's own cancel, the office
-- withdrawing, and a declined invitation.
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at, cancelled_at, cancel_cause) values
  ('59540000-0000-4000-8000-000000000001', :'sh_old1', :'w_left', 'worked',    'auto',   now() - interval '5 days',  null, null),
  ('59540000-0000-4000-8000-000000000002', :'sh_old2', :'w_left', 'worked',    'auto',   now() - interval '12 days', null, null),
  ('59540000-0000-4000-8000-000000000003', :'shift_a', :'w_left', 'cancelled', 'auto',   now() - interval '9 days',  timestamptz '2026-09-17 21:14:00+01', 'left'),
  ('59540000-0000-4000-8000-000000000004', :'shift_b', :'w_left', 'cancelled', 'manual', now() - interval '9 days',  timestamptz '2026-09-17 21:14:00+01', 'left'),
  ('59540000-0000-4000-8000-000000000005', :'sh_f1',   :'w_left', 'cancelled', 'auto',   now() - interval '9 days',  now() - interval '8 days', 'ready_cutoff'),
  ('59540000-0000-4000-8000-000000000006', :'sh_f2',   :'w_left', 'cancelled', 'auto',   now() - interval '9 days',  now() - interval '8 days', 'blocked'),
  ('59540000-0000-4000-8000-000000000007', :'sh_f3',   :'w_left', 'cancelled', 'auto',   now() - interval '9 days',  now() - interval '8 days', 'self_cancel'),
  ('59540000-0000-4000-8000-000000000008', :'sh_f4',   :'w_left', 'cancelled', 'manual', now() - interval '9 days',  now() - interval '8 days', 'office_withdraw'),
  ('59540000-0000-4000-8000-000000000009', :'sh_f5',   :'w_left', 'closed',    'auto',   null,                       now() - interval '8 days', 'declined');

-- =====================================================================
-- A · structure
-- =====================================================================
select ok((select 'security_invoker=true' = any(reloptions) from pg_class where relname = 'onboarding_candidates_v'),
  'onboarding_candidates_v is still security_invoker (ADR-0004)');
select ok((select 'security_invoker=true' = any(reloptions) from pg_class where relname = 'staff_directory_v'),
  'staff_directory_v is still security_invoker (ADR-0004)');

-- =====================================================================
-- B · the office reads the appended columns
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

-- onboarding_candidates_v
select is((select quiz_scores from onboarding_candidates_v where id = :'c_quiz'), array[65, 75, 70],
  '§2.9 quiz_scores lists every attempt this period in attempt order — "65% · 75% · 70%", not best-first and not insert order');
select is((select quiz_scores from onboarding_candidates_v where id = :'c_add'), '{}'::int[],
  'and is an empty array, not null, for a candidate with no attempt');
select is((select additional_info_done_at from onboarding_candidates_v where id = :'c_add'),
  timestamptz '2026-09-18 08:12:00+01',
  'ADR-0013 additional_info_done_at is the latest of the three wizard stamps (here the bank one)');
select is((select additional_info_done_at from onboarding_candidates_v where id = :'c_half'), null::timestamptz,
  'and null while any of HMRC, references or bank is still open — the card has not moved to Contract');
select is((select activated_at from onboarding_candidates_v where id = :'c_act'), timestamptz '2026-09-13 09:41:00+01',
  '§2.7 activated_at is the confirmation stamp of a login that has a password');
select is((select activated_at from onboarding_candidates_v where id = :'c_wait'), null::timestamptz,
  'a login confirmed but without a password has no activation date, exactly as `activated` says');
select is((select activated from onboarding_candidates_v where id = :'c_wait'), false,
  '(and `activated` itself is unchanged: false there)');

-- staff_directory_v
select is((select weekly_cap_until from staff_directory_v where id = :'w_stud'),
  cap_band_until((select term_dates from staff where id = :'w_stud'), (now() at time zone 'Europe/London')::date),
  '§4.4 weekly_cap_until is cap_band_until() for a term-time student — the same date N14 prints');
select ok((select weekly_cap_until from staff_directory_v where id = :'w_stud') is not null
      and extract(dow from (select weekly_cap_until from staff_directory_v where id = :'w_stud')) = 0
      and (select weekly_cap_until from staff_directory_v where id = :'w_stud') > (now() at time zone 'Europe/London')::date,
  'and it is a Sunday ahead of today, because the holiday begins the week after next');
select is((select weekly_cap_band::text from staff_directory_v where id = :'w_stud'), 'student_term_20',
  '(on the 20 h band, so the date has a rule behind it)');
select is((select weekly_cap_until from staff_directory_v where id = :'staffa'), null::date,
  'standard_48 has no end on the calendar: null, so the sentence reads without an "until"');
select is((select last_shift_at from staff_directory_v where id = :'w_left'),
  (select ends_at from shift_requirements where id = :'sh_old1'),
  '§10.6 last_shift_at is the end of the most recent WORKED shift, not an older one');
select is((select last_shift_at from staff_directory_v where id = :'staffa'), null::timestamptz,
  'a confirmed-only worker has no last completed shift yet');
select is((select released_shift_count from staff_directory_v where id = :'w_left'), 4,
  'released_shift_count counts the shifts the system took back — left ×2, ready_cutoff, blocked — and not self_cancel, office_withdraw or a declined invitation');
select is((select released_shift_count from staff_directory_v where id = :'staffa'), 0,
  'and is 0, not null, for a worker who lost nothing');
select is((select p45_requested_at from staff_directory_v where id = :'w_left'), timestamptz '2026-09-17 21:14:00+01',
  '§10.6 p45_requested_at is the leaver''s left_at');
select is((select p45_requested_at from staff_directory_v where id = :'staffb'), null::timestamptz,
  'but a stale left_at on a row that is not inactive (Reset to candidate keeps it) is not a P45 request');
reset role;

-- =====================================================================
-- C · a client sees nothing; a worker sees nobody else
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from staff_directory_v), 0,
  'ADR-0004: a client reads no row of staff_directory_v — there is no client policy on staff to widen');
select is((select count(*)::int from onboarding_candidates_v), 0,
  'nor of onboarding_candidates_v');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from staff_directory_v where id <> :'staffa'), 0,
  'a worker sees no other worker''s directory row — no leaver''s P45 stamp, no released count');
select is((select count(*)::int from onboarding_candidates_v where id <> :'staffa'), 0,
  'and no other candidate''s quiz scores or activation date');
reset role;

-- =====================================================================
-- D · staff_me(): the cause, never the reason
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'u_quiz', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(staff_me()->>'rejectionCause', 'quiz_failed',
  '§10.1 staff_me() carries rejectionCause, which picks E4''s wording over the neutral screen');
select ok(not (staff_me() ? 'rejectionReason'),
  'ADR-0017: there is no rejectionReason field to leak through');
select ok(staff_me()::text not like '%did not read the deck%',
  'and the office''s reason appears nowhere in the payload');
reset role;

-- =====================================================================
-- E · activation_preview(): is the link spent?
-- =====================================================================
select is(activation_preview(:'tok_act') ->> 'activated', 'true',
  '§2.7 a token whose login already has a password previews as activated — the page says so instead of a form that would fail');
select is(activation_preview(:'tok_act') ->> 'firstName', 'Ines',
  'and still greets by name');
select is(activation_preview(:'tok_wait') ->> 'activated', 'false',
  'a confirmed login with no password is not activated: the form is shown');

-- =====================================================================
-- F · the definer helper behind activated_at
-- =====================================================================
select is_empty(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'staff_account_activated_at'
        and not (p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=%') $$,
  'staff_account_activated_at is security definer with a pinned search_path, like staff_account_activated');
select ok(not has_function_privilege('anon', 'staff_account_activated_at(uuid)', 'execute')
      and has_function_privilege('authenticated', 'staff_account_activated_at(uuid)', 'execute')
      and has_function_privilege('service_role', 'staff_account_activated_at(uuid)', 'execute'),
  'and is granted exactly as its sibling: authenticated and the service role, never anon');

select * from finish();
rollback;
