-- =====================================================================
-- 900 · The onboarding app reminder goes by email when notifications are
--       off (ADR-0169, 20261021120000)
--
--   A. Who can run the job (the new signature).
--   B. No device with notifications on: OC4, the same rung by email, to
--      the candidate, with the /onboarding link; with a device, OC3 as
--      before; without a good link, OC3 too.
--   C. One ladder: OC4 sits on OC3's key, so a rung is one reminder by
--      one channel, nothing is sent twice, and turning notifications on
--      part-way carries on the count.
--   D. The board sees the channel, and a failed email.
--   E. OC4 is bulk, like OC3.
--   F. (ADR-0186, 20261023120000) A candidate who HAS a device is emailed
--      too: OC4 on its own key beside the OC3 push, so the ladder counts
--      the day once; nothing without a good link, and never to an address
--      that is not the login's.
-- =====================================================================
begin;
select plan(29);
\ir _shared/fixtures.psql

\set c_off  '90000000-0000-4000-8000-000000000001'
\set c_on   '90000000-0000-4000-8000-000000000002'
\set c_mis  '90000000-0000-4000-8000-000000000003'
\set u_off  '90000000-0000-4000-8000-0000000000a1'
\set u_on   '90000000-0000-4000-8000-0000000000a2'
\set u_mis  '90000000-0000-4000-8000-0000000000a3'
\set t0     '2026-09-01 11:00+01'
\set app    'https://staff.test/onboarding'

insert into auth.users (id, email, raw_app_meta_data, encrypted_password, email_confirmed_at) values
  (:'u_off', 'olive@oc4.test', '{"role":"staff"}', '$2a$10$hash', :'t0'),
  (:'u_on',  'owen@oc4.test',  '{"role":"staff"}', '$2a$10$hash', :'t0'),
  -- Mia signs in as mia@; the office has since typed another address.
  (:'u_mis', 'mia@oc4.test',   '{"role":"staff"}', '$2a$10$hash', :'t0');

insert into staff (id, user_id, first_name, last_name, email, phone, dob, status) values
  (:'c_off', :'u_off', 'Olive', 'Off', 'olive@oc4.test', '+447700990001', date '2001-02-01', 'documents'),
  (:'c_on',  :'u_on',  'Owen',  'On',  'owen@oc4.test',  '+447700990002', date '2001-02-02', 'documents'),
  (:'c_mis', :'u_mis', 'Mia',   'Mis', 'someone.else@oc4.test', '+447700990003', date '2001-02-03', 'documents');
update staff set stage_entered_at = :'t0', onboarding_started_at = :'t0'::timestamptz - interval '10 days'
 where id::text like '90000000-%';

-- Both signed up, right to work done, the home address next.
insert into onboarding_progress (staff_id, rtw_at, updated_at) values
  (:'c_off', :'t0', :'t0'),
  (:'c_on',  :'t0', :'t0'),
  (:'c_mis', :'t0', :'t0');

-- Owen turned notifications on; Olive never did.
insert into push_subscriptions (staff_id, endpoint, p256dh, auth) values
  (:'c_on', 'https://push.test/owen', 'p256dh-owen', 'auth-owen');

-- =====================================================================
-- A · who can run it
-- =====================================================================
select ok(has_function_privilege('service_role', 'onboarding_chasers(timestamptz,text)', 'execute')
      and not has_function_privilege('authenticated', 'onboarding_chasers(timestamptz,text)', 'execute')
      and not has_function_privilege('anon', 'onboarding_chasers(timestamptz,text)', 'execute'),
  'only the service role runs the job, with the app link');
select is((select count(*)::int from pg_proc where proname = 'onboarding_chasers'
             and pronamespace = 'public'::regnamespace), 1,
  'one onboarding_chasers(): the old one-argument signature is gone');

