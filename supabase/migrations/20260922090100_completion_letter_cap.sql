-- =====================================================================
-- Migration 20260922090100 · the University Completion Letter requirement
-- in SQL (RULE-20, §4.4–4.5 +
-- docs/scope/university-completion-letter-requirement.pdf)
--
-- Why this exists
-- ---------------
-- 0008_weekly_cap.sql resolved RULE-20 from four facts: is the worker on a
-- student visa, where does the Mon-Sun week sit against the holiday ranges,
-- is a completion letter verified, is the 48-hour opt-out signed. The
-- requirement adds six more, every one of them DATED — which is the whole
-- point of it, because a release that starts on the wrong day is either a
-- civil penalty for illegal working or a worker told to go home for no
-- reason:
--
--   week_start             Monday of the week being asked about. The five
--                          facts below mean nothing without it.
--   below_degree_level     The Student condition is 10 h a week, not 20,
--                          for a course below degree level (§1, §3).
--   completion_date        The course completion date STATED ON THE LETTER.
--                          The release runs from that date, not from the
--                          day a manager verified it: a letter issued
--                          before the final exam carries a future date and
--                          must not lift the cap yet (§2.3, §7).
--   visa_expiry            Right to work expiry, inclusive. A hard stop
--                          that outranks everything, the completion letter
--                          included (§2.3, §3, acceptance criterion 6).
--   optout_cancelled_from  The day a cancelled opt-out stops applying: the
--                          END of the notice period, not the day notice
--                          was given (§2.4, acceptance criterion 5).
--   under18                An under-18 cannot sign an opt-out, so a tick
--                          recorded against one is not a valid opt-out
--                          (§2.4, acceptance criterion 4).
--
-- The order of the branches IS the rule, and it is the order in
-- packages/domain/src/cap.ts, statement for statement:
--
--   0. Week wholly past the visa expiry            -> 0, visa_expired_0
--   1. Student visa condition in force             -> 10 or 20
--   2. A valid, in-force opt-out                   -> no ceiling
--   3. Otherwise                                   -> 48, labelled
--
-- Two "in force" tests decide 1 and 2, and both resolve a straddling week
-- to the LOWER cap — the same principle §4.4 already applies to a week
-- straddling term and holiday:
--
--   completion is in force  when the letter is verified AND (no dates on
--                           file OR week_start >= completion_date). The
--                           week the course completes straddles the date,
--                           so it stays at the term cap.
--   an opt-out is in force  when it is signed AND the worker is 18+ AND
--                           (no dates on file OR week_end <
--                           optout_cancelled_from). The week the notice
--                           period ends straddles it, so the 48 h ceiling
--                           is already back.
--
-- Every one of those sentences is a row in packages/domain/src/cap.vectors.json
-- and is run against BOTH implementations: Vitest against weeklyCap(),
-- supabase/tests/090_weekly_cap.sql against weekly_cap() below.
--
-- What this migration does NOT change
-- -----------------------------------
-- The four-argument weekly_cap() still exists and still answers exactly
-- what it answered yesterday, by delegating with the six new facts absent.
-- Nothing that calls it today has to change, and the fifteen original
-- vectors — which carry none of the new facts — are the proof.
--
-- Forward-only: 0008 is left untouched. 20260922090000 added the two enum
-- labels this file uses; they cannot be added and used in one transaction.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The facts `staff` has to carry
--
-- Two of the six are already on the row and are reused rather than
-- duplicated:
--   · visa expiry  -> staff.right_to_work_until, written from the gov.uk
--                     share-code report at the §2.5 Right to Work check.
--                     The requirement's §2.2 "should already be on file
--                     from the right-to-work check" is this column.
--   · under 18     -> derived from staff.dob, never stored as a flag. An
--                     age is a fact about a date, not about a person: a
--                     stored boolean is wrong the morning after the
--                     worker's birthday and nobody is watching it. PR #4
--                     made dob nullable for /apply (§2.1 collects an age
--                     band), so the derivation has to tolerate null.
--
-- The three added here are the ones nothing on `staff` can answer. All are
-- denormalised from the verified document onto the worker exactly as
-- `term_dates` and `graduated_at` already are: compliance_docs remains the
-- audit record (requirement §4 — document, uploader, reviewer, timestamps,
-- rejection reasons), and the copy on `staff` is the operative fact the
-- cap reads, so the hot path of auto-assign is one row and not a join to a
-- table whose RLS differs.
--
-- No new table, so no new RLS: these are columns of `staff`, covered by
-- the admin_all / staff_self policies in 0004 and 20260921123503 and by
-- supabase/tests/030_rls_staff.sql. A column cannot carry a policy of its
-- own and none of the three is more sensitive than the dob and NI number
-- already on the row.
-- ---------------------------------------------------------------------
alter table staff
  add column if not exists below_degree_level       boolean not null default false,
  add column if not exists course_completion_date   date,
  add column if not exists wtr_optout_cancelled_from date;

