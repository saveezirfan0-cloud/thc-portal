-- =====================================================================
-- Migration 20260926100000 · /apply: a limit per CALLER (docs/14 D2,
--                            ADR-0024, §1.7, §2.1, §2.12)
--
-- 20260922183012 bounded `submit_application()` per email and per mobile
-- and said, in its own header, what it could not do: "a distributed
-- caller with a fresh email and mobile each time is still only bounded by
-- the edge." This is the other half. The Staff App's server action
-- (apps/staff/app/apply/actions.ts) asks `apply_caller_check()` BEFORE it
-- calls `submit_application()`, keyed on a salted hash of the client
-- address (apps/staff/lib/callerKey.ts). The count lives here rather than
-- in the app so it holds across every serverless instance Vercel spins
-- up — an in-memory counter is one per instance and is reset by every
-- cold start, which is exactly the shape an attacker gets for free.
--
-- What is stored (§1.7): a 64-character hex digest and a timestamp.
-- Nothing else, and the CHECK below makes the address itself unstorable.
-- The salt never reaches the database, so a row cannot be walked back to
-- an address by anyone who can read the table.
--
-- Who can read the table: nobody through PostgREST. RLS is on and there
-- is deliberately no policy — the RPC is the only door, it is SECURITY
-- DEFINER, and there is no screen that has a use for a list of hashes.
-- (001_rls_guard lists every RLS table and asserts none is policy-less
-- by omission; this one is policy-less on purpose and needs naming
-- there.)
--
-- Two windows, both `settings` (§9.12), like `apply_throttle`:
--   · short: 5 attempts in 10 minutes. A real applicant submits once, and
--     a retry after a mistake is two or three; five covers a household
--     applying together from one connection.
--   · long: 20 in 24 hours. A recruitment stand or a college IT suite
--     shares one address, so this is a day's worth of genuine
--     applications from one place, not one person's.
-- Both are the ceiling on a public write that costs a `staff` row and,
-- once Willo is wired, an interview. Refused calls are NOT recorded, so
-- `retry_after_seconds` is exact: a caller told to wait N seconds is let
-- through after N seconds, however often they tried in between.
--
-- What it does not do, on purpose:
--   · No `p_now` for tests. A clock the caller supplies is a clock the
--     caller can set to last week, and this function is granted to anon.
--     520_apply_caller_throttle moves time by editing `attempted_at`
--     as the migration role instead.
--   · No message. The action owns the copy ("Too many applications from
--     this connection — please try again in a few minutes.") and never
--     shows the limits or the wait, so the endpoint tells a caller
--     nothing about where the line is.
--   · It never fails an applicant on its own account: the action treats
--     an error from this function — not deployed, unreachable — as
--     "allowed" and logs it (fail open). A database hiccup must not turn
--     into a refused application.
-- =====================================================================

-- ---------------------------------------------------------------------
-- apply_caller_attempts — one row per ALLOWED attempt, pruned at 24 h
-- ---------------------------------------------------------------------
create table public.apply_caller_attempts (
  -- HMAC-SHA256 of the bucketed client address under APPLY_CALLER_SALT,
  -- lower-case hex. The CHECK is the §1.7 guarantee: an address, in any
  -- notation, cannot be inserted here even by a bug in the app.
  caller_hash  text        not null check (caller_hash ~ '^[0-9a-f]{64}$'),
  attempted_at timestamptz not null default now()
);

comment on table public.apply_caller_attempts is
  'Per-caller attempts on /apply (ADR-0024). A salted hash of the client address and a time — never the address (§1.7). Written and read only by apply_caller_check(); no policy on purpose. Rows older than the long window are pruned by the next call.';
comment on column public.apply_caller_attempts.caller_hash is
  'HMAC-SHA256 of the bucketed client address (IPv4 as-is, IPv6 by /64) under the server-side APPLY_CALLER_SALT, as 64 lower-case hex characters. The CHECK refuses anything else, so an address cannot be stored by mistake.';

-- The count is per caller over a window; the prune is by age alone.
create index apply_caller_attempts_caller_idx on public.apply_caller_attempts (caller_hash, attempted_at desc);
create index apply_caller_attempts_age_idx    on public.apply_caller_attempts (attempted_at);

alter table public.apply_caller_attempts enable row level security;
-- No policy: deny-all for every PostgREST role. Belt and braces, the
-- default grants Supabase hands every new table are taken back as well,
-- so a policy added later by mistake still opens nothing on its own.
revoke all on table public.apply_caller_attempts from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- settings.apply_caller_throttle (§9.12)
--
-- The defaults, and the same numbers the function falls back to when the
-- row is missing or a key is absent — so deleting the row does not turn
-- the limit off. Raise them for a recruitment day; the office does not
-- need a release. (The /settings page does not list this key yet.)
-- ---------------------------------------------------------------------
insert into settings (key, value) values
  ('apply_caller_throttle',
   '{"short_window_minutes": 10, "short_limit": 5, "long_window_hours": 24, "long_limit": 20}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- apply_caller_check(p_caller_hash) → {"allowed": bool, "retry_after_seconds": int}
-- ---------------------------------------------------------------------
create or replace function public.apply_caller_check(p_caller_hash text) returns jsonb
language plpgsql security definer set search_path = public, extensions as
$$
declare
  v_hash         text := lower(btrim(coalesce(p_caller_hash, '')));
  v_limits       jsonb;
  v_short_window interval;
  v_short_limit  int;
  v_long_window  interval;
  v_long_limit   int;
  v_short_count  int;
  v_short_oldest timestamptz;
  v_long_count   int;
  v_long_oldest  timestamptz;
  v_retry        int;
begin
  -- The shape the app produces and nothing else: the table must never
  -- carry an address, and the CHECK on the column would refuse one anyway.
  -- This raises first so the refusal is a clear 22023 rather than a
  -- constraint violation.
  if v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'apply_caller_check expects a 64-character hex digest, never an address.'
      using errcode = '22023';
  end if;

  -- Limits from settings, with the migration's defaults behind every key.
  -- Floored at 1: a zero window or a zero limit is a typo, not a policy
  -- of refusing everyone.
  v_limits := coalesce((select value from settings where key = 'apply_caller_throttle'), '{}'::jsonb);
  v_short_window := make_interval(mins  => greatest(coalesce((v_limits ->> 'short_window_minutes')::int, 10), 1));
  v_short_limit  := greatest(coalesce((v_limits ->> 'short_limit')::int, 5), 1);
  v_long_window  := make_interval(hours => greatest(coalesce((v_limits ->> 'long_window_hours')::int, 24), 1));
  v_long_limit   := greatest(coalesce((v_limits ->> 'long_limit')::int, 20), 1);

  -- Opportunistic prune: nothing older than the longer window is ever
  -- read again, so every call sweeps it. The table holds at most a day
  -- of attempts, and the age index makes this a range scan that usually
  -- finds nothing.
  delete from apply_caller_attempts
   where attempted_at < now() - greatest(v_long_window, v_short_window);

  -- One caller at a time, held to the end of the transaction, so two
  -- requests racing from one address cannot both read n-1 and both pass.
  -- Same shape as the per-arm locks in submit_application().
  perform pg_advisory_xact_lock(hashtext('apply:caller'), hashtext(v_hash));

  select count(*)          filter (where attempted_at > now() - v_short_window),
         min(attempted_at) filter (where attempted_at > now() - v_short_window),
         count(*),
         min(attempted_at)
    into v_short_count, v_short_oldest, v_long_count, v_long_oldest
    from apply_caller_attempts
   where caller_hash = v_hash
     and attempted_at > now() - v_long_window;

  if v_short_count >= v_short_limit or v_long_count >= v_long_limit then
    -- How long until the oldest counted attempt leaves whichever window
    -- tripped; the later of the two when both did. Never below 1: a
    -- refusal with "wait 0 seconds" is a contradiction.
    v_retry := greatest(
      case when v_short_count >= v_short_limit
           then ceil(extract(epoch from (v_short_oldest + v_short_window - now()))) else 0 end,
      case when v_long_count >= v_long_limit
           then ceil(extract(epoch from (v_long_oldest + v_long_window - now()))) else 0 end,
      1)::int;
    return jsonb_build_object('allowed', false, 'retry_after_seconds', v_retry);
  end if;

  -- Only an allowed attempt is recorded (see the header): the count is
  -- of calls that went on to submit_application().
  insert into apply_caller_attempts (caller_hash) values (v_hash);
  return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
end
$$;

-- /apply is a public URL with no registration (§2.1), so anon calls this
-- through the same anon-key SSR client that calls submit_application().
revoke execute on function public.apply_caller_check(text) from public;
grant  execute on function public.apply_caller_check(text) to anon, authenticated;

comment on function public.apply_caller_check(text) is
  'The per-caller limit on /apply (ADR-0024). Takes the salted hash of the client address from apps/staff/lib/callerKey.ts, never an address; records the attempt when allowed; answers {allowed, retry_after_seconds} against settings.apply_caller_throttle (defaults 5 per 10 minutes and 20 per 24 hours); prunes rows older than the long window. Called by the server action before submit_application(); an error here is treated by the action as allowed (fail open).';
