-- =====================================================================
-- staff_shift_detail() — the worker's one shift, read past RLS (§10.4, §5.1)
--
-- `/shifts/:id` read `bookings` and EMBEDDED `shift_requirements`, `events`,
-- `roles`, `check_logs` and `breaks` through PostgREST. The staff role holds
-- a SELECT policy on `bookings` and on none of the others, so for a real
-- worker every embed came back null: the check-in screen rendered with no
-- times, no venue and no role, and a checked-in worker was offered the
-- check-in button again because their check log was invisible to them
-- (docs/15 §2 blocker 1, verified as Tom Reid on the live DB).
--
-- The fix is NOT a staff policy on those tables. `shift_requirements`
-- carries the charge rate, `events` the PO and the client's terms, and a
-- policy is a grant on every column (ADR-0004: a view cannot take back a
-- privilege the base table grants). This follows `staff_bookings()`
-- instead: `security definer`, the caller resolved by `staff_caller()`,
-- and every column named — the screen's and nothing else. There is no
-- charge rate, margin, PO or client here to leak, because none is selected.
--
-- Scoped to the caller's OWN booking: another worker's id, or an id that
-- does not exist, returns no row (the screen 404s) rather than an error
-- that would tell the caller the id exists.
--
-- The same withholding rule as `staff_bookings()`: on-site contact, notes
-- and the break policy only once the booking is accepted (§10.4, §3.2).
--
-- The static-screen inputs come with the row (§10.4): the event's
-- cancellation, the booking's cancel cause, and whether an unresolved
-- RULE-02 No check-out violation stands — `staticScreenCase()` in
-- packages/domain/src/staff.ts decides from those three.
--
-- The check log is the ACCEPTED press — earliest `check_in_at`, the lateral
-- `payable_shifts_v` and `check_out()` use — with a manager-entered finish
-- preferred over the pressed one (RULE-02, §9.5). The venue centre comes
-- back as numbers so the screen no longer needs `booking_venue_point()`
-- for it; that reader stays for anything else calling it.
-- =====================================================================

create or replace function public.staff_shift_detail(p_booking uuid)
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
  breaks              jsonb
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
                from breaks br where br.booking_id = b.id), '[]'::jsonb)
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
  'The shift screen (§10.4, §5.1) for ONE of the caller''s own bookings: role window, base pay rate, venue and its centre, the accepted check log, breaks, and the three static-screen inputs. No charge rate, margin, PO or client. Another worker''s id returns no row.';

revoke execute on function public.staff_shift_detail(uuid) from public, anon;
grant  execute on function public.staff_shift_detail(uuid) to authenticated;
