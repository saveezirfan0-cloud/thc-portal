-- =====================================================================
-- 120 · The public application form (§2.1, §2.12, §1.7)
--
-- submit_application() is the only public write in the system: `anon` calls
-- it from an unauthenticated page on the open internet. Three things are
-- asserted here, and the third is the one that is easy to lose.
--
--   1. The rules the form shows are repeated on the server, because a form
--      can be edited and the server cannot (§2.1 says both, explicitly).
--   2. A duplicate never creates a second candidate (§2.12).
--   3. The endpoint tells the caller nothing. It returns void, so it cannot
--      be used to ask "is this email already known to you?" about any
--      address anyone cares to type.
-- =====================================================================
begin;
select plan(42);
\ir _shared/fixtures.psql

-- ---------------------------------------------------------------------
-- A valid application, submitted the way a real one is: logged out.
--
-- The name, email and mobile must be absent from BOTH the fixtures and
-- supabase/seed.sql, which carries the wireframes' sample people (§2.12
-- would otherwise, correctly, file this as a returning applicant). The seed
-- uses @example.com and +44 7700 9001xx; this file uses @rls.test and the
-- 7010 range.
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
set local role anon;
-- Untrimmed, mixed case and spaced out on purpose: this is what a phone
-- keyboard produces.
select submit_application('Nadia', 'Testwood', '  Nadia.Testwood@RLS.test ', '+44 7010 000456', (current_date - interval '24 years')::date, true);
reset role;

select is((select count(*)::int from staff where email = 'nadia.testwood@rls.test'), 1,
  '§2.1 a valid application creates one candidate');
select is((select status::text from staff where email = 'nadia.testwood@rls.test'), 'interview_requested',
  '§2.1 there is no "Applied" stage: the candidate lands straight in Interview requested');
select is((select phone from staff where last_name = 'Testwood'), '+447010000456',
  'the mobile is stored in E.164, as the form promises');
select is((select dob from staff where last_name = 'Testwood'), null::date,
  'the candidate has no date of birth yet: /apply collects an age band, and a date of birth arrives with Right to Work (§2.5)');
select is((select applied_age_band from staff where last_name = 'Testwood'), '24',  -- derived from the date
  'the age band is kept as the evidence behind the server-side 18+ gate');
select is((select employee_id from staff where last_name = 'Testwood'), null::int,
  '§2.7 the Employee ID is generated at contract signature, not here');
select is((select outcome::text from applications where last_name = 'Testwood'), 'candidate_created',
  'the submission is logged');
select isnt((select consented_at from applications where last_name = 'Testwood'), null::timestamptz,
  '§1.7 the consent tick is stored with its timestamp');
select is((select count(*)::int from audit_log where action = 'application_submitted'), 1,
  'the submission is audited (§1.7)');

-- ---------------------------------------------------------------------
-- The age gate (§2.1) — "checked both on the form and on the server"
-- ---------------------------------------------------------------------
set local role anon;
select throws_ok(
  $$ select submit_application('Kid','Young','kid@rls.test','+447700900801', (current_date - interval '18 years' + interval '1 day')::date, true) $$,
  '22023', 'You must be 18 or over to apply.',
  '§2.1 under 18 is rejected on the server, so a tampered form still fails');
select throws_ok(
  $$ select submit_application('Kid','Young','kid@rls.test','+447700900801', (current_date + interval '1 day')::date, true) $$,
  '22023', 'You must be 18 or over to apply.',
  'an age band the form never offered is refused rather than guessed at');
select throws_ok(
  $$ select submit_application('Kid','Young','kid@rls.test','+447700900801', null::date, true) $$,
  '22023', 'You must be 18 or over to apply.',
  'a missing age is not treated as an adult');

-- ---------------------------------------------------------------------
-- Consent (§1.7) and the field rules
-- ---------------------------------------------------------------------
select throws_ok(
  $$ select submit_application('No','Consent','nc@rls.test','+447700900802', date '1995-05-05', false) $$,
  '22023', 'Tick the consent box to continue.',
  '§1.7 no consent, no processing');
select throws_ok(
  $$ select submit_application('No','Consent','nc@rls.test','+447700900802', date '1995-05-05', null) $$,
  '22023', 'Tick the consent box to continue.',
  'an absent tick is not consent');
select throws_ok(
  $$ select submit_application('   ','','x@rls.test','+447700900803', date '1995-05-05', true) $$,
  '22023', 'Enter your first name and surname.', 'a blank name is refused');
select throws_ok(
  $$ select submit_application('A','B','not-an-email','+447700900803', date '1995-05-05', true) $$,
  '22023', 'Enter a valid email address.', 'a malformed email is refused');
select throws_ok(
  $$ select submit_application('A','B','x@rls.test','07700900803', date '1995-05-05', true) $$,
  '22023', 'Enter a valid mobile number, including the country code.',
  'a mobile without its country code is refused — the column is E.164');
reset role;
select is((select count(*)::int from staff where email in ('kid@rls.test','nc@rls.test','x@rls.test')), 0,
  'a rejected application creates nothing at all');

-- ---------------------------------------------------------------------
-- The duplicate check (§2.12) — one person keeps one record
-- ---------------------------------------------------------------------
set local role anon;
-- Different case from the stored address, to prove the match is not literal.
select submit_application('Staff','Alpha','STAFFA@rls.test','+447700900804', date '1995-01-01', true);
reset role;
select is((select count(*)::int from staff where lower(email) = 'staffa@rls.test'), 1,
  '§2.12 an email match creates no second candidate');
select is((select outcome::text from applications where phone = '+447700900804'), 'returning_applicant',
  '§2.12 it is filed as a returning applicant for the office instead');
