-- =====================================================================
-- Benchmark: the Back Office's heaviest views at go-live scale
-- (staff_directory_v, student_visa_v, onboarding_candidates_v,
-- compliance_review_queue_v; ADR-0166).
--
-- LOCAL ONLY. Seeds ~1,000 workers with a booking history (the
-- _shared/cap_dataset population: ~114k bookings, every RULE-20 branch),
-- a few hundred onboarding candidates, and on top of them what the office
-- screens read per worker: current and superseded documents, pending ones
-- for the review queue, criminal declarations, quiz attempts, client
-- qualifications with a do-not-return, manual blocks with a reason,
-- no-show violations and gov.uk right-to-work checks. Everything is inside
-- one transaction and rolled back.
--
-- Every timed read runs as the office admin under `authenticated`, in the
-- shape PostgREST sends it (a CTE, `count(_postgrest_t)` over the whole row,
-- `json_agg` for the body), with the statement limit lifted so a slow
-- "before" still reports a number. Best of :bench_runs.
--
--   scripts/pgtest-local.sh builds a throwaway cluster, applies every
--   migration and the seed, and deletes it afterwards; it hands TESTS to
--   pg_prove, so this file can ride on it (pg_prove reports "no plan" —
--   this file is not TAP — and -v shows the numbers):
--
--   TESTS="-v $PWD/scripts/bench/office_views_at_scale.sql" scripts/pgtest-local.sh "$PWD" <port>
--
--   or, on a cluster you keep:
--   psql -X -h <socket dir> -p <port> -U postgres -f scripts/bench/office_views_at_scale.sql
--
-- Sizes can be overridden: psql -v cap_n=2000 ... (pg_prove: --set cap_n=2000).
-- --set bench_explain=1 also prints EXPLAIN ANALYZE for the four reads.
-- =====================================================================
\set ON_ERROR_STOP 1
\pset pager off
\if :{?cap_n}         \else \set cap_n 1000     \endif
\if :{?cap_cands}     \else \set cap_cands 300  \endif
\if :{?cap_back}      \else \set cap_back 300   \endif
\if :{?cap_ahead}     \else \set cap_ahead 42   \endif
\if :{?bench_runs}    \else \set bench_runs 3   \endif
\if :{?bench_explain} \else \set bench_explain 0 \endif

begin;
set local client_min_messages = warning;
\ir ../../supabase/tests/_shared/fixtures.psql
\ir ../../supabase/tests/_shared/cap_dataset.psql

\ir ../../supabase/tests/_shared/office_views_dataset.psql

select format('%s staff rows (%s workers, %s candidates), %s bookings, %s documents, %s queue items',
              (select count(*) from staff),
              (select count(*) from staff where email like 'cap%@capset.test'),
              (select count(*) from staff where email like 'cand%@capset.test'),
              (select count(*) from bookings), (select count(*) from compliance_docs),
              (select count(*) from compliance_review_queue_v)) as dataset;

create temp table bench_result (seq serial, what text, run int, ms numeric, rows bigint);
grant all on sequence bench_result_seq_seq to authenticated;
grant all on bench_result to authenticated;
select set_config('bench.runs', :'bench_runs', false);

