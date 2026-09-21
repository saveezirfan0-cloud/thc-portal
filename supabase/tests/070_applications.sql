-- =====================================================================
-- 070 · the public application form
--
-- Covers migration 0005: `applications` RLS for admin / client / staff /
-- anon, and everything `submit_application` promises —
--   §2.1  age >= 18 checked on the server as well as the form,
--   §1.7  GDPR consent is mandatory and its timestamp is stored,
--   §2.1  a valid submission creates the candidate directly in
--         `interview_requested` (there is no "Applied" stage),
--   §2.12 email, and mobile (+ DOB when there is one), route a returning
--         applicant to the office instead of creating a second record —
--         but only when the matched record has LEFT the pipeline, since
--         Reset to candidate is offered "on a blocked or rejected
--         profile" and somebody still mid-onboarding has not come back
--         from anywhere,
--   §1.7  a GDPR-removed worker cannot be matched and applies as new.
--
-- The one thing the applicant must NOT be able to learn is which of those
-- things happened (§2.12), which is why the function returns void.
-- =====================================================================
begin;
select plan(46);
\ir _shared/fixtures.psql

-- ---- fixture rows this test owns -----------------------------------
\set formatted  '7a7a7a7a-0000-4000-8000-000000000001'
\set removed    '7a7a7a7a-0000-4000-8000-000000000002'
\set blocked    '7a7a7a7a-0000-4000-8000-000000000003'
\set rejected   '7a7a7a7a-0000-4000-8000-000000000004'
\set inactive   '7a7a7a7a-0000-4000-8000-000000000005'

-- A worker whose mobile is stored formatted, the way supabase/seed.sql
-- and the Appendix B5 import hold it. The duplicate check has to see
-- through that.
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'formatted', 90071, 'Formatted', 'Number', 'formatted@rls.test', '+44 7700 900071', date '1990-03-03', 'compliant');

-- The three records §2.12's returning applicant is actually about: the
-- ones a manager can press Reset to candidate on, or reject.
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'blocked',  90073, 'Blocked',  'Worker', 'blocked@rls.test',  '+447700900073', date '1990-04-04', 'blocked'),
  (:'rejected', 90074, 'Rejected', 'Cand',   'rejected@rls.test', '+447700900074', date '1990-05-05', 'rejected'),
  (:'inactive', 90075, 'Inactive', 'Leaver', 'inactive@rls.test', '+447700900075', date '1990-06-06', 'inactive');

-- A GDPR-removed worker (§1.7): personal data gone, record retained.
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status, removed_at) values
  (:'removed', 90072, 'Deleted', 'Account', 'removed@rls.test', '+447700900072', null, 'removed', now());

-- ---------------------------------------------------------------------
-- anon — a logged-out applicant. This is the whole audience for /apply.
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
set local role anon;

select is((select count(*)::int from applications), 0, 'anon reads no applications');

select throws_ok(
  $$ insert into applications (first_name, last_name, email, phone, age_band, outcome)
     values ('Mallory','Forged','mallory@rls.test','+447700900098','25','candidate_created') $$,
  '42501', null, 'anon cannot write an application row directly — only submit_application may');

-- ---- the age gate, on the server (§2.1, §1.7) -----------------------
select throws_ok(
  $$ select submit_application('Kid','Young','kid@rls.test','+447700900091','under_18',true) $$,
  '23514', 'apply_under_18', 'the server refuses Under 18 even though the form already did');

select throws_ok(
  $$ select submit_application('Kid','Young','kid@rls.test','+447700900091','17',true) $$,
  '23514', 'apply_age_required', 'a band the select never offered is refused too');

select throws_ok(
  $$ select submit_application('Kid','Young','kid@rls.test','+447700900091','18',true, (current_date - interval '17 years')::date) $$,
  '23514', 'apply_under_18', 'a date of birth under 18 is refused whatever the band says');

-- ---- consent is mandatory (§1.7) ------------------------------------
select throws_ok(
  $$ select submit_application('No','Consent','noconsent@rls.test','+447700900092','25',false) $$,
  '23514', 'apply_consent_required', 'nothing is created without the GDPR tick');

