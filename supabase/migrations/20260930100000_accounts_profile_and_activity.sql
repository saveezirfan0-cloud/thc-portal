-- =====================================================================
-- Accounts, the signed-in user's own profile, and the activity log
-- (§1.4 roles and access, §1.7 audit trail, §6 settings)
--
-- Until now the Back Office had no way to:
--   * edit the signed-in manager's own name or contact details;
--   * create a Back Office or Client Portal login — both were made by
--     hand in the Supabase dashboard (§1.4: "Login for back office and
--     client — email + password");
--   * switch a login off without deleting it;
--   * read `audit_log`, which 56 definer functions write and nothing
--     showed;
--   * see who changed a value on /settings — the table was written
--     directly and nothing recorded it.
--
-- This migration is the database half of /account, /users and /activity.
-- Every function is `security definer` with a pinned search_path, checks
-- the caller's role itself (a request built around the screen meets the
-- same refusal), is revoked from PUBLIC and anon, and writes its own
-- audit row. No table gains a policy (001_rls_guard stays as it is), and
-- `profiles` still has no UPDATE policy: the only ways to change a row are
-- the functions below.
--
-- Staff logins are NOT made here. A worker's login is created by Accept
-- (§2.4, §2.7, `link_staff_account`) and closed by Block / Remove (§9.6,
-- §1.7), so both functions that change an account refuse a staff one.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · profiles: contact fields for office and client users
-- ---------------------------------------------------------------------
alter table profiles
  add column if not exists phone text,
  add column if not exists job_title text,
  add column if not exists updated_at timestamptz;

comment on column profiles.phone is
  'Contact number for an office or client user (a worker''s lives on staff). Edited by its owner through update_my_profile().';
comment on column profiles.job_title is
  'Free text shown beside the name on /users, e.g. "Operations manager". Edited through update_my_profile().';

