-- =====================================================================
-- Client Portal · "Change password" is throttled per account
-- (ADR-0051; security review L2, §1.7)
--
-- /client/account's server action re-verifies the current password with
-- signInWithPassword before it changes anything. That check had no
-- per-account limit. Someone holding a signed-in session (a laptop left
-- open) could POST the action over and over to guess the current
-- password, and every attempt leaves from Vercel's addresses, so
-- Supabase Auth's per-IP limit never binds the attacker — it binds every
-- other portal user sharing those addresses instead.
--
-- The limit: 5 failed current-password checks per account per 15
-- minutes. Past that, the action answers "Too many attempts" WITHOUT
-- calling signInWithPassword. It is purely time-based: a correct
-- password does not clear the count, so there is nothing to reset and
-- nothing for a caller to reset.
--
-- Where the failures live: private.password_check_failures. Not `public`,
-- for the reason 20260926100200 (apply_caller_hits) gives: PostgREST
-- publishes public, anon and authenticated get default privileges there,
-- and 001_rls_guard inventories it and requires every RLS table in public
-- to carry a policy. The `private` schema is not exposed and grants
-- nothing to either API role; the table has RLS on with no policy and
-- every privilege revoked besides. The only ways in are the two functions
-- below, and each is keyed on auth.uid() — a caller can read or grow only
-- their own count, never name another account.
--
-- Hardening follows the repo's definer convention: security definer,
-- `set search_path = public, extensions` (002 assertion 1), every name
-- schema-qualified, EXECUTE revoked from public and anon and granted to
-- authenticated. 190 2e/2f hold that no definer reaches anon or keeps
-- PUBLIC's default grant; 608_client_password_attempts holds the rest.
--
-- Known residual: check and record are two calls, so a burst of parallel
-- POSTs all read "allowed" before any of them records. The count still
-- closes the door within one round trip; the burst is bounded by what one
-- session can have in flight, and Supabase Auth's own limit still applies
-- to it. A reservation row per attempt would close it and is not worth a
-- second round trip on the one write the portal has.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.password_check_failures (
  user_id   uuid        not null references auth.users (id) on delete cascade,
  failed_at timestamptz not null default now()
);
alter table private.password_check_failures enable row level security;
revoke all on table private.password_check_failures from public, anon, authenticated;

create index if not exists password_check_failures_user_failed_at_idx
  on private.password_check_failures (user_id, failed_at);

comment on table private.password_check_failures is
  'ADR-0051 / security review L2: one row per failed current-password check on the Client Portal''s Change password action. 5 per account per 15 minutes, then refused before signInWithPassword runs. Rows older than a day are trimmed on each write; deleting the auth user cascades. RLS on with no policy, no API-role privilege; reached only through password_check_allowed() and record_password_check_failure().';

-- ---------------------------------------------------------------------
-- password_check_allowed(): may the caller try their current password?
--
-- True while the caller has fewer than 5 failures in the last 15 minutes.
-- False for a null uid: with no account there is nothing to check a
-- password against, and "fail closed" is the only safe answer.
-- ---------------------------------------------------------------------
create or replace function public.password_check_allowed()
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return false;
  end if;

  return (select count(*)
            from private.password_check_failures f
           where f.user_id = v_uid
             and f.failed_at > now() - interval '15 minutes') < 5;
end $$;

comment on function public.password_check_allowed() is
  'ADR-0051 / security review L2: true while the caller (auth.uid()) has fewer than 5 failed current-password checks in the last 15 minutes; false for a null uid. Called by the Client Portal''s Change password action before signInWithPassword.';

revoke execute on function public.password_check_allowed() from public, anon;
grant execute on function public.password_check_allowed() to authenticated;

-- ---------------------------------------------------------------------
-- record_password_check_failure(): count one wrong current password.
--
-- A no-op for a null uid. Trims the caller's own rows older than a day on
-- every write, so the table holds at most a day of each account's
-- failures and needs no job.
-- ---------------------------------------------------------------------
create or replace function public.record_password_check_failure()
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;

  insert into private.password_check_failures (user_id) values (v_uid);

  delete from private.password_check_failures f
   where f.user_id = v_uid
     and f.failed_at < now() - interval '1 day';
end $$;

comment on function public.record_password_check_failure() is
  'ADR-0051 / security review L2: records one failed current-password check for the caller (auth.uid()) and trims that caller''s rows older than a day. No-op for a null uid. Called by the Client Portal''s Change password action after "invalid credentials" only.';

revoke execute on function public.record_password_check_failure() from public, anon;
grant execute on function public.record_password_check_failure() to authenticated;
