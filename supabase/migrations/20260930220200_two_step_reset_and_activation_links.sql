-- =====================================================================
-- ADR-0054 · Reset someone's two-step from /users, and workers'
-- activation links (E3) fenced like E11
--
-- 1 · admin_reset_two_step(p_user, p_reason) — the lost-phone recovery
--     ADR-0051 left to the Supabase dashboard (its follow-up 2). Owners
--     only (office_can('users')), Back Office logins only, never the
--     caller's own (they use /account, which asks a fresh code). Removes
--     every factor of the login, ends its sessions — an aal2 session made
--     with the lost phone must not outlive the reset — and writes
--     `account.two_step_reset` with the reason. The auth tables are
--     reached with dynamic SQL behind to_regclass, as 20260930210000's
--     session deletion is, so a harness without one skips that step.
--     A login with no verified factor is refused (`no_two_step`): there
--     is nothing to recover, and an audit row saying otherwise would lie.
-- 2 · admin_accounts() gains `two_step boolean` (a verified factor), so
--     /users can offer the reset only where it means something. A changed
--     result shape cannot be `create or replace`d, so it is dropped and
--     re-created — 20260930210100's body, check for check and column for
--     column, with the one column appended (docs/10 §3b; 751 asserts the
--     old refusals and columns as well as the new).
-- 3 · E3 rows in notification_outbox carry a worker's one-time activation
--     link (`payload.link`, §2.7). The table is admin_read, so every Back
--     Office login could read a candidate's link and set that worker's
--     password before they did. Nothing in the Back Office reads E3 rows:
--     /inbox lists only the register's office emails (OFFICE_INBOX), and
--     Accept / Resend queue E3 through definer RPCs, which do not meet
--     RLS. So, as 20260930210600 did for E11:
--       * a RESTRICTIVE select policy — an E3 row is visible only to a
--         session with office_can('users') (an owner). Every other row
--         reads as before;
--       * the redaction trigger now also removes an E3 row's `link` once
--         the row is sent or failed for good. An unsent E3 keeps it —
--         activation_link_refresh() points it at the newest token and the
--         drain sends it. `installLink` (/install) and `name` are not
--         secrets and stay;
--       * rows already finished are redacted now.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · admin_reset_two_step
-- ---------------------------------------------------------------------
create or replace function public.admin_reset_two_step(p_user uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    uuid := auth.uid();
  v_target   profiles;
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_factors  int := 0;
  v_verified int := 0;
  v_sessions int := 0;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  -- Users & access is the owner's (ADR-0050).
  if not office_can('users') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'users';
  end if;
  select * into v_target from profiles where id = p_user for update;
  if v_target.id is null then
    raise exception 'unknown_account' using errcode = 'P0001';
  end if;
  -- Two-step exists for Back Office logins only (ADR-0051).
  if v_target.role <> 'admin' then
    raise exception 'not_office_login' using errcode = 'P0001';
  end if;
  -- Your own is removed on /account, with a fresh code from the phone.
  if p_user = v_actor then
    raise exception 'cannot_reset_own_two_step' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  if to_regclass('auth.mfa_factors') is not null then
    execute 'with gone as (delete from auth.mfa_factors where user_id = $1 returning status::text as status)
             select count(*)::int, (count(*) filter (where status = ''verified''))::int from gone'
       into v_factors, v_verified
      using p_user;
  end if;
  -- Raising undoes the delete above (an abandoned, unverified set-up is
  -- the person's own to clear on /account).
  if v_verified = 0 then
    raise exception 'no_two_step' using errcode = 'P0001';
  end if;

  -- Every session ends: one raised to aal2 with the lost phone would
  -- otherwise stay good until it expired.
  if to_regclass('auth.sessions') is not null then
    execute 'with gone as (delete from auth.sessions where user_id = $1 returning 1)
             select count(*)::int from gone'
       into v_sessions
      using p_user;
  end if;
  if to_regclass('auth.refresh_tokens') is not null then
    execute 'delete from auth.refresh_tokens where user_id = $1' using p_user::text;
  end if;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (v_actor, 'account.two_step_reset', 'account', p_user,
          jsonb_build_object('reason', v_reason, 'factorsRemoved', v_factors,
                             'sessionsEnded', v_sessions));

  return jsonb_build_object('userId', p_user, 'factorsRemoved', v_factors,
                            'sessionsEnded', v_sessions);
end;
$$;

comment on function public.admin_reset_two_step(uuid, text) is
  'ADR-0054 (ADR-0051 recovery): remove a Back Office login''s two-step factors and end its sessions, so they sign in with their password and set two-step up again on /account. Owners only; never the caller''s own; a reason is required; refuses a login with no verified factor. Audited as account.two_step_reset.';

-- ---------------------------------------------------------------------
-- 2 · admin_accounts — 20260930210100's body, plus two_step
-- ---------------------------------------------------------------------
drop function if exists public.admin_accounts(app_role);
create function public.admin_accounts(p_role app_role default null)
returns table (
  id              uuid,
  email           text,
  role            app_role,
  office_role     office_role,
  full_name       text,
  phone           text,
  job_title       text,
  client_id       uuid,
  client_name     text,
  staff_id        uuid,
  created_at      timestamptz,
  last_sign_in_at timestamptz,
  disabled        boolean,
  two_step        boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  -- ADR-0050
  if not office_can('users') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'users';
  end if;
  return query
    select p.id,
           u.email::text,
           p.role,
           p.office_role,
           p.full_name,
           p.phone,
           p.job_title,
           p.client_id,
           c.name,
           s.id,
           p.created_at,
           u.last_sign_in_at,
           coalesce(u.banned_until > now(), false),
           -- ADR-0054: a verified factor, which /users can reset.
           exists (select 1 from auth.mfa_factors f
                    where f.user_id = p.id and f.status::text = 'verified')
      from profiles p
      left join auth.users u on u.id = p.id
      left join clients c    on c.id = p.client_id
      left join staff s      on s.user_id = p.id
     where p_role is null or p.role = p_role
     order by p.role, lower(p.full_name);
end;
$$;

comment on function public.admin_accounts(app_role) is
  '/users: every login with its role, office role, client, last sign-in, whether it is switched off and whether it has two-step on. Back Office owners only (office_can(''users''), ADR-0050).';

-- ---------------------------------------------------------------------
-- 3 · E3 activation links: owners only, and gone once sent
-- ---------------------------------------------------------------------
create policy office_activation_links on notification_outbox
  as restrictive
  for select
  to authenticated
  using (template <> 'E3' or (select office_can('users')));

comment on policy office_activation_links on notification_outbox is
  'ADR-0054: an E3 row carries a worker''s one-time activation link; only a session with office_can(''users'') (an owner) may read it. 20260930220200.';

-- 20260930210600's trigger function, now for E3 as well as E11.
create or replace function public.redact_finished_invite_link()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.template in ('E11', 'E3')
     and (new.sent_at is not null or new.failed_at is not null)
     and new.payload ? 'link' then
    new.payload := (new.payload - 'link') || jsonb_build_object('linkRedacted', true);
  end if;
  return new;
end;
$$;

comment on function public.redact_finished_invite_link() is
  'ADR-0052, ADR-0054: once an E11 (account set-up) or E3 (worker activation) row is sent or has failed for good, its one-time link is removed from the payload (linkRedacted: true).';

-- Rows that finished before this migration.
update notification_outbox
   set payload = (payload - 'link') || jsonb_build_object('linkRedacted', true)
 where template in ('E11', 'E3')
   and (sent_at is not null or failed_at is not null)
   and payload ? 'link';

-- ---------------------------------------------------------------------
-- Grants (docs/14 O7: by name)
-- ---------------------------------------------------------------------
revoke all on function public.admin_reset_two_step(uuid, text) from public, anon;
grant execute on function public.admin_reset_two_step(uuid, text) to authenticated;
revoke all on function public.admin_accounts(app_role) from public, anon;
grant execute on function public.admin_accounts(app_role) to authenticated;
revoke all on function public.redact_finished_invite_link() from public, anon, authenticated;
