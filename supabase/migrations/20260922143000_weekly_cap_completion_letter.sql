-- =====================================================================
-- RULE-20 in SQL catches up with RULE-20 in TypeScript (§4.4–4.5,
-- University Completion Letter Requirement §1–§3)
--
-- Why this exists
-- ---------------
-- 640272b added four rules to packages/domain/src/cap.ts and to
-- cap.vectors.json, and changed no migration. The vectors are the contract
-- between the two implementations, so they caught it immediately and
-- 090_weekly_cap.sql has been red on main ever since — assertion 2 on the
-- band mismatch, assertion 7 on an expectation of mine that the new rules
-- made wrong.
--
-- This is not only a red tick. The SQL half is what auto_assign_candidates
-- gates on, and what accept_invite gates on since
-- 20260922090000, so until now the database scored a worker
-- whose right to work had expired at 48 hours rather than nothing. The
-- `blocked` gate should reach them first once compliance-daily has run the
-- expiry ladder, so this was the second line of defence rather than the
-- only one — but it is the line that is supposed to hold when the first
-- has not run yet.
--
-- The four rules, each mirroring its TypeScript predicate exactly:
--
--   Right to work expired   0 h, `visa_expired_0`. Outranks everything,
--                           including a completion letter. Only a week
--                           WHOLLY past expiry is zero: a week straddling
--                           it still has workable days, which is what
--                           can_roster() below answers per shift.
--   Below degree level      10 h rather than 20 h in term, because that is
--                           the Student visa condition for those courses.
--   Completion letter       Effective from the COURSE COMPLETION DATE on
--                           the letter, not from the day a manager
--                           verified it: a letter issued before the final
--                           exam carries a future date and must not lift
--                           the cap yet.
--   Opt-out validity        An under-18 cannot sign one, so a recorded
--                           tick does not lift the ceiling; and a
--                           cancelled opt-out stops applying at the END of
--                           the notice period, not the day notice was
--                           given.
--
-- Every one of them is dated, so the week being asked about has to be an
-- input. That is why weekly_cap() grows arguments rather than columns:
-- the pure function stays pure and the vectors can drive it directly.
-- All new arguments default, so any caller written against the old
-- four-argument form keeps its exact behaviour.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The two new bands.
--
-- Separate statements, and nothing in this migration evaluates them,
-- because Postgres refuses to use an enum label added in the same
-- transaction that added it. The function bodies below are `language sql`
-- and are parsed at creation, so the labels are written as text and cast
-- at run time — see the cast in weekly_cap().
-- ---------------------------------------------------------------------
alter type cap_band add value if not exists 'student_term_10';
alter type cap_band add value if not exists 'visa_expired_0';

-- ---------------------------------------------------------------------
-- 2 · The facts these rules need, none of which the schema carried.
--
-- under18 is NOT a column: it is derived from `dob`, which is already
-- there and already the source of truth for the §2.1 age gate. Storing it
-- would let the two disagree on the one field that decides whether it is
-- legal to employ someone at all.
-- ---------------------------------------------------------------------
alter table staff add column if not exists below_degree_level boolean not null default false;
alter table staff add column if not exists course_completion_date date;
alter table staff add column if not exists optout_cancelled_at date;

comment on column staff.below_degree_level is
  'Studying below degree level: the Student visa hours condition is 10 h/week in term, not 20 (RULE-20).';
comment on column staff.course_completion_date is
  'The completion date stated on the University Completion Letter. The release runs from this date, not from the day it was verified; graduated_at remains the verification stamp.';
comment on column staff.optout_cancelled_at is
  'The date a cancelled 48-hour opt-out stops applying — the END of the notice period, not the day notice was given.';

-- ---------------------------------------------------------------------
-- 3 · The three predicates, each the SQL half of a TypeScript function of
--     the same shape in packages/domain/src/cap.ts.
--
-- Each takes the week rather than reading a clock, so a test can put the
-- week anywhere and the rule stays pure.
-- ---------------------------------------------------------------------

-- completionInForce(). Verified alone is not enough once a date is on
-- file: the release runs from the course completion date, and a week that
-- straddles it takes the lower cap like every other boundary in RULE-20.
create or replace function cap_completion_in_force(
  p_verified boolean, p_completion_date date, p_week_start date
) returns boolean language sql immutable as $$
  select case
    when not coalesce(p_verified, false)              then false
    when p_completion_date is null or p_week_start is null then true
    else p_week_start >= p_completion_date
  end
$$;

-- optOutInForce(). Two ways a recorded tick is not a valid opt-out.
create or replace function cap_optout_in_force(
  p_optout boolean, p_under18 boolean, p_cancelled_from date, p_week_start date
) returns boolean language sql immutable as $$
  select case
    when not coalesce(p_optout, false)  then false
    when coalesce(p_under18, false)     then false   -- cannot sign one at all
    when p_cancelled_from is null or p_week_start is null then true
    -- The ceiling returns at the END of the notice period, and a week
    -- straddling that takes the lower cap, so the WHOLE week must end
    -- before it for the opt-out still to be in force.
    else p_week_start + 6 < p_cancelled_from
  end
$$;

-- inTermVisaLimit(). The immigration condition, which no opt-out lifts.
create or replace function cap_in_term_visa_limit(
  p_visa_limited boolean, p_term_state text, p_completion_in_force boolean
) returns boolean language sql immutable as $$
  select coalesce(p_visa_limited, false)
     and not coalesce(p_completion_in_force, false)
     and p_term_state is distinct from 'holiday'
$$;

