-- =====================================================================
-- 759 · The Allocation Timesheet and the Completed Allocation Timesheet
--       go out on their own — 20261002100000 · ADR-0074 (THC 29.09.2026)
--
-- The rule is document_autosend_verdict(), mirrored check for check by
-- autosendVerdict() in apps/office/app/api/jobs/event-documents/_lib/
-- schedule.ts; section 1 runs the SAME cases as schedule.test.ts, so the two
-- cannot drift apart silently. Then: the settings row, the new table's
-- policies (admin / client / staff), the service-role-only functions, one
-- whole D1 and D2 through claim → record → queue, the payload's new keys,
-- and the job_schedules row.
-- =====================================================================
begin;
select plan(84);
\ir _shared/fixtures.psql

-- Sat 11 Jul 2026 (BST): 07:00 → 22:30 UK, six confirmed, two contacts,
-- unless a case says otherwise.
create function pg_temp.d(p_kind text, p_now timestamptz, p_changes jsonb default '{}'::jsonb,
                          p_cfg jsonb default '{}'::jsonb)
returns text language sql as $$
  select document_autosend_verdict(
    p_kind, p_now, p_cfg,
    coalesce((p_changes->>'event_date')::date, date '2026-07-11'),
    case when p_changes ? 'first_start' then (p_changes->>'first_start')::timestamptz
         else timestamptz '2026-07-11 06:00+00' end,
    case when p_changes ? 'last_end' then (p_changes->>'last_end')::timestamptz
         else timestamptz '2026-07-11 21:30+00' end,
    coalesce((p_changes->>'cancelled')::boolean, false),
    coalesce((p_changes->>'confirmed')::int, 6),
    coalesce((p_changes->>'contacts')::int, 2),
    coalesce((p_changes->>'undetermined')::int, 0),
    (p_changes->>'manual_at')::timestamptz,
    (p_changes->>'signout_at')::timestamptz,
    (p_changes->>'auto_at')::timestamptz)
$$;

-- =====================================================================
-- 1 · The rule — the same cases as schedule.test.ts
-- =====================================================================
-- D1, the day before at 14:00 UK
select is(pg_temp.d('allocation', '2026-07-10 12:59:59+00'), 'not_yet', 'D1: 13:59:59 UK the day before is not yet');
select is(pg_temp.d('allocation', '2026-07-10 13:00+00'), 'due', 'D1: 14:00 BST (13:00Z) the day before is due');
select is(pg_temp.d('allocation', '2026-12-04 13:59+00', '{"event_date":"2026-12-05","first_start":"2026-12-05T18:00Z","last_end":"2026-12-05T23:30Z"}'),
  'not_yet', 'D1 in GMT: 13:59Z is not yet…');
select is(pg_temp.d('allocation', '2026-12-04 14:00+00', '{"event_date":"2026-12-05","first_start":"2026-12-05T18:00Z","last_end":"2026-12-05T23:30Z"}'),
  'due', '…14:00Z is 14:00 UK');
select is(pg_temp.d('allocation', '2026-07-10 22:45+00'), 'due', 'D1 catch-up: an event filled late still gets one');
select is(pg_temp.d('allocation', '2026-07-11 05:59+00'), 'due', 'D1 catch-up: up to the first shift start');
select is(pg_temp.d('allocation', '2026-07-11 06:00+00'), 'too_late', 'D1: never once the first shift has started');
select is(pg_temp.d('allocation', '2026-07-10 13:00+00', '{"manual_at":"2026-07-09T23:00Z"}'), 'manual_sent',
  'D1: a manager queued one at 00:00 UK the day before — skipped');
select is(pg_temp.d('allocation', '2026-07-10 13:00+00', '{"manual_at":"2026-07-09T22:59Z"}'), 'due',
  'D1: one queued before 00:00 UK the day before is not fresh — the automatic one goes');
