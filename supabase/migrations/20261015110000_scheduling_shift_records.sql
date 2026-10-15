-- =====================================================================
-- Scheduling: the busiest day and week ever booked (ADR-0142)
--
-- The Week and Day views of /events print a shift total per day and per
-- week. A "shift" is one position the client asked for: the headcount of a
-- role section. The buffer is not counted (it is absolute and reads apart,
-- "6 (+1)"), nor is a cancelled event (ADR-0099: not on the diary).
--
-- scheduling_shift_records() answers the two all-time tables the screen
-- celebrates against: the top two days and the top two Mon–Sun weeks by
-- shifts, so the screen can say "a new record, beating 280 on Sat 4 Oct".
-- A tie sorts the earlier date first: whoever hit the number first holds
-- the record, and an equal later day is not a new one.
--
-- Office only. Security invoker, so it reads what RLS already lets the
-- office read and grants nothing new.
-- =====================================================================

create or replace function public.scheduling_shift_records()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'admins_only' using errcode = '42501';
  end if;

  return (
    with per_day as (
      select e.event_date as day, sum(sr.headcount)::int as shifts
        from events e
        join shift_requirements sr on sr.event_id = e.id
       where e.cancelled_at is null
       group by e.event_date
      having sum(sr.headcount) > 0
    ),
    -- date_trunc('week') is ISO: the Monday, as the calendar's week is.
    per_week as (
      select date_trunc('week', day)::date as day, sum(shifts)::int as shifts
        from per_day
       group by 1
    )
    select jsonb_build_object(
      'days', coalesce((
        select jsonb_agg(jsonb_build_object('date', t.day, 'shifts', t.shifts)
                         order by t.shifts desc, t.day)
          from (select day, shifts from per_day order by shifts desc, day limit 2) t
      ), '[]'::jsonb),
      'weeks', coalesce((
        select jsonb_agg(jsonb_build_object('date', t.day, 'shifts', t.shifts)
                         order by t.shifts desc, t.day)
          from (select day, shifts from per_week order by shifts desc, day limit 2) t
      ), '[]'::jsonb)
    )
  );
end;
$$;

comment on function public.scheduling_shift_records() is
  'ADR-0142: the top two days and Mon–Sun weeks by shifts (headcount, cancelled events excluded), earliest first on a tie. Office only.';

revoke all on function public.scheduling_shift_records() from public, anon;
grant execute on function public.scheduling_shift_records() to authenticated, service_role;
