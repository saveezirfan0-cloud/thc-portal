-- =====================================================================
-- Migration 20260921160000 · harden the public application form (§2.1, §2.12)
--
-- Two defects in 20260921150000, both found by reading the /apply
-- implementation that was built in parallel on claude/clever-bohr-jtnpqp
-- and dropped in favour of this one when the two were reconciled. The
-- ideas here are that branch's; they were the better half of it.
--
-- 1. A race that creates exactly the second record §2.12 exists to stop.
--    Two browser tabs, or one double tap on a slow phone, both run the
--    duplicate check, both find no match, and both insert a candidate.
--    Nothing serialises them: the check is a plain select and there is no
--    unique constraint to fall back on, because neither email nor mobile
--    is unique on `staff` (a returning worker legitimately keeps one
--    record, and the office may hold two people on one family number).
--    A transaction-scoped advisory lock keyed on the two things the match
--    looks at makes honest concurrent submissions queue instead of race,
--    and costs nothing when they do not collide.
--
-- 2. The duplicate check could not use an index. It compares
--    `lower(s.email)` and a regexp_replace of `s.phone` against the
--    normalised submission, and neither expression was indexed, so every
--    application sequentially scanned `staff` — ~1,000 rows today and
--    growing with every candidate the form itself creates.
--
--    `normalise_msisdn` exists so the same expression can be written in
--    the index and in the predicate. It also replaces the inline
--    regexp_replace, which kept a `+` wherever it appeared: "44+7700..."
--    normalised to itself, plus and all, and could never match the same
--    number stored cleanly. This strips every non-digit and re-prefixes
--    exactly one `+`, so the normalised form is canonical.
--
--    What it does NOT do is rewrite a trunk or IDD prefix: "0044 7700
--    900123" normalises to "+00447700900123", which the E.164 check then
--    rejects with the ordinary "include the country code" message. That is
--    deliberate — guessing which leading zeros are an IDD prefix and which
--    are part of a national number is how numbers get silently mangled,
--    and the form supplies the country code from its own picker anyway.
-- =====================================================================

create or replace function public.normalise_msisdn(p text) returns text
language sql immutable strict set search_path = public as
$$ select '+' || regexp_replace(p, '[^0-9]', '', 'g') $$;

comment on function public.normalise_msisdn(text) is
  'Digits only, re-prefixed with +. Both sides of the /apply duplicate check (§2.12) go through it, and staff_msisdn_idx indexes it, so the check can use an index. IMMUTABLE for exactly that reason.';

-- Matching expressions, so the planner can use them. The seed and the
-- Appendix B5 import both store formatted numbers, so the normalised form
-- is the only one worth indexing.
create index if not exists staff_email_normalised_idx on staff (lower(btrim(email)));
create index if not exists staff_msisdn_idx on staff (normalise_msisdn(phone));

-- ---------------------------------------------------------------------
-- submit_application, with the lock and the indexed predicate.
--
-- Everything else is unchanged from 20260921150000: the same validation,
-- the same three outcomes of the age gate, the same void return so the
-- endpoint cannot be used to test whether an address is known (§2.12).
-- ---------------------------------------------------------------------
create or replace function public.submit_application(
  p_first_name text,
  p_last_name  text,
  p_email      text,
  p_phone      text,
  p_age_band   text,
  p_consent    boolean
) returns void
language plpgsql security definer set search_path = public as
$$
declare
  v_first   text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last    text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_email   text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  -- '+' is what an empty number normalises to, and is not a number.
  v_phone   text := nullif(normalise_msisdn(coalesce(p_phone, '')), '+');
  v_match   uuid;
  v_outcome application_outcome;
  v_staff   uuid;
begin
  if v_first is null or v_last is null then
    raise exception 'Enter your first name and surname.' using errcode = '22023';
  end if;
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'Enter a valid mobile number, including the country code.' using errcode = '22023';
  end if;
  if p_consent is not true then
    raise exception 'Tick the consent box to continue.' using errcode = '22023';
  end if;
  if p_age_band is null or p_age_band not in
     ('18','19','20','21','22','23','24','25','26','27','28','29','30','31_40','41_50','51_60','60_plus') then
    raise exception 'You must be 18 or over to apply.' using errcode = '22023';
  end if;

  -- Held to the end of this transaction, keyed on the two things the match
  -- below looks at. Taken after validation so a malformed submission
  -- cannot be used to hold a lock somebody else needs.
  perform pg_advisory_xact_lock(hashtext(v_email), hashtext(v_phone));

  -- §2.12, now against the two indexed expressions. A removed worker
  -- (§1.7) stays unmatchable.
  select s.id into v_match
    from staff s
   where s.removed_at is null
     and (lower(btrim(s.email)) = v_email
          or normalise_msisdn(s.phone) = v_phone)
   order by s.created_at
   limit 1;

  if v_match is not null then
    v_staff   := v_match;
    v_outcome := 'returning_applicant';
  else
    insert into staff (first_name, last_name, email, phone, applied_age_band, status, gdpr_consent_at)
    values (v_first, v_last, v_email, v_phone, p_age_band, 'interview_requested', now())
    returning id into v_staff;
    v_outcome := 'candidate_created';
  end if;

  insert into applications (first_name, last_name, email, phone, age_band, outcome, staff_id, consented_at)
  values (v_first, v_last, v_email, v_phone, p_age_band, v_outcome, v_staff, now());

  insert into audit_log (actor, action, entity, entity_id, data)
  values (null, 'application_submitted', 'staff', v_staff,
          jsonb_build_object('outcome', v_outcome, 'age_band', p_age_band));
end
$$;
