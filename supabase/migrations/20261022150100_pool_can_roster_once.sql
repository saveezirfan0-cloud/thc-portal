-- =====================================================================
-- Migration 20261022150100 · the pool asks can_roster_staff() once per
--                            row, not two to four times (ADR-0170)
--
-- The RULE-20 verdict in auto_assign_candidates_pool_pairs() — the pool's
-- one body, read by Radar (auto_assign_worker_pool), RULE-17
-- (auto_assign_wave1_reachable), the board (auto_assign_candidates) and the
-- rounds — reads its right-to-work answer from a FROM-less subquery:
--
--   from (select can_roster_staff(s.id, sec.starts_on)
--                and can_roster_staff(s.id, sec.ends_on) as can_roster) x
--
-- The planner pulls that subquery up and pastes its expression into every
-- place that reads x.can_roster: once into rota_guard_decide()'s arguments
-- and again into `case when not x.can_roster` for every blocked pair. So a
-- pair let through to RULE-20 paid can_roster_staff() twice, four times if
-- blocked — and a section that starts and ends on the same UK day (nearly
-- all of them) asks the same question both times. rota_guard_verdict() had
-- the same shape and was fixed by 20261019192000 with OFFSET 0; the pool,
-- written later from its pieces, did not carry the fence over.
--
-- Now x is computed once (OFFSET 0 keeps it a subquery: the same value,
-- read twice), and when starts_on = ends_on the one call is the answer:
-- can_roster_staff() is STABLE, so `a and a` is `a` — true, false and null
-- alike. Two days still ask both. Every gate, its order and code, the wave
-- and the score inputs are untouched; only how often one fact is fetched.
--
-- Measured on the live project (22.10.2026, read-only, the body inlined
-- with these same two shapes side by side, each section/worker run twice):
--
--   the board's call (one section, the agency, an office session):
--     51 live sections   260 ms → 200 ms a call   (26.5 s → 20.4 s in all)
--   Radar's call (one worker, every live section, as the definer owner):
--     13 workers         59 ms → 31 ms a call    (1.53 s → 0.81 s in all)
--
-- and the md5 of every row set, old body against new, matched for all 102
-- board runs and all 26 Radar runs (2,754 and 510 rows). pgTAP 859 / 880
-- (the pool against its readers and its old bodies, every gate code) are
-- the behavioural pin and pass unchanged.
--
-- Re-created from the LIVE body with one targeted replacement on code
-- (docs/10 §3b), required to match exactly once; search_path, jit,
-- plan_cache_mode, grants and comment are carried over.
-- =====================================================================

do $$
declare
  v_def text := pg_get_functiondef('public.auto_assign_candidates_pool_pairs(uuid[], uuid[], boolean)'::regprocedure);
  v_cmt text := obj_description('public.auto_assign_candidates_pool_pairs(uuid[], uuid[], boolean)'::regprocedure::oid, 'pg_proc');
  v_pat constant text :=
    'from \(select can_roster_staff\(s\.id, sec\.starts_on\)\s+and can_roster_staff\(s\.id, sec\.ends_on\) as can_roster\) x';
  v_n   int;
begin
  select count(*) into v_n from regexp_matches(v_def, v_pat, 'g');
  if v_n <> 1 then
    raise exception '20261022150100: auto_assign_candidates_pool_pairs - expected one match of the can_roster subquery, found %', v_n;
  end if;

  v_def := regexp_replace(v_def, v_pat,
$r$from (select case
                          -- 20261022150100: one call when the section starts
                          -- and ends on the same UK day (a and a is a), and
                          -- OFFSET 0 so the value is computed once and read
                          -- by both places below, not pasted into each.
                          when sec.starts_on = sec.ends_on
                            then can_roster_staff(s.id, sec.starts_on)
                          else can_roster_staff(s.id, sec.starts_on)
                               and can_roster_staff(s.id, sec.ends_on)
                        end as can_roster
                 offset 0) x$r$);

  execute v_def;

  execute format('comment on function public.auto_assign_candidates_pool_pairs(uuid[], uuid[], boolean) is %L',
    coalesce(v_cmt, '')
    || ' Since 20261022150100 the RULE-20 verdict asks can_roster_staff() once per row (once per day of a section that spans two).');
end;
$$;