select throws_ok(
  $$ select submit_application('No','Consent','noconsent@rls.test','+447700900092','25',null) $$,
  '23514', 'apply_consent_required', 'an absent consent is not a given consent');

-- ---- the rest of the field rules ------------------------------------
select throws_ok(
  $$ select submit_application('A','B','not-an-email','+447700900093','25',true) $$,
  '23514', 'apply_email_invalid', 'an address that cannot receive the interview link is refused');

select throws_ok(
  $$ select submit_application('A','B','a@b.co','07700900093','25',true) $$,
  '23514', 'apply_phone_invalid', 'the mobile has to arrive in E.164');

select throws_ok(
  $$ select submit_application('   ','B','a@b.co','+447700900093','25',true) $$,
  '23514', 'apply_name_required', 'both names are required');

-- ---- a valid application (§2.1) -------------------------------------
select lives_ok(
  $$ select submit_application('Nia','Okafor','Nia.Okafor@rls.test','+447700900090','22',true) $$,
  'a logged-out applicant can submit');

select is((select count(*)::int from applications), 0,
  'and still cannot read back what they submitted — not even their own row');

reset role;

-- ---------------------------------------------------------------------
-- What the submission actually did
-- ---------------------------------------------------------------------
select is(
  (select outcome::text from applications where lower(email) = 'nia.okafor@rls.test'),
  'candidate_created',
  'a first-time applicant creates a candidate');

select is(
  (select s.status::text from applications a join staff s on s.id = a.staff_id
    where lower(a.email) = 'nia.okafor@rls.test'),
  'interview_requested',
  'the candidate lands straight in Interview requested — there is no Applied stage (§2.1)');

select is(
  (select s.phone from applications a join staff s on s.id = a.staff_id
    where lower(a.email) = 'nia.okafor@rls.test'),
  '+447700900090',
  'the mobile is stored in E.164');

select is(
  (select age_band from applications where lower(email) = 'nia.okafor@rls.test'),
  '22',
  'the age band is kept — it is the only record of what the applicant said (docs/adr/0004)');

select ok(
  (select s.dob is null and s.willo_candidate_id is null
     from applications a join staff s on s.id = a.staff_id
    where lower(a.email) = 'nia.okafor@rls.test'),
  'the candidate has no date of birth yet (§2.5 collects it) and no Willo record yet (§2.4 creates it)');

select ok(
  (select s.gdpr_consent_at is not null from applications a join staff s on s.id = a.staff_id
    where lower(a.email) = 'nia.okafor@rls.test'),
  'the consent timestamp is stored with the record (§1.7)');

select is(
  (select count(*)::int from applications
    where email in ('kid@rls.test','noconsent@rls.test','not-an-email','a@b.co','mallory@rls.test')),
  0,
  'every refused submission created nothing at all');

-- ---------------------------------------------------------------------
-- The duplicate check (§2.12)
-- ---------------------------------------------------------------------
set local role anon;
select lives_ok(
  $$ select submit_application('Staff','Alpha','STAFFA@rls.test','+447700900081','30',true) $$,
  'a returning applicant matched on email submits without error');
select lives_ok(
  $$ select submit_application('Different','Person','different@rls.test','+447700900071','30',true) $$,
  'a returning applicant matched on a formatted mobile submits without error');
select lives_ok(
  $$ select submit_application('Blocked','Worker','blocked-again@rls.test','+447700900073','30',true) $$,
  'a blocked worker can apply again');
select lives_ok(
  $$ select submit_application('Rejected','Cand','rejected@rls.test','+447700900082','30',true) $$,
  'a rejected candidate can apply again');
select lives_ok(
  $$ select submit_application('Inactive','Leaver','inactive@rls.test','+447700900083','30',true) $$,
  'a leaver can apply again');
select lives_ok(
  $$ select submit_application('Nia','Okafor','nia.okafor@rls.test','+447700900090','22',true) $$,
  'and so can somebody who simply submitted the form twice');
select lives_ok(
  $$ select submit_application('Deleted','Account','removed@rls.test','+447700900072','30',true) $$,
  'a GDPR-removed worker can apply again');
