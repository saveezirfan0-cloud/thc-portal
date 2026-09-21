-- =====================================================================
-- Migration 20260921170000 · /apply collects a date of birth (§2.1, §2.12)
--
-- THC answered the open point that 20260921150000_public_application.sql
-- and ADR-0008 both flag. The form collects a date of birth.
--
-- What that settles
-- -----------------
-- §2.1 asks for "Age (select from 18)"; §2.12 matches returning applicants
-- on "email, and mobile number plus date of birth". A form with only an age
-- band cannot do the second, so 20260921150000 matched on mobile alone and
-- said so: "the wider net of the two, so it never lets a second record
-- through where the scope wanted one". Wider also means wrong in the other
-- direction — two people sharing a phone, or a recycled number, matched
-- each other. With a date of birth the mobile arm becomes exactly what
-- §2.12 specifies.
--
-- The age band is derived here, not asked
-- ---------------------------------------
-- `applications.age_band` and `staff.applied_age_band` both stay: the
-- office still gets the §2.1 datum. They are computed from the date
-- instead of being a second question. Asking for both allows a submission
-- where the band says 25 and the date says 17, and then something has to
-- decide which one is true — on the field that decides whether it is legal
-- to employ this person at all.
--
-- staff.dob
-- ---------
-- 20260921150000 made it nullable because the form had no date to put in
-- it. Every candidate created from here on has one at insert, so the
-- column is tightened to "present unless removed": a GDPR removal (§1.7)
-- wipes personal data, and a date of birth is personal data, so `removed`
-- must still be able to hold NULL. That is a stronger guarantee than the
-- original NOT NULL, which could not express the exception.
--
-- The tightening is conditional. Rows may already exist that were created
-- through the previous RPC with no date, and inventing one for them is
-- what ADR-0008 refuses to do. Where such a row exists the constraint is
-- skipped and the RPC still requires a date from every new submission, so
-- the invariant holds going forward either way.
--
-- Forward-only: every migration before this one is left untouched.
-- =====================================================================

-- ---------------------------------------------------------------------
-- applications.dob — what §2.12 actually matches on
-- ---------------------------------------------------------------------
alter table applications add column dob date;

comment on column applications.dob is
  'Date of birth as submitted (§2.1 as amended by ADR-0008). The §2.12 duplicate check matches mobile + this.';

comment on column applications.age_band is
  'The §2.1 band, derived from dob rather than asked, so the two cannot disagree.';

do $$
begin
  if not exists (select 1 from applications where dob is null) then
    alter table applications alter column dob set not null;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- staff.dob — present unless anonymised
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from staff where dob is null and status <> 'removed') then
    alter table staff add constraint dob_present_unless_removed
      check (dob is not null or status = 'removed');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- submit_application — same contract, date of birth in place of the band
--
-- Dropped rather than replaced: the parameter list changes, and
-- `create or replace` on a different signature leaves the old function
-- behind as an overload that `anon` can still call.
-- ---------------------------------------------------------------------
drop function if exists public.submit_application(text, text, text, text, text, boolean);

create function public.submit_application(
  p_first_name text,
  p_last_name  text,
  p_email      text,
  p_phone      text,
  p_dob        date,
  p_consent    boolean
) returns void
language plpgsql security definer set search_path = public as
$$
declare
  v_first   text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last    text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_email   text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone   text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_age     int;
  v_band    text;
  v_match   uuid;
  v_staff   uuid;
  v_outcome application_outcome;
begin
  -- ---- the form's own rules, repeated where they cannot be edited out ----
  if v_first is null or v_last is null then
    raise exception 'Enter your first name and surname.' using errcode = '22023';
  end if;
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'Enter a valid mobile number, including the country code.' using errcode = '22023';
  end if;
  -- §1.7: no consent, no processing. Checked here as well as on the form.
  if p_consent is not true then
    raise exception 'Tick the consent box to continue.' using errcode = '22023';
  end if;

  -- A missing date, a date in the future and a date implying an impossible
  -- age are three different mistakes and none of them is "under 18".
  if p_dob is null then
    raise exception 'Enter your date of birth.' using errcode = '22023';
  end if;
  if p_dob > current_date or p_dob < (current_date - interval '100 years') then
    raise exception 'Enter a real date of birth.' using errcode = '22023';
  end if;

  -- §2.1 / §1.7: under 18 is rejected on the form AND here, so a tampered
  -- form still fails. Completed years, evaluated in UK time like every
  -- other rule in this system (§1.8).
  v_age := extract(year from age(current_date, p_dob))::int;
  if v_age < 18 then
    raise exception 'You must be 18 or over to apply.' using errcode = '22023';
  end if;

  v_band := case
    when v_age <= 30 then v_age::text
    when v_age <= 40 then '31_40'
    when v_age <= 50 then '41_50'
    when v_age <= 60 then '51_60'
    else '60_plus'
  end;

  -- ---- duplicate check (§2.12) ------------------------------------------
  -- Email, or mobile AND date of birth — the match the scope specifies, now
  -- that there is a date to match on. A removed worker (§1.7) is
  -- deliberately unmatchable.
  --
  -- Both sides of the mobile comparison are normalised, not just the one
  -- coming in: `staff.phone` is free text and every worker in
  -- supabase/seed.sql holds a spaced number ("+44 7700 900108"), so
  -- comparing against the stored string directly would mean the mobile half
  -- of §2.12 silently never matched anybody.
  select s.id into v_match
    from staff s
   where s.removed_at is null
     and (lower(s.email) = v_email
          or (regexp_replace(s.phone, '[^0-9+]', '', 'g') = v_phone and s.dob = p_dob))
   order by s.created_at
   limit 1;

  if v_match is not null then
    -- No second candidate. The office decides on the existing record.
    v_staff   := v_match;
    v_outcome := 'returning_applicant';
  else
    insert into staff (first_name, last_name, email, phone, dob, applied_age_band, status, gdpr_consent_at)
    values (v_first, v_last, v_email, v_phone, p_dob, v_band, 'interview_requested', now())
    returning id into v_staff;
    v_outcome := 'candidate_created';
  end if;

  insert into applications (first_name, last_name, email, phone, dob, age_band, outcome, staff_id, consented_at)
  values (v_first, v_last, v_email, v_phone, p_dob, v_band, v_outcome, v_staff, now());

  insert into audit_log (actor, action, entity, entity_id, data)
  values (null, 'application_submitted', 'staff', v_staff,
          jsonb_build_object('outcome', v_outcome, 'age_band', v_band));

  -- Returns void on purpose: the caller cannot tell a new candidate from a
  -- returning one, which is what §2.12 requires.
end
$$;

comment on function public.submit_application(text, text, text, text, date, boolean) is
  'The public application form (§2.1, ADR-0008). Validates, derives the age band from the date of birth, runs the §2.12 duplicate check on email or mobile + date of birth, and either creates a candidate in interview_requested or files a returning-applicant entry. Returns void so the endpoint cannot be used to test whether an email or mobile is already known.';

revoke all on function public.submit_application(text, text, text, text, date, boolean) from public;
grant execute on function public.submit_application(text, text, text, text, date, boolean)
  to anon, authenticated, service_role;
