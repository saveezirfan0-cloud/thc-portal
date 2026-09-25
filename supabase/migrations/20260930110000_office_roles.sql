-- =====================================================================
-- Office roles: owner / manager / scheduler, enforced in the database
-- (ADR-0036; ADR-0035 "Proposal, not built: finer office permissions";
-- §1.4 roles and access, §9.8 roles & rates, §9.9 reports, §9.11/§9.12
-- settings)
--
-- Every Back Office login is `profiles.role = 'admin'`, and until now every
-- policy and RPC asked only that. This adds a second, office-only axis
-- WITHOUT touching `app_role`: routing, the three apps' middleware and
-- every existing `current_app_role() = 'admin'` predicate stay as they are.
-- What changes is that three kinds of object now also ask
-- `office_can(<permission>)`:
--
--   users    — /users: the account functions of 20260930100000 and the
--              new admin_set_office_role. Owner only.
--   settings — writes to `settings` and `venue_types` (/settings). Owner
--              only.
--   finance  — money-only objects: bank_details, payroll_export_lines,
--              report_sends, the five report RPCs, the margin / rate-card /
--              role-rate views; writes to roles, client_rate_cards and the
--              rates on shift_requirements. Owner and manager.
--
-- What the scheduler can STILL read is stated in ADR-0036 ("Residual
-- gaps"), not hidden here: the rate columns on roles, shift_requirements,
-- client_rate_cards and payable_shifts_v are on rows scheduling needs, and
-- RLS filters rows, not columns.
--
-- Nothing here edits an earlier migration. The four account functions are
-- re-created with every check their 20260930100000 body had, in the same
-- order, plus the new one — 651_office_roles asserts the old refusals as
-- well as the new ones (docs/10 §3b). The five report RPCs are re-created
-- from their live bodies with exactly one line changed:
-- `assert_reports_caller()` → `assert_finance_caller()`.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · profiles.office_role
-- ---------------------------------------------------------------------
create type office_role as enum ('owner', 'manager', 'scheduler');

alter table profiles add column office_role office_role;

-- Every Back Office login that exists today had full access, so it keeps it.
update profiles set office_role = 'owner' where role = 'admin' and office_role is null;

-- A row made outside admin_register_account — the Supabase dashboard, the
-- seed, a test fixture — is by definition made by someone who already holds
-- the database, so it gets what every admin had before this migration:
-- owner. The invite path passes its own role (default 'manager') and never
-- relies on this. INSERT only: blanking the role of an existing admin row
-- must meet the check constraint below, never be "repaired" to owner.
create or replace function public.profiles_office_role_default()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role = 'admin' and new.office_role is null then
    new.office_role := 'owner';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_office_role_default on profiles;
create trigger profiles_office_role_default
  before insert on profiles
  for each row execute function public.profiles_office_role_default();

alter table profiles
  add constraint profiles_office_role_admin_only
  check ((role = 'admin') = (office_role is not null));

comment on column profiles.office_role is
  'Back Office permission level (ADR-0036): owner = everything; manager = everything but Users & access and Settings; scheduler = also no money. Set for admin rows only (check constraint); changed only through admin_set_office_role().';

-- ---------------------------------------------------------------------
-- 2 · office_can — the one question every gate below asks
--
-- False for anything that is not a Back Office login, for an unknown
-- permission name (a typo fails closed), and for no session at all. Like
-- current_app_role() it reads `profiles` live, so a role change takes
-- effect on the next request — and, like it, it does not read
-- auth.users.banned_until (ADR-0035 "Known limit").
-- ---------------------------------------------------------------------
create or replace function public.office_can(p_perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p_perm in ('users', 'settings', 'finance')
           and case p.office_role
                 when 'owner'     then true
                 when 'manager'   then p_perm = 'finance'
                 when 'scheduler' then false
                 else false
               end
      from profiles p
     where p.id = auth.uid() and p.role = 'admin'), false)
$$;

comment on function public.office_can(text) is
  'ADR-0036: may the signed-in Back Office login use ''users'' | ''settings'' | ''finance''? owner: all three; manager: finance; scheduler: none. False for any other session and any other permission name.';

-- The report RPCs' gate (20260923130000) plus finance. assert_reports_caller
-- itself is left alone: the §11.3 allocation sheet and timesheet functions
-- share it, and a scheduler prints those.
create or replace function public.assert_finance_caller()
returns void
language plpgsql
stable
set search_path = public, extensions
as $$
begin
  perform assert_reports_caller();
  if current_app_role() = 'admin' and not office_can('finance') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'finance';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 3 · /users — the account functions now require 'users'
--
-- Each body below is 20260930100000's, check for check; the additions are
-- marked "ADR-0036".
-- ---------------------------------------------------------------------

-- 3a · admin_accounts gains the office_role column (a changed result
-- shape cannot be `create or replace`d, so it is dropped first).
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
  disabled        boolean
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
  -- ADR-0036
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
           coalesce(u.banned_until > now(), false)
      from profiles p
      left join auth.users u on u.id = p.id
      left join clients c    on c.id = p.client_id
      left join staff s      on s.user_id = p.id
     where p_role is null or p.role = p_role
     order by p.role, lower(p.full_name);
end;
$$;

comment on function public.admin_accounts(app_role) is
  '/users: every login with its role, office role, client, last sign-in and whether it is switched off. Back Office owners only (office_can(''users''), ADR-0036).';