-- =====================================================================
-- B · day one, with a link that is not the onboarding page
-- =====================================================================
create temporary table r0 as select onboarding_chasers('2026-09-02 11:00+01') as r;
select is((select array[template, channel::text] from notification_outbox
            where key like 'OC3:staff:' || :'c_off' || ':%:1'),
  array['OC3', 'push'],
  'no link at all (the Edge Function without STAFF_APP_URL): the OC3 push, as before');
delete from notification_outbox where key like 'OC3:staff:90000000-%';
create temporary table r1 as
  select onboarding_chasers('2026-09-02 12:00+01', 'https://evil.test/phish') as r;
select is((select array[template, channel::text] from notification_outbox
            where key like 'OC3:staff:' || :'c_off' || ':%:1'),
  array['OC3', 'push'],
  'a link that is not <origin>/onboarding is no link: the OC3 push, as before');
select is((select (r ->> 'oc4')::int from r1), 0, 'and nothing is emailed');
select is((select count(*)::int from notification_outbox where key like 'OC4:staff:90000000-%'), 0,
  'F: without a good link nobody is emailed either, device or not');

-- =====================================================================
-- B, C · day two, with the app link
-- =====================================================================
create temporary table r2 as select onboarding_chasers('2026-09-03 12:00+01', :'app') as r;
select is((select array[template, channel::text, recipient_emails[1],
                        payload ->> 'variant', payload ->> 'name', payload ->> 'step', payload ->> 'link']
             from notification_outbox where key like 'OC3:staff:' || :'c_off' || ':%:2'),
  array['OC4', 'email', 'olive@oc4.test', 'second', 'Olive', 'your home address', :'app'],
  'no device with notifications on: the second rung by email (OC4), on OC3''s key, to the candidate, with the link');
select is((select recipient_staff_id from notification_outbox where key like 'OC3:staff:' || :'c_off' || ':%:2'),
  :'c_off'::uuid, 'and it names the candidate');
select is((select array[template, channel::text, payload ->> 'variant'] from notification_outbox
            where key like 'OC3:staff:' || :'c_on' || ':%:2'),
  array['OC3', 'push', 'second'],
  'a device with notifications on: the push, as before');
select is((select array[template, channel::text] from notification_outbox
            where key like 'OC3:staff:' || :'c_mis' || ':%:2'),
  array['OC3', 'push'],
  'staff.email is not the address they sign in with: never emailed, the push as before');
select is((select array[(r ->> 'oc3')::int, (r ->> 'oc4')::int, (r ->> 'oc4_also')::int] from r2), array[2, 1, 1],
  'the job counts the pushes, the emails that replace one, and the emails beside one apart');
select is((select array[template, channel::text, recipient_emails[1], payload ->> 'variant',
                        payload ->> 'name', payload ->> 'step', payload ->> 'link', payload ->> 'pushOn']
             from notification_outbox where key like 'OC4:staff:' || :'c_on' || ':%:2'),
  array['OC4', 'email', 'owen@oc4.test', 'second', 'Owen', 'your home address', :'app', '1'],
  'F: a device with notifications on is emailed as well as pushed, on OC4''s own key, flagged pushOn');
select is((select payload ->> 'pushOn' from notification_outbox where key like 'OC3:staff:' || :'c_off' || ':%:2'),
  '0', 'F: the email that replaces a push says pushOn 0');
select is((select count(*)::int from notification_outbox where key like 'OC4:staff:' || :'c_mis' || ':%'), 0,
  'F: staff.email is not the address they sign in with: no email beside the push either');

create temporary table r2b as select onboarding_chasers('2026-09-03 12:00+01', :'app') as r;
select is((select array[(r ->> 'oc3')::int, (r ->> 'oc4')::int, (r ->> 'oc4_also')::int] from r2b), array[0, 0, 0],
  'run again: nothing is sent twice');
select is((select count(*)::int from notification_outbox where key like 'OC4:staff:' || :'c_on' || ':%'), 1,
  'F: and the email beside the push is not queued twice');
