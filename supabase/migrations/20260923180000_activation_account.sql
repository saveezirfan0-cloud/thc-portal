-- =====================================================================
-- Candidate account activation (§1.4, §2.7, §2.8 E3, §10.2)
--
-- 20260923110000's Accept queued E3 with a static `{staff}/activate` link
-- and created no login: `staff.user_id` stayed null, so an accepted
-- candidate could never sign in and never reach the wizard.
--
-- The office action now provisions the login first (GoTrue Admin API,
-- service key, server-side) and hands the account and its personal link
-- to ONE transaction here:
--
--   onboarding_accept_with_account  — the office's Accept: links the
--       account, then runs the existing onboarding_accept (roles, the
--       §2.12 move to Documents, E3 with the personal link). Any refusal
--       rolls back all of it, so E3 is never queued without a working
--       link and a link is never recorded for a candidate who was not
--       accepted.
--   link_staff_account              — staff.user_id + the `staff`
--       profile. Service role only (the Willo route will need it); the
--       office reaches it through the function above.
--   activation_preview              — the /activate page's greeting,
--       read WITHOUT spending the one-time token. Service role only.
--
-- The 5-argument onboarding_accept is left as it was: 380 pins it, and
-- the Willo route (willo_record_event) still calls onboarding_do_accept
-- with whatever link its caller supplies. The Willo Edge Function, when
-- it is built, must provision the account and pass the personal link in
-- the event details exactly as the office action does.
-- =====================================================================