-- 3b · admin_register_account gains p_office_role.
--
-- Two signatures, deliberately. The six-argument one is the real one and
-- takes the office role explicitly. The five-argument one — 20260930100000's
-- signature, kept so existing callers and grants do not change — hands
-- over 'manager' for an admin login: that is the "defaults to manager".
-- A single function with a defaulted sixth argument would make every
-- five-argument call ambiguous between the two ("function is not unique"),
-- so the sixth argument has no default and the old signature carries it.
create or replace function public.admin_register_account(
  p_user        uuid,
  p_role        app_role,
  p_full_name   text,
  p_client      uuid,
  p_job_title   text,
  p_office_role office_role
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    uuid := auth.uid();
  v_email    text;
  v_meta     text;
  v_existing profiles;
  v_name     text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_title    text := nullif(btrim(coalesce(p_job_title, '')), '');
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  -- ADR-0036
  if not office_can('users') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'users';
  end if;
  -- A worker's login comes from Accept (§2.4, §2.7), with its staff row.
  if p_role not in ('admin', 'client') then
    raise exception 'role_not_allowed' using errcode = 'P0001';
  end if;
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'name_required' using errcode = 'P0001';
  end if;
  if p_role = 'client' then
    if p_client is null then
      raise exception 'client_required' using errcode = 'P0001';
    end if;
    if not exists (select 1 from clients where id = p_client) then
      raise exception 'unknown_client' using errcode = 'P0001';
    end if;
  elsif p_client is not null then
    raise exception 'client_not_allowed' using errcode = 'P0001';
  end if;
  -- ADR-0036: an office role belongs to an admin login and to nothing else.
  if p_role = 'admin' and p_office_role is null then
    raise exception 'office_role_required' using errcode = 'P0001';
  end if;
  if p_role <> 'admin' and p_office_role is not null then
    raise exception 'office_role_not_allowed' using errcode = 'P0001';
  end if;

  select u.email::text, u.raw_app_meta_data ->> 'role'
    into v_email, v_meta
    from auth.users u where u.id = p_user;
  if v_email is null then
    raise exception 'unknown_account' using errcode = 'P0001';
  end if;

  -- Never turn an existing login into another kind. A worker's email
  -- typed into the office invite would otherwise become an admin login.
  if (v_meta is not null and v_meta <> p_role::text)
     or exists (select 1 from staff where user_id = p_user) then
    raise exception 'account_has_other_role' using errcode = 'P0001';
  end if;
  select * into v_existing from profiles where id = p_user for update;
  if v_existing.id is not null and v_existing.role <> p_role then
    raise exception 'account_has_other_role' using errcode = 'P0001';
  end if;
  -- Nor move a client login to another client: the portal would start
  -- showing that person the other company's events.
  if v_existing.id is not null and v_existing.client_id is distinct from p_client then
    raise exception 'account_has_other_client' using errcode = 'P0001';
  end if;

  -- ADR-0036: the office role is set on a NEW login only. A re-invite
  -- (New invite link) leaves an existing login's role alone — changing it
  -- is admin_set_office_role's job, with its own audit row and its
  -- last-owner guard, and a re-invite must never demote an owner.
  insert into profiles (id, role, office_role, full_name, client_id, job_title, updated_at)
  values (p_user, p_role, p_office_role, v_name, p_client, v_title, now())
  on conflict (id) do update
     set full_name = excluded.full_name,
         client_id = excluded.client_id,
         job_title = excluded.job_title,
         updated_at = now();

  -- Every app's middleware admits on app_metadata.role (packages/db
  -- session.ts); the user cannot write it, and neither can this app's
  -- browser code.
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', p_role::text),
         updated_at = now()
   where id = p_user;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (v_actor,
          case when v_existing.id is null then 'account.invited' else 'account.reinvited' end,
          'account', p_user,
          jsonb_strip_nulls(jsonb_build_object(
            'role', p_role::text, 'clientId', p_client, 'email', v_email,
            'officeRole', case when v_existing.id is null then p_office_role::text
                               else v_existing.office_role::text end)));

  return jsonb_build_object('userId', p_user, 'email', v_email, 'role', p_role::text,
                            'officeRole', coalesce(v_existing.office_role, p_office_role)::text,
                            'created', v_existing.id is null);
end;
$$;

comment on function public.admin_register_account(uuid, app_role, text, uuid, text, office_role) is
  '/users Invite: gives a GoTrue login minted by the office''s service key its profile, office role (new admin logins only) and app_metadata.role (admin or client — never staff). Refuses to change the kind of an existing login. Back Office owners only (ADR-0036); audited as account.invited / account.reinvited.';

create or replace function public.admin_register_account(
  p_user      uuid,
  p_role      app_role,
  p_full_name text,
  p_client    uuid default null,
  p_job_title text default null
) returns jsonb
language sql
security invoker
set search_path = public
as $$
  select public.admin_register_account(
    p_user, p_role, p_full_name, p_client, p_job_title,
    case when p_role = 'admin' then 'manager'::office_role end)
$$;

comment on function public.admin_register_account(uuid, app_role, text, uuid, text) is
  '20260930100000''s signature, kept: calls the six-argument admin_register_account with office role ''manager'' for an admin login (ADR-0036''s default). Every check is the six-argument function''s.';

