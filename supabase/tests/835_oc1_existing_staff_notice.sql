-- =====================================================================
-- 835 · the one-off OC1 notice to existing staff who have registered but
--       not taken their Willo interview (20261014190000)
--
--   A. Who can reach it.
--   B. Who gets it: existing staff the daily OC1 run chases, and nobody
--      else — not a new applicant, not somebody Willo has not invited,
--      not somebody whose interview is in, not a removed account.
--   C. Once: a second call sends nobody anything, and the daily ladder
--      is untouched.
--   D. When: inside the UK daytime, paced; outside it, from the next
--      opening.
-- =====================================================================
begin;
select plan(13);
\ir _shared/fixtures.psql

\set c_list  '83500000-0000-4000-8000-000000000001'
\set c_pay   '83500000-0000-4000-8000-000000000002'
\set c_new   '83500000-0000-4000-8000-000000000003'
\set c_wait  '83500000-0000-4000-8000-000000000004'
\set c_done  '83500000-0000-4000-8000-000000000005'
\set c_gone  '83500000-0000-4000-8000-000000000006'
\set t0      '2026-09-01 11:00+01'

insert into staff (id, user_id, first_name, last_name, email, phone, dob, status) values
  (:'c_list', null, 'Lou', 'List', 'lou@oc1n.test', '+447700983501', date '2001-03-01', 'interview_requested'),
  (:'c_pay',  null, 'Pat', 'Pay',  'pat@oc1n.test', '+447700983502', date '2001-03-02', 'interview_requested'),
  (:'c_new',  null, 'Nia', 'New',  'nia@oc1n.test', '+447700983503', date '2001-03-03', 'interview_requested'),
  (:'c_wait', null, 'Wes', 'Wait', 'wes@oc1n.test', '+447700983504', date '2001-03-04', 'interview_requested'),
  (:'c_done', null, 'Dot', 'Done', 'dot@oc1n.test', '+447700983505', date '2001-03-05', 'interview_requested'),
  (:'c_gone', null, 'Gus', 'Gone', 'gus@oc1n.test', '+447700983506', date '2001-03-06', 'interview_requested');

update staff set stage_entered_at = :'t0', onboarding_started_at = :'t0', willo_invited_at = :'t0'
 where id::text like '83500000-%';
-- Wes has applied but Willo has not invited him yet; Dot's answers are in.
update staff set willo_invited_at = null where id = :'c_wait';
update staff set willo_completed_at = '2026-09-01 15:00+01' where id = :'c_done';
update staff set removed_at = '2026-09-01 16:00+01' where id = :'c_gone';

-- Lou applied from the THC invite list; Pat carries a Payroll ID; Wes, Dot
-- and Gus are existing staff too; Nia is a new applicant.
insert into audit_log (actor, action, entity, entity_id, data) values
  (null, 'roster.matched', 'staff', :'c_list', jsonb_build_object('group', 'thc', 'via', 'list')),
  (null, 'roster.matched', 'staff', :'c_wait', jsonb_build_object('group', 'thc', 'via', 'list')),
  (null, 'roster.matched', 'staff', :'c_done', jsonb_build_object('group', 'thc', 'via', 'list')),
  (null, 'roster.matched', 'staff', :'c_gone', jsonb_build_object('group', 'thc', 'via', 'list'));
update staff set payroll_id = '8351A' where id = :'c_pay';

-- =====================================================================
-- A · who can reach it
-- =====================================================================
select ok(not has_function_privilege('authenticated', 'oc1_existing_staff_notice(timestamptz)', 'execute')
      and not has_function_privilege('anon', 'oc1_existing_staff_notice(timestamptz)', 'execute'),
  'no session can send the notice');
select ok(has_function_privilege('service_role', 'oc1_existing_staff_notice(timestamptz)', 'execute'),
  'the service role can');

-- =====================================================================
-- B · who gets it (12:00 UK, inside the window)
-- =====================================================================
select is((oc1_existing_staff_notice('2026-09-02 12:00+01') ->> 'queued')::int, 2,
  'two existing staff are waiting on their interview');

select is((select array_agg(recipient_staff_id::text order by recipient_emails[1]) from notification_outbox
            where key like 'OC1:notice:83500000-%'),
  array[:'c_list', :'c_pay'],
  'Lou (from the list) and Pat (a Payroll ID); not the new applicant, the uninvited, the done or the removed');
select is((select array[channel::text, template, recipient_emails[1], payload ->> 'name', payload ->> 'variant']
             from notification_outbox where key = 'OC1:notice:' || :'c_list'),
  array['email', 'OC1', 'lou@oc1n.test', 'Lou', 'existing_notice'],
  'OC1''s existing_notice wording, by email, to them, by name');
select is((select array_agg(send_after order by send_after) from notification_outbox
            where key like 'OC1:notice:83500000-%'),
  array['2026-09-02 12:00:00+01'::timestamptz, '2026-09-02 12:00:02+01'::timestamptz],
  'straight away, two seconds apart');

-- =====================================================================
-- C · once, and the daily ladder untouched
-- =====================================================================
select is((oc1_existing_staff_notice('2026-09-02 13:00+01') ->> 'queued')::int, 0,
  'a second call sends nobody a second notice');
select is((select count(*)::int from notification_outbox where key like 'OC1:notice:83500000-%'), 2,
  'still one notice each');

select onboarding_chasers('2026-09-02 12:00+01');
select is((select array_agg(payload ->> 'variant' order by recipient_emails[1]) from notification_outbox
            where key like 'OC1:staff:83500000-%:1'
              and recipient_staff_id in (:'c_list', :'c_pay')),
  array['existing_first', 'existing_first'],
  'the notice is not a rung: the daily run still starts at existing_first');
select is((select payload ->> 'variant' from notification_outbox where key like 'OC1:staff:' || :'c_new' || ':%:1'),
  'first', 'the new applicant keeps the daily new-applicant wording');

-- =====================================================================
-- D · outside the UK daytime it waits for the next opening
-- =====================================================================
delete from notification_outbox where key like 'OC1:notice:83500000-%';
select oc1_existing_staff_notice('2026-09-02 20:00+01');
select is((select min(send_after) from notification_outbox where key like 'OC1:notice:83500000-%'),
  '2026-09-03 10:00+01'::timestamptz, 'applied in the evening: from 10:00 UK the next morning');

delete from notification_outbox where key like 'OC1:notice:83500000-%';
select oc1_existing_staff_notice('2026-09-02 07:00+01');
select is((select min(send_after) from notification_outbox where key like 'OC1:notice:83500000-%'),
  '2026-09-02 10:00+01'::timestamptz, 'applied early: from 10:00 UK the same morning');

-- In winter the opening is 10:00 GMT.
delete from notification_outbox where key like 'OC1:notice:83500000-%';
select oc1_existing_staff_notice('2026-12-02 19:00+00');
select is((select min(send_after) from notification_outbox where key like 'OC1:notice:83500000-%'),
  '2026-12-03 10:00+00'::timestamptz, 'and in GMT, 10:00 GMT');

select * from finish();
rollback;