select is(pg_temp.d('allocation', '2026-07-10 13:00+00', '{"cancelled":true}'), 'cancelled', 'D1: cancelled event');
select is(pg_temp.d('allocation', '2026-07-10 13:00+00', '{"confirmed":0}'), 'no_confirmed_staff', 'D1: nobody confirmed');
select is(pg_temp.d('allocation', '2026-07-10 13:00+00', '{"contacts":0}'), 'no_contact_emails', 'D1: no contact emails');
select is(pg_temp.d('allocation', '2026-07-10 13:15+00', '{"auto_at":"2026-07-10T13:00:05Z"}'), 'already_sent', 'D1: at most once');
select is(pg_temp.d('allocation', '2026-07-10 13:00+00', '{}', '{"allocation":{"enabled":false}}'), 'disabled', 'D1: switched off in settings');
select is(pg_temp.d('allocation', '2026-07-10 15:30+00', '{}', '{"allocation":{"time":"16:30"}}'), 'due', 'D1: the time comes from settings');
select is(pg_temp.d('allocation', '2026-07-10 13:00+00', '{}', '{"allocation":{"time":"2pm","enabled":"false"}}'), 'due',
  'D1: a malformed time or a non-boolean switch takes the default, as parseAutosendConfig() does — never an error');
select is(pg_temp.d('signout', '2026-07-26 09:00+00', '{}', '{"completed":{"hold_days":"7","not_before":"garbage"}}'), 'hold_expired',
  'D2: a hold_days that is not a JSON number is 14, and an unreadable not_before is ignored');
-- D2, the morning after at 10:00 UK
select is(pg_temp.d('signout', '2026-07-12 08:59+00'), 'not_yet', 'D2: 09:59 BST the morning after is not yet');
select is(pg_temp.d('signout', '2026-07-12 09:00+00'), 'due', 'D2: 10:00 BST (09:00Z) is due');
select is(pg_temp.d('signout', '2026-07-12 09:30+00', '{"last_end":"2026-07-12T06:00Z"}'), 'not_yet',
  'D2: a shift into the morning waits for end + 4 h');
select is(pg_temp.d('signout', '2026-07-12 10:00+00', '{"last_end":"2026-07-12T06:00Z"}'), 'due', '…and goes then');
select is(pg_temp.d('signout', '2026-07-12 09:00+00', '{"undetermined":1}'), 'held_no_checkout',
  'D2: held while a No check-out is unresolved (RULE-02)');
select is(pg_temp.d('signout', '2026-07-26 08:59+00', '{"undetermined":0}'), 'due', 'D2: goes on the first run after, within 14 days');
select is(pg_temp.d('signout', '2026-07-26 09:00+00'), 'hold_expired', 'D2: 14 days after that morning the job stops trying');
select is(pg_temp.d('signout', '2026-07-12 09:00+00', '{"signout_at":"2026-07-11T23:10Z"}'), 'manual_sent',
  'D2: skipped when one was queued after the event ended');
select is(pg_temp.d('signout', '2026-07-12 09:00+00', '{"signout_at":"2026-07-11T18:00Z"}'), 'due',
  'D2: a mid-event copy does not count');
select is(pg_temp.d('signout', '2026-07-12 09:00+00', '{"cancelled":true}'), 'cancelled', 'D2: cancelled event');
select is(pg_temp.d('signout', '2026-07-12 09:00+00', '{"confirmed":0}'), 'no_confirmed_staff', 'D2: nobody confirmed');
select is(pg_temp.d('signout', '2026-07-12 09:00+00', '{"contacts":0}'), 'no_contact_emails', 'D2: no contact emails');
select is(pg_temp.d('signout', '2026-07-12 09:15+00', '{"auto_at":"2026-07-12T09:00:04Z"}'), 'already_sent', 'D2: at most once');
select is(pg_temp.d('signout', '2026-07-12 12:15+00', '{}', '{"completed":{"not_before":"2026-07-12T12:00Z"}}'),
  'before_activation', 'D2: never reaches back past the moment it was switched on');
select is(pg_temp.d('signout', '2026-12-06 10:00+00', '{"event_date":"2026-12-05","first_start":"2026-12-05T18:00Z","last_end":"2026-12-05T23:30Z"}'),
  'due', 'D2 in GMT: 10:00Z is 10:00 UK');
-- The clock-change weekends
select is(pg_temp.d('allocation', '2026-10-24 12:59+00', '{"event_date":"2026-10-25","first_start":"2026-10-25T17:00Z","last_end":"2026-10-25T20:00Z"}'),
  'not_yet', 'October: Sunday event, D1 Sat 24 Oct 14:00 BST…');
select is(pg_temp.d('allocation', '2026-10-24 13:00+00', '{"event_date":"2026-10-25","first_start":"2026-10-25T17:00Z","last_end":"2026-10-25T20:00Z"}'),
  'due', '…is 13:00Z');
