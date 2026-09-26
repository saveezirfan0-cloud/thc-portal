-- =====================================================================
-- Migration 20260930205300 · a referral is recorded for a NEW candidate
--                            only (ADR-0047; security finding #5)
--
-- 20260930204000 let record_application_referral() attach a referral to
-- any application written in the current transaction — including one the
-- §2.12 match filed against an EXISTING record (outcome =
-- 'returning_applicant'). The match is on email + DOB (or mobile + DOB),
-- and both are easy to know about someone else. So anyone holding a code
-- and a worker's email and date of birth could submit /apply?ref={code}
-- and pin "Referred by X" on that existing worker's profile — and add one
-- to X's "N people have applied with your link" count, as often as the
-- throttles allowed.
--
-- A referral means "this person came to THC through X's link". An
-- existing worker (or a returning applicant) did not: they were already
-- on file. So the lookup now finds only an application that created a new
-- candidate (outcome = 'candidate_created'). A returning-applicant match
-- records nothing.
--
-- What does NOT change:
--   · The application. It is still written, with the outcome it would
--     have had without a code; the referral is only ever a note on it.
--   · The response: void, identical with or without a code, and whether
--     or not the code counted (Q20). The applicant cannot tell a match
--     from a new record by the referral (§2.12 — they always see the
--     ordinary confirmation).
--   · submit_application_as_caller (20260930204000) — not restated; it
--     calls this function exactly as before.
--   · The grants: owner-only. No API role — not anon, not authenticated,
--     not the service role — can call it.
--   · Rows already written. Any application_referrals row recorded before
--     this migration against a returning application stays as it is; the
--     office can see which ones they are (application outcome).
--
-- pgTAP 731 (B) asserts a returning-applicant match now records nothing
-- and the application still succeeds.
-- =====================================================================

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
    -- not already carrying a referral — and one that created a NEW
    -- candidate. A returning-applicant match (§2.12) is an existing
    -- record: nobody referred it, and anyone knowing its email + DOB
    -- could otherwise pin a referrer on it (security finding #5).
    -- Anything older is a previous application and is never
    -- re-attributed.
    select a.id, a.staff_id
      into v_app, v_candidate
      from applications a
     where a.email = v_email
       and a.outcome = 'candidate_created'
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

    -- Unknown code, or (belt and braces — a new candidate is a new staff
    -- row, and the table's check forbids it too) the applicant's own.
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
  'ADR-0047: records who referred an application that arrived through /apply?ref=. Finds the application submit_application() just wrote for this email (same normalisation) — only one that created a new candidate (outcome candidate_created); a returning-applicant match records nothing (security finding #5, 20260930205300). Skips a malformed, unknown, revoked or own code, inserts on conflict do nothing, and never raises. Owner-only: called by submit_application_as_caller(), by no API role.';

revoke execute on function public.record_application_referral(text, text)
  from public, anon, authenticated, service_role;
