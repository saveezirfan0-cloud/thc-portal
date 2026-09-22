-- =====================================================================
-- Migration 20260922183012 · /apply is a public write, so treat it like one
--                            (§2.1, §2.12, §1.7, §9.6)
--
-- Two findings from the security review, both on `submit_application()`.
-- It is granted to `anon`, so PostgREST publishes it: the anon key plus
-- `POST /rest/v1/rpc/submit_application` is a complete client and the
-- form is not the only door. 20260921150000's own header flagged the
-- first of these and deferred it ("Not solved here: abuse"). It is now
-- solved here, because the second finding turns the abuse from a junk
-- problem into an attack on a compliant worker.
--
-- 1 · A returning-applicant match on email alone
-- ----------------------------------------------
-- The §2.12 predicate read:
--
--     lower(email) = :email
--     OR (msisdn = :phone AND dob = :dob)
--
-- The first arm needs nothing but an email address. Submit a known
-- worker's email and the match lands on THEIR staff row, and the
-- `applications` row filed against it carries outcome
-- 'returning_applicant' and their real staff_id. The office's action on
-- that queue entry (§9.6) is `reset_to_candidate()`, which supersedes
-- the worker's entire compliance evidence set and walks them back to
-- 'interview_requested'. That is an anonymous caller, holding only a
-- published anon key and a colleague's email address, reaching a
-- one-click destruction of somebody's verified right-to-work evidence.
--
-- The date of birth now gates BOTH arms. §2.12 is still a disjunction
-- of email and mobile — ADR-0008 settled that the form collects a date
-- of birth, and a matcher that has the datum and does not use it on the
-- cheaper-to-guess arm is choosing the wider net on the arm that needs
-- the narrower one.
--
-- What this gives up, deliberately: a staff row with a NULL dob (created
-- through the pre-ADR-0008 RPC, or anonymised by §1.7) can no longer be
-- matched at all, so a genuine returning worker in that state applies as
-- a new candidate. That is a duplicate row in an office queue. The thing
-- it replaces is an anonymous caller wiping a compliant worker's
-- evidence. The trade is not close.
--
-- What it does NOT give: a date of birth is weak evidence — a colleague
-- usually knows one. This raises the cost of the attack and records what
-- was matched on; it does not make the queue entry trustworthy. The
-- office screen that offers "Reset to candidate" on a
-- returning_applicant row should show `matched_on` and treat it as a
-- claim, not a fact. That is why the column below exists.
--
-- 2 · No throttle of any kind
-- ---------------------------
-- Every successful call wrote a `staff` row (name, email, phone, date of
-- birth), an `applications` row and an `audit_log` row, unbounded and
-- unauthenticated. A loop fills the onboarding pipeline with real-looking
-- candidates carrying personal data the office then has to hold (§1.7)
-- and, once Willo is wired, pay for.
--
-- The throttle is keyed on the same two normalised values the §2.12
-- match uses and is checked while the per-arm advisory locks are held,
-- so two concurrent submissions cannot both pass it. It counts rows in
-- `applications`, which is the write it is limiting: a submission that
-- raises rolls its own log row back, so what is capped is exactly the
-- number of records a caller can create.
--
-- The message names neither the email nor the mobile, and is the same
-- whichever arm tripped, so the endpoint does not become an
-- account-existence oracle — the thing §2.12 and 20260921150000's header
-- both insist on. errcode 22023 is used so
-- apps/staff/app/apply/actions.ts shows it to the applicant as copy;
-- every other code there is deliberately swallowed into a generic
-- banner.
--
-- Limits are `settings` (§9.12 / the Django-Admin replacement), not
-- constants, following `booked_elsewhere_gap_minutes()`: an office
-- running a recruitment day can raise them without a release.
--
-- What is still open, and is not closeable from a migration:
--   · Per-IP / per-session limiting. A distributed caller with a fresh
--     email and mobile each time is still only bounded by the edge. That
--     belongs in front of PostgREST (Vercel middleware or a captcha on
--     the form), which is apps/, not supabase/.
--   · `anon` keeps EXECUTE. apps/staff/app/apply/actions.ts calls this
--     through the anon-key SSR client in packages/db, so revoking it
--     breaks the form. Closing it for real means the server action
--     holding the service key, which is a change in apps/ + packages/db.
--     Recorded here so the next person in those files can finish it.
--
-- Forward-only: 20260922100000 is left exactly as it was applied.
-- =====================================================================

-- ---------------------------------------------------------------------
-- applications.matched_on — what the §2.12 match actually proved
--
-- A returning-applicant entry is a claim made by an anonymous caller.
-- Recording which arm matched lets the office see the strength of it
-- before pressing a button that supersedes a compliance file.
-- ---------------------------------------------------------------------
alter table applications add column if not exists matched_on text
  check (matched_on in ('email_dob', 'msisdn_dob'));

comment on column applications.matched_on is
  'Which arm of the §2.12 duplicate check matched, or NULL for a new candidate. Both arms require the date of birth. Shown to the office beside Reset to candidate (§9.6): the entry is a claim by an anonymous caller, not a verified identity.';

-- ---------------------------------------------------------------------
-- The throttle counts by email and by mobile over a window, so both
-- predicates need an index. `applications` grows by one row per
-- submission for ever and is the table an abuser is trying to inflate.
-- ---------------------------------------------------------------------
create index if not exists applications_email_recent_idx on applications (email, created_at desc);
create index if not exists applications_phone_recent_idx on applications (phone, created_at desc);

-- ---------------------------------------------------------------------
-- settings.apply_throttle (§9.12)
--
-- Three submissions per address and per mobile per rolling day. A real
-- applicant submits once; two more covers a mis-typed address and a
-- retry after a failure they did not understand. Deliberately generous:
-- the point is to bound the damage, not to fail honest people.
-- ---------------------------------------------------------------------
insert into settings (key, value) values
  ('apply_throttle', '{"window_hours": 24, "per_email": 3, "per_msisdn": 3}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- submit_application — same signature, same void return, same three
-- validation gates, same UK-time age rule (§1.8) and the same two
-- per-arm advisory locks 20260922100000 added. Only the throttle and the
-- date-of-birth gate on the email arm are new.
-- ---------------------------------------------------------------------
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
         case when lower(btrim(s.email)) = v_email then 'email_dob' else 'msisdn_dob' end
    into v_match, v_arm
    from staff s
   where s.removed_at is null
     and s.dob = p_dob
     and (lower(btrim(s.email)) = v_email
          or normalise_msisdn(s.phone) = v_phone)
   order by s.created_at
   limit 1;

  if v_match is not null then
    v_staff   := v_match;
    v_outcome := 'returning_applicant';
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
  'The public application form (§2.1, ADR-0008). Validates in Europe/London (§1.8), derives the age band from the date of birth, throttles per email and per mobile from settings.apply_throttle, takes one advisory lock per arm of the §2.12 match, and matches a returning applicant only when the date of birth agrees as well. Returns void so the endpoint cannot be used to test whether an email or mobile is already known.';