select is(pg_temp.d('signout', '2026-10-26 10:00+00', '{"event_date":"2026-10-25","first_start":"2026-10-25T17:00Z","last_end":"2026-10-25T20:00Z"}'),
  'due', 'October: D2 Mon 26 Oct 10:00 GMT is 10:00Z');
select is(pg_temp.d('signout', '2026-10-26 09:59+00', '{"event_date":"2026-10-25","first_start":"2026-10-25T17:00Z","last_end":"2026-10-25T20:00Z"}'),
  'not_yet', '…not 09:00Z');
select is(pg_temp.d('allocation', '2026-03-28 14:00+00', '{"event_date":"2026-03-29","first_start":"2026-03-29T17:00Z","last_end":"2026-03-29T20:00Z"}'),
  'due', 'March: Sunday event, D1 Sat 28 Mar 14:00 GMT is 14:00Z');
select is(pg_temp.d('signout', '2026-03-30 09:00+00', '{"event_date":"2026-03-29","first_start":"2026-03-29T17:00Z","last_end":"2026-03-29T20:00Z"}'),
  'due', 'March: D2 Mon 30 Mar 10:00 BST is 09:00Z');
select is(pg_temp.d('allocation', '2026-10-25 14:00+00',
  '{"event_date":"2026-10-26","first_start":"2026-10-26T18:00Z","last_end":"2026-10-26T23:00Z","manual_at":"2026-10-24T23:00Z"}'),
  'manual_sent', 'the manual cut-off is 00:00 UK on the day before, which on 25 Oct is still BST (24 Oct 23:00Z)');

-- =====================================================================
-- 2 · The settings row
-- =====================================================================
select is((select value->'allocation' from settings where key = 'document_autosend'),
  '{"enabled": true, "time": "14:00"}'::jsonb, 'D1 on, at 14:00');
select ok((select value->'completed' @> '{"enabled": true, "time": "10:00", "hold_days": 14}'
             and (value->'completed'->>'not_before')::timestamptz <= now()
             from settings where key = 'document_autosend'),
  'D2 on, at 10:00, held up to 14 days, and not reaching back before the migration ran');

-- =====================================================================
-- 3 · Who can call the job's functions: the service role, and nobody else
-- =====================================================================
select is_empty(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('event_documents_due', 'event_document_autosend_claim',
                          'record_event_document_autosend', 'queue_event_document_autosend',
                          'event_document_autosend_release', 'event_document_email_payload',
                          'event_document_tally', 'document_autosend_verdict', 'document_autosend_config')
        and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute')
          or not has_function_privilege('service_role', p.oid, 'execute')) $$,
  'the event-documents job''s functions are the service role''s alone: no admin, client or worker session can call one');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format('select event_document_autosend_claim(%L, ''allocation'')', :'event_a'), '42501', null,
  'an office login cannot claim an automatic send');
select throws_ok(format($$ select record_event_document_autosend(%L, 'allocation', %L, 'x.pdf', 1, 1) $$,
                        :'event_a', :'event_a' || '/allocation/x.pdf'), '42501', null,
  'nor record an automatic copy (generated_by would be nobody)');
reset role;

-- =====================================================================
-- 4 · The event: two role sections, three people, Client A
-- =====================================================================
\set ev      '75900000-0000-4000-8000-000000000001'
\set ev_off  '75900000-0000-4000-8000-000000000002'
\set sec_c   '75910000-0000-4000-8000-000000000001'
\set sec_w   '75910000-0000-4000-8000-000000000002'
\set sec_off '75910000-0000-4000-8000-000000000003'
\set r_c     '75920000-0000-4000-8000-000000000001'
\set r_w     '75920000-0000-4000-8000-000000000002'
\set p_1     '75930000-0000-4000-8000-000000000001'
\set p_2     '75930000-0000-4000-8000-000000000002'
\set p_3     '75930000-0000-4000-8000-000000000003'
\set b_1     '75940000-0000-4000-8000-000000000001'
\set b_2     '75940000-0000-4000-8000-000000000002'
\set b_3     '75940000-0000-4000-8000-000000000003'
\set b_off   '75940000-0000-4000-8000-000000000004'

