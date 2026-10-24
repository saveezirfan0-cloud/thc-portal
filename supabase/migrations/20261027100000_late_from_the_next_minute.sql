-- =====================================================================
-- Migration 20261027100000 · Late starts a whole minute after the start
--                            (ticket TK-16)
--
-- check_in_decision() marked a check-in Late the instant it was after the
-- scheduled start: a press at 15:00:00.8 for a 15:00 shift was Late, with
-- 0 minutes late, and a `late` violation was written for it. The pay
-- vectors already say "on the stroke of the start is on time, not Late",
-- and the check-in monitor already shows such a press as "on time"; only
-- the decision disagreed, because whole-minute vectors never reached the
-- seconds inside the start minute.
--
-- Now a press inside the start minute is on time, and Late means at least
-- one whole minute late. packages/domain/src/pay.ts makes the same change;
-- pay.vectors.json holds both to the new cases (seconds into the start
-- minute → on time; one whole minute → Late, 1 minute). Pay is unchanged:
-- it was always counted from the later of the start and the check-in.
-- =====================================================================

create or replace function public.check_in_decision(
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_at timestamptz,
  p_inside_geofence boolean,
  p_confirmed_at timestamptz,
  p_slots_filled integer,
  p_headcount integer,
  p_strict_buffer boolean
)
returns jsonb
language plpgsql
immutable
set search_path = public, extensions
as $function$
declare
  v_minutes     int     := greatest(0, floor(extract(epoch from (p_at - p_starts_at)) / 60)::int);
  -- TK-16: a whole minute after the start, never "Late, 0 minutes".
  v_late        boolean := v_minutes >= 1;
  v_grace_ends  timestamptz := p_starts_at + interval '30 minutes';
  v_turn_away   int;
  v_locks_at    timestamptz;
begin
  if p_at < p_starts_at - interval '30 minutes' then
    return jsonb_build_object('decision','too_early','accepted',false,'logOutcome',null,
      'late',v_late,'minutesLate',v_minutes,'turnAwayPayMin',null,'messageKey','check_in_not_open');
  end if;

  if not p_inside_geofence then
    return jsonb_build_object('decision','out_of_radius','accepted',false,'logOutcome','out_of_radius',
      'late',v_late,'minutesLate',v_minutes,'turnAwayPayMin',null,'messageKey','out_of_radius');
  end if;

  if p_strict_buffer and p_slots_filled >= p_headcount then
    v_turn_away := turned_away_minutes(p_starts_at, p_at);
    return jsonb_build_object('decision','turned_away','accepted',false,'logOutcome','turned_away',
      'late',v_late,'minutesLate',v_minutes,'turnAwayPayMin',v_turn_away,
      'messageKey', case when v_turn_away > 0 then 'turned_away_paid' else 'turned_away_unpaid' end);
  end if;

  v_locks_at := case when p_confirmed_at is not null and p_confirmed_at > p_starts_at
                     then p_ends_at else v_grace_ends end;
  if p_at >= v_locks_at then
    return jsonb_build_object('decision','locked','accepted',false,'logOutcome',null,
      'late',v_late,'minutesLate',v_minutes,'turnAwayPayMin',null,'messageKey','no_show_locked');
  end if;

  return jsonb_build_object(
    'decision', case when v_late then 'checked_in_late' else 'checked_in' end,
    'accepted', true, 'logOutcome','checked_in',
    'late', v_late, 'minutesLate', v_minutes, 'turnAwayPayMin', null,
    'messageKey', case when v_late then 'checked_in_late' else 'checked_in' end);
end $function$;
