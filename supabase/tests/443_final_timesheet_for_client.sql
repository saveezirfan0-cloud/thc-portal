-- =====================================================================
-- 443 · The client sees a final sign-out timesheet only (§11.2, §11.4)
--   20260923193100_finance_send_waits_for_p2_and_final_timesheets.sql
--   20261012130000: "final" waits for the last role's end + 4 h, when the
--   last check-out window closes (RULE-02, ADR-0114), not the end itself.
-- =====================================================================
begin;
select plan(7);
\ir _shared/fixtures.psql

-- 20260923193100 paused the Monday finance send until the outbox drain
-- existed; 20260924100000 ships the drain and re-enables it (190, 470).
select ok((select enabled from job_schedules where job = 'finance-reports'),
  'the Monday finance send, paused until the outbox drain existed, is enabled again with it');

-- Fixture Event A is client A's, and its last role ends a week from now.
\set ev :event_a
insert into event_documents (event_id, kind, storage_path, file_name, row_count, page_count, generated_at)
values (:'ev', 'allocation', :'ev' || '/allocation/a.pdf', 'A.pdf', 1, 1, now()),
       (:'ev', 'signout',    :'ev' || '/signout/mid.pdf',  'S.pdf', 1, 1, now());

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select array_agg(kind order by kind) from client_event_documents_v where event_id = :'ev'),
  array['allocation'], 'before the event ends, an unsent sign-out copy is not the client''s timesheet');
reset role;

update event_documents set sent_at = now() where storage_path = :'ev' || '/signout/mid.pdf';
set local role authenticated;
select is((select array_agg(kind order by kind) from client_event_documents_v where event_id = :'ev'),
  array['allocation', 'signout'], 'once the office has sent it, it is');
reset role;

insert into event_documents (event_id, kind, storage_path, file_name, row_count, page_count, generated_at)
values (:'ev', 'signout', :'ev' || '/signout/later-draft.pdf', 'S2.pdf', 1, 1, now() + interval '1 minute');
set local role authenticated;
select is((select storage_path from client_event_documents_v where event_id = :'ev' and kind = 'signout'),
  :'ev' || '/signout/mid.pdf', 'and a newer mid-event download does not replace the sent one');
reset role;

-- ---------------------------------------------------------------------
-- 20261012130000 · an unsent copy is final only from end + 4 h.
-- Fixture Event B is client B's and untouched above; its last role ends
-- eight days from now, so the copies below are drawn "in the future"
-- relative to that end — the view compares the two timestamps only.
-- ---------------------------------------------------------------------
\set evb :event_b
insert into event_documents (event_id, kind, storage_path, file_name, row_count, page_count, generated_at)
select :'evb', 'signout', :'evb' || '/signout/end-plus-1h.pdf', 'B1.pdf', 1, 1, w.ends_at + interval '1 hour'
  from event_windows w where w.event_id = :'evb';

select set_config('request.jwt.claims', json_build_object('sub', :'clientb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_event_documents_v where event_id = :'evb' and kind = 'signout'), 0,
  'a copy drawn at end + 1 h is not served: check-out is still open until end + 4 h, so finish times may be blank');
reset role;

insert into event_documents (event_id, kind, storage_path, file_name, row_count, page_count, generated_at)
select :'evb', 'signout', :'evb' || '/signout/end-plus-4h01.pdf', 'B2.pdf', 1, 1, w.ends_at + interval '4 hours 1 minute'
  from event_windows w where w.event_id = :'evb';

set local role authenticated;
select is((select storage_path from client_event_documents_v where event_id = :'evb' and kind = 'signout'),
  :'evb' || '/signout/end-plus-4h01.pdf',
  'a copy drawn at end + 4 h 01 is the client''s Completed Timesheet');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_event_documents_v where event_id = :'evb'), 0,
  'and client A still reads none of client B''s copies');
reset role;

select * from finish();
rollback;