-- ---------------------------------------------------------------------
-- link_staff_account
--
-- Refuses rather than repairs. Every refusal is a sign two people are
-- being confused for one another, and silently moving a login from one
-- staff record to another would hand the second person the first
-- person's shifts, pay and documents.
-- ---------------------------------------------------------------------
create or replace function public.link_staff_account(p_staff uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s          staff;
  v_email    text;
  v_app_role text;
  v_profile  app_role;
  v_other    uuid;
  v_new      boolean;
begin
  if p_staff is null or p_user is null then
    raise exception 'account_required' using errcode = '22023';
  end if;

  select * into s from staff where id = p_staff for update;
  if s.id is null or s.removed_at is not null then
    raise exception 'unknown_staff' using errcode = 'P0002';
  end if;

  select u.email, u.raw_app_meta_data ->> 'role'
    into v_email, v_app_role
    from auth.users u
   where u.id = p_user;
  if not found then
    raise exception 'unknown_account' using errcode = 'P0002';
  end if;

  -- Never a relink, in either direction.
  if s.user_id is not null and s.user_id <> p_user then
    raise exception 'staff_linked_elsewhere' using errcode = 'P0001';
  end if;
  select id into v_other from staff where user_id = p_user and id <> p_staff;
  if v_other is not null then
    raise exception 'account_linked_elsewhere' using errcode = 'P0001';
  end if;

  -- The Staff App's middleware admits app_metadata.role = 'staff' and
  -- nothing else (§1.4). An account without it would activate into a
  -- 403 — a dead link by another route. An office or client login is
  -- never turned into a worker's.
  if v_app_role is distinct from 'staff' then
    raise exception 'account_not_staff' using errcode = 'P0001';
  end if;
  select role into v_profile from profiles where id = p_user;
  if v_profile is not null and v_profile <> 'staff' then
    raise exception 'account_not_staff' using errcode = 'P0001';
  end if;

  -- The login is the candidate's own address or it is somebody else's.
  if lower(btrim(coalesce(v_email, ''))) <> lower(btrim(s.email)) then
    raise exception 'account_email_mismatch' using errcode = 'P0001';
  end if;

  v_new := s.user_id is null;
  if v_new then
    update staff set user_id = p_user where id = p_staff;
  end if;

  -- current_app_role() reads profiles; several read policies admit "any
  -- signed-in role", which for a worker means a `staff` profile row.
  insert into profiles (id, role, full_name)
  values (p_user, 'staff', btrim(s.first_name || ' ' || s.last_name))
  on conflict (id) do nothing;

  if v_new then
    insert into audit_log (actor, action, entity, entity_id, data)
    values (auth.uid(), 'link_staff_account', 'staff', p_staff,
            jsonb_build_object('userId', p_user::text));
  end if;

  return jsonb_build_object('staffId', p_staff::text, 'userId', p_user::text, 'linked', v_new);
end $$;

comment on function public.link_staff_account(uuid, uuid) is
  '§1.4, §2.7: sets staff.user_id to a GoTrue account whose app_metadata.role is staff and whose email is the candidate''s, and gives it a staff profile. Idempotent for the same pair; refuses to relink a staff row already linked to a different account, or an account already linked to another staff row. Service role only; the office reaches it through onboarding_accept_with_account.';

-- ---------------------------------------------------------------------
-- onboarding_accept_with_account — the office's Accept (§2.4)
-- ---------------------------------------------------------------------
create or replace function public.onboarding_accept_with_account(
  p_staff           uuid,
  p_roles           uuid[],
  p_note            text,
  p_user            uuid,
  p_activation_link text,
  p_install_link    text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_result jsonb;
begin
  perform assert_office_caller();

  -- E3's link must be the personal one: `/activate/<one-time token>`.
  -- The bare `/activate` this replaces reached a page that could do
  -- nothing for the candidate.
  if coalesce(p_activation_link, '') !~ '/activate/[A-Za-z0-9_-]{32,}' then
    raise exception 'activation_link_not_personal' using errcode = '22023';
  end if;

  perform link_staff_account(p_staff, p_user);
  v_result := onboarding_accept(p_staff, p_roles, p_note, p_activation_link, p_install_link);

  return v_result || jsonb_build_object('userId', p_user::text);
end $$;

comment on function public.onboarding_accept_with_account(uuid, uuid[], text, uuid, text, text) is
  '§2.4 Accept with the candidate''s login: link_staff_account, then onboarding_accept (roles, interview_completed → documents, E3) in one transaction, so E3 is queued only with a personal /activate/<token> link for an account that is linked. Office only.';

-- ---------------------------------------------------------------------
-- activation_preview — who a link is for, without using it up
--
-- Mail scanners open links before people do, so /activate never verifies
-- on load (§2.7: "the link is personal and single-use"). This reads the
-- token column GoTrue stores the hashed token in; it changes nothing.
-- The page uses it only to greet the candidate and to check "not your
-- name or email" as they type. Whether the link still works is decided
-- by verifyOtp on submit, never here.
-- ---------------------------------------------------------------------
create or replace function public.activation_preview(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v jsonb;
begin
  -- The token columns default to '' — an empty or short argument must
  -- never match every account that has no pending token.
  if coalesce(p_token_hash, '') !~ '^[A-Za-z0-9_-]{32,200}$' then
    return null;
  end if;

  select jsonb_build_object('firstName', s.first_name, 'lastName', s.last_name, 'email', u.email)
    into v
    from auth.users u
    join staff s on s.user_id = u.id
   where (u.confirmation_token = p_token_hash or u.recovery_token = p_token_hash)
     and s.removed_at is null
   limit 1;

  return v;
end $$;

comment on function public.activation_preview(text) is
  '§2.7 /activate/:token greeting: first name, last name and email of the staff account whose pending one-time token this is, or null. Read-only — does not consume or verify the token. Service role only.';

revoke execute on function public.link_staff_account(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.activation_preview(text) from public, anon, authenticated;
revoke execute on function public.onboarding_accept_with_account(uuid, uuid[], text, uuid, text, text) from public, anon;
grant  execute on function public.link_staff_account(uuid, uuid) to service_role;
grant  execute on function public.activation_preview(text) to service_role;
grant  execute on function public.onboarding_accept_with_account(uuid, uuid[], text, uuid, text, text) to authenticated;
