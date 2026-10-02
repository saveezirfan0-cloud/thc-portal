-- =====================================================================
-- 772 · The Allocation Timesheet is re-sent when the line-up or times
--       change, at most once an hour (ADR-0084)
--   20261002115000_allocation_timesheet_update.sql
--
-- 1. The rule, case by case — the same cases as schedule.test.ts.
-- 2. The signature: what the sheet prints, and only that.
-- 3. End to end: a change after the sheet went is re-sent after the hour,
--    as D1U; a manager's Send while the PDF is drawn stands the job down.
-- 4. Who may call what.
-- =====================================================================
begin;
select plan(45);
\ir _shared/fixtures.psql

create function pg_temp.uk(p_day date, p_time text) returns timestamptz
language sql immutable as $$ select (p_day + p_time::time) at time zone 'Europe/London' $$;

-- Sat 11 Jul 2026 (BST), first shift 07:00 UK (06:00Z); a copy queued
-- Fri 10 Jul 16:00 UK (15:00Z); the sheet changed; three on it, two
-- contacts — unless a case says otherwise.
create function pg_temp.u(p_now timestamptz, p_changes jsonb default '{}'::jsonb,
                          p_cfg jsonb default '{}'::jsonb)
returns text language sql as $$
  select document_update_verdict(
    p_now, p_cfg,
    date '2026-07-11',
    case when p_changes ? 'first_start' then (p_changes->>'first_start')::timestamptz
         else timestamptz '2026-07-11 06:00+00' end,
    coalesce((p_changes->>'cancelled')::boolean, false),
    coalesce((p_changes->>'confirmed')::int, 3),
    coalesce((p_changes->>'contacts')::int, 2),
    case when p_changes ? 'sent_at' then (p_changes->>'sent_at')::timestamptz
         else timestamptz '2026-07-10 15:00+00' end,
    case when p_changes ? 'changed' then (p_changes->>'changed')::boolean else true end,
    coalesce((p_changes->>'attempts')::int, 0))
$$;

-- =====================================================================
-- 1 · The rule
-- =====================================================================
select is(pg_temp.u('2026-07-10 15:59+00'), 'too_soon', 'changed 59 minutes after the last copy: too soon');
select is(pg_temp.u('2026-07-10 16:00+00'), 'due', 'an hour after it: due');
select is(pg_temp.u('2026-07-10 15:30+00', '{}', '{"update":{"gap_minutes":30}}'), 'due', 'the gap comes from settings');
select is(pg_temp.u('2026-07-10 15:30+00', '{}', '{"update":{"gap_minutes":5}}'), 'too_soon',
  'a gap under 15 minutes is ignored: 60');
select is(pg_temp.u('2026-07-10 16:00+00', '{"changed":false}'), 'unchanged', 'nothing printed differs: nothing goes');
select is(pg_temp.u('2026-07-10 16:00+00', '{"changed":null}'), 'no_baseline',
  'a copy from before this change has nothing to compare: nothing goes');
select is(pg_temp.u('2026-07-10 16:00+00', '{"sent_at":null}'), 'not_sent_yet',
  'no copy has gone yet: the 16:00 send does that, not this');
select is(pg_temp.u('2026-07-10 16:00+00', '{"sent_at":"2026-07-09T22:59Z"}'), 'not_sent_yet',
  'a copy from before 00:00 UK the day before is not fresh: the 16:00 send still goes, so this waits');
select is(pg_temp.u('2026-07-10 16:00+00', '{"sent_at":"2026-07-09T23:00Z"}'), 'due',
  'a manager''s copy from 00:00 UK the day before is followed up');
select is(pg_temp.u('2026-07-11 06:00+00', '{"sent_at":"2026-07-11T04:00Z"}'), 'too_late',
  'never once the first shift has started — the sheet is on site');
select is(pg_temp.u('2026-07-10 16:00+00', '{"cancelled":true}'), 'cancelled', 'a cancelled event: nothing (§3.3)');
select is(pg_temp.u('2026-07-10 16:00+00', '{"confirmed":0}'), 'no_confirmed_staff', 'everyone gone: no empty sheet');
select is(pg_temp.u('2026-07-10 16:00+00', '{"contacts":0}'), 'no_contact_emails', 'nobody to send to');
select is(pg_temp.u('2026-07-10 16:00+00', '{"attempts":8}'), 'gave_up', 'eight failed claims on this change: gave up');
select is(pg_temp.u('2026-07-10 16:00+00', '{}', '{"update":{"enabled":false}}'), 'disabled', 'switched off in settings');
select is((select value->'update' from settings where key = 'document_autosend'),
  '{"enabled": true, "gap_minutes": 60}'::jsonb, 'switched on, at most once every 60 minutes');

-- =====================================================================
-- 2 · The signature
-- =====================================================================
\set ev      '77200000-0000-4000-8000-000000000001'
\set ev_old  '77200000-0000-4000-8000-000000000002'
\set sec_w   '77210000-0000-4000-8000-000000000001'
\set sec_old '77210000-0000-4000-8000-000000000002'
\set p_1     '77230000-0000-4000-8000-000000000001'
\set p_2     '77230000-0000-4000-8000-000000000002'
\set p_3     '77230000-0000-4000-8000-000000000003'

