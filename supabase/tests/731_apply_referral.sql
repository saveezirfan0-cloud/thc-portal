-- =====================================================================
-- 731 · /apply?ref= records who referred whom — and changes nothing else
--   20260930204000_apply_referral.sql,
--   20260930205300_referral_new_candidates_only.sql, ADR-0047, docs/19 §5
--
--   A. The grants: the restated submit_application_as_caller is still
--      service-role only, and there is exactly one of it (the 7-argument
--      one is gone, not left beside it). record_application_referral is
--      owner-only. submit_application is unchanged (service-role only since 20260930120200).
--   B. A valid code records one row for a new candidate
--      (candidate_created) — and NOTHING for a matched record
--      (returning_applicant, security finding #5): knowing a worker's
--      email + DOB must not pin a referrer on them or inflate anyone's
--      count. That application still goes through, answering exactly as
--      without a code.
--   C. A malformed, unknown, revoked or own code records nothing, and the
--      application still goes through, exactly as without a code.
--   D. Every earlier gate of the restated function, TOGETHER, with a code
--      attached (docs/10 §3b): the per-caller hash rule and throttle, the
--      per-email and per-mobile throttle, every validation message. A
--      refused application records no referral and counts no hit.
--   E. The six-argument path records nothing; the response is identical with or
--      without a code.
-- =====================================================================
begin;
select plan(63);
\ir _shared/fixtures.psql

-- staffa refers; staffb's code is revoked (as GDPR removal leaves it).
\set code_a   'K7M4Q2XP'
\set code_b   'R3VW8NTB'
\set code_new 'H9JZ5CDE'

insert into staff_referral_codes (staff_id, code) values (:'staffa', :'code_a');
insert into staff_referral_codes (staff_id, code, revoked_at) values (:'staffb', :'code_b', now() - interval '1 day');

-- The limits the gates below count against, pinned so the test does not
-- depend on what seed.sql or an office left in settings.
update settings set value = '{"window_hours": 24, "per_email": 3, "per_msisdn": 3}'::jsonb
 where key = 'apply_throttle';
update settings set value = '{"per_hour": 5, "per_day": 20, "retention_hours": 48}'::jsonb
 where key = 'apply_caller_throttle';

-- =====================================================================
-- A · grants and shape
-- =====================================================================
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_application_as_caller'),
  1, 'A: exactly one submit_application_as_caller — the 7-argument overload was dropped, not left published');
select is(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_application_as_caller'),
  'p_first_name text, p_last_name text, p_email text, p_phone text, p_dob date, p_consent boolean, p_caller_hash text, p_referral_code text',
  'A: the referral code is the 8th argument');
select is(
  (select pg_get_function_result('public.submit_application_as_caller(text,text,text,text,date,boolean,text,text)'::regprocedure)),
  'void', 'A: still returns void — nothing for a caller to learn from');
select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=public, extensions']
     from pg_proc p where p.oid = 'public.submit_application_as_caller(text,text,text,text,date,boolean,text,text)'::regprocedure),
  'A: security definer with the pinned search_path, as restated');
select ok(
  not has_function_privilege('anon', 'public.submit_application_as_caller(text,text,text,text,date,boolean,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.submit_application_as_caller(text,text,text,text,date,boolean,text,text)', 'execute'),
  'A: neither anon nor a signed-in account can call it (ADR-0024)');
select ok(
  has_function_privilege('service_role', 'public.submit_application_as_caller(text,text,text,text,date,boolean,text,text)', 'execute'),
  'A: the Staff App server action (service key) can');
select ok(
  not has_function_privilege('anon', 'public.record_application_referral(text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_application_referral(text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.record_application_referral(text,text)', 'execute'),
  'A: record_application_referral is owner-only — no API role, not even the service key, can write a referral directly');
select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=public, extensions']
     from pg_proc p where p.oid = 'public.record_application_referral(text,text)'::regprocedure),
  'A: record_application_referral is a definer with the pinned search_path');
select is(
  (select pg_get_function_identity_arguments('public.submit_application(text,text,text,text,date,boolean)'::regprocedure)),
  'p_first_name text, p_last_name text, p_email text, p_phone text, p_dob date, p_consent boolean',
  'A: submit_application is unchanged — six arguments, no code');
select ok(
  not has_function_privilege('anon', 'public.submit_application(text,text,text,text,date,boolean)', 'execute'),
  'A: and, since main''s 20260930120200, anon does not hold it: /apply reaches it only through submit_application_as_caller');

