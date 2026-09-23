-- =====================================================================
-- /apply is throttled per caller as well (§2.1, §1.7; ADR-0024;
-- docs/14 §4 "D2" and "/apply is still unthrottled per caller")
--
-- 20260922183012 limits applications per email and per mobile. A caller
-- with a fresh pair each time was bounded only at the edge. This adds the
-- third key: the caller's network address — but never the address itself.
--
-- The Staff App's server action (apps/staff/app/apply/actions.ts) reads
-- the caller's IP from the request (Vercel's x-forwarded-for first hop,
-- else x-real-ip), HMACs it with a server-side salt
-- (APPLY_THROTTLE_SALT), and passes only the 64-hex digest here. This
-- function REFUSES anything that is not a 64-hex digest, so a raw IP can
-- never be stored by mistake (§1.7), and keeps the digests for two days.
--
-- Where the digests live: private.apply_caller_hits. Not `public`:
-- PostgREST publishes public, anon and authenticated get default
-- privileges there, and 001_rls_guard inventories it. The `private` schema
-- is not exposed, grants nothing to either API role, and the table has
-- RLS on with no policy besides — three locks where one would do, because
-- this is the one table in the system whose whole point is that nobody
-- reads it.
--
-- Why a new function and not a submit_application overload: 120_apply
-- holds that exactly one submit_application exists, and 190 holds that
-- it is one of exactly three definer functions anon can reach. This one
-- is SERVICE ROLE ONLY — a caller hash anyone could supply would be a
-- limit anyone could step around by sending a new one. The form calls it
-- with the service key when the deployment has one; submit_application
-- keeps anon for the fallback and for 120/190, and does all the
-- validation, locking, matching and writing either way.
--
-- What remains open: anon can still call submit_application directly
-- through PostgREST, which this limit does not see. Closing that is a
-- revoke once every deployment carries SUPABASE_SERVICE_ROLE_KEY, and
-- 120/190 move with it (ADR-0024).
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.apply_caller_hits (
  id          bigint generated always as identity primary key,
  caller_hash text not null check (caller_hash ~ '^[0-9a-f]{64}$'),
  at          timestamptz not null default now()
);
alter table private.apply_caller_hits enable row level security;
revoke all on table private.apply_caller_hits from public, anon, authenticated;

create index if not exists apply_caller_hits_hash_at_idx on private.apply_caller_hits (caller_hash, at desc);
create index if not exists apply_caller_hits_at_idx on private.apply_caller_hits (at);

comment on table private.apply_caller_hits is
  '§2.1 per-caller throttle for /apply: one row per application accepted, keyed by an HMAC of the caller''s IP (never the IP, §1.7). Purged after settings.apply_caller_throttle.retention_hours (48). Not readable by any API role.';

-- §9.12: numbers an office can change without a release.
insert into settings (key, value) values
  ('apply_caller_throttle', '{"per_hour": 5, "per_day": 20, "retention_hours": 48}'::jsonb)
on conflict (key) do nothing;

create or replace function public.submit_application_as_caller(
  p_first_name  text,
  p_last_name   text,
  p_email       text,
  p_phone       text,
  p_dob         date,
  p_consent     boolean,
  p_caller_hash text
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash      text := nullif(lower(btrim(coalesce(p_caller_hash, ''))), '');
  v_limits    jsonb;
  v_per_hour  int;
  v_per_day   int;
  v_retention interval;
begin
  if v_hash is not null then
    -- A digest or nothing: never a raw address (§1.7).
    if v_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'bad_caller_hash' using errcode = 'P0001';
    end if;

    v_limits    := coalesce((select value from settings where key = 'apply_caller_throttle'), '{}'::jsonb);
    v_per_hour  := coalesce((v_limits ->> 'per_hour')::int, 5);
    v_per_day   := coalesce((v_limits ->> 'per_day')::int, 20);
    v_retention := make_interval(hours => greatest(coalesce((v_limits ->> 'retention_hours')::int, 48), 24));

    -- Two submissions from one caller cannot both read a count under the
    -- limit.
    perform pg_advisory_xact_lock(hashtext('apply:caller'), hashtext(v_hash));

    -- Retention (§1.7), here rather than in a job: every call trims what
    -- has aged out, so nothing outlives two days by more than the gap
    -- between two applications.
    delete from private.apply_caller_hits where at < now() - v_retention;

    if (select count(*) from private.apply_caller_hits
         where caller_hash = v_hash and at > now() - interval '1 hour') >= v_per_hour
    or (select count(*) from private.apply_caller_hits
         where caller_hash = v_hash and at > now() - interval '24 hours') >= v_per_day
    then
      -- 22023: shown to the applicant as written. Says nothing about any
      -- email or mobile (§2.12).
      raise exception 'We’ve received several applications from your connection recently. Please try again later — or email admin@thehospitalitycompany.co.uk and we’ll help.'
        using errcode = '22023';
    end if;
  end if;

  -- Everything else — validation, the per-email/mobile throttle, the
  -- §2.12 match, the writes — is the public function's, unchanged. If it
  -- refuses, the hit below is never written: what is counted is
  -- applications accepted.
  perform public.submit_application(p_first_name, p_last_name, p_email, p_phone, p_dob, p_consent);

  if v_hash is not null then
    insert into private.apply_caller_hits (caller_hash) values (v_hash);
  end if;
end $$;

comment on function public.submit_application_as_caller(text, text, text, text, date, boolean, text) is
  '§2.1 /apply through the Staff App server action: submit_application() plus a per-caller limit (settings.apply_caller_throttle: 5/hour, 20/day) keyed by an HMAC of the caller''s IP, never the IP. Null hash = no per-caller check. Service role only (ADR-0024).';

revoke execute on function public.submit_application_as_caller(text, text, text, text, date, boolean, text)
  from public, anon, authenticated;
grant execute on function public.submit_application_as_caller(text, text, text, text, date, boolean, text)
  to service_role;