insert into roles (id, name, description, pay_rate) values
  (:'r_c', 'Auto Chef', 'fixture', 19.00),
  (:'r_w', 'Auto Waiting Staff', 'fixture', 14.00);
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'p_1', 97001, 'Luca', 'Moretti', 'a-1@rls.test', '+447700975901', date '1995-01-01', 'compliant'),
  (:'p_2', 97002, 'Aisha', 'Bello', 'a-2@rls.test', '+447700975902', date '1995-01-01', 'compliant'),
  (:'p_3', 97003, 'Tom', 'Reid', 'a-3@rls.test', '+447700975903', date '1995-01-01', 'compliant');
insert into events (id, client_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, po_number) values
  (:'ev', :'clienta', 'Auto Venue', '1 Auto St', st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150,
   'Gala Dinner', date '2026-07-11', true, true, '4471-A'),
  (:'ev_off', :'clienta', 'Auto Venue', '1 Auto St', st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150,
   'Called Off', date '2026-07-11', true, true, null);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'sec_w',   :'ev',     :'r_w', '2026-07-11 16:00+00', '2026-07-11 22:30+00', 2, 0, 22.97, 14.00, 2),
  (:'sec_c',   :'ev',     :'r_c', '2026-07-11 06:00+00', '2026-07-11 14:00+00', 1, 0, 28.00, 19.00, 1),
  (:'sec_off', :'ev_off', :'r_w', '2026-07-11 16:00+00', '2026-07-11 22:30+00', 1, 0, 22.97, 14.00, 1);
-- Inserted as they end the day (worked), as 411 does: the sheet counts
-- confirmed and worked alike, and there is no check-in yet for D1.
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b_1',   :'sec_c',   :'p_1', 'worked',    'manual', '2026-07-01 10:00+00'),
  (:'b_2',   :'sec_w',   :'p_2', 'worked',    'manual', '2026-07-01 10:00+00'),
  (:'b_3',   :'sec_w',   :'p_3', 'worked',    'manual', '2026-07-01 10:00+00'),
  (:'b_off', :'sec_off', :'p_1', 'confirmed', 'manual', '2026-07-01 10:00+00');
update events set cancelled_at = '2026-07-05 10:00+00', cancel_reason = 'client cancelled' where id = :'ev_off';
-- The completed send may reach back to July for this file.
update settings set value = jsonb_set(value, '{completed,not_before}', 'null') where key = 'document_autosend';

select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;

-- =====================================================================
-- 5 · D1 end to end
-- =====================================================================
select is((select verdict from event_documents_due('2026-07-10 12:59+00', :'ev') where kind = 'allocation'), 'not_yet',
  'the day before at 13:59 UK: not yet');
select results_eq(
  format($$ select verdict, confirmed, contacts from event_documents_due('2026-07-10 13:00+00', %L) where kind = 'allocation' $$, :'ev'),
  $$ values ('due'::text, 3, 1) $$,
  'at 14:00 UK: due — three confirmed, one contact email');
select ok(exists (select 1 from event_documents_due('2026-07-10 13:00+00') where event_id = :'ev' and kind = 'allocation'),
  'without an event id, the day-before event is among the candidates');
select is((select verdict from event_documents_due('2026-07-10 13:00+00', :'ev_off') where kind = 'allocation'), 'cancelled',
  'a cancelled event is skipped with its reason (§3.3)');
select ok(not event_document_autosend_claim(:'ev_off', 'allocation', '2026-07-10 13:00+00'),
  'and cannot be claimed');

select ok(event_document_autosend_claim(:'ev', 'allocation', '2026-07-10 13:00+00'), 'the run claims the D1');
select ok(not event_document_autosend_claim(:'ev', 'allocation', '2026-07-10 13:01+00'),
  'a second, overlapping run cannot: the lease is live');

create temp table auto1 as
  select record_event_document_autosend(:'ev', 'allocation', :'ev' || '/allocation/auto.pdf',
                                        'RLS Fixture Client A – Gala Dinner.pdf', 3, 1) as id;
select results_eq(
  $$ select automatic, generated_by from event_documents where id = (select id from auto1) $$,
  $$ values (true, null::uuid) $$,
  'the copy is marked automatic, with nobody as its author');
create temp table q1 as select queue_event_document_autosend((select id from auto1)) as q;
select is((select q->>'key' from q1), 'D1:auto:' || :'ev', 'queued under the event''s automatic D1 key');
select results_eq(
  format($$ select template, recipient_emails from notification_outbox where key = 'D1:auto:%s' $$, :'ev'),
  $$ values ('D1'::text, array['clienta@rls.test']) $$,
  'one D1 email, to the contact emails on the client card');