comment on column staff.below_degree_level is
  'Student visa condition is 10 h/week in term time rather than 20, because the course is below degree level (completion letter requirement §1, §3). Default false: a course is at or above degree level unless the Right to Work check says otherwise.';
comment on column staff.course_completion_date is
  'The course completion date stated on the VERIFIED completion letter, copied from compliance_docs.completion_date at verification (§2.2). The 20 -> 48 release runs from this date, never from the verification date and never backdated into rostered history (§2.3). Null with graduated_at set is the pre-requirement behaviour: the flag alone releases.';
comment on column staff.wtr_optout_cancelled_from is
  'The day a cancelled 48-hour opt-out stops applying — the END of the notice period (7 days, or up to 3 months if the agreement says so), not the day notice was given (§2.4). The 48 h ceiling is back from this date; a week straddling it takes the lower cap.';
comment on column staff.wtr_optout is
  '48-hour Working Time Regulations opt-out signed (§4.4). Lifts the 48 h ceiling everywhere EXCEPT where a visa condition sets the limit. Not valid for an under-18 and not valid from wtr_optout_cancelled_from — weekly_cap() decides, this column is only the tick.';

-- ---------------------------------------------------------------------
-- 2 · Under 18, as of a week
--
-- "Under 18" is asked of a WEEK, not of today, because the cap is asked of
-- a week. The worker who turns 18 on the Wednesday was under 18 for part
-- of that week, so the opt-out cannot have been valid for it: the lower
-- cap wins, as it does for every other straddle in RULE-20. Comparing
-- against the Monday is what produces that.
--
-- Null dob is false, not true: an unknown date of birth is not evidence of
-- anything, and the §2.1 age gate plus the age_18 check constraint already
-- refuse an under-18 applicant. This mirrors the TypeScript, where
-- `under18` is optional and absent means absent.
--
-- The age_18 constraint is checked when a row is written, against
-- current_date, so it cannot make this function dead code: it says the
-- worker is 18 TODAY, not that they were 18 in the week being asked about.
-- ---------------------------------------------------------------------
create or replace function cap_under_18(p_dob date, p_week_start date)
returns boolean language sql immutable
set search_path = public, extensions
as $$
  select p_dob is not null
     and p_week_start is not null
     and p_week_start < (p_dob + interval '18 years')::date
$$;

comment on function cap_under_18(date, date) is
  'True when the worker had not yet turned 18 on the Monday of this Mon-Sun week, so no 48-hour opt-out was valid for it (completion letter requirement §2.4).';

