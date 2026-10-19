-- =====================================================================
-- compliance_blockers() and the helpers under it are planned once per
-- session, not on every call (ADR-0160, after ADR-0155)
--
-- onboarding_candidates_v `select *` (the candidate screen, any export)
-- spent 2.5 s of 3.6 s locally (300 candidates) in quiz_blockers:
-- onboarding_quiz_blockers() per row, 2.3 ms a call. Almost none of that is
-- work. Each function in the chain is a SQL function with a pinned
-- search_path, which Postgres never inlines, and a SQL function that is not
-- inlined keeps its plan only as long as the expression that calls it —
-- inside another function's query that is rebuilt every time the outer
-- query starts (ADR-0155 §Context). So per candidate the whole chain was
-- parsed and planned again, all the way down:
--
--   onboarding_quiz_blockers → compliance_blockers → current_verified_docs
--     → doc_expires_on → term_letter_last_day, and term_letter_applies
--     (three times).
--
-- The same chain runs on every check-in (attempt_check_in), every Staff App
-- start (staff_me), every unblock and every document verification, so they
-- gain too.
--
-- Each is now plpgsql around the SAME SQL body — `return ( … );` for the
-- four that return one value (every body is a single-row select: an
-- aggregate, NOT EXISTS, a CASE with no FROM, or a concatenation of
-- coalesced subqueries), `return query …;` for the two that return a set —
-- exactly as 20261019130000 did for the RULE-20 chain. A plpgsql function
-- keeps its plans for the session however it is called. Pins, security,
-- volatility, defaults, grants and comments are untouched; the comment gains
-- a line saying so. A set-returning body must not name a result column as
-- a bare identifier (it would become a plpgsql variable): checked below, and
-- the bodies use only qualified `d.doc_type`.
--
-- No rule changes. pgTAP 886 compares every one with its old SQL body over
-- the onboarding and worker populations (every document type and review
-- status, expired, undated and term-dated documents, graduates, every
-- declaration state) on several dates, and the existing tests of the rules
-- (200, 361, 380, 390, 441, 444, 598, 778, 785) pass unchanged.
--
-- Re-created from the LIVE definitions (docs/10 §3b): pg_get_functiondef()
-- with the language and the body wrapper changed; each function must still
-- be a single-statement SQL function with its pin, or the migration stops.
-- =====================================================================

create function pg_temp.r160_sub(p_def text, p_pattern text, p_replacement text, p_expect int, p_label text)
returns text language plpgsql as $f$
declare v_n int;
begin
  select count(*) into v_n from regexp_matches(p_def, p_pattern, 'g');
  if v_n <> p_expect then
    raise exception '20261020150200: % - expected % match(es) of %, found %', p_label, p_expect, p_pattern, v_n;
  end if;
  return regexp_replace(p_def, p_pattern, p_replacement, 'g');
end $f$;

-- Replace everything between the dollar quotes of a pg_get_functiondef() text.
create function pg_temp.r160_body(p_def text, p_body text, p_label text)
returns text language plpgsql as $f$
declare v_at int := position('AS $function$' in p_def);
begin
  if v_at = 0 or right(rtrim(p_def, E' \n'), 10) <> '$function$' then
    raise exception '20261020150200: % - unexpected definition shape', p_label;
  end if;
  return left(p_def, v_at - 1) || 'AS $function$' || p_body || '$function$';
end $f$;

do $$
declare
  f     text;
  v_def text;
  v_src text;
begin
  foreach f in array array[
    'public.term_letter_last_day(daterange[])',
    'public.doc_expires_on(doc_type,date,date,date,timestamp with time zone,daterange[])',
    'public.term_letter_applies(uuid,date)',
    'public.current_verified_docs(uuid)',
    'public.compliance_blockers(uuid,date)',
    'public.onboarding_quiz_blockers(uuid)'
  ] loop
    v_def := pg_get_functiondef(f::regprocedure);
    select p.prosrc into v_src from pg_proc p where p.oid = f::regprocedure;
    if v_def !~ E'\n SET search_path TO ' then
      raise exception '20261020150200: % has lost its pinned search_path', f;
    end if;
    if v_src ~ ';\s*\S' then
      raise exception '20261020150200: % has more than one statement', f;
    end if;
    v_def := pg_temp.r160_sub(v_def, E'\n LANGUAGE sql\n', E'\n LANGUAGE plpgsql\n', 1, f || ' language');
    if (select p.proretset from pg_proc p where p.oid = f::regprocedure) then
      -- RETURNS TABLE: its column names become plpgsql variables, so the
      -- body must not use them as bare identifiers (qualified is fine).
      if exists (select 1 from pg_proc p, unnest(p.proargnames, p.proargmodes) a(n, m)
                  where p.oid = f::regprocedure and a.m = 't'
                    and regexp_replace(v_src, '--[^\n]*', '', 'g') ~ ('(?<![.\w:])' || a.n || '(?!\w)')) then
        raise exception '20261020150200: % - a result column is named in the body', f;
      end if;
      v_def := pg_temp.r160_body(v_def,
        E'\nbegin\n  -- 20261020150200: the SQL body as it was, in plpgsql so its plan is\n'
        || E'  -- kept for the session instead of rebuilt on every call (ADR-0160).\n'
        || E'  return query\n' || rtrim(v_src, E' \n;') || E';\nend\n', f);
    else
      v_def := pg_temp.r160_body(v_def,
        E'\nbegin\n  -- 20261020150200: the SQL body as it was, in plpgsql so its plan is\n'
        || E'  -- kept for the session instead of rebuilt on every call (ADR-0160).\n'
        || E'  return (\n' || rtrim(v_src, E' \n;') || E'\n  );\nend\n', f);
    end if;
    execute v_def;
    execute format('comment on function %s is %L', f,
      coalesce(obj_description(f::regprocedure::oid, 'pg_proc') || ' ', '')
      || 'Since 20261020150200 plpgsql around the same SQL body, so the plan is kept for the session (ADR-0160).');
  end loop;
end;
$$;

drop function pg_temp.r160_sub(text, text, text, int, text);
drop function pg_temp.r160_body(text, text, text);
