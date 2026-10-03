-- =====================================================================
-- 760 · The Allocation Timesheet and the Completed Allocation Timesheet
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
select plan(133);
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
    (p_changes->>'auto_at')::timestamptz,
    coalesce((p_changes->>'attempts')::int, 0),
    coalesce((p_changes->>'unfilled')::int, 0),
    p_changes->>'sent_fp',
    p_changes->>'cur_fp')
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
-- ADR-0084: D1 waits for a full line-up
select is(pg_temp.d('allocation', '2026-07-10 13:00+00', '{"unfilled":1}'), 'not_filled', 'D1: one slot still empty — held');
select is(pg_temp.d('allocation', '2026-07-10 13:00+00', '{"unfilled":3}'), 'not_filled', 'D1: three slots still empty — held');
select is(pg_temp.d('allocation', '2026-07-10 13:00+00', '{"unfilled":0}'), 'due', 'D1: every section at its headcount — due');
select is(pg_temp.d('allocation', '2026-07-10 22:45+00', '{"unfilled":1}'), 'not_filled', 'D1 catch-up: still held while a gap is open…');
select is(pg_temp.d('allocation', '2026-07-10 22:45+00', '{"unfilled":0}'), 'due', '…and goes on the first run after it fills');
select is(pg_temp.d('allocation', '2026-07-11 06:00+00', '{"unfilled":1}'), 'too_late', 'D1: a gap does not outlive the first shift start');
select is(pg_temp.d('allocation', '2026-07-10 12:59:59+00', '{"unfilled":2}'), 'not_yet', 'D1: not_yet wins over a gap');
select is(pg_temp.d('allocation', '2026-07-10 13:00+00', '{"unfilled":2,"confirmed":0}'), 'no_confirmed_staff', 'D1: nobody confirmed wins over a gap');
select is(pg_temp.d('signout', '2026-07-12 09:00+00', '{"unfilled":2}'), 'due', 'D2: a gap never holds the Completed Allocation Timesheet');
-- ADR-0084: an updated copy after a change, once the line-up is firm
select is(pg_temp.d('allocation', '2026-07-10 15:00+00', '{"auto_at":"2026-07-10T13:00:05Z","sent_fp":"a","cur_fp":"b"}'), 'due',
  'D1 updated: a copy went, the sheet now prints something else, the line-up is firm — due');
select is(pg_temp.d('allocation', '2026-07-10 15:00+00', '{"auto_at":"2026-07-10T13:00:05Z","sent_fp":"a","cur_fp":"a"}'), 'already_sent',
  'D1 updated: the sheet is as sent — nothing to send');
select is(pg_temp.d('allocation', '2026-07-10 15:00+00', '{"auto_at":"2026-07-10T13:00:05Z","cur_fp":"b"}'), 'already_sent',
  'D1 updated: a copy from before fingerprints is read as unchanged — switching on never mails every client');
select is(pg_temp.d('allocation', '2026-07-10 15:00+00', '{"auto_at":"2026-07-10T13:00:05Z","sent_fp":"a","cur_fp":"b","unfilled":1}'), 'not_filled',
  'D1 updated: held while a slot is empty or a worker is still Awaiting the change');
select is(pg_temp.d('allocation', '2026-07-10 15:00+00', '{"auto_at":"2026-07-10T13:00:05Z","sent_fp":"a","cur_fp":"b","cancelled":true}'), 'cancelled',
  'D1 updated: never for a cancelled event');
select is(pg_temp.d('allocation', '2026-07-11 06:00+00', '{"auto_at":"2026-07-10T13:00:05Z","sent_fp":"a","cur_fp":"b"}'), 'too_late',
  'D1 updated: not once the first shift has started');
select is(pg_temp.d('allocation', '2026-07-10 08:00+00', '{"manual_at":"2026-07-10T07:00:00Z","sent_fp":"a","cur_fp":"b"}'), 'due',
  'D1 updated: a manager''s fresh copy counts as sent, and no 14:00 to wait for');
