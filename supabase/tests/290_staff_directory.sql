-- =====================================================================
-- 290 · Staff directory and the Student visa view (§9.6, §4.5)
--                             — 20260922091732_staff_directory.sql
--
-- Two things carry real weight here.
--
-- §1.7's anonymisation is applied in the view rather than trusted to have
-- been written over the columns, so the assertions below check that a
-- removed worker's name, photo and leaving reason cannot be printed even
-- while the underlying row still holds them — which is exactly the state
-- a half-finished wipe would leave.
--
-- RULE-20's cap is read, never stored. The directory must show the band
-- the cap came from, because "20 h" and "48 h" mean different things to a
-- manager depending on whether it is term time, a holiday or a graduation.
-- =====================================================================
begin;
select plan(27);
\ir _shared/fixtures.psql

\set removed_staff 'ababab00-0000-4000-8000-000000000001'
\set student_staff 'ababab00-0000-4000-8000-000000000002'

-- A GDPR-removed worker whose personal columns are still populated: the
-- view has to anonymise regardless of what the row holds (§1.7).
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status,
                   photo_path, rating, reliability, removed_at, leave_reason) values
  (:'removed_staff', 91042, 'Removed', 'Worker', 'gone@rls.test', '+447700900099',
   date '1990-01-01', 'removed', 'selfies/removed.jpg', 4.30, 97.00, now(), 'moving abroad');
insert into staff_roles (staff_id, role_id) values (:'removed_staff', :'role_id');

-- An International student in term time, so the §4.5 view has a row whose
-- cap is the 20 h one (RULE-20).
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status,
                   rtw_branch, right_to_work_until, rating, reliability, term_dates) values
  (:'student_staff', 90873, 'Amara', 'Student', 'amara@rls.test', '+447700900098',
   date '2002-05-05', 'compliant', 'international_student', current_date + 400, 4.60, 98.00,
   array[daterange(current_date - 200, current_date - 100)]);

insert into compliance_docs (staff_id, doc_type, review_status, reviewed_at, expiry_date) values
  (:'student_staff', 'university_term_dates_letter', 'verified', now(), current_date + 100);

-- ---- structure --------------------------------------------------------
select ok((select 'security_invoker=true' = any(reloptions) from pg_class where relname = 'staff_directory_v'),
  'staff_directory_v is security_invoker');
select ok((select 'security_invoker=true' = any(reloptions) from pg_class where relname = 'student_visa_v'),
  'student_visa_v is security_invoker');

-- ---- admin ------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select display_name from staff_directory_v where id = :'staffa'), 'Staff Alpha',
  'a live worker shows their name');
select is((select role_names from staff_directory_v where id = :'staffa'), array['RLS Fixture Role'],
  'with their role qualifications, which is what makes them bookable at all (§3.4)');
select is((select unresolved_violations from staff_directory_v where id = :'staffa'), 1,
  'and their unresolved violations, which the directory prints under the status');

-- ---- §1.7 anonymisation ----------------------------------------------
select is((select display_name from staff_directory_v where id = :'removed_staff'),
  'Deleted account #91042',
  'a removed worker reads as "Deleted account #id" (§1.7)');
select is((select display_name from staff_directory_v where id = :'removed_staff'),
  deleted_account_label(91042),
  'and it is deleted_account_label()''s answer, not a second copy of the rule — the client portal names the same person from the same function');
select is((select photo_path from staff_directory_v where id = :'removed_staff'), null,
  'their photo is not reachable through the view');
select is((select leave_reason from staff_directory_v where id = :'removed_staff'), null,
  'nor the reason they gave for leaving');
select is((select first_name from staff where id = :'removed_staff'), 'Removed',
  'even though the underlying row still holds it — the view is what protects it, so a wipe that half-ran cannot leak a name');
select is((select role_names from staff_directory_v where id = :'removed_staff'),
  array['RLS Fixture Role'],
  'roles survive removal: §1.7 keeps history, it only anonymises the person');
select is((select rating from staff_directory_v where id = :'removed_staff'), 4.30::numeric,
  'and so does the rating');
select is((select removed from staff_directory_v where id = :'removed_staff'), true,
  'the row says it is removed, so the directory can style it without parsing the name');

-- ---- RULE-20, read not stored ----------------------------------------
select is((select weekly_cap_hours from staff_directory_v where id = :'student_staff'), 20,
  'an International student in term time is capped at 20 h (RULE-20)');
select is((select weekly_cap_band from staff_directory_v where id = :'student_staff')::text,
  'student_term_20',
  'and the band says which rule produced it, because "20 h" alone does not');
select is((select weekly_cap_hours from staff_directory_v where id = :'staffa'), 48,
  'a worker with no visa limit is on the standard 48');

-- The cap is derived on the date it is read. Moving the holiday range over
-- today has to move the cap with no write anywhere.
-- The range starts before this week's Monday: a Mon–Sun week straddling
-- term and holiday takes the lower cap (RULE-20), so a range starting
-- yesterday only read as holiday when the test ran on a Monday or Tuesday.
update staff set term_dates = array[daterange(date_trunc('week', (now() at time zone 'Europe/London'))::date - 1,
                                              (now() at time zone 'Europe/London')::date + 30)]
 where id = :'student_staff';
select is((select weekly_cap_hours from staff_directory_v where id = :'student_staff'), 48,
  'the same worker in a university holiday is 48 h — nothing was stored, so nothing had to be updated');

-- ---- do-not-return ----------------------------------------------------
update client_qualifications set do_not_return = true where id = :'qual_a';
select is(
  (select array_length(do_not_return_clients, 1) from staff_directory_v where id = :'staffa'), 1,
  'a do-not-return mark names the client on the directory row (§9.6)');
select is((select do_not_return_clients from staff_directory_v where id = :'staffb'), '{}'::text[],
  'a worker with none gets an empty array, never null');

-- ---- §4.5 student visa view ------------------------------------------
select is((select count(*)::int from student_visa_v where id = :'student_staff'), 1,
  'the student is in the §4.5 Student visa view');
select is((select count(*)::int from student_visa_v where id = :'staffa'), 0,
  'and a worker who is not on the International student branch is not');
select is(
  (select bool_and(rtw_branch = 'international_student') from staff where id in (select id from student_visa_v)),
  true,
  'the view holds the International student branch and nothing else (§4.5)');
select isnt((select term_letter_verified_at from student_visa_v where id = :'student_staff'), null,
  'with the evidence that produced the cap: the verified term dates letter');
select is((select completion_letter_verified_at from student_visa_v where id = :'student_staff'), null,
  'and no completion letter, because this one has not graduated (§4.5)');

-- ---- client and worker ------------------------------------------------
-- `staff` carries date of birth, address, NI number and right-to-work
-- state. §11.1: a client sees no worker personal data at all.
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from staff_directory_v), 0,
  'a client reads no worker through staff_directory_v (§11.1)');

reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from staff_directory_v), 1,
  'a worker reaches exactly one row through it: their own (staff_self, 0001)');
select is((select display_name from staff_directory_v where id = :'staffa'), 'Staff Alpha',
  'their own, and no colleague''s');

reset role;
select * from finish();
rollback;
