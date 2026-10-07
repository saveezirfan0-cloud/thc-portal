-- =====================================================================
-- office_events_in_range: the Scheduling list/calendar in one read
--                          (ADR-0103 · §3.1)
--
-- /events used to read a period in four steps, each waiting on the last:
--   1. events in the date range
--   2. their role sections (`shift_requirements.event_id IN (…every id…)`),
--      with every client and every role fetched alongside to look names up
--   3. the confirmed bookings of every section
--      (`bookings.shift_id IN (…every section id…)`, one row per booking)
--
-- Two things were wrong with that beyond the round trips:
--   · the ids travel in the URL, so a busy month (10–15 events a day, 2–3
--     sections each) is a request line in the tens of kilobytes;
--   · step 3 returns one row per confirmed booking only to be counted in the
--     app, and the API returns at most `max_rows` (1000) of them — past that
--     the fill chips under-count without any error.
--
-- This returns the same thing in one call, with the confirmed counts done
-- where the rows are. One JSON array rather than a set of rows, so the
-- API's row cap cannot cut a long period short.
--
-- SECURITY INVOKER, on purpose: it runs as the caller, so every table it
-- reads is still filtered by that table's own policies and grants, exactly
-- as the separate reads were. It selects no rate column (ADR-0061) and no
-- worker data — role and client NAMES, headcounts and a count of confirmed
-- bookings. The app keeps its multi-step read as a fallback for the window
-- in which the app is deployed and this migration is not.
-- =====================================================================

create or replace function public.office_events_in_range(p_from date, p_to date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(x.j order by x.event_date, x.created_at, x.id), '[]'::jsonb)
    from (
      select
        e.id,
        e.event_date,
        e.created_at,
        jsonb_build_object(
          'id',            e.id,
          'title',         e.title,
          'event_date',    e.event_date,
          'venue_name',    e.venue_name,
          'venue_address', e.venue_address,
          'po_number',     e.po_number,
          'cancelled_at',  e.cancelled_at,
          'cancel_reason', e.cancel_reason,
          'client_id',     e.client_id,
          'client_name',   c.name,
          'sections', coalesce((
            select jsonb_agg(
                     jsonb_build_object(
                       'role_name', r.name,
                       'starts_at', s.starts_at,
                       'ends_at',   s.ends_at,
                       'headcount', s.headcount,
                       'buffer',    s.buffer,
                       'confirmed', (select count(*)
                                       from bookings b
                                      where b.shift_id = s.id
                                        and b.status = 'confirmed')
                     )
                     order by s.starts_at, s.id)
              from shift_requirements s
              left join roles r on r.id = s.role_id
             where s.event_id = e.id
          ), '[]'::jsonb)
        ) as j
        from events e
        left join clients c on c.id = e.client_id
       where e.event_date between p_from and p_to
    ) x
$$;

comment on function public.office_events_in_range(date, date) is
  'Every event whose event_date is in [p_from, p_to], as one JSON array: the event, its client name, and its role sections (role name, window, headcount, buffer, confirmed bookings). Security invoker: the caller''s own row security and grants apply. Replaces a four-step read whose ids travelled in the URL and whose booking rows were capped at max_rows (20261007143000, ADR-0103).';

revoke all on function public.office_events_in_range(date, date) from public, anon;
grant execute on function public.office_events_in_range(date, date) to authenticated;
