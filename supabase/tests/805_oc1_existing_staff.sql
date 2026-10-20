-- =====================================================================
-- 805 · OC1 for existing staff moving onto the new app (20261012123000)
--
--   A. Who can reach the new helper.
--   B. Who is existing staff: matched to the invite list when they
--      applied, or carrying a Payroll ID. Not a new applicant, and not
--      somebody the link alone decided.
--   C. The job queues OC1's existing_* wording for them, rung by rung,
--      and the new-applicant wording for everyone else. Same keys, same
--      cadence.
-- =====================================================================
begin;
select plan(17);
\ir _shared/fixtures.psql

\set c_new   '80400000-0000-4000-8000-000000000001'
\set c_list  '80400000-0000-4000-8000-000000000002'
\set c_pay   '80400000-0000-4000-8000-000000000003'
\set c_link  '80400000-0000-4000-8000-000000000004'
\set c_spud  '80400000-0000-4000-8000-000000000005'
\set c_over  '80400000-0000-4000-8000-000000000006'
\set c_here  '80400000-0000-4000-8000-000000000007'
\set c_other '80400000-0000-4000-8000-000000000008'
\set t0      '2026-09-01 11:00+01'

insert into staff (id, user_id, first_name, last_name, email, phone, dob, status) values
  (:'c_new',  null, 'Nia',  'New',  'nia@oc1x.test',  '+447700980401', date '2001-02-01', 'interview_requested'),
  (:'c_list', null, 'Lou',  'List', 'lou@oc1x.test',  '+447700980402', date '2001-02-02', 'interview_requested'),
  (:'c_pay',  null, 'Pat',  'Pay',  'pat@oc1x.test',  '+447700980403', date '2001-02-03', 'interview_requested'),
  (:'c_link', null, 'Lin',  'Link', 'lin@oc1x.test',  '+447700980404', date '2001-02-04', 'interview_requested'),
  (:'c_spud', null, 'Sam',  'Spud', 'sam@oc1x.test',  '+447700980405', date '2001-02-05', 'interview_requested'),
  (:'c_over', null, 'Ola',  'Over', 'ola@oc1x.test',  '+447700980406', date '2001-02-06', 'interview_requested'),
  (:'c_here', null, 'Hal',  'Here', 'hal@oc1x.test',  '+447700980407', date '2001-02-07', 'interview_requested'),
  (:'c_other', null, 'Oti', 'Other', 'oti@oc1x.test', '+447700980408', date '2001-02-08', 'interview_requested');

update staff set stage_entered_at = :'t0', onboarding_started_at = :'t0', willo_invited_at = :'t0'
 where id::text like '80400000-%';

-- Lou applied with an email on the invite list (THC); Sam was on it as
-- SpudBros but the name was spelt differently; Lin came in by the link
-- with no list row; Pat carries a Payroll ID the office set.
insert into audit_log (actor, action, entity, entity_id, data) values
  (null, 'roster.matched', 'staff', :'c_list',
   jsonb_build_object('staffId', :'c_list', 'group', 'thc', 'via', 'list')),
  (null, 'roster.matched', 'staff', :'c_spud',
   jsonb_build_object('staffId', :'c_spud', 'group', 'spudbros', 'via', 'list_name_mismatch')),
  (null, 'roster.matched', 'staff', :'c_link',
   jsonb_build_object('staffId', :'c_link', 'group', 'thc', 'via', 'link')),
  (null, 'roster.matched', 'staff', :'c_over',
   jsonb_build_object('staffId', :'c_over', 'group', 'thc', 'via', 'list_over_link')),
  (null, 'roster.applied_existing', 'staff', :'c_here',
   jsonb_build_object('staffId', :'c_here', 'group', 'thc', 'payrollId', null)),
  -- the same uuid under another entity is not this person's audit row
  (null, 'roster.matched', 'booking', :'c_other',
   jsonb_build_object('via', 'list'));
update staff set payroll_id = '1641A' where id = :'c_pay';

-- =====================================================================
-- A · who can reach it
-- =====================================================================
select ok(not has_function_privilege('authenticated', 'onboarding_chaser_existing_staff(uuid)', 'execute')
      and not has_function_privilege('anon', 'onboarding_chaser_existing_staff(uuid)', 'execute'),
  'no session can ask whether somebody is existing staff');
select ok(not has_function_privilege('authenticated', 'onboarding_chasers(timestamptz,text)', 'execute')
      and has_function_privilege('service_role', 'onboarding_chasers(timestamptz,text)', 'execute'),
  'the job is still the service role''s alone');

-- =====================================================================
-- B · who is existing staff
-- =====================================================================
select ok(onboarding_chaser_existing_staff(:'c_list'), 'matched to the invite list: existing staff');
select ok(onboarding_chaser_existing_staff(:'c_spud'), 'on the list with a misspelt name: existing staff');
select ok(onboarding_chaser_existing_staff(:'c_pay'), 'carrying a Payroll ID: existing staff');
select ok(onboarding_chaser_existing_staff(:'c_over'), 'on the THC list, through the SpudBros link: existing staff');
select ok(onboarding_chaser_existing_staff(:'c_here'), 'already here when a list was applied to them: existing staff');
select ok(not onboarding_chaser_existing_staff(:'c_other'), 'a matching row about another entity counts for nothing');
select ok(not onboarding_chaser_existing_staff(:'c_new'), 'a new applicant is not');
select ok(not onboarding_chaser_existing_staff(:'c_link'), 'nor somebody only the link decided');

-- =====================================================================
-- C · the wording queued
-- =====================================================================
select onboarding_chasers('2026-09-02 12:00+01');

select is((select payload ->> 'variant' from notification_outbox where key like 'OC1:staff:' || :'c_new' || ':%:1'),
  'first', 'a new applicant keeps the new-applicant wording');
select is((select payload ->> 'variant' from notification_outbox where key like 'OC1:staff:' || :'c_link' || ':%:1'),
  'first', 'and so does somebody the link decided');
select is((select array_agg(payload ->> 'variant' order by key) from notification_outbox
            where template = 'OC1' and key like 'OC1:staff:80400000-%:1'
              and recipient_staff_id in (:'c_list', :'c_pay', :'c_spud')),
  array['existing_first', 'existing_first', 'existing_first'],
  'existing staff are told the interview is part of moving onto the new app');
select is((select array[channel::text, recipient_emails[1], payload ->> 'name'] from notification_outbox
            where key like 'OC1:staff:' || :'c_list' || ':%:1'),
  array['email', 'lou@oc1x.test', 'Lou'], 'by email, to them, by name');

select onboarding_chasers('2026-09-03 12:00+01');
select onboarding_chasers('2026-09-04 12:00+01');

select is((select array_agg(payload ->> 'variant' order by (payload ->> 'rung')::int) from notification_outbox
            where key like 'OC1:staff:' || :'c_list' || ':%'),
  array['existing_first', 'existing_second', 'existing_repeat'],
  'daily, rung by rung, in the existing-staff wording');
select is((select array_agg(payload ->> 'variant' order by (payload ->> 'rung')::int) from notification_outbox
            where key like 'OC1:staff:' || :'c_new' || ':%'),
  array['first', 'second', 'repeat'], 'the new applicant''s run is unchanged');

-- A Payroll ID set mid-run switches the next reminder.
update staff set payroll_id = '9804' where id = :'c_new';
select onboarding_chasers('2026-09-05 12:00+01');
select is((select payload ->> 'variant' from notification_outbox where key like 'OC1:staff:' || :'c_new' || ':%:4'),
  'existing_repeat', 'a Payroll ID set by the office switches the next reminder');

select * from finish();
rollback;
