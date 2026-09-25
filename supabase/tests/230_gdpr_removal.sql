-- =====================================================================
-- 230 · GDPR removal (§1.7, §9.6 Remove)
--   remove_worker(), deleted_account_label()
--   from 20260921190118_gdpr_removal.sql
--
-- The wiping is the easy half and almost every assertion here is about
-- the other one. §1.7 is unusually specific about what must SURVIVE a
-- removal, because a removal that takes too much breaks billing, HMRC,
-- and the client's own record of who worked their event:
--
--   * the row is never filtered out — it stays, labelled, "so the
--     slot/headcount isn't skewed"
--   * the Employee ID stays, because every historical timesheet and
--     payroll line reconciles through it, and it IS the #id in the label
--   * history — bookings, feedback, violations, check-ins — is "retained
--     for reporting"
--   * feedback text is retained VERBATIM: §1.7 says the name should
--     ideally be redacted, then defines v1 as not doing it
--
-- Nothing here tests the PDFs. §11.3 keeps an issued copy exactly as
-- issued because it is a file, not a row; a regenerated copy reads the
-- anonymised row and prints the new label with no code of its own.
-- =====================================================================
begin;
select plan(32);
\set now '2026-09-21 12:00:00+01'
\ir _shared/fixtures.psql

\set gdpr 'd3000000-0000-4000-8000-000000000001'
\set keep 'd3000000-0000-4000-8000-000000000002'
\set gdpr_uid '66666666-6666-6666-6666-666666666666'

-- A real auth user to unlink. Without one the worker starts with a null
-- user_id and the "login is disabled" assertion below passes whether or
-- not remove_worker touches the column.
insert into auth.users (id, email) values (:'gdpr_uid', 'grace@rls.test');

insert into staff (id, user_id, employee_id, first_name, last_name, email, phone, dob, status,
                   rtw_branch, home_address, photo_path, ni_number, share_code,
                   right_to_work_until, graduated_at, term_dates, wtr_optout) values
  -- Employee IDs are UNIQUE and supabase/seed.sql already holds 1042 —
  -- the canonical "Deleted account #1042" from wireframes/CONVENTIONS.md.
  -- Reusing the number to make the label read familiarly collides with
  -- the seed's own removed worker; the label format is pinned below as a
  -- pure function call instead, where no row is involved.
  (:'gdpr', :'gdpr_uid', 91042, 'Grace','Lindqvist','grace@example.com','+447700900105', date '1997-03-30',
   'compliant','international_student','Roman Rd, London E3','photos/grace.jpg','QQ999999C',
   'W123456AB', date '2027-01-01', date '2026-06-30', '{"[2026-06-15,2026-09-28)"}', true),
  (:'keep', null, 91043, 'Stays','Here','stays@example.com','+447700900106', date '1996-01-01',
   'compliant','uk_irish', 'Somewhere', 'photos/stays.jpg','QQ888888C', null, null, null, '{}', false);

