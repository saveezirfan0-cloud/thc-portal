-- =====================================================================
-- 790 · client_events_v.cancelled_at and the customer's own feedback on
--       client_lineup_v (§11.1, §11.2, §11.5; ADR-0004, ADR-0026)
--       — 20261012130000_client_views_cancelled_feedback_final_copy.sql
--
-- 050 owns the column lists; this file holds the behaviour of the three
-- new columns and re-pins the ADR-0004 shape of the two restated views,
-- because a `create or replace` is exactly where a reloption or a grant
-- could be lost.
-- =====================================================================
begin;
select plan(17);
\ir _shared/fixtures.psql

-- ---------------------------------------------------------------------
-- 1 · Shape: still owner rights, still a barrier, still select-only.
-- ---------------------------------------------------------------------
select ok(not (coalesce((select reloptions from pg_class where relname = 'client_events_v'), '{}') @> '{security_invoker=true}')
          and (coalesce((select reloptions from pg_class where relname = 'client_events_v'), '{}') @> '{security_barrier=true}'),
  'client_events_v is still an owner-rights security barrier view after the restatement (ADR-0004)');
select ok(not (coalesce((select reloptions from pg_class where relname = 'client_lineup_v'), '{}') @> '{security_invoker=true}')
          and (coalesce((select reloptions from pg_class where relname = 'client_lineup_v'), '{}') @> '{security_barrier=true}'),
  'client_lineup_v is still an owner-rights security barrier view after the restatement (ADR-0004)');
select ok(pg_get_viewdef('client_events_v'::regclass) ~ 'client_portal_visible'
          and pg_get_viewdef('client_lineup_v'::regclass) ~ 'client_portal_visible',
  'both views still carry client_portal_visible() in their own bodies');
select ok(not has_table_privilege('anon', 'client_events_v', 'select')
          and not has_table_privilege('anon', 'client_lineup_v', 'select')
          and not has_table_privilege('authenticated', 'client_events_v', 'insert')
          and not has_table_privilege('authenticated', 'client_events_v', 'update')
          and not has_table_privilege('authenticated', 'client_lineup_v', 'update')
          and not has_table_privilege('authenticated', 'client_lineup_v', 'delete'),
  'SELECT to authenticated and nothing else to anybody (ADR-0004 rule (d))');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and (policyname ilike '%client%' or qual ilike '%''client''%' or with_check ilike '%''client''%')
      and tablename in ('events', 'feedback', 'bookings', 'shift_requirements', 'roles', 'staff')),
  0,
  'the new columns were not bought with a client policy on events, feedback or the four closed tables (ADR-0026)');

-- ---------------------------------------------------------------------
-- 2 · cancelled_at
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select cancelled_at from client_events_v where id = :'event_a'), null::timestamptz,
  'a live event carries no cancelled_at');
reset role;

update events set cancelled_at = '2026-10-01 09:30+00', cancel_reason = 'Office-only note: budget cut'
 where id = :'event_a';

set local role authenticated;
select is((select cancelled_at from client_events_v where id = :'event_a'), '2026-10-01 09:30+00'::timestamptz,
  '§11.1 a cancelled event carries the moment it was cancelled, for "cancelled <date>" under the greyed row');
select is((select status::text from client_events_v where id = :'event_a'), 'cancelled',
  'and its status says so');
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name = 'client_events_v'
              and column_name in ('cancel_reason', 'cancelled_by')), 0,
  'the reason stays the office''s own: no cancel_reason column on the view');
reset role;
update events set cancelled_at = null, cancel_reason = null where id = :'event_a';

-- ---------------------------------------------------------------------
-- 3 · feedback_rating / feedback_sent_at: the caller's own entry only
--     The fixtures give client A an entry of 5 for staff A on event A,
--     and client B an entry of 4 for staff B on event B.
-- ---------------------------------------------------------------------
update feedback set created_at = '2026-10-02 18:45+00' where id = :'feedback_a';

-- The office's own entry on the same worker and event (§9.10). It must
-- never surface through the client's view.
insert into feedback (author_kind, author_id, staff_id, event_id, rating, text, created_at)
values ('office', :'admin_uid', :'staffa', :'event_a', 2, 'Office: late back from break', '2026-10-03 09:00+00');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select feedback_rating from client_lineup_v where booking_id = :'booking_a'), 5,
  '§11.2 the customer sees the stars it sent');
select is((select feedback_sent_at from client_lineup_v where booking_id = :'booking_a'), '2026-10-02 18:45+00'::timestamptz,
  '§11.2 and when it sent them — the client entry''s time, not the office entry''s');
select is((select count(*)::int from client_lineup_v where booking_id = :'booking_a'), 1,
  'the office''s entry on the same worker adds no second row');
select is((select count(*)::int from client_lineup_v where booking_id = :'booking_b'), 0,
  'client B''s booking, and so client B''s entry, is not reachable by client A');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clientb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq(
  $$ select feedback_rating, feedback_sent_at is not null from client_lineup_v $$,
  $$ values (4, true) $$,
  'client B sees exactly one row, its own booking, with its own entry of 4');
reset role;

-- With the client entry gone, only the office entry remains: nothing shows.
delete from feedback where id = :'feedback_a';
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq(
  $$ select feedback_given, feedback_rating, feedback_sent_at from client_lineup_v where booking_id = '0a0a0a0a-0000-4000-8000-000000000001' $$,
  $$ values (false, null::int, null::timestamptz) $$,
  'an office entry alone reads as no feedback: given false, rating and time null');
reset role;

-- A worker session reads nothing through the view, new columns included.
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_lineup_v), 0,
  'a worker reads no line-up row, so no feedback figure either');
select is((select count(*)::int from client_events_v), 0,
  'and no event row, so no cancelled_at either');
reset role;

select * from finish();
rollback;
