-- =====================================================================
-- Migration 0010 · the public application form (§2.1, §2.12, §1.7)
--
-- What this adds
-- --------------
-- 1. `applications`  — every submission of the public form, and the
--    "returning applicant" entry §2.12 requires.
-- 2. `submit_application()` — the only way in. `anon` holds no insert policy
--    on `staff` (040_rls_anon asserts exactly that, with a comment saying the
--    public flow is owed an RPC), because the duplicate check and the age
--    gate have to run server-side where a tampered form cannot skip them.
-- 3. `staff.dob` becomes nullable and `staff.applied_age_band` arrives, for
--    the reason below.
--
-- The age / date-of-birth mismatch
-- --------------------------------
-- §2.1 collects "Age (select from 18)". §2.12 matches duplicates on "email,
-- and mobile number plus date of birth". The form has no date-of-birth field,
-- and `wireframes/public/apply.html` already flags the contradiction as an
-- open point for THC. Two consequences, both deliberate:
--
--   * `staff.dob` was `not null`, so a candidate created from the form could
--     not be stored at all. It is now nullable: a date of birth arrives with
--     Right to Work (§2.5), not from the public form. The `age_18` check
--     constraint is untouched and still rejects an under-18 date the moment
--     one is supplied — a null dob simply has nothing to check yet.
--   * The duplicate check here matches on email and on mobile. The
--     "mobile + date of birth" half of §2.12 cannot be evaluated until THC
--     resolves the open point; matching on mobile alone is the wider net of
--     the two, so it never lets a second record through where the scope
--     wanted one record.
--
-- What the applicant is allowed to learn
-- --------------------------------------
-- Nothing about an existing record. §2.12 and the wireframe are explicit:
-- "the applicant sees the ordinary Check your inbox screen either way and is
-- never told why a previous record was blocked". So the RPC returns void.
-- An outcome in the return value would turn this public endpoint into an
-- account-existence oracle for any email address anyone cares to try.
--
-- A GDPR-removed worker (§1.7) is never matched, so a person who was removed
-- applies as a genuinely new candidate rather than being silently routed to
-- a record that no longer describes them.
--
-- Not solved here: abuse. This is a public write endpoint with no rate limit
-- and no challenge, so anyone can create candidate rows in a loop. The scope
-- does not specify a captcha and inventing one here would be a product
-- decision taken in a migration; the shape of the fix (a challenge on the
-- form, or a per-IP limit at the edge) belongs with the Willo work, which is
-- where a junk candidate starts costing money. Flagged rather than skipped.
--
-- No notification is enqueued. §2.1: submitting sends the Willo interview,
-- and E1 is the one email this system must never send itself — Willo sends
-- it. Creating the candidate in Willo is a separate piece of work and needs
-- THC's keys (Appendix B1).
--
-- Forward-only: every migration before this one is left untouched.
-- =====================================================================

-- ---------------------------------------------------------------------
-- staff: a candidate exists before their date of birth does
-- ---------------------------------------------------------------------
alter table staff alter column dob drop not null;

comment on column staff.dob is
  'Null until Right to Work is supplied (§2.5). The public form (§2.1) collects an age band, not a date of birth; the age_18 check constraint still rejects an under-18 date whenever one is set.';

alter table staff add column applied_age_band text
  check (applied_age_band in ('18','19','20','21','22','23','24','25','26','27','28','29','30',
                              '31_40','41_50','51_60','60_plus'));

comment on column staff.applied_age_band is
  'The age the person selected on /apply (§2.1). Evidence of the server-side 18+ gate for the period before a date of birth exists. "under_18" is not a legal value here: those applications are rejected and no record is created.';

-- ---------------------------------------------------------------------
-- applications — the submission log and the returning-applicant queue
-- ---------------------------------------------------------------------
create type application_outcome as enum ('candidate_created', 'returning_applicant');

create table applications (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text not null,                    -- normalised: trimmed, lower-cased
  phone text not null,                    -- normalised: E.164
  age_band text not null,
  outcome application_outcome not null,
  staff_id uuid not null references staff(id),   -- created candidate, or the record matched
  consented_at timestamptz not null,      -- §1.7: the consent tick is stored with its timestamp
  created_at timestamptz not null default now()
);
create index on applications (outcome, created_at desc);
create index on applications (staff_id);

comment on table applications is
  'Every submission of the public form (§2.1). outcome = returning_applicant is the §2.12 entry the office acts on: staff_id names the existing record, and the manager presses Reset to candidate on it or rejects the application (§9.6). Written only by submit_application().';

alter table applications enable row level security;

-- Admin reads it (the Onboarding screen shows the returning-applicant
-- entries). No insert/update/delete policy for anybody: the row is written by
-- a security definer RPC, exactly as 0004 does for the other derived writes.
-- The client and the worker get nothing — an application names a person who
-- is not yet staff, and §11.1 keeps worker personal data away from clients.
create policy admin_read on applications for select using (current_app_role() = 'admin');

-- ---------------------------------------------------------------------
-- submit_application — the public endpoint (§2.1, §2.12)
--
-- security definer because `anon` must reach `staff` to run the duplicate
-- check and create the candidate, and giving anon a policy on `staff` would
-- expose every worker's personal data to the internet. The whole of the
-- decision lives in this function, which is the only thing anon may call.
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
  v_phone   text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s\-()]', '', 'g'), '');
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
  -- §2.1: under 18 is rejected on the form AND on the server, so a tampered
  -- form still fails. Anything that is not a listed 18+ band is refused
  -- rather than guessed at.
  if p_age_band is null or p_age_band not in
     ('18','19','20','21','22','23','24','25','26','27','28','29','30','31_40','41_50','51_60','60_plus') then
    raise exception 'You must be 18 or over to apply.' using errcode = '22023';
  end if;

  -- ---- duplicate check (§2.12) ------------------------------------------
  -- Email, or mobile. See the header for the date-of-birth half. A removed
  -- worker (§1.7) is deliberately unmatchable.
  select s.id into v_match
    from staff s
   where s.removed_at is null
     and (lower(s.email) = v_email or s.phone = v_phone)
   order by s.created_at
   limit 1;

  if v_match is not null then
    -- No second candidate. The office decides on the existing record.
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

  -- Returns void on purpose: see the header. The caller cannot tell a new
  -- candidate from a returning one, which is what §2.12 requires.
end
$$;

comment on function public.submit_application(text, text, text, text, text, boolean) is
  'The public application form (§2.1). Validates, runs the §2.12 duplicate check and either creates a candidate in interview_requested or files a returning-applicant entry. Returns void so the endpoint cannot be used to test whether an email or mobile is already known.';

revoke all on function public.submit_application(text, text, text, text, text, boolean) from public;
grant execute on function public.submit_application(text, text, text, text, text, boolean) to anon, authenticated;