reset role;

select is(
  (select a.outcome::text || ' ' || s.last_name from applications a join staff s on s.id = a.staff_id
    where lower(a.email) = 'staffa@rls.test'),
  'returning_applicant Alpha',
  'an email match routes to the office naming the existing record, case-insensitively');

select is(
  (select count(*)::int from staff where lower(email) = 'staffa@rls.test'),
  1,
  'and creates no second candidate (§2.12)');

select is(
  (select a.outcome::text || ' ' || s.last_name from applications a join staff s on s.id = a.staff_id
    where a.email = 'different@rls.test'),
  'returning_applicant Number',
  'a mobile match sees through the stored formatting');

select is(
  (select outcome::text from applications where email = 'blocked-again@rls.test'),
  'returning_applicant',
  'a blocked worker is the case §2.12 is about — Reset to candidate or reject');

select is(
  (select outcome::text from applications where email = 'rejected@rls.test'),
  'returning_applicant',
  'so is a rejected candidate (§2.3: the only way back is applying again)');

select is(
  (select outcome::text from applications where email = 'inactive@rls.test'),
  'returning_applicant',
  'so is a leaver (§10.6, §2.12)');

select is(
  (select count(*)::int from applications
    where outcome = 'returning_applicant' and lower(email) = 'nia.okafor@rls.test'),
  0,
  'a candidate still in the pipeline who submits again is NOT a returning applicant');

select is(
  (select outcome::text from applications
    where outcome = 'duplicate_submission' and lower(email) = 'nia.okafor@rls.test'),
  'duplicate_submission',
  'they are filed as a duplicate submission, so the office queue keeps meaning something');

select is(
  (select count(*)::int from staff where lower(email) = 'nia.okafor@rls.test'),
  1,
  'and, either way, no second candidate exists');

select ok(
  (select bool_and(gdpr_consent_at is not null) from applications
    where outcome <> 'candidate_created'),
  'a matched applicant has no new staff row, so the application row is where §1.7 keeps their consent timestamp');

select is(
  (select outcome::text from applications where email = 'removed@rls.test'),
  'candidate_created',
  'a GDPR-removed worker cannot be matched and applies as a genuinely new candidate (§1.7)');

select is(
  (select count(*)::int from audit_log where action = 'application_submitted'),
  8,
  'every submission that survived validation is on the audit trail');

-- ---------------------------------------------------------------------
-- The date of birth (0005, docs/adr/0004)
-- ---------------------------------------------------------------------
\set nia_id '(select staff_id from applications where lower(email) = ''nia.okafor@rls.test'' and outcome = ''candidate_created'')'

select lives_ok(
  format($$ update staff set status = 'documents' where id = %L $$, :nia_id),
  'a candidate reaches Documents without a date of birth — the wizard collects it there (§2.5)');

select lives_ok(
  format($$ update staff set status = 'rejected' where id = %L $$, :nia_id),
  'and can be rejected out of any stage without one');

select lives_ok(
  format($$ update staff set status = 'removed' where id = %L $$, :nia_id),
  'and a GDPR removal, which wipes personal data, does not need one either (§1.7)');

select throws_ok(
  format($$ update staff set status = 'quiz' where id = %L $$, :nia_id),
  '23514', null,
  'but a candidate cannot reach the quiz without a date of birth');

-- ---------------------------------------------------------------------
-- Everyone else. The office reads the queue; nobody else sees it at all.
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', :'staffa_uid'), true);
set local role authenticated;
select is((select count(*)::int from applications), 0, 'a worker reads no applications');
reset role;

select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', :'clienta_uid'), true);
set local role authenticated;
select is((select count(*)::int from applications), 0, 'a client reads no applications (§11.1)');
reset role;

select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', :'admin_uid'), true);
set local role authenticated;
select is((select count(*)::int from applications), 8,
  'the office reads every application, which is what the returning-applicant entry is built on');
select is((select count(*)::int from applications where outcome = 'returning_applicant'), 5,
  'five of them are the returning applicants a manager actually has to decide about');
reset role;

select * from finish();
rollback;
