-- =====================================================================
-- Migration 0006 · the calculated weekly cap, RULE-20 (Scope §4.4–4.5)
--
-- Why this exists
-- ---------------
-- 0001_init.sql shipped a placeholder `weekly_cap_hours(staff, date)`. It
-- was wrong in three ways and short of a fourth thing the rule needs:
--
--   1. It let the 48-hour opt-out return "no ceiling" for a GRADUATED
--      student but not for a student in a university holiday, and it
--      returned no band at all — so it could not be held to
--      packages/domain/src/cap.vectors.json case for case.
--   2. `s.rtw_branch <> 'international_student'` is NULL, not true, for a
--      candidate whose Right to Work branch is not set yet, and NULL for a
--      staff id that does not exist. Both fell through to the term loop and
--      came back capped at 20 h. `is distinct from` fixes it.
--   3. `graduated_at is not null and s.graduated_at <= p_date` sat on the
--      right of an `or` with no parentheses. It read correctly by operator
--      precedence, but only by accident.
--
--   4. The rule also has an hours-SUMMING side that the band resolver does
--      not do: auto-assign's hard gate and accept_invite both have to ask
--      "has this worker any room left in this Mon-Sun week, and would this
--      shift take them over?" (§3.4). That is `weekly_booked_hours`,
--      `weekly_hours_remaining` and `weekly_cap_would_breach` below.
--
-- The shape of the rule (§4.4 table)
-- ----------------------------------
--   Not on a student visa                 48 h — or no ceiling with the opt-out
--   Student, week inside a holiday range  48 h — or no ceiling with the opt-out
--   Student, week touching term time      20 h — the opt-out CANNOT lift this,
--                                         it is a visa condition
--   Student, completion letter verified   48 h permanently, term dates no
--                                         longer apply — or no ceiling with
--                                         the opt-out (§4.5)
--
-- A Mon-Sun week that straddles term and holiday takes the LOWER cap: "a
-- week in which term restarts on the Thursday is a 20-hour week, not a
-- 48-hour one". There is no override and no judgement call.
--
-- The cap is CALCULATED, never stored and never typed by a manager, so
-- there is no column to write and no cron to flip: the moment a holiday
-- range begins, the number these functions return changes on its own.
--
-- `staff.term_dates` holds the HOLIDAY ranges read off the University Term
-- Dates Letter (§2.6) — a date inside a range is holiday, a date outside
-- every range is term time. A worker with no ranges on file therefore reads
-- as term time, which is the safe reading; in practice a student whose term
-- letter is missing or expired is already blocked and cannot be booked at
-- all (§4.2, §4.3), so the cap question does not arise for them.
--
-- Held to the same vectors as packages/domain/src/cap.ts:
-- supabase/tests/100_weekly_cap.sql runs cap.vectors.json against
-- `weekly_cap()`, Vitest runs it against `weeklyCap()`.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Band. Mirrors CapBand in packages/domain/src/cap.ts — an enum rather
-- than text so that a band added on one side fails loudly on the other.
-- ---------------------------------------------------------------------
create type cap_band as enum (
  'student_term_20',    -- 20 h, visa condition, opt-out cannot lift it
  'student_holiday_48', -- 48 h, week wholly inside the letter's holiday ranges
  'graduated_48',       -- 48 h, completion letter verified (§4.5)
  'standard_48',        -- 48 h, no visa limit
  'uncapped'            -- no ceiling: 48-hour opt-out and no visa limit in force
);

-- cap_hours null = no ceiling. Never 0, never a sentinel.
create type cap_assessment as (cap_hours int, band cap_band);

-- ---------------------------------------------------------------------
-- The Mon-Sun week (§4.4). date_trunc('week') is ISO, so it lands on the
-- Monday. Dates are plain dates, so there is no zone to apply here; the
-- zone matters when a timestamptz is bucketed into a week, which is what
-- weekly_booked_hours does below.
-- ---------------------------------------------------------------------
create or replace function cap_week_start(p_date date) returns date
language sql immutable strict as $$
  select date_trunc('week', p_date)::date
$$;

-- ---------------------------------------------------------------------
-- Where the Mon-Sun week containing p_date sits against the HOLIDAY
-- ranges off the term letter. 'holiday' only when every one of the seven
-- days is inside a range; 'term' when none is; 'straddle' in between,
-- which weekly_cap() then resolves to the lower cap.
--
-- Mirrors resolveTermState() in packages/domain/src/cap.ts. Never returns
-- 'none' — that is the TypeScript side's marker for a worker the term
-- letter does not apply to, and weekly_cap() treats it the same as 'term'.
-- ---------------------------------------------------------------------
create or replace function cap_term_state(p_holidays daterange[], p_date date)
returns text language sql immutable as $$
  with days as (
    select generate_series(cap_week_start(p_date), cap_week_start(p_date) + 6, interval '1 day')::date as d
  ), marked as (
    select exists (
      select 1 from unnest(coalesce(p_holidays, '{}'::daterange[])) r where days.d <@ r
    ) as in_holiday
    from days
  )
  select case when bool_and(in_holiday) then 'holiday'
              when bool_or(in_holiday)  then 'straddle'
              else 'term' end
  from marked
$$;

