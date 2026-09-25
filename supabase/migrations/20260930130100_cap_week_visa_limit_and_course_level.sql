-- =====================================================================
-- Fix round 29.09 · WP-F · RULE-20: the whole week, the visa's own limit,
-- and the course level the office confirms
-- (audit D35, D36, D32; ADR-0040;
--  docs/scope/university-completion-letter-requirement.pdf §1, §2.3, §3, §7)
--
-- D35 · A letter verified mid-week split the Mon-Sun week
-- ---------------------------------------------------------
-- weekly_cap_for() (20260922093100) passed `graduated_at <= p_date` as
-- "verified". Asked about the Monday and the Friday of the week a letter
-- was verified on the Wednesday, it answered 20 h and 48 h — one week,
-- two caps, and the rota guard summing a Mon-Sun week against whichever
-- day the shift happened to fall on. Every other straddle in RULE-20 (term
-- and holiday, the completion date, the end of an opt-out's notice) takes
-- the LOWER cap for the whole week; verification now does too.
--
-- weekly_cap() takes the verification day as a fact of its own
-- (p_verified_on) and compares it with the week's Monday, exactly as it
-- already compares the completion date. So the release runs from the first
-- Monday on or after the LATER of the verification and the completion
-- date — that day itself when it is a Monday — and a completion date long
-- past lifts nothing before the Monday after the letter is verified.
-- completion_effective_from() says the same date to the worker (CL2) and
-- the Student visa view. Both mirror packages/domain/src/cap.ts and
-- completionLetter.ts, and the shared vectors now carry `verifiedOn`.
--
-- D36 · A work or dependant visa's hours limit
-- ---------------------------------------------
-- staff.visa_weekly_hour_limit, optional, 1-48, captured by the office at
-- the right-to-work check (compliance_set_visa_hour_limit below; the
-- automated check's parsed limit is offered as the pre-filled value,
-- ADR-0025). weekly_cap() applies it AHEAD of the opt-out: it is an
-- immigration condition, not Working Time, so the opt-out cannot lift it.
-- Band `visa_limit` (20260930130000). Read only for the work_visa and
-- dependant_other branches, so a branch change (record_right_to_work_change)
-- ends it and a stale value can never cap a worker on another route.
--
-- D32 · The 10-hour band below degree level
-- ------------------------------------------
-- staff.below_degree_level existed (20260922093100) but nothing wrote it,
-- so the 10 h band was dormant. The office now sets it when it verifies a
-- student's right to work or term letter (compliance_set_below_degree_level),
-- audited. ADR-0040 records why the PDF (the later document: "20 hours
-- per week during term time (10 hours if studying below degree level)")
-- wins over the v1.5 changelog's "10 h variant not applied".
--
-- Also restated, from their latest definitions:
--   weekly_cap(10 args)         20260922093100 — now delegates to the
--                               12-argument form with the two new facts
--                               absent, so every existing caller and the 27
--                               original vectors answer exactly as before.
--   rota_guard_decide()         20260923100200 — visa_limit is a visa band:
--                               over it blocks, in warn mode too.
--   cap_band_label()            20260922093100 — N14's words for visa_limit.
--   record_right_to_work_change 20260923100100 — ends the visa limit with
--                               the branch that carried it.
--
-- Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The fact
-- ---------------------------------------------------------------------
alter table staff
  add column if not exists visa_weekly_hour_limit int;

alter table staff drop constraint if exists staff_visa_weekly_hour_limit_chk;
alter table staff add constraint staff_visa_weekly_hour_limit_chk
  check (visa_weekly_hour_limit is null or visa_weekly_hour_limit between 1 and 48);

comment on column staff.visa_weekly_hour_limit is
  'A weekly hours limit written on a work visa or a dependant visa, captured by the office at the right-to-work check (compliance_set_visa_hour_limit, audited). Null = no limit on the visa. RULE-20 applies it ahead of the 48-hour opt-out (an immigration condition), and only while the branch is work_visa or dependant_other.';

-- staff lost its table-wide SELECT in 20260923090000 / 20260923220000 and
-- is granted column by column; a new column is readable only once named.
grant select (visa_weekly_hour_limit) on table public.staff to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2 · RULE-20, twelve facts
--
-- Branch order is the rule, statement for statement with weeklyCap():
--   0. week wholly past the visa expiry          -> 0, visa_expired_0
--   1. Student visa condition in force           -> 10 or 20
--   1b. a work or dependant visa's hours limit   -> that limit, visa_limit
--   2. a valid, in-force opt-out                 -> no ceiling
--   3. otherwise                                 -> 48, labelled
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
  p_under18                    boolean,
  p_verified_on                date,     -- graduated_at; null = not dated
  p_visa_hour_limit            int       -- null = no limit on the visa
) returns cap_assessment language sql immutable
set search_path = public, extensions
as $$
  with in_force as (
    select
      -- completionInForce() in cap.ts: verified, never before the Monday
      -- on or after the verification (a week verified part-way through
      -- keeps the lower cap), and only from the completion date.
      coalesce(p_completion_letter_verified, false)
        and (p_week_start is null
             or ((p_verified_on is null or p_week_start >= p_verified_on)
                 and (p_completion_date is null or p_week_start >= p_completion_date)))
                                                                  as completion,
      -- optOutInForce() in cap.ts, unchanged.
      coalesce(p_optout_48h, false)
        and not coalesce(p_under18, false)
        and (p_optout_cancelled_from is null
             or p_week_start is null
             or p_week_start + 6 < p_optout_cancelled_from)       as optout
  )
  select case
    when p_visa_expiry is not null and p_week_start is not null
         and p_week_start > p_visa_expiry
      then row(0, 'visa_expired_0')::cap_assessment
    when coalesce(p_visa_limited, false) and not in_force.completion
         and p_term_state is distinct from 'holiday'
      then case when coalesce(p_below_degree_level, false)
                then row(10, 'student_term_10')::cap_assessment
                else row(20, 'student_term_20')::cap_assessment
           end
    when p_visa_hour_limit is not null
      then row(least(p_visa_hour_limit, 48), 'visa_limit')::cap_assessment
    when in_force.optout
      then row(null, 'uncapped')::cap_assessment
    when coalesce(p_visa_limited, false) and in_force.completion
      then row(48, 'graduated_48')::cap_assessment
    when coalesce(p_visa_limited, false)
      then row(48, 'student_holiday_48')::cap_assessment
    else row(48, 'standard_48')::cap_assessment
  end
  from in_force
$$;

comment on function weekly_cap(boolean, text, boolean, boolean, date, boolean, date, date, date, boolean, date, int) is
  'RULE-20 as a pure function of twelve facts. Branch order is the rule: visa expiry, the Student condition, a work or dependant visa''s own hours limit, the opt-out, then 48. The completion letter releases a week only from the Monday on or after both its verification and the course completion date. Held to packages/domain/src/cap.vectors.json alongside weeklyCap() in packages/domain/src/cap.ts.';

-- The ten-argument form of 20260922093100, kept: the two new facts absent
-- change nothing, which the 27 vectors that predate them assert.
create or replace function weekly_cap(
  p_visa_limited               boolean,
  p_term_state                 text,
  p_completion_letter_verified boolean,
  p_optout_48h                 boolean,
  p_week_start                 date,
  p_below_degree_level         boolean,
  p_completion_date            date,
  p_visa_expiry                date,
  p_optout_cancelled_from      date,
  p_under18                    boolean
) returns cap_assessment language sql immutable
set search_path = public, extensions
as $$
  select weekly_cap(p_visa_limited, p_term_state, p_completion_letter_verified, p_optout_48h,
                    p_week_start, p_below_degree_level, p_completion_date, p_visa_expiry,
                    p_optout_cancelled_from, p_under18, null::date, null::int)
$$;

comment on function weekly_cap(boolean, text, boolean, boolean, date, boolean, date, date, date, boolean) is
  'RULE-20 from the ten facts of 20260922093100, delegating to the twelve-argument weekly_cap() with no verification date and no visa hours limit.';

-- ---------------------------------------------------------------------
-- 3 · The cap for a real worker
--
-- graduated_at is now passed as a DATE, not compared with p_date here:
-- the pure function compares it with the week's Monday. The visa limit is
-- read only on the two branches that can carry one.
-- ---------------------------------------------------------------------
create or replace function weekly_cap_for(p_staff uuid, p_date date)
returns cap_assessment language sql stable
set search_path = public, extensions
as $$
  select weekly_cap(
    s.rtw_branch is not distinct from 'international_student'::rtw_branch,
    cap_term_state(s.term_dates, p_date),
    s.graduated_at is not null,
    s.wtr_optout,
    cap_week_start(p_date),
    s.below_degree_level,
    s.course_completion_date,
    s.right_to_work_until,
    s.wtr_optout_cancelled_from,
    cap_under_18(s.dob, cap_week_start(p_date)),
    s.graduated_at,
    case when s.rtw_branch in ('work_visa'::rtw_branch, 'dependant_other'::rtw_branch)
         then s.visa_weekly_hour_limit end
  )
  from staff s where s.id = p_staff
$$;

comment on function weekly_cap_for(uuid, date) is
  'RULE-20 for a worker in the Mon-Sun week containing p_date, read live off their row: one cap for all seven days (a completion letter verified mid-week releases from the next Monday). Null for a worker the caller cannot see.';

-- ---------------------------------------------------------------------
-- 4 · The date the worker is told
-- ---------------------------------------------------------------------
create or replace function public.completion_effective_from(p_completion date, p_verified date)
returns date
language sql
immutable
set search_path = public, extensions
as $$
  select case when l = cap_week_start(l) then l else cap_week_start(l) + 7 end
    from (select greatest(p_completion, p_verified) as l) x
$$;

comment on function public.completion_effective_from(date, date) is
  'The first day an approved completion letter lifts the cap: the first Monday on or after the later of the completion date and the verification date (that day itself when it is a Monday), so a Mon-Sun week is never split. Mirrors completionEffectiveFrom() in packages/domain/src/completionLetter.ts.';

-- ---------------------------------------------------------------------
-- 5 · The rota guard: a visa's own limit is a visa band
-- ---------------------------------------------------------------------
create or replace function public.rota_guard_decide(
  p_can_roster  boolean,
  p_cap_hours   int,
  p_band        cap_band,
  p_booked      numeric,
  p_shift_hours numeric,
  p_mode        text
) returns table (verdict text, reason text)
language sql
immutable
set search_path = public, extensions
as $$
  with f as (
    select not coalesce(p_can_roster, false)                              as rtw_stop,
           p_cap_hours is not null
             and p_shift_hours > greatest(0::numeric, p_cap_hours - coalesce(p_booked, 0))
                                                                          as over,
           p_band in ('student_term_20', 'student_term_10', 'visa_limit', 'visa_expired_0') as visa_band
  )
  select case when f.rtw_stop then 'block'
              when not f.over then 'ok'
              when f.visa_band then 'block'
              when p_mode = 'warn' then 'warn'
              else 'block' end,
         case when f.rtw_stop then 'rtw_expired'
              when not f.over then null
              when f.visa_band then 'visa_cap'
              else 'wtr_cap' end
    from f
$$;

comment on function public.rota_guard_decide(boolean, int, cap_band, numeric, numeric, text) is
  'The rota guard decision: right-to-work stop → block; within the cap → ok; over a visa band (Student term time, a work or dependant visa''s own limit) → block; over a Working Time 48 → the configured mode. Mirrors rotaGuardVerdict() in packages/domain/src/rotaGuard.ts, held to rotaGuard.vectors.json.';

-- ---------------------------------------------------------------------
-- 6 · N14's words for the new band
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
    when 'visa_limit'         then 'the hours limit on your visa'
    else p_band::text
  end
$$;

-- ---------------------------------------------------------------------
-- 7 · D32 · The course level, confirmed by the office
--
-- A reviewer field: set when the office verifies a student's right to
-- work (visa document, status document, share code report) or their term
-- letter — the two documents that say what the course is. Audited
-- (rtw.conditions), and the cap it produces is returned so the screen can
-- say what changed. International student branch only: the term-time
-- condition does not exist on any other route.
-- ---------------------------------------------------------------------
create or replace function public.compliance_set_below_degree_level(
  p_staff uuid,
  p_below boolean
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reviewer uuid := assert_reviewer();
  s          staff;
  v_today    date := (now() at time zone 'Europe/London')::date;
  v_cap      cap_assessment;
begin
  if p_below is null then
    raise exception 'value_required' using errcode = '22023';
  end if;
  select * into s from staff where id = p_staff for update;
  if s.id is null then
    raise exception 'unknown_staff' using errcode = 'P0002';
  end if;
  if s.status in ('rejected', 'removed') or s.removed_at is not null then
    raise exception 'not_reviewable: %', s.status using errcode = 'P0001';
  end if;
  if s.rtw_branch is distinct from 'international_student' then
    raise exception 'not_student_visa' using errcode = 'P0001';
  end if;

  if s.below_degree_level is distinct from p_below then
    update staff set below_degree_level = p_below where id = s.id;
    insert into audit_log (at, actor, action, entity, entity_id, data)
    values (now(), v_reviewer, 'rtw.conditions', 'staff', s.id,
            jsonb_build_object(
              'staffId',               s.id,
              'employeeId',            s.employee_id,
              'branch',                s.rtw_branch,
              'field',                 'below_degree_level',
              'belowDegreeLevelFrom',  s.below_degree_level,
              'belowDegreeLevelTo',    p_below,
              'actorName',             (select full_name from profiles where id = v_reviewer)));
  end if;

  select * into v_cap from weekly_cap_for(s.id, v_today);
  return jsonb_build_object('ok', true, 'belowDegreeLevel', p_below,
                            'changed', s.below_degree_level is distinct from p_below,
                            'capHours', v_cap.cap_hours, 'band', v_cap.band::text);
end $$;

comment on function public.compliance_set_below_degree_level(uuid, boolean) is
  'D32 / ADR-0040: the office confirms, when it verifies a student''s right to work or term letter, that the course is below degree level — the Student condition is then 10 h a week in term time, not 20. Admin only; International student branch only; audited as rtw.conditions.';

-- ---------------------------------------------------------------------
-- 8 · D36 · A work or dependant visa's hours limit
--
-- Null clears it. 1-48: a limit above the Working Time 48 is no limit the
-- rota can apply. Audited as rtw.conditions.
-- ---------------------------------------------------------------------
create or replace function public.compliance_set_visa_hour_limit(
  p_staff uuid,
  p_hours int
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reviewer uuid := assert_reviewer();
  s          staff;
  v_today    date := (now() at time zone 'Europe/London')::date;
  v_cap      cap_assessment;
begin
  select * into s from staff where id = p_staff for update;
  if s.id is null then
    raise exception 'unknown_staff' using errcode = 'P0002';
  end if;
  if s.status in ('rejected', 'removed') or s.removed_at is not null then
    raise exception 'not_reviewable: %', s.status using errcode = 'P0001';
  end if;
  if s.rtw_branch is null or s.rtw_branch not in ('work_visa', 'dependant_other') then
    raise exception 'no_visa_hour_limit_on_branch: %', coalesce(s.rtw_branch::text, 'no branch')
      using errcode = 'P0001';
  end if;
  if p_hours is not null and p_hours not between 1 and 48 then
    raise exception 'visa_hour_limit_invalid' using errcode = '22023';
  end if;

  if s.visa_weekly_hour_limit is distinct from p_hours then
    update staff set visa_weekly_hour_limit = p_hours where id = s.id;
    insert into audit_log (at, actor, action, entity, entity_id, data)
    values (now(), v_reviewer, 'rtw.conditions', 'staff', s.id,
            jsonb_strip_nulls(jsonb_build_object(
              'staffId',            s.id,
              'employeeId',         s.employee_id,
              'branch',             s.rtw_branch,
              'field',              'visa_weekly_hour_limit',
              'visaHourLimitFrom',  s.visa_weekly_hour_limit,
              'visaHourLimitTo',    p_hours,
              'actorName',          (select full_name from profiles where id = v_reviewer))));
  end if;

  select * into v_cap from weekly_cap_for(s.id, v_today);
  return jsonb_build_object('ok', true, 'visaHourLimit', p_hours,
                            'changed', s.visa_weekly_hour_limit is distinct from p_hours,
                            'capHours', v_cap.cap_hours, 'band', v_cap.band::text);
end $$;

comment on function public.compliance_set_visa_hour_limit(uuid, int) is
  'D36: the weekly hours limit written on a work or dependant visa, captured by the office at the right-to-work check (null clears it). RULE-20 applies it ahead of the 48-hour opt-out. Admin only; work_visa / dependant_other only; audited as rtw.conditions.';

-- ---------------------------------------------------------------------
-- 9 · A new right-to-work route ends the old route's conditions
--
-- Restated from 20260923100100. Added: visa_weekly_hour_limit goes with a
-- branch that cannot carry one, as below_degree_level already did; and the
-- two are in the audit row.
-- ---------------------------------------------------------------------
create or replace function public.record_right_to_work_change(
  p_staff      uuid,
  p_branch     rtw_branch,
  p_until      date,
  p_share_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reviewer uuid := assert_reviewer();
  s          staff;
begin
  select * into s from staff where id = p_staff for update;
  if s.id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if s.status = 'removed' or s.removed_at is not null then
    raise exception 'not_reviewable: removed' using errcode = 'P0001';
  end if;
  if p_branch is null then
    raise exception 'branch_required' using errcode = 'P0001';
  end if;

  update staff
     set rtw_branch = p_branch,
         right_to_work_until = p_until,
         share_code = coalesce(nullif(upper(replace(coalesce(p_share_code, ''), ' ', '')), ''),
                               share_code),
         below_degree_level = case when p_branch = 'international_student'
                                   then below_degree_level else false end,
         visa_weekly_hour_limit = case when p_branch in ('work_visa', 'dependant_other')
                                       then visa_weekly_hour_limit end
   where id = p_staff;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), v_reviewer, 'rtw.changed', 'staff', p_staff,
          jsonb_strip_nulls(jsonb_build_object(
            'staffId', p_staff, 'employeeId', s.employee_id,
            'fromBranch', s.rtw_branch, 'toBranch', p_branch,
            'fromUntil', s.right_to_work_until, 'toUntil', p_until,
            'belowDegreeLevelFrom', case when s.below_degree_level then true end,
            'visaHourLimitFrom', s.visa_weekly_hour_limit,
            'actorName', (select full_name from profiles where id = v_reviewer))));

  return jsonb_build_object('ok', true, 'branch', p_branch::text, 'until', p_until,
                            'studentLogicEnded', s.rtw_branch = 'international_student'
                                                 and p_branch <> 'international_student');
end $$;

comment on function public.record_right_to_work_change(uuid, rtw_branch, date, text) is
  'Completion letter requirement §7: a new right-to-work check (e.g. Student → Graduate or Skilled Worker) mid-employment. Ends the Student visa condition (RULE-20 keys on rtw_branch), the term-letter ladder and a work or dependant visa''s hours limit when the new route cannot carry one; leaves the 48-hour Working Time rules and the opt-out in force. Audited.';

-- ---------------------------------------------------------------------
-- 10 · Privileges
--
-- The cap family keeps 0008's shape (pure functions, invoker rights, the
-- default EXECUTE), and create or replace keeps what the replaced ones
-- had. The new twelve-argument weekly_cap() is pure too, and new, so it
-- follows the fix round's rule for a new function: no EXECUTE for public
-- or anon. The two setters are the office's: admin-checked inside.
-- ---------------------------------------------------------------------
revoke execute on function weekly_cap(boolean, text, boolean, boolean, date, boolean, date, date, date, boolean, date, int) from public, anon;
grant  execute on function weekly_cap(boolean, text, boolean, boolean, date, boolean, date, date, date, boolean, date, int) to authenticated, service_role;
revoke execute on function public.compliance_set_below_degree_level(uuid, boolean) from public, anon;
revoke execute on function public.compliance_set_visa_hour_limit(uuid, int) from public, anon;
grant  execute on function public.compliance_set_below_degree_level(uuid, boolean) to authenticated, service_role;
grant  execute on function public.compliance_set_visa_hour_limit(uuid, int) to authenticated, service_role;
revoke execute on function public.record_right_to_work_change(uuid, rtw_branch, date, text) from public, anon;
grant  execute on function public.record_right_to_work_change(uuid, rtw_branch, date, text) to authenticated, service_role;
