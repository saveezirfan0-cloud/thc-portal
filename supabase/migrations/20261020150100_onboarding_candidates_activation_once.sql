-- =====================================================================
-- onboarding_candidates_v asks "has this login a password?" once per
-- statement, not twice per candidate (ADR-0160)
--
-- `activated` and `activated_at` (the board's card, the candidate screen)
-- came from staff_account_activated() and staff_account_activated_at():
-- two SECURITY DEFINER functions, each asking current_app_role() — a
-- four-table auth read — and auth.users for every candidate row. 1,300
-- candidates on the board is 2,600 role reads per refresh.
--
-- Both now come from ONE owner-rights helper, staff_account_activation_v:
--
--   * the same gate, in the view's body: the office, service_role, or the
--     worker whose login it is (`s.user_id = auth.uid()`). The two
--     role reads are `(select …)` InitPlans, evaluated once per statement;
--     the third arm is per row, as it was;
--   * the same values: `activated` is "the login has a password"
--     (coalesce(encrypted_password, '') <> ''), `activated_at` is
--     email_confirmed_at when it has one. Anyone the gate does not admit,
--     and a row with no login, has no row here, and onboarding_candidates_v
--     reads that as it read the functions' answers then: activated false
--     (it already wrapped the function in COALESCE(…, false)), activated_at
--     null;
--   * security_barrier with its owner's rights, like staff_block_reason_v
--     and staff_rejection_reason_v: auth.users is not the caller's to read,
--     and no caller-supplied qual is evaluated ahead of the gate. The join
--     on staff_id is leakproof, so a read by id reaches one row.
--     SELECT for authenticated and service_role only; anon holds nothing.
--
-- staff_account_activated() / _at() are untouched: the staff profile
-- (apps/office/app/staff/[id]) still calls the first by RPC.
--
-- 001_rls_guard pins the owner-rights views by name; this file adds the
-- twenty-third (twentieth selectable, after ADR-0163's three) and that test and docs/14 move with
-- it. pgTAP 886 holds the predicate and compares onboarding_candidates_v
-- with its old definition as the office, a candidate and a client.
--
-- onboarding_candidates_v is re-created from its LIVE definition
-- (docs/10 §3b): pg_get_viewdef() changed by named patterns, each of which
-- must match exactly once or the migration stops, its options read back
-- and restated.
-- =====================================================================

create view public.staff_account_activation_v with (security_barrier = true) as
select s.id                                                  as staff_id,
       coalesce(u.encrypted_password, '') <> ''              as activated,
       case when coalesce(u.encrypted_password, '') <> ''
            then u.email_confirmed_at end                    as activated_at
  from public.staff s
  join auth.users u on u.id = s.user_id
 where (select public.current_app_role()) = 'admin'
    or (select auth.role()) = 'service_role'
    or s.user_id = (select auth.uid());

comment on view public.staff_account_activation_v is
  'Whether a worker''s Staff App login has a password, and since when (email_confirmed_at) — staff_account_activated() / staff_account_activated_at() for many rows at once. Owner rights + security_barrier: the gate is the functions'' own (the office, service_role, or the worker whose login it is), its two role reads evaluated once per statement. No row = not activated (20261020150100, ADR-0160).';

revoke all on public.staff_account_activation_v from public, anon, authenticated, service_role;
grant select on public.staff_account_activation_v to authenticated, service_role;

do $$
declare
  p      record;
  v_def  text;
  v_opts text;
  v_n    int;
begin
  v_def := pg_get_viewdef('public.onboarding_candidates_v'::regclass, true);
  select array_to_string(c.reloptions, ', ') into v_opts
    from pg_class c where c.oid = 'public.onboarding_candidates_v'::regclass;
  for p in
    select * from (values
      ('COALESCE\(staff_account_activated\(s\.id\), false\) AS activated',
       'COALESCE(act.activated, false) AS activated'),
      ('staff_account_activated_at\(s\.id\) AS activated_at',
       'act.activated_at'),
      ('(\n\s+LEFT JOIN profiles p ON p\.id = s\.rejected_by\n)',
       E'\\1     -- 20261020150100: the login, read once per statement (ADR-0160).\n'
       || E'     LEFT JOIN staff_account_activation_v act ON act.staff_id = s.id\n')
    ) as x(pattern, replacement)
  loop
    select count(*) into v_n from regexp_matches(v_def, p.pattern, 'g');
    if v_n <> 1 then
      raise exception '20261020150100: onboarding_candidates_v - expected one match of %, found %', p.pattern, v_n;
    end if;
    v_def := regexp_replace(v_def, p.pattern, p.replacement);
  end loop;
  execute 'create or replace view public.onboarding_candidates_v'
          || case when v_opts is not null then ' with (' || v_opts || ')' else '' end
          || ' as ' || v_def;
end;
$$;
