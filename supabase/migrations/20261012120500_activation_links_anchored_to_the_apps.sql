-- =====================================================================
-- Migration 20261012120500 · a set-up link names one of OUR apps
--                            (§2.7 E3, ADR-0021, ADR-0058, ADR-0071)
--
-- Every THC email that carries a one-time link takes the link from the
-- caller: the office builds `{staff origin}/activate/{token}` (E3) and
-- `{app origin}/auth/invite?token=…` (E11) in its server actions and hands
-- them to the database to queue. The checks on the way in were:
--
--   onboarding_accept_with_account   `/activate/[A-Za-z0-9_-]{32,}` anywhere
--   onboarding_resend_activation     in the string — unanchored, any origin
--   account_invite_link_ok           anchored, but any https host
--
-- so a Back Office session (or a stolen one) could send a real THC email,
-- from admin@, whose button leads to `https://evil.example/activate/<a
-- real token>` or `https://evil.example/auth/invite?token=…` — a branded
-- phishing page that is handed a live token. 20261001212000 closed the
-- re-point of an UNSENT row and named the anchored check as a follow-up.
-- Security audit 12.10.2026, LOW. This is that follow-up.
--
-- Where the apps' origins live. None of the three is stored in the
-- database today: the Back Office knows NEXT_PUBLIC_STAFF_URL /
-- NEXT_PUBLIC_OFFICE_URL / NEXT_PUBLIC_CLIENT_URL from its Vercel env,
-- and only the Back Office origin is in the vault (office_base_url,
-- ADR-0025). So:
--
--   1 · A new optional vault secret `app_origins`: the Staff App, Back
--       Office and Client Portal origins, separated by commas or spaces
--       (e.g. `https://app.thc.example, https://office.thc.example,
--       https://clients.thc.example`). When it is set, every link these
--       functions accept must start with one of them, or with the vault's
--       office_base_url. The vault is out of PostgREST's reach, so a
--       Back Office login cannot add its own. OWNER-TODO §3 adds it.
--   2 · Always, set or not: the link is anchored end to end — an https
--       origin (letters, digits, dots and hyphens, an optional port, so
--       no userinfo `@`, no second scheme) or a local http one, then
--       exactly `/activate/<token>` with nothing after it but the
--       optional `?type=magiclink` packages/db's activationLink() adds.
--       The invite shape (account_invite_link_ok) was already anchored
--       and keeps its pattern.
--
-- REMAINING GAP until the owner sets `app_origins`: a link to ANOTHER
-- https host of the right shape is still accepted. The anchoring stops
-- the trailing-path, userinfo and look-alike-prefix tricks only.
--
-- Also here (Staff App audit, item 21): activation_preview() — the
-- service-role lookup /activate/:token uses for its greeting — matched a
-- token against auth.users.recovery_token as well as confirmation_token,
-- so a PASSWORD-RESET link pasted into /activate/ told its holder the
-- name and email on the account. It now matches the activation token
-- only, and only while it is younger than the link's lifetime: 24 hours,
-- GoTrue's otp_expiry (supabase/config.toml; the E3/E11/OC2 copy says
-- "expires after 24 hours" and the register test reads config.toml).
-- The send time is read as to_jsonb(u)->>'confirmation_sent_at', so a
-- harness whose auth.users lacks that column reads null — treated as not
-- known to be stale, never as a match on its own.
-- Cost, recorded: a `magiclink` activation (a returning applicant whose
-- email is already confirmed, provision.ts) carries its token in
-- recovery_token, so its page now greets nobody by name and does not say
-- "already activated"; the form still works and the action checks the
-- same password rule once the token is verified.
--
-- 791_activation_links_anchored pins it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The configured origins
-- ---------------------------------------------------------------------
create or replace function public.app_origin_allowed(p_link text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_list   text;
  v_office text;
  v_origin text := lower(substring(coalesce(p_link, '') from '^(https?://[^/?#]+)'));
begin
  if v_origin is null then
    return false;
  end if;
  select decrypted_secret into v_list
    from vault.decrypted_secrets where name = 'app_origins' limit 1;
  if coalesce(btrim(v_list), '') = '' then
    return true;   -- nothing configured: the anchored shape alone decides
  end if;
  select decrypted_secret into v_office
    from vault.decrypted_secrets where name = 'office_base_url' limit 1;
  return v_origin in (
    select lower(rtrim(btrim(o), '/'))
      from regexp_split_to_table(v_list || coalesce(',' || v_office, ''), '[,\s]+') o
     where btrim(o) <> '');
end $$;

comment on function public.app_origin_allowed(text) is
  '20261012120500: true when the link''s origin is one of the vault secret app_origins (comma/space separated) or the vault''s office_base_url — or when app_origins is not set. Used by activation_link_ok() and account_invite_link_ok().';

revoke execute on function public.app_origin_allowed(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2 · The activation link, anchored
-- ---------------------------------------------------------------------
create or replace function public.activation_link_ok(p_link text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(
    char_length(p_link) <= 2048
    and p_link ~ (
      '^(https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?'
      || '|http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?)'
      || '/activate/[A-Za-z0-9_-]{32,200}'
      || '(\?type=magiclink)?$')
    and app_origin_allowed(p_link),
    false)
$$;

comment on function public.activation_link_ok(text) is
  '20261012120500: E3''s personal link — https origin (no userinfo) or local http, then exactly /activate/<token>, optionally ?type=magiclink — on an origin app_origin_allowed() accepts.';

revoke execute on function public.activation_link_ok(text) from public, anon, authenticated;

-- account_invite_link_ok(), 20261001200200's pattern unchanged, plus the
-- origin. Now definer (it reads the vault through app_origin_allowed) and
-- stable; the grants are kept.
create or replace function public.account_invite_link_ok(p_link text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    char_length(p_link) <= 2048
    and p_link ~ (
      '^(https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?'
      || '|http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?)'
      || '/auth/invite\?'
      || '([A-Za-z0-9_.~%-]+=[A-Za-z0-9_.~%-]*&)*'
      || 'token=[A-Za-z0-9_-]{32,200}'
      || '(&[A-Za-z0-9_.~%-]+=[A-Za-z0-9_.~%-]*)*$')
    and app_origin_allowed(p_link),
    false)
$$;

revoke execute on function public.account_invite_link_ok(text) from public, anon;
grant  execute on function public.account_invite_link_ok(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3 · The two office doors that queue E3, from their latest bodies
--     (20260923180000, 20260924110000); only the link check changes.
-- ---------------------------------------------------------------------
create or replace function public.onboarding_accept_with_account(
  p_staff uuid, p_roles uuid[], p_note text, p_user uuid,
  p_activation_link text, p_install_link text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_result jsonb;
begin
  perform assert_office_caller();

  -- E3's link must be the personal one: `/activate/<one-time token>`,
  -- on one of our apps (20261012120500).
  if not activation_link_ok(btrim(coalesce(p_activation_link, ''))) then
    raise exception 'activation_link_not_personal' using errcode = '22023';
  end if;

  perform link_staff_account(p_staff, p_user);
  v_result := onboarding_accept(p_staff, p_roles, p_note, p_activation_link, p_install_link);

  return v_result || jsonb_build_object('userId', p_user::text);
end $$;

create or replace function public.onboarding_resend_activation(
  p_staff uuid, p_user uuid, p_activation_link text, p_install_link text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s         staff;
  v_refusal text;
  v_n       integer;
  v_key     text;
  v_raced   boolean := false;
begin
  perform assert_office_caller();

  if not activation_link_ok(btrim(coalesce(p_activation_link, ''))) then
    raise exception 'activation_link_not_personal' using errcode = '22023';
  end if;
  if coalesce(btrim(p_install_link), '') = '' then
    raise exception 'activation_link_required' using errcode = '22023';
  end if;

  select * into s from staff where id = p_staff for update;
  v_refusal := activation_resend_refusal(p_staff, now());

  if v_refusal like 'resend_too_soon%' then
    -- Only reachable in a race: the pre-check passed, a second click got
    -- its resend in first, and THIS call's token has since replaced that
    -- one's. If that E3 is still unsent, point it here and stop. If it has
    -- gone, its link is already dead because of us — send this one.
    if activation_link_refresh(p_staff, p_user, p_activation_link) > 0 then
      return jsonb_build_object('staffId', p_staff::text, 'queued', false, 'refreshed', true);
    end if;
    v_raced := true;
  elsif v_refusal is not null then
    raise exception '%', v_refusal using errcode = 'P0001';
  end if;

  perform link_staff_account(p_staff, p_user);

  -- An older E3 still waiting (the drain is down, say) would go out with a
  -- token this resend has replaced.
  perform activation_link_refresh(p_staff, p_user, p_activation_link);

  select count(*)::int + 1 into v_n
    from audit_log a
   where a.entity_id = p_staff and a.action = 'onboarding_resend_activation' and a.entity = 'staff';
  v_key := 'E3:resend:' || p_staff::text || ':' || v_n;

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values (v_key, 'email', 'E3', array[s.email],
          jsonb_build_object('link', btrim(p_activation_link),
                             'installLink', btrim(p_install_link),
                             'name', s.first_name));

  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'onboarding_resend_activation', 'staff', p_staff,
          jsonb_build_object('n', v_n, 'outboxKey', v_key, 'userId', p_user::text, 'raced', v_raced));

  return jsonb_build_object('staffId', p_staff::text, 'queued', true, 'n', v_n, 'outboxKey', v_key);
end $$;

-- ---------------------------------------------------------------------
-- 4 · activation_preview(), 20260928110000's body: the activation token
--     only, and only within the link's 24-hour lifetime.
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

  select jsonb_build_object(
           'firstName', s.first_name,
           'lastName',  s.last_name,
           'email',     u.email,
           -- §2.7 "the link is personal and single-use": a password already
           -- set means the link is spent, and the page says so instead of
           -- offering a form that verifyOtp would refuse on submit.
           'activated', coalesce(u.encrypted_password, '') <> '')
    into v
    from auth.users u
    join staff s on s.user_id = u.id
   where u.confirmation_token = p_token_hash
     and s.removed_at is null
     -- 20261012120500: GoTrue's otp_expiry (24 h, supabase/config.toml).
     and coalesce(nullif(to_jsonb(u) ->> 'confirmation_sent_at', '')::timestamptz, now())
           > now() - interval '24 hours'
   limit 1;

  return v;
end $$;

revoke execute on function public.activation_preview(text) from public, anon, authenticated;
grant  execute on function public.activation_preview(text) to service_role;
