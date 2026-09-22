-- =====================================================================
-- RULE-20 · bring the SQL half back level with the TypeScript half
--
-- The University Completion Letter Requirement (docs/scope/) added six
-- dated facts to the cap: the week being asked about, below-degree-level
-- study, the course completion date, right-to-work expiry, opt-out
-- cancellation, and whether the worker is under 18. `packages/domain`
-- grew all six. `weekly_cap()` did not, and still took four arguments.
--
-- That was not only a red suite. `weekly_cap_hours()` is what auto-assign
-- reads for its hours gate (§3.4), so the database was answering a
-- different question from the application:
--
--   * An UNDER-18 with a recorded 48-hour opt-out tick came back
--     `uncapped` — no weekly ceiling at all — where the rule says a minor
--     cannot sign one, so the tick is not valid and the 48-hour ceiling
--     stands. A minor could be offered unlimited hours.
--   * A worker past right-to-work expiry came back 48 rather than 0.
--   * Below-degree-level study came back 20 rather than 10.
--   * A completion letter released the cap from the day a manager
--     verified it rather than from the course completion date, and a
--     cancelled opt-out never came back at all.
--
-- The shared vectors exist to make exactly this impossible, and they did
-- catch it — but only after it shipped, because 090's call site passed
-- four columns and silently dropped the other six rather than failing.
-- It now passes every column, so the next divergence fails on arity.
--
-- `weekly_cap()` stays a PURE function of its inputs, which is what lets
-- the vectors run against it directly. The order of the branches IS the
-- rule, and it is the order `weeklyCap()` uses in cap.ts:
--
--   0. right to work — outranks everything, including a completion letter
--   1. the Student visa hours condition — beats the opt-out and the calendar
--   2. the opt-out — lifts the ceiling everywhere else
--   3. 48 h, labelled by whatever produced it
--
-- Every new parameter defaults to the value that reproduces the old
-- behaviour, so the four-argument call sites in earlier migrations and
-- tests keep working and keep meaning what they meant.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Whether the completion letter has taken effect for this week.
--
-- The release runs from the course completion date, not from the day it
-- was verified: a letter issued before the final exam carries a future
-- date and must not lift the cap yet (requirement §2.3, §7). A week that
-- straddles that date takes the LOWER cap — the same principle §4.4
-- already applies to a week straddling term and holiday, and the
-- conservative reading, because the worker was still mid-course for part
-- of it.
--
-- With no date on file this falls back to the flag alone, which is the
-- §4.5 behaviour that shipped before the requirement landed.
-- ---------------------------------------------------------------------
create or replace function cap_completion_in_force(
  p_completion_letter_verified boolean,
  p_completion_date            date default null,
  p_week_start                 date default null
) returns boolean language sql immutable set search_path = public as $$
  select case
    when not coalesce(p_completion_letter_verified, false) then false
    when p_completion_date is null or p_week_start is null then true
    else p_week_start >= p_completion_date
  end
$$;

comment on function cap_completion_in_force(boolean, date, date) is
  'RULE-20 / University Completion Letter Requirement §2.3: the release runs from the course completion date, and a straddling week takes the lower cap. Mirrors completionInForce() in packages/domain/cap.ts.';

-- ---------------------------------------------------------------------
-- Whether a signed opt-out is actually in force for this week.
--
-- Two ways a recorded tick is not a valid opt-out:
--   * the worker is under 18 and cannot sign one at all (requirement §2.4);
--   * it was cancelled, and the notice period has ended. The ceiling
--     returns from the END of the notice period, not the day notice was
--     given, and a straddling week takes the lower cap as everywhere else.
-- ---------------------------------------------------------------------
create or replace function cap_optout_in_force(
  p_optout_48h            boolean,
  p_under18               boolean default false,
  p_optout_cancelled_from date    default null,
  p_week_start            date    default null
) returns boolean language sql immutable set search_path = public as $$
  select case
    when not coalesce(p_optout_48h, false)  then false
    when coalesce(p_under18, false)         then false
    when p_optout_cancelled_from is null
      or p_week_start is null               then true
    else (p_week_start + 6) < p_optout_cancelled_from
  end
$$;

comment on function cap_optout_in_force(boolean, boolean, date, date) is
  'RULE-20 / University Completion Letter Requirement §2.4: an under-18 cannot sign a 48-hour opt-out, and a cancelled one stops at the end of the notice period. Mirrors optOutInForce() in packages/domain/cap.ts.';

-- ---------------------------------------------------------------------
-- RULE-20 itself.
--
-- Dropped first, deliberately. `create or replace` matches on the full
-- argument list, so adding six parameters would have created a SECOND
-- weekly_cap alongside the four-argument one rather than replacing it —
-- and every existing four-argument call site, including four assertions
-- in 090, would have gone on resolving to the old wrong function while
-- this file sat there looking like the fix. Dropping it means those call
-- sites now reach the new function through its defaults.
--
-- Safe to drop: SQL function bodies given as a string are not dependency
-- tracked, so weekly_cap_for() does not hold it open.
-- ---------------------------------------------------------------------
drop function if exists weekly_cap(boolean, text, boolean, boolean);