-- ---------------------------------------------------------------------
-- 2 · update_my_profile — the signed-in user edits their own row
-- ---------------------------------------------------------------------
create or replace function public.update_my_profile(
  p_full_name text,
  p_phone     text default null,
  p_job_title text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_row   profiles;
  v_name  text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_title text := nullif(btrim(coalesce(p_job_title, '')), '');
  v_changed text[] := '{}';
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select * into v_row from profiles where id = v_uid for update;
  if v_row.id is null then
    raise exception 'no_profile' using errcode = 'P0001';
  end if;
  -- A worker's name is their staff record (§1.5), edited through the
  -- Staff App's Profile details and the office's staff profile.
  if v_row.role = 'staff' then
    raise exception 'use_staff_profile' using errcode = 'P0001';
  end if;
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'name_required' using errcode = 'P0001';
  end if;
  if v_phone is not null and v_phone !~ '^\+?\(?[0-9][0-9 ()-]{5,22}$' then
    raise exception 'phone_invalid' using errcode = 'P0001';
  end if;
  if v_title is not null and char_length(v_title) > 80 then
    raise exception 'job_title_too_long' using errcode = 'P0001';
  end if;

  if v_name  is distinct from v_row.full_name then v_changed := v_changed || 'full_name'::text; end if;
  if v_phone is distinct from v_row.phone     then v_changed := v_changed || 'phone'::text;     end if;
  if v_title is distinct from v_row.job_title then v_changed := v_changed || 'job_title'::text; end if;

  if cardinality(v_changed) = 0 then
    return jsonb_build_object('changed', '[]'::jsonb);
  end if;

  update profiles
     set full_name = v_name, phone = v_phone, job_title = v_title, updated_at = now()
   where id = v_uid;

  -- The field NAMES, not the values: a phone number does not belong in an
  -- append-only trail that outlives a GDPR removal.
  insert into audit_log (actor, action, entity, entity_id, data)
  values (v_uid, 'profile.updated', 'account', v_uid, jsonb_build_object('fields', to_jsonb(v_changed)));

  return jsonb_build_object('changed', to_jsonb(v_changed));
end;
$$;

comment on function public.update_my_profile(text, text, text) is
  'The signed-in office or client user edits their own name, phone and job title. Refuses a staff login (their name is the staff record). Audited as profile.updated with the field names only.';

-- ---------------------------------------------------------------------
-- 3 · admin_accounts — every login, for /users
-- ---------------------------------------------------------------------
create or replace function public.admin_accounts(p_role app_role default null)
returns table (
  id              uuid,
  email           text,
  role            app_role,
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
  return query
    select p.id,
           u.email::text,
           p.role,
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
  '/users: every login with its role, client, last sign-in and whether it is switched off. Admin only.';

-- ---------------------------------------------------------------------
-- 4 · admin_register_account — give a new login its role and profile
--
-- The server action mints the login through the GoTrue Admin API (the
-- one step that needs the service key) and then calls this AS THE
-- MANAGER. The role is written here, under this function's admin check,
-- not by the service key — so the key only ever creates an empty login,
-- and the database decides what it may do.
-- ---------------------------------------------------------------------
create or replace function public.admin_register_account(
  p_user      uuid,
  p_role      app_role,
  p_full_name text,
  p_client    uuid default null,
  p_job_title text default null
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

  insert into profiles (id, role, full_name, client_id, job_title, updated_at)
  values (p_user, p_role, v_name, p_client, v_title, now())
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
          jsonb_build_object('role', p_role::text, 'clientId', p_client, 'email', v_email));

  return jsonb_build_object('userId', p_user, 'email', v_email, 'role', p_role::text,
                            'created', v_existing.id is null);
end;
$$;

comment on function public.admin_register_account(uuid, app_role, text, uuid, text) is
  '/users Invite: gives a GoTrue login minted by the office''s service key its profile and app_metadata.role (admin or client only — never staff). Refuses to change the kind of an existing login. Admin only; audited as account.invited / account.reinvited.';

-- ---------------------------------------------------------------------
-- 4b · admin_login_lookup — asked BEFORE anything is minted
--
-- Minting a token replaces the one in any link already sent, and a
-- magic link for a login someone already uses would let the manager who
-- holds it sign in as them. So /users asks first: does this address have
-- a login, of what kind, and has it ever been used? A worker's login, or
-- one of another kind, is refused without a token being made; one that
-- has been signed in to gets no link at all (its owner uses Forgot
-- password, which goes to their own mailbox).
-- ---------------------------------------------------------------------
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
  '/users Invite: whether an address already has a login, its kind, client and whether it has ever been signed in to — asked before any token is minted. Admin only.';

-- ---------------------------------------------------------------------
-- 5 · admin_set_login_disabled — switch a login off, or back on
-- ---------------------------------------------------------------------
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
  '/users: switch an office or client login off (sign-in refused, sessions ended) or back on. Refuses staff (use Block), the caller''s own login and the last working admin. Admin only; audited.';

-- ---------------------------------------------------------------------
-- 6 · Settings history — every change to /settings is now an audit row
-- ---------------------------------------------------------------------
create or replace function public.audit_settings_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.value is not distinct from old.value then
    return null;
  end if;
  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'settings.' || lower(tg_op), 'settings', null,
          jsonb_build_object('key',  coalesce(new.key, old.key),
                             'from', case when tg_op = 'INSERT' then null else old.value end,
                             'to',   case when tg_op = 'DELETE' then null else new.value end));
  return null;
end;
$$;

drop trigger if exists settings_audit on settings;
create trigger settings_audit
  after insert or update or delete on settings
  for each row execute function public.audit_settings_change();

create or replace function public.audit_venue_radius_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.default_radius_m is not distinct from old.default_radius_m then
    return null;
  end if;
  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'settings.radius_changed', 'settings', null,
          jsonb_build_object('key', 'venue_radius:' || new.key, 'label', new.label,
                             'from', old.default_radius_m, 'to', new.default_radius_m));
  return null;
end;
$$;

drop trigger if exists venue_types_radius_audit on venue_types;
create trigger venue_types_radius_audit
  after update on venue_types
  for each row execute function public.audit_venue_radius_change();