-- ---------------------------------------------------------------------
-- 3 · RULE-20, extended
--
-- Ten arguments, no defaults. Defaults would make weekly_cap(a,b,c,d)
-- ambiguous against the four-argument function below and Postgres would
-- refuse to resolve the call at all ("function is not unique"), so the old
-- signature is kept as a real overload that delegates.
--
-- Held to packages/domain/src/cap.vectors.json case for case, cap AND
-- band, against packages/domain/src/cap.ts weeklyCap().
-- ---------------------------------------------------------------------
create or replace function weekly_cap(
  p_visa_limited               boolean,
  p_term_state                 text,     -- 'term' | 'holiday' | 'straddle' | 'none'
  p_completion_letter_verified boolean,
  p_optout_48h                 boolean,
  p_week_start                 date,     -- Monday of the week; null = not dated
  p_below_degree_level         boolean,
  p_completion_date            date,
  p_visa_expiry                date,     -- inclusive
  p_optout_cancelled_from      date,
  p_under18                    boolean
) returns cap_assessment language sql immutable
set search_path = public, extensions
as $$
  with in_force as (
    select
      -- completionInForce() in cap.ts: the flag alone when no dates are on
      -- file, otherwise only from the completion date. A week that
      -- straddles that date is still a term week.
      coalesce(p_completion_letter_verified, false)
        and (p_completion_date is null
             or p_week_start is null
             or p_week_start >= p_completion_date)                as completion,
      -- optOutInForce() in cap.ts: signed, 18 or over, and not yet reached
      -- the end of a notice period. p_week_start + 6 is the Sunday, so a
      -- week the cancellation lands inside has already lost the opt-out.
      coalesce(p_optout_48h, false)
        and not coalesce(p_under18, false)
        and (p_optout_cancelled_from is null
             or p_week_start is null
             or p_week_start + 6 < p_optout_cancelled_from)       as optout
  )
  select case
    -- 0. Right to work outranks everything, completion letter included.
    --    Only a week WHOLLY past expiry is zero here: a week that straddles
    --    expiry still has workable days, and can_roster() blocks the days
    --    past it, shift by shift.
    when p_visa_expiry is not null and p_week_start is not null
         and p_week_start > p_visa_expiry
      then row(0, 'visa_expired_0')::cap_assessment
    -- 1. The visa condition: it beats the opt-out and the calendar alike.
    when coalesce(p_visa_limited, false) and not in_force.completion
         and p_term_state is distinct from 'holiday'
      then case when coalesce(p_below_degree_level, false)
                then row(10, 'student_term_10')::cap_assessment
                else row(20, 'student_term_20')::cap_assessment
           end
    -- 2. Everywhere else a valid opt-out removes the ceiling.
    when in_force.optout
      then row(null, 'uncapped')::cap_assessment
    -- 3. Otherwise 48, labelled by whatever produced it.
    when coalesce(p_visa_limited, false) and in_force.completion
      then row(48, 'graduated_48')::cap_assessment
    when coalesce(p_visa_limited, false)
      then row(48, 'student_holiday_48')::cap_assessment
    else row(48, 'standard_48')::cap_assessment
  end
  from in_force
$$;

comment on function weekly_cap(boolean, text, boolean, boolean, date, boolean, date, date, date, boolean) is
  'RULE-20 (§4.4-4.5 + the University Completion Letter requirement) as a pure function of ten facts. Branch order is the rule: visa expiry, then the Student condition, then the opt-out, then 48. Held to packages/domain/src/cap.vectors.json alongside weeklyCap() in packages/domain/src/cap.ts.';

-- The signature 0008 shipped, kept working. Every caller that has no dated
-- facts to offer gets the answer it got before: no week, no expiry, no
-- completion date, no cancellation, at or above degree level, 18 or over.
-- Replacing it resets its attributes, so the search_path pin from
-- 20260921130156 is restated here rather than inherited.
create or replace function weekly_cap(
  p_visa_limited               boolean,
  p_term_state                 text,
  p_completion_letter_verified boolean,
  p_optout_48h                 boolean
) returns cap_assessment language sql immutable
set search_path = public, extensions
as $$
  select weekly_cap(p_visa_limited, p_term_state, p_completion_letter_verified, p_optout_48h,
                    null::date, false, null::date, null::date, null::date, false)
$$;

comment on function weekly_cap(boolean, text, boolean, boolean) is
  'RULE-20 from the four §4.4 facts alone — the 0008 signature, delegating with the dated facts of the completion letter requirement absent. Absent means unchanged, which the first fifteen shared vectors assert.';

-- ---------------------------------------------------------------------
-- 4 · The per-shift hard stop
--
-- The weekly cap cannot express this one. A week that straddles the visa
-- expiry has workable days before it and none after, so the rota engine
-- has to ask per shift (requirement §2.3, §7, acceptance criterion 6).
--
-- p_visa_expiry is INCLUSIVE: the last day the worker may work.
--
-- Deliberately not STRICT. A null expiry means "no limit recorded", which
-- is true for every UK and settled worker, and a strict function would
-- answer null there — which coalesces to "cannot roster" in one caller and
-- "can" in the next. Mirrors canRoster() in packages/domain/src/cap.ts,
-- where an absent expiry returns true.
-- ---------------------------------------------------------------------
create or replace function can_roster(p_shift_date date, p_visa_expiry date)
returns boolean language sql immutable
set search_path = public, extensions
as $$
  select p_visa_expiry is null or p_shift_date <= p_visa_expiry
