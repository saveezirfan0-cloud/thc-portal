-- =====================================================================
-- The Back Office's "Needs review" counter is one count, not the queue
-- (ADR-0166)
--
-- Every Back Office request renders the sidebar, and the sidebar counted
-- compliance_review_queue_v exactly: a PostgREST HEAD with
-- `select=*&count=exact`. PostgREST builds that as the queue itself (every
-- column of every item: the block reason, the previous rejection, the
-- re-upload test, the latest gov.uk check, rtw_check_manual_allowed()) PLUS
-- a second scan for the count, and counts the first by whole rows — so all
-- of it is computed to answer one number. 58 ms locally with 457 items, on
-- every page load of every office user.
--
--   1. compliance_review_queue_count(): the same view, `count(*)`, under
--      the caller's own rights (SECURITY INVOKER — the view is
--      security_invoker, so the office counts what /compliance lists and
--      anyone else counts what their RLS lets them see, as the HEAD did).
--      A count reads no column it does not filter on, so none of the
--      per-item work runs: 12 ms locally. Still exact. Executable by
--      authenticated and service_role; anon holds nothing.
--   2. staff_block_reason_v's admin gate is `(select current_app_role())`,
--      an InitPlan run once per statement. The queue reads it once per item
--      in a correlated subquery (five times over its five branches), and
--      onboarding_returning_v once per applicant, so the gate — a four-table
--      auth read — ran once per row. Still admin-only (20260923090000),
--      still an owner-rights security_barrier view; the same change
--      staff_rejection_reason_v had in 20261019192200.
--
-- staff_block_reason_v is re-created from its LIVE definition (docs/10 §3b)
-- by a named pattern that must match exactly once, its options read back
-- and restated. pgTAP 887 holds the count against the queue as every role
-- and compares the view and the queue with their old definitions.
-- =====================================================================

create function public.compliance_review_queue_count()
returns integer
language sql
stable
set search_path = public, extensions
as $$
  select count(*)::integer from public.compliance_review_queue_v
$$;

comment on function public.compliance_review_queue_count() is
  'The number of items in compliance_review_queue_v as the caller sees it — the Back Office sidebar''s "Needs review" counter (§4.1). SECURITY INVOKER: the view''s own RLS decides, so it is exactly the count of what /compliance lists. A count computes none of the per-item columns (20261020150300, ADR-0166).';

revoke all on function public.compliance_review_queue_count() from public, anon;
grant execute on function public.compliance_review_queue_count() to authenticated, service_role;

do $$
declare
  v_def  text;
  v_opts text;
  v_n    int;
begin
  v_def := pg_get_viewdef('public.staff_block_reason_v'::regclass, true);
  select array_to_string(c.reloptions, ', ') into v_opts
    from pg_class c where c.oid = 'public.staff_block_reason_v'::regclass;
  select count(*) into v_n from regexp_matches(v_def, '(?<![.\w(])current_app_role\(\)', 'g');
  if v_n <> 1 then
    raise exception '20261020150300: staff_block_reason_v - expected one current_app_role(), found %', v_n;
  end if;
  v_def := regexp_replace(v_def, '(?<![.\w(])current_app_role\(\)', '( SELECT current_app_role() AS current_app_role)');
  execute 'create or replace view public.staff_block_reason_v'
          || case when v_opts is not null then ' with (' || v_opts || ')' else '' end
          || ' as ' || v_def;
end;
$$;
