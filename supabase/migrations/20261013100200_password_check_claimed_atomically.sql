-- =====================================================================
-- Migration 20261013100200 · Client Portal Change password: the attempt
--                            is claimed and counted in ONE call (§11.1,
--                            ADR-0051, ADR-0120)
--
-- 20261001100200 split the Change password action's per-account limit
-- into a check (password_check_allowed) and a record
-- (record_password_check_failure) and named the residual itself: a burst
-- of parallel POSTs all read "allowed" before any of them records.
-- (20261012121000's sign-in counters, ADR-0051 §25, keep the same
-- residual, and say so; this file does not touch them.)
--
-- password_check_begin() closes it for Change password: under a
-- per-account advisory lock it counts the account's rows in the last 15
-- minutes and, below 5, writes one row for THIS attempt and returns its id
-- — so a sixth concurrent attempt waits for the lock and then sees five.
-- The row is a failure until shown otherwise: the action calls
-- password_check_release(id) when the current password turned out to be
-- right, or when the check failed for a reason that is not a wrong
-- password (Supabase's own rate limit, a network error). A lost release
-- counts as a failure, which fails closed. The two older functions stay
-- for one release (a deployment still running the previous build calls
-- them) and read the same rows.
--
-- Same table, same limit (5 per account per 15 minutes), same caller: a
-- signed-in client, whose uid keys the row. Not a second throttle — the
-- existing one made atomic.
--
-- Grants: authenticated only (a signed-in caller counts their own
-- attempts), never anon or PUBLIC; 20261012121500 stops new functions
-- being anon's by default and the revoke below says it outright.
-- 808_password_check_claimed_atomically pins it.
-- =====================================================================

alter table private.password_check_failures
  add column if not exists id bigint generated always as identity;

comment on table private.password_check_failures is
  'ADR-0051 / security review L2: one row per current-password check on the Client Portal''s Change password action that has not been shown to be a correct password. password_check_begin() writes it before the check, under a per-account lock; password_check_release() deletes it when the password was right or the failure was not a wrong password. 5 per account per 15 minutes, then refused before signInWithPassword runs. Rows older than a day are trimmed on each write; deleting the auth user cascades. RLS on with no policy, no API-role privilege. 20261013100200.';

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
  'ADR-0051: claim one current-password check for the caller. Under a per-account advisory lock: null (refused) when the caller already has 5 counted checks in the last 15 minutes or has no uid; otherwise records this attempt and returns its id. The attempt counts as a failure unless password_check_release(id) is called. 20261013100200.';

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
  'ADR-0051: un-count an attempt password_check_begin() claimed — the current password was right, or the check failed for a reason that is not a wrong password. Touches only the caller''s own row. 20261013100200.';

revoke all on function public.password_check_release(bigint) from public, anon;
grant execute on function public.password_check_release(bigint) to authenticated;

comment on function public.password_check_allowed() is
  'SUPERSEDED by password_check_begin() (20261013100200), kept for one release for a deployment still on the previous build. True while the caller has fewer than 5 counted checks in the last 15 minutes; false for a null uid.';
comment on function public.record_password_check_failure() is
  'SUPERSEDED by password_check_begin() (20261013100200), kept for one release for a deployment still on the previous build. Records one failed check for the caller.';