select is((select payload->>'schedule' from notification_outbox where key = 'D1:auto:' || :'ev'),
  'Auto Chef 07:00 – 15:00 · Auto Waiting Staff 17:00 – 23:30',
  'payload.schedule: each role section''s own window, in sheet order, UK time (RULE-18)');
select ok((select payload ?& array['event', 'client', 'date', 'poNumber', 'poSuffix', 'staffCount', 'attachments', 'documentName']
             and payload->>'documentName' = 'Allocation Timesheet'
             and payload->>'poSuffix' = ' (PO 4471-A)'
             and not payload ? 'totalHours'
             from notification_outbox where key = 'D1:auto:' || :'ev'),
  'every existing key is kept, documentName added; no totalHours on a D1');
select results_eq(
  format($$ select outbox_key is not null, queued_at is not null, lease_until is null from event_document_autosends
             where event_id = %L and kind = 'allocation' $$, :'ev'),
  $$ values (true, true, true) $$,
  'the claim is done: queued, lease released');
select is((select verdict from event_documents_due('2026-07-10 13:15+00', :'ev') where kind = 'allocation'), 'already_sent',
  'the next run sees it already sent');
select ok(not event_document_autosend_claim(:'ev', 'allocation', '2026-07-10 13:15+00'), 'and cannot claim it again');
select is((queue_event_document_autosend((select id from auto1)))->>'queued', 'false',
  'queuing the same automatic copy again sends nothing');

-- =====================================================================
-- 6 · D2: held for a No check-out, then sent with Total Hours
-- =====================================================================
insert into check_logs (booking_id, attempted_at, outcome, check_in_at, check_out_at) values
  (:'b_1', '2026-07-11 06:00+00', 'checked_in', '2026-07-11 06:00+00', '2026-07-11 14:05+00'),
  (:'b_2', '2026-07-11 16:00+00', 'checked_in', '2026-07-11 16:00+00', '2026-07-11 22:42+00'),
  (:'b_3', '2026-07-11 16:00+00', 'checked_in', '2026-07-11 16:00+00', null);
insert into violations (staff_id, booking_id, type) values (:'p_3', :'b_3', 'no_checkout');

select results_eq(
  format($$ select verdict, undetermined from event_documents_due('2026-07-12 09:00+00', %L) where kind = 'signout' $$, :'ev'),
  $$ values ('held_no_checkout'::text, 1) $$,
  'the morning after at 10:00 UK: held — Tom''s No check-out is unresolved (RULE-02)');
select ok(not event_document_autosend_claim(:'ev', 'signout', '2026-07-12 09:00+00'), 'a held D2 cannot be claimed');

update check_logs set manager_finish_at = '2026-07-11 22:30+00' where booking_id = :'b_3';
update violations set resolved = true, resolved_at = now(), resolution_note = 'fixture' where booking_id = :'b_3';

select is((select verdict from event_documents_due('2026-07-13 15:15+00', :'ev') where kind = 'signout'), 'due',
  'resolved two days later: due on the next run');
select ok(event_document_autosend_claim(:'ev', 'signout', '2026-07-13 15:15+00'), 'claimed');
select lives_ok(format($$ select event_document_autosend_release(%L, 'signout', 'Storage refused the PDF') $$, :'ev'),
  'a run that fails gives the claim back…');
select results_eq(
  format($$ select lease_until is null, last_error, attempts from event_document_autosends where event_id = %L and kind = 'signout' $$, :'ev'),
  $$ values (true, 'Storage refused the PDF'::text, 1) $$,
  '…with its reason');
select ok(event_document_autosend_claim(:'ev', 'signout', '2026-07-13 15:30+00'), 'and the next run claims it again');
create temp table auto2 as
  select record_event_document_autosend(:'ev', 'signout', :'ev' || '/signout/auto.pdf',
                                        'RLS Fixture Client A – Gala Dinner.pdf', 3, 1) as id;
select lives_ok(format('select queue_event_document_autosend(%L)', (select id from auto2)), 'the D2 is queued');
-- Luca 06:00–14:00 = 480; Aisha 16:00–22:30 = 390; Tom 16:00–22:30 (manager) = 390 → 1,260 min.
select is((select payload->>'totalHours' from notification_outbox where key = 'D2:auto:' || :'ev'), '21h',
  'payload.totalHours: the whole event, as the PDF''s Total Hours prints it');