select (now() at time zone 'Europe/London')::date as uk_today \gset

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'p_1', 97721, 'Luca',  'Moretti', 'u-1@rls.test', '+447700977201', date '1995-01-01', 'compliant'),
  (:'p_2', 97722, 'Aisha', 'Bello',   'u-2@rls.test', '+447700977202', date '1995-01-01', 'compliant'),
  (:'p_3', 97723, 'Tom',   'Reid',    'u-3@rls.test', '+447700977203', date '1995-01-01', 'compliant');

-- Tomorrow, 18:00–23:00 UK: the day before is today, so a copy queued now
-- is fresh. ev_old is the same, but its only copy went three days ago.
insert into events (id, client_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, po_number)
select x.id::uuid, :'clienta'::uuid, 'Update Venue', '1 Update St',
       st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150, x.title, :'uk_today'::date + 1, true, true, '772-A'
  from (values (:'ev', 'Changing Gala'), (:'ev_old', 'Early Copy')) as x(id, title);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer, charge_rate, pay_rate)
select x.id::uuid, x.ev::uuid, :'role_id'::uuid,
       pg_temp.uk(:'uk_today'::date + 1, '18:00'), pg_temp.uk(:'uk_today'::date + 1, '23:00'), 3, 0, 22.97, 14.00
  from (values (:'sec_w', :'ev'), (:'sec_old', :'ev_old')) as x(id, ev);
insert into bookings (shift_id, staff_id, status, source, confirmed_at) values
  (:'sec_w',   :'p_1', 'confirmed', 'manual', now() - interval '3 days'),
  (:'sec_w',   :'p_2', 'confirmed', 'manual', now() - interval '3 days'),
  (:'sec_old', :'p_3', 'confirmed', 'manual', now() - interval '3 days');

create temp table sig0 as select event_document_signature(:'ev') as s;
update shift_requirements set headcount = 6, buffer = 1 where id = :'sec_w';
update staff set photo_path = :'p_1' || '/selfie-new.jpg' where id = :'p_1';
update clients set contact_emails = contact_emails || array['second@rls.test'] where id = :'clienta';
select is(event_document_signature(:'ev'), (select s from sig0),
  'headcount, buffer, a selfie and the client''s contacts are not printed: the same signature');