-- 3c · admin_login_lookup
create or replace function public.admin_login_lookup(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_meta   text;
  v_signed boolean;
  v_role   app_role;
  v_client uuid;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  -- ADR-0036
  if not office_can('users') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'users';
  end if;
  select u.id, u.raw_app_meta_data ->> 'role', u.last_sign_in_at is not null
    into v_id, v_meta, v_signed
    from auth.users u
   where lower(u.email) = lower(btrim(coalesce(p_email, '')))
   limit 1;
  if v_id is null then
    return jsonb_build_object('exists', false);
  end if;
  select p.role, p.client_id into v_role, v_client from profiles p where p.id = v_id;
  return jsonb_build_object(
    'exists', true,
    'userId', v_id,
    'role', coalesce(v_role::text, v_meta),
    'clientId', v_client,
    'isStaff', exists (select 1 from staff s where s.user_id = v_id),
    'signedIn', v_signed);
end;
$$;

comment on function public.admin_login_lookup(text) is
  '/users Invite: whether an address already has a login, its kind, client and whether it has ever been signed in to — asked before any token is minted. Back Office owners only (ADR-0036).';

-- 3d · admin_set_login_disabled
create or replace function public.admin_set_login_disabled(
  p_user     uuid,
  p_disabled boolean,
  p_reason   text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_target profiles;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  -- ADR-0036
  if not office_can('users') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'users';
  end if;
  select * into v_target from profiles where id = p_user;
  if v_target.id is null then
    raise exception 'unknown_account' using errcode = 'P0001';
  end if;
  -- A worker is blocked or removed on their staff profile (§9.6, §1.7),
  -- which also takes them off their shifts; a bare login switch would not.
  if v_target.role = 'staff' then
    raise exception 'use_staff_block' using errcode = 'P0001';
  end if;
  if p_disabled and p_user = v_actor then
    raise exception 'cannot_disable_self' using errcode = 'P0001';
  end if;
  if p_disabled and v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  -- The office must never be able to lock itself out entirely.
  if p_disabled and v_target.role = 'admin' and not exists (
       select 1 from profiles p join auth.users u on u.id = p.id
        where p.role = 'admin' and p.id <> p_user
          and (u.banned_until is null or u.banned_until <= now())) then
    raise exception 'last_admin' using errcode = 'P0001';
  end if;
  -- ADR-0036: nor lose the last working owner — the only role that can
  -- manage logins, so without one nobody could invite or switch anyone
  -- back on. The owner rows are locked first so two owners switching each
  -- other off at once cannot both pass.
  if p_disabled and v_target.office_role = 'owner' then
    perform 1 from profiles where office_role = 'owner' order by id for update;
    if not exists (
         select 1 from profiles p join auth.users u on u.id = p.id
          where p.office_role = 'owner' and p.id <> p_user
            and (u.banned_until is null or u.banned_until <= now())) then
      raise exception 'last_owner' using errcode = 'P0001';
    end if;
  end if;

  update auth.users
     set banned_until = case when p_disabled then now() + interval '100 years' else null end,
         updated_at = now()
   where id = p_user;

  -- A live session must not outlast the switch. Supabase's auth schema
  -- has both tables; a harness without them simply skips the step.
  if p_disabled then
    if to_regclass('auth.sessions') is not null then
      execute 'delete from auth.sessions where user_id = $1' using p_user;
    end if;
    if to_regclass('auth.refresh_tokens') is not null then
      execute 'delete from auth.refresh_tokens where user_id = $1' using p_user::text;
    end if;
  end if;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (v_actor,
          case when p_disabled then 'account.disabled' else 'account.enabled' end,
          'account', p_user,
          jsonb_strip_nulls(jsonb_build_object('role', v_target.role::text, 'reason', v_reason)));

  return jsonb_build_object('userId', p_user, 'disabled', p_disabled);
end;
$$;

comment on function public.admin_set_login_disabled(uuid, boolean, text) is
  '/users: switch an office or client login off (sign-in refused, sessions ended) or back on. Refuses staff (use Block), the caller''s own login, the last working admin and the last working owner. Back Office owners only (ADR-0036); audited.';

-- 3e · admin_set_office_role — new
create or replace function public.admin_set_office_role(
  p_user uuid,
  p_role office_role
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_target profiles;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if not office_can('users') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'users';
  end if;
  if p_role is null then
    raise exception 'office_role_required' using errcode = 'P0001';
  end if;
  -- Lock every owner row before reading any: two owners demoting each
  -- other at the same moment must not both see "another owner remains".
  perform 1 from profiles where office_role = 'owner' order by id for update;
  select * into v_target from profiles where id = p_user for update;
  if v_target.id is null then
    raise exception 'unknown_account' using errcode = 'P0001';
  end if;
  if v_target.role <> 'admin' then
    raise exception 'not_office_login' using errcode = 'P0001';
  end if;
  -- An owner cannot promote or demote themselves: the change is always
  -- another owner's decision, and the owner who makes it stays one.
  if p_user = v_actor then
    raise exception 'cannot_change_own_role' using errcode = 'P0001';
  end if;
  if v_target.office_role = p_role then
    return jsonb_build_object('userId', p_user, 'officeRole', p_role::text, 'changed', false);
  end if;
  -- Never leave zero working owners (switched-off ones do not count).
  if v_target.office_role = 'owner' and not exists (
       select 1 from profiles p join auth.users u on u.id = p.id
        where p.office_role = 'owner' and p.id <> p_user
          and (u.banned_until is null or u.banned_until <= now())) then
    raise exception 'last_owner' using errcode = 'P0001';
  end if;

  update profiles set office_role = p_role, updated_at = now() where id = p_user;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (v_actor, 'account.role_changed', 'account', p_user,
          jsonb_build_object('from', v_target.office_role::text, 'to', p_role::text));

  return jsonb_build_object('userId', p_user, 'officeRole', p_role::text, 'changed', true);
end;
$$;

comment on function public.admin_set_office_role(uuid, office_role) is
  '/users Change role: set a Back Office login''s office role (owner / manager / scheduler). Back Office owners only; never the caller''s own; never leaves zero working owners. Audited as account.role_changed.';

-- ---------------------------------------------------------------------
-- 4 · settings — writes need 'settings' (owner)
--
-- Restrictive, so they narrow admin_all rather than replace it; reads are
-- untouched (the event board reads scoring_weights, the venue form reads
-- venue_types). `to authenticated` only: anon has no permissive policy to
-- narrow, and would otherwise meet office_can's grant instead of RLS.
-- ---------------------------------------------------------------------
create policy office_settings_insert on settings as restrictive for insert to authenticated
  with check ((select office_can('settings')));
create policy office_settings_update on settings as restrictive for update to authenticated
  using ((select office_can('settings'))) with check ((select office_can('settings')));
create policy office_settings_delete on settings as restrictive for delete to authenticated
  using ((select office_can('settings')));

create policy office_settings_insert on venue_types as restrictive for insert to authenticated
  with check ((select office_can('settings')));
create policy office_settings_update on venue_types as restrictive for update to authenticated
  using ((select office_can('settings'))) with check ((select office_can('settings')));
create policy office_settings_delete on venue_types as restrictive for delete to authenticated
  using ((select office_can('settings')));

-- ---------------------------------------------------------------------
-- 5 · finance — money-only tables
-- ---------------------------------------------------------------------

-- 5a · Rate WRITES on the two catalogue tables. Their READS stay open to
-- every admin: the event builder reads role names and each client's dress
-- codes off these rows (ADR-0036 "Residual gaps"). The predicate names
-- 'admin' so 001_rls_guard 5b still reads it as admin-only.
create policy office_finance_insert on roles as restrictive for insert to authenticated
  with check (current_app_role() = 'admin'::app_role and (select office_can('finance')));
create policy office_finance_update on roles as restrictive for update to authenticated
  using (current_app_role() = 'admin'::app_role and (select office_can('finance')))
  with check (current_app_role() = 'admin'::app_role and (select office_can('finance')));
create policy office_finance_delete on roles as restrictive for delete to authenticated
  using (current_app_role() = 'admin'::app_role and (select office_can('finance')));

create policy office_finance_insert on client_rate_cards as restrictive for insert to authenticated
  with check (current_app_role() = 'admin'::app_role and (select office_can('finance')));
create policy office_finance_update on client_rate_cards as restrictive for update to authenticated
  using (current_app_role() = 'admin'::app_role and (select office_can('finance')))
  with check (current_app_role() = 'admin'::app_role and (select office_can('finance')));
create policy office_finance_delete on client_rate_cards as restrictive for delete to authenticated
  using (current_app_role() = 'admin'::app_role and (select office_can('finance')));

-- 5b · READS of the tables that are nothing but money. The worker's own
-- bank_details read (staff_self_bank) passes: the predicate only narrows
-- Back Office logins.
create policy office_finance_read on bank_details as restrictive for select to authenticated
  using (current_app_role() is distinct from 'admin'::app_role or (select office_can('finance')));
create policy office_finance_read on payroll_export_lines as restrictive for select to authenticated
  using (current_app_role() is distinct from 'admin'::app_role or (select office_can('finance')));
create policy office_finance_read on report_sends as restrictive for select to authenticated
  using (current_app_role() is distinct from 'admin'::app_role or (select office_can('finance')));

-- 5c · bank_details WRITES. Not a policy: 571_bank_details_write_path pins
-- admin_all as the only write-capable policy on the table. A trigger in
-- the event_edit_lock_guard shape instead — it acts only on a direct
-- PostgREST write (current_user = 'authenticated'), so staff_save_bank()
-- and remove_worker(), which run as their owner, are untouched.
create or replace function public.office_finance_write_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user = 'authenticated'
     and current_app_role() = 'admin'
     and not office_can('finance') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'finance';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists bank_details_office_finance on bank_details;
create trigger bank_details_office_finance
  before insert or update or delete on bank_details
  for each row execute function public.office_finance_write_guard();

-- 5d · booking_payroll_exported() read payroll_export_lines as its caller,
-- so 5b would have silently answered "not exported" to a scheduler
-- resolving a violation — and RULE-06's "already in payroll" warning on
-- the check-in screen would have vanished for them. It returns one boolean
-- about one booking and no money, so it now reads as its owner.
create or replace function public.booking_payroll_exported(p_booking uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (select 1 from payroll_export_lines
                  where booking_id = p_booking and state = 'exported')
$$;

-- ---------------------------------------------------------------------
-- 6 · finance — rates on a role section
--
-- shift_requirements is the heart of scheduling, so a scheduler writes it.
-- What they may not do is price it: on a direct write by a Back Office
-- login without 'finance', a new section must carry the catalogue rates
-- (the role's pay_rate; the client's rate-card charge, or 0 where the
-- client has none — the event builder's own default), and an edit must
-- leave the rates as they were unless the role itself changes, in which
-- case the new role's catalogue rates apply. A manager re-prices later.
-- ---------------------------------------------------------------------
create or replace function public.shift_rates_office_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_pay    numeric;
  v_charge numeric;
begin
  if current_user <> 'authenticated'
     or current_app_role() is distinct from 'admin'
     or office_can('finance') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.role_id is not distinct from old.role_id then
    if new.pay_rate is distinct from old.pay_rate
       or new.charge_rate is distinct from old.charge_rate then
      raise exception 'rates_need_finance' using errcode = '42501',
        detail = 'Changing a pay or charge rate needs a manager (ADR-0036).';
    end if;
    return new;
  end if;
  select r.pay_rate into v_pay from roles r where r.id = new.role_id;
  select coalesce(max(rc.charge_rate), 0) into v_charge
    from client_rate_cards rc join events e on e.client_id = rc.client_id
   where e.id = new.event_id and rc.role_id = new.role_id;
  if new.pay_rate is distinct from v_pay or new.charge_rate is distinct from v_charge then
    raise exception 'rates_need_finance' using errcode = '42501',
      detail = 'A scheduler''s role section carries the role''s pay rate and the client''s rate-card charge (ADR-0036).';
  end if;
  return new;
end;
$$;

drop trigger if exists shift_requirements_rates_office on shift_requirements;
create trigger shift_requirements_rates_office
  before insert or update of role_id, pay_rate, charge_rate on shift_requirements
  for each row execute function public.shift_rates_office_guard();

-- ---------------------------------------------------------------------
-- 7 · finance — the report RPCs
--
-- Their live bodies (20260923130000 and its successors), unchanged but
-- for the first statement: assert_reports_caller() → assert_finance_caller().
-- ---------------------------------------------------------------------
create or replace function public.finance_report(p_from date, p_to date, p_by text default 'day'::text)
returns table(group_key text, group_label text, is_total boolean, events text[], event_count integer, payable_min integer, base numeric, holiday numeric, payroll numeric, invoicing numeric, margin numeric, margin_pct numeric, actual_sections integer, forecast_sections integer, pending integer, cancelled_events text[])
language plpgsql
stable security definer
set search_path to 'public', 'extensions'
as $function$
#variable_conflict use_column
begin
  perform assert_finance_caller();
  if p_by not in ('day', 'client', 'role') then
    raise exception 'unknown_grouping' using errcode = '22023';
  end if;

  return query
  with sections as (
    select sr.id as shift_id, e.id as event_id, e.title, c.name as client_name, r.name as role_name,
           uk_local(sr.starts_at)::date as day,
           sr.headcount, sr.pay_rate, sr.charge_rate,
           (extract(epoch from (sr.ends_at - sr.starts_at)) / 60)::int as section_min,
           e.cancelled_at is not null
             and uk_local(e.cancelled_at)::date < e.event_date                    as excluded,
           e.cancelled_at is not null
             and uk_local(e.cancelled_at)::date >= e.event_date                   as cancelled_on_day,
           now() < sr.ends_at                                                      as open
      from shift_requirements sr
      join events e  on e.id = sr.event_id
      join clients c on c.id = e.client_id
      join roles r   on r.id = sr.role_id
     where uk_local(sr.starts_at)::date between p_from and p_to
  ),
  actual as (
    select l.shift_id,
           coalesce(sum(l.payable_min) filter (where l.status = 'settled'), 0)::int as payable_min,
           coalesce(sum(l.base), 0)      as base,
           coalesce(sum(l.holiday), 0)   as holiday,
           coalesce(sum(l.invoicing), 0) as invoicing,
           count(*) filter (where l.status = 'pending')::int as pending
      from report_payroll_lines_v l
     where l.kind <> 'no_show'
       and l.shift_date between p_from and p_to
     group by l.shift_id
  ),
  priced as (
    select s.*,
           case
             when s.excluded then 'excluded'
             when s.open and not s.cancelled_on_day then 'forecast'
             else 'actual'
           end as basis,
           a.payable_min as a_min, a.base as a_base, a.holiday as a_holiday,
           a.invoicing as a_invoicing, coalesce(a.pending, 0) as a_pending
      from sections s
      left join actual a on a.shift_id = s.shift_id
  ),
  lines as (
    select p.*,
           case p.basis when 'forecast' then p.headcount * p.section_min
                        when 'actual'   then coalesce(p.a_min, 0) else 0 end            as l_min,
           case p.basis when 'forecast' then round(p.pay_rate * p.headcount * p.section_min / 60, 2)
                        when 'actual'   then coalesce(p.a_base, 0) else 0 end           as l_base,
           case p.basis when 'forecast'
                          then shift_holiday_pay(round(p.pay_rate * p.headcount * p.section_min / 60, 2))
                        when 'actual'   then coalesce(p.a_holiday, 0) else 0 end        as l_holiday,
           case p.basis when 'forecast' then round(p.charge_rate * p.headcount * p.section_min / 60, 2)
                        when 'actual'   then coalesce(p.a_invoicing, 0) else 0 end      as l_invoicing
      from (select pr.*,
                   case p_by when 'day'    then pr.day::text
                             when 'client' then pr.client_name
                             else pr.role_name end as by_key,
                   case p_by when 'day'    then to_char(pr.day, 'Dy DD Mon')
                             when 'client' then pr.client_name
                             else pr.role_name end as by_label
              from priced pr) p
  )
  select
    l.by_key,
    min(l.by_label),
    grouping(l.by_key) = 1,
    coalesce(array_agg(distinct l.title) filter (where l.basis <> 'excluded'), '{}'),
    count(distinct l.event_id) filter (where l.basis <> 'excluded')::int,
    coalesce(sum(l.l_min), 0)::int,
    coalesce(sum(l.l_base), 0),
    coalesce(sum(l.l_holiday), 0),
    coalesce(sum(l.l_base + l.l_holiday), 0),
    coalesce(sum(l.l_invoicing), 0),
    coalesce(sum(l.l_invoicing - l.l_base - l.l_holiday), 0),
    -- Null, never 0%, when nothing is invoiced: an empty week has no margin.
    case when coalesce(sum(l.l_invoicing), 0) > 0
         then round((sum(l.l_invoicing - l.l_base - l.l_holiday) / sum(l.l_invoicing)) * 100, 1) end,
    count(*) filter (where l.basis = 'actual')::int,
    count(*) filter (where l.basis = 'forecast')::int,
    coalesce(sum(l.a_pending) filter (where l.basis = 'actual'), 0)::int,
    coalesce(array_agg(distinct l.title) filter (where l.basis = 'excluded'), '{}')
  from lines l
  group by grouping sets ((l.by_key), ())
  order by grouping(l.by_key), l.by_key;
end $function$;

create or replace function public.retry_finance_report(p_send bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v    report_sends;
  v_old notification_outbox;
  v_key text;
  v_n  int;
begin
  perform assert_finance_caller();
  select * into v from report_sends where id = p_send;
  if v.id is null or v.outbox_key is null then
    raise exception 'unknown_report_send' using errcode = 'P0002';
  end if;
  if v.status <> 'failed' then
    raise exception 'not_failed' using errcode = 'P0001';
  end if;
  select * into v_old from notification_outbox where key = v.outbox_key;
  select count(*) into v_n from notification_outbox where key like 'BG08:' || v.period_start::text || '%';
  v_key := 'BG08:' || v.period_start::text || ':retry:' || v_n;

  insert into notification_outbox (key, channel, template, payload)
  values (v_key, 'email', 'BG08', v_old.payload);

  update report_sends
     set status = 'queued', outbox_key = v_key, error = null
   where outbox_key = v.outbox_key and status = 'failed';

  return jsonb_build_object('key', v_key);
end $function$;

create or replace function public.payroll_report(p_from date, p_to date)
returns table(booking_id uuid, shift_id uuid, event_id uuid, staff_id uuid, employee_id integer, staff_name text, sort_surname text, removed boolean, photo_path text, event_title text, client_name text, role_name text, shift_date date, starts_at timestamp with time zone, ends_at timestamp with time zone, check_in_at timestamp with time zone, check_out_at timestamp with time zone, attempted_at timestamp with time zone, kind text, status text, no_check_out_unresolved boolean, late_check_in boolean, early_check_out boolean, unpaid_break_min integer, worked_min integer, payable_min integer, floor_applied boolean, rate numeric, base numeric, holiday numeric, total numeric, in_export boolean, exported_at timestamp with time zone, exported_payable_min integer, exported_total numeric, changed_since_export boolean)
language plpgsql
stable security definer
set search_path to 'public', 'extensions'
as $function$
#variable_conflict use_column
begin
  perform assert_finance_caller();
  return query
  select l.booking_id, l.shift_id, l.event_id, l.staff_id, l.employee_id,
         l.staff_name, l.sort_surname, l.removed, l.photo_path,
         l.event_title, l.client_name, l.role_name, l.shift_date,
         l.starts_at, l.ends_at, l.check_in_at, l.check_out_at, l.attempted_at,
         l.kind, l.status, l.no_check_out_unresolved,
         l.late_check_in, l.early_check_out,
         l.unpaid_break_min, l.worked_min, l.payable_min, l.floor_applied,
         l.rate, l.base, l.holiday, l.total,
         -- The CSV rule, stated once: a settled shift with something to pay.
         -- Pending (No check-out) is held; a late turn-away is paid nothing.
         (l.status = 'settled' and coalesce(l.payable_min, 0) > 0 and l.kind <> 'no_show'),
         x.created_at,
         x.payable_min,
         x.base + x.holiday,
         (x.id is not null and (l.status <> 'settled'
                                or l.payable_min is distinct from x.payable_min
                                or l.total is distinct from x.base + x.holiday))
    from report_payroll_lines_v l
    left join payroll_export_lines x on x.booking_id = l.booking_id and x.state = 'exported'
   where l.shift_date between p_from and p_to
     -- A no-show is not a shift anybody is paid for — unless it was paid
     -- already, in which case it stays visible so the warning can say so.
     and (l.kind <> 'no_show' or x.id is not null)
   order by l.removed, l.sort_surname nulls last, l.staff_name, l.staff_id, l.starts_at;
end $function$;

create or replace function public.payroll_report_people(p_from date, p_to date)
returns table(staff_id uuid, employee_id integer, staff_name text, removed boolean, photo_path text, is_total boolean, workers integer, shifts integer, pending integer, turned_away integer, payable_min integer, break_min integer, base numeric, holiday numeric, total numeric, changed_since_export integer)
language plpgsql
stable security definer
set search_path to 'public', 'extensions'
as $function$
#variable_conflict use_column
begin
  perform assert_finance_caller();
  return query
  with lines as (
    select * from payroll_report(p_from, p_to) r where r.kind <> 'no_show'
  )
  select
    l.staff_id, l.employee_id, l.staff_name, l.removed, l.photo_path,
    grouping(l.staff_id) = 1,
    count(distinct l.staff_id)::int,
    count(*)::int,
    count(*) filter (where l.status = 'pending')::int,
    count(*) filter (where l.kind = 'turned_away')::int,
    coalesce(sum(l.payable_min) filter (where l.status = 'settled'), 0)::int,
    coalesce(sum(l.unpaid_break_min) filter (where l.status = 'settled'), 0)::int,
    coalesce(sum(l.base), 0),
    coalesce(sum(l.holiday), 0),
    coalesce(sum(l.total), 0),
    count(*) filter (where l.changed_since_export)::int
  from lines l
  group by grouping sets ((l.staff_id, l.employee_id, l.staff_name, l.removed, l.photo_path, l.sort_surname), ())
  order by grouping(l.staff_id), bool_or(l.removed), min(l.sort_surname) nulls last, l.staff_name;
end $function$;

create or replace function public.new_starter_report(p_date date)
returns table(staff_id uuid, employee_id integer, staff_name text, removed boolean, photo_path text, ni_number text, home_address text, postcode text, country text, date_of_birth date, gender text, first_shift_date date, hmrc_statement text, student_loan text, period_start date, period_end date)
language plpgsql
stable security definer
set search_path to 'public', 'extensions'
as $function$
#variable_conflict use_column
declare
  v_start date := date_trunc('week', p_date)::date - 7;
begin
  perform assert_finance_caller();
  return query
  select n.*, v_start, v_start + 6
    from new_starter_rows(array(
           select f.staff_id from report_first_shifts_v f
            where f.first_shift_date between v_start and v_start + 6)) n;
end $function$;

-- ---------------------------------------------------------------------
-- 8 · finance — the money views (all security_invoker, admin-only by
-- the RLS under them). Money-only ones return no rows without 'finance';
-- mixed ones keep their rows and return NULL for the money columns.
-- Definitions are the live ones (pg_get_viewdef) with the gate added.
--
-- The gate reads "not a Back Office login without finance" rather than
-- "office_can('finance')" wherever the view has no admin filter of its
-- own, so a read with no session at all — the table owner, the service
-- role, the pgTAP fixtures — sees what it always saw. Every other caller
-- is still held by the RLS on the tables underneath.
-- ---------------------------------------------------------------------

-- 8a · Money only → no rows.
create or replace view clients_margins_v with (security_invoker = true) as
 SELECT e.client_id,
    count(DISTINCT e.id)::integer AS completed_events,
    sum(s.charge_rate * s.headcount::numeric * EXTRACT(epoch FROM s.ends_at - s.starts_at) / 3600::numeric) AS charge_total,
    sum(final_rate(s.pay_rate) * s.headcount::numeric * EXTRACT(epoch FROM s.ends_at - s.starts_at) / 3600::numeric) AS pay_total
   FROM events e
     JOIN shift_requirements s ON s.event_id = e.id
  WHERE e.cancelled_at IS NULL AND e.event_date < (now() AT TIME ZONE 'Europe/London'::text)::date
    AND (SELECT current_app_role() IS DISTINCT FROM 'admin'::app_role OR office_can('finance'))
  GROUP BY e.client_id;

create or replace view clients_rate_card_v with (security_invoker = true) as
 SELECT rc.id,
    rc.client_id,
    rc.role_id,
    r.name AS role_name,
    r.description AS role_description,
    rc.charge_rate,
    r.pay_rate AS base_pay_rate,
    final_rate(r.pay_rate) AS final_pay_rate,
    rc.charge_rate - final_rate(r.pay_rate) AS margin_per_hour,
        CASE
            WHEN rc.charge_rate > 0::numeric THEN round((1::numeric - final_rate(r.pay_rate) / rc.charge_rate) * 100::numeric, 1)
            ELSE NULL::numeric
        END AS margin_pct,
    rc.dress_codes,
    (( SELECT count(*) AS count
           FROM shift_requirements s
             JOIN events e ON e.id = s.event_id
          WHERE e.client_id = rc.client_id AND s.role_id = rc.role_id))::integer AS section_count
   FROM client_rate_cards rc
     JOIN roles r ON r.id = rc.role_id
  WHERE (SELECT current_app_role() IS DISTINCT FROM 'admin'::app_role OR office_can('finance'));

create or replace view role_directory_v with (security_invoker = true) as
 SELECT id,
    name,
    description,
    pay_rate,
    round(pay_rate * 0.1207, 2) AS holiday_rate,
    final_rate(pay_rate) AS final_rate,
    created_at,
    (( SELECT count(*) AS count
           FROM client_rate_cards c
          WHERE c.role_id = r.id))::integer AS rate_card_count,
    (( SELECT count(*) AS count
           FROM shift_requirements s
          WHERE s.role_id = r.id))::integer AS section_count
   FROM roles r
  WHERE (SELECT current_app_role() IS DISTINCT FROM 'admin'::app_role OR office_can('finance'));

create or replace view dashboard_week_finance_v with (security_invoker = true, security_barrier = true) as
 WITH week AS (
         SELECT date_trunc('week'::text, (now() AT TIME ZONE 'Europe/London'::text))::date AS week_start,
            date_trunc('week'::text, (now() AT TIME ZONE 'Europe/London'::text))::date + 6 AS week_end
        )
 SELECT w.week_start,
    w.week_end,
    count(DISTINCT s.event_id)::integer AS events,
    COALESCE(sum(s.headcount::numeric * s.section_hours), 0::numeric) AS forecast_hours,
    COALESCE(round(sum(s.charge_rate * s.headcount::numeric * s.section_hours), 2), 0::numeric) AS charge_total,
    COALESCE(round(sum(s.base_rate * s.headcount::numeric * s.section_hours), 2), 0::numeric) AS base_total,
    COALESCE(round(sum(s.final_pay_rate * s.headcount::numeric * s.section_hours), 2), 0::numeric) AS pay_total,
    COALESCE(round(sum((s.final_pay_rate - s.base_rate) * s.headcount::numeric * s.section_hours), 2), 0::numeric) AS holiday_total,
    COALESCE(round(sum((s.charge_rate - s.final_pay_rate) * s.headcount::numeric * s.section_hours), 2), 0::numeric) AS margin_total,
        CASE
            WHEN COALESCE(sum(s.charge_rate * s.headcount::numeric * s.section_hours), 0::numeric) > 0::numeric THEN round((1::numeric - sum(s.final_pay_rate * s.headcount::numeric * s.section_hours) / sum(s.charge_rate * s.headcount::numeric * s.section_hours)) * 100::numeric, 1)
            ELSE NULL::numeric
        END AS margin_pct
   FROM week w
     LEFT JOIN dashboard_sections_v s ON (s.cancelled_at IS NULL OR s.cancelled_on_day) AND s.event_date >= w.week_start AND s.event_date <= w.week_end
  WHERE current_app_role() = 'admin'::app_role
    AND (SELECT office_can('finance'))
  GROUP BY w.week_start, w.week_end;

-- 8b · Mixed → rows stay, money columns go NULL. dashboard_upcoming_v
-- selects these columns from dashboard_sections_v, so it inherits the
-- mask without being redefined; dashboard_kpis_v reads no money column.
create or replace view dashboard_sections_v with (security_invoker = true, security_barrier = true) as
 SELECT sr.id AS shift_id,
    sr.event_id,
    e.client_id,
    e.title AS event_title,
    e.event_date,
    e.venue_name,
    e.po_number,
    e.cancelled_at,
    c.name AS client_name,
    r.name AS role_name,
    sr.starts_at,
    sr.ends_at,
    sr.headcount,
    sr.buffer,
    (CASE WHEN (SELECT office_can('finance')) THEN sr.charge_rate END)::numeric(8,2) AS charge_rate,
    (CASE WHEN (SELECT office_can('finance')) THEN sr.pay_rate END)::numeric(8,2) AS base_rate,
    CASE WHEN (SELECT office_can('finance')) THEN final_rate(sr.pay_rate) END AS final_pay_rate,
    CASE WHEN (SELECT office_can('finance')) THEN sr.charge_rate - final_rate(sr.pay_rate) END AS margin_per_hour,
    EXTRACT(epoch FROM sr.ends_at - sr.starts_at) / 3600::numeric AS section_hours,
    COALESCE(f.confirmed, 0) AS confirmed,
    GREATEST(sr.headcount - COALESCE(f.confirmed, 0), 0) AS open_positions,
    e.cancelled_at IS NOT NULL AND (e.cancelled_at AT TIME ZONE 'Europe/London'::text)::date >= e.event_date AS cancelled_on_day
   FROM shift_requirements sr
     JOIN events e ON e.id = sr.event_id
     JOIN clients c ON c.id = e.client_id
     JOIN roles r ON r.id = sr.role_id
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS confirmed
           FROM bookings b
          WHERE b.shift_id = sr.id AND (b.status = ANY (ARRAY['confirmed'::booking_status, 'worked'::booking_status]))) f ON true
  WHERE current_app_role() = 'admin'::app_role;

create or replace view clients_event_list_v with (security_invoker = true) as
 SELECT e.id,
    e.client_id,
    e.title,
    e.po_number,
    e.event_date,
    w.starts_at,
    w.ends_at,
    e.venue_name,
    e.cancelled_at,
    event_status(e.*, w.starts_at, w.ends_at) AS status,
    (( SELECT count(*) AS count
           FROM shift_requirements s
          WHERE s.event_id = e.id))::integer AS section_count,
    ( SELECT string_agg(((((r.name || ' '::text) || s.headcount) || ' (+'::text) || s.buffer) || ')'::text, ' · '::text ORDER BY r.name) AS string_agg
           FROM shift_requirements s
             JOIN roles r ON r.id = s.role_id
          WHERE s.event_id = e.id) AS roles_summary,
        CASE
            WHEN e.cancelled_at IS NULL AND (SELECT current_app_role() IS DISTINCT FROM 'admin'::app_role OR office_can('finance')) THEN ( SELECT round(sum((s.charge_rate - final_rate(s.pay_rate)) * s.headcount::numeric * EXTRACT(epoch FROM s.ends_at - s.starts_at) / 3600::numeric), 2) AS round
               FROM shift_requirements s
              WHERE s.event_id = e.id)
            ELSE NULL::numeric
        END AS margin_gbp,
        CASE
            WHEN e.cancelled_at IS NULL AND (SELECT current_app_role() IS DISTINCT FROM 'admin'::app_role OR office_can('finance')) THEN ( SELECT
                    CASE
                        WHEN sum(s.charge_rate * s.headcount::numeric * EXTRACT(epoch FROM s.ends_at - s.starts_at) / 3600::numeric) > 0::numeric THEN round((1::numeric - sum(final_rate(s.pay_rate) * s.headcount::numeric * EXTRACT(epoch FROM s.ends_at - s.starts_at) / 3600::numeric) / sum(s.charge_rate * s.headcount::numeric * EXTRACT(epoch FROM s.ends_at - s.starts_at) / 3600::numeric)) * 100::numeric, 1)
                        ELSE NULL::numeric
                    END AS "case"
               FROM shift_requirements s
              WHERE s.event_id = e.id)
            ELSE NULL::numeric
        END AS margin_pct
   FROM events e
     JOIN LATERAL ( SELECT min(s.starts_at) AS starts_at,
            max(s.ends_at) AS ends_at
           FROM shift_requirements s
          WHERE s.event_id = e.id) w ON w.starts_at IS NOT NULL;

-- clients_directory_v.avg_margin_pct reads clients_margins_v, which now
-- has no rows without 'finance', so it is NULL ("no margin") for a
-- scheduler with no redefinition here.

-- anon never had a reason to hold these; with office_can in their
-- bodies it now meets a function grant rather than an empty result, so
-- the grant goes (Supabase's default privileges gave it).
revoke all on clients_margins_v, clients_rate_card_v, role_directory_v,
              clients_event_list_v, clients_directory_v from anon;

-- ---------------------------------------------------------------------
-- 9 · Grants. PUBLIC gets nothing by default (190_job_function_grants 2f)
-- ---------------------------------------------------------------------
revoke all on function public.office_can(text)                                                      from public, anon;
revoke all on function public.assert_finance_caller()                                               from public, anon;
revoke all on function public.admin_accounts(app_role)                                              from public, anon;
revoke all on function public.admin_register_account(uuid, app_role, text, uuid, text, office_role) from public, anon;
revoke all on function public.admin_register_account(uuid, app_role, text, uuid, text)              from public, anon;
revoke all on function public.admin_set_office_role(uuid, office_role)                              from public, anon;
revoke all on function public.booking_payroll_exported(uuid)                                        from public, anon;
revoke all on function public.profiles_office_role_default()                                        from public, anon, authenticated;
revoke all on function public.office_finance_write_guard()                                          from public, anon, authenticated;
revoke all on function public.shift_rates_office_guard()                                            from public, anon, authenticated;

-- office_can is evaluated AS THE CALLER inside policies and the
-- security_invoker views above, so a signed-in session must hold it.
grant execute on function public.office_can(text)                                                   to authenticated, service_role;
grant execute on function public.assert_finance_caller()                                            to authenticated, service_role;
grant execute on function public.admin_accounts(app_role)                                           to authenticated;
grant execute on function public.admin_register_account(uuid, app_role, text, uuid, text, office_role) to authenticated;
grant execute on function public.admin_register_account(uuid, app_role, text, uuid, text)           to authenticated;
grant execute on function public.admin_set_office_role(uuid, office_role)                           to authenticated;
grant execute on function public.booking_payroll_exported(uuid)                                     to authenticated, service_role;
