-- =====================================================================
-- onboarding_candidates_v reads each candidate's documents and quiz once
-- (ADR-0155)
--
-- Audit 17.10.2026 F5: `select *` over every candidate took 3.8 s live
-- (431 rows) and the /onboarding board's named columns ~0.5 s; joined to
-- another view it did not finish in 60 s. Per row the view ran
-- current_compliance_docs() four times (one count each for total,
-- verified, pending, rejected), quiz_attempts four times (attempts used,
-- best score, passed at, the scores) with no index on what they filter
-- by, and staff_rejection_reason_v's gate `current_app_role() = 'admin'`
-- once per row — a four-table auth read — because it was not wrapped.
--
--   1. staff_rejection_reason_v: the gate is `(select current_app_role())`,
--      an InitPlan the executor runs once per statement. Still admin-only
--      (20260923220000); still an owner-rights, security_barrier view.
--   2. onboarding_candidates_v: the four document counts come from ONE
--      read of current_compliance_docs(), and the four quiz figures from
--      ONE read of quiz_attempts, each in a LEFT JOIN LATERAL ungrouped
--      aggregate — the shape the planner proves yields exactly one row,
--      so it drops the join when no column of it is selected (ADR-0147).
--      Same filters, same functions, same types, same column order: the
--      view stays security_invoker, so every reader still sees only what
--      its own RLS lets it see.
--   3. current_compliance_docs() loses its pinned search_path (its one
--      table is now written public.compliance_docs), so the planner
--      inlines it wherever it is read — here, inside
--      onboarding_documents_missing() and onboarding_quiz_blockers()
--      (docs_missing / quiz_blockers keep calling the same rule
--      functions), and in onboarding_chaser_candidates(). SECURITY
--      INVOKER and STABLE, as it was (see 20261019192000 for why that is
--      safe and how pgTAP 002 holds it).
--   4. quiz_attempts gets the (staff_id, taken_at) index those reads use.
--
-- Re-created from the LIVE definitions (docs/10 §3b): pg_get_viewdef()
-- and pg_get_functiondef() changed by named patterns, each of which must
-- match exactly as often as expected or the migration stops. The views'
-- options (security_invoker / security_barrier) are read back and
-- restated, because CREATE OR REPLACE VIEW would otherwise reset them.
-- =====================================================================

create index if not exists quiz_attempts_staff_taken_idx
  on public.quiz_attempts (staff_id, taken_at);

do $$
declare
  p      record;
  v_def  text;
  v_opts text;
  v_n    int;
