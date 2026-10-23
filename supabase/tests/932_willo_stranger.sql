-- =====================================================================
-- 932 · A Willo delivery for a stranger is answered, not audited
--       20261026100000 · ADR-0202 · §2.4
--
-- willo_stranger() is true only for a well-formed email that belongs to no
-- staff row at all. Anything we hold, in any status, is not a stranger,
-- and an email we cannot read is never one (it is audited as before).
-- =====================================================================
begin;
select plan(11);
\ir _shared/fixtures.psql

\set c_wait '93200000-0000-4000-8000-000000000001'
\set c_past '93200000-0000-4000-8000-000000000002'
\set c_gone '93200000-0000-4000-8000-000000000003'
\set c_rej  '93200000-0000-4000-8000-000000000004'

insert into staff (id, first_name, last_name, email, phone, dob, status, removed_at) values
  (:'c_wait', 'Wes', 'Wait', 'Wes.Wait@Willo.test', '+447700932001', date '1990-01-01', 'interview_requested', null),
  (:'c_past', 'Pia', 'Past', 'pia@willo.test',      '+447700932002', date '1990-02-02', 'documents',           null),
  (:'c_gone', 'Gus', 'Gone', 'gus@willo.test',      '+447700932003', date '1990-03-03', 'interview_requested', now()),
  (:'c_rej',  'Rex', 'Rej',  'rex@willo.test',      '+447700932004', date '1990-04-04', 'rejected',            null);

-- ---------------------------------------------------------------------
-- Who can call it
-- ---------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.willo_stranger(text)', 'execute'),
  'anon cannot call it');
select ok(not has_function_privilege('authenticated', 'public.willo_stranger(text)', 'execute'),
  'no signed-in account can call it');
select ok(has_function_privilege('service_role', 'public.willo_stranger(text)', 'execute'),
  'the service role — the Edge Function — can');

-- ---------------------------------------------------------------------
-- Strangers
-- ---------------------------------------------------------------------
select is(willo_stranger('nobody@elsewhere.test'), true,
  'an email no row holds is a stranger');

-- ---------------------------------------------------------------------
-- Everybody we hold is not
-- ---------------------------------------------------------------------
select is(willo_stranger('wes.wait@willo.test'), false,
  'a candidate awaiting the interview: not a stranger, case ignored');
select is(willo_stranger('  PIA@willo.test '), false,
  'a candidate past the interview: not a stranger, spaces ignored');
select is(willo_stranger('gus@willo.test'), false,
  'a removed row still holds the address: not a stranger');
select is(willo_stranger('rex@willo.test'), false,
  'a rejected candidate: not a stranger');

-- ---------------------------------------------------------------------
-- What we cannot read is audited as before
-- ---------------------------------------------------------------------
select is(willo_stranger(null), false, 'no email: not called a stranger');
select is(willo_stranger('not an email'), false, 'a malformed email: not called a stranger');
select is(willo_stranger(''), false, 'an empty email: not called a stranger');

select * from finish();
rollback;
