-- =====================================================================
-- 743 · Record history (20260930210300)
--
-- admin_record_history(entity, id) is /activity cut down to one record,
-- plus the rows that belong to it: a worker's documents, bookings and
-- Do-not-return entries; an event's bookings; a client's event
-- cancellations, Do-not-return entries and portal logins. Admin only —
-- a worker and a client meet the same refusal /activity gives them.
-- =====================================================================
begin;
select plan(25);
\ir _shared/fixtures.psql

\set gone_doc '65300000-0000-4000-8000-000000000001'

-- Rows written as the definer functions write them. Every assertion below
-- addresses them by the fixture ids, never by global counts: the fixture
-- inserts themselves may have fired triggers that audit too.
insert into audit_log (actor, action, entity, entity_id, data) values
  (:'admin_uid', 'document.uploaded', 'compliance_docs', :'doc_a',
     jsonb_build_object('staffId', :'staffa', 'docType', 'passport')),
  -- a document §1.7 has since deleted: only data.staffId still links it
  (null, 'rtw.verified', 'compliance_docs', :'gone_doc',
     jsonb_build_object('staffId', :'staffa', 'docType', 'share_code')),
  (:'admin_uid', 'booking.manual_invite', 'booking', :'booking_a',
     jsonb_build_object('staffId', :'staffa', 'shiftId', :'shift_a')),
  (:'admin_uid', 'booking.manual_invite', 'booking', :'booking_b',
     jsonb_build_object('staffId', :'staffb', 'shiftId', :'shift_b')),
  (:'admin_uid', 'do_not_return_on', 'client_qualification', :'qual_a',
     jsonb_build_object('staffId', :'staffa', 'clientId', :'clienta', 'reason', 'h743')),
  (:'admin_uid', 'block_manual', 'staff', :'staffb', jsonb_build_object('reason', 'h743 other worker')),
  (:'admin_uid', 'account.invited', 'account', :'clienta_uid',
     jsonb_build_object('role', 'client', 'clientId', :'clienta')),
  (:'admin_uid', 'account.invited', 'account', :'clientb_uid',
     jsonb_build_object('role', 'client', 'clientId', :'clientb')),
  (:'admin_uid', 'event.cancelled', 'event', :'event_b', jsonb_build_object('reason', 'h743 B')),
  (:'admin_uid', 'event.cancelled', 'event', :'event_a', jsonb_build_object('reason', 'h743 A'));

-- ---------------------------------------------------------------------
-- 1 · Grants
-- ---------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'admin_record_history(text,uuid,int,bigint)', 'execute'),
  'anon cannot execute admin_record_history');
select ok(not has_function_privilege('public', 'admin_record_history(text,uuid,int,bigint)', 'execute'),
  'PUBLIC holds no EXECUTE on it');
select ok(has_function_privilege('authenticated', 'admin_record_history(text,uuid,int,bigint)', 'execute'),
  'a signed-in user may call it — the body decides who gets rows');
select ok((select prosecdef and proconfig @> array['search_path=public'] from pg_proc
            where oid = 'admin_record_history(text,uuid,int,bigint)'::regprocedure),
  'security definer with a pinned search_path');

-- ---------------------------------------------------------------------
-- 2 · Only an admin reads it
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format('select * from admin_record_history(%L, %L)', 'staff', :'staffa'),
  '42501', 'not_authorised', 'a worker cannot read even their own record''s history');
select throws_ok(format('select * from admin_record_history(%L, %L)', 'event', :'event_a'),
  '42501', 'not_authorised', 'nor an event''s');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select throws_ok(format('select * from admin_record_history(%L, %L)', 'client', :'clienta'),
  '42501', 'not_authorised', 'a client cannot read their own client record''s history');
select throws_ok(format('select * from admin_record_history(%L, %L)', 'event', :'event_a'),
  '42501', 'not_authorised', 'nor the history of their own event');

-- ---------------------------------------------------------------------
-- 3 · A worker's history: own rows, documents, bookings, Do not return
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);

