-- =====================================================================
-- The public application form (§2.1) and the duplicate
--                   check that routes a returning applicant (§2.12)
--
-- What /apply has to do
-- ---------------------
-- §2.1  Public URL, no registration. First name · Surname · Email ·
--       Mobile (international picker) · Date of birth + GDPR consent.
--       §2.1 asks for an age band; THC confirmed the form collects a date
--       of birth instead, because §2.12 needs one (docs/adr/0006). The
--       band is derived from the date and still recorded. Under 18 is
--       rejected on the form AND on the server (§1.7). There is no
--       "Applied" stage: a valid submission creates the candidate
--       directly in `interview_requested`.
-- §2.12 On submission the system matches email, and mobile + date of
--       birth, against existing records. A match does NOT create a second
--       candidate — the application is routed to the office as a
--       "returning applicant" entry naming the existing record, and the
--       manager presses Reset to candidate or rejects. The applicant sees
--       the ordinary "check your inbox" screen either way and is never
--       told why. A GDPR-removed worker cannot be matched and applies as
--       a genuinely new candidate.
--
-- Why an RPC rather than a table grant
-- ------------------------------------
-- 040_rls_anon.sql already asserts that `anon` cannot insert into `staff`
-- ("the public /apply flow must go through an RPC or Edge Function").
-- `submit_application` below is that RPC: `security definer`, so it is the
-- only thing a logged-out caller can reach, and it owns every rule the
-- form claims to enforce. `applications` keeps RLS on with an admin-only
-- policy, so nothing here is readable by the public either.
--
-- It returns `void` on purpose. The applicant must not be able to tell a
-- new candidate from a duplicate (§2.12), and the surest way to guarantee
-- that is for the successful path to carry no payload at all.
--
-- Rate limiting is deliberately NOT done here. This endpoint is anonymous
-- and world-reachable, so abuse protection belongs at the edge (Vercel /
-- Supabase), not in a plpgsql function; a second submission of the same
-- email or mobile already self-limits into the returning-applicant path.
--
-- Forward-only: 0001, 0002 and 0004 are left untouched.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Phone normalisation
--
-- Numbers arrive from the form in E.164 ("+447700900123"), but the Phase 0
-- seed stores them formatted ("+44 7700 900101") and imported records
-- (Appendix B5) will be worse. Matching has to ignore that, so both sides
-- of the comparison go through this. It is IMMUTABLE so the index below
-- can use it.
-- ---------------------------------------------------------------------
create or replace function public.normalise_msisdn(p text) returns text
language sql immutable strict as
$$ select '+' || regexp_replace(p, '[^0-9]', '', 'g') $$;

comment on function public.normalise_msisdn(text) is
  'Digits only, re-prefixed with +. Used by the /apply duplicate check (§2.12).';

create index staff_email_normalised_idx on staff (lower(btrim(email)));
create index staff_msisdn_idx           on staff (normalise_msisdn(phone));

-- ---------------------------------------------------------------------
-- staff.dob stays NOT NULL in spirit — see docs/adr/0006
--
-- 0001_init.sql declared `dob` NOT NULL. The form now collects a date of
-- birth, so every candidate this migration creates has one from the
-- moment the row exists and the column could simply stay as it was.
-- It is relaxed for exactly one case: a GDPR removal (§1.7) wipes
-- personal data, and a date of birth is personal data, so `removed` has
-- to be able to hold NULL. The constraint below allows that and nothing
-- else, which is a stronger guarantee than the NOT NULL it replaces —
-- NOT NULL could not have expressed "except once anonymised".
-- ---------------------------------------------------------------------
alter table staff alter column dob drop not null;

alter table staff add constraint dob_present_unless_removed check (
  dob is not null or status = 'removed'
);

-- The Willo integration (Phase 1, later session) sends the interview
-- invitation (E1) itself. Its queue is exactly this: candidates the form
-- created that Willo has never heard of.
create index staff_awaiting_willo_idx on staff (created_at)
  where status = 'interview_requested' and willo_candidate_id is null;

