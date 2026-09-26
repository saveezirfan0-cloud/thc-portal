-- =====================================================================
-- Migration 20260930202000 · the worker's availability calendar
--   docs/19-staff-features-plan.md §1 (Phase 1, Agent B · staff-pwa)
--   ADR-0043 (proposed — awaiting THC) · Q9, Q10
--
-- The three RPCs /profile/availability calls. The table, its CHECKs, the
-- builder unavailability_range() and the gate staff_unavailable() are
-- Phase 0 (20260930200100); this file references nothing newer.
--
--   my_unavailability(p_from, p_to)         the worker's own entries
--   add_my_unavailability(…, p_repeat_weeks) one entry + weekly copies,
--                                            and the confirmed shifts it
--                                            overlaps (the warning)
--   remove_my_unavailability(p_id, p_whole_series)
--
-- The shape is ADR-0031's (20260922180000): `security definer`, the caller
-- resolved by staff_caller() and never passed in, named columns, pinned
-- search_path, and EXECUTE revoked from public and anon. The staff role
-- holds no policy on staff_unavailability (docs/19 §0.2), so these are the
-- only way a worker reads or writes it — and none of them takes a staff
-- id, so none can be pointed at a colleague.
--
-- Refusals the worker can correct come back as {ok:false, reason}, in the
-- order validateUnavailability() in packages/domain reports them:
--   bad_window › in_past › too_far › too_long › too_many
-- Refusals of WHO is asking raise (P0001): unknown_staff, account_closed
-- (GDPR-removed), not_editable (a leaver, or anyone not rostered).
--
-- A calendar entry never touches a booking. Saving one over a confirmed
-- shift returns that shift as a conflict so the screen can say "Marking
-- yourself unavailable doesn't cancel this shift — use Cancel or Offer on
-- the shift." (ADR-0043 §1); the booking, and any open invitation, are
-- untouched. Overlap is measured against the ROLE SECTION (RULE-18).
--
-- Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- my_unavailability — the list, by week on the screen.
--
-- Entries still running at p_from (default now) and starting before p_to
-- (default: no limit). `series_index` / `series_count` are counted over
-- the WHOLE series, past copies included, so a card can say "Repeats
-- weekly · 3 of 6" after the first two have gone by.
--
-- A leaver's Availability is closed with the rest of the app (§10.6
-- step 7), so they are refused rather than shown a list they cannot edit.
-- ---------------------------------------------------------------------
create or replace function public.my_unavailability(
  p_from timestamptz default null,
  p_to   timestamptz default null
) returns table (
  id           uuid,
  starts_at    timestamptz,
  ends_at      timestamptz,
  all_day      boolean,
  series_id    uuid,
  series_index int,
  series_count int
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  v_status staff_status;
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select s.status into v_status from staff s where s.id = v_id;
  if v_status = 'removed' then
    raise exception 'account_closed' using errcode = 'P0001';
  end if;
  if v_status = 'inactive' then
    raise exception 'not_editable' using errcode = 'P0001';
  end if;

  return query
    with mine as (
      select u.id, u.period, u.all_day, u.series_id,
             row_number() over (partition by u.series_id order by lower(u.period))::int as idx,
             count(*)     over (partition by u.series_id)::int                           as cnt
        from staff_unavailability u
       where u.staff_id = v_id
    )
    select m.id, lower(m.period), upper(m.period), m.all_day, m.series_id,
           case when m.series_id is null then null else m.idx end,
           case when m.series_id is null then null else m.cnt end
      from mine m
     where upper(m.period) > coalesce(p_from, now())
       and (p_to is null or lower(m.period) < p_to)
     order by lower(m.period), m.id;
end $$;

comment on function public.my_unavailability(timestamptz, timestamptz) is
  'ADR-0043: the calling worker''s own availability entries still running at p_from (default now) and starting before p_to. Takes no staff id. Refuses a leaver (not_editable) and a removed worker (account_closed).';

-- ---------------------------------------------------------------------
-- add_my_unavailability — one entry and its weekly copies, in one go.
--
-- UK dates and times in (the Add sheet's "(UK time)" fields); each copy is
-- built from its OWN dates by unavailability_range(), so 18:00 UK stays
-- 18:00 UK across a clock change. All copies share one series_id.
--
-- The staff row is locked for the duration so two saves in flight cannot
-- both pass the 200-row ceiling.
--
-- Returns {ok:true, ids:[…], conflicts:[{bookingId, event, role, venue,
-- startsAt, endsAt}]}: the worker's confirmed bookings on a live event
-- whose role section overlaps any new entry. They are the worker's own
-- bookings, already on their Shifts tab, and nothing else is returned.
-- ---------------------------------------------------------------------
create or replace function public.add_my_unavailability(
  p_from_date    date,
  p_to_date      date default null,
  p_from_time    time default null,
  p_to_time      time default null,
  p_repeat_weeks int  default 0
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  v_status staff_status;
  v_today date := (now() at time zone 'Europe/London')::date;
  v_to_date date := coalesce(p_to_date, p_from_date);
  v_repeats int := coalesce(p_repeat_weeks, 0);
  v_first tstzrange;
  v_end_date date;
  v_span interval;
  v_existing int;
  v_series uuid;
  v_ids uuid[] := '{}';
  v_new uuid;
  v_conflicts jsonb;
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select s.status into v_status from staff s where s.id = v_id for update;
  if v_status = 'removed' then
    raise exception 'account_closed' using errcode = 'P0001';
  end if;
  -- Availability steers auto-assign, whose pool is rostered workers only.
  -- A leaver, a rejected candidate or one still onboarding has no use for
  -- it, and /profile/availability is not reachable for them.
  if v_status not in ('compliant', 'blocked') then
    raise exception 'not_editable' using errcode = 'P0001';
  end if;

  -- 1 · bad_window. The builder raises 22023 for from == to, one time
  -- alone or to before from; the repeat count must be a whole number ≥ 0.
  if p_from_date is null or v_repeats < 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_window');
  end if;
  begin
    v_first := unavailability_range(p_from_date, p_to_date, p_from_time, p_to_time);
  exception when sqlstate '22023' then
    return jsonb_build_object('ok', false, 'reason', 'bad_window');
  end;

  -- 2 · in_past: starts on a UK date before today, or has already ended.
  if p_from_date < v_today or upper(v_first) <= now() then
    return jsonb_build_object('ok', false, 'reason', 'in_past');
  end if;

  -- 3 · too_far: the LAST copy starts more than 365 days after today (UK).
  -- least() only keeps an absurd count from overflowing the date type; any
  -- count that large is too far regardless.
  if p_from_date + 7 * least(v_repeats, 100000) > v_today + 365 then
    return jsonb_build_object('ok', false, 'reason', 'too_far');
  end if;

  -- 4 · too_long: more than 31 UK calendar days, read on the wall clock
  -- exactly as the table's CHECK reads it (so 31 days across the October
  -- changeover is still 31 days).
  if p_from_time is null then
    v_end_date := v_to_date + 1;
  elsif v_to_date = p_from_date and p_to_time < p_from_time then
    v_end_date := p_from_date + 1;
  else
    v_end_date := v_to_date;
  end if;
  v_span := (v_end_date + coalesce(p_to_time, time '00:00'))
          - (p_from_date + coalesce(p_from_time, time '00:00'));
  if v_span > interval '31 days' then
    return jsonb_build_object('ok', false, 'reason', 'too_long');
  end if;

  -- 5 · too_many: more than 26 repeats, or more than 200 future rows.
  select count(*)::int into v_existing
    from staff_unavailability u
   where u.staff_id = v_id and upper(u.period) > now();
  if v_repeats > 26 or v_existing + v_repeats + 1 > 200 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;

  v_series := case when v_repeats > 0 then gen_random_uuid() end;
  for w in 0 .. v_repeats loop
    insert into staff_unavailability (staff_id, period, all_day, series_id)
    values (v_id,
            unavailability_range(p_from_date + 7 * w,
                                 case when p_to_date is null then null else p_to_date + 7 * w end,
                                 p_from_time, p_to_time),
            p_from_time is null,
            v_series)
    returning staff_unavailability.id into v_new;
    v_ids := v_ids || v_new;
  end loop;

  -- The warning: this worker's confirmed bookings whose ROLE SECTION
  -- (RULE-18) overlaps any entry just saved. Nothing is cancelled.
  select coalesce(jsonb_agg(jsonb_build_object(
           'bookingId', c.booking_id,
           'event',     c.title,
           'role',      c.role_name,
           'venue',     c.venue_name,
           'startsAt',  c.starts_at,
           'endsAt',    c.ends_at) order by c.starts_at), '[]'::jsonb)
    into v_conflicts
    from (
      select distinct b.id as booking_id, e.title, r.name as role_name, e.venue_name,
             sr.starts_at, sr.ends_at
        from bookings b
        join shift_requirements sr on sr.id = b.shift_id
        join events e              on e.id = sr.event_id
        join roles r               on r.id = sr.role_id
        join staff_unavailability u
          on u.id = any (v_ids)
         and u.period && tstzrange(sr.starts_at, sr.ends_at, '[)')
       where b.staff_id = v_id
         and b.status = 'confirmed'
         and b.cancelled_at is null
         and e.cancelled_at is null
    ) c;

  return jsonb_build_object('ok', true, 'ids', to_jsonb(v_ids), 'conflicts', v_conflicts);
end $$;

comment on function public.add_my_unavailability(date, date, time, time, int) is
  'ADR-0043: saves one availability entry for the calling worker (UK dates/times; all day when both times are null) plus p_repeat_weeks weekly copies sharing a series_id. {ok:false, reason} for bad_window › in_past › too_far › too_long › too_many (validateUnavailability() in packages/domain). Returns the worker''s confirmed bookings the entries overlap (by role section, RULE-18) as conflicts — never cancels them.';

-- ---------------------------------------------------------------------
-- remove_my_unavailability — one entry, or the rest of its series.
--
-- "Delete just this one, or every remaining week?" The series option
-- removes the copies not yet over; a copy already in the past changes
-- nothing any more and is left as it was. Another worker's id, or one
-- that does not exist, is the same answer: not_found.
-- ---------------------------------------------------------------------
create or replace function public.remove_my_unavailability(
  p_id           uuid,
  p_whole_series boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  v_status staff_status;
  v_series uuid;
  v_removed int;
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select s.status into v_status from staff s where s.id = v_id;
  if v_status = 'removed' then
    raise exception 'account_closed' using errcode = 'P0001';
  end if;
  if v_status not in ('compliant', 'blocked') then
    raise exception 'not_editable' using errcode = 'P0001';
  end if;

  select u.series_id into v_series
    from staff_unavailability u
   where u.id = p_id and u.staff_id = v_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if coalesce(p_whole_series, false) and v_series is not null then
    delete from staff_unavailability u
     where u.staff_id = v_id
       and u.series_id = v_series
       and (u.id = p_id or upper(u.period) > now());
  else
    delete from staff_unavailability u
     where u.staff_id = v_id and u.id = p_id;
  end if;
  get diagnostics v_removed = row_count;

  return jsonb_build_object('ok', true, 'removed', v_removed);
end $$;

comment on function public.remove_my_unavailability(uuid, boolean) is
  'ADR-0043: deletes one of the calling worker''s availability entries, or (p_whole_series) it and every copy of its series not yet over. not_found for an id that is not theirs.';

-- ---------------------------------------------------------------------
-- Grants (docs/19 §0.2; pgTAP 190 2e/2f).
-- ---------------------------------------------------------------------
revoke execute on function public.my_unavailability(timestamptz, timestamptz)             from public, anon;
revoke execute on function public.add_my_unavailability(date, date, time, time, int)      from public, anon;
revoke execute on function public.remove_my_unavailability(uuid, boolean)                 from public, anon;
grant  execute on function public.my_unavailability(timestamptz, timestamptz)             to authenticated;
grant  execute on function public.add_my_unavailability(date, date, time, time, int)      to authenticated;
grant  execute on function public.remove_my_unavailability(uuid, boolean)                 to authenticated;