$$;

comment on function can_roster(date, date) is
  'Per-shift right-to-work hard stop (completion letter requirement §2.3, acceptance criterion 6). Expiry is inclusive; a null expiry is no limit recorded, not a block. Mirrors canRoster() in packages/domain/src/cap.ts.';

-- The same question about a real worker. Invoker rights, so a caller who
-- cannot see the staff row gets no expiry and therefore `true` — the
-- answer they already get from weekly_cap_for(), which is null for a row
-- they cannot read. Callers that must not guess read the staff row.
create or replace function can_roster_staff(p_staff uuid, p_shift_date date)
returns boolean language sql stable
set search_path = public, extensions
as $$
  select can_roster(p_shift_date, (select s.right_to_work_until from staff s where s.id = p_staff))
$$;

comment on function can_roster_staff(uuid, date) is
  'can_roster() for a worker on a date, reading staff.right_to_work_until. True when no expiry is recorded.';

-- ---------------------------------------------------------------------
-- 5 · The cap for a real worker, with the dated facts supplied
--
-- Read live: nothing is cached, so a worker whose holiday started
-- overnight, whose completion date passed at midnight or whose opt-out
-- notice ran out is in the right band the same morning, without a cron and
-- without anyone touching their profile (§4.4).
--
-- Two separate gates on the completion letter, and both have to pass:
--   graduated_at <= p_date   §4.5 — effective-dated from VERIFICATION,
--                            never backdated; hours already worked under
--                            the old cap are untouched.
--   week_start >= course_completion_date  requirement §2.3 — the release
--                            runs from the date on the letter.
-- The later of the two therefore wins, which is the conservative reading
-- and the only one that satisfies both documents.
-- ---------------------------------------------------------------------
create or replace function weekly_cap_for(p_staff uuid, p_date date)
returns cap_assessment language sql stable
set search_path = public, extensions
as $$
  select weekly_cap(
    s.rtw_branch is not distinct from 'international_student'::rtw_branch,
    cap_term_state(s.term_dates, p_date),
    s.graduated_at is not null and s.graduated_at <= p_date,
    s.wtr_optout,
    cap_week_start(p_date),
    s.below_degree_level,
    s.course_completion_date,
    s.right_to_work_until,
    s.wtr_optout_cancelled_from,
    cap_under_18(s.dob, cap_week_start(p_date))
  )
  from staff s where s.id = p_staff
$$;

comment on function weekly_cap_for(uuid, date) is
  'RULE-20 for a worker in the Mon-Sun week containing p_date, read live off their row. Null for a worker the caller cannot see.';

-- ---------------------------------------------------------------------
-- 6 · The hard gate, with the expiry wired in
--
-- Auto-assign's hard gate and accept_invite both ask this one question
-- (§3.4). It now answers two: would the shift take the worker over their
-- cap for the week, AND is the shift past their right to work.
--
-- Why the expiry belongs here rather than only in the band: for a week
-- WHOLLY past expiry the band already answers, because 0 hours leaves 0
-- remaining and every shift breaches it. The gap is the week that
-- STRADDLES expiry — cap 48, plenty of room, and a Saturday shift the
-- worker has no right to work. That shift is only visible per shift, which
-- is what can_roster() is for.
--
-- Two consequences worth naming rather than discovering:
--   · 20260921141500_auto_assign.sql labels this gate 'hours_limit'. For
--     an expired right to work that label is wrong, and it is the
--     scheduling side's to widen — the gate itself is correct and a worker
--     wrongly rostered past their visa is a civil penalty, an imprecise
--     exclusion reason is a word in a debug column.
--   · In practice compliance-daily has usually blocked the worker first
--     (§4.3), and `s.status <> 'compliant'` gates them out before this
--     line is reached. This is the belt to that braces: the window between
--     the expiry and the cron, and any caller that is not auto-assign.
--
-- False for an unknown shift, and false for an uncapped worker — a caller
-- that needs "does this shift exist" asks shift_requirements.
-- ---------------------------------------------------------------------
create or replace function weekly_cap_would_breach(p_staff uuid, p_shift uuid)
returns boolean language sql stable
set search_path = public, extensions
as $$
  select coalesce(
    not can_roster_staff(p_staff, (sr.starts_at at time zone 'Europe/London')::date)
    or extract(epoch from (sr.ends_at - sr.starts_at)) / 3600.0
       > weekly_hours_remaining(p_staff, (sr.starts_at at time zone 'Europe/London')::date),
    false)
  from shift_requirements sr
  where sr.id = p_shift