-- ---------------------------------------------------------------------
-- applications — every submission, including the ones that create nothing
--
-- The row is the office's record of the submission and the queue behind
-- the "returning applicant" entry on the Onboarding screen (§2.12). It is
-- kept for both outcomes so a manager can see what a candidate actually
-- typed, and so a rejected duplicate leaves a trail.
-- ---------------------------------------------------------------------
-- Three outcomes, because a match is not always a returning applicant.
--   candidate_created   — nothing matched; a new candidate exists.
--   returning_applicant — matched a record that has LEFT the pipeline
--                         (compliant, blocked, inactive, rejected). This
--                         is §2.12's case: the office presses Reset to
--                         candidate or rejects.
--   duplicate_submission— matched a record still IN the pipeline
--                         (interview_requested … contract). Somebody
--                         applied twice, or applied again while their
--                         first application is still running. §2.12's
--                         Reset to candidate is "available on a blocked
--                         or rejected profile", so there is nothing for
--                         the office to decide here; filing these as
--                         returning applicants would bury the real ones.
--                         The applicant sees the same screen regardless.
create type application_outcome as enum (
  'candidate_created', 'returning_applicant', 'duplicate_submission'
);

create table applications (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name  text not null,
  email      text not null,
  phone      text not null,                      -- E.164, as typed into the form
  dob        date not null,                      -- §2.12 matches mobile + DOB (docs/adr/0006)
  -- Derived from dob, never asked: §2.1 wanted an age band, and a band the
  -- applicant picks separately can contradict the date they typed.
  age_band   text not null,
  gdpr_consent_at timestamptz not null default now(),   -- §1.7: the tick's timestamp is stored
  outcome    application_outcome not null,
  -- the candidate this created, or the existing record it matched (§2.12)
  staff_id   uuid references staff(id) on delete set null,
  reviewed_at timestamptz,                       -- office cleared the returning-applicant entry
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint match_names_a_record
    check (outcome = 'candidate_created' or staff_id is not null)
);

create index applications_staff_idx on applications (staff_id);
-- Both foreign keys carry a covering index. Postgres indexes the
-- referenced side automatically and the referencing side never, so
-- without these a delete on staff or auth.users sequentially scans this
-- table to prove the constraint. 002_schema_hardening asserts it.
create index applications_reviewed_by_idx on applications (reviewed_by);
create index applications_open_returning_idx on applications (created_at)
  where outcome = 'returning_applicant' and reviewed_at is null;

alter table applications enable row level security;

-- Admin only. The applicant is anonymous and never reads this back; a
-- worker and a client have no business in it at all (§1.4, §11.1).
-- Inserts come from submit_application, which is `security definer` and
-- therefore bypasses RLS.
create policy admin_all on applications for all using (current_app_role() = 'admin');

