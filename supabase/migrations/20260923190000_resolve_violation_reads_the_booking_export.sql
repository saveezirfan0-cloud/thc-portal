-- =====================================================================
-- resolve_violation() asks whether THIS shift was exported (RULE-02, §9.9)
--
-- It read events.payroll_exported_at, which the Monday send sets once any
-- of the event's shifts go out. A No check-out is HELD from that export
-- (never a guessed figure) and rolls to the next Monday once resolved —
-- so resolving one warned "the payment will not be added" about a shift
-- that was in fact still to be paid. payroll_export_lines knows per
-- booking; booking_payroll_exported() reads it.
--
-- Only that line differs from 20260921153000. Replacing the function keeps
-- its grant.
-- =====================================================================

create or replace function resolve_violation(
  p_violation     uuid,
  p_note          text,
  p_actual_finish timestamptz default null
) returns jsonb language plpgsql set search_path = public, extensions as $$
declare
  v         violations;
  b         bookings;
  sr        shift_requirements;
  ev        events;
  cl        check_logs;
  v_now     timestamptz := now();
  v_was     violation_type;
  v_minutes int;
  v_exported boolean;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'admins_only' using errcode = '42501';
  end if;

  -- The note is mandatory for every type (§9.5, confirmed 31.07.2026).
  if p_note is null or btrim(p_note) = '' then
    raise exception 'note_required' using errcode = 'P0001';
  end if;

  select * into v from violations where id = p_violation for update;
  if v.id is null then raise exception 'violation_not_found' using errcode = 'P0002'; end if;
  if v.resolved then
    return jsonb_build_object('decision','already_resolved','messageKey','already_resolved');
  end if;

  select * into b  from bookings where id = v.booking_id;
  select * into sr from shift_requirements where id = b.shift_id;
  select * into ev from events where id = sr.event_id;
  select * into cl from check_logs
   where booking_id = b.id and check_in_at is not null
   order by check_in_at limit 1 for update;

  v_was := v.type;
  -- Per booking, not per event: a held No check-out is left OUT of the
  -- Monday export and paid the Monday after it is resolved, so the event
  -- having been exported says nothing about this shift (20260923130000).
  v_exported := booking_payroll_exported(b.id);

  if v.type = 'no_checkout' then
    if p_actual_finish is null then
      raise exception 'actual_finish_required' using errcode = 'P0001';
    end if;
    if p_actual_finish > v_now then
      raise exception 'actual_finish_in_future' using errcode = 'P0001';
    end if;
    if cl.check_in_at is not null and p_actual_finish < cl.check_in_at then
      raise exception 'actual_finish_before_check_in' using errcode = 'P0001';
    end if;

    update check_logs set manager_finish_at = p_actual_finish where id = cl.id;
    v.actual_finish_at := p_actual_finish;

  elsif v.type = 'no_show' then
    -- "Get back": the worker is registered as arrived at the moment of the press.
    v_minutes := greatest(0, floor(extract(epoch from (v_now - sr.starts_at)) / 60)::int);

    if cl.id is null then
      insert into check_logs (booking_id, attempted_at, outcome, check_in_at, on_site_verified)
      values (b.id, v_now, 'checked_in', v_now, false);
    end if;
    update bookings set status = 'worked' where id = b.id and status = 'confirmed';

    -- The entry becomes a Late violation, reviewed and closed in one action.
    v.type := 'late';
    v.minutes_late := v_minutes;
  end if;

  update violations
     set resolved = true,
         resolved_by = auth.uid(),
         resolved_at = v_now,
         resolution_note = btrim(p_note),
         type = v.type,
         minutes_late = v.minutes_late,
         actual_finish_at = v.actual_finish_at
   where id = v.id;

  return jsonb_build_object(
    'decision','resolved',
    'wasType', v_was,
    'nowType', v.type,
    'reclassified', v_was is distinct from v.type,
    'minutesLate', v.minutes_late,
    'actualFinishAt', to_jsonb(v.actual_finish_at),
    -- RULE-06: the export is never corrected retroactively, so the screen warns.
    'payrollExported', v_exported,
    'messageKey', case when v_exported then 'resolved_payroll_already_exported' else 'resolved' end,
    'pay', (select pay from payable_shifts_v where booking_id = b.id));
end $$;
