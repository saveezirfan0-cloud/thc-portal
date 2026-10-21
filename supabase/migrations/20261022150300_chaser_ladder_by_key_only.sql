-- =====================================================================
-- Migration 20261022150300 · the onboarding chasers find each ladder by
--                            its key alone, and read the config once
--                            (ADR-0071, ADR-0169)
--
-- /onboarding reads onboarding_chaser_state() on every load and every 30 s
-- refresh (avg 0.31 s in pg_stat_statements); the hourly chaser job reads
-- the same onboarding_chaser_candidates() under it. Two costs, neither of
-- them work:
--
--   1. The ladder lookup. 20261007120000 made it an anchored range on
--      notification_outbox_key_c_idx (the "C"-collation key index) — eight
--      rows a candidate. ADR-0169 (20261021120000) added OC4 beside OC3:
--        where (o.template = t.template or (t.template = 'OC3' and o.template = 'OC4'))
--      and the planner now ANDs the key range with a BitmapOr over
--      notification_outbox_template_id_idx: every OC1 row in the outbox
--      (2,876 today, one more per candidate chased per day, never fewer)
--      read once per candidate, to narrow eight rows. 120 ms of the 150.
--      The template test is now written `o.template collate "C" = …`:
--      equality under a deterministic collation is byte equality in both,
--      so it answers the same, but it no longer matches the template
--      index, and the key range alone finds the rows.
--
--   2. onboarding_chaser_state() called onboarding_chaser_config() — a
--      plpgsql settings read — once per ROW for `stalled_after` (396 rows
--      today). It is STABLE, so within the one statement it has one
--      answer: it is now a scalar subquery, asked once.
--
-- Measured on the live project (22.10.2026, read-only):
--   the ladder lookup over the 396 live candidates   115–128 ms → 19–22 ms
--   onboarding_chaser_config() per row                0.065–0.18 ms × 396 → once
--
-- Same rows, same columns, same grants; 394_onboarding_chasers.sql is the
-- behavioural pin. Re-created from the LIVE definitions (docs/10 §3b), each
-- replacement required to match exactly once.
-- =====================================================================

do $$
declare
  p     record;
  v_def text;
  v_cmt text;
  v_n   int;
begin
  for p in
    select * from (values
      ('public.onboarding_chaser_candidates(timestamp with time zone)',
       'where \(o\.template = t\.template or \(t\.template = ''OC3'' and o\.template = ''OC4''\)\)',
       $r$-- 20261022150300: "C" so the key range alone finds the ladder (byte
         -- equality either way; the template index is no longer ANDed in).
         where (o.template collate "C" = t.template
                or (t.template = 'OC3' and o.template collate "C" = 'OC4'))$r$,
       ' Since 20261022150300 the ladder is found by its key range alone.'),
      ('public.onboarding_chaser_state(timestamp with time zone)',
       'c\.rungs_sent >= \(onboarding_chaser_config\(\) ->> ''stalled_after''\)::int,',
       $r$-- 20261022150300: STABLE, so asked once per statement, not per row.
           c.rungs_sent >= (select (onboarding_chaser_config() ->> 'stalled_after')::int),$r$,
       ' Since 20261022150300 the stalled threshold is read once per call.')
    ) as x(fn, pattern, replacement, note)
  loop
    v_def := pg_get_functiondef(p.fn::regprocedure);
    v_cmt := obj_description(p.fn::regprocedure::oid, 'pg_proc');
    select count(*) into v_n from regexp_matches(v_def, p.pattern, 'g');
    if v_n <> 1 then
      raise exception '20261022150300: % - expected one match of %, found %', p.fn, p.pattern, v_n;
    end if;
    execute regexp_replace(v_def, p.pattern, p.replacement);
    execute format('comment on function %s is %L', p.fn, coalesce(v_cmt, '') || p.note);
  end loop;
end;
$$;