-- ---------------------------------------------------------------------
-- submit_application — the whole of /apply's server side
--
-- Every failure raises; the caller maps the message to a field error. The
-- codes are stable strings rather than prose so the app owns the copy.
-- ---------------------------------------------------------------------
create or replace function public.submit_application(
  p_first_name text,
  p_last_name  text,
  p_email      text,
  p_phone      text,
  -- §2.12 matches mobile + DOB. THC confirmed the form collects the date
  -- (docs/adr/0006), so this is required and the match is exact — there is
  -- no mobile-only fallback any more.
  p_dob        date,
  p_consent    boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_phone   text := normalise_msisdn(coalesce(p_phone, ''));
  v_first   text := btrim(coalesce(p_first_name, ''));
  v_last    text := btrim(coalesce(p_last_name, ''));
  v_band    text;
  v_age     int;
  v_match   uuid;
  v_match_status staff_status;
  v_staff   uuid;
  v_outcome application_outcome;
  v_app     uuid;
begin
  -- ---- validation (the server half of every check the form makes) ----
  if v_first = '' or v_last = '' then
    raise exception 'apply_name_required' using errcode = 'check_violation';
  end if;

  -- Deliberately loose: a stricter pattern rejects valid addresses, and
  -- the address is proved by the interview email landing, not by a regex.
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'apply_email_invalid' using errcode = 'check_violation';
  end if;

  if v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'apply_phone_invalid' using errcode = 'check_violation';
  end if;

  if p_dob is null then
    raise exception 'apply_dob_required' using errcode = 'check_violation';
  end if;

  -- A date in the future, or one implying an improbable age, is a typo or
  -- a tampered field rather than an applicant.
  if p_dob > current_date or p_dob < (current_date - interval '100 years') then
    raise exception 'apply_dob_invalid' using errcode = 'check_violation';
  end if;

  -- §2.1 / §1.7: age >= 18, checked again here so a tampered form still
  -- fails. Completed years in UK time, which is where every rule in this
  -- system is evaluated (§1.8).
  v_age := extract(year from age(current_date, p_dob))::int;
  if v_age < 18 then
    raise exception 'apply_under_18' using errcode = 'check_violation';
  end if;

  -- The §2.1 band, derived rather than asked, so it can never disagree
  -- with the date the applicant actually gave.
  v_band := case
    when v_age <= 30 then v_age::text
    when v_age <= 40 then '31_40'
    when v_age <= 50 then '41_50'
    when v_age <= 60 then '51_60'
    else '60_plus'
  end;

  -- §1.7: the GDPR tick is mandatory; nothing is created without it.
  if p_consent is not true then
    raise exception 'apply_consent_required' using errcode = 'check_violation';
  end if;

  -- Two browser tabs, or a double tap on a slow phone, would otherwise
  -- both find no match and both insert a candidate. The lock is held to
  -- the end of this transaction and is keyed on the two things the match
  -- below looks at, so honest concurrent submissions queue instead of
  -- racing. It costs nothing in the normal case.
  perform pg_advisory_xact_lock(hashtext(v_email), hashtext(v_phone));

  -- ---- duplicate check (§2.12) ----
  -- A GDPR-removed worker is excluded: their personal data is gone, so
  -- there is nothing to match and they apply as a new candidate (§1.7).
  select s.id, s.status into v_match, v_match_status
    from staff s
   where s.removed_at is null
     and s.status <> 'removed'
     and (
       lower(btrim(s.email)) = v_email
       or (normalise_msisdn(s.phone) = v_phone and s.dob = p_dob)
     )
   order by s.created_at
   limit 1;

  if v_match is not null then
    -- No second candidate either way. What differs is whether the office
    -- is asked to decide anything: only a record that has left the
    -- pipeline is §2.12's returning applicant (Reset to candidate is
    -- offered "on a blocked or rejected profile"). Somebody who is still
    -- mid-onboarding and submits the form again has not come back from
    -- anywhere, and must not land in the same queue.
    v_staff   := v_match;
    v_outcome := case
      when v_match_status in ('interview_requested', 'interview_completed', 'documents',
                              'quiz', 'additional_info', 'contract')
        then 'duplicate_submission'
      else 'returning_applicant'
    end;
  else
    insert into staff (first_name, last_name, email, phone, dob, status, gdpr_consent_at)
    values (v_first, v_last, btrim(p_email), v_phone, p_dob, 'interview_requested', now())
    returning id into v_staff;

    v_outcome := 'candidate_created';
  end if;

  insert into applications (first_name, last_name, email, phone, dob, age_band, outcome, staff_id)
  values (v_first, v_last, btrim(p_email), v_phone, p_dob, v_band, v_outcome, v_staff)
  returning id into v_app;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (null, 'application_submitted', 'applications', v_app,
          jsonb_build_object('outcome', v_outcome, 'staff_id', v_staff));
end $$;

comment on function public.submit_application(text, text, text, text, date, boolean) is
  'Public /apply submission (§2.1). Enforces age >= 18 from the date of birth, and GDPR consent, runs the §2.12 duplicate check, and returns void so the applicant cannot tell a new candidate from a returning one.';

-- anon is the point: /apply is a public URL with no registration (§2.1).
revoke all on function public.submit_application(text, text, text, text, date, boolean) from public;
grant execute on function public.submit_application(text, text, text, text, date, boolean)
  to anon, authenticated, service_role;
