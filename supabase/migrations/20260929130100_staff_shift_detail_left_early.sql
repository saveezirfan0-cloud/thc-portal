-- =====================================================================
-- staff_shift_detail() says whether a Left early is logged (RULE-14)
--
-- check_out() now raises `left_early` (20260929120000, audit D5), and a
-- logged Left early always blocks the 4-hour floor. The Staff App's
-- check-out summary priced the floor without knowing it, and inferred it
-- from the press time; this column is the fact itself, so the worker sees
-- the figure payroll will pay. The app already reads `left_early` when the
-- column is present (apps/staff/app/shifts/[id]/data.ts).
--
-- Restated in full from 20260929130000 (the latest definition). The result
-- gains a column, so it is dropped and recreated.
-- =====================================================================

drop function if exists public.staff_shift_detail(uuid);

create function public.staff_shift_detail(p_booking uuid)
returns table (
  booking_id          uuid,
  status              text,
  confirmed_at        timestamptz,
  cancel_cause        text,
  starts_at           timestamptz,
  ends_at             timestamptz,
  pay_rate            numeric,
  dress_code          text,
  role                text,
  event_title         text,
  event_date          date,
  venue_name          text,
  venue_address       text,
  venue_lat           double precision,
  venue_lng           double precision,
  geofence_radius_m   int,
  onsite_contact      text,
  notes               text,
  pays_breaks         boolean,
  event_cancelled_at  timestamptz,
  no_checkout_open    boolean,
  check_in_at         timestamptz,
  check_out_at        timestamptz,
  breaks              jsonb,
  turned_away_at      timestamptz,
  left_early          boolean
)
language sql stable security definer
set search_path = public, extensions as $$
  with me as (select staff_caller(null) as id)
  select
    b.id, b.status::text, b.confirmed_at, b.cancel_cause,
    -- The ROLE SECTION's window (RULE-18), never the event's.
    sr.starts_at, sr.ends_at,
    -- The worker's base rate (§9.8). Not the charge rate, which is not
    -- selected anywhere in this function.
    sr.pay_rate, sr.dress_code,
    r.name,
    ev.title, ev.event_date, ev.venue_name, ev.venue_address,
    st_y(ev.venue_location::geometry), st_x(ev.venue_location::geometry),
    ev.geofence_radius_m,
    case when b.status in ('confirmed', 'worked') then ev.onsite_contact end,
    case when b.status in ('confirmed', 'worked') then ev.notes end,
    case when b.status in ('confirmed', 'worked') then ev.pays_breaks end,
    ev.cancelled_at,
    exists (select 1 from violations v
             where v.booking_id = b.id and v.type = 'no_checkout' and not v.resolved),
    cl.check_in_at,
    coalesce(cl.manager_finish_at, cl.check_out_at),
    coalesce((select jsonb_agg(jsonb_build_object(
                       'id', br.id, 'startedAt', br.started_at, 'endedAt', br.ended_at)
                     order by br.started_at)
                from breaks br where br.booking_id = b.id), '[]'::jsonb),
    -- RULE-15: the logged attempt that turned the worker away. Only on a
    -- booking that IS turned away, so a stray log row on a working booking
    -- cannot put the "Thanks for coming" screen in front of it.
    case when b.status = 'turned_away' then
      (select min(c.attempted_at) from check_logs c
        where c.booking_id = b.id and c.outcome = 'turned_away')
    end,
    -- RULE-14: a logged Left early blocks the 4-hour floor, whatever its
    -- review state, so the worker's earnings figure prices it as payroll does.
    exists (select 1 from violations v
             where v.booking_id = b.id and v.type = 'left_early')
  from me
    join bookings b             on b.staff_id = me.id and b.id = p_booking
    join shift_requirements sr  on sr.id = b.shift_id
    join events ev              on ev.id = sr.event_id
    join roles r                on r.id = sr.role_id
    left join lateral (
      select c.check_in_at, c.check_out_at, c.manager_finish_at
        from check_logs c
       where c.booking_id = b.id and c.check_in_at is not null
       order by c.check_in_at
       limit 1
    ) cl on true
$$;
comment on function public.staff_shift_detail(uuid) is
  'The shift screen (§10.4, §5.1) for ONE of the caller''s own bookings: role window, base pay rate, venue and its centre, the accepted check log, breaks, the three static-screen inputs, the RULE-15 turn-away stamp and whether a Left early is logged (RULE-14). No charge rate, margin, PO or client. Another worker''s id returns no row.';

revoke execute on function public.staff_shift_detail(uuid) from public, anon;
grant  execute on function public.staff_shift_detail(uuid) to authenticated;
