-- =====================================================================
-- 833 · Two emails to the customer about their line-up (§8, §11.4;
--       ADR-0020, ADR-0074, ADR-0088, ADR-0089, ADR-0135 §3)
--       — 20261014170200_client_lineup_emails.sql
--
--   CP2 "Line-up fully confirmed": once per upcoming event, when every
--       section holds its headcount (never a buffer number); withdrawn
--       while unsent if it drops below full, revived when full again.
--   CP3 "Line-up changed after your Allocation Timesheet was sent": a
--       confirmed worker withdrawn or a new one confirmed once D1 was
--       queued; one per event per hour, sent at the top of the next hour.
--   Both: never 23:00–07:00 UK (queued for 07:00), never for a cancelled
--   or started event, each behind its client-card switch, to the event's
--   timesheet recipients, values only — no names, no money.
-- =====================================================================
begin;
select plan(39);
\ir _shared/fixtures.psql

\set ev    'e8330000-0000-4000-8000-000000000001'
\set ev2   'e8330000-0000-4000-8000-000000000002'
\set ev3   'e8330000-0000-4000-8000-000000000003'
\set sh1   'f8330000-0000-4000-8000-000000000001'
\set sh2   'f8330000-0000-4000-8000-000000000002'
\set sh3   'f8330000-0000-4000-8000-000000000003'
\set sh4   'f8330000-0000-4000-8000-000000000004'
\set s1 'd8330000-0000-4000-8000-000000000001'
\set s2 'd8330000-0000-4000-8000-000000000002'
\set s3 'd8330000-0000-4000-8000-000000000003'
\set s4 'd8330000-0000-4000-8000-000000000004'
\set s5 'd8330000-0000-4000-8000-000000000005'
\set b1 '08330000-0000-4000-8000-000000000001'
\set b2 '08330000-0000-4000-8000-000000000002'
\set b3 '08330000-0000-4000-8000-000000000003'
\set b4 '08330000-0000-4000-8000-000000000004'
\set b5 '08330000-0000-4000-8000-000000000005'
\set b6 '08330000-0000-4000-8000-000000000006'
\set b7 '08330000-0000-4000-8000-000000000007'

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'s1', 98331, 'Zelda', 'Quorn',  'z1-833@rls.test', '+447700983301', date '1996-01-01', 'compliant'),
  (:'s2', 98332, 'Yusuf', 'Pellow', 'z2-833@rls.test', '+447700983302', date '1996-01-02', 'compliant'),
  (:'s3', 98333, 'Xenia', 'Ombry',  'z3-833@rls.test', '+447700983303', date '1996-01-03', 'compliant'),
  (:'s4', 98334, 'Wanda', 'Nicks',  'z4-833@rls.test', '+447700983304', date '1996-01-04', 'compliant'),
  (:'s5', 98335, 'Vince', 'Mabry',  'z5-833@rls.test', '+447700983305', date '1996-01-05', 'compliant');

