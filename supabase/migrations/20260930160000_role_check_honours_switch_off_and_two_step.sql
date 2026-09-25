-- =====================================================================
-- Integration round after ADR-0035 … ADR-0038: the database now enforces
-- what the Back Office app already did.
--
-- 1 · current_app_role() — the helper every RLS policy and admin RPC asks
--     — now answers NULL (no access at all) for:
--       * a login that is switched off (auth.users.banned_until in the
--         future). Before this, a switched-off login's access token kept
--         working against the API until it expired, up to an hour
--         (ADR-0035 "Known limit").
--       * a Back Office login with a verified two-step factor whose
--         session has not passed the code step (JWT aal is not aal2).
--         Before this, the middleware stopped the APP at aal1 but a
--         stolen password plus the public anon key could still read data
--         through the API (ADR-0037 decision 1).
--     It stays a plain SQL function (one indexed lookup of profiles,
--     auth.users and auth.mfa_factors by primary/foreign key): the
--     policies call it per row.
-- 2 · office_can() goes through current_app_role(), so the same two
--     rules reach every office permission.
-- 3 · queue_account_invite (ADR-0038) was written before office roles
--     landed and checked only for an admin; sending a set-up link is
--     Users & access, so it now also needs office_can('users'). The body
--     is otherwise 20260930120000's, unchanged (docs/10 §3b).
-- =====================================================================

create or replace function public.current_app_role() returns app_role
language sql
stable
security definer
set search_path = public
as $$
  select p.role
    from profiles p
    join auth.users u on u.id = p.id
   where p.id = auth.uid()
     and (u.banned_until is null or u.banned_until <= now())
     and (p.role <> 'admin'
          or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
          or not exists (select 1 from auth.mfa_factors f
                          where f.user_id = p.id and f.status::text = 'verified'))
$$;

comment on function public.current_app_role() is
  'The caller''s app role for RLS and every admin RPC. NULL — no access — when there is no session, the login is switched off (banned_until in the future), or a Back Office login with a verified two-step factor has not passed the code step (aal2). 20260930160000.';

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
     where p.id = auth.uid() and p.role = 'admin'
       and current_app_role() = 'admin'), false)
$$;

create or replace function public.queue_account_invite(p_user uuid, p_link text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_link       text := btrim(coalesce(p_link, ''));
  v_profile    profiles;
  v_email      text;
  v_banned     timestamptz;
  v_signed_in  timestamptz;
  v_app        text;
  v_name       text;
  v_prefix     text;
  v_existing   text;
  v_n          int;
  v_key        text;
  v_superseded int;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  -- ADR-0036: sending a set-up link is Users & access, which is the owner's.
  if not office_can('users') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'users';
  end if;
  if not account_invite_link_ok(v_link) then
    raise exception 'invite_link_invalid' using errcode = '22023';
  end if;

  -- Locked first: two calls for one login queue one after the other.
  select * into v_profile from profiles where id = p_user for update;
  select u.email::text, u.banned_until, u.last_sign_in_at
    into v_email, v_banned, v_signed_in
    from auth.users u where u.id = p_user;
  if v_profile.id is null or nullif(btrim(coalesce(v_email, '')), '') is null then
    raise exception 'unknown_account' using errcode = 'P0001';
  end if;
  -- A worker's set-up link is E3, from Accept (§2.4, §2.7).
  if v_profile.role not in ('admin', 'client')
     or exists (select 1 from staff s where s.user_id = p_user) then
    raise exception 'role_not_allowed' using errcode = 'P0001';
  end if;
  if v_banned is not null and v_banned > now() then
    raise exception 'login_disabled' using errcode = 'P0001';
  end if;
  -- ADR-0035 3a: a login in use gets no link; its owner resets their own.
  if v_signed_in is not null then
    raise exception 'already_signed_in' using errcode = 'P0001';
  end if;

  v_prefix := 'E11:invite:' || p_user::text || ':';

  -- The same link again: the row that already carries it, and nothing new.
  select o.key into v_existing
    from notification_outbox o
   where o.template = 'E11'
     and left(o.key, char_length(v_prefix)) = v_prefix
     and o.payload ->> 'link' = v_link
   order by o.id desc
   limit 1;
  if v_existing is not null then
    return jsonb_build_object('queued', false, 'outboxKey', v_existing, 'email', v_email);
  end if;

  select count(*)::int + 1 into v_n
    from notification_outbox o
   where o.template = 'E11' and left(o.key, char_length(v_prefix)) = v_prefix;
  v_key := v_prefix || v_n::text;

  -- An older link still waiting cannot work any more: withdraw its email.
  update notification_outbox o
     set failed_at = now(),
         error = 'superseded: a newer set-up link was issued (' || v_key || ')'
   where o.template = 'E11'
     and left(o.key, char_length(v_prefix)) = v_prefix
     and o.sent_at is null and o.failed_at is null;
  get diagnostics v_superseded = row_count;

  v_app  := case v_profile.role when 'admin' then 'Back Office' else 'Client Portal' end;
  v_name := coalesce(nullif(split_part(btrim(coalesce(v_profile.full_name, '')), ' ', 1), ''), 'there');

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values (v_key, 'email', 'E11', array[lower(btrim(v_email))],
          jsonb_build_object('app', v_app, 'name', v_name, 'link', v_link));

  insert into audit_log (actor, action, entity, entity_id, data)
  values (v_actor, 'account.invite_emailed', 'account', p_user,
          jsonb_build_object('outboxKey', v_key, 'n', v_n, 'email', v_email, 'app', v_app,
                             'superseded', v_superseded));

  return jsonb_build_object('queued', true, 'outboxKey', v_key, 'n', v_n, 'email', v_email,
                            'superseded', v_superseded);
end;
$$;

-- create or replace keeps the grants 20260930110000 / 120000 set; restated
-- so this file reads complete on its own.
revoke all on function public.queue_account_invite(uuid, text) from public, anon;
grant execute on function public.queue_account_invite(uuid, text) to authenticated;
