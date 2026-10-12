-- =====================================================================
-- Migration 20261012121000 · sign-in, two-step code and forgot-password
--                            are throttled per account (ADR-0051 §25)
--
-- Supabase Auth's rate limits are per IP. Every sign-in, two-step code
-- and "forgot password" in the three apps runs in a Next.js server action
-- on Vercel, so GoTrue sees Vercel's addresses: the per-IP limit binds
-- every user sharing them rather than an attacker guessing one account's
-- password, or one inbox flooded with reset emails. ADR-0051 §25 named it;
-- the Client Portal's Change password check got its own per-account count
-- (password_check_failures, 20261001100200). Security audit 12.10.2026,
-- MEDIUM: the same is needed in front of signInWithPassword, the office's
-- /login/verify code step and resetPasswordForEmail.
--
-- private.auth_attempts, the shape of password_check_failures but keyed
-- on a digest of the ADDRESS (the caller is not signed in yet, so there is
-- no auth.uid()): `key_hash` is the lowercase hex sha256 the app computes
-- of the normalised email (trimmed, lower-cased). No address is stored.
-- `private` is not exposed by PostgREST; RLS on, no policy, every
-- privilege revoked.
--
-- Two functions, SERVICE ROLE ONLY (the apps call them with the admin
-- client before and after the GoTrue call; a browser can neither read nor
-- grow anybody's count):
--
--   auth_attempt_allowed(p_kind text, p_key_hash text) returns boolean
--   record_auth_attempt(p_kind text, p_key_hash text, p_failed boolean) returns void
--
--   kind      limit                          what counts
--   sign_in     5 failures per key / 15 min   p_failed = true (null counts as a failure)
--   sign_in_ip 30 failures per key / 15 min   the same, keyed on the caller's address:
--                                             looser, because a venue's Wi-Fi or the
--                                             office NAT is one address for many people
--   verify    5 failures per key / 15 min    p_failed = true (the two-step code step)
--   recover   3 requests per key / 1 hour    every call (p_failed is ignored)
--
-- A success is not recorded and clears nothing: the window is purely
-- time-based, so there is nothing for a caller to reset (the
-- password_check_failures rule). An unknown kind, or a key that is not 64
-- lowercase hex characters, raises 22023. Rows older than 24 hours are
-- deleted on every record (no job needed); the index on `at` keeps that a
-- range delete.
--
-- Known residual, as 20261001100200's: check and record are two calls, so
-- a burst of parallel requests can all read "allowed" before any records.
--
-- 796_sign_in_and_recover_throttled_per_account pins it.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.auth_attempts (
  id       bigint generated always as identity primary key,
  kind     text        not null check (kind in ('sign_in', 'sign_in_ip', 'recover', 'verify')),
  key_hash text        not null check (key_hash ~ '^[0-9a-f]{64}$'),
  at       timestamptz not null default now()
);
alter table private.auth_attempts enable row level security;
revoke all on table private.auth_attempts from public, anon, authenticated;

create index if not exists auth_attempts_kind_key_at_idx on private.auth_attempts (kind, key_hash, at);
create index if not exists auth_attempts_at_idx          on private.auth_attempts (at);

comment on table private.auth_attempts is
  '20261012121000 (ADR-0051 §25): one row per counted sign-in failure, two-step code failure or password-reset request, keyed on the sha256 of the normalised email — never the address. Reached only through auth_attempt_allowed() and record_auth_attempt() (service role). Rows older than 24 hours are deleted on each record.';

-- The rule, in one place.
create or replace function public.auth_attempt_limit(p_kind text, out max_count int, out window_len interval)
language plpgsql
immutable
set search_path = public, extensions
as $$
begin
  case p_kind
    when 'sign_in' then max_count := 5; window_len := interval '15 minutes';
    when 'sign_in_ip' then max_count := 30; window_len := interval '15 minutes';
    when 'verify'  then max_count := 5; window_len := interval '15 minutes';
    when 'recover' then max_count := 3; window_len := interval '1 hour';
    else
      raise exception 'auth_attempt_kind_invalid' using errcode = '22023';
  end case;
end $$;

revoke execute on function public.auth_attempt_limit(text) from public, anon, authenticated;

create or replace function public.auth_attempt_key_ok(p_key_hash text)
returns void
language plpgsql
immutable
set search_path = public, extensions
as $$
begin
  if coalesce(p_key_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'auth_attempt_key_invalid' using errcode = '22023',
      hint = 'The lowercase hex sha256 of the trimmed, lower-cased email.';
  end if;
end $$;

revoke execute on function public.auth_attempt_key_ok(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- auth_attempt_allowed(): may this address try again?
-- ---------------------------------------------------------------------
create or replace function public.auth_attempt_allowed(p_kind text, p_key_hash text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  l record;
begin
  select * into l from auth_attempt_limit(p_kind);
  perform auth_attempt_key_ok(p_key_hash);
  return (select count(*)
            from private.auth_attempts a
           where a.kind = p_kind
             and a.key_hash = p_key_hash
             and a.at > now() - l.window_len) < l.max_count;
end $$;

comment on function public.auth_attempt_allowed(text, text) is
  '20261012121000 (ADR-0051 §25): false once the key has 5 sign_in failures / 30 sign_in_ip failures / 5 verify failures in 15 minutes, or 3 recover requests in an hour. Service role only; 22023 for an unknown kind or a key that is not 64 lowercase hex characters.';

revoke execute on function public.auth_attempt_allowed(text, text) from public, anon, authenticated;
grant  execute on function public.auth_attempt_allowed(text, text) to service_role;

-- ---------------------------------------------------------------------
-- record_auth_attempt(): count one.
-- ---------------------------------------------------------------------
create or replace function public.record_auth_attempt(p_kind text, p_key_hash text, p_failed boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
begin
  perform auth_attempt_limit(p_kind);
  perform auth_attempt_key_ok(p_key_hash);

  if p_kind = 'recover' or coalesce(p_failed, true) then
    insert into private.auth_attempts (kind, key_hash) values (p_kind, p_key_hash);
  end if;

  delete from private.auth_attempts a where a.at < now() - interval '24 hours';
end $$;

comment on function public.record_auth_attempt(text, text, boolean) is
  '20261012121000 (ADR-0051 §25): records a sign_in, sign_in_ip or verify failure (p_failed true or null; a success records nothing) or any recover request (p_failed ignored), and deletes rows older than 24 hours. Service role only; 22023 for an unknown kind or a malformed key.';

revoke execute on function public.record_auth_attempt(text, text, boolean) from public, anon, authenticated;
grant  execute on function public.record_auth_attempt(text, text, boolean) to service_role;