create or replace function weekly_cap(
  p_visa_limited               boolean,
  p_term_state                 text,     -- 'term' | 'holiday' | 'straddle' | 'none'
  p_completion_letter_verified boolean,
  p_optout_48h                 boolean,
  p_week_start                 date    default null,
  p_below_degree_level         boolean default false,
  p_completion_date            date    default null,
  p_visa_expiry                date    default null,
  p_optout_cancelled_from      date    default null,
  p_under18                    boolean default false
) returns cap_assessment language sql immutable set search_path = public as $$
  select case
    -- 0. Right to work outranks everything, including a completion letter:
    --    no valid RTW, no rota. Only a week WHOLLY past expiry is zero — a
    --    week that straddles expiry still has workable days in it.
    when p_visa_expiry is not null and p_week_start is not null
         and p_week_start > p_visa_expiry
      then row(0, 'visa_expired_0')::cap_assessment

    -- 1. The Student visa hours condition: a student-visa worker whose
    --    course has not completed, in a week that is not wholly holiday.
    --    A straddling week counts (§4.4). No opt-out lifts this: the
    --    opt-out is Working Time Regulations, the 20 is immigration.
    when p_visa_limited
         and not cap_completion_in_force(p_completion_letter_verified,
                                         p_completion_date, p_week_start)
         and p_term_state is distinct from 'holiday'
      then case when coalesce(p_below_degree_level, false)
                  then row(10, 'student_term_10')::cap_assessment
                else row(20, 'student_term_20')::cap_assessment end

    -- 2. No visa condition in force, so the opt-out removes the ceiling.
    when cap_optout_in_force(p_optout_48h, p_under18,
                             p_optout_cancelled_from, p_week_start)
      then row(null, 'uncapped')::cap_assessment

    -- 3. 48 h, labelled by whatever produced it.
    when p_visa_limited
         and cap_completion_in_force(p_completion_letter_verified,
                                     p_completion_date, p_week_start)
      then row(48, 'graduated_48')::cap_assessment
    when p_visa_limited
      then row(48, 'student_holiday_48')::cap_assessment
    else row(48, 'standard_48')::cap_assessment
  end
$$;

comment on function weekly_cap(boolean, text, boolean, boolean, date, boolean, date, date, date, boolean) is
  'RULE-20 (§4.4–4.5) plus the University Completion Letter Requirement. A pure function of its inputs so the shared vectors in packages/domain/src/cap.vectors.json can run against it directly — supabase/tests/090_weekly_cap.sql passes every column, and weeklyCap() in cap.ts must give the same answer for every case.';

-- ---------------------------------------------------------------------
-- The same rule for a worker on a date.
--
-- This is the impure half, and it is honest about what it can source.
-- `staff` carries a date of birth, so under-18 is read live from it —
-- which is the defect that mattered: the hours gate auto-assign reads no
-- longer tells a minor they have no ceiling.
--
-- NOT yet sourced, because no column holds the fact:
--
--   below_degree_level     the requirement's 10-hour condition. Needs a
--                          field on the Right to Work record saying what
--                          level the course is.
--   completion_date        `compliance_docs.completion_date` exists, but
--                          which verified document is authoritative is a
--                          compliance decision, not one to make here.
--   visa_expiry            likewise `compliance_docs.expiry_date` for the
--                          right-to-work document.
--   optout_cancelled_from  no column at all; §2.4's notice period is not
--                          recorded anywhere yet.
--
-- Each of those defaults to the value that reproduces today's behaviour,
-- so this wrapper is exactly as correct as it was before plus the
-- under-18 fix — never quietly wrong in a new way. Wiring the remaining
-- four is `compliance`'s, and docs/13 carries the prompt.
-- ---------------------------------------------------------------------
create or replace function weekly_cap_for(p_staff uuid, p_date date)
returns cap_assessment language sql stable set search_path = public as $$
  select weekly_cap(
    s.rtw_branch is not distinct from 'international_student'::rtw_branch,
    cap_term_state(s.term_dates, p_date),
    s.graduated_at is not null and s.graduated_at <= p_date,
    s.wtr_optout,
    cap_week_start(p_date),
    false,      -- below_degree_level: not on file (see above)
    null,       -- completion_date:    not sourced (see above)
    null,       -- visa_expiry:        not sourced (see above)
    null,       -- optout_cancelled_from: no column (see above)
    -- Under 18 on the date being asked about. A null date of birth is not
    -- treated as a minor: /apply collects one and Right to Work supplies
    -- it, so null means "not known here", and guessing either way would
    -- be worse than the explicit false.
    s.dob is not null and s.dob > (p_date - interval '18 years')::date
  )
  from staff s where s.id = p_staff
$$;

comment on function weekly_cap_for(uuid, date) is
  'RULE-20 for a worker on a date. Read live: nothing is cached, so a worker whose holiday started overnight is in the 48 h band the same morning (§4.4). Under-18 comes from staff.dob; the other four dated facts from the University Completion Letter Requirement have no column yet and default to today''s behaviour.';
