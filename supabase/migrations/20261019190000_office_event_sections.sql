-- =====================================================================
-- /events Month and List: the sections and their confirmed counts in one
-- read (go-live audit 17.10.2026, B2)
--
-- The calendar read the period's events, then
--   shift_requirements?event_id=in.(…every event id…)
--   bookings?shift_id=in.(…every section id…)&status=eq.confirmed
-- and counted the bookings in JavaScript. A Month grid is 35–42 days: at
-- 15 events a day that is ~525 event ids (~19 KB of URL) and ~1,500
-- section ids (~55 KB), past what the gateway accepts, so the screen read
-- "Events could not be loaded". Accepted or not, PostgREST's max_rows
-- (1000) would then have cut the sections and the month's ~7,000
-- confirmed bookings, and filled roles would have shown as open.
--
-- office_event_sections(from, to) returns every role section of every
-- event whose event_date is in the period — filtered on event_date, as
-- the calendar files an event under the day it starts — with the count
-- the fill chips show. That count is exactly what the screen counted
-- before: bookings with status 'confirmed', nothing else (a `worked`
-- booking is not counted, as it was not). Fill counts ONLY confirmed;
-- the buffer is returned as it is stored and still reads "6 (+1)".
--
-- One row per section, ordered by (starts_at, id) — a total order, so
-- the office can page it past max_rows without losing a row.
--
-- Office only, the way scheduling_shift_records() is: security invoker,
-- so it reads only what RLS already lets the office read, and anybody
-- whose app role is not admin is refused outright.
-- =====================================================================

create or replace function public.office_event_sections(p_from date, p_to date)
returns table (
  section_id uuid,
  event_id uuid,
  role_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  headcount int,
  buffer int,
  confirmed int
)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'admins_only' using errcode = '42501';
  end if;
  if p_from is null or p_to is null then
    raise exception 'period_required' using errcode = '22023';
  end if;

  return query
  select sr.id, sr.event_id, sr.role_id, sr.starts_at, sr.ends_at, sr.headcount, sr.buffer,
         (select count(*)::int
            from bookings b
           where b.shift_id = sr.id
             and b.status = 'confirmed')
    from shift_requirements sr
    join events e on e.id = sr.event_id
   where e.event_date between p_from and p_to
   order by sr.starts_at, sr.id;
end;
$$;

comment on function public.office_event_sections(date, date) is
  'Go-live audit B2: every role section of the events dated in [p_from, p_to], with its confirmed-booking count (status = confirmed only), ordered (starts_at, id). Office only.';

revoke all on function public.office_event_sections(date, date) from public, anon;
grant execute on function public.office_event_sections(date, date) to authenticated, service_role;