select is(pg_temp.d('allocation', '2026-07-10 15:00+00', '{"auto_at":"2026-07-10T13:00:05Z","sent_fp":"a","cur_fp":"b","attempts":8}'), 'gave_up',
  'D1 updated: eight spent claims on this revision — gave_up');
select is(pg_temp.d('signout', '2026-07-12 09:00+00', '{"sent_fp":"a","cur_fp":"b"}'), 'due',
  'D2 does not look at the Allocation Timesheet''s fingerprint');
select is(pg_temp.d('allocation', '2026-07-10 13:00+00', '{"attempts":7}'), 'due', 'D1: seven spent claims, still due');
select is(pg_temp.d('allocation', '2026-07-10 13:00+00', '{"attempts":8}'), 'gave_up', 'D1: eight spent claims — gave_up');
select is(pg_temp.d('signout', '2026-07-12 09:00+00', '{"attempts":8}'), 'gave_up', 'D2: eight spent claims — gave_up');
select is(pg_temp.d('signout', '2026-07-12 09:00+00', '{"attempts":8,"undetermined":1}'), 'held_no_checkout', 'D2: a hold is reported before gave_up');
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
                          'event_document_tally', 'document_autosend_verdict', 'document_autosend_config',
                          'document_hours_label', 'event_document_schedule', 'event_allocation_fingerprint')
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
-- 4 · The events, dated from the real clock
--
-- The claim and the queue judge "now" by the database clock (a caller's
-- p_now is clamped to within five minutes of it), so these events are
-- placed around today in London rather than on fixed dates:
--   ev      tomorrow — two role sections, three confirmed (D1)
--   ev_off  tomorrow — cancelled
--   ev_race tomorrow — a manager presses Send while the job holds a claim
--   ev_past two days ago — worked, one No check-out (D2)
--   ev_gu   two days ago — worked; every attempt to send it fails
-- D1 is set to 00:00 so "the day before" has already begun whatever the
-- time of day this file runs.
-- =====================================================================
select (now() at time zone 'Europe/London')::date as today \gset
create function pg_temp.uk(p_day date, p_time text) returns timestamptz
language sql immutable as $$ select (p_day + p_time::time) at time zone 'Europe/London' $$;

\set ev      '75900000-0000-4000-8000-000000000001'
\set ev_off  '75900000-0000-4000-8000-000000000002'
\set ev_race '75900000-0000-4000-8000-000000000003'
\set ev_past '75900000-0000-4000-8000-000000000004'
\set ev_gu   '75900000-0000-4000-8000-000000000005'
\set ev_gap  '75900000-0000-4000-8000-000000000006'
\set sec_c   '75910000-0000-4000-8000-000000000001'
\set sec_w   '75910000-0000-4000-8000-000000000002'
\set sec_off '75910000-0000-4000-8000-000000000003'
\set sec_r   '75910000-0000-4000-8000-000000000004'
\set sec_pc  '75910000-0000-4000-8000-000000000005'
\set sec_pw  '75910000-0000-4000-8000-000000000006'
\set sec_gu  '75910000-0000-4000-8000-000000000007'
\set sec_gap '75910000-0000-4000-8000-000000000008'
\set r_c     '75920000-0000-4000-8000-000000000001'
\set r_w     '75920000-0000-4000-8000-000000000002'
\set p_1     '75930000-0000-4000-8000-000000000001'
\set p_2     '75930000-0000-4000-8000-000000000002'
\set p_3     '75930000-0000-4000-8000-000000000003'
\set p_4     '75930000-0000-4000-8000-000000000004'
\set p_5     '75930000-0000-4000-8000-000000000005'
\set p_6     '75930000-0000-4000-8000-000000000006'
\set p_7     '75930000-0000-4000-8000-000000000007'
\set p_8     '75930000-0000-4000-8000-000000000008'
\set b_1     '75940000-0000-4000-8000-000000000001'
\set b_2     '75940000-0000-4000-8000-000000000002'
\set b_3     '75940000-0000-4000-8000-000000000003'
\set b_off   '75940000-0000-4000-8000-000000000004'
\set b_r     '75940000-0000-4000-8000-000000000005'
\set b_4     '75940000-0000-4000-8000-000000000006'
\set b_5     '75940000-0000-4000-8000-000000000007'
\set b_6     '75940000-0000-4000-8000-000000000008'
\set b_gu    '75940000-0000-4000-8000-000000000009'
\set b_gap   '75940000-0000-4000-8000-00000000000a'
\set b_gap2  '75940000-0000-4000-8000-00000000000b'