-- ---------------------------------------------------------------------
-- RULE-20 itself, as a pure function of the four inputs so that the
-- shared vectors can be run against it directly. The order of the three
-- branches IS the rule:
--   1. the visa condition, which beats the opt-out and the calendar alike;
--   2. the opt-out, which lifts the ceiling everywhere else;
--   3. 48 h, labelled by whatever produced it.
-- ---------------------------------------------------------------------
create or replace function weekly_cap(
  p_visa_limited               boolean,
  p_term_state                 text,     -- 'term' | 'holiday' | 'straddle' | 'none'
  p_completion_letter_verified boolean,
  p_optout_48h                 boolean
) returns cap_assessment language sql immutable as $$
  select case
    -- 1. Student visa, not graduated, week is not wholly holiday.
    when p_visa_limited and not p_completion_letter_verified
         and p_term_state is distinct from 'holiday'
      then row(20, 'student_term_20')::cap_assessment
    -- 2. No visa condition in force, so the opt-out removes the ceiling.
    when p_optout_48h
      then row(null, 'uncapped')::cap_assessment
    -- 3. 48 h.
    when p_visa_limited and p_completion_letter_verified
      then row(48, 'graduated_48')::cap_assessment
    when p_visa_limited
      then row(48, 'student_holiday_48')::cap_assessment
    else row(48, 'standard_48')::cap_assessment
  end
$$;

-- ---------------------------------------------------------------------
-- The same rule for a worker on a date. Read live: nothing is cached, so
-- a worker whose holiday started overnight is in the 48 h band the same
-- morning without anyone touching their profile (§4.4).
--
-- graduated_at <= p_date, never backdated: §4.5 is explicit that the
-- change is effective-dated from verification and that hours already
-- worked under the old cap are untouched.
-- ---------------------------------------------------------------------
create or replace function weekly_cap_for(p_staff uuid, p_date date)
returns cap_assessment language sql stable as $$
  select weekly_cap(
    s.rtw_branch is not distinct from 'international_student'::rtw_branch,
    cap_term_state(s.term_dates, p_date),
    s.graduated_at is not null and s.graduated_at <= p_date,
    s.wtr_optout
  )
  from staff s where s.id = p_staff
$$;

-- Null for an unknown worker, and null cap_hours for no ceiling — callers
-- must tell the two apart, which is why the band is available separately.
create or replace function weekly_cap_hours(p_staff uuid, p_date date)
returns int language sql stable as $$
  select c.cap_hours from weekly_cap_for(p_staff, p_date) c
$$;

create or replace function weekly_cap_band(p_staff uuid, p_date date)
returns cap_band language sql stable as $$
  select c.band from weekly_cap_for(p_staff, p_date) c
$$;

-- ---------------------------------------------------------------------
-- The hours-summing side.
--
-- Hours already committed in the Mon-Sun week containing p_date. Counted
-- from the SCHEDULED role-section window (RULE-18: never the event
-- window), because the cap gates bookings before anyone works them.
--
-- Which bookings count: confirmed, worked and closed — what the worker has
-- actually committed to. An invitation is not a commitment (a worker may
-- hold several at once and auto-assign never withdraws them, §3.4), and a
-- Radar application is not one either, so neither is counted until it
-- becomes confirmed.
--
-- A shift belongs to the week its START falls in, evaluated in
-- Europe/London (§1.8) — an overnight shift is not split across two weeks.
-- ---------------------------------------------------------------------
create or replace function weekly_booked_hours(p_staff uuid, p_date date)
returns numeric language sql stable as $$
  select coalesce(sum(extract(epoch from (sr.ends_at - sr.starts_at)) / 3600.0), 0)::numeric
  from bookings b
  join shift_requirements sr on sr.id = b.shift_id
  where b.staff_id = p_staff
    and b.status in ('confirmed', 'worked', 'closed')
    and (sr.starts_at at time zone 'Europe/London')::date
        between cap_week_start(p_date) and cap_week_start(p_date) + 6
$$;

-- Hours still available this week. Null = no ceiling, NOT "none left" —
-- mirrors remainingHours() in packages/domain/src/cap.ts. Never negative:
-- a worker already over the line (a cap that dropped under existing
-- bookings) has 0 left, not a negative allowance.
create or replace function weekly_hours_remaining(p_staff uuid, p_date date)
returns numeric language sql stable as $$
  select case when c.cap_hours is null then null
              else greatest(0::numeric, c.cap_hours - weekly_booked_hours(p_staff, p_date))
         end
  from weekly_cap_for(p_staff, p_date) c
$$;

-- ---------------------------------------------------------------------
-- The hard gate (§3.4, RULE-20): would taking this shift put the worker
-- over their cap for the Mon-Sun week the shift starts in? Auto-assign
-- drops the worker from the pool outright, accept_invite refuses, and the
-- Staff App shows the per-week reason rather than a status change (§10.4).
--
-- False for an uncapped worker and false for an unknown shift; a caller
-- that needs "does this shift exist" asks shift_requirements.
-- ---------------------------------------------------------------------
create or replace function weekly_cap_would_breach(p_staff uuid, p_shift uuid)
returns boolean language sql stable as $$
  select coalesce(
    extract(epoch from (sr.ends_at - sr.starts_at)) / 3600.0
      > weekly_hours_remaining(p_staff, (sr.starts_at at time zone 'Europe/London')::date),
    false)
  from shift_requirements sr
  where sr.id = p_shift
$$;

comment on function weekly_cap_hours(uuid, date) is
  'RULE-20 (§4.4-4.5): 20 / 48 / null (no ceiling). Calculated, never stored.';
comment on function weekly_cap_would_breach(uuid, uuid) is
  'RULE-20 hard gate for auto-assign and accept_invite (§3.4).';