-- The reads, in the shape PostgREST sends them. The column lists are the
-- pages' own (apps/office/app/staff/data.ts, onboarding/data.ts).
create temp table bench_sql (seq numeric, what text, sql text);
grant select on bench_sql to authenticated;
insert into bench_sql values
  (10, '/staff  staff_directory_v page 1 (1000 rows)',
   $q$with pgrst_source as (select id, employee_id, status, removed, display_name, photo_path, rating, reliability, block_kind, block_reason, rtw_branch, right_to_work_until, graduated_at, wtr_optout, left_at, leave_reason, role_names, unresolved_violations, do_not_return_clients, weekly_cap_hours, weekly_cap_band, weekly_booked_hours, weekly_cap_until, last_shift_at, released_shift_count, p45_requested_at, spudbros_express, thc_shifts_enabled, payroll_id
        from public.staff_directory_v order by display_name, id limit 1000 offset 0)
      select null::bigint as total_result_set, pg_catalog.count(_postgrest_t) as page_total,
             coalesce(json_agg(_postgrest_t), '[]')::text as body
        from (select * from pgrst_source) _postgrest_t$q$),
  (11, '/staff  staff_directory_v page 2',
   $q$with pgrst_source as (select id, employee_id, status, removed, display_name, photo_path, rating, reliability, block_kind, block_reason, rtw_branch, right_to_work_until, graduated_at, wtr_optout, left_at, leave_reason, role_names, unresolved_violations, do_not_return_clients, weekly_cap_hours, weekly_cap_band, weekly_booked_hours, weekly_cap_until, last_shift_at, released_shift_count, p45_requested_at, spudbros_express, thc_shifts_enabled, payroll_id
        from public.staff_directory_v order by display_name, id limit 1000 offset 1000)
      select null::bigint as total_result_set, pg_catalog.count(_postgrest_t) as page_total,
             coalesce(json_agg(_postgrest_t), '[]')::text as body
        from (select * from pgrst_source) _postgrest_t$q$),
  (12, '/staff  staff_directory_v every row, the page''s columns',
   $q$select count(*), sum(length(row_to_json(d)::text)) from (select id, employee_id, status, removed, display_name, photo_path, rating, reliability, block_kind, block_reason, rtw_branch, right_to_work_until, graduated_at, wtr_optout, left_at, leave_reason, role_names, unresolved_violations, do_not_return_clients, weekly_cap_hours, weekly_cap_band, weekly_booked_hours, weekly_cap_until, last_shift_at, released_shift_count, p45_requested_at, spudbros_express, thc_shifts_enabled, payroll_id
        from public.staff_directory_v order by display_name, id) d$q$),
  (13, '/staff  student_visa_v, the page''s columns',
   $q$select count(*), sum(length(row_to_json(d)::text)) from (select id, display_name, employee_id, photo_path, status, weekly_cap_hours, weekly_cap_band, weekly_booked_hours, right_to_work_until, graduated_at, wtr_optout, term_letter_verified_at, term_letter_expires_at, completion_letter_verified_at, completion_letter_in_review, below_degree_level, course_completion_date, completion_letter_status, completion_letter_rejection, completion_date_claimed, completion_effective_from, wtr_optout_cancelled_from, optout_eligible, rtw_days_left
        from public.student_visa_v order by display_name, id) d$q$),
  (14, '        staff_directory_v select * every row',
   $q$select count(*), sum(length(row_to_json(d)::text)) from public.staff_directory_v d$q$),
  (15, '        staff_directory_v four columns (pickers, typeahead)',
   $q$select count(*), sum(length(row_to_json(d)::text)) from (select id, display_name, employee_id, role_names from public.staff_directory_v where status = 'compliant' order by display_name) d$q$),
  (16, '/staff/[id]  staff_profile_v by id (one worker)',
   $q$select count(*), sum(length(row_to_json(d)::text)) from (select * from public.staff_profile_v
        where id = (select id from public.staff where email = 'cap7@capset.test')) d$q$),
  (17, '/clients/[id]  clients_qualified_staff_v for one client',
   $q$select count(*), sum(length(row_to_json(d)::text)) from (select * from public.clients_qualified_staff_v
        where client_id = 'aaaaaaaa-0000-4000-8000-000000000002') d$q$),
  (20, '  col   reliability',            $q$select sum(reliability) from public.staff_directory_v$q$),
  (21, '  col   block_reason',           $q$select count(block_reason) from public.staff_directory_v$q$),
  (22, '  col   role_names + dnr + violations', $q$select sum(cardinality(role_names) + cardinality(do_not_return_clients) + unresolved_violations) from public.staff_directory_v$q$),
  (23, '  col   weekly_cap_hours + band', $q$select sum(weekly_cap_hours), count(weekly_cap_band) from public.staff_directory_v$q$),
  (24, '  col   weekly_booked_hours',    $q$select sum(weekly_booked_hours) from public.staff_directory_v$q$),
  (25, '  col   weekly_cap_until',       $q$select count(weekly_cap_until) from public.staff_directory_v$q$),
  (26, '  col   last_shift_at + released', $q$select count(last_shift_at), sum(released_shift_count) from public.staff_directory_v$q$),
  (27, '  col   weekly_worked_hours',    $q$select sum(weekly_worked_hours) from public.staff_directory_v$q$),
  (30, '/onboarding  onboarding_candidates_v the board''s columns',
   $q$select count(*), sum(length(row_to_json(d)::text)) from (select id, first_name, last_name, display_name, email, phone, dob, age, applied_age_band, photo_path, status, stage_entered_at, onboarding_started_at, applied_at, gdpr_consent_at, employee_id, rtw_branch, right_to_work_until, share_code, activated, role_names, role_ids, willo_linked, willo_review_url, willo_invited_at, willo_answers_done, willo_answers_total, willo_completed_at, willo_decision, willo_decided_at, willo_decided_via, docs_total, docs_verified, docs_pending, docs_rejected, last_doc_rejected_at, docs_missing, declaration_answer, declaration_status, quiz_attempts_used, quiz_best_score, quiz_passed_at, hmrc_submitted_at, references_count, bank_saved, ni_entered, contract_signed_at, contract_version, rejected_at, rejected_from, rejection_cause, rejection_reason, rejected_by_name, activated_at, additional_info_done_at, quiz_scores, spudbros_express, thc_shifts_enabled, payroll_id
        from public.onboarding_candidates_v
       where status in ('interview_requested','interview_completed','documents','quiz','additional_info','contract','rejected')
       order by stage_entered_at desc, id) d$q$),
  (31, '            onboarding_candidates_v select * every row',
   $q$select count(*), sum(length(row_to_json(d)::text)) from public.onboarding_candidates_v d$q$),
  (32, '  col   activated + activated_at', $q$select count(*) filter (where activated), count(activated_at) from public.onboarding_candidates_v$q$),
  (33, '  col   quiz_blockers',           $q$select sum(cardinality(quiz_blockers)) from public.onboarding_candidates_v$q$),
  (34, '  col   docs_missing',            $q$select sum(cardinality(docs_missing)) from public.onboarding_candidates_v$q$),
  (40, 'layout  compliance_review_queue_v HEAD count=exact select=* (today)',
   $q$with pgrst_source as (select public.compliance_review_queue_v.* from public.compliance_review_queue_v),
           pgrst_source_count as (select 1 from public.compliance_review_queue_v)
      select (select pg_catalog.count(*) from pgrst_source_count) as total_result_set,
             pg_catalog.count(_postgrest_t) as page_total, ''::text as body
        from (select * from pgrst_source) _postgrest_t$q$),
  (41, 'layout  compliance_review_queue_v HEAD count=exact select=item_id',
   $q$with pgrst_source as (select public.compliance_review_queue_v.item_id from public.compliance_review_queue_v),
           pgrst_source_count as (select 1 from public.compliance_review_queue_v)
      select (select pg_catalog.count(*) from pgrst_source_count) as total_result_set,
             pg_catalog.count(_postgrest_t) as page_total, ''::text as body
        from (select * from pgrst_source) _postgrest_t$q$),
  (42, '        compliance_review_queue_v count(*)',
   $q$select count(*) from public.compliance_review_queue_v$q$),
  (43, '/compliance  compliance_review_queue_v select * order by submitted_at',
   $q$select count(*), sum(length(row_to_json(d)::text)) from (select * from public.compliance_review_queue_v order by submitted_at) d$q$);
