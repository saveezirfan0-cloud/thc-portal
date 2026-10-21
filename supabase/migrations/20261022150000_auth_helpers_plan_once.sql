-- =====================================================================
-- Migration 20261022150000 · the sign-in helpers under every RLS check are
--                            planned once per session (after ADR-0155,
--                            ADR-0166)
--
-- Every office read pays current_app_role() once per table it touches (the
-- admin_all policies, as an InitPlan), and every invoker helper that reads
-- a table under RLS pays it again per call — weekly_cap_for() per row of
-- staff_directory_v, onboarding_documents_missing() per card on
-- /onboarding, the pool's RULE-20 verdict per worker on the event board.
-- current_app_role() was made plpgsql for exactly this (20261012120000,
-- pgTAP 786), but ADR-0164 (20261020130000) gave it a new step for a real
-- sign-in session: `select … from office_security_settings() o`. That is a
-- SQL function with a pinned search_path, never inlined, called from a
-- FROM clause, so its body is parsed and planned again on every call
-- (ADR-0155 §Context). staff_caller() — the other half of every
-- staff-or-admin policy — has the same problem one level down:
-- `and auth_session_live()` inside its query.
--
-- Measured on the live project (22.10.2026, read-only, an office session
-- WITH a session_id claim, as every production token carries; a loop of
-- 300 calls, plpgsql bodies emulated as static SQL in a DO block):
--
--   current_app_role()        0.40–0.52 ms a call  →  0.12 ms
--   staff_caller()            0.31–0.36 ms         →  0.06–0.07 ms
--   office_security_settings  0.28–0.35 ms         →  0.03 ms
--   office_can('finance')     0.49–1.25 ms         →  0.51–0.75 ms (body only;
--                                                     the rest is current_app_role)
--   staff_identity_facts()    0.78–1.55 ms         →  0.63–0.66 ms (likewise)
--   reviewer_name()           0.76–0.92 ms         →  0.53–0.62 ms (likewise)
--
-- An office page runs dozens of these: /onboarding's board read held ~25
-- InitPlans plus ~5 nested checks per card, /staff ~4 per directory row.
--
-- Five SQL SECURITY DEFINER helpers become plpgsql around the SAME body,
-- exactly as 20261020150200 did for the compliance chain: `return ( … );`
-- for the three that return one value, `return query …;` for the one that
-- returns a table, and `select q.* into <OUT params> from ( … ) q;` for the
-- one with OUT parameters (office_security_settings: one aggregate row,
-- always). A definer is never inlined, so nothing that was inlined stops
-- being. Security, pins, volatility, grants and comments are untouched; the
-- comment gains a line saying so.
--
--   office_security_settings()  auth_session_live()  office_can(text)
--   staff_identity_facts(uuid)  reviewer_name(uuid)
--
-- A scalar SQL function answers its query's FIRST row, `return ( … )` an
-- error on a second one; none of the four can have two (no FROM, an
-- aggregate, or a lookup by primary key), and none or a NULL is NULL in
-- both. No rule changes: who each one answers, and what, is its body, which
-- is carried over byte for byte. The tests of what they answer (745, 747, 750,
-- 790, 807, 890, 892, 895) pass unchanged.
--
-- Re-created from the LIVE definitions (docs/10 §3b): pg_get_functiondef()
-- with the language and the body wrapper changed; each must still be a
-- single-statement SQL definer with its pin, or the migration stops.
-- =====================================================================

create function pg_temp.r220_sub(p_def text, p_pattern text, p_replacement text, p_expect int, p_label text)
returns text language plpgsql as $f$
declare v_n int;
begin
  select count(*) into v_n from regexp_matches(p_def, p_pattern, 'g');
  if v_n <> p_expect then
    raise exception '20261022150000: % - expected % match(es) of %, found %', p_label, p_expect, p_pattern, v_n;
  end if;
  return regexp_replace(p_def, p_pattern, p_replacement, 'g');
end $f$;

-- Replace everything between the dollar quotes of a pg_get_functiondef() text.
create function pg_temp.r220_body(p_def text, p_body text, p_label text)
returns text language plpgsql as $f$
declare v_at int := position('AS $function$' in p_def);
begin
  if v_at = 0 or right(rtrim(p_def, E' \n'), 10) <> '$function$' then
    raise exception '20261022150000: % - unexpected definition shape', p_label;
  end if;
  return left(p_def, v_at - 1) || 'AS $function$' || p_body || '$function$';
end $f$;

do $$
declare
  f      text;
  v_def  text;
  v_src  text;
  v_outs text;
  v_note constant text :=
    E'  -- 20261022150000: the SQL body as it was, in plpgsql so its plan is\n'
    || E'  -- kept for the session instead of rebuilt on every call (ADR-0155).\n';
begin
  foreach f in array array[
    'public.office_security_settings()',
    'public.auth_session_live()',
    'public.office_can(text)',
    'public.staff_identity_facts(uuid)',
    'public.reviewer_name(uuid)'
  ] loop
    v_def := pg_get_functiondef(f::regprocedure);
    select p.prosrc into v_src from pg_proc p where p.oid = f::regprocedure;
    if v_def !~ E'\n SET search_path TO ' then
      raise exception '20261022150000: % has lost its pinned search_path', f;
    end if;
    if v_def !~ 'SECURITY DEFINER' then
      raise exception '20261022150000: % is no longer a security definer; re-read it before changing it', f;
    end if;
    if v_src ~ ';\s*\S' then
      raise exception '20261022150000: % has more than one statement', f;
    end if;
    v_def := pg_temp.r220_sub(v_def, E'\n LANGUAGE sql\n', E'\n LANGUAGE plpgsql\n', 1, f || ' language');

    -- OUT / TABLE columns become plpgsql variables, so the body must not
    -- use them as bare identifiers (qualified is fine).
    if exists (select 1 from pg_proc p, unnest(p.proargnames, p.proargmodes) a(n, m)
                where p.oid = f::regprocedure and a.m in ('o', 't')
                  and regexp_replace(v_src, '--[^\n]*', '', 'g') ~ ('(?<![.\w:])' || a.n || '(?!\w)')) then
      raise exception '20261022150000: % - a result column is named in the body', f;
    end if;

    select string_agg(a.n, ', ' order by a.ord) into v_outs
      from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality a(n, m, ord)
     where p.oid = f::regprocedure and a.m = 'o';

    if (select p.proretset from pg_proc p where p.oid = f::regprocedure) then
      v_def := pg_temp.r220_body(v_def,
        E'\nbegin\n' || v_note || E'  return query\n' || rtrim(v_src, E' \n;') || E';\nend\n', f);
    elsif v_outs is not null then
      -- One row with OUT parameters: the body's single row, into them.
      v_def := pg_temp.r220_body(v_def,
        E'\nbegin\n' || v_note || E'  select q.* into ' || v_outs || E' from (\n'
        || rtrim(v_src, E' \n;') || E'\n  ) q;\nend\n', f);
    else
      v_def := pg_temp.r220_body(v_def,
        E'\nbegin\n' || v_note || E'  return (\n' || rtrim(v_src, E' \n;') || E'\n  );\nend\n', f);
    end if;
    execute v_def;
    execute format('comment on function %s is %L', f,
      coalesce(obj_description(f::regprocedure::oid, 'pg_proc') || ' ', '')
      || 'Since 20261022150000 plpgsql around the same SQL body, so the plan is kept for the session (ADR-0155).');
  end loop;
end;
$$;

drop function pg_temp.r220_sub(text, text, text, int, text);
drop function pg_temp.r220_body(text, text, text);