insert into roles (id, name, description, pay_rate) values
  (:'r_c', 'Auto Chef', 'fixture', 19.00),
  (:'r_w', 'Auto Waiting Staff', 'fixture', 14.00);
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'p_1', 97001, 'Luca',  'Moretti', 'a-1@rls.test', '+447700975901', date '1995-01-01', 'compliant'),
  (:'p_2', 97002, 'Aisha', 'Bello',   'a-2@rls.test', '+447700975902', date '1995-01-01', 'compliant'),
  (:'p_3', 97003, 'Tom',   'Reid',    'a-3@rls.test', '+447700975903', date '1995-01-01', 'compliant'),
  (:'p_4', 97004, 'Daniel','Okafor',  'a-4@rls.test', '+447700975904', date '1995-01-01', 'compliant'),
  (:'p_5', 97005, 'Priya', 'Sharma',  'a-5@rls.test', '+447700975905', date '1995-01-01', 'compliant'),
  (:'p_6', 97006, 'Ben',   'Ashworth','a-6@rls.test', '+447700975906', date '1995-01-01', 'compliant'),
  (:'p_7', 97007, 'Isla',  'Thornton','a-7@rls.test', '+447700975907', date '1995-01-01', 'compliant'),
  (:'p_8', 97008, 'Hugo',  'Ferreira','a-8@rls.test', '+447700975908', date '1995-01-01', 'compliant');

insert into events (id, client_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, po_number)
select x.id::uuid, :'clienta'::uuid, 'Auto Venue', '1 Auto St',
       st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150, x.title, x.day, true, true, x.po
  from (values (:'ev',      'Gala Dinner',  :'today'::date + 1, '4471-A'),
               (:'ev_off',  'Called Off',   :'today'::date + 1, null),
               (:'ev_race', 'Race Lunch',   :'today'::date + 1, null),
               (:'ev_past', 'Past Gala',    :'today'::date - 2, '4471-B'),
               (:'ev_gu',   'Given Up',     :'today'::date - 2, null),
               (:'ev_gap',  'Half Staffed', :'today'::date + 1, null)) as x(id, title, day, po);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour)
select x.id::uuid, x.ev::uuid, x.role::uuid, pg_temp.uk(x.day, x.s), pg_temp.uk(x.day, x.e), x.n, 0, 22.97, 14.00, x.n
  from (values (:'sec_w',   :'ev',      :'r_w', :'today'::date + 1, '17:00', '23:30', 2),
               (:'sec_c',   :'ev',      :'r_c', :'today'::date + 1, '07:00', '15:00', 1),
               (:'sec_off', :'ev_off',  :'r_w', :'today'::date + 1, '17:00', '23:30', 1),
               (:'sec_r',   :'ev_race', :'r_w', :'today'::date + 1, '08:00', '12:00', 1),
               (:'sec_pw',  :'ev_past', :'r_w', :'today'::date - 2, '17:00', '23:30', 2),
               (:'sec_pc',  :'ev_past', :'r_c', :'today'::date - 2, '07:00', '15:00', 1),
               (:'sec_gu',  :'ev_gu',   :'r_w', :'today'::date - 2, '09:00', '13:00', 1),
               -- ADR-0084: two slots, one confirmed — the line-up has a gap.
               (:'sec_gap', :'ev_gap',  :'r_w', :'today'::date + 1, '18:00', '23:30', 2))
       as x(id, ev, role, day, s, e, n);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b_1',   :'sec_c',   :'p_1', 'confirmed', 'manual', now() - interval '7 days'),
  (:'b_2',   :'sec_w',   :'p_2', 'confirmed', 'manual', now() - interval '7 days'),
  (:'b_3',   :'sec_w',   :'p_3', 'confirmed', 'manual', now() - interval '7 days'),
  (:'b_off', :'sec_off', :'p_8', 'confirmed', 'manual', now() - interval '7 days'),
  (:'b_r',   :'sec_r',   :'p_8', 'confirmed', 'manual', now() - interval '7 days'),
  -- As they end the day, as 411 inserts them.
  (:'b_4',   :'sec_pc',  :'p_4', 'worked',    'manual', now() - interval '9 days'),
  (:'b_5',   :'sec_pw',  :'p_5', 'worked',    'manual', now() - interval '9 days'),
  (:'b_6',   :'sec_pw',  :'p_6', 'worked',    'manual', now() - interval '9 days'),
  (:'b_gu',  :'sec_gu',  :'p_7', 'worked',    'manual', now() - interval '9 days'),
  (:'b_gap', :'sec_gap', :'p_7', 'confirmed', 'manual', now() - interval '7 days');
