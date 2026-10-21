-- =====================================================================
-- 20261022200100 · ADR-0184, two limits on the overrun (QA review of
--                  20261022200000)
--
-- 1 · The paid end is capped at the scheduled end + 4 h. THC's rule is
--     for sign-outs "between 16:15 and 20:00"; past end + 4 h RULE-02's
--     No check-out takes over. A worker's own press cannot be later than
--     that (check-out locks), but a finish the office TYPES — resolving a
--     No check-out, or a No-show's "Get back" with a finish — has no upper
--     bound (§9.5), so a typo would be paid and invoiced in full. It is
--     still accepted and recorded; it is not paid beyond end + 4 h.
--
-- 2 · Effective date. The paid-to-the-actual-finish rule applies only to
--     role sections whose scheduled END is at or after 21 October 2026,
--     00:00 Europe/London = 2026-10-20 23:00:00+00 (BST). An earlier
--     section keeps the rule it was worked under — paid to the scheduled
--     end — so no history is re-priced. The literal below is the one
--     place SQL holds it; packages/domain's OVERRUN_PAID_FROM is the
--     other, and pay.vectors.json holds both to it (supabase/tests/070).
--
-- payable_minutes() and break_window_minutes() are restated whole (their
-- bodies are short and were restated in 20261022200000); late_check_outs()
-- leaves out sections before the cutoff, whose late sign-outs were never
-- paid to the finish. The flag itself (lateCheckOutFlag, the monitor's red
-- pill) is the clock, unchanged on both sides of the cutoff.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The pay window
-- ---------------------------------------------------------------------
create or replace function payable_minutes(
  p_starts_at         timestamptz,
  p_ends_at           timestamptz,
  p_check_in_at       timestamptz,
  p_check_out_at      timestamptz,
  p_unpaid_break_min  int     default 0,
  p_left_early        boolean default false,
  p_no_check_out      text    default 'none'      -- none | unresolved | resolved
) returns jsonb language plpgsql immutable as $$
declare
  v_late    boolean;
  v_from    timestamptz;
  v_to      timestamptz;
  v_worked  int;
  v_overrun int;
  v_floor   boolean;
  v_payable int;
begin
  if p_check_out_at is null or p_check_in_at is null then
    return jsonb_build_object('status','undetermined','payableMin',null,'workedMin',null,
      'floorApplied',false,'lateCheckOutFlag',false,'overrunMin',null);
  end if;

  -- §9.5's flag: more than 15 minutes past the scheduled end.
  v_late := extract(epoch from (p_check_out_at - p_ends_at)) / 60 > 15;

  v_from := greatest(p_check_in_at, p_starts_at);  -- early is not paid; late is paid from the press
  -- ADR-0184: a late sign-out is paid to the actual finish, at most end + 4 h,
  -- on a section ending on or after 21.10.2026 00:00 UK (OVERRUN_PAID_FROM
  -- in packages/domain/src/pay.ts). Otherwise, never past the scheduled end.
  v_to   := case when v_late and p_ends_at >= timestamptz '2026-10-20 23:00:00+00'
                 then least(p_check_out_at, p_ends_at + interval '4 hours')
                 else least(p_check_out_at, p_ends_at) end;

  -- [check-in, check-out] ∩ [start, end] is empty: there is no shift to pay,
  -- and the floor must not manufacture one (RULE-02, RULE-14). A check-in at
  -- or after the end is empty too, however late the check-out.
  if v_to <= v_from or v_from >= p_ends_at then
    return jsonb_build_object('status','undetermined','payableMin',null,'workedMin',null,
      'floorApplied',false,'lateCheckOutFlag',false,'overrunMin',null);
  end if;

  -- Whole minutes, so a timesheet, the app and the payroll export cannot
  -- disagree in the seconds (and so SQL and TypeScript round identically).
  v_worked := round(greatest(0, greatest(0, extract(epoch from (v_to - v_from)) / 60)
                                - coalesce(p_unpaid_break_min, 0)))::int;

  -- The overrun: what is paid past the scheduled end. Breaks come off the
  -- main part; the overrun gives way only to breaks longer than all of it.
  v_overrun := case when v_to > p_ends_at
                    then least(v_worked, round(extract(epoch from (v_to - p_ends_at)) / 60)::int)
                    else 0 end;

  v_floor   := not p_left_early and coalesce(p_no_check_out,'none') <> 'unresolved';
  v_payable := case when v_floor then greatest(v_worked, 240) else v_worked end;

  return jsonb_build_object(
    'status','settled',
    'payableMin', v_payable,
    'workedMin',  v_worked,
    'floorApplied', v_floor and v_payable > v_worked,
    'lateCheckOutFlag', v_late,
    'overrunMin', v_overrun);
end $$;

-- create or replace drops the pinned search_path; put it back.
alter function public.payable_minutes(timestamptz, timestamptz, timestamptz, timestamptz, integer, boolean, text)
  set search_path = public, extensions;

comment on function payable_minutes is
  'RULE-01/02/14 pay window. Paid from the later of the scheduled start and the actual check-in (ADR-0095); to the scheduled end for a check-out up to end+15, and — on a section ending on or after 21.10.2026 00:00 UK — to the actual finish for one later than that, at most end+4 h, whose minutes past the end are overrunMin (ADR-0184). Mirrored by payableMinutes() in packages/domain/pay.ts; both are held to pay.vectors.json.';

-- ---------------------------------------------------------------------
-- 2 · Breaks inside the paid window
-- ---------------------------------------------------------------------
create or replace function break_window_minutes(
  p_starts_at   timestamptz,
  p_ends_at     timestamptz,
  p_check_in_at timestamptz,
  p_finish_at   timestamptz,
  p_break_start timestamptz,
  p_break_end   timestamptz
) returns int
language sql
immutable
set search_path = public, extensions
as $$
  select greatest(0, round(extract(epoch from (
           least(coalesce(p_break_end, p_finish_at), p_finish_at,
                 -- ADR-0184: the paid end, as payable_minutes() has it —
                 -- the finish (at most end + 4 h) past end + 15 on a section
                 -- ending on or after 21.10.2026 00:00 UK, else the end.
                 case when p_finish_at > p_ends_at + interval '15 minutes'
                       and p_ends_at >= timestamptz '2026-10-20 23:00:00+00'
                      then least(p_finish_at, p_ends_at + interval '4 hours')
                      else p_ends_at end)
           - greatest(p_break_start, p_check_in_at, p_starts_at))) / 60))::int
$$;

comment on function break_window_minutes(timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) is
  '§5.2b, audit D49: one break''s minutes inside the paid window [max(check-in, start), paid end], the paid end being the scheduled end or, for a finish more than 15 minutes past it on a section ending on or after 21.10.2026 00:00 UK, the finish capped at end+4 h (ADR-0184). Mirrored by breakWindowMinutes() in packages/domain/pay.ts.';

-- ---------------------------------------------------------------------
-- 3 · The office's list: only sections the overrun rule applies to
-- ---------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('public.late_check_outs(integer, boolean)'::regprocedure);
  a text := 'and e.cancelled_at is null';
  b text := 'and e.cancelled_at is null
     -- ADR-0184''s effective date: earlier sections were paid to their end.
     and sr.ends_at >= timestamptz ''2026-10-20 23:00:00+00''';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then
    raise exception '20261022200100: late_check_outs - expected one match of the cancelled filter';
  end if;
  execute replace(v_def, a, b);
end $$;
