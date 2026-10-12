-- =====================================================================
-- Migration 20261012120200 · Client Portal sign-in throttles
--                            (§1.4, §1.7, §10.2; ADR-0051, ADR-0115)
--
-- 1 · Change password: the attempt is claimed and counted in ONE call.
--
--     20261001100200 split the per-account limit into a check
--     (password_check_allowed) and a record (record_password_check_failure)
--     and named the residual itself: a burst of parallel POSTs all read
--     "allowed" before any of them records. password_check_begin() closes
--     it: under a per-account advisory lock it counts the account's rows
--     in the last 15 minutes and, below 5, writes one row for THIS attempt
--     and returns its id — so a sixth concurrent attempt waits for the
--     lock and then sees five. The row is a failure until shown otherwise:
--     the action calls password_check_release(id) when the current
--     password turned out to be right, or when the check failed for a
--     reason that is not a wrong password (Supabase's own rate limit, a
--     network error). A lost release counts as a failure, which fails
--     closed. The two older functions stay for one release (a deployment
--     still running the previous build calls them) and read the same rows.
--
-- 2 · /login and /forgot: per account and per caller, before Supabase.
--
--     Every request the Client Portal makes to Supabase Auth leaves from
--     Vercel's addresses, so GoTrue's per-IP limits never bind one caller:
--     they bind every customer at once. The server actions now take a slot
--     from auth_attempt_take() first, keyed — as /apply's limit is
--     (20260926100200, ADR-0024) — by digests only: an HMAC-SHA256 of the
--     lower-cased email and of the caller's first-hop address, made in the
--     app (apps/client/app/auth/throttle.ts) under a server-only secret.
--     This function refuses anything that is not a 64-hex digest, so a
--     raw address or email can never be stored (§1.7).
--
--     Limits are settings (§9.12), defaulting to:
--       login  10 per email / 15 min, 30 per caller / 15 min
--       reset   3 per email / 60 min, 10 per caller / 60 min
--     Every attempt is counted, successful or not: it is taken BEFORE the
--     answer is known, which is what makes it atomic (no check-then-
--     record). A refused attempt is not counted, so the window drains on
--     its own.
--
--     SERVICE ROLE ONLY, as submit_application_as_caller is. A digest
--     anybody could send would be a limit anybody could fill for someone
--     else (lock a venue's office address out) or step around; and 190 2e
--     keeps the anon-reachable definer list at the two policy helpers.
--     ADR-0115 records what the app does when the key is missing.
--
-- Both tables live in `private` (not exposed, no API-role privilege, RLS
-- on with no policy), for the reasons 20261001100200 gives. Retention is
-- a day, trimmed by every call.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1 · Change password, atomically
-- ---------------------------------------------------------------------
alter table private.password_check_failures
  add column if not exists id bigint generated always as identity;

comment on table private.password_check_failures is
  'ADR-0051 / security review L2: one row per current-password check on the Client Portal''s Change password action that has not been shown to be a correct password. password_check_begin() writes it before the check, under a per-account lock; password_check_release() deletes it when the password was right or the failure was not a wrong password. 5 per account per 15 minutes, then refused before signInWithPassword runs. Rows older than a day are trimmed on each write; deleting the auth user cascades. RLS on with no policy, no API-role privilege. 20261012120200.';

create or replace function public.password_check_begin()
returns bigint
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_id  bigint;
begin
  if v_uid is null then
    return null;
  end if;

  -- Two attempts for one account cannot both count four.
  perform pg_advisory_xact_lock(hashtext('password_check'), hashtext(v_uid::text));

  if (select count(*)
        from private.password_check_failures f
       where f.user_id = v_uid
         and f.failed_at > now() - interval '15 minutes') >= 5 then
    return null;
  end if;

  insert into private.password_check_failures (user_id) values (v_uid)
  returning id into v_id;

  delete from private.password_check_failures f
   where f.user_id = v_uid
     and f.failed_at < now() - interval '1 day';

  return v_id;
end $$;

comment on function public.password_check_begin() is
  'ADR-0051: claim one current-password check for the caller. Under a per-account advisory lock: null (refused) when the caller already has 5 counted checks in the last 15 minutes or has no uid; otherwise records this attempt and returns its id. The attempt counts as a failure unless password_check_release(id) is called. 20261012120200.';

revoke all on function public.password_check_begin() from public, anon;
grant execute on function public.password_check_begin() to authenticated;

create or replace function public.password_check_release(p_attempt bigint)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
begin
  -- Only the caller's own row: an id is not a capability.
  delete from private.password_check_failures f
   where f.id = p_attempt
     and f.user_id = auth.uid();
end $$;

comment on function public.password_check_release(bigint) is
  'ADR-0051: un-count an attempt password_check_begin() claimed — the current password was right, or the check failed for a reason that is not a wrong password. Touches only the caller''s own row. 20261012120200.';

revoke all on function public.password_check_release(bigint) from public, anon;
grant execute on function public.password_check_release(bigint) to authenticated;

comment on function public.password_check_allowed() is
  'SUPERSEDED by password_check_begin() (20261012120200), kept for one release for a deployment still on the previous build. True while the caller has fewer than 5 counted checks in the last 15 minutes; false for a null uid.';
comment on function public.record_password_check_failure() is
  'SUPERSEDED by password_check_begin() (20261012120200), kept for one release for a deployment still on the previous build. Records one failed check for the caller.';

-- ---------------------------------------------------------------------
-- 2 · /login and /forgot
-- ---------------------------------------------------------------------
create table if not exists private.auth_attempt_hits (
  id       bigint generated always as identity primary key,
  action   text not null check (action in ('login', 'reset')),
  key_kind text not null check (key_kind in ('email', 'caller')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  at       timestamptz not null default now()
);
alter table private.auth_attempt_hits enable row level security;
revoke all on table private.auth_attempt_hits from public, anon, authenticated;

create index if not exists auth_attempt_hits_key_at_idx
  on private.auth_attempt_hits (action, key_kind, key_hash, at desc);
create index if not exists auth_attempt_hits_at_idx on private.auth_attempt_hits (at);

comment on table private.auth_attempt_hits is
  '§1.4 / §10.2 Client Portal sign-in (login) and reset-email (reset) throttle: one row per attempt and key, keyed by an HMAC of the lower-cased email or of the caller''s address, never either itself (§1.7). Limits in settings.auth_throttle. Trimmed after a day by every call. Not readable by any API role. 20261012120200.';

-- §9.12: numbers the office can change without a release.
insert into settings (key, value) values
  ('auth_throttle', '{
     "login": {"per_email": 10, "per_caller": 30, "window_minutes": 15},
     "reset": {"per_email": 3,  "per_caller": 10, "window_minutes": 60}
   }'::jsonb)
on conflict (key) do nothing;

create or replace function public.auth_attempt_take(
  p_action      text,
  p_email_hash  text,
  p_caller_hash text
) returns boolean
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_email      text := nullif(lower(btrim(coalesce(p_email_hash, ''))), '');
  v_caller     text := nullif(lower(btrim(coalesce(p_caller_hash, ''))), '');
  v_limits     jsonb;
  v_per_email  int;
  v_per_caller int;
  v_window     interval;
begin
  if p_action is null or p_action not in ('login', 'reset') then
    raise exception 'bad_action' using errcode = '22023';
  end if;
  -- A digest or nothing: never a raw address or email (§1.7).
  if (v_email is not null and v_email !~ '^[0-9a-f]{64}$')
     or (v_caller is not null and v_caller !~ '^[0-9a-f]{64}$') then
    raise exception 'bad_key_hash' using errcode = '22023';
  end if;

  v_limits     := coalesce((select value -> p_action from settings where key = 'auth_throttle'), '{}'::jsonb);
  v_per_email  := coalesce((v_limits ->> 'per_email')::int,  case p_action when 'login' then 10 else 3 end);
  v_per_caller := coalesce((v_limits ->> 'per_caller')::int, case p_action when 'login' then 30 else 10 end);
  -- At most the retention, so a window never reaches rows already trimmed.
  v_window     := make_interval(mins => least(greatest(
                    coalesce((v_limits ->> 'window_minutes')::int, case p_action when 'login' then 15 else 60 end),
                    1), 1440));

  -- Two attempts on one key cannot both read a count under the limit.
  -- Always email before caller, so two calls never wait on each other in
  -- opposite orders.
  if v_email is not null then
    perform pg_advisory_xact_lock(hashtext('auth_attempt:' || p_action || ':email'), hashtext(v_email));
  end if;
  if v_caller is not null then
    perform pg_advisory_xact_lock(hashtext('auth_attempt:' || p_action || ':caller'), hashtext(v_caller));
  end if;

  delete from private.auth_attempt_hits where at < now() - interval '1 day';

  if v_email is not null
     and (select count(*) from private.auth_attempt_hits h
           where h.action = p_action and h.key_kind = 'email' and h.key_hash = v_email
             and h.at > now() - v_window) >= v_per_email then
    return false;
  end if;
  if v_caller is not null
     and (select count(*) from private.auth_attempt_hits h
           where h.action = p_action and h.key_kind = 'caller' and h.key_hash = v_caller
             and h.at > now() - v_window) >= v_per_caller then
    return false;
  end if;

  if v_email is not null then
    insert into private.auth_attempt_hits (action, key_kind, key_hash) values (p_action, 'email', v_email);
  end if;
  if v_caller is not null then
    insert into private.auth_attempt_hits (action, key_kind, key_hash) values (p_action, 'caller', v_caller);
  end if;

  return true;
end $$;

comment on function public.auth_attempt_take(text, text, text) is
  '§1.4 / §10.2 Client Portal throttle for sign-in (login) and reset emails (reset): takes one slot per given key and returns true, or returns false — counting nothing — when either key is at its limit (settings.auth_throttle; default login 10/email + 30/caller per 15 min, reset 3/email + 10/caller per hour). Keys are 64-hex HMAC digests only; a null key is not checked. Service role only (ADR-0115). 20261012120200.';

revoke all on function public.auth_attempt_take(text, text, text) from public, anon, authenticated;
grant execute on function public.auth_attempt_take(text, text, text) to service_role;