update events set cancelled_at = now() - interval '1 day', cancel_reason = 'client cancelled' where id = :'ev_off';

insert into check_logs (booking_id, attempted_at, outcome, check_in_at, check_out_at) values
  (:'b_4',  pg_temp.uk(:'today'::date - 2, '07:00'), 'checked_in', pg_temp.uk(:'today'::date - 2, '07:00'), pg_temp.uk(:'today'::date - 2, '15:05')),
  (:'b_5',  pg_temp.uk(:'today'::date - 2, '17:00'), 'checked_in', pg_temp.uk(:'today'::date - 2, '17:00'), pg_temp.uk(:'today'::date - 2, '23:42')),
  (:'b_6',  pg_temp.uk(:'today'::date - 2, '17:00'), 'checked_in', pg_temp.uk(:'today'::date - 2, '17:00'), null),
  (:'b_gu', pg_temp.uk(:'today'::date - 2, '09:00'), 'checked_in', pg_temp.uk(:'today'::date - 2, '09:00'), pg_temp.uk(:'today'::date - 2, '13:00'));
insert into violations (staff_id, booking_id, type) values (:'p_6', :'b_6', 'no_checkout');

-- D1 at 00:00 (see above); D2 at its default 10:00 — yesterday morning for
-- ev_past; and this file may reach back before the migration ran.
update settings
   set value = jsonb_set(jsonb_set(value, '{allocation,time}', '"00:00"'), '{completed,not_before}', 'null')
 where key = 'document_autosend';

select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;

-- =====================================================================
-- 5 · D1 end to end
-- =====================================================================
select is((select verdict from event_documents_due(pg_temp.uk(:'today'::date, '00:00') - interval '1 second', :'ev')
            where kind = 'allocation'), 'not_yet',
  'a second before the day before begins: not yet');
select results_eq(
  format($$ select verdict, confirmed, contacts, unfilled from event_documents_due(now(), %L) where kind = 'allocation' $$, :'ev'),
  $$ values ('due'::text, 3, 1, 0) $$,
  'on the day before: due — three confirmed, one contact email, every section at its headcount');
select results_eq(
  format($$ select verdict, confirmed, unfilled from event_documents_due(now(), %L) where kind = 'allocation' $$, :'ev_gap'),
  $$ values ('not_filled'::text, 1, 1) $$,
  'one of two slots confirmed: held as not_filled, one slot unfilled (ADR-0084)');
select ok(not event_document_autosend_claim(:'ev_gap', 'allocation'), 'and a half-staffed event cannot be claimed');
-- The second slot is taken, but the office has since changed the shift under
-- that worker (§3.5): confirmed, Awaiting — not yet a firm slot.
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at, reconfirm_required, reconfirm_reason)
values (:'b_gap2', :'sec_gap', :'p_1', 'confirmed', 'manual', now() - interval '7 days', true, 'Start time moved by the office');
select results_eq(
  format($$ select verdict, confirmed, unfilled from event_documents_due(now(), %L) where kind = 'allocation' $$, :'ev_gap'),
  $$ values ('not_filled'::text, 2, 1) $$,
  'two confirmed, one of them Awaiting a changed time: still held, the Awaiting slot is not firm (ADR-0084)');
