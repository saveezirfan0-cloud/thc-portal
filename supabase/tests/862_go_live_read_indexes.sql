-- =====================================================================
-- 862 · The go-live read indexes exist, on the columns they were made for
--   20261019191200_go_live_read_indexes.sql · ADR-0154
--
-- An index dropped or rebuilt on the wrong columns fails nothing else:
-- the queries still answer, just by reading every row. So the shapes are
-- pinned here.
-- =====================================================================
begin;
select plan(5);

select is(
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'audit_log_rota_guard_warned_idx'),
  'CREATE INDEX audit_log_rota_guard_warned_idx ON public.audit_log USING btree (at DESC) WHERE (action = ''rota_guard.warned''::text)',
  'rota_guard_warnings_v reads audit_log through a partial index on its one action');

select is(
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'shift_requirements_ends_at_idx'),
  'CREATE INDEX shift_requirements_ends_at_idx ON public.shift_requirements USING btree (ends_at)',
  '"not over yet" on a section is indexed');

select is(
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'shift_requirements_event_role_idx'),
  'CREATE INDEX shift_requirements_event_role_idx ON public.shift_requirements USING btree (event_id, role_id)',
  'a section is found by event and role together');

select is(
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'quiz_attempts_staff_taken_idx'),
  'CREATE INDEX quiz_attempts_staff_taken_idx ON public.quiz_attempts USING btree (staff_id, taken_at)',
  'a worker''s quiz attempts are found by worker and time, superseded or not');

select is(
  (select count(*)::int from pg_index i join pg_class c on c.oid = i.indexrelid
    where c.relname in ('audit_log_rota_guard_warned_idx', 'shift_requirements_ends_at_idx',
                        'shift_requirements_event_role_idx', 'quiz_attempts_staff_taken_idx')
      and i.indisvalid and i.indisready),
  4, 'all four are valid and ready');

select * from finish();
rollback;