-- Four days out: every send time in this file (nights included) is
-- before the start.
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, document_recipients) values
  (:'ev',  :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Autumn Gala', current_date + 4, true, true,
   array['banqueting@rls.test', 'door@rls.test']),
  (:'ev2', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Second Dinner', current_date + 4, true, true, null),
  (:'ev3', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Early Breakfast', current_date + 1, true, true, null);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour) values
  (:'sh1', :'ev',  :'role_id', now() + interval '4 days', now() + interval '4 days 6 hours', 2, 1, 22.97, 14.00, null, 6),
  (:'sh2', :'ev',  :'role_id', now() + interval '4 days 1 hour', now() + interval '4 days 6 hours', 1, 0, 22.97, 14.00, null, 6),
  (:'sh3', :'ev2', :'role_id', now() + interval '4 days', now() + interval '4 days 6 hours', 1, 0, 22.97, 14.00, null, 6),
  (:'sh4', :'ev3', :'role_id', (current_date + 1 + time '10:30') at time zone 'Europe/London',
                                (current_date + 1 + time '15:00') at time zone 'Europe/London', 1, 0, 22.97, 14.00, null, 6);

-- ---------------------------------------------------------------------
-- Quiet hours, in BST and GMT
-- ---------------------------------------------------------------------
select is(client_email_send_time(timestamptz '2026-07-01 22:59:00 Europe/London'),
          timestamptz '2026-07-01 22:59:00 Europe/London', '22:59 UK goes at 22:59');
select is(client_email_send_time(timestamptz '2026-07-01 23:00:00 Europe/London'),
          timestamptz '2026-07-02 07:00:00 Europe/London', '23:00 UK waits for 07:00 the next morning (BST)');
select is(client_email_send_time(timestamptz '2026-12-01 05:00:00 Europe/London'),
          timestamptz '2026-12-01 07:00:00 Europe/London', '05:00 UK waits for 07:00 the same morning (GMT)');
select is(client_email_send_time(timestamptz '2026-12-01 07:00:00 Europe/London'),
          timestamptz '2026-12-01 07:00:00 Europe/London', '07:00 UK goes at once');

-- ---------------------------------------------------------------------
-- CP2 · fully confirmed, through the booking trigger
-- ---------------------------------------------------------------------
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b1', :'sh1', :'s1', 'confirmed', 'auto', now());
select is((select count(*)::int from notification_outbox where key = 'CP2:event:' || :'ev'), 0,
  'one of three places confirmed: nothing yet');

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b2', :'sh1', :'s2', 'confirmed', 'auto', now()),
  (:'b3', :'sh2', :'s3', 'confirmed', 'auto', now());
select results_eq(
  $$ select template, channel::text, recipient_emails, send_after = client_email_send_time(now())
       from notification_outbox where key = 'CP2:event:e8330000-0000-4000-8000-000000000001' $$,
  $$ values ('CP2'::text, 'email'::text, array['banqueting@rls.test', 'door@rls.test']::text[], true) $$,
  'every role full: one CP2, to the event''s own timesheet recipients, now or at 07:00 UK');
select is((select payload ->> 'sections' from notification_outbox where key = 'CP2:event:' || :'ev'),
  'RLS Fixture Role · ' || to_char((now() + interval '4 days') at time zone 'Europe/London', 'HH24:MI') || '–'
    || to_char((now() + interval '4 days 6 hours') at time zone 'Europe/London', 'HH24:MI') || ' · 2 of 2 confirmed' || E'\n'
    || 'RLS Fixture Role · ' || to_char((now() + interval '4 days 1 hour') at time zone 'Europe/London', 'HH24:MI') || '–'
    || to_char((now() + interval '4 days 6 hours') at time zone 'Europe/London', 'HH24:MI') || ' · 1 of 1 confirmed',
  'one line per role section: role · UK window · N of M confirmed');
select ok((select not (payload::text ~* '(zelda|quorn|yusuf|xenia|rate|charge|pay|£|buffer)')
             from notification_outbox where key = 'CP2:event:' || :'ev'),
  'no worker name, no money, no buffer in the payload');
select ok((select payload ?& array['eventId', 'event', 'date', 'time', 'venue', 'sections']
             from notification_outbox where key = 'CP2:event:' || :'ev'),
  'values only: event id (for the portal link), title, UK date and window, venue, sections');

-- THC's buffer: a third on a section of two. Still one CP2, still "2 of 2".
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b4', :'sh1', :'s4', 'confirmed', 'auto', now());
select is((select count(*)::int from notification_outbox where template = 'CP2' and payload ->> 'eventId' = :'ev'), 1,
  'a buffer confirmation sends no second CP2');
select ok((select payload ->> 'sections' !~ '3 of 2' from notification_outbox where key = 'CP2:event:' || :'ev'),
  '… and the count never says "3 of 2"');

-- Drops below full before the email went: withdrawn, then revived.
update bookings set status = 'cancelled', cancelled_at = now(), cancel_cause = 'office_withdraw' where id = :'b3';
select results_eq(
  $$ select failed_at is not null, error from notification_outbox where key = 'CP2:event:e8330000-0000-4000-8000-000000000001' $$,
  $$ values (true, 'withdrawn: the line-up is no longer fully confirmed'::text) $$,
  'no longer full before it was sent: withdrawn, never "fully confirmed" about a short line-up');
select is((select count(*)::int from notification_outbox where template = 'CP3' and payload ->> 'eventId' = :'ev'), 0,
  'no Allocation Timesheet yet, so no CP3 for the withdrawal');
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b5', :'sh2', :'s5', 'confirmed', 'auto', now());
select results_eq(
  $$ select failed_at is null, error is null, sent_at is null from notification_outbox
      where key = 'CP2:event:e8330000-0000-4000-8000-000000000001' $$,
  $$ values (true, true, true) $$,
  'full again: the same CP2 row is back in the queue');

-- Once sent, it is never sent again.
update notification_outbox set sent_at = now() where key = 'CP2:event:' || :'ev';
update bookings set status = 'cancelled', cancelled_at = now(), cancel_cause = 'office_withdraw' where id = :'b5';
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b6', :'sh2', :'s1', 'confirmed', 'auto', now());
select results_eq(
  $$ select count(*)::int, bool_and(sent_at is not null and failed_at is null)
       from notification_outbox where template = 'CP2' and payload ->> 'eventId' = 'e8330000-0000-4000-8000-000000000001' $$,
  $$ values (1, true) $$,
  'CP2 goes once per event: a sent one is neither withdrawn nor repeated');

-- ---------------------------------------------------------------------
-- CP3 · changed after the Allocation Timesheet went
-- ---------------------------------------------------------------------
insert into event_documents (event_id, kind, storage_path, file_name, row_count, page_count, queued_at, recipients)
values (:'ev', 'allocation', :'ev' || '/833-allocation.pdf', 'Allocation Timesheet.pdf', 3, 1,
        now() - interval '1 hour', array['banqueting@rls.test']);

update bookings set status = 'cancelled', cancelled_at = now(), cancel_cause = 'office_withdraw' where id = :'b6';
select results_eq(
  $$ select count(*)::int, min(send_after) = client_email_send_time(date_trunc('hour', now()) + interval '1 hour'),
            min(key) = 'CP3:event:e8330000-0000-4000-8000-000000000001:'
                       || extract(epoch from client_email_send_time(date_trunc('hour', now()) + interval '1 hour'))::bigint
       from notification_outbox where template = 'CP3' and payload ->> 'eventId' = 'e8330000-0000-4000-8000-000000000001' $$,
  $$ values (1, true, true) $$,
  'a confirmed worker withdrawn after D1: one CP3, at the top of the next hour (or 07:00 UK), keyed by that time');
select ok((select payload ->> 'sections' ~ '0 of 1 confirmed' from notification_outbox
            where template = 'CP3' and payload ->> 'eventId' = :'ev'),
  'it says where the line-up stands: the role now short');

-- Debounce: another change in the same hour refreshes that one row.
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b7', :'sh2', :'s4', 'confirmed', 'auto', now());
select is((select count(*)::int from notification_outbox where template = 'CP3' and payload ->> 'eventId' = :'ev'), 1,
  'a second change in the same hour sends no second email');
select ok((select payload ->> 'sections' ~ '1 of 1 confirmed' from notification_outbox
            where template = 'CP3' and payload ->> 'eventId' = :'ev'),
  '… the queued one now says where it stands');

-- The clock, through the function itself (internal; the triggers pass now()).
select client_lineup_notices(:'ev', true, ((current_date + 1) + time '10:05') at time zone 'Europe/London');
select client_lineup_notices(:'ev', true, ((current_date + 1) + time '10:40') at time zone 'Europe/London');
select is((select count(*)::int from notification_outbox
            where key = 'CP3:event:' || :'ev' || ':'
                        || extract(epoch from ((current_date + 1) + time '11:00') at time zone 'Europe/London')::bigint), 1,
  '10:05 and 10:40 UK: one email, at 11:00');
select client_lineup_notices(:'ev', true, ((current_date + 1) + time '11:10') at time zone 'Europe/London');
select is((select count(*)::int from notification_outbox
            where key = 'CP3:event:' || :'ev' || ':'
                        || extract(epoch from ((current_date + 1) + time '12:00') at time zone 'Europe/London')::bigint), 1,
  '11:10 UK: the next hour''s email, at 12:00 — at most one an hour');

select client_lineup_notices(:'ev', true, ((current_date + 1) + time '22:20') at time zone 'Europe/London');
select client_lineup_notices(:'ev', true, ((current_date + 1) + time '23:30') at time zone 'Europe/London');
select client_lineup_notices(:'ev', true, ((current_date + 2) + time '03:10') at time zone 'Europe/London');
select client_lineup_notices(:'ev', true, ((current_date + 2) + time '05:50') at time zone 'Europe/London');
select is((select count(*)::int from notification_outbox
            where template = 'CP3' and payload ->> 'eventId' = :'ev'
              and send_after > ((current_date + 1) + time '22:00') at time zone 'Europe/London'
              and send_after <= ((current_date + 2) + time '08:00') at time zone 'Europe/London'), 1,
  'changes at 22:20, 23:30, 03:10 and 05:50 UK are ONE email');
select ok((select bool_and(((send_after at time zone 'Europe/London')::time between time '07:00' and time '22:59:59'))
             from notification_outbox where template in ('CP2', 'CP3') and payload ->> 'eventId' = :'ev'),
  'no customer email is due between 23:00 and 07:00 UK');
select is((select (send_after at time zone 'Europe/London')::text from notification_outbox
            where template = 'CP3' and payload ->> 'eventId' = :'ev'
              and send_after > ((current_date + 1) + time '22:00') at time zone 'Europe/London'
              and send_after <= ((current_date + 2) + time '08:00') at time zone 'Europe/London'),
  ((current_date + 2) + time '07:00')::text,
  '… queued for 07:00 UK');

-- A change with no D1 yet (ev2) is not a CP3.
insert into bookings (shift_id, staff_id, status, source, confirmed_at) values (:'sh3', :'s1', 'confirmed', 'auto', now());
select is((select count(*)::int from notification_outbox where template = 'CP3' and payload ->> 'eventId' = :'ev2'), 0,
  'no Allocation Timesheet sent: a confirmation is not a "changed after" email');
select is((select recipient_emails from notification_outbox where key = 'CP2:event:' || :'ev2'),
  array['clienta@rls.test']::text[],
  'with no list of its own the event''s emails go to the client card''s addresses (ADR-0089)');

-- A send time at or after the start: nothing (ev3 starts tomorrow 10:30 UK).
insert into event_documents (event_id, kind, storage_path, file_name, row_count, page_count, queued_at)
values (:'ev3', 'allocation', :'ev3' || '/833-allocation.pdf', 'Allocation Timesheet.pdf', 1, 1, now() - interval '1 hour');
select client_lineup_notices(:'ev3', true, ((current_date + 1) + time '10:10') at time zone 'Europe/London');
select is((select count(*)::int from notification_outbox where template in ('CP2', 'CP3') and payload ->> 'eventId' = :'ev3'), 0,
  'an email that would land at 11:00 for a 10:30 start is not queued');
select client_lineup_notices(:'ev3', true, ((current_date + 1) + time '10:45') at time zone 'Europe/London');
select is((select count(*)::int from notification_outbox where template in ('CP2', 'CP3') and payload ->> 'eventId' = :'ev3'), 0,
  'nothing once the event has started');

-- ---------------------------------------------------------------------
-- The switches
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq($$ select lineup_confirmed_emails, lineup_changed_emails from client_account_v $$,
  $$ values (true, true) $$, 'the customer reads that both emails are on (the default)');
select throws_ok($$ select set_client_lineup_emails('aaaaaaaa-0000-4000-8000-000000000001', 'changed', false) $$,
  '42501', 'admins_only', 'the customer cannot switch them');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$ select set_client_lineup_emails('aaaaaaaa-0000-4000-8000-000000000001', 'changed', false) $$,
  'the office switches "changed" off on the client card');
reset role;
select is((select count(*)::int from notification_outbox
            where template = 'CP3' and payload ->> 'eventId' = :'ev' and sent_at is null and failed_at is null), 0,
  'switching off withdraws the CP3s still queued');
select is((select count(*)::int from audit_log where action = 'client.lineup_emails' and entity_id = :'clienta'
            and data ->> 'email' = 'changed' and (data ->> 'to')::boolean = false), 1,
  'audited on the client''s History');
update bookings set status = 'cancelled', cancelled_at = now(), cancel_cause = 'office_withdraw' where id = :'b7';
select is((select count(*)::int from notification_outbox
            where template = 'CP3' and payload ->> 'eventId' = :'ev' and sent_at is null and failed_at is null), 0,
  'off: a withdrawal after D1 queues no CP3');

update clients set lineup_confirmed_emails = false where id = :'clienta';
delete from notification_outbox where key = 'CP2:event:' || :'ev2';
select client_lineup_notices(:'ev2', false, now());
select is((select count(*)::int from notification_outbox where key = 'CP2:event:' || :'ev2'), 0,
  'off: a full line-up queues no CP2');
update clients set lineup_confirmed_emails = true, lineup_changed_emails = true where id = :'clienta';

-- ---------------------------------------------------------------------
-- Cancelled events
-- ---------------------------------------------------------------------
select client_lineup_notices(:'ev2', false, now());
select is((select count(*)::int from notification_outbox where key = 'CP2:event:' || :'ev2' and sent_at is null and failed_at is null), 1,
  'back on: ev2''s CP2 is queued');
update events set cancelled_at = now(), cancel_reason = 'AUDIT test' where id = :'ev2';
select results_eq(
  $$ select failed_at is not null, error from notification_outbox where key = 'CP2:event:e8330000-0000-4000-8000-000000000002' $$,
  $$ values (true, 'withdrawn: the event was cancelled'::text) $$,
  'cancelling the event withdraws what was still queued for its customer');
update bookings set status = 'cancelled', cancelled_at = now(), cancel_cause = 'event_cancelled'
 where shift_id = :'sh3';
select client_lineup_notices(:'ev2', true, now());
select is((select count(*)::int from notification_outbox
            where payload ->> 'eventId' = :'ev2' and template in ('CP2', 'CP3') and failed_at is null), 0,
  'no email of either kind for a cancelled event');

-- No new template invents a recipient: the two codes carry the row's list.
select is((select count(*)::int from notification_outbox
            where template in ('CP2', 'CP3') and coalesce(cardinality(recipient_emails), 0) = 0), 0,
  'every queued CP2 / CP3 names its recipients on the row');

select * from finish();
rollback;