-- The sidebar's read since 20261020150300 (absent before it).
insert into bench_sql
select 44, 'layout  rpc compliance_review_queue_count()', $q$select public.compliance_review_queue_count()$q$
 where to_regprocedure('public.compliance_review_queue_count()') is not null;

-- The same reads against the definitions ADR-0166 replaced, recreated as
-- public._old_* (the pgTAP equivalence tests use the same file), so every
-- "after" has its "before" timed in the same run, under the same load.
\ir ../../supabase/tests/_shared/office_views_before_20261020150000.psql
insert into bench_sql
select b.seq + 0.5, b.what || '   [before]',
       replace(replace(replace(replace(replace(replace(b.sql,
         'public.staff_profile_v', 'public._old_staff_profile_v'),
         'public.clients_qualified_staff_v', 'public._old_clients_qualified_staff_v'),
         'public.staff_directory_v', 'public._old_staff_directory_v'),
         'public.student_visa_v', 'public._old_student_visa_v'),
         'public.onboarding_candidates_v', 'public._old_onboarding_candidates_v'),
         'public.compliance_review_queue_v', 'public._old_compliance_review_queue_v')
  from bench_sql b
 where b.seq in (10, 11, 12, 13, 15, 16, 17, 30, 31, 43);

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
set local statement_timeout = 0;

do $$
declare
  t    timestamptz;
  r    int;
  q    record;
  n    bigint;
  runs int := current_setting('bench.runs')::int;
begin
  -- one warm-up pass, untimed
  for q in select * from bench_sql order by seq loop
    execute q.sql;
  end loop;
  for r in 1 .. runs loop
    for q in select * from bench_sql order by seq loop
      t := clock_timestamp();
      execute q.sql;
      get diagnostics n = row_count;
      insert into bench_result (what, run, ms, rows)
      values (q.what, r, extract(epoch from clock_timestamp() - t) * 1000, n);
    end loop;
  end loop;
end $$;

select what, round(min(ms), 1) as best_ms, round(avg(ms), 1) as avg_ms
  from bench_result r join bench_sql s using (what)
 group by what, s.seq order by s.seq;

\if :bench_explain
explain (analyze, buffers, costs off)
select id, employee_id, status, removed, display_name, photo_path, rating, reliability, block_kind, block_reason, rtw_branch, right_to_work_until, graduated_at, wtr_optout, left_at, leave_reason, role_names, unresolved_violations, do_not_return_clients, weekly_cap_hours, weekly_cap_band, weekly_booked_hours, weekly_cap_until, last_shift_at, released_shift_count, p45_requested_at, spudbros_express, thc_shifts_enabled, payroll_id
  from public.staff_directory_v order by display_name, id limit 1000;
explain (analyze, buffers, costs off) select * from public.onboarding_candidates_v;
explain (analyze, buffers, costs off)
with pgrst_source as (select public.compliance_review_queue_v.* from public.compliance_review_queue_v),
     pgrst_source_count as (select 1 from public.compliance_review_queue_v)
select (select pg_catalog.count(*) from pgrst_source_count) as total_result_set,
       pg_catalog.count(_postgrest_t) as page_total
  from (select * from pgrst_source) _postgrest_t;
\endif

rollback;
