-- =====================================================================
-- Migration 20261007130000 · SpudBros Express staff: onboarding only
--                            (ADR-0103; owner request, 07.10.2026)
--
-- SpudBros Express staff do their Right to Work check and onboarding with
-- THC and nothing else: their shifts, rota and messages stay on
-- Connecteam. A few of them also work THC shifts, so the office can switch
-- THC scheduling on for those people one by one.
--
--   1. staff.spudbros_express — the person is SpudBros Express staff. Set
--      by /apply/spudbros for a NEW candidate (record_application_source),
--      or by the office (set_staff_scheduling).
--      staff.thc_shifts_enabled — the exception: THC shifts switched on.
--      "Onboarding only" is the pair (spudbros_express and not
--      thc_shifts_enabled) and is named once, in staff_onboarding_only().
--      Neither column is compliance: the person still goes through every
--      document, check and status like anybody else, and the weekly cap,
--      right-to-work stop and expiry radar are untouched.
--
--   2. Where it bites — three places, the last being the one that cannot
--      be bypassed:
--        · auto_assign_candidates() (the pool auto-assign, the board's
--          Potential pool, Invite and the offers all read) returns NO ROW
--          for an onboarding-only worker, like a candidate;
--        · staff_me() carries `onboardingOnly`, which the Staff App turns
--          into an app lock that keeps Profile (and Documents) and closes
--          Shifts, Invites and Radar;
--        · a BEFORE trigger on bookings refuses any booking for them, so a
--          direct write from the office, psql or a path nobody has built
--          yet cannot roster them either.
--
--   3. set_staff_scheduling(staff, spudbros, thc_shifts) — the office
--      toggle. Any office login that is not read-only; audited; refused on
--      a removed worker; refuses to make someone onboarding-only while
--      they still hold an upcoming invitation or booking, so no shift is
--      left behind a closed app.
--
--   4. submit_application_as_caller gains a 9th argument p_source. Only
--      'spudbros' does anything, and only for the candidate THIS call
--      created: a returning-applicant match (§2.12) is an existing record
--      and is never marked (the same rule as the referral, 20260930205300).
--      Restated byte-for-byte from 20260930204000 but for the argument and
--      one clause.
--
-- What does NOT change: statuses, documents, the contract, the Employee ID
-- (payroll codes, ADR-0076 — a SpudBros person on the payroll list is
-- matched by name at contract signature like anybody else), notifications,
-- pay, reports. pgTAP 778 asserts the gates together.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The two columns and the one name for "onboarding only"
-- ---------------------------------------------------------------------
alter table public.staff
  add column if not exists spudbros_express boolean not null default false,
  add column if not exists thc_shifts_enabled boolean not null default false;

comment on column public.staff.spudbros_express is
  '20261007130000: SpudBros Express staff. Onboarding with THC only — shifts and scheduling stay on Connecteam — unless thc_shifts_enabled.';
comment on column public.staff.thc_shifts_enabled is
  '20261007130000: the exception for a SpudBros Express worker who also works THC shifts. Meaningless while spudbros_express is false.';

-- 20260923220000 replaced SELECT on staff with SELECT on a named column
-- list; a column added since needs its own grant (as languages did). RLS
-- still decides the rows: a worker reads their own, the office everyone's.
-- The pool (auto_assign_candidates, security invoker) and the office
-- profile read these two.
grant select (spudbros_express, thc_shifts_enabled) on table public.staff to anon, authenticated;

create or replace function public.staff_onboarding_only(p_staff uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.spudbros_express and not s.thc_shifts_enabled from staff s where s.id = p_staff),
    false)
$$;

comment on function public.staff_onboarding_only(uuid) is
  '20261007130000: true for SpudBros Express staff whose THC shifts have not been switched on. The one definition: the pool, the booking trigger and staff_me() all say the same thing.';

