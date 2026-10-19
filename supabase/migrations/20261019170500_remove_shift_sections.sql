-- =====================================================================
-- Removing a role section that only has pending offers on it (ADR-0160)
--
-- The Shift Builder refused to remove any section with a live booking on
-- it — invited, applied, confirmed or worked — because `bookings.shift_id`
-- cascades on delete and the rows would vanish with nobody told. The way
-- out it named was "withdraw its people on the board first". That works
-- for an invitation (withdraw_booking, N10d) but not for a Radar
-- application: the office has no Decline (ADR-0023 §3), so a role with
-- two pending applications and nobody confirmed could not be removed at
-- all (client report, 19.10.2026).
--
-- remove_shift_sections() is the one way the builder deletes a section:
--   * admin only; the sections are locked as withdraw_booking locks them;
--   * refuses `has_people` while anyone is confirmed, worked or turned
--     away on any of them — those still go through Withdraw (§3.6), and
--     §3.2's "never auto-removes anyone" stands;
--   * otherwise tells each pending invitee N10d (the office's own
--     "invitation withdrawn") and each pending applicant N10e, audits who
--     was told (event.role_offers_closed), and deletes the section, all in
--     one transaction.
-- =====================================================================

create or replace function public.remove_shift_sections(p_event uuid, p_shifts uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  ev       events;
  sr       shift_requirements;
  b        bookings;
  v_held   int;
  v_told   int := 0;
  v_gone   int := 0;
  v_code   text;
  v_at     timestamptz := clock_timestamp();
  v_invited jsonb;
  v_applied jsonb;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select * into ev from events where id = p_event;
  if ev.id is null then raise exception 'event_not_found' using errcode = 'P0002'; end if;

  -- The sections first, in a fixed order, as invite_worker / accept_invite /
  -- accept_application / withdraw_booking lock them: an Accept racing the
  -- removal either lands first (and is refused below) or waits and finds
  -- the section gone.
  perform 1 from shift_requirements
   where event_id = p_event and id = any(p_shifts)
   order by id
   for update;

  select count(*)::int into v_held
    from bookings b2
    join shift_requirements s2 on s2.id = b2.shift_id
   where s2.event_id = p_event and s2.id = any(p_shifts)
     and b2.status in ('confirmed', 'worked', 'turned_away');
  if v_held > 0 then
    return jsonb_build_object('ok', false, 'reason', 'has_people', 'held', v_held);
  end if;

  for sr in
    select * from shift_requirements
     where event_id = p_event and id = any(p_shifts)
     order by id
  loop
    v_invited := '[]'::jsonb;
    v_applied := '[]'::jsonb;

    for b in
      select * from bookings
       where shift_id = sr.id and status in ('invited', 'applied')
       order by id
       for update
    loop
      v_code := case when b.status = 'invited' then 'N10d' else 'N10e' end;
      insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
      values (
        v_code || ':booking:' || b.id::text || ':' || floor(extract(epoch from v_at) * 1000)::bigint::text,
        'push', v_code, b.staff_id,
        jsonb_build_object(
          'bookingId', b.id, 'shiftId', sr.id, 'eventId', ev.id,
          'event', ev.title,
          -- The ROLE's start in UK time (RULE-18, §1.8), as withdraw_booking.
          'dateTime', to_char(sr.starts_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI'),
          'window', to_char(sr.starts_at at time zone 'Europe/London', 'HH24:MI')
                    || '–' || to_char(sr.ends_at at time zone 'Europe/London', 'HH24:MI')))
      on conflict (key) do nothing;
      v_told := v_told + 1;
      if b.status = 'invited' then
        v_invited := v_invited || to_jsonb(b.staff_id);
      else
        v_applied := v_applied || to_jsonb(b.staff_id);
      end if;
    end loop;

    -- The booking rows go with the section (cascade). The section's own
    -- delete is audited by shift_requirements_audit (event.role_removed);
    -- this row keeps who held an offer on it and was told.
    if jsonb_array_length(v_invited) + jsonb_array_length(v_applied) > 0 then
      insert into audit_log (at, actor, action, entity, entity_id, data)
      values (v_at, auth.uid(), 'event.role_offers_closed', 'event', ev.id,
              jsonb_build_object('sectionId', sr.id::text,
                                 'role', (select r.name from roles r where r.id = sr.role_id),
                                 'invited', v_invited, 'applied', v_applied));
    end if;

    delete from shift_requirements where id = sr.id;
    v_gone := v_gone + 1;
  end loop;

  return jsonb_build_object('ok', true, 'removed', v_gone, 'notified', v_told);
end $$;

comment on function public.remove_shift_sections(uuid, uuid[]) is
  'The Shift Builder''s Remove on save (§3.2, ADR-0160), admin only: refuses has_people while anyone is confirmed, worked or turned away on a section; otherwise queues N10d to each pending invitee and N10e to each pending applicant, audits event.role_offers_closed with who was told, and deletes the sections — one transaction. 20261019170500.';

revoke execute on function public.remove_shift_sections(uuid, uuid[]) from public, anon;
grant execute on function public.remove_shift_sections(uuid, uuid[]) to authenticated;
