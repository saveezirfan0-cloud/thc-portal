-- =====================================================================
-- 120 · The public application form (§2.1, §2.12, §1.7)
--
-- submit_application() is the only public write in the system: the Staff
-- App's /apply server action calls it for an unauthenticated visitor, with
-- the service key (anon lost the grant in 20260930120200, ADR-0024).
-- Three things are asserted here, and the third is the one that is easy
-- to lose.
--
--   1. The rules the form shows are repeated on the server, because a form
--      can be edited and the server cannot (§2.1 says both, explicitly).
--   2. A duplicate never creates a second candidate (§2.12).
--   3. The endpoint tells the caller nothing. It returns void, so it cannot
--      be used to ask "is this email already known to you?" about any
--      address anyone cares to type.
-- =====================================================================
begin;
select plan(73);
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
set local role service_role;
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
select is((select dob from staff where last_name = 'Testwood'), (current_date - interval '24 years')::date,
  'the candidate carries the date of birth from creation (ADR-0008), which is what §2.6 needs for the share-code check');
select is((select applied_age_band from staff where last_name = 'Testwood'), '24',
  'and the age band beside it is derived from that date, not asked for separately');
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
set local role service_role;
select throws_ok(
  $$ select submit_application('Kid','Young','kid@rls.test','+447700900801', (current_date - interval '18 years' + interval '1 day')::date, true) $$,
  '22023', 'You must be 18 or over to apply.',
  '§2.1 under 18 is rejected on the server, so a tampered form still fails');
select throws_ok(
  $$ select submit_application('Kid','Young','kid@rls.test','+447700900801', (current_date + interval '1 day')::date, true) $$,
  '22023', 'Enter a real date of birth.',
  'a date in the future is refused as impossible, not as under-age');
select throws_ok(
  $$ select submit_application('Kid','Young','kid@rls.test','+447700900801', null::date, true) $$,
  '22023', 'Enter your date of birth.',
  'a missing date is asked for rather than treated as an adult');

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
set local role service_role;
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

set local role service_role;
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
set local role service_role;
select submit_application('Someone','Newagain','someone.newagain@rls.test','+447700900108', date '1998-12-09', true);
reset role;
select is((select outcome::text from applications where email = 'someone.newagain@rls.test'), 'returning_applicant',
  '§2.12 a mobile matches a worker whose stored number is formatted differently');
select is((select count(*)::int from staff where email = 'someone.newagain@rls.test'), 0,
  'and still creates no candidate');

-- ADR-0008: the mobile arm is mobile AND date of birth, not mobile alone.
-- The same number with a different date is a different person — a recycled
-- number, or a second person in one household — and must not be matched.
set local role service_role;
select submit_application('Not','Thesame','not.thesame@rls.test','+447700900108', (current_date - interval '55 years')::date, true);
reset role;
select is((select outcome::text from applications where email = 'not.thesame@rls.test'), 'candidate_created',
  '§2.12 the same mobile with a different date of birth is a new candidate, not a match');

select is((select dob from applications where email = 'not.thesame@rls.test'), (current_date - interval '55 years')::date,
  'the date of birth is stored on the application row, which is what the match reads');

select is((select age_band from applications where email = 'not.thesame@rls.test'), '51_60',
  'and the §2.1 band is derived from it rather than asked for: 55 lands in the 51 – 60 band, not a bare year count (ADR-0008)');
-- A GDPR-removed worker (§1.7) is deliberately unmatchable: their record no
-- longer describes them, so they apply as a genuinely new person.
update staff set removed_at = now() where id = :'staffb';
set local role service_role;
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
-- 20260930120200: the Staff App's server action is the only caller, with
-- the service key and through submit_application_as_caller(), which adds
-- the per-caller limit (ADR-0024). The anon grant was the way round it.
select ok(not has_function_privilege('anon', 'public.submit_application(text,text,text,text,date,boolean)', 'execute'),
  'anon cannot call it straight through PostgREST: /apply reaches it only through the server action and its per-caller limit (ADR-0024)');
select ok(not has_function_privilege('authenticated', 'public.submit_application(text,text,text,text,date,boolean)', 'execute'),
  'nor can a signed-in session: the per-caller limit is not optional for anyone');