revoke execute on function public.staff_onboarding_only(uuid) from public, anon;
grant  execute on function public.staff_onboarding_only(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2 · The office toggle
-- ---------------------------------------------------------------------
create or replace function public.set_staff_scheduling(
  p_staff       uuid,
  p_spudbros    boolean,
  p_thc_shifts  boolean
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_removed timestamptz;
  v_spud    boolean := coalesce(p_spudbros, false);
  -- Switching THC shifts on is only meaningful for SpudBros staff; for
  -- everyone else the column is kept false so the pair never contradicts.
  v_shifts  boolean := coalesce(p_spudbros, false) and coalesce(p_thc_shifts, false);
begin
  perform assert_office_caller();
  perform assert_not_read_only();

  select s.removed_at into v_removed from staff s where s.id = p_staff for update;
  if not found then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if v_removed is not null then
    raise exception 'staff_removed' using errcode = 'P0001';
  end if;

  -- Closing the app on someone with an upcoming invitation, application
  -- or confirmed shift would strand it. The office moves or cancels those
  -- first.
  if v_spud and not v_shifts and exists (
       select 1
         from bookings b
         join shift_requirements sr on sr.id = b.shift_id
        where b.staff_id = p_staff
          and b.status in ('invited', 'applied', 'confirmed')
          and sr.starts_at > now()) then
    raise exception 'has_upcoming_shifts' using errcode = 'P0001';
  end if;

  update staff
     set spudbros_express   = v_spud,
         thc_shifts_enabled = v_shifts
   where id = p_staff;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'staff.scheduling_set', 'staff', p_staff,
          jsonb_build_object('staffId', p_staff::text,
                             'spudbrosExpress', v_spud,
                             'thcShiftsEnabled', v_shifts));

  return jsonb_build_object('staffId', p_staff::text,
                            'spudbrosExpress', v_spud,
                            'thcShiftsEnabled', v_shifts);
end $$;

comment on function public.set_staff_scheduling(uuid, boolean, boolean) is
  '20261007130000: the office marks a worker as SpudBros Express staff (onboarding only; shifts stay on Connecteam) and, for the few who also work THC shifts, switches THC scheduling on. Office logins that are not read-only; refused on a removed worker; refused while an onboarding-only result would strand an upcoming invitation, application or confirmed shift (has_upcoming_shifts); audited.';

revoke all on function public.set_staff_scheduling(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_staff_scheduling(uuid, boolean, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3 · The hard stop: no booking for an onboarding-only worker
-- ---------------------------------------------------------------------
create or replace function public.bookings_onboarding_only_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.staff_onboarding_only(new.staff_id) then
    raise exception 'onboarding_only_worker'
      using errcode = 'P0001',
            hint = 'SpudBros Express staff do their onboarding with THC; their shifts are scheduled on Connecteam. Switch THC shifts on from the worker''s profile to book them.';
  end if;
  return new;
end $$;

revoke execute on function public.bookings_onboarding_only_guard() from public, anon, authenticated;

drop trigger if exists bookings_onboarding_only on public.bookings;
create trigger bookings_onboarding_only
  before insert or update of staff_id, shift_id on public.bookings
  for each row execute function public.bookings_onboarding_only_guard();

-- ---------------------------------------------------------------------
-- 4 · The pool — 20261002108000's body plus one predicate
-- ---------------------------------------------------------------------
create or replace function public.auto_assign_candidates(
  p_shift      uuid,
  -- §3.4 same-day escalation: also gate anyone whose home is not within
  -- escalation_radius_miles() of the venue. Default false = the ordinary
  -- pool, unchanged, for every caller that existed before 20260927140100.
  p_escalation boolean default false
)
returns table (
  staff_id       uuid,
  gate           text,
  qualified      boolean,
  booking_status text,
  reliability    numeric,
  rating         numeric,
  distance_km    numeric,
  future_shifts  int,
  venue_times    int,
  -- (3) appended 20260930110000: this section's own booking's cause.
  booking_cause  text
) language sql stable
set search_path = public, extensions
as $$
  with sec as (
    select sr.id as shift_id, sr.role_id, sr.starts_at, sr.ends_at, sr.required_gender,
           ev.id as event_id, ev.client_id, ev.venue_id, ev.venue_location,
           -- ADR-0080: the languages the event needs besides English, which
           -- is never gated — everyone THC books speaks it.
           array_remove(ev.required_languages, 'English') as extra_languages
    from shift_requirements sr join events ev on ev.id = sr.event_id
    where sr.id = p_shift
  ),
  gap as (select booked_elsewhere_gap_minutes() as mins),
  -- One statute mile is 1,609.344 m; geography distances are metres.
  rad as (select case when p_escalation then escalation_radius_miles() * 1609.344 end as metres)
  select
    s.id,
    case
      when not exists (select 1 from staff_roles sro
                        where sro.staff_id = s.id and sro.role_id = sec.role_id) then 'wrong_role'
      -- ADR-0079: the client asked for staff of one gender on this role.
      -- Straight after wrong_role because, like it, it is what the SECTION
      -- asks for rather than anything about the worker's week.
      when sec.required_gender is not null and s.gender is null              then 'gender_not_recorded'
      when sec.required_gender = 'M' and s.gender <> 'M'                      then 'male_only'
      when sec.required_gender = 'F' and s.gender <> 'F'                      then 'female_only'
      -- ADR-0080: the event needs staff who also speak another language.
      -- Next to the gender gates for the same reason: it is what the EVENT
      -- asks for. Nothing on file reads as "not shown to speak it", listed
      -- so the office can record it; on file without it is no row at all.
      when cardinality(sec.extra_languages) > 0 and s.languages is null         then 'languages_not_recorded'
      when not (sec.extra_languages <@ s.languages)                             then 'language_not_spoken'
      when exists (select 1 from client_qualifications cq
                    where cq.staff_id = s.id and cq.client_id = sec.client_id
                      and cq.do_not_return)                                     then 'do_not_return'
      when s.status <> 'compliant'                                              then 'blocked'
      when exists (select 1 from bookings b
                     join shift_requirements sr2 on sr2.id = b.shift_id
                    where b.staff_id = s.id and sr2.event_id = sec.event_id
                      and b.self_cancelled)                                     then 'self_cancelled'
      -- (1) §3.4 "only the worker's other CONFIRMED bookings count" — and a
      -- checked-in booking is a confirmed one (20260930110000, D2).
      when exists (
             select 1 from bookings b
               join shift_requirements sr2 on sr2.id = b.shift_id
               join events ev2 on ev2.id = sr2.event_id
              where b.staff_id = s.id and b.status in ('confirmed', 'worked')
                and b.shift_id <> sec.shift_id
                and booked_elsewhere_conflict(sec.starts_at, sec.ends_at, sec.venue_id,
                                              sr2.starts_at, sr2.ends_at, ev2.venue_id,
                                              gap.mins) <> 'clear')             then 'booked_elsewhere'
      -- RULE-20 and the right-to-work stop share one gate, but not one
      -- label: a worker past their right to work is not "over their
      -- hours" and the board must not say so (20260924130100).
      when weekly_cap_would_breach(s.id, sec.shift_id) then
        case when not (can_roster_staff(s.id, (sec.starts_at at time zone 'Europe/London')::date)
                       and can_roster_staff(s.id, ((sec.ends_at - interval '1 second')
                                                   at time zone 'Europe/London')::date))
             then 'rtw_expired'
             else 'hours_limit' end
      -- §3.4 same-day escalation only: "within a 3-mile radius of the
      -- venue". No home on file cannot be shown to be inside it.
      when rad.metres is not null
           and (s.home_location is null
                or not st_dwithin(s.home_location, sec.venue_location, rad.metres)) then 'outside_radius'
      else null
    end as gate,
    exists (select 1 from client_qualifications cq
             where cq.staff_id = s.id and cq.client_id = sec.client_id
               and cq.role_id = sec.role_id and not cq.do_not_return) as qualified,
    mine.status as booking_status,
    -- §6 show-rate, derived from the worker's history (20260928110100);
    -- 90 with no history is the formula's zero point, as before.
    coalesce(staff_show_rate(s.id), 90)::numeric,
    coalesce(s.rating, 4.0)::numeric,
    coalesce(st_distance(s.home_location, sec.venue_location) / 1000.0, 9999)::numeric,
    (select count(*) from bookings b join shift_requirements sr3 on sr3.id = b.shift_id
      where b.staff_id = s.id and b.status = 'confirmed' and sr3.starts_at > now())::int,
    (select count(*) from bookings b
       join shift_requirements sr4 on sr4.id = b.shift_id
       join events ev4 on ev4.id = sr4.event_id
      where b.staff_id = s.id and b.status = 'worked' and ev4.venue_id = sec.venue_id)::int,
    mine.cancel_cause as booking_cause
  from staff s cross join sec cross join gap cross join rad
  -- (3) This section's own booking, read once for its status and cause.
  -- bookings is unique on (shift_id, staff_id), so at most one row.
  left join lateral (
    select b.status::text as status, b.cancel_cause
      from bookings b
     where b.shift_id = sec.shift_id and b.staff_id = s.id
  ) mine on true
  where s.removed_at is null and s.left_at is null
    -- (2) Workers only (§2.12): compliant, or blocked (gated above). A
    -- candidate mid-onboarding or a rejected applicant is in no pool and
    -- produces no row — not an Unavailable "Blocked — compliance" row.
    and s.status in ('compliant', 'blocked')
    -- SpudBros Express staff (20261007130000): onboarding only, unless the
    -- office has switched THC shifts on for them. No row at all — like a
    -- candidate — so they never show on the board, never get an invitation
    -- and never see an offer.
    and not (s.spudbros_express and not s.thc_shifts_enabled)
$$;

comment on function public.auto_assign_candidates(uuid, boolean) is
  'SpudBros Express staff who have not been switched on for THC shifts (staff.spudbros_express and not staff.thc_shifts_enabled) have no row at all (20261007130000). The §3.3/§3.4 pool for one role section, computed fresh: gate, wave, the five §6 factor inputs — reliability is staff_show_rate() (20260928110100), never the stored column — and this section''s own booking (status and, since 20260930110000, cause). Workers only: candidates, rejected applicants, leavers and removed workers have no row (20260930110000). Gates: wrong_role, male_only / female_only / gender_not_recorded (a section with a required_gender, ADR-0079), languages_not_recorded / language_not_spoken (an event whose required_languages name one besides English, ADR-0080), do_not_return, blocked, self_cancelled, booked_elsewhere (confirmed or worked, 2 h different-venue gap — 20260930110000), rtw_expired (20260924130100), hours_limit (RULE-20), and — only with p_escalation — outside_radius (§3.4 same-day escalation, 20260927140100). Scoring itself is packages/domain/scoring.ts.';


-- ---------------------------------------------------------------------
-- 5 · staff_me() — 20261001210000's body plus two keys
-- ---------------------------------------------------------------------
create or replace function public.staff_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  s staff;
  v_blockers text[];
  v_checked_in boolean;
  v_roles text[];
  v_bank jsonb;
begin
  if v_id is null then
    return null;
  end if;

  select * into s from staff where id = v_id;
  if s.id is null then
    return null;
  end if;

  select coalesce(array_agg(reason), '{}') into v_blockers
    from compliance_blockers(v_id, (now() at time zone 'Europe/London')::date);

  select exists (
    select 1
      from bookings b
      join shift_requirements sr on sr.id = b.shift_id
      join check_logs cl         on cl.booking_id = b.id
     where b.staff_id = v_id
       and b.cancelled_at is null
       and cl.check_in_at is not null
       and cl.check_out_at is null
       and now() < sr.ends_at + interval '4 hours'
  ) into v_checked_in;

  select coalesce(array_agg(r.name order by r.name), '{}') into v_roles
    from staff_roles sr join roles r on r.id = sr.role_id
   where sr.staff_id = v_id;

  select jsonb_build_object(
           'accountHolder', b.account_holder,
           'sortCode',      b.sort_code,
           'accountNumber', b.account_number,
           'updatedAt',     b.updated_at)
    into v_bank
    from bank_details b where b.staff_id = v_id;

  return jsonb_build_object(
    'staffId',        s.id::text,
    'firstName',      s.first_name,
    'lastName',       s.last_name,
    'employeeId',     s.employee_id,
    'email',          s.email,
    'phone',          s.phone,
    'homeAddress',    s.home_address,
    'photoPath',      s.photo_path,
    'photoLocked',    s.photo_path is not null,
    'status',         s.status::text,
    -- The KIND of manual block, never its reason (§10.1).
    'blockKind',      s.block_kind::text,
    -- The CAUSE of a rejection, never the office's reason (ADR-0017).
    'rejectionCause', s.rejection_cause,
    'leftAt',         s.left_at,
    'rtwBranch',      s.rtw_branch::text,
    'niMasked',       case
                        when s.ni_number is null then null
                        else repeat('●', greatest(length(s.ni_number) - 2, 0))
                             || right(s.ni_number, 2)
                      end,
    'hasNiNumber',    s.ni_number is not null,
    -- 20261001210000 (ADR-0070): Profile details shows it locked, with
    -- Request a change; the worker's own date, nobody else's.
    'dob',            s.dob,
    'rating',         s.rating,
    -- §10.1 "Show-rate 97%" pill: the derived §6 figure (20260928110700);
    -- null with no history, and the sheet hides the pill.
    'reliability',    staff_show_rate(v_id),
    'quizAttempts',   s.quiz_attempts,
    'roles',          to_jsonb(v_roles),
    'blockers',       to_jsonb(v_blockers),
    'checkedIn',      v_checked_in,
    'bank',           v_bank,
    -- 20261007130000: SpudBros Express staff. onboardingOnly closes Shifts,
    -- Invites and Radar (the app lock); spudbros alone only labels the
    -- profile for someone who also works THC shifts.
    'spudbros',       s.spudbros_express,
    'onboardingOnly', s.spudbros_express and not s.thc_shifts_enabled);
end $$;

comment on function public.staff_me() is
  'The worker''s own profile for the §10.1 profile sheet, plus the app-lock inputs. Never returns block_reason or rejection_reason; rejectionCause (willo / manager / quiz_failed) decides which terminal screen shows. reliability is staff_show_rate() since 20260928110700, null with no history. dob since 20261001210000: Profile details shows it locked (ADR-0070). spudbros / onboardingOnly since 20261007130000: SpudBros Express staff, whose shifts stay on Connecteam unless the office switches THC shifts on.';

-- ---------------------------------------------------------------------
-- 6 · /apply/spudbros marks the NEW candidate it created
-- ---------------------------------------------------------------------
create or replace function public.record_application_source(
  p_email  text,
  p_source text
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  -- submit_application()'s normalisation, so the lookup finds the row it wrote.
  v_email     text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_candidate uuid;
begin
  if v_email is null or p_source is distinct from 'spudbros' then
    return;
  end if;

  begin
    -- The application just written (stamped in this transaction) and one
    -- that created a NEW candidate. A returning-applicant match is an
    -- existing record — possibly a live worker — and is never marked:
    -- anyone knowing an email and a date of birth could otherwise close
    -- someone else's shifts from the public form.
    select a.staff_id
      into v_candidate
      from applications a
     where a.email = v_email
       and a.outcome = 'candidate_created'
       and a.created_at = now()
     limit 1;

    if v_candidate is not null then
      update staff set spudbros_express = true where id = v_candidate;
    end if;
  exception when others then
    -- Never raises: the application the caller just wrote stands.
    return;
  end;
end $$;

comment on function public.record_application_source(text, text) is
  '20261007130000: marks the candidate the current /apply/spudbros application created as SpudBros Express staff. Only a new candidate (outcome candidate_created); a returning-applicant match is never marked. Never raises. Owner-only: called by submit_application_as_caller(), by no API role.';

revoke execute on function public.record_application_source(text, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7 · submit_application_as_caller — 20260930204000's body plus p_source
-- ---------------------------------------------------------------------
drop function if exists public.submit_application_as_caller(text, text, text, text, date, boolean, text, text);

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
  p_referral_code text default null,
  -- 20261007130000: /apply/spudbros. 'spudbros' marks a NEW candidate as
  -- SpudBros Express staff; anything else is ignored.
  p_source text default null
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

  -- 20261007130000: the SpudBros Express application. Never raises, and
  -- only ever touches the candidate this call created.
  if p_source = 'spudbros' then
    perform public.record_application_source(p_email, p_source);
  end if;

  if v_hash is not null then
    insert into private.apply_caller_hits (caller_hash) values (v_hash);
  end if;
end $$;

comment on function public.submit_application_as_caller(text, text, text, text, date, boolean, text, text, text) is
  '§2.1 /apply through the Staff App server action: submit_application() plus a per-caller limit (settings.apply_caller_throttle: 5/hour, 20/day) keyed by an HMAC of the caller''s IP, never the IP. Null hash = no per-caller check. An optional source (/apply/spudbros marks a new candidate SpudBros Express staff, 20261007130000) and an optional referral code (/apply?ref=, ADR-0047) is recorded by record_application_referral() after the application is written and never refuses it. Service role only (ADR-0024).';

revoke execute on function public.submit_application_as_caller(text, text, text, text, date, boolean, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_application_as_caller(text, text, text, text, date, boolean, text, text, text)
  to service_role;