insert into bank_details (staff_id, account_holder, sort_code, account_number)
values (:'gdpr','G Lindqvist','00-00-00','12345678'), (:'keep','S Here','11-11-11','87654321');
insert into staff_references (staff_id, name, relationship, phone, email)
values (:'gdpr','A Referee','Manager','+447700900900','ref@example.com');
insert into hmrc_checklists (staff_id, q1_other_job, statement, declared)
values (:'gdpr', false, 'A', true);
insert into push_subscriptions (staff_id, endpoint, p256dh, auth)
values (:'gdpr','https://push.example/gdpr','key','auth');
insert into compliance_docs (id, staff_id, doc_type, review_status, uploaded_at)
values ('e3000000-0000-4000-8000-000000000001', :'gdpr','passport','verified', :'now'::timestamptz);
insert into criminal_declarations (id, staff_id, source, answer, details, conviction_date, review_status)
values ('f3000000-0000-4000-8000-000000000001', :'gdpr','in_employment', true,
        'Details the office read once and nobody else may', date '2026-01-01','verified');

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  ('a3000000-0000-4000-8000-000000000001', :'clienta', :'venue_id', 'RLS Fixture Venue',
   '1 Test Street, London', st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Removal Event', date '2026-10-05', false, true);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  ('b3000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',:'role_id','2026-10-05 18:00+00','2026-10-06 02:00+00',4,0,30,15,1),
  ('b3000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000001',:'role_id','2026-09-01 18:00+00','2026-09-02 02:00+00',4,0,30,15,1);
insert into bookings (id, shift_id, staff_id, status, source) values
  ('c3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',:'gdpr','confirmed','auto'),
  ('c3000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000002',:'gdpr','worked','auto');
insert into violations (staff_id, booking_id, type, minutes_late)
values (:'gdpr','c3000000-0000-4000-8000-000000000002','late', 7);
insert into feedback (id, author_kind, author_id, staff_id, event_id, rating, text)
values ('d4000000-0000-4000-8000-000000000001','client', :'clienta_uid', :'gdpr',
        'a3000000-0000-4000-8000-000000000001', 5, 'Grace ran the floor brilliantly all night');

create temporary table t_rm as select remove_worker(:'gdpr', :'now'::timestamptz, :'admin_uid') as r;

-- ---------------------------------------------------------------------
-- Login disabled (§1.7; wireframes/staff/auth.html "A GDPR-removed
-- account cannot sign in at all"). Until 20260927160400 the row was only
-- unlinked, and the old password still opened an unlocked staff shell.
-- ---------------------------------------------------------------------
select is((select r->>'loginDisabled' from t_rm), 'true',
  '§1.7 "login disabled": the removal bans the auth account itself');
select ok((select banned_until > now() + interval '50 years' from auth.users where id = :'gdpr_uid'),
  'GoTrue refuses a sign-in while banned_until is in the future — a century out');
select is((select user_id from staff where id = :'gdpr'), null,
  'and the link is still broken afterwards, so no session can resolve to the row');
select is((select actor from audit_log where action = 'gdpr_remove' and entity_id = :'gdpr'), :'admin_uid'::uuid,
  'the audit row names the manager who pressed it (p_actor): the service key the office calls with carries no sub');

-- ---------------------------------------------------------------------
-- Anonymised.
-- ---------------------------------------------------------------------
select is((select status::text from staff where id = :'gdpr'), 'removed',
  '§1.7: status Removed');
select is((select first_name || ' ' || last_name from staff where id = :'gdpr'), 'Deleted account',
  'the name is replaced, in the shape supabase/seed.sql and the wireframes already use');
select is((select r->>'label' from t_rm), 'Deleted account #91042',
  'and the label the Removed tab, the event board and a regenerated timesheet all print');
select is(deleted_account_label(1042), 'Deleted account #1042',
  'in the exact form wireframes/CONVENTIONS.md and supabase/seed.sql already use — asserted as a pure function, because the seed holds employee_id 1042 and the column is unique');
select is(deleted_account_label(null), 'Deleted account #unknown',
  'and a worker removed before §2.7 ever issued them an ID gets a label rather than "#null" on a client''s timesheet');
select is((select email from staff where id = :'gdpr'), 'removed-91042@invalid.example',
  'the address is replaced with one that cannot receive anything');
select is(
  (select coalesce(home_address,'-') || '/' || coalesce(photo_path,'-') || '/' ||
          coalesce(ni_number,'-') || '/' || coalesce(share_code,'-')
     from staff where id = :'gdpr'),
  '-/-/-/-', 'contacts, photo, NI number and share code are wiped');
select is((select user_id from staff where id = :'keep'), null,
  'the control worker never had a login, which is what makes the next assertion mean something');
select is((select user_id from staff where id = :'gdpr'), null,
  'login is disabled by unlinking the auth user — the GoTrue row itself is deleted through the admin API, which SQL cannot reach');
select is((select removed_at from staff where id = :'gdpr'), :'now'::timestamptz,
  'and the removal is stamped');
select is(
  (select dob::text || '/' || phone from staff where id = :'gdpr'),
  '1900-01-01/+440000000000',
  'dob and phone are `not null` — dob carries §1.7''s own age check — so they take sentinels that identify nobody rather than nulls');
select is(
  (select coalesce(right_to_work_until::text,'-') || '/' || coalesce(graduated_at::text,'-') || '/' ||
          coalesce(array_length(term_dates,1)::text,'0') || '/' || wtr_optout::text
     from staff where id = :'gdpr'),
  '-/-/0/false',
  'and every cap input goes with the evidence behind it — RULE-20 reads the profile live, so a removed worker must not keep a calculated cap off documents that no longer exist');

-- ---------------------------------------------------------------------
-- Documents and the evidence sets that are nothing but personal data.
-- ---------------------------------------------------------------------
select is((select r->>'documentsDeleted' from t_rm), '1', 'every compliance document is deleted, not superseded — this is not a reset');
select is((select count(*)::int from compliance_docs  where staff_id = :'gdpr'), 0, 'and none is left behind');
select is((select count(*)::int from bank_details     where staff_id = :'gdpr'), 0, 'bank details go');
select is((select count(*)::int from staff_references where staff_id = :'gdpr'), 0, 'referees are other people''s personal data and go too');
select is((select count(*)::int from hmrc_checklists  where staff_id = :'gdpr'), 0, 'the HMRC checklist goes');
select is((select count(*)::int from push_subscriptions where staff_id = :'gdpr'), 0, 'and the device subscriptions, which are both personal data and a live channel to a disabled account');
select is((select count(*)::int from bank_details where staff_id = :'keep'), 1,
  'nobody else''s data is touched');

-- ---------------------------------------------------------------------
-- What survives, which is most of §1.7.
-- ---------------------------------------------------------------------
select is((select employee_id from staff where id = :'gdpr'), 91042,
  '§2.7/§9.9: the Employee ID is retained, because every historical timesheet and payroll line reconciles through it — and it is the #id in the label');
select is((select status::text || '/' || cancel_cause from bookings where id = 'c3000000-0000-4000-8000-000000000001'),
  'cancelled/gdpr', 'future bookings are released, with the cause 0001_init reserved for this');
select is((select status::text from bookings where id = 'c3000000-0000-4000-8000-000000000002'), 'worked',
  '§1.7: history is retained for reporting — a worked shift is billing and HMRC, not personal data');
select is((select count(*)::int from violations where staff_id = :'gdpr'), 1,
  'and so are violations, which is what keeps a past event''s record of the day intact');
select is((select text from feedback where id = 'd4000000-0000-4000-8000-000000000001'),
  'Grace ran the floor brilliantly all night',
  '§1.7 v1: feedback comments are retained VERBATIM. The scope confirms the name should ideally be redacted, and then rules the LLM step out of v1 — the office redacts by editing or deleting the entry if asked');

-- §10.7's half-wipe: the details go, the fact and the outcome stay.
select is((select details from criminal_declarations where id = 'f3000000-0000-4000-8000-000000000001'), null,
  '§10.7: the declaration details are wiped with the rest of the personal data');
select is((select answer::text || '/' || review_status::text from criminal_declarations where id = 'f3000000-0000-4000-8000-000000000001'),
  'true/verified',
  'while the fact that a declaration existed and its review outcome are retained as part of the compliance record');

-- ---------------------------------------------------------------------
-- Twice is once. A double confirmation that is double-submitted must not
-- leave half a removal behind.
-- ---------------------------------------------------------------------
select is((remove_worker(:'gdpr', :'now'::timestamptz))->>'alreadyRemoved', 'true',
  'a second removal is a no-op rather than an error or a second pass');
select is((select employee_id from staff where id = :'gdpr'), 91042,
  'and does not re-derive the label from an Employee ID it has just wiped');

select * from finish();
rollback;