set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select throws_ok(
  $$ select record_application_referral('x@t681.test', 'K7M4Q2XP') $$,
  '42501', null, 'A: the service role calling the helper directly is refused');
reset role;
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok(
  $$ select submit_application_as_caller('A','B','anon8@t681.test','+447700968001', date '1995-01-01', true, null, 'K7M4Q2XP') $$,
  '42501', null, 'A: anon calling the 8-argument function is refused');
reset role;

-- =====================================================================
-- B · a valid code is recorded for a new candidate — and only for one
-- =====================================================================
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select lives_ok(
  $$ select submit_application_as_caller('Nia', 'Referred', 'nia@t681.test', '+447700968101', date '1999-03-03', true,
       '1111111111111111111111111111111111111111111111111111111111111111', 'K7M4Q2XP') $$,
  'B: a new applicant with a friend''s code is accepted');
-- staffb (fixtures) applies again with staffa's code: the §2.12 match.
select lives_ok(
  $$ select submit_application_as_caller('Staff', 'Bravo', 'staffb@rls.test', '+447700968102', date '1994-02-02', true,
       null, ' k7m4q2xp ') $$,
  'B: a returning applicant with a friend''s code (lower case, padded) is accepted');
reset role;

select is(
  (select row(a.outcome::text, r.referrer_staff_id, r.code, r.candidate_staff_id = a.staff_id)::text
     from applications a join application_referrals r on r.application_id = a.id
    where a.email = 'nia@t681.test'),
  row('candidate_created', :'staffa'::uuid, 'K7M4Q2XP', true)::text,
  'B: candidate_created — one row: referrer staffa, the code, the new candidate');
select is(
  (select row(a.outcome::text, a.staff_id)::text
     from applications a
    where a.email = 'staffb@rls.test' and a.phone = '+447700968102'),
  row('returning_applicant', :'staffb'::uuid)::text,
  'B: returning_applicant — the application is still written, filed against the matched record');
select is(
  (select count(*)::int from application_referrals r join applications a on a.id = r.application_id
    where a.email = 'staffb@rls.test'),
  0, 'B: returning_applicant — and records NO referral: an existing worker was not referred (finding #5)');
select is(
  (select count(*)::int from application_referrals where candidate_staff_id = :'staffb'),
  0, 'B: nothing pins "Referred by" on the existing worker');
select is(
  (select count(*)::int from application_referrals where referrer_staff_id = :'staffa'),
  1, 'B: and the referrer''s count is the one new candidate, not inflated by the match');
select is(
  (select count(*)::int from private.apply_caller_hits
    where caller_hash = '1111111111111111111111111111111111111111111111111111111111111111'),
  1, 'B: the per-caller hit is still counted for an application with a code');

-- =====================================================================
-- C · a bad, unknown, revoked or own code records nothing — and the
--     application still goes through
-- =====================================================================
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select lives_ok(
  $$ select submit_application_as_caller('Mal', 'Formed', 'mal@t681.test', '+447700968201', date '1995-01-01', true, null,
       'IO01-not-a-code') $$,
  'C: a malformed code — the application is accepted');
select lives_ok(
  $$ select submit_application_as_caller('Un', 'Known', 'unk@t681.test', '+447700968202', date '1995-01-01', true, null,
       'H9JZ5CDE') $$,
  'C: a well-formed code nobody holds — accepted');
select lives_ok(
  $$ select submit_application_as_caller('Re', 'Voked', 'rev@t681.test', '+447700968203', date '1995-01-01', true, null,
       'R3VW8NTB') $$,
  'C: a revoked code — accepted');
-- staffa applies again with their own code: matched to their own record.
select lives_ok(
  $$ select submit_application_as_caller('Staff', 'Alpha', 'staffa@rls.test', '+447700968204', date '1995-01-01', true, null,
       'K7M4Q2XP') $$,
  'C: the referrer''s own code on their own returning application — accepted');
select lives_ok(
  $$ select submit_application_as_caller('Emp', 'Ty', 'empty@t681.test', '+447700968205', date '1995-01-01', true, null, '') $$,
  'C: an empty code — accepted');
reset role;

select is(
  (select count(*)::int from applications
    where phone in ('+447700968201', '+447700968202', '+447700968203', '+447700968204', '+447700968205')),
  5, 'C: all five applications were written');
select is(
  (select array_agg(outcome::text order by email) from applications
    where phone in ('+447700968201', '+447700968202', '+447700968203', '+447700968204', '+447700968205')),
  array['candidate_created', 'candidate_created', 'candidate_created', 'returning_applicant', 'candidate_created'],
  'C: with the outcomes they would have had without a code');