update bookings set reconfirm_required = false, reconfirm_reason = null where id = :'b_gap2';
select results_eq(
  format($$ select verdict, unfilled from event_documents_due(now(), %L) where kind = 'allocation' $$, :'ev_gap'),
  $$ values ('due'::text, 0) $$,
  'the worker confirms the new time (reconfirm_booking clears the flag): the line-up is firm, due');
-- ADR-0084 end to end on ev_gap: first copy, a change, the updated copy.
select ok(event_document_autosend_claim(:'ev_gap', 'allocation'), 'ev_gap: the first copy is claimed…');
create temp table gap0 as
  select record_event_document_autosend(:'ev_gap', 'allocation', :'ev_gap' || '/allocation/auto0.pdf',
                                        'Half Staffed.pdf', 2, 1) as id;
create temp table gq0 as select queue_event_document_autosend((select id from gap0)) as q;
select results_eq($$ select q->>'key', q->>'queued' from gq0 $$,
  format($$ values ('D1:auto:%s'::text, 'true'::text) $$, :'ev_gap'),
  '…and queued under the revision-0 key');
select is((select verdict from event_documents_due(now(), :'ev_gap') where kind = 'allocation'), 'already_sent',
  'the sheet is as sent: already_sent');
update events set po_number = '4471-G2' where id = :'ev_gap';
select is((select verdict from event_documents_due(now(), :'ev_gap') where kind = 'allocation'), 'due',
  'the PO number on the sheet changed and the line-up is firm: the updated copy is due');
select ok(event_document_autosend_claim(:'ev_gap', 'allocation'), 'it is claimed as the next revision…');
create temp table gap1 as
  select record_event_document_autosend(:'ev_gap', 'allocation', :'ev_gap' || '/allocation/auto1.pdf',
                                        'Half Staffed (2).pdf', 2, 1) as id;
create temp table gq1 as select queue_event_document_autosend((select id from gap1)) as q;
select results_eq($$ select q->>'key', q->>'queued', q->>'revision' from gq1 $$,
  format($$ values ('D1:auto:%s:1'::text, 'true'::text, '1'::text) $$, :'ev_gap'),
  '…and queued under its own key, revision 1');
select ok((select payload->>'updated' = 'true' from notification_outbox where key = 'D1:auto:' || :'ev_gap' || ':1')
          and not (select payload ? 'updated' from notification_outbox where key = 'D1:auto:' || :'ev_gap'),
  'only the updated copy''s payload says updated');
select is((select verdict from event_documents_due(now(), :'ev_gap') where kind = 'allocation'), 'already_sent',
  'the updated copy is the new baseline: nothing more to send until the sheet changes again');
select is((select array_agg(revision order by revision) from event_document_autosends
            where event_id = :'ev_gap' and kind = 'allocation' and queued_at is not null), array[0, 1],
  'two automatic sends on record, one per revision');
select ok((select d.fingerprint = event_allocation_fingerprint(:'ev_gap') from event_documents d where d.id = (select id from gap1))
          and (select d.fingerprint <> event_allocation_fingerprint(:'ev_gap') from event_documents d where d.id = (select id from gap0)),
  'each copy stored the fingerprint it was drawn at: the first is now out of date, the second is current');
select ok(exists (select 1 from event_documents_due(now()) where event_id = :'ev' and kind = 'allocation'),
  'without an event id, tomorrow''s event is among the candidates');
select is((select verdict from event_documents_due(now(), :'ev_off') where kind = 'allocation'), 'cancelled',
  'a cancelled event is skipped with its reason (§3.3)');
select ok(not event_document_autosend_claim(:'ev_off', 'allocation'), 'and cannot be claimed');

select ok(event_document_autosend_claim(:'ev', 'allocation', now() + interval '1 year'),
  'the run claims the D1 (a p_now a year out is clamped to the database clock)…');
select ok((select lease_until <= now() + interval '15 minutes' from event_document_autosends
            where event_id = :'ev' and kind = 'allocation'),
  '…so the lease is ten minutes from now, not from next year');
