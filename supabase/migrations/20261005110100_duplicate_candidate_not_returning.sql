-- =====================================================================
-- Migration 20261005110100 · a second /apply from a live candidate is a
--                            duplicate, not a "Returning applicant" (§2.12)
--
-- §2.12 routes a match to the office as a Returning applicant so the
-- manager can Reset to candidate on a blocked, rejected or inactive
-- record. submit_application() matched ANY non-removed staff row, so a
-- person who applied twice while still in the pipeline (Interview
-- requested … Contract) matched their own candidate row and got a card
-- whose only action was Reject — against the application they had just
-- made — while /staff, which lists workers only, showed nobody.
--
-- Now a match on a row in an onboarding status is filed as
-- 'duplicate_candidate' (20261005110000): still no second record, still
-- the ordinary confirmation for the applicant, still an `applications`
-- row for the throttle and the audit trail, but no board card and no
-- referral (record_application_referral only counts 'candidate_created').
-- A match on compliant, blocked, inactive or rejected stays
-- 'returning_applicant', exactly as before.
--
-- Signature, grants and the void return are unchanged; `create or
-- replace` keeps both. Cards already on the board for a live candidate
-- are re-filed below so they leave Interview requested.
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
  v_arm     text;
  v_status  staff_status;
  v_outcome application_outcome;
  v_staff   uuid;
  v_limits  jsonb;
  v_window  interval;
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

  -- ---- throttle (§1.7) -------------------------------------------------
  -- Inside the locks, so two submissions racing on the same address
  -- cannot both read a count below the limit. Counting `applications`
  -- counts creations: a submission that raises rolls its own row back.
  v_limits := coalesce((select value from settings where key = 'apply_throttle'), '{}'::jsonb);
  v_window := make_interval(hours => coalesce((v_limits ->> 'window_hours')::int, 24));

  if (select count(*) from applications
       where email = v_email and created_at > now() - v_window)
     >= coalesce((v_limits ->> 'per_email')::int, 3)
  or (select count(*) from applications
       where phone = v_phone and created_at > now() - v_window)
     >= coalesce((v_limits ->> 'per_msisdn')::int, 3)
  then
    -- Names neither value, and is identical whichever arm tripped: this
    -- endpoint must not tell a caller whether an address is known
    -- (§2.12).
    raise exception 'Too many applications from these details. Please try again later.'
      using errcode = '22023';
  end if;

  -- ---- §2.12, with the date of birth on BOTH arms ----------------------
  -- A removed worker (§1.7) stays unmatchable, and so now does a record
  -- with no date of birth: an unverifiable match on a compliance file is
  -- worse than a duplicate candidate. `order by created_at` picks the
  -- oldest record when the two arms match different people.
  select s.id,
         case when lower(btrim(s.email)) = v_email then 'email_dob' else 'msisdn_dob' end,
         s.status
    into v_match, v_arm, v_status
    from staff s
   where s.removed_at is null
     and s.dob = p_dob
     and (lower(btrim(s.email)) = v_email
          or normalise_msisdn(s.phone) = v_phone)
   order by s.created_at
   limit 1;

  if v_match is not null then
    v_staff   := v_match;
    -- A match on somebody still in the onboarding pipeline is the same
    -- person applying twice, not a returning worker: there is nothing to
    -- reset, so it must not put a card in front of the office.
    v_outcome := case
      when v_status in ('interview_requested', 'interview_completed', 'documents',
                        'quiz', 'additional_info', 'contract')
        then 'duplicate_candidate'::application_outcome
      else 'returning_applicant'::application_outcome
    end;
  else
    v_arm := null;
    insert into staff (first_name, last_name, email, phone, dob, applied_age_band, status, gdpr_consent_at)
    values (v_first, v_last, v_email, v_phone, p_dob, v_band, 'interview_requested', now())
    returning id into v_staff;
    v_outcome := 'candidate_created';
  end if;

  insert into applications (first_name, last_name, email, phone, dob, age_band, outcome, matched_on, staff_id, consented_at)
  values (v_first, v_last, v_email, v_phone, p_dob, v_band, v_outcome, v_arm, v_staff, now());

  insert into audit_log (actor, action, entity, entity_id, data)
  values (null, 'application_submitted', 'staff', v_staff,
          jsonb_build_object('outcome', v_outcome, 'age_band', v_band, 'matchedOn', v_arm));
end
$$;

comment on function public.submit_application(text, text, text, text, date, boolean) is
  '§2.1 /apply: validation, the 18+ gate, the §2.12 duplicate check and the write. Service role only since 20260930120200 (ADR-0024). A match on a record still in the onboarding pipeline is filed as duplicate_candidate (no board card); a match on any other record is a returning_applicant.';

update applications a
   set outcome = 'duplicate_candidate'
  from staff s
 where s.id = a.staff_id
   and a.outcome = 'returning_applicant'
   and a.resolved_at is null
   and s.removed_at is null
   and s.status in ('interview_requested', 'interview_completed', 'documents',
                    'quiz', 'additional_info', 'contract');