select is((select staff_id from applications where phone = '+447700900804'), :'staffa'::uuid,
  '§2.12 the entry names the existing record, which is what Reset to candidate acts on (§9.6)');
select is((select status::text from staff where id = :'staffa'), 'compliant',
  'the existing record is not touched by the application: the manager decides');

set local role anon;
select submit_application('Someone','Else','brand.new@rls.test','+44 7700 900011', date '1995-01-01', true);
reset role;
select is((select outcome::text from applications where email = 'brand.new@rls.test'), 'returning_applicant',
  '§2.12 a mobile match routes to the office too, even with an unknown email');
select is((select count(*)::int from staff where email = 'brand.new@rls.test'), 0,
  'and still creates no candidate');

-- The seed stores mobiles with spaces ("+44 7700 900108"), so a normalised
-- submission only matches if the COLUMN is normalised too. Without that this
-- whole half of §2.12 passes its own tests against tidy fixture data and
-- matches nobody in the real table.
set local role anon;
select submit_application('Someone','Newagain','someone.newagain@rls.test','+447700900108', date '1998-12-09', true);
reset role;
select is((select outcome::text from applications where email = 'someone.newagain@rls.test'), 'returning_applicant',
  '§2.12 a mobile matches a worker whose stored number is formatted differently');
select is((select count(*)::int from staff where email = 'someone.newagain@rls.test'), 0,
  'and still creates no candidate');

-- ADR-0008: the mobile arm is mobile AND date of birth, not mobile alone.
-- The same number with a different date is a different person — a recycled
-- number, or a second person in one household — and must not be matched.
set local role anon;
select submit_application('Not','Thesame','not.thesame@rls.test','+447700900108', date '1975-04-04', true);
reset role;
select is((select outcome::text from applications where email = 'not.thesame@rls.test'), 'candidate_created',
  '§2.12 the same mobile with a different date of birth is a new candidate, not a match');

select is((select dob from applications where email = 'not.thesame@rls.test'), date '1975-04-04',
  'the date of birth is stored on the application row, which is what the match reads');

select is((select age_band from applications where email = 'not.thesame@rls.test'),
  (extract(year from age(current_date, date '1975-04-04'))::int)::text,
  'and the §2.1 band is derived from it rather than asked for (ADR-0008)');

-- A GDPR-removed worker (§1.7) is deliberately unmatchable: their record no
-- longer describes them, so they apply as a genuinely new person.
update staff set removed_at = now() where id = :'staffb';
set local role anon;
select submit_application('Staff','Bravo','staffb@rls.test','+447700900805', date '1994-02-02', true);
reset role;
select is((select outcome::text from applications where phone = '+447700900805'), 'candidate_created',
  '§1.7 a removed worker is never matched and applies as a new candidate');

-- ---------------------------------------------------------------------
-- What the endpoint gives away, and who may reach it
-- ---------------------------------------------------------------------
select is(
  (select pg_get_function_result('public.submit_application(text,text,text,text,date,boolean)'::regprocedure)),
  'void',
  '§2.12 the caller learns nothing: an outcome in the return value would make this public endpoint an account-existence oracle');
select ok(has_function_privilege('anon', 'public.submit_application(text,text,text,text,date,boolean)', 'execute'),
  'anon may call it — /apply is a public URL with no registration (§2.1)');
select ok(has_function_privilege('authenticated', 'public.submit_application(text,text,text,text,date,boolean)', 'execute'),
  'a signed-in visitor may call it too: being logged in elsewhere is no reason to block an application');
select ok(not has_function_privilege('public', 'public.submit_application(text,text,text,text,date,boolean)', 'execute'),
  'the grant is named, not inherited from PUBLIC');

set local role anon;
select throws_ok(
  $$ insert into staff (first_name, last_name, email, phone) values ('Mallory','Direct','m@rls.test','+447700900806') $$,
  '42501', null,
  'anon still cannot insert a staff row directly: the RPC is the only way in, which is where the age gate and the duplicate check live');
reset role;

-- The age constraint from 0001 is untouched by making dob nullable: it has
-- nothing to check until a date of birth exists, and then it bites.
select throws_ok(
  $$ insert into staff (first_name, last_name, email, phone, dob)
     values ('Too','Young','ty@rls.test','+447700900807', current_date - interval '17 years') $$,
  '23514', null,
  '§2.1 age_18 still rejects an under-18 date of birth once one is supplied');

-- ---------------------------------------------------------------------
-- What 20260921160000 added: the race and the sequential scan
-- ---------------------------------------------------------------------
select is(normalise_msisdn('+44 7700 900108'), '+447700900108',
  'normalise_msisdn strips the formatting the seed and the Appendix B5 import both store');
select is(normalise_msisdn('(0)7700-900.123'), '+07700900123',
  'it strips punctuation too, and re-prefixes exactly one +');
select is((select provolatile::text from pg_proc where proname = 'normalise_msisdn'), 'i',
  'it is IMMUTABLE, which is what lets an index be built on it');

-- Without these the duplicate check scans every staff row on every
-- application — and the form itself is what makes that table grow.
select is((select count(*)::int from pg_indexes where indexname = 'staff_email_normalised_idx'), 1,
  'the email half of the §2.12 match is indexed on the expression the predicate uses');
select is((select count(*)::int from pg_indexes where indexname = 'staff_msisdn_idx'), 1,
  'and so is the mobile half');

-- Two tabs, or one double tap, would otherwise both find no match and both
-- insert a candidate: exactly the second record §2.12 exists to prevent.
-- Every submission above ran in this transaction, so the locks are still held.
select ok(
  (select count(*)::int from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()) >= 1,
  'submit_application takes a transaction-scoped advisory lock, so concurrent submissions queue instead of racing');

select * from finish();
rollback;