begin
  -- ---- 3. current_compliance_docs: unpinned, qualified, inlinable --------
  v_def := pg_get_functiondef('public.current_compliance_docs(uuid)'::regprocedure);
  for p in
    select * from (values
      (E'\n SET search_path TO ''public'', ''extensions''\n', E'\n', 1),
      ('(?<![.\w])from compliance_docs d\M', 'from public.compliance_docs d', 1)
    ) as x(pattern, replacement, expect)
  loop
    select count(*) into v_n from regexp_matches(v_def, p.pattern, 'g');
    if v_n <> p.expect then
      raise exception '20261019192200: current_compliance_docs - expected % match(es) of %, found %', p.expect, p.pattern, v_n;
    end if;
    v_def := regexp_replace(v_def, p.pattern, p.replacement, 'g');
  end loop;
  if v_def !~ E'\n LANGUAGE sql\n' or v_def ~ 'SECURITY DEFINER' or v_def ~ E'\n VOLATILE' then
    raise exception '20261019192200: current_compliance_docs is not a plain invoker SQL helper';
  end if;
  execute v_def;

  -- ---- 1. staff_rejection_reason_v: the gate runs once ------------------
  v_def := pg_get_viewdef('public.staff_rejection_reason_v'::regclass, true);
  select array_to_string(c.reloptions, ', ') into v_opts
    from pg_class c where c.oid = 'public.staff_rejection_reason_v'::regclass;
  select count(*) into v_n from regexp_matches(v_def, '(?<![.\w(])current_app_role\(\)', 'g');
  if v_n <> 1 then
    raise exception '20261019192200: staff_rejection_reason_v - expected one current_app_role(), found %', v_n;
  end if;
  v_def := regexp_replace(v_def, '(?<![.\w(])current_app_role\(\)', '( SELECT current_app_role() AS current_app_role)');
  execute 'create or replace view public.staff_rejection_reason_v'
          || case when v_opts is not null then ' with (' || v_opts || ')' else '' end
          || ' as ' || v_def;

  -- ---- 2. onboarding_candidates_v: one lateral each ----------------------
  v_def := pg_get_viewdef('public.onboarding_candidates_v'::regclass, true);
  select array_to_string(c.reloptions, ', ') into v_opts
    from pg_class c where c.oid = 'public.onboarding_candidates_v'::regclass;
  for p in
    select * from (values
      -- the four document counts
      ('\(\(\s*SELECT count\(\*\) AS count\s+FROM current_compliance_docs\(s\.id\) current_compliance_docs\(doc_id, doc_type, status\)\)\)::integer AS docs_total',
       'docs.docs_total'),
      ('\(\(\s*SELECT count\(\*\) AS count\s+FROM current_compliance_docs\(s\.id\) d\(doc_id, doc_type, status\)\s+WHERE d\.status = ''verified''::review_status\)\)::integer AS docs_verified',
       'docs.docs_verified'),
      ('\(\(\s*SELECT count\(\*\) AS count\s+FROM current_compliance_docs\(s\.id\) d\(doc_id, doc_type, status\)\s+WHERE d\.status = ''pending''::review_status\)\)::integer AS docs_pending',
       'docs.docs_pending'),
      ('\(\(\s*SELECT count\(\*\) AS count\s+FROM current_compliance_docs\(s\.id\) d\(doc_id, doc_type, status\)\s+WHERE d\.status = ''rejected''::review_status\)\)::integer AS docs_rejected',
       'docs.docs_rejected'),
      -- the four quiz figures
      ('\(\(\s*SELECT count\(\*\) AS count\s+FROM quiz_attempts q\s+WHERE q\.staff_id = s\.id AND q\.taken_at >= s\.onboarding_started_at\)\)::integer AS quiz_attempts_used',
       'quiz.quiz_attempts_used'),
      ('\(\s*SELECT max\(q\.score\) AS max\s+FROM quiz_attempts q\s+WHERE q\.staff_id = s\.id AND q\.taken_at >= s\.onboarding_started_at\) AS quiz_best_score',
       'quiz.quiz_best_score'),
      ('\(\s*SELECT min\(q\.taken_at\) AS min\s+FROM quiz_attempts q\s+WHERE q\.staff_id = s\.id AND q\.passed AND q\.taken_at >= s\.onboarding_started_at\) AS quiz_passed_at',
       'quiz.quiz_passed_at'),
      ('COALESCE\(\(\s*SELECT array_agg\(round\(q\.score\)::integer ORDER BY q\.attempt_no\) AS array_agg\s+FROM quiz_attempts q\s+WHERE q\.staff_id = s\.id AND q\.taken_at >= s\.onboarding_started_at\), ''\{\}''::integer\[\]\) AS quiz_scores',
       'COALESCE(quiz.quiz_scores, ''{}''::integer[]) AS quiz_scores'),
      -- and the two laterals they read, after the join the view already has
      ('(\n\s+FROM staff s\n\s+LEFT JOIN profiles p ON p\.id = s\.rejected_by\n)',
       E'\\1     -- 20261019192200: one read of the current documents and one of the\n'
       || E'     -- quiz attempts per candidate, not four of each (ADR-0155).\n'
       || E'     LEFT JOIN LATERAL ( SELECT count(*)::integer AS docs_total,\n'
       || E'            count(*) FILTER (WHERE d.status = ''verified''::review_status)::integer AS docs_verified,\n'
       || E'            count(*) FILTER (WHERE d.status = ''pending''::review_status)::integer AS docs_pending,\n'
       || E'            count(*) FILTER (WHERE d.status = ''rejected''::review_status)::integer AS docs_rejected\n'
       || E'           FROM current_compliance_docs(s.id) d(doc_id, doc_type, status)) docs ON true\n'
       || E'     LEFT JOIN LATERAL ( SELECT count(*)::integer AS quiz_attempts_used,\n'
       || E'            max(q.score) AS quiz_best_score,\n'
       || E'            min(q.taken_at) FILTER (WHERE q.passed) AS quiz_passed_at,\n'
       || E'            array_agg(round(q.score)::integer ORDER BY q.attempt_no) AS quiz_scores\n'
       || E'           FROM quiz_attempts q\n'
       || E'          WHERE q.staff_id = s.id AND q.taken_at >= s.onboarding_started_at) quiz ON true\n')
    ) as x(pattern, replacement)
  loop
    select count(*) into v_n from regexp_matches(v_def, p.pattern, 'g');
    if v_n <> 1 then
      raise exception '20261019192200: onboarding_candidates_v - expected one match of %, found %', p.pattern, v_n;
    end if;
    v_def := regexp_replace(v_def, p.pattern, p.replacement);
  end loop;
  execute 'create or replace view public.onboarding_candidates_v'
          || case when v_opts is not null then ' with (' || v_opts || ')' else '' end
          || ' as ' || v_def;
end;
$$;
