-- =====================================================================
-- A disabled login stops reading its own rows at once (ADR-0163)
--
-- Security review 17.10.2026, M1 (second half). The ten `staff_self*`
-- policies gave a worker their own rows on `user_id = auth.uid()` alone.
-- When the office disables a login (admin_set_login_disabled bans it and
-- deletes its sessions) or the worker signs a stolen phone out, the access
-- token already issued stays valid for up to `jwt_expiry` (1 h), and every
-- RPC refuses it — staff_caller() asks auth_session_live() and the ban —
-- but these ten policies did not, so PostgREST went on serving the rows.
--
-- Each now matches on `(select staff_caller())`: the caller's own staff id
-- if, and only if, the token's session still exists and the login is not
-- banned (20261012120400). That is the same test every worker RPC already
-- makes, so the table path and the RPC path can no longer disagree.
--
-- Cost: staff_caller() is one unique-index lookup on staff.user_id, one
-- primary-key lookup on auth.sessions and one on auth.users. Wrapped in
-- `(select …)` it is an initplan, evaluated once per statement however
-- many rows the policy filters — cheaper than the per-policy subquery on
-- `staff` it replaces, which itself re-entered staff's RLS. An admin or
-- client caller pays the same one call and gets NULL (no staff row), and
-- the service role and definer functions bypass RLS and never call it.
--
-- `alter policy` keeps each policy's name, command, roles and
-- permissiveness as they are on the live project; only the predicate
-- changes. The old predicates are quoted from pg_policies on
-- dgxtqvalfiisfpbwodew (19.10.2026), docs/10 §3b.
-- =====================================================================

-- staff_self: was  user_id = (select auth.uid())
alter policy staff_self on public.staff
  using (id = (select staff_caller()));

-- was  staff_id = (select staff.id from staff where staff.user_id = (select auth.uid()))
alter policy staff_self_bank on public.bank_details
  using (staff_id = (select staff_caller()));
alter policy staff_self_bookings on public.bookings
  using (staff_id = (select staff_caller()));
alter policy staff_self_docs on public.compliance_docs
  using (staff_id = (select staff_caller()));
alter policy staff_self_progress on public.onboarding_progress
  using (staff_id = (select staff_caller()));
alter policy staff_self_push on public.push_subscriptions
  using (staff_id = (select staff_caller()));
alter policy staff_self_quiz on public.quiz_attempts
  using (staff_id = (select staff_caller()));
alter policy staff_self_refs on public.staff_references
  using (staff_id = (select staff_caller()));
alter policy staff_self_roles on public.staff_roles
  using (staff_id = (select staff_caller()));

-- was  booking_id in (select b.id from bookings b join staff s on s.id = b.staff_id
--                     where s.user_id = (select auth.uid()))
alter policy staff_self_pings on public.location_pings
  using (booking_id in (select b.id from public.bookings b
                         where b.staff_id = (select staff_caller())));

-- ---------------------------------------------------------------------
-- Prove every staff_self* policy now asks it (a policy added later under
-- the same prefix without it fails 891, not here).
-- ---------------------------------------------------------------------
do $$
declare
  v_missing text;
begin
  select string_agg(format('%s.%s', tablename, policyname), ', ')
    into v_missing
    from pg_policies
   where schemaname = 'public' and policyname like 'staff\_self%'
     and coalesce(qual, '') !~ 'staff_caller\(\)';
  if v_missing is not null then
    raise exception 'ADR-0163: these staff_self policies do not check the session and the ban: %', v_missing;
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and policyname like 'staff\_self%') <> 10 then
    raise exception 'ADR-0163: expected the ten staff_self policies';
  end if;
end $$;
