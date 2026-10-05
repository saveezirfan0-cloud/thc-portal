-- ADR-0087 · RULE-01. A late check-in is paid from the actual check-in, not
-- from the scheduled start. The 30-minute grace still decides Late vs No-show
-- (§5.1) but no longer decides pay. Arriving early still pays from the
-- scheduled start. RULE-14's four-hour floor is unchanged.
--
-- The body is 0009's apart from v_from. packages/domain's effectiveStart()
-- carries the same rule and pay.vectors.json holds both to it.
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
  v_from    timestamptz;
  v_to      timestamptz;
  v_worked  int;
  v_floor   boolean;
  v_payable int;
begin
  if p_check_out_at is null then
    return jsonb_build_object('status','undetermined','payableMin',null,'workedMin',null,
      'floorApplied',false,'lateCheckOutFlag',false);
  end if;

  v_from := greatest(p_check_in_at, p_starts_at);  -- early is not paid; late is paid from the press
  v_to   := least(p_check_out_at, p_ends_at);      -- never past the scheduled end

  -- [check-in, check-out] ∩ [start, end] is empty: there is no shift to pay,
  -- and the floor must not manufacture one (RULE-02, RULE-14).
  if v_to <= v_from then
    return jsonb_build_object('status','undetermined','payableMin',null,'workedMin',null,
      'floorApplied',false,'lateCheckOutFlag',false);
  end if;

  -- Whole minutes, so a timesheet, the app and the payroll export cannot
  -- disagree in the seconds (and so SQL and TypeScript round identically).
  v_worked := round(greatest(0, greatest(0, extract(epoch from (v_to - v_from)) / 60)
                                - coalesce(p_unpaid_break_min, 0)))::int;

  v_floor   := not p_left_early and coalesce(p_no_check_out,'none') <> 'unresolved';
  v_payable := case when v_floor then greatest(v_worked, 240) else v_worked end;

  return jsonb_build_object(
    'status','settled',
    'payableMin', v_payable,
    'workedMin',  v_worked,
    'floorApplied', v_floor and v_payable > v_worked,
    'lateCheckOutFlag', extract(epoch from (p_check_out_at - p_ends_at)) / 60 > 15);
end $$;

-- create or replace drops the pinned search_path; put it back.
alter function public.payable_minutes(timestamptz, timestamptz, timestamptz, timestamptz, integer, boolean, text)
  set search_path = public, extensions;

comment on function payable_minutes is
  'RULE-01/02/14 pay window. Paid from the later of the scheduled start and the actual check-in (ADR-0087). Mirrored by payableMinutes() in packages/domain/pay.ts; both are held to pay.vectors.json.';
