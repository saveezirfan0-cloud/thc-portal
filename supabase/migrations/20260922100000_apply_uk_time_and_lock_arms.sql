-- =====================================================================
-- Migration 20260922100000 · two defects in submit_application (§1.8, §2.12)
--
-- Both were found by qa-reviewer against the merged /apply feature, and
-- both are in 20260921170000_apply_date_of_birth.sql, whose comments
-- assert the opposite of what its code does. That is the part worth
-- fixing loudly: a wrong comment on a rule about who it is legal to
-- employ is worse than no comment, because it stops the next person
-- looking.
--
-- 1 · The age gate ran in UTC, not Europe/London
-- ----------------------------------------------
-- `current_date` resolves against the session TimeZone, which is UTC on
-- Supabase. §1.8 and CLAUDE.md both say every rule is evaluated in
-- Europe/London, and every other migration in this repo already uses the
-- house expression — 0008_weekly_cap.sql:195 and
-- 20260921141500_auto_assign.sql:409 among them. 20260921170000 did not,
-- while its own comment claimed it did.
--
-- It failed closed, not open: no under-18 got through. What it did was
-- refuse an applicant ON their eighteenth birthday, for the hour between
-- 00:00 and 01:00 UK time during BST, when the UTC date is still
-- yesterday — after the form, which reads the browser's clock, had
-- already enabled the button for them. The same mismatch hits anyone
-- applying from a zone ahead of UTC.
--
-- 2 · The advisory lock covered one arm of a two-arm match
-- --------------------------------------------------------
-- 20260921160000 added `pg_advisory_xact_lock(hashtext(v_email),
-- hashtext(v_phone))`. That is ONE key built from BOTH values, while the
-- §2.12 predicate is a disjunction: email, OR mobile + date of birth. Two
-- submissions that agree on only one arm hash to different keys, so they
-- never queue behind each other:
--
--   same email, different mobile   → both find no match, both insert
--   same mobile + dob, other email → both insert
--
-- Either outcome is the second record §2.12 exists to prevent. The lock
-- closed only the case where both values match — an identical
-- resubmission, the double-tap — which is the one the original comment
-- describes, so the gap was invisible from the comment alone.
--
-- One lock per arm now, always taken in the same order (email, then
-- mobile) so two sessions can never hold one another's second lock.
-- Namespaced on the first key so the email space and the mobile space
-- cannot collide with each other, or with any other advisory lock in the
-- system.
--
-- Forward-only: 20260921170000 is left exactly as it was applied.
-- =====================================================================

create or replace function public.submit_application(
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
  -- '+' is what an empty number normalises to, and is not a number.
  v_phone   text := nullif(normalise_msisdn(coalesce(p_phone, '')), '+');
  -- §1.8: today in Europe/London, not in whatever zone the session
  -- happens to carry. Read once so a submission landing across midnight
  -- cannot be judged against two different days.
  v_today   date := (now() at time zone 'Europe/London')::date;
  v_age     int;
  v_band    text;
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

  -- A missing date and a date that cannot belong to an applicant are two
  -- different mistakes, and neither of them is "under 18".
  if p_dob is null then
    raise exception 'Enter your date of birth.' using errcode = '22023';
  end if;
  if p_dob > v_today then
    raise exception 'Enter a real date of birth.' using errcode = '22023';
  end if;

  -- Completed years, in UK time (§1.8).
  v_age := extract(year from age(v_today, p_dob))::int;

  -- Older than this is a typo, not an applicant. Stated as completed
  -- years so it matches `MAX_AGE` in apps/staff/app/apply/form.ts exactly.
  -- The previous test compared the date against a hundred years before
  -- today, which is a day earlier than a hundred completed years, so dates
  -- in that gap passed the form and came back as a server banner on a
  -- field the form had called fine.
  --
  -- Note for the next editor: 120_apply asserts this body contains no
  -- reference to the session-local date function (§1.8), so do not name it
  -- here even to describe what it replaced.
  if v_age > 100 then
    raise exception 'Enter a real date of birth.' using errcode = '22023';
  end if;

  -- §2.1 / §1.7: under 18 is rejected on the form AND here, so a tampered
  -- form still fails.
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

  -- One lock per arm of the match below, in this order in every call.
  -- Held to the end of the transaction. Taken after validation so a
  -- malformed submission cannot be used to hold a lock somebody needs.
  perform pg_advisory_xact_lock(hashtext('apply:email'), hashtext(v_email));
  perform pg_advisory_xact_lock(hashtext('apply:msisdn'), hashtext(v_phone));

  -- §2.12 against the two indexed expressions. A removed worker (§1.7)
  -- stays unmatchable. `order by created_at` picks the oldest record when
  -- the two arms match different people — the one that has been theirs
  -- longest — rather than leaving it to the planner.
  select s.id into v_match
    from staff s
   where s.removed_at is null
     and (lower(btrim(s.email)) = v_email
          or (normalise_msisdn(s.phone) = v_phone and s.dob = p_dob))
   order by s.created_at
   limit 1;

  if v_match is not null then
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
end
$$;

comment on function public.submit_application(text, text, text, text, date, boolean) is
  'The public application form (§2.1, ADR-0008). Validates in Europe/London (§1.8), derives the age band from the date of birth, takes one advisory lock per arm of the §2.12 match, runs that check on email or mobile + date of birth, and either creates a candidate in interview_requested or files a returning-applicant entry. Returns void so the endpoint cannot be used to test whether an email or mobile is already known.';