-- ---------------------------------------------------------------------
-- 7 · admin_activity — the audit trail, readable (/activity)
--
-- audit_log is already admin-read (0004); this adds what a person needs
-- to read it: who (the actor's name — profiles is self-read only), and
-- what (a label for the row the entry is about), with filters and
-- keyset paging on the identity column.
-- ---------------------------------------------------------------------
create or replace function public.admin_activity(
  p_limit  int         default 50,
  p_before bigint      default null,
  p_entity text        default null,
  p_actor  uuid        default null,
  p_query  text        default null,
  p_since  timestamptz default null
) returns table (
  id           bigint,
  at           timestamptz,
  actor        uuid,
  actor_name   text,
  action       text,
  entity       text,
  entity_id    uuid,
  entity_label text,
  data         jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int  := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_q     text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  return query
    with page as (
      select a.*
        from audit_log a
       where (p_before is null or a.id < p_before)
         and (p_entity is null or a.entity = p_entity)
         and (p_actor  is null or a.actor  = p_actor)
         and (p_since  is null or a.at    >= p_since)
    ), labelled as (
      select pg.id, pg.at, pg.actor,
             ap.full_name as actor_name,
             pg.action, pg.entity, pg.entity_id,
             case pg.entity
               when 'staff'           then (select st.first_name || ' ' || st.last_name from staff st where st.id = pg.entity_id)
               when 'compliance_docs' then (select st.first_name || ' ' || st.last_name || ' · ' || replace(cd.doc_type::text, '_', ' ')
                                              from compliance_docs cd join staff st on st.id = cd.staff_id where cd.id = pg.entity_id)
               when 'event'           then (select ev.title from events ev where ev.id = pg.entity_id)
               when 'booking'         then (select st.first_name || ' ' || st.last_name || ' · ' || ev.title
                                              from bookings b join staff st on st.id = b.staff_id
                                              join shift_requirements sr on sr.id = b.shift_id
                                              join events ev on ev.id = sr.event_id where b.id = pg.entity_id)
               when 'account'         then (select pr.full_name from profiles pr where pr.id = pg.entity_id)
               when 'client'          then (select cl.name from clients cl where cl.id = pg.entity_id)
               when 'settings'        then pg.data ->> 'key'
             end as entity_label,
             pg.data
        from page pg
        left join profiles ap on ap.id = pg.actor
    )
    select l.id, l.at, l.actor, l.actor_name, l.action, l.entity, l.entity_id, l.entity_label, l.data
      from labelled l
     where v_q is null
        or l.action ilike '%' || v_q || '%'
        or l.entity_label ilike '%' || v_q || '%'
        or l.actor_name ilike '%' || v_q || '%'
     order by l.id desc
     limit v_limit;
end;
$$;

comment on function public.admin_activity(int, bigint, text, uuid, text, timestamptz) is
  '/activity: audit_log newest first with the actor''s name and a label for the row each entry is about. Filters by entity, actor, text and date; keyset paging on id (p_before). Admin only; at most 200 rows a call.';

create or replace function public.admin_activity_facets()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'entities', coalesce((
      select jsonb_agg(jsonb_build_object('entity', e.entity, 'n', e.n) order by e.n desc)
        from (select a.entity, count(*) as n from audit_log a group by a.entity) e), '[]'::jsonb),
    'actors', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.actor, 'name', coalesce(p.full_name, 'Unknown'), 'n', x.n)
                       order by lower(coalesce(p.full_name, 'Unknown')))
        from (select a.actor, count(*) as n from audit_log a where a.actor is not null group by a.actor) x
        left join profiles p on p.id = x.actor), '[]'::jsonb));
end;
$$;

comment on function public.admin_activity_facets() is
  '/activity filter options: the entities and the actors that appear in audit_log, with counts. Admin only.';

-- ---------------------------------------------------------------------
-- 8 · Grants. PUBLIC gets nothing by default (190_job_function_grants 2f)
-- ---------------------------------------------------------------------
revoke all on function public.update_my_profile(text, text, text)                              from public, anon;
revoke all on function public.admin_accounts(app_role)                                         from public, anon;
revoke all on function public.admin_register_account(uuid, app_role, text, uuid, text)         from public, anon;
revoke all on function public.admin_set_login_disabled(uuid, boolean, text)                    from public, anon;
revoke all on function public.admin_login_lookup(text)                                         from public, anon;
revoke all on function public.admin_activity(int, bigint, text, uuid, text, timestamptz)       from public, anon;
revoke all on function public.admin_activity_facets()                                          from public, anon;
revoke all on function public.audit_settings_change()                                          from public, anon, authenticated;
revoke all on function public.audit_venue_radius_change()                                      from public, anon, authenticated;

grant execute on function public.update_my_profile(text, text, text)                           to authenticated;
grant execute on function public.admin_accounts(app_role)                                      to authenticated;
grant execute on function public.admin_register_account(uuid, app_role, text, uuid, text)      to authenticated;
grant execute on function public.admin_set_login_disabled(uuid, boolean, text)                 to authenticated;
grant execute on function public.admin_login_lookup(text)                                      to authenticated;
grant execute on function public.admin_activity(int, bigint, text, uuid, text, timestamptz)    to authenticated;
grant execute on function public.admin_activity_facets()                                       to authenticated;

create index if not exists audit_log_entity_id_idx on audit_log (entity, id desc);
create index if not exists audit_log_actor_id_idx  on audit_log (actor, id desc);
