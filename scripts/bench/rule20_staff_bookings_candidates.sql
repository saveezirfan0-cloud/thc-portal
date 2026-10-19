-- =====================================================================
-- Benchmark: the RULE-20 helper chain, staff_bookings() and
-- onboarding_candidates_v (ADR-0155; audit 17.10.2026 F3, F4, F5).
--
-- LOCAL ONLY. Seeds ~1,000 workers with a booking history and a few
-- hundred onboarding candidates inside one transaction, times the reads
-- the Staff App and the office make, and rolls everything back.
--
--   scripts/pgtest-local.sh builds a throwaway cluster and deletes it; for
--   a cluster you can keep, run its first half (migrations + seed) and then
--
--   psql -X -h <socket dir> -p <port> -U postgres -f scripts/bench/rule20_staff_bookings_candidates.sql
--
-- Sizes can be overridden: psql -v cap_n=2000 -v cap_back=365 ...
-- Every timed read runs as the office admin under `authenticated`, the way
-- the apps call it, with the statement limit lifted so a slow "before"
-- still reports a number.
-- =====================================================================
\set ON_ERROR_STOP 1
\pset pager off
\if :{?cap_n}      \else \set cap_n 1000     \endif
\if :{?cap_cands}  \else \set cap_cands 300  \endif
\if :{?cap_back}   \else \set cap_back 300   \endif
\if :{?cap_ahead}  \else \set cap_ahead 42   \endif
\if :{?bench_runs} \else \set bench_runs 3   \endif

begin;
set local client_min_messages = warning;
\ir ../../supabase/tests/_shared/fixtures.psql
\ir ../../supabase/tests/_shared/cap_dataset.psql

select format('%s workers, %s candidates, %s bookings, %s sections',
              (select count(*) from staff where email like 'cap%@capset.test'),
              (select count(*) from staff where email like 'cand%@capset.test'),
              (select count(*) from bookings), (select count(*) from shift_requirements)) as dataset;

-- A section next week, the worker list and the ids the loops read.
select set_config('bench.shift',
         ('ca9a0000-0000-4000-8000-' || lpad(((9 + 100000) * 10 + 1)::text, 12, '0')), false),
       set_config('bench.runs', :'bench_runs', false) \gset

create temp table bench_result (seq serial, what text, calls int, run int, ms numeric);
grant all on sequence bench_result_seq_seq to authenticated;
grant all on bench_result to authenticated;

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
set local statement_timeout = 0;

do $$
declare
  t      timestamptz;
  r      int;
  runs   int := current_setting('bench.runs')::int;
  v_sh   uuid := current_setting('bench.shift')::uuid;
  v_day  date := (now() at time zone 'Europe/London')::date;
  v_ids  uuid[] := array(select id from staff where email like 'cap%@capset.test' order by id);
  v_some uuid[] := array(select id from staff where email like 'cap%@capset.test' order by employee_id limit 20);
  v_cand uuid[] := array(select id from staff where email like 'cand%@capset.test' order by id limit 20);
  n      int := cardinality(v_ids);
  x      uuid;