select is(
  (select count(*)::int from application_referrals r join applications a on a.id = r.application_id
    where a.phone in ('+447700968201', '+447700968202', '+447700968203', '+447700968204', '+447700968205')),
  0, 'C: and not one of them recorded a referral');

-- The helper itself, as the owner: nothing it is handed makes it raise.
select lives_ok($$ select record_application_referral(null, null) $$, 'C: null in, nothing out');
select lives_ok($$ select record_application_referral('nobody@t681.test', 'K7M4Q2XP') $$,
  'C: a code with no application behind it — nothing, no error');
select lives_ok($$ select record_application_referral('nia@t681.test', 'K7M4Q2XP') $$,
  'C: an application already referred — on conflict, nothing, no error');
-- The helper handed a returning application written in this transaction,
-- directly, as the owner: still nothing (the lookup is candidate_created
-- only, not a check in the caller).
select lives_ok($$ select record_application_referral('staffb@rls.test', 'K7M4Q2XP') $$,
  'C: a returning-applicant application handed to the helper directly — nothing, no error');
select is(
  (select count(*)::int from application_referrals where candidate_staff_id = :'staffb'),
  0, 'C: and still no row against the existing worker');
select is(
  (select count(*)::int from application_referrals r join applications a on a.id = r.application_id
    where a.email = 'nia@t681.test'),
  1, 'C: still exactly one row for it');

-- =====================================================================
-- D · every earlier gate, with a valid code attached, together
-- =====================================================================
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';