select ok(has_function_privilege('service_role', 'public.submit_application(text,text,text,text,date,boolean)', 'execute')
          and not has_function_privilege('public', 'public.submit_application(text,text,text,text,date,boolean)', 'execute'),
  'the service role holds it, by a named grant, not inherited from PUBLIC');

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
--
-- The keys are asserted, not just the count. The first version of this
-- assertion read `count(*) >= 1`, which passed for a lock on anything at
-- all — and it did pass, while the lock was a single key hashed from email
-- AND mobile against a predicate that matches on email OR mobile. Two
-- submissions agreeing on only one arm took different keys and raced anyway
-- (20260922100000). A count cannot see that; the keys can. Named keys
-- rather than a total, because `applications` also holds a row inserted
-- directly by _shared/fixtures.psql, which never went through the RPC and
-- so never took a lock at all.
select is(
  (select count(*)::int from pg_locks
    where locktype = 'advisory' and pid = pg_backend_pid()
      and classid = hashtext('apply:email')
      and objid = hashtext('nadia.testwood@rls.test')),
  1,
  '§2.12 the email arm of the match is locked under its own key');
select is(
  (select count(*)::int from pg_locks
    where locktype = 'advisory' and pid = pg_backend_pid()
      and classid = hashtext('apply:msisdn')
      and objid = hashtext('+447010000456')),
  1,
  'and the mobile arm under a separate one — a single key hashed from both left the arms racing');

-- ---------------------------------------------------------------------
-- §1.8 · the age gate is evaluated in Europe/London
--
-- This one is asserted against the source, because the behaviour it guards
-- is only observable for the hour between 00:00 and 01:00 UK time during
-- BST — a test that reproduces it would pass twenty-three hours a day and
-- fail at 00:30, which is worse than no test. What went wrong was textual:
-- `current_date` resolves against the session TimeZone, UTC on Supabase,
-- while the comment beside it claimed UK time. So the text is what is
-- pinned. Every other date rule in this repo uses the same expression.
-- ---------------------------------------------------------------------
select matches(
  (select prosrc from pg_proc where proname = 'submit_application'),
  'Europe/London',
  '§1.8 submit_application derives today in Europe/London');
select doesnt_match(
  (select prosrc from pg_proc where proname = 'submit_application'),
  '[^_]current_date',
  'and never from current_date, which is UTC on Supabase and refuses an applicant on their eighteenth birthday');

-- The same rule, one layer down. The function was fixed and the CHECK
-- constraint it writes through was not, so submit_application() computed
-- the right answer and `staff` then refused the row — which is how the
-- dateline pair below went red on 23.09 having passed every afternoon
-- build before it. Pinned textually for the reason above: a behavioural
-- test would pass all day and fail in the hour before midnight UTC.
select matches(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'age_18'),
  'Europe/London',
  '§1.8 the age_18 constraint measures eighteen against London''s date');
select doesnt_match(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'age_18'),
  '[^_]current_date',
  'and never the caller''s session date, which refuses an applicant on their eighteenth birthday');

-- Behaviour, as far as it can be pinned deterministically: the answer must
-- not depend on the caller's session timezone. Someone born exactly
-- eighteen years ago by the London calendar is eighteen, whoever asks.
set local timezone = 'Pacific/Kiritimati';
set local role service_role;
select lives_ok(
  $$ select submit_application('Dateline','East','dateline.east@rls.test','+447700900851',
       ((now() at time zone 'Europe/London')::date - interval '18 years')::date, true) $$,
  'a caller fourteen hours ahead of London gets the London answer');
reset role;
set local timezone = 'Pacific/Niue';
set local role service_role;
select lives_ok(
  $$ select submit_application('Dateline','West','dateline.west@rls.test','+447700900852',
       ((now() at time zone 'Europe/London')::date - interval '18 years')::date, true) $$,
  'and so does one eleven hours behind it');
reset role;
reset timezone;

-- ---------------------------------------------------------------------
-- The pre-ADR-0008 signature is gone, not shadowed
--
-- 20260921170000 dropped submit_application(text,text,text,text,text,boolean)
-- rather than replacing it, because `create or replace` on a new parameter
-- list leaves the old one behind as an overload that `anon` can still call
-- — with an age BAND, which is the applicant's own word for how old they
-- are and is exactly what ADR-0008 stopped trusting. Nothing asserted the
-- drop until now.
-- ---------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc where proname = 'submit_application'),
  1,
  'exactly one submit_application exists, so the age-band signature cannot be called');
select is(
  (select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'submit_application'),
  'p_first_name text, p_last_name text, p_email text, p_phone text, p_dob date, p_consent boolean',
  'and it is the date-of-birth one (ADR-0008)');