select ok(not event_document_autosend_claim(:'ev', 'allocation'),
  'a second, overlapping run cannot: the lease is live');
select is((select attempts from event_documents_due(now(), :'ev') where kind = 'allocation'), 0,
  'a live claim is not a spent one');

create temp table auto1 as
  select record_event_document_autosend(:'ev', 'allocation', :'ev' || '/allocation/auto.pdf',
                                        'RLS Fixture Client A – Gala Dinner.pdf', 3, 1) as id;
select results_eq(
  $$ select automatic, generated_by from event_documents where id = (select id from auto1) $$,
  $$ values (true, null::uuid) $$,
  'the copy is marked automatic, with nobody as its author');
create temp table q1 as select queue_event_document_autosend((select id from auto1)) as q;
select results_eq($$ select q->>'key', q->>'queued' from q1 $$,
  format($$ values ('D1:auto:%s'::text, 'true'::text) $$, :'ev'),
  'queued under the event''s automatic D1 key');
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
select is((select verdict from event_documents_due(now(), :'ev') where kind = 'allocation'), 'already_sent',
  'the next run sees it already sent');
select ok(not event_document_autosend_claim(:'ev', 'allocation'), 'and cannot claim it again');
select is((queue_event_document_autosend((select id from auto1)))->>'queued', 'false',
  'queuing the same automatic copy again sends nothing');

-- =====================================================================
-- 6 · The race: a manager presses Send while the job holds the claim
-- =====================================================================
select ok(event_document_autosend_claim(:'ev_race', 'allocation'), 'the job claims the race event''s D1');
create temp table auto_r as
  select record_event_document_autosend(:'ev_race', 'allocation', :'ev_race' || '/allocation/auto.pdf',
                                        'RLS Fixture Client A – Race Lunch.pdf', 1, 1) as id;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table man_r as
  select record_event_document(:'ev_race', 'allocation', :'ev_race' || '/allocation/manual.pdf', 'M.pdf', 1, 1) as id;
select lives_ok(format('select queue_event_document_email(%L)', (select id from man_r)),
  'meanwhile a manager sends the Allocation Timesheet by hand (same advisory lock)');
reset role;
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
create temp table q_r as select queue_event_document_autosend((select id from auto_r)) as q;
select results_eq($$ select q->>'queued', q->>'skipped' from q_r $$,
  $$ values ('false'::text, 'manual_sent'::text) $$,
  'the job re-checks under the lock and stands down: queued = false, manual_sent');
select is((select count(*)::int from notification_outbox
            where key = 'D1:auto:' || :'ev_race'
               or key in (select outbox_key from event_documents where event_id = :'ev_race' and outbox_key is not null)),
  1, 'one D1 email for the event, the manager''s — never two');
select results_eq(
  format($$ select queued_at is null, lease_until is null, last_error from event_document_autosends
             where event_id = %L and kind = 'allocation' $$, :'ev_race'),
  $$ values (true, true, 'skipped: manual_sent'::text) $$,
  'the claim is released with the reason, and nothing is marked sent');
select is((select verdict from event_documents_due(now(), :'ev_race') where kind = 'allocation'), 'manual_sent',
  'later runs see the manager''s copy and leave it');

-- =====================================================================
-- 7 · D2: held for a No check-out, then sent with Total Hours
-- =====================================================================
select results_eq(
  format($$ select verdict, undetermined from event_documents_due(now(), %L) where kind = 'signout' $$, :'ev_past'),
  $$ values ('held_no_checkout'::text, 1) $$,
  'the morning after has passed, but it is held — a No check-out is unresolved (RULE-02)');
select ok(not event_document_autosend_claim(:'ev_past', 'signout'), 'a held D2 cannot be claimed');

update check_logs set manager_finish_at = pg_temp.uk(:'today'::date - 2, '23:30') where booking_id = :'b_6';
update violations set resolved = true, resolved_at = now(), resolution_note = 'fixture' where booking_id = :'b_6';

select is((select verdict from event_documents_due(now(), :'ev_past') where kind = 'signout'), 'due',
  'resolved: due on the next run');