-- D1 · validation (submit_application's, unchanged)
select throws_ok(
  $$ select submit_application_as_caller('   ', '', 'd1@t681.test', '+447700968301', date '1995-01-01', true, null, 'K7M4Q2XP') $$,
  '22023', 'Enter your first name and surname.', 'D1: a blank name is still refused');
select throws_ok(
  $$ select submit_application_as_caller('A', 'B', 'not-an-email', '+447700968302', date '1995-01-01', true, null, 'K7M4Q2XP') $$,
  '22023', 'Enter a valid email address.', 'D1: a malformed email is still refused');
select throws_ok(
  $$ select submit_application_as_caller('A', 'B', 'd3@t681.test', '07700968303', date '1995-01-01', true, null, 'K7M4Q2XP') $$,
  '22023', 'Enter a valid mobile number, including the country code.', 'D1: a mobile without its country code is still refused');
select throws_ok(
  $$ select submit_application_as_caller('A', 'B', 'd4@t681.test', '+447700968304', date '1995-01-01', false, null, 'K7M4Q2XP') $$,
  '22023', 'Tick the consent box to continue.', 'D1: no consent is still refused');
select throws_ok(
  $$ select submit_application_as_caller('A', 'B', 'd5@t681.test', '+447700968305', null::date, true, null, 'K7M4Q2XP') $$,
  '22023', 'Enter your date of birth.', 'D1: a missing date of birth is still refused');
select throws_ok(
  $$ select submit_application_as_caller('A', 'B', 'd6@t681.test', '+447700968306',
       (current_date - interval '18 years' + interval '1 day')::date, true, null, 'K7M4Q2XP') $$,
  '22023', 'You must be 18 or over to apply.', 'D1: under 18 is still refused, code or no code');
select throws_ok(
  $$ select submit_application_as_caller('A', 'B', 'd7@t681.test', '+447700968307', date '1900-01-01', true, null, 'K7M4Q2XP') $$,
  '22023', 'Enter a real date of birth.', 'D1: over 100 is still refused');

-- D2 · the caller hash: a digest or nothing
select throws_ok(
  $$ select submit_application_as_caller('Raw', 'Ip', 'raw@t681.test', '+447700968310', date '1995-01-01', true,
       '203.0.113.7', 'K7M4Q2XP') $$,
  'P0001', 'bad_caller_hash', 'D2: a raw address is still refused, code or no code');

-- D3 · the per-caller throttle: 5 an hour from one hash
select lives_ok(format(
  $$ select submit_application_as_caller('Cal', 'Ler', 'cal%s@t681.test', '+44770096832%s', date '1995-01-01', true,
       '2222222222222222222222222222222222222222222222222222222222222222', 'K7M4Q2XP') $$, n, n))
  from generate_series(1, 5) n;
select throws_ok(
  $$ select submit_application_as_caller('Cal', 'Six', 'cal6@t681.test', '+447700968326', date '1995-01-01', true,
       '2222222222222222222222222222222222222222222222222222222222222222', 'K7M4Q2XP') $$,
  '22023', 'We’ve received several applications from your connection recently. Please try again later — or email admin@thehospitalitycompany.co.uk and we’ll help.',
  'D3: the sixth in an hour from one caller is still refused — a code does not buy another');

-- D4 · the per-email throttle: 3 a day for one address (one already
-- used in B by nia@; two more, then refused)
select lives_ok(
  $$ select submit_application_as_caller('Nia', 'Referred', 'nia@t681.test', '+447700968341', date '1999-03-03', true, null, 'K7M4Q2XP') $$,
  'D4: a second application from the same address');
select lives_ok(
  $$ select submit_application_as_caller('Nia', 'Referred', 'nia@t681.test', '+447700968342', date '1999-03-03', true, null, 'K7M4Q2XP') $$,
  'D4: a third');
select throws_ok(
  $$ select submit_application_as_caller('Nia', 'Referred', 'nia@t681.test', '+447700968343', date '1999-03-03', true, null, 'K7M4Q2XP') $$,
  '22023', 'Too many applications from these details. Please try again later.',
  'D4: the fourth from one address is still refused');

-- D5 · the per-mobile throttle: 3 a day for one number
select lives_ok(format(
  $$ select submit_application_as_caller('Mo', 'Bile', 'mob%s@t681.test', '+447700968350', date '1996-06-06', true, null, 'K7M4Q2XP') $$, n))
  from generate_series(1, 3) n;
select throws_ok(
  $$ select submit_application_as_caller('Mo', 'Bile', 'mob4@t681.test', '+447700968350', date '1996-06-06', true, null, 'K7M4Q2XP') $$,
  '22023', 'Too many applications from these details. Please try again later.',
  'D5: the fourth from one mobile is still refused');
reset role;

select is(
  (select count(*)::int from applications
    where email in ('d1@t681.test', 'd3@t681.test', 'd4@t681.test', 'd5@t681.test', 'd6@t681.test', 'd7@t681.test',
                    'raw@t681.test', 'cal6@t681.test', 'mob4@t681.test')),
  0, 'D: no refused application wrote anything — and so no referral either');
select is(
  (select count(*)::int from private.apply_caller_hits
    where caller_hash = '2222222222222222222222222222222222222222222222222222222222222222'),
  5, 'D: the refused sixth was not counted as a hit');

-- =====================================================================
-- E · the six-argument path records nothing; the response does not change
--
-- submit_application() is service-role only since main's 20260930120200
-- (it was the anon path when this file was written). It still takes no
-- code and records nothing.
-- =====================================================================
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select lives_ok(
  $$ select submit_application('Anon', 'Path', 'anon@t681.test', '+447700968401', date '1995-01-01', true) $$,
  'E: the six-argument submit_application still works');
reset role;
select is(
  (select count(*)::int from application_referrals r join applications a on a.id = r.application_id
    where a.email = 'anon@t681.test'),
  0, 'E: and records nothing — it takes no code');

set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select is(
  (select submit_application_as_caller('Same', 'Code', 'same1@t681.test', '+447700968411', date '1995-01-01', true, null, 'K7M4Q2XP')::text),
  (select submit_application_as_caller('Same', 'None', 'same2@t681.test', '+447700968412', date '1995-01-01', true, null)::text),
  'E: the response with a valid code is identical to the response without one');
select is(
  (select submit_application_as_caller('Same', 'Bad', 'same3@t681.test', '+447700968413', date '1995-01-01', true, null, 'R3VW8NTB')::text),
  (select submit_application_as_caller('Same', 'Null', 'same4@t681.test', '+447700968414', date '1995-01-01', true, null, null)::text),
  'E: and a revoked code answers exactly as no code');
-- A §2.12 match with a valid code answers exactly as without one — the
-- applicant cannot tell from the response that the code did not count.
select is(
  (select submit_application_as_caller('Staff', 'Bravo', 'staffb@rls.test', '+447700968421', date '1994-02-02', true, null, 'K7M4Q2XP')::text),
  (select submit_application_as_caller('Same', 'Plain', 'same5@t681.test', '+447700968422', date '1995-01-01', true, null)::text),
  'E: a returning applicant with a valid code answers exactly as a new applicant with none');
reset role;
select is(
  (select row(count(*), count(r.application_id))::text
     from applications a left join application_referrals r on r.application_id = a.id
    where a.email = 'staffb@rls.test'),
  row(2, 0)::text,
  'E: both of staffb''s applications were written, and neither recorded a referral');

select * from finish();
rollback;
