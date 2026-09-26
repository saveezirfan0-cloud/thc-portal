-- =====================================================================
-- Migration 20260930204000 · /apply?ref= records who referred whom
--                            (ADR-0047; docs/19 §5; §2.1, §2.3, §1.7)
--
-- A compliant worker shares {origin}/apply?ref={code} (Agent B's
-- /profile/refer). The Staff App's server action carries the code in a
-- hidden field and passes it here, on the SERVICE-ROLE path only. This
-- migration does two things and nothing else:
--
--   1 · record_application_referral(p_email, p_code) — new, owner-only.
--       Finds the application submit_application() has just written for
--       this email (the same normalisation submit_application() uses),
--       finds the code's owner, skips a malformed, unknown, revoked or
--       own code, and inserts one application_referrals row, `on
--       conflict do nothing`. It NEVER raises: a referral is a note on an
--       application, and an application is never refused because of one.
--       No API role can call it — not anon, not authenticated, not the
--       service role. Only a definer running as the owner reaches it.
--
--   2 · submit_application_as_caller — RESTATED (docs/19 §0.6, the only
--       restatement Agent D is allowed). Byte-for-byte the body of
--       20260926100200, which is its latest and only definition (grep:
--       no later migration touches it — re-checked after main's
--       20260930100000–20260930140100 landed: 20260930120200 changes
--       submit_application()'s grants, not this function), plus:
--         · an 8th argument, p_referral_code text default null;
--         · one clause right after `perform public.submit_application(…)`
--           that calls record_application_referral when a code was sent.
--       The 7-argument function is dropped first: `create or replace`
--       with an extra argument would create a SECOND overload and leave
--       the old one published beside it. The default keeps every 7-arg
--       positional caller (522_apply_caller_throttle) working unchanged.
--       Grants are the ones being restated: service role only.
--
-- What does NOT change (docs/10 §3b — pgTAP 731 asserts every gate
-- together):
--   · submit_application() — not restated, takes no code, records
--     nothing. 120_apply and 190 still see exactly one of it. (Since
--     main's 20260930120200 it is service-role only, so this function is
--     the only way /apply reaches it; nothing here depends on that.)
--   · The per-caller throttle, the per-email / per-mobile throttle, every
--     validation message, the §2.12 match. The referral is written only
--     after all of them passed, and a refused application writes nothing.
--   · The response: void, with or without a code, good or bad. The
--     applicant is never told who referred them, nor whether the code
--     counted (Q20).
--
-- No money, no client surface: application_referrals has admin_read only
-- (20260930200100), and nothing here reaches pay, reports or PDFs (Q19).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · record_application_referral — owner-only, never raises
-- ---------------------------------------------------------------------
create or replace function public.record_application_referral(
  p_email text,
  p_code  text
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  -- Exactly submit_application()'s normalisation, so the lookup below
  -- finds the row it wrote.
  v_email     text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  -- What normaliseReferralCode() in packages/domain does: trim, upper.
  v_code      text := upper(btrim(coalesce(p_code, '')));
  v_app       uuid;
  v_candidate uuid;
  v_referrer  uuid;
begin
  if v_email is null or v_code !~ '^[A-HJ-NP-Z2-9]{8}$' then
    return;
  end if;

  begin
    -- The application just written: this email, stamped in this
    -- transaction (created_at defaults to now(), the transaction start),
    -- and not already carrying a referral. Anything older is a previous
    -- application and is never re-attributed.
    select a.id, a.staff_id
      into v_app, v_candidate
      from applications a
     where a.email = v_email
       and a.created_at = now()
       and not exists (select 1 from application_referrals r where r.application_id = a.id)
     limit 1;

    if v_app is null then
      return;
    end if;

    -- A revoked code (GDPR removal, 20260930200100) records nothing; so
    -- does a code whose owner has since been removed, belt and braces.
    select c.staff_id
      into v_referrer
      from staff_referral_codes c
      join staff s on s.id = c.staff_id
     where c.code = v_code
       and c.revoked_at is null
       and s.removed_at is null;

    -- Unknown code, or the applicant's own (a returning applicant matched
    -- to the referrer's own record): nothing to record.
    if v_referrer is null or v_referrer = v_candidate then
      return;
    end if;

    insert into application_referrals (application_id, referrer_staff_id, candidate_staff_id, code)
    values (v_app, v_referrer, v_candidate, v_code)
    on conflict do nothing;
  exception when others then
    -- Never raises (ADR-0047 point 4). The block is its own
    -- subtransaction, so only the referral is rolled back — the
    -- application the caller just wrote stands.
    return;
  end;
end $$;

comment on function public.record_application_referral(text, text) is
  'ADR-0047: records who referred an application that arrived through /apply?ref=. Finds the application submit_application() just wrote for this email (same normalisation), skips a malformed, unknown, revoked or own code, inserts on conflict do nothing, and never raises. Owner-only: called by submit_application_as_caller(), by no API role.';

revoke execute on function public.record_application_referral(text, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2 · submit_application_as_caller — restated from 20260926100200 with
--     p_referral_code as the 8th argument
-- ---------------------------------------------------------------------
drop function if exists public.submit_application_as_caller(text, text, text, text, date, boolean, text);

create or replace function public.submit_application_as_caller(
  p_first_name  text,
  p_last_name   text,
  p_email       text,
  p_phone       text,
  p_dob         date,
  p_consent     boolean,
  p_caller_hash text,
  -- ADR-0047: /apply?ref=. Recorded after the application is written,
  -- never a reason to refuse it.
  p_referral_code text default null
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

  -- ADR-0047: the one new clause. Only reached once the application is
  -- written; record_application_referral() never raises, so a bad,
  -- revoked or own code changes nothing the caller can see.
  if p_referral_code is not null then
    perform public.record_application_referral(p_email, p_referral_code);
  end if;

  if v_hash is not null then
    insert into private.apply_caller_hits (caller_hash) values (v_hash);
  end if;
end $$;

comment on function public.submit_application_as_caller(text, text, text, text, date, boolean, text, text) is
  '§2.1 /apply through the Staff App server action: submit_application() plus a per-caller limit (settings.apply_caller_throttle: 5/hour, 20/day) keyed by an HMAC of the caller''s IP, never the IP. Null hash = no per-caller check. An optional referral code (/apply?ref=, ADR-0047) is recorded by record_application_referral() after the application is written and never refuses it. Service role only (ADR-0024).';

revoke execute on function public.submit_application_as_caller(text, text, text, text, date, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_application_as_caller(text, text, text, text, date, boolean, text, text)
  to service_role;
