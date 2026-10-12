-- =====================================================================
-- Migration 20261012121100 · /apply's caller throttle no longer fails
--                            open (ADR-0024, §2.12)
--
-- submit_application_as_caller() (latest 20261008130000) skipped the
-- per-caller throttle entirely when p_caller_hash was null. The Staff
-- App's callerKey() (apps/staff/app/apply/caller.ts) sends null when the
-- request carries no client address, and — on purpose, so a misconfigured
-- deployment is loud rather than silently weak — when a production
-- deployment has no APPLY_THROTTLE_SALT. In both cases /apply could be
-- scripted with no per-caller limit at all; only the per-email/mobile
-- throttle stood. Security audit 12.10.2026, NOTE.
--
-- Failing closed (refusing a null hash) would take /apply down for every
-- applicant the day the salt is missing. Instead a null hash joins ONE
-- shared bucket (the key 64 zeros, which no sha256 a caller sends may be)
-- with its own limits, read from settings.apply_caller_throttle like the
-- others: unidentified_per_hour (default 30) and unidentified_per_day
-- (default 200) — wide enough for a normal day's applications through a
-- misconfigured deployment, narrow enough that a script is stopped. The
-- refusal is the same 22023 sentence. Everything else is the live body
-- unchanged (grants kept by create or replace).
-- 797_apply_caller_throttle_shared_bucket pins it.
-- =====================================================================

create or replace function public.submit_application_as_caller(p_first_name text, p_last_name text, p_email text, p_phone text, p_dob date, p_consent boolean, p_caller_hash text, p_referral_code text DEFAULT NULL::text, p_source text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_hash      text := nullif(lower(btrim(coalesce(p_caller_hash, ''))), '');
  v_limits    jsonb;
  v_per_hour  int;
  v_per_day   int;
  v_retention interval;
begin
  -- 20261012121100: no caller hash (no address on the request, or no
  -- APPLY_THROTTLE_SALT on the deployment) is no longer a free pass. Every
  -- such call shares ONE bucket, with its own, wider limits.
  if v_hash is null then
    v_hash := repeat('0', 64);
  elsif v_hash = repeat('0', 64) or v_hash !~ '^[0-9a-f]{64}$' then
    -- A digest or nothing: never a raw address (§1.7). The shared
    -- bucket's key is not a digest a caller may claim.
    raise exception 'bad_caller_hash' using errcode = 'P0001';
  end if;

  begin
    v_limits    := coalesce((select value from settings where key = 'apply_caller_throttle'), '{}'::jsonb);
    if v_hash = repeat('0', 64) then
      v_per_hour  := coalesce((v_limits ->> 'unidentified_per_hour')::int, 30);
      v_per_day   := coalesce((v_limits ->> 'unidentified_per_day')::int, 200);
    else
      v_per_hour  := coalesce((v_limits ->> 'per_hour')::int, 5);
      v_per_day   := coalesce((v_limits ->> 'per_day')::int, 20);
    end if;
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
  end;

  -- Everything else — validation, the per-email/mobile throttle, the
  -- §2.12 match, the writes — is the public function's, unchanged. If it
  -- refuses, the hit below is never written: what is counted is
  -- applications accepted.
  perform public.submit_application(p_first_name, p_last_name, p_email, p_phone, p_dob, p_consent);

  -- ADR-0047: the one new clause. Only reached once the application is
  -- written; record_application_referral() never raises, so a bad,
  -- revoked or own code changes nothing the caller can see.
  if p_referral_code is not null then
    perform public.record_application_referral(p_email, p_referral_code);
  end if;

  -- 20261008120000: SpudBros Express / the invite list. Never raises, and
  -- only ever touches the candidate this call created.
  -- 20261008130000 (ADR-0107): always, because the invite list can decide a
  -- group (and a Payroll ID) for an application that came through /apply.
  perform public.record_application_source(p_email, p_source);

  insert into private.apply_caller_hits (caller_hash) values (v_hash);
end $function$;
