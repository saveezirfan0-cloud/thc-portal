-- =====================================================================
-- current_app_role() keeps its plan between calls
--
-- /onboarding failed with "canceling statement due to statement
-- timeout" (authenticated runs under statement_timeout = 8s). With 220
-- people on the board, onboarding_candidates_v took 3.6–4.2 s on its own:
-- the view calls helpers per row (onboarding_documents_missing,
-- onboarding_quiz_blockers, current_compliance_docs, …) and every query
-- inside them is RLS-checked through `(select current_app_role())`.
--
-- 747 already makes that check run once per STATEMENT rather than once
-- per row. The cost left is the function itself: a LANGUAGE sql function
-- that cannot be inlined (security definer) re-plans its body — four
-- relations across public and auth — every time a new statement calls
-- it, about 1 ms each. A per-row helper runs several statements, so a
-- 220-row board paid for roughly a thousand fresh plans.
--
-- plpgsql caches the plan for the session. Same body, same NULL when no
-- row matches, same volatility, owner, search_path and grants (create or
-- replace keeps them); measured on the board read: 4.2 s → 1.7 s with
-- every column, 0.37 s with the columns the board reads (the app change
-- that ships alongside this, apps/office/app/onboarding/data.ts).
-- =====================================================================

create or replace function public.current_app_role() returns app_role
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return (
    select p.role
      from profiles p
      join auth.users u on u.id = p.id
     where p.id = auth.uid()
       and (u.banned_until is null or u.banned_until <= now())
       and (p.role <> 'admin'
            or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
            or not exists (select 1 from auth.mfa_factors f
                            where f.user_id = p.id and f.status::text = 'verified'))
       and (p.role <> 'admin'
            or nullif(auth.jwt() ->> 'session_id', '') is null
            or exists (select 1 from auth.sessions s
                        where s.id = (auth.jwt() ->> 'session_id')::uuid))
  );
end $$;

comment on function public.current_app_role() is
  'The caller''s app role for RLS and every admin RPC. NULL — no access — with no session; for a switched-off login; for a Back Office login with a verified two-step factor below aal2; and for a Back Office token whose sign-in session has been ended (reset two-step, switch off, sign out other devices). 20261001204000. plpgsql so the plan is cached per session rather than rebuilt by every statement that calls it (20261012120000).';