select ok(exists (select 1 from admin_record_history('staff', :'staffa')
                   where entity = 'staff' and action = 'rls_fixture_probe'),
  'staff: the rows written against the staff record');
select ok(exists (select 1 from admin_record_history('staff', :'staffa')
                   where entity = 'compliance_docs' and entity_id = :'doc_a'),
  'staff: their documents'' rows');
select ok(exists (select 1 from admin_record_history('staff', :'staffa')
                   where entity = 'compliance_docs' and entity_id = :'gone_doc'),
  'staff: a deleted document''s row, still linked by data.staffId');
select is((select entity_label from admin_record_history('staff', :'staffa')
            where entity = 'booking' and entity_id = :'booking_a' and action = 'booking.manual_invite'),
  'Staff Alpha · Fixture Event A', 'staff: their bookings'' rows, labelled worker · event');
select is((select entity_label from admin_record_history('staff', :'staffa')
            where entity = 'client_qualification'),
  'Staff Alpha · RLS Fixture Client A · RLS Fixture Role', 'staff: their Do-not-return entries, labelled');
select is_empty(format($$ select 1 from admin_record_history('staff', %L)
                           where entity_id in (%L, %L, %L) $$, :'staffa', :'staffb', :'booking_b', :'event_a'),
  'staff: nothing about another worker, their booking, or an event as a whole');

-- ---------------------------------------------------------------------
-- 4 · An event's history: its own rows and its bookings
-- ---------------------------------------------------------------------
select ok(exists (select 1 from admin_record_history('event', :'event_a')
                   where action = 'event.cancelled' and data ->> 'reason' = 'h743 A'),
  'event: its cancellation');
select ok(exists (select 1 from admin_record_history('event', :'event_a')
                   where entity = 'booking' and entity_id = :'booking_a'),
  'event: the bookings on its role sections');
select is_empty(format($$ select 1 from admin_record_history('event', %L)
                           where entity_id in (%L, %L, %L) or entity in ('staff', 'compliance_docs') $$,
                       :'event_a', :'event_b', :'booking_b', :'staffa'),
  'event: nothing from another event, and no worker-level rows');

-- ---------------------------------------------------------------------
-- 5 · A client's history: event cancellations, Do not return, logins
-- ---------------------------------------------------------------------
select ok(exists (select 1 from admin_record_history('client', :'clienta')
                   where action = 'event.cancelled' and entity_id = :'event_a'
                     and entity_label = 'Fixture Event A'),
  'client: its events'' cancellations, labelled with the event');
select ok(exists (select 1 from admin_record_history('client', :'clienta')
                   where action = 'do_not_return_on' and entity_id = :'qual_a'),
  'client: Do not return for one of its workers');
select ok(exists (select 1 from admin_record_history('client', :'clienta')
                   where action = 'account.invited' and entity_id = :'clienta_uid'),
  'client: its Client Portal logins');
select is_empty(format($$ select 1 from admin_record_history('client', %L)
                           where entity = 'booking' or entity_id in (%L, %L) $$,
                       :'clienta', :'event_b', :'clientb_uid'),
  'client: no bookings, and nothing of another client''s');

-- ---------------------------------------------------------------------
-- 6 · Shape: newest first, the actor named, keyset paging
-- ---------------------------------------------------------------------
select is((select array_agg(id) = array_agg(id order by id desc) from admin_record_history('staff', :'staffa')),
  true, 'newest first');
select is((select actor_name from admin_record_history('client', :'clienta') where action = 'event.cancelled'),
  'Gisela M.', 'the actor is named, as on /activity');
select is((select count(*)::int from admin_record_history('staff', :'staffa', 2)), 2,
  'p_limit caps the page');
select is_empty(format($$ select 1 from admin_record_history('staff', %L, 100,
                             (select min(id) from admin_record_history('staff', %L, 2)))
                           where id >= (select min(id) from admin_record_history('staff', %L, 2)) $$,
                       :'staffa', :'staffa', :'staffa'),
  'p_before pages strictly older than the last row seen');

select * from finish();
rollback;