-- ---------------------------------------------------------------------
-- 4 · The rule itself. The branch ORDER is the rule, and it is the same
--     order as weeklyCap() in TypeScript:
--       0. right to work, which outranks everything;
--       1. the immigration hours condition, which beats the opt-out;
--       2. the opt-out, where it is valid;
--       3. 48, labelled by whatever produced it.
-- ---------------------------------------------------------------------
-- The four-argument form from 0008 must GO, not be replaced: a new
-- signature whose extra arguments all default overloads it rather than
-- replacing it, and then every existing four-argument call is ambiguous
-- ("could not choose a best candidate function"). Dropped here rather
-- than at the end so the rest of this migration only ever sees one.
-- Nothing depends on it: weekly_cap_for is redefined below, and a
-- `language sql` body quoted as a string carries no dependency record.
drop function if exists weekly_cap(boolean, text, boolean, boolean);

create or replace function weekly_cap(
  p_visa_limited               boolean,
  p_term_state                 text,     -- 'term' | 'holiday' | 'straddle' | 'none'
  p_completion_letter_verified boolean,
  p_optout_48h                 boolean,
  -- All optional: omitted, every one of them leaves the §4.4 behaviour
  -- exactly as it was before the completion-letter requirement landed.
  p_week_start                 date    default null,
  p_below_degree_level         boolean default false,
  p_completion_date            date    default null,
  p_visa_expiry                date    default null,
  p_optout_cancelled_from      date    default null,
  p_under18                    boolean default false
) returns cap_assessment language sql immutable as $$
  select case
    -- 0. No valid right to work, no rota. Only a week WHOLLY past expiry:
    --    a straddling week still has workable days, and can_roster()
    --    answers that per shift.
    when p_visa_expiry is not null and p_week_start is not null
         and p_week_start > p_visa_expiry
      then row(0, 'visa_expired_0'::text::cap_band)::cap_assessment

    -- 1. The immigration hours condition.
    when cap_in_term_visa_limit(
           p_visa_limited, p_term_state,
           cap_completion_in_force(p_completion_letter_verified, p_completion_date, p_week_start))
      then case when coalesce(p_below_degree_level, false)
                then row(10, 'student_term_10'::text::cap_band)::cap_assessment
                else row(20, 'student_term_20'::text::cap_band)::cap_assessment end

    -- 2. A valid opt-out removes the ceiling.
    when cap_optout_in_force(p_optout_48h, p_under18, p_optout_cancelled_from, p_week_start)
      then row(null, 'uncapped'::text::cap_band)::cap_assessment

    -- 3. 48 h, named by what produced it.
    when coalesce(p_visa_limited, false)
         and cap_completion_in_force(p_completion_letter_verified, p_completion_date, p_week_start)
      then row(48, 'graduated_48'::text::cap_band)::cap_assessment
    when coalesce(p_visa_limited, false)
      then row(48, 'student_holiday_48'::text::cap_band)::cap_assessment
    else row(48, 'standard_48'::text::cap_band)::cap_assessment
  end
$$;

-- ---------------------------------------------------------------------
-- 5 · The per-shift hard stop, mirroring canRoster().
--
-- The weekly cap cannot express this. A week straddling the expiry has
-- workable days before it and none after, so the cap for that week is a
-- real number while individual shifts inside it are still barred. The
-- expiry is INCLUSIVE: the last day the worker may work.
--
-- NOT yet wired into auto_assign_candidates — that changes the gate
-- contract the event board reads, so it belongs with the scheduling slice.
-- The weekly cap above already returns 0 for a week wholly past expiry,
-- which closes the common case; this closes the straddling week.
-- ---------------------------------------------------------------------
create or replace function can_roster(p_shift_date date, p_visa_expiry date)
returns boolean language sql immutable as $$
  select p_visa_expiry is null or p_shift_date <= p_visa_expiry
$$;

-- ---------------------------------------------------------------------
-- 6 · The worker-bound form, now passing the six dated facts.
--
-- Two of them are derived rather than stored, and deliberately:
--
--   completion_date falls back to graduated_at where the letter's own date
--   is not on file, so rows predating the new column keep the behaviour
--   they had — effective-dated from verification — rather than silently
--   releasing from the moment the box was ticked.
--
--   under18 comes from `dob`, the same source as the §2.1 age gate, and is
--   read at the START of the week: a worker who turns 18 mid-week was
--   under 18 for part of it, and RULE-20 takes the lower cap across every
--   other boundary, so it does here too.
-- ---------------------------------------------------------------------
create or replace function weekly_cap_for(p_staff uuid, p_date date)
returns cap_assessment language sql stable as $$
  select weekly_cap(
    s.rtw_branch is not distinct from 'international_student'::rtw_branch,
    cap_term_state(s.term_dates, p_date),
    s.graduated_at is not null,
    s.wtr_optout,
    cap_week_start(p_date),
    s.below_degree_level,
    coalesce(s.course_completion_date, s.graduated_at),
    s.right_to_work_until,
    s.optout_cancelled_at,
    s.dob > (cap_week_start(p_date) - interval '18 years')
  )
  from staff s where s.id = p_staff
$$;

comment on function weekly_cap(boolean, text, boolean, boolean, date, boolean, date, date, date, boolean) is
  'RULE-20 (§4.4-4.5 + completion-letter requirement). Held to packages/domain/src/cap.vectors.json by supabase/tests/090_weekly_cap.sql.';
comment on function can_roster(date, date) is
  'The per-shift right-to-work stop the weekly cap cannot express: expiry is inclusive.';
