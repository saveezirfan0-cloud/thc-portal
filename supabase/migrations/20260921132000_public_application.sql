-- =====================================================================
-- Migration 0005 · the public application form (§2.1) and the duplicate
--                   check that routes a returning applicant (§2.12)
--
-- What /apply has to do
-- ---------------------
-- §2.1  Public URL, no registration. First name · Surname · Email ·
--       Mobile (international picker) · Age (select from 18) + GDPR
--       consent. Under 18 is rejected on the form AND on the server
--       (§1.7). There is no "Applied" stage: a valid submission creates
--       the candidate directly in `interview_requested`.
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
-- staff.dob becomes nullable — see docs/adr/0006
--
-- §2.1 collects Age, not date of birth; the DOB is asked for in the Staff
-- App wizard (§2.5), which the candidate works through during the
-- `documents` stage. 0001_init.sql made `dob` NOT NULL, which makes the
-- candidate row §2.1 requires ("lands straight in Interview requested")
-- impossible to write. Rather than invent a date, the column is nullable
-- for the three pipeline stages that genuinely do not have one yet, and
-- the constraint below makes it impossible to get any further without it:
-- the quiz only unlocks once every document is verified (§2.3), and the
-- gov.uk share-code check (§2.6) needs the DOB before that.
-- `removed` is allowed because a GDPR removal wipes personal data (§1.7),
-- and `rejected` because a candidate can be rejected out of any stage.
-- The existing age_18 check is unaffected: a NULL dob makes it unknown,
-- which passes, and it is submit_application's age band — plus this
-- constraint — that covers the gap until a real date arrives.
-- ---------------------------------------------------------------------
alter table staff alter column dob drop not null;

alter table staff add constraint dob_required_from_quiz check (
  dob is not null
  or status in ('interview_requested', 'interview_completed', 'documents', 'rejected', 'removed')
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
  age_band   text not null,                      -- the §2.1 select's value, e.g. '18', '31_40'
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
  p_age_band   text,
  p_consent    boolean,
  -- §2.12 matches mobile + DOB, but §2.1's form has no DOB field (the open
  -- point recorded in docs/adr/0006). The parameter exists so that the day
  -- the form collects one, the mobile arm of the match tightens without a
  -- signature change. Left null, the mobile arm matches on mobile alone,
  -- which errs towards routing to the office rather than towards a second
  -- record — the outcome §2.12 is trying to prevent.
  p_dob        date default null
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
  v_band    text := btrim(coalesce(p_age_band, ''));
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

  if v_band = '' then
    raise exception 'apply_age_required' using errcode = 'check_violation';
  end if;

  -- §2.1 / §1.7: age >= 18, checked again here so a tampered form still
  -- fails. 'under_18' is the only band the select offers below 18; any
  -- band the server does not recognise is refused for the same reason.
  if v_band = 'under_18' then
    raise exception 'apply_under_18' using errcode = 'check_violation';
  end if;
  if v_band not in ('18','19','20','21','22','23','24','25','26','27','28','29','30',
                    '31_40','41_50','51_60','60_plus') then
    raise exception 'apply_age_required' using errcode = 'check_violation';
  end if;

  if p_dob is not null and p_dob > (current_date - interval '18 years') then
    raise exception 'apply_under_18' using errcode = 'check_violation';
  end if;

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
       or (
         normalise_msisdn(s.phone) = v_phone
         and (p_dob is null or s.dob is null or s.dob = p_dob)
       )
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
    insert into staff (first_name, last_name, email, phone, status, gdpr_consent_at)
    values (v_first, v_last, btrim(p_email), v_phone, 'interview_requested', now())
    returning id into v_staff;

    v_outcome := 'candidate_created';
  end if;

  insert into applications (first_name, last_name, email, phone, age_band, outcome, staff_id)
  values (v_first, v_last, btrim(p_email), v_phone, v_band, v_outcome, v_staff)
  returning id into v_app;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (null, 'application_submitted', 'applications', v_app,
          jsonb_build_object('outcome', v_outcome, 'staff_id', v_staff));
end $$;

comment on function public.submit_application(text, text, text, text, text, boolean, date) is
  'Public /apply submission (§2.1). Enforces age >= 18 and GDPR consent, runs the §2.12 duplicate check, and returns void so the applicant cannot tell a new candidate from a returning one.';

-- anon is the point: /apply is a public URL with no registration (§2.1).
revoke all on function public.submit_application(text, text, text, text, text, boolean, date) from public;
grant execute on function public.submit_application(text, text, text, text, text, boolean, date)
  to anon, authenticated, service_role;