-- ---------------------------------------------------------------------
-- §2.12 matches a worker whatever state they left in
--
-- The point of the returning-applicant entry is the worker the office needs
-- to look at again: "Reset to candidate is available on a blocked or
-- rejected profile" (§2.12). Both duplicate fixtures above are `compliant`,
-- so a regression narrowing the predicate to compliant workers would pass
-- every other assertion in this file.
-- ---------------------------------------------------------------------
insert into staff (first_name, last_name, email, phone, dob, status)
values ('Was','Blocked','was.blocked@rls.test','+447700900861', date '1990-03-03', 'blocked'),
       ('Was','Rejected','was.rejected@rls.test','+447700900862', date '1990-04-04', 'rejected');

set local role service_role;
select submit_application('Was','Blocked','was.blocked@rls.test','+447700900871', date '1990-03-03', true);
select submit_application('Was','Rejected','was.rejected@rls.test','+447700900872', date '1990-04-04', true);
reset role;
select is((select outcome::text from applications where email = 'was.blocked@rls.test'), 'returning_applicant',
  '§2.12 a blocked worker who re-applies is a returning applicant, not a new candidate');
select is((select outcome::text from applications where email = 'was.rejected@rls.test'), 'returning_applicant',
  'and so is a rejected one — both are what "reset to candidate" acts on');

-- ---------------------------------------------------------------------
-- The band boundaries, in SQL
--
-- The CASE in submit_application is a hand-copy of `ageBandFor` in
-- apps/staff/app/apply/form.ts. Only the TypeScript side had boundary
-- vectors, so the two could drift at exactly the ages where a band changes.
-- ---------------------------------------------------------------------
set local role service_role;
select submit_application('Band','Thirty','band30@rls.test','+447700900881', ((now() at time zone 'Europe/London')::date - interval '30 years')::date, true);
select submit_application('Band','Thirtyone','band31@rls.test','+447700900882', ((now() at time zone 'Europe/London')::date - interval '31 years')::date, true);
select submit_application('Band','Forty','band40@rls.test','+447700900883', ((now() at time zone 'Europe/London')::date - interval '40 years')::date, true);
select submit_application('Band','Fortyone','band41@rls.test','+447700900884', ((now() at time zone 'Europe/London')::date - interval '41 years')::date, true);
select submit_application('Band','Fifty','band50@rls.test','+447700900885', ((now() at time zone 'Europe/London')::date - interval '50 years')::date, true);
select submit_application('Band','Fiftyone','band51@rls.test','+447700900886', ((now() at time zone 'Europe/London')::date - interval '51 years')::date, true);
select submit_application('Band','Sixty','band60@rls.test','+447700900887', ((now() at time zone 'Europe/London')::date - interval '60 years')::date, true);
select submit_application('Band','Sixtyone','band61@rls.test','+447700900888', ((now() at time zone 'Europe/London')::date - interval '61 years')::date, true);
reset role;
select is(
  (select array_agg(age_band order by email) from applications where email like 'band%@rls.test'),
  -- Ordered by email: band30, band31, band40, band41, band50, band51,
  -- band60, band61. Thirty is still its own number because the first arm of
  -- the CASE runs to 30; from 31 the bands are ten-year ranges whose upper
  -- bound is inclusive, so 40 is the top of 31_40, not the bottom of 41_50.
  array['30','31_40','31_40','41_50','41_50','51_60','51_60','60_plus']::text[],
  '§2.1 the bands change at 31, 41, 51 and 61, and each range includes its upper year');

-- ---------------------------------------------------------------------
-- The "too old to be an applicant" boundary matches the form's
--
-- The form rejects more than 100 completed years (MAX_AGE in form.ts). The
-- database used to reject anything before `today - interval '100 years'`,
-- which is a day earlier, so dates in that one-year gap passed the form and
-- came back as a server banner on a field the form had called fine.
-- ---------------------------------------------------------------------
set local role service_role;
select lives_ok(
  $$ select submit_application('Exactly','Hundred','exactly100@rls.test','+447700900891',
       ((now() at time zone 'Europe/London')::date - interval '100 years')::date, true) $$,
  'exactly 100 completed years is accepted, as it is on the form');
select throws_ok(
  $$ select submit_application('Over','Hundred','over100@rls.test','+447700900892',
       ((now() at time zone 'Europe/London')::date - interval '101 years')::date, true) $$,
  '22023', 'Enter a real date of birth.',
  'and 101 is refused as a typo by both');
reset role;

-- ---------------------------------------------------------------------
-- What 20260922183012 added: the date of birth on the email arm, and a
-- throttle
--
-- The finding: `submit_application` is granted to anon, so PostgREST
-- publishes it and the form is not the only door. The §2.12 email arm
-- needed nothing but an email address, so submitting with a known
-- worker's address filed a `returning_applicant` entry carrying THEIR
-- staff_id — and the office's action on that entry is
-- reset_to_candidate(), which supersedes the worker's whole compliance
-- evidence set (§9.6). An anonymous caller plus a colleague's email
-- address was a path to wiping verified right-to-work evidence.
-- ---------------------------------------------------------------------

