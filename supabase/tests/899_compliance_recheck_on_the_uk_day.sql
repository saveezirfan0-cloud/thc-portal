-- =====================================================================
-- 899 · The §4.3 full re-check runs on the UK day (20261021060000)
--
-- Verify (compliance_docs_verified → unblock_if_compliant) and the
-- profile's Unblock (unblock_worker with no p_on) asked compliance_blockers()
-- about `current_date` — the SESSION's day. In summer the UTC day is the day
-- before the UK one from 00:00 to 01:00 UK time, and a session in another
-- zone moves it further, so a worker whose other document expires today in
-- the UK could be unblocked.
--
-- The session's zone is set here to one whose calendar day is NOT the UK
-- day at the moment the test runs (Kiritimati, UTC+14, is ahead of London
-- from mid-morning UK time; Pago Pago, UTC-11, is behind it until midday —
-- so one of the two always differs). A second verified document then
-- expires on whichever of the two days is later: expired to one of them,
-- not to the other. The answer must be the UK day's.
-- =====================================================================
begin;
select plan(6);
\ir _shared/fixtures.psql

\set w1 'd8990000-0000-4000-8000-000000000001'
\set w2 'd8990000-0000-4000-8000-000000000002'

create temporary table _day as
select (now() at time zone 'Europe/London')::date as uk,
       z.zone,
       (now() at time zone z.zone)::date as other
  from (select case when (now() at time zone 'Pacific/Kiritimati')::date
                         <> (now() at time zone 'Europe/London')::date
                    then 'Pacific/Kiritimati' else 'Pacific/Pago_Pago' end as zone) z;
grant select on _day to public;

select ok((select uk <> other from _day), 'the session zone chosen has a different calendar day from the UK');

-- Two blocked workers with a visa document that expires on the later of the
-- two days: worker 1 auto-blocked on a passport that expired last month (its
-- renewal is verified below), worker 2 blocked by hand with a valid passport.
insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch,
                   employee_id, block_kind, block_reason, contract_signed_at, contract_version) values
  (:'w1', 'Uk', 'Dayone', 'ukday1@rls.test', '+447700908991', date '1995-01-01', 'compliant', 'work_visa',
   98991, null, null, '2026-01-01 10:00+00', 'v1.2'),
  (:'w2', 'Uk', 'Daytwo', 'ukday2@rls.test', '+447700908992', date '1995-01-01', 'compliant', 'work_visa',
   98992, null, null, '2026-01-01 10:00+00', 'v1.2');
insert into compliance_docs (id, staff_id, doc_type, review_status, expiry_date, uploaded_at) values
  ('e8990000-0000-4000-8000-000000000001', :'w1', 'passport', 'verified',
   (select uk from _day) - 30, now() - interval '400 days'),
  ('e8990000-0000-4000-8000-000000000002', :'w1', 'visa_document', 'verified',
   (select greatest(uk, other) from _day), now() - interval '400 days'),
  ('e8990000-0000-4000-8000-000000000003', :'w2', 'passport', 'verified',
   date '2035-01-01', now() - interval '400 days'),
  ('e8990000-0000-4000-8000-000000000004', :'w2', 'visa_document', 'verified',
   (select greatest(uk, other) from _day), now() - interval '400 days');
insert into criminal_declarations (staff_id, source, answer, review_status) values
  (:'w1', 'onboarding', false, 'verified'),
  (:'w2', 'onboarding', false, 'verified');
do $$ begin
  perform block_worker('d8990000-0000-4000-8000-000000000001', 'auto_document', 'Document expired: Passport');
  perform block_worker('d8990000-0000-4000-8000-000000000002', 'manual', 'Conduct under review');
end $$;

-- The renewed passport, pending, for worker 1.
insert into compliance_docs (id, staff_id, doc_type, review_status, expiry_date, uploaded_at) values
  ('e8990000-0000-4000-8000-000000000005', :'w1', 'passport', 'pending', date '2035-01-01', now());

-- What the rule says on the UK day: blocked iff the visa document has expired there.
create temporary table _expect as
select (select greatest(uk, other) from _day) <= (select uk from _day) as visa_expired_uk;
grant select on _expect to public;

do $$ begin perform set_config('timezone', (select zone from _day), true); end $$;
select ok(current_date = (select other from _day), 'current_date is now the other zone''s day');

-- Verify the renewed passport (the trigger's full re-check).
update compliance_docs
   set review_status = 'verified', reviewed_at = now(), reviewed_by = :'admin_uid'
 where id = 'e8990000-0000-4000-8000-000000000005';

select is((select status::text from staff where id = :'w1'),
          case when (select visa_expired_uk from _expect) then 'blocked' else 'compliant' end,
          'Verify lifts an automatic block only when the UK day''s full re-check passes');

-- The profile's Unblock with no date: the UK day too.
select is((unblock_worker(:'w2', p_actor => :'admin_uid'::uuid))->>'unblocked',
          case when (select visa_expired_uk from _expect) then 'false' else 'true' end,
          'Unblock (no p_on) runs the full re-check on the UK day');
select is((select status::text from staff where id = :'w2'),
          case when (select visa_expired_uk from _expect) then 'blocked' else 'compliant' end,
          'and leaves the status the UK day''s answer implies');

select ok(pg_get_function_arguments('public.unblock_worker(uuid, date, uuid)'::regprocedure)
            like '%Europe/London%',
          'unblock_worker''s p_on defaults to the UK day, not current_date');

select * from finish();
rollback;