-- A manager sends it (the office's Send): the copy carries the signature.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table m1 as
  select record_event_document(:'ev', 'allocation', :'ev' || '/allocation/m1.pdf', 'M1.pdf', 2, 1) as id;
select queue_event_document_email((select id from m1));
create temp table old1 as
  select record_event_document(:'ev_old', 'allocation', :'ev_old' || '/allocation/o1.pdf', 'O1.pdf', 1, 1) as id;
select queue_event_document_email((select id from old1));
select throws_ok(format($$ select set_event_document_signature(%L, 'nope') $$, (select id from m1)),
  '22023', 'bad_signature', 'set_event_document_signature takes an md5 only');
select lives_ok(format($$ select set_event_document_signature(%L, %L) $$, (select id from m1), md5('x')),
  'and is a no-op on a copy already queued');
reset role;
select is((select content_signature from event_documents where id = (select id from m1)), (select s from sig0),
  'the copy is stamped with what it prints, and a queued copy''s stamp never changes');
update event_documents set queued_at = now() - interval '3 days' where id = (select id from old1);

-- =====================================================================
-- 3 · End to end
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
select results_eq(
  format($$ select verdict, changed from event_documents_due(now(), %L) where kind = 'allocation_update' $$, :'ev'),
  $$ values ('unchanged'::text, false) $$, 'just sent, nothing changed');
select is((select verdict from event_documents_due(now(), :'ev_old') where kind = 'allocation_update'), 'not_sent_yet',
  'a copy from three days ago is left to the 16:00 send — the two never go together');
reset role;

-- Tom joins, and Luca's role starts half an hour earlier.
insert into bookings (shift_id, staff_id, status, source, confirmed_at)
values (:'sec_w', :'p_3', 'confirmed', 'manual', now());
set local role service_role;
select results_eq(
  format($$ select verdict, changed from event_documents_due(now(), %L) where kind = 'allocation_update' $$, :'ev'),
  $$ values ('too_soon'::text, true) $$, 'a change inside the hour waits');
select ok(not event_document_update_claim(:'ev'), 'and cannot be claimed');
reset role;

update event_documents set queued_at = now() - interval '61 minutes' where id = (select id from m1);
set local role service_role;
select is((select verdict from event_documents_due(now(), :'ev') where kind = 'allocation_update'), 'due',
  'an hour after the last copy: due');
select ok(event_document_update_claim(:'ev'), 'claimed');
select ok(not event_document_update_claim(:'ev'), 'a second run cannot claim it while the lease is live');
select throws_ok(format($$ select record_event_document_update(%L, 'signout', %L, 'x.pdf', 3, 1) $$,
                        :'ev', :'ev' || '/allocation/x.pdf'), '22023', 'unknown_document_kind',
  'an update is an Allocation Timesheet');
create temp table u1 as
  select record_event_document_update(:'ev', 'allocation', :'ev' || '/allocation/u1.pdf', 'U1.pdf', 3, 1) as id;
create temp table q1 as select queue_event_document_update((select id from u1)) as q;
reset role;
select ok((select automatic and generated_by is null and kind = 'allocation' from event_documents where id = (select id from u1)),
  'the update is an automatic Allocation Timesheet');
select is((select q->>'key' from q1), 'D1U:update:' || (select id::text from u1), 'queued under its own key');
select results_eq(
  format($$ select template, recipient_emails, payload->>'staffCount' from notification_outbox where key = 'D1U:update:%s' $$,
         (select id from u1)),
  $$ values ('D1U'::text, array['clienta@rls.test', 'second@rls.test'], '3'::text) $$,
  'as D1U, the "Updated Allocation Timesheet", to every contact, with the new line-up');
set local role service_role;
select is((select verdict from event_documents_due(now(), :'ev') where kind = 'allocation_update'), 'unchanged',
  'sent: nothing more to send');
reset role;

-- Another change; the job claims and draws, and a manager presses Send
-- before it queues. The client gets the manager's copy and not both.
update shift_requirements set starts_at = starts_at - interval '30 minutes' where id = :'sec_w';
update event_documents set queued_at = now() - interval '61 minutes' where id = (select id from u1);
set local role service_role;
select ok(event_document_update_claim(:'ev'), 'the next change is claimed');
create temp table u2 as
  select record_event_document_update(:'ev', 'allocation', :'ev' || '/allocation/u2.pdf', 'U2.pdf', 3, 1) as id;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table m2 as
  select record_event_document(:'ev', 'allocation', :'ev' || '/allocation/m2.pdf', 'M2.pdf', 3, 1) as id;
select queue_event_document_email((select id from m2));
reset role;
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
create temp table q2 as select queue_event_document_update((select id from u2)) as q;
reset role;
select is((select q->>'skipped' from q2), 'unchanged', 'the job stands down: the manager''s copy already has the change');
select is((select count(*)::int from notification_outbox where key = 'D1U:update:' || (select id::text from u2)), 0,
  'and queues nothing');
select ok((select lease_until is null and last_error = 'skipped: unchanged'
             from event_document_autosends where event_id = :'ev' and kind = 'allocation_update'),
  'its claim is given back with the reason');

-- A run that fails gives its claim back; attempts count against the copy
-- the change is measured from, and a newer copy starts again at one.
update shift_requirements set ends_at = ends_at + interval '30 minutes' where id = :'sec_w';
-- now() is fixed inside this transaction: m2 is put a little after u1,
-- as it really was, so it is the latest copy.
update event_documents set queued_at = now() - interval '60 minutes 30 seconds' where id = (select id from m2);
set local role service_role;
select ok(event_document_update_claim(:'ev'), 'claimed');
select lives_ok(format($$ select event_document_autosend_release(%L, 'allocation_update', 'Storage refused the PDF') $$, :'ev'),
  'released after a failure');
select ok(event_document_update_claim(:'ev'), 'the next run claims it again');
select is((select attempts from event_document_autosends where event_id = :'ev' and kind = 'allocation_update'), 2,
  'two attempts on this change');
reset role;

-- Started: never again.
update shift_requirements set starts_at = now() - interval '1 minute' where id = :'sec_w';
set local role service_role;
select is((select verdict from event_documents_due(now(), :'ev') where kind = 'allocation_update'), 'too_late',
  'once the first shift has started, changes are not re-sent');
reset role;

-- =====================================================================
-- 4 · Who may call what
-- =====================================================================
select ok(
  not has_function_privilege('authenticated', 'event_document_update_claim(uuid,timestamptz,int)', 'execute')
  and not has_function_privilege('authenticated', 'record_event_document_update(uuid,text,text,text,int,int)', 'execute')
  and not has_function_privilege('authenticated', 'queue_event_document_update(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'event_document_signature(uuid)', 'execute')
  and not has_function_privilege('anon', 'event_document_update_claim(uuid,timestamptz,int)', 'execute'),
  'the update''s claim, record, queue and the raw signature are not a session''s to call');
select ok(
  has_function_privilege('service_role', 'event_document_update_claim(uuid,timestamptz,int)', 'execute')
  and has_function_privilege('service_role', 'record_event_document_update(uuid,text,text,text,int,int)', 'execute')
  and has_function_privilege('service_role', 'queue_event_document_update(uuid)', 'execute')
  and has_function_privilege('service_role', 'event_documents_due(timestamptz,uuid)', 'execute'),
  'the job''s service role calls them');
select ok(not has_function_privilege('anon', 'event_document_content_signature(uuid)', 'execute')
      and not has_function_privilege('anon', 'set_event_document_signature(uuid,text)', 'execute'),
  'anon reaches neither signature function');
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select event_document_content_signature(%L) $$, :'ev'), '42501', 'admins_only',
  'a worker cannot read a signature');
reset role;

select * from finish();
rollback;