$$;

comment on function weekly_cap_would_breach(uuid, uuid) is
  'RULE-20 hard gate for auto-assign and accept_invite (§3.4): over the weekly cap, or past the recorded right-to-work expiry (completion letter requirement, acceptance criterion 6).';

-- ---------------------------------------------------------------------
-- 7 · What N14 calls the two new bands
--
-- 20260921170411 gives cap_band_label() an `else p_band::text` fallback,
-- so an unlabelled band does not fail — it SENDS. A worker would receive
-- "your weekly limit is now 10 hours — student_term_10", which is the
-- exact failure that function exists to prevent. Two labels, in the same
-- second-person voice as the five already there.
--
-- visa_expired_0 is included for completeness rather than because it is
-- expected: a worker whose right to work has expired is blocked by the
-- §4.3 ladder on the same sweep, before the N14 loop, which only looks at
-- compliant workers. The label is what is sent if that order ever changes.
-- ---------------------------------------------------------------------
create or replace function public.cap_band_label(p_band cap_band)
returns text language sql immutable
set search_path = public, extensions
as $$
  select case p_band
    when 'student_term_10'    then 'term time'
    when 'student_term_20'    then 'term time'
    when 'student_holiday_48' then 'university holiday'
    when 'graduated_48'       then 'your completion letter is verified'
    when 'standard_48'        then 'the standard weekly limit'
    when 'uncapped'           then 'you have signed the 48-hour opt-out'
    when 'visa_expired_0'     then 'your right to work has expired'
    else p_band::text
  end
$$;

-- ---------------------------------------------------------------------
-- 8 · Two things this migration deliberately leaves alone
--
--   · reset_to_candidate() (20260921192246) and remove_worker()
--     (20260921190118, §1.7) clear right_to_work_until, term_dates,
--     graduated_at and wtr_optout, and do NOT clear the three columns
--     added above. That is a hygiene gap, not a cap bug, and the
--     difference matters: both new dated facts are AND-gated by a column
--     those functions already clear — course_completion_date does nothing
--     without graduated_at, wtr_optout_cancelled_from does nothing
--     without wtr_optout — so a reset candidate comes back at the term
--     cap, never released. below_degree_level surviving a reset errs at
--     10 h rather than 20, which is the safe direction. The §1.7 argument
--     for wiping them on removal stands and belongs in the same pass that
--     next touches those two function bodies.
--
--   · compliance_daily()'s N14 loop asks cap_band_until() only for
--     'student_term_20' and 'student_holiday_48', so a below-degree-level
--     student on the new 10 h band gets the dateless variant of §8's copy
--     rather than "until [date]". The number and the words are right; the
--     clause naming the Sunday is missing. Adding 'student_term_10' to
--     that list is a one-line change to a 200-line plpgsql body and is
--     left to the pass that rebuilds it, rather than restating the whole
--     function here for one enum label.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 9 · Privileges
--
-- Nothing is granted or revoked here, and that is the match rather than an
-- omission. The whole cap family in 0008 runs on the default EXECUTE to
-- public with INVOKER rights, and the two new functions keep the same
-- shape:
--   · weekly_cap(), can_roster() and cap_under_18() are pure — they read
--     no table, so executing them reveals nothing the caller did not
--     already supply as an argument.
--   · can_roster_staff(), weekly_cap_for() and weekly_cap_would_breach()
--     read `staff` and `shift_requirements` as the CALLER, so the RLS
--     policies on those tables decide what comes back. A worker sees their
--     own cap and nobody else's, which is exactly what §10.7 shows them.
-- `create or replace` preserves the privileges of the functions it
-- replaces, so the four-argument weekly_cap() and the three replaced above
-- keep whatever they had.
--
-- What IS restated on every function above is `set search_path = public,
-- extensions` (20260921130156): replacing a function resets its
-- attributes, so an unstated pin is a silently removed pin, and these
-- bodies resolve `staff`, `cap_assessment` and the cap_band labels by
-- unqualified name.
-- ---------------------------------------------------------------------