select is((select payload->>'documentName' from notification_outbox where key = 'D2:auto:' || :'ev'),
  'Completed Allocation Timesheet', 'payload.documentName');

select throws_ok(format($$ select record_event_document_autosend(%L, 'allocation', %L, 'x.pdf', 1, 1) $$,
                        :'ev_off', :'ev_off' || '/allocation/x.pdf'), 'P0001', 'event_cancelled',
  'no automatic copy is ever recorded for a cancelled event');
select throws_ok(format($$ select record_event_document_autosend(%L, 'signout', %L, 'x.pdf', 1, 1) $$,
                        :'ev', :'ev' || '/signout/again.pdf'), 'P0001', 'autosend_not_claimed',
  'nor one without a live claim');
reset role;

-- =====================================================================
-- 7 · The manual Send: unchanged, with the new payload keys
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table man as
  select record_event_document(:'ev', 'signout', :'ev' || '/signout/manual.pdf', 'M.pdf', 3, 1) as id;
create temp table mq as select queue_event_document_email((select id from man)) as q;
reset role;
select is((select q->>'key' from mq), 'D2:document:' || (select id::text from man), 'the manual key is unchanged');
select results_eq(
  $$ select payload->>'totalHours', payload->>'schedule', payload->>'staffCount'
       from notification_outbox where key = (select q->>'key' from mq) $$,
  $$ values ('21h'::text, 'Auto Chef 07:00 – 15:00 · Auto Waiting Staff 17:00 – 23:30'::text, '3'::text) $$,
  'a manager''s Send carries schedule and totalHours too');
select throws_ok(format('select queue_event_document_autosend(%L)', (select id from man)), '22023', 'not_an_automatic_copy',
  'a manager''s copy never goes under the automatic key');

select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
select is((select verdict from event_documents_due('2026-07-13 16:00+00', :'ev') where kind = 'signout'), 'already_sent',
  'the automatic D2 is final');
reset role;

-- =====================================================================
-- 8 · event_document_autosends: admin reads, client and staff nothing
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from event_document_autosends where event_id = :'ev'), 2, 'the admin reads both automatic sends');
select throws_ok(format($$ update event_document_autosends set queued_at = null where event_id = %L $$, :'ev'),
  '42501', null, 'but cannot rewrite one');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from event_document_autosends), 0, 'the client reads nothing — not even its own event''s (ADR-0026)');
select throws_ok(format($$ insert into event_document_autosends (event_id, kind) values (%L, 'allocation') $$, :'event_a'),
  '42501', null, 'nor writes');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from event_document_autosends), 0, 'a worker reads nothing');
reset role;

set local role anon;
select throws_ok($$ select count(*) from event_document_autosends $$, '42501', null, 'anon has no privilege at all');
reset role;

-- =====================================================================
-- 9 · The schedule row
-- =====================================================================
select results_eq(
  $$ select enabled, cron_expression, edge_path, base_url_source, secret_name
       from job_schedules where job = 'event-documents' $$,
  $$ values (true, '*/15 * * * *'::text, 'api/jobs/event-documents'::text, 'office_base_url'::text, 'rtw_job_secret'::text) $$,
  'every 15 minutes, the Back Office route, rtw-check''s secret — enabled');

-- With the office's two vault secrets (which rtw-check already needs), the
-- installer schedules it — base and bearer read when the command runs.
insert into settings (key, value) values ('edge_base_url', '"https://abcdefghij.supabase.co/functions/v1"')
on conflict (key) do update set value = excluded.value;
delete from vault.secrets where name in ('office_base_url', 'rtw_job_secret');
select vault.create_secret('https://office.autosend759.test', 'office_base_url');
select vault.create_secret('synthetic-759-secret-0123456789abcdef', 'rtw_job_secret');
select install_job_schedules();
select ok(
  (select schedule = '*/15 * * * *'
      and command like '%public.office_base_url() || ''/api/jobs/event-documents''%'
      and command like '%name = ''rtw_job_secret''%'
      and command not like '%service_role_key%'
      and command not like '%https://%'
     from cron.job where jobname = 'event-documents'),
  'pg_cron posts to office_base_url() + /api/jobs/event-documents every 15 minutes with rtw_job_secret, never the service key');

select * from finish();
rollback;