select ok(event_document_autosend_claim(:'ev_past', 'signout'), 'claimed');
select lives_ok(format($$ select event_document_autosend_release(%L, 'signout', 'Storage refused the PDF') $$, :'ev_past'),
  'a run that fails gives the claim back…');
select results_eq(
  format($$ select lease_until is null, last_error, attempts from event_document_autosends where event_id = %L and kind = 'signout' $$, :'ev_past'),
  $$ values (true, 'Storage refused the PDF'::text, 1) $$,
  '…with its reason, one claim spent');
select throws_ok(format($$ select record_event_document_autosend(%L, 'signout', %L, 'x.pdf', 1, 1) $$,
                        :'ev_past', :'ev_past' || '/signout/late.pdf'), 'P0001', 'autosend_not_claimed',
  'a run that lost its lease cannot record a copy');
select ok(event_document_autosend_claim(:'ev_past', 'signout'), 'the next run claims it again');
create temp table auto2 as
  select record_event_document_autosend(:'ev_past', 'signout', :'ev_past' || '/signout/auto.pdf',
                                        'RLS Fixture Client A – Past Gala.pdf', 3, 1) as id;
select is((queue_event_document_autosend((select id from auto2)))->>'queued', 'true', 'the D2 is queued');
-- 07:00–15:00 = 480; 17:00–23:30 = 390; 17:00–23:30 (manager) = 390 → 1,260 min.
select is((select payload->>'totalHours' from notification_outbox where key = 'D2:auto:' || :'ev_past'), '21h',
  'payload.totalHours: the whole event, as the PDF''s Total Hours prints it');
select is((select payload->>'documentName' from notification_outbox where key = 'D2:auto:' || :'ev_past'),
  'Completed Allocation Timesheet', 'payload.documentName');

select throws_ok(format($$ select record_event_document_autosend(%L, 'allocation', %L, 'x.pdf', 1, 1) $$,
                        :'ev_off', :'ev_off' || '/allocation/x.pdf'), 'P0001', 'event_cancelled',
  'no automatic copy is ever recorded for a cancelled event');
select throws_ok(format($$ select record_event_document_autosend(%L, 'signout', %L, 'x.pdf', 1, 1) $$,
                        :'ev_past', :'ev_past' || '/signout/again.pdf'), 'P0001', 'autosend_not_claimed',
  'nor one without a live claim');

-- =====================================================================
-- 8 · The ceiling: eight claims, then gave_up
-- =====================================================================
select set_config('t759.ev_gu', :'ev_gu', true);
create temp table cycles (n int, claimed boolean);
do $$
begin
  for i in 1..8 loop
    insert into cycles values (i, event_document_autosend_claim(current_setting('t759.ev_gu')::uuid, 'signout'));
    perform event_document_autosend_release(current_setting('t759.ev_gu')::uuid, 'signout', 'boom ' || i);
  end loop;
end $$;
select is((select count(*)::int from cycles where claimed), 8, 'eight claim / fail / release cycles each got their claim');
select ok(not event_document_autosend_claim(:'ev_gu', 'signout'), 'the ninth claim is refused');
select results_eq(
  format($$ select verdict, attempts from event_documents_due(now(), %L) where kind = 'signout' $$, :'ev_gu'),
  $$ values ('gave_up'::text, 8) $$,
  'and the verdict says gave_up: the office sends it by hand');
select is((select count(*)::int from notification_outbox where key = 'D2:auto:' || :'ev_gu'), 0, 'nothing was sent');
reset role;

-- =====================================================================
-- 9 · The manual Send: unchanged, with the new payload keys
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table man as
  select record_event_document(:'ev_past', 'signout', :'ev_past' || '/signout/manual.pdf', 'M.pdf', 3, 1) as id;
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
select is((select verdict from event_documents_due(now(), :'ev_past') where kind = 'signout'), 'already_sent',
  'the automatic D2 is final');
reset role;

-- =====================================================================
-- 10 · event_document_autosends: admin reads, client and staff nothing
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from event_document_autosends where event_id in (:'ev', :'ev_past')), 2,
  'the admin reads the automatic sends');
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
-- 11 · The schedule row
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
