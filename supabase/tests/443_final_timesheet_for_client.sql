-- =====================================================================
-- 443 · The client sees a final sign-out timesheet only (§11.2, §11.4)
--   20260923193100_finance_send_waits_for_p2_and_final_timesheets.sql
-- =====================================================================
begin;
select plan(4);
\ir _shared/fixtures.psql

select ok(not (select enabled from job_schedules where job = 'finance-reports'),
  'the Monday finance send is paused until the outbox drain exists');

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

select * from finish();
rollback;