select is((select count(*)::int from notification_outbox
            where key like 'OC3:staff:' || :'c_off' || ':%' and template in ('OC3', 'OC4')), 2,
  'one reminder per rung, whichever way it went');

-- =====================================================================
-- D · the board sees how it went
-- =====================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select array[rungs_sent::text, last_channel, last_failed::text]
             from onboarding_chaser_state('2026-09-03 13:00+01') where staff_id = :'c_off'),
  array['2', 'email', 'false'],
  'the office sees two app reminders, the latest emailed');
select is((select array[rungs_sent::text, last_channel] from onboarding_chaser_state('2026-09-03 13:00+01') where staff_id = :'c_on'),
  array['2', 'push'], 'and a pushed one as pushed, the email beside it not counted as a rung of its own');
reset role;

update notification_outbox set failed_at = '2026-09-03 12:05+01', error = 'bounced'
 where key like 'OC3:staff:' || :'c_off' || ':%:2';
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select array[last_channel, last_failed::text]
             from onboarding_chaser_state('2026-09-03 13:00+01') where staff_id = :'c_off'),
  array['email', 'true'], 'an email that failed shows as undelivered');
select is((select last_switched_off from onboarding_chaser_state('2026-09-03 13:00+01') where staff_id = :'c_off'),
  false, 'a bounce is not a switch');
reset role;

update notification_outbox set error = 'Not sent: switched off in Settings'
 where key like 'OC3:staff:' || :'c_off' || ':%:2';
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select last_switched_off from onboarding_chaser_state('2026-09-03 13:00+01') where staff_id = :'c_off'),
  true, 'one the drain settled because OC4 is off in Settings says so');
reset role;

-- =====================================================================
-- C · notifications turned on part-way: the push, and the count goes on
-- =====================================================================
insert into push_subscriptions (staff_id, endpoint, p256dh, auth) values
  (:'c_off', 'https://push.test/olive', 'p256dh-olive', 'auth-olive');
create temporary table r3 as select onboarding_chasers('2026-09-04 12:00+01', :'app') as r;
select is((select array[template, channel::text, payload ->> 'variant'] from notification_outbox
            where key like 'OC3:staff:' || :'c_off' || ':%:3'),
  array['OC3', 'push', 'repeat'],
  'once a device has notifications on, the third rung is a push');

delete from push_subscriptions where staff_id = :'c_off';
create temporary table r4 as select onboarding_chasers('2026-09-05 12:00+01', :'app') as r;
select is((select array[template, payload ->> 'variant'] from notification_outbox
            where key like 'OC3:staff:' || :'c_off' || ':%:4'),
  array['OC4', 'repeat'],
  'and turned off again, the fourth goes by email, still counting');

-- =====================================================================
-- B · a local origin for development is a link too
-- =====================================================================
delete from notification_outbox where key like 'OC3:staff:' || :'c_off' || ':%';
create temporary table r5 as
  select onboarding_chasers('2026-09-06 12:00+01', 'http://localhost:3001/onboarding') as r;
select is((select array[template, payload ->> 'link'] from notification_outbox
            where key like 'OC3:staff:' || :'c_off' || ':%:1'),
  array['OC4', 'http://localhost:3001/onboarding'],
  'http://localhost:<port>/onboarding counts as the app link');

-- =====================================================================
-- E · bulk, like OC3
-- =====================================================================
select is(notification_priority('OC4'), 2::smallint, 'OC4 is bulk in the mapping');
select is((select priority from notification_outbox where key like 'OC3:staff:' || :'c_off' || ':%:1'),
  2::smallint, 'and its rows are claimed as bulk');
select is(notification_priority('OC3'), 2::smallint, 'OC3 is unchanged');
select ok((select note from job_schedules where job = 'onboarding-chasers') like '%OC4%',
  'the job''s note names OC4');

select * from finish();
rollback;