-- Staff Alpha's real address, Staff Alpha's real mobile, somebody else's
-- date of birth. Before the fix this matched on the email arm. ADR-0027
-- records the deviation from §2.12's "email" arm and asks THC to confirm.
set local role service_role;
select submit_application('Mallory','Impostor','STAFFA@rls.test','+447700900011', date '1979-06-06', true);
reset role;
select is((select outcome::text from applications where email = 'staffa@rls.test' and dob = date '1979-06-06'), 'candidate_created',
  '§2.12 a known worker''s email with the WRONG date of birth is a new candidate, not a returning-applicant entry against their record');
select is((select count(*)::int from applications where staff_id = :'staffa' and dob = date '1979-06-06'), 0,
  'and nothing is filed against the real worker, so Reset to candidate is never offered over their evidence (§9.6)');
select is((select status::text from staff where id = :'staffa'), 'compliant',
  'the worker''s record is untouched');

-- The right date of birth still matches, so §2.12 still does its job.
select is((select matched_on from applications where phone = '+447700900804'), 'email_dob',
  'the genuine email match above is recorded as email_dob: the office can see which arm a returning-applicant claim rests on');
select is((select matched_on from applications where email = 'brand.new@rls.test'), 'msisdn_dob',
  'and a mobile match is recorded as msisdn_dob');
select is((select matched_on from applications where email = 'not.thesame@rls.test'), null,
  'a new candidate matched on nothing, so the column is null');

-- ---- the throttle -----------------------------------------------------
-- Three per address and three per mobile per rolling day, from
-- settings.apply_throttle (§9.12), checked inside the two advisory locks
-- so a race cannot slip a fourth through.
select is((select value from settings where key = 'apply_throttle'),
  '{"per_email": 3, "per_msisdn": 3, "window_hours": 24}'::jsonb,
  'the limits are settings, not constants: an office running a recruitment day raises them without a release');

set local role service_role;
select lives_ok(
  $$ select submit_application('Rate','Limit','rate.limit@rls.test','+447700900901', date '1990-03-03', true) $$,
  'first submission from an address is accepted');
select lives_ok(
  $$ select submit_application('Rate','Limit','rate.limit@rls.test','+447700900902', date '1990-03-03', true) $$,
  'second is too — a mis-typed address and a retry are ordinary');
select lives_ok(
  $$ select submit_application('Rate','Limit','rate.limit@rls.test','+447700900903', date '1990-03-03', true) $$,
  'and the third');
select throws_ok(
  $$ select submit_application('Rate','Limit','rate.limit@rls.test','+447700900904', date '1990-03-03', true) $$,
  '22023', 'Too many applications from these details. Please try again later.',
  'the fourth from that address is refused — every accepted call writes a staff row, an applications row and an audit row, and before this there was no bound at all');
reset role;

-- The same ceiling on the mobile, reached from three different addresses,
-- and the same message. Naming which of the two arms tripped would turn
-- the endpoint back into the oracle §2.12 and 20260921150000's header both
-- refuse, so the copy mentions neither.
set local role service_role;
select lives_ok(
  $$ select submit_application('One','Household','h1@rls.test','+447700900911', date '1991-04-04', true) $$,
  'a mobile may be used once');
select lives_ok(
  $$ select submit_application('Two','Household','h2@rls.test','+447700900911', date '1992-05-05', true) $$,
  'twice');
select lives_ok(
  $$ select submit_application('Three','Household','h3@rls.test','+447700900911', date '1993-06-06', true) $$,
  'and three times — a family sharing one number is a real case, so the limit is not one');
select throws_ok(
  $$ select submit_application('Four','Household','h4@rls.test','+447700900911', date '1994-07-07', true) $$,
  '22023', 'Too many applications from these details. Please try again later.',
  'the fourth is refused on the mobile arm, with the identical message the email arm gives');
reset role;

-- The three accepted submissions share an address AND a date of birth, so
-- §2.12 matches the second and third back to the first: three application
-- rows, one staff row. Both halves are the point. The throttle bounds the
-- rows a caller can write at all, and the duplicate check bounds how many
-- of them become people.
select is((select count(*)::int from applications where email = 'rate.limit@rls.test'), 3,
  'three submissions from one address were accepted and no more: the write the throttle bounds is the applications row');
select is((select count(*)::int from staff where email = 'rate.limit@rls.test'), 1,
  'and §2.12 still keeps them to one candidate record');

select * from finish();
rollback;