begin
  for r in 1 .. runs loop
    t := clock_timestamp();
    perform count((public.weekly_cap_for(i, v_day)).cap_hours) from unnest(v_ids) i;
    insert into bench_result (what, calls, run, ms) values ('weekly_cap_for (one call per worker)', n, r, extract(epoch from clock_timestamp() - t) * 1000);

    t := clock_timestamp();
    perform count(*) filter (where public.weekly_cap_would_breach(i, v_sh)) from unnest(v_ids) i;
    insert into bench_result (what, calls, run, ms) values ('weekly_cap_would_breach (one call per worker)', n, r, extract(epoch from clock_timestamp() - t) * 1000);

    t := clock_timestamp();
    perform count(public.can_roster_staff(i, v_day)) from unnest(v_ids) i;
    insert into bench_result (what, calls, run, ms) values ('can_roster_staff (one call per worker)', n, r, extract(epoch from clock_timestamp() - t) * 1000);

    t := clock_timestamp();
    perform sum(public.weekly_booked_hours(i, v_day)) from unnest(v_ids) i;
    insert into bench_result (what, calls, run, ms) values ('weekly_booked_hours (one call per worker)', n, r, extract(epoch from clock_timestamp() - t) * 1000);

    t := clock_timestamp();
    foreach x in array v_some loop
      perform count(*) from public.staff_bookings(x);
    end loop;
    insert into bench_result (what, calls, run, ms) values ('staff_bookings (one worker, ~115 bookings)', cardinality(v_some), r, extract(epoch from clock_timestamp() - t) * 1000);

    t := clock_timestamp();
    perform id, employee_id, status, removed, display_name, photo_path, rating, reliability, block_kind, block_reason,
            rtw_branch, right_to_work_until, graduated_at, wtr_optout, left_at, leave_reason, role_names,
            unresolved_violations, do_not_return_clients, weekly_cap_hours, weekly_cap_band, weekly_booked_hours,
            weekly_cap_until, last_shift_at, released_shift_count, p45_requested_at, spudbros_express,
            thc_shifts_enabled, payroll_id
       from public.staff_directory_v order by display_name;
    insert into bench_result (what, calls, run, ms) values ('staff_directory_v (the /staff page columns)', 1, r, extract(epoch from clock_timestamp() - t) * 1000);

    t := clock_timestamp();
    perform id, first_name, last_name, display_name, email, phone, dob, age, applied_age_band, photo_path, status,
            stage_entered_at, onboarding_started_at, applied_at, gdpr_consent_at, employee_id, rtw_branch,
            right_to_work_until, share_code, activated, role_names, role_ids, willo_linked, willo_review_url,
            willo_invited_at, willo_answers_done, willo_answers_total, willo_completed_at, willo_decision,
            willo_decided_at, willo_decided_via, docs_total, docs_verified, docs_pending, docs_rejected,
            last_doc_rejected_at, docs_missing, declaration_answer, declaration_status, quiz_attempts_used,
            quiz_best_score, quiz_passed_at, hmrc_submitted_at, references_count, bank_saved, ni_entered,
            contract_signed_at, contract_version, rejected_at, rejected_from, rejection_cause, rejection_reason,
            rejected_by_name, activated_at, additional_info_done_at, quiz_scores, spudbros_express,
            thc_shifts_enabled, payroll_id
       from public.onboarding_candidates_v
      where status in ('interview_requested','interview_completed','documents','quiz','additional_info','contract','rejected')
      order by stage_entered_at desc;
    insert into bench_result (what, calls, run, ms) values ('onboarding_candidates_v (the /onboarding board columns)', 1, r, extract(epoch from clock_timestamp() - t) * 1000);

    t := clock_timestamp();
    perform * from public.onboarding_candidates_v;
    insert into bench_result (what, calls, run, ms) values ('onboarding_candidates_v (select *, every row)', 1, r, extract(epoch from clock_timestamp() - t) * 1000);

    t := clock_timestamp();
    foreach x in array v_cand loop
      perform * from public.onboarding_candidates_v where id = x;
    end loop;
    insert into bench_result (what, calls, run, ms) values ('onboarding_candidates_v (select * by id)', cardinality(v_cand), r, extract(epoch from clock_timestamp() - t) * 1000);

    t := clock_timestamp();
    perform count(*) from public.auto_assign_candidates(v_sh, false);
    insert into bench_result (what, calls, run, ms) values ('auto_assign_candidates (one section, whole pool)', 1, r, extract(epoch from clock_timestamp() - t) * 1000);
  end loop;
end $$;

reset role;
select what,
       calls,
       round(min(ms), 1)                                                  as best_ms,
       round((percentile_cont(0.5) within group (order by ms))::numeric, 1) as median_ms,
       round(min(ms) / calls, 3)                                          as best_ms_per_call
  from bench_result group by what, calls order by min(seq);

rollback;
